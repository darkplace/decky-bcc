import configparser
import math
import shutil
import tempfile
import time
from pathlib import Path

from .system import atomically_write, cpu_governors, run_cmd, set_cpu_governor

POWER_CONFIG = Path("/userdata/system/configs/batocera-control/power-profiles.conf")
FACTORY_POWER_CONFIG = Path("/usr/share/batocera-control/power-profiles.conf")
BUNDLED_POWER_CONFIG = Path("/userdata/system/configs/batocera-control/power-profiles.factory.conf")
PLUGIN_FACTORY = Path(__file__).resolve().parent.parent / "power-profiles.factory.conf"
PROFILES = ("eco", "balanced", "performance")
POWER_SCRIPT = Path("/userdata/system/scripts/odin-power")
QCOM_FAN = Path("/usr/bin/qcom-fan")
AMD_TDP = Path("/usr/bin/batocera-amd-tdp")
SIMPLE_DECKY_TDP = Path("/userdata/system/homebrew/plugins/SimpleDeckyTDP/plugin.json")
DEVICE_TREE_COMPAT = Path("/proc/device-tree/compatible")

# Named fan curves → stock qcom-fan modes (safe subset; no PWM underclocks).
FAN_CURVE_TO_QCOM = {
    "relaxed": "silent",
    "moderate": "auto",
    "aggressive": "aggressive",
}


def ensure_bundled_factory() -> None:
    """Seed userdata factory copy from image or plugin payload."""
    if BUNDLED_POWER_CONFIG.exists():
        return
    source = FACTORY_POWER_CONFIG if FACTORY_POWER_CONFIG.exists() else PLUGIN_FACTORY
    if not source.exists():
        return
    try:
        BUNDLED_POWER_CONFIG.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, BUNDLED_POWER_CONFIG)
    except OSError:
        pass


def _x86_amd_handheld() -> bool:
    return AMD_TDP.is_file() and not DEVICE_TREE_COMPAT.exists()


def odin_backend() -> bool:
    return POWER_SCRIPT.is_file()


def stock_backend() -> bool:
    """Governor + qcom-fan profiles without maintainer odin-power."""
    if _x86_amd_handheld():
        return False
    return QCOM_FAN.is_file() or bool(cpu_governors())


def has_power_definitions() -> bool:
    ensure_bundled_factory()
    return any(path.exists() for path in (FACTORY_POWER_CONFIG, BUNDLED_POWER_CONFIG, PLUGIN_FACTORY))


def backend() -> str:
    if not has_power_definitions():
        return "none"
    if odin_backend():
        return "odin-power"
    if stock_backend():
        return "stock"
    return "none"


def supported() -> bool:
    return backend() != "none"


def unsupported_reason() -> str:
    if supported():
        return ""
    if _x86_amd_handheld() and SIMPLE_DECKY_TDP.is_file():
        return "AMD TDP is managed by SimpleDeckyTDP on this x86 handheld"
    if _x86_amd_handheld():
        return "Use Batocera's native AMD TDP controls on this x86 handheld"
    if not has_power_definitions():
        return "Power profile definitions are not installed"
    return (
        "Power profiles need qcom-fan / CPU governors (stock) or "
        "/userdata/system/scripts/odin-power. Adaptive CPU and Fan controls below still work"
    )


def _config_paths(path=None):
    if path is not None:
        return [path]
    ensure_bundled_factory()
    paths: list[Path] = []
    for candidate in (FACTORY_POWER_CONFIG, BUNDLED_POWER_CONFIG, PLUGIN_FACTORY, POWER_CONFIG):
        if candidate.exists() and candidate not in paths:
            paths.append(candidate)
    return paths or [PLUGIN_FACTORY if PLUGIN_FACTORY.exists() else FACTORY_POWER_CONFIG]


def default_label(name):
    return name.replace("_", " ").title()


def restore_factory_power_config(reason):
    # Remove invalid /etc overrides so factory-only sections keep tracking /usr.
    if not POWER_CONFIG.exists():
        raise reason
    backup = POWER_CONFIG.with_name(f"{POWER_CONFIG.name}.invalid-{time.strftime('%Y%m%d-%H%M%S')}")
    try:
        shutil.copy2(POWER_CONFIG, backup)
        POWER_CONFIG.unlink()
    except OSError:
        raise reason


def parse_power(path=None, repair=True):
    parser = configparser.ConfigParser()
    paths = _config_paths(path)
    try:
        if not parser.read([str(candidate) for candidate in paths]):
            raise FileNotFoundError(paths[0] if paths else FACTORY_POWER_CONFIG)
        return parsed_power(parser)
    except (configparser.Error, FileNotFoundError, ValueError) as exc:
        # Avoid factory-restore on IO errors or code bugs in the read path.
        if path is None and repair and POWER_CONFIG.exists():
            restore_factory_power_config(exc)
            ensure_bundled_factory()
            fallback = FACTORY_POWER_CONFIG if FACTORY_POWER_CONFIG.exists() else BUNDLED_POWER_CONFIG
            if not fallback.exists():
                fallback = PLUGIN_FACTORY
            return parse_power(fallback, repair=False)
        raise


def parsed_power(parser):
    for section in ("general", "fan"):
        if not parser.has_section(section):
            raise ValueError(f"missing config section [{section}]")
    data = {
        "general": {"default_profile": parser.get("general", "default_profile")},
        "profiles": {},
        "fan_curves": {},
        "fan": {},
        "underclocks": {},
    }
    for name in PROFILES:
        section = f"profile.{name}"
        if not parser.has_section(section):
            raise ValueError(f"missing config section [{section}]")
        data["profiles"][name] = {
            "label": parser.get(section, "label", fallback="") or default_label(name),
            "cpu_governor": parser.get(section, "cpu_governor"),
            "cpu_max": parser.get(section, "cpu_max"),
            "cpu_underclock": parser.get(section, "cpu_underclock"),
            "gpu_max": parser.get(section, "gpu_max"),
            "gpu_min": parser.get(section, "gpu_min"),
            "fan_curve": parser.get(section, "fan_curve"),
        }
    for section in parser.sections():
        if section.startswith("fan_curve."):
            name = section.split(".", 1)[1]
            data["fan_curves"][name] = {
                "label": parser.get(section, "label", fallback="") or default_label(name),
                "curve": parser.get(section, "curve"),
            }
            continue
        if not section.startswith("underclock."):
            continue
        parts = section.split(".")
        if len(parts) == 3:
            _, device_class, level = parts
            data["underclocks"].setdefault(device_class, {})[level] = dict(parser.items(section))
    data["fan"] = dict(parser.items("fan"))
    return data


# Only editable fields are written to /etc; factory-only fields stay in /usr.
EDITABLE_KEYS = ("cpu_governor", "cpu_max", "cpu_underclock", "gpu_max", "gpu_min", "fan_curve")
NUMERIC_KEYS = ("cpu_max", "gpu_max", "gpu_min")


def profile_overrides(profile):
    out = {}
    for key in EDITABLE_KEYS:
        value = profile[key]
        out[key] = f"{float(value):.2f}" if key in NUMERIC_KEYS else str(value)
    return out


def set_or_clear(parser, section, key, value, keep):
    if keep:
        if not parser.has_section(section):
            parser.add_section(section)
        parser.set(section, key, value)
    elif parser.has_section(section) and parser.has_option(section, key):
        parser.remove_option(section, key)


def render_power(data, factory):
    # Preserve hand-edited /etc fields outside the plugin-owned keys.
    parser = configparser.ConfigParser()
    parser.optionxform = str
    parser.read(POWER_CONFIG)

    set_or_clear(parser, "general", "default_profile", data["general"]["default_profile"],
                 data["general"]["default_profile"] != factory["general"]["default_profile"])
    for name in PROFILES:
        overrides = profile_overrides(data["profiles"][name])
        edited = overrides != profile_overrides(factory["profiles"][name])
        for key in EDITABLE_KEYS:
            set_or_clear(parser, f"profile.{name}", key, overrides[key], edited)

    for section in ("general", *(f"profile.{name}" for name in PROFILES)):
        if parser.has_section(section) and not parser.options(section):
            parser.remove_section(section)

    with tempfile.TemporaryFile("w+", encoding="utf-8") as f:
        parser.write(f)
        f.seek(0)
        return f.read()


def factory_power_defaults():
    ensure_bundled_factory()
    for path in (FACTORY_POWER_CONFIG, BUNDLED_POWER_CONFIG, PLUGIN_FACTORY):
        if path.exists():
            try:
                return parse_power(path, repair=False)
            except (OSError, configparser.Error, ValueError, FileNotFoundError):
                continue
    return parse_power()


def resolve_qcom_mode(data: dict, curve_name: str) -> str | None:
    entry = (data.get("fan_curves") or {}).get(curve_name) or {}
    curve_spec = str(entry.get("curve") or "")
    if curve_spec.startswith("stock:"):
        return curve_spec.split(":", 1)[1].strip() or None
    return FAN_CURVE_TO_QCOM.get(curve_name)


def apply_active_profile(data=None) -> dict:
    """Apply default profile using odin-power reload or stock governor+fan."""
    payload = data if data is not None else parse_power()
    name = payload["general"]["default_profile"]
    if name not in PROFILES:
        raise ValueError(f"invalid profile: {name}")
    profile = payload["profiles"][name]
    applied = {"profile": name, "backend": backend(), "governor": None, "fan": None}

    if odin_backend():
        result = run_cmd([str(POWER_SCRIPT), "reload"], timeout=15)
        if not result or result.returncode != 0:
            raise RuntimeError("power profile was saved but the power service reload failed")
        applied["backend"] = "odin-power"
        return applied

    gov = str(profile.get("cpu_governor") or "").strip()
    available = set(cpu_governors())
    if gov and gov in available:
        set_cpu_governor(gov)
        applied["governor"] = gov

    mode = resolve_qcom_mode(payload, str(profile.get("fan_curve") or ""))
    if mode and QCOM_FAN.is_file():
        if mode in ("off", "stop"):
            run_cmd([str(QCOM_FAN), "stop"], timeout=10)
        else:
            run_cmd([str(QCOM_FAN), mode], timeout=10)
        applied["fan"] = mode
    return applied


def apply_boot_defaults() -> None:
    """Best-effort boot apply for stock/odin power (never raises)."""
    try:
        if supported():
            apply_active_profile()
    except Exception:
        pass


def cycle_profile() -> str:
    """Advance eco→balanced→performance, persist default, apply. Returns new name."""
    data = parse_power()
    current = data["general"]["default_profile"]
    try:
        idx = PROFILES.index(current)
    except ValueError:
        idx = -1
    nxt = PROFILES[(idx + 1) % len(PROFILES)]
    data["general"]["default_profile"] = nxt
    # Persist only the default_profile override without full UI validation path.
    factory = factory_power_defaults()
    rendered = render_power(data, factory)
    atomically_write(POWER_CONFIG, rendered)
    apply_active_profile(data)
    return nxt


def save_power_config(data):
    if not supported():
        raise RuntimeError(unsupported_reason())
    if not isinstance(data, dict) or not isinstance(data.get("general"), dict):
        raise ValueError("invalid power config")
    data["general"]["default_profile"] = data["general"].get("default_profile", "")
    if data["general"]["default_profile"] not in PROFILES:
        raise ValueError("invalid power config")
    try:
        factory = factory_power_defaults()
        for name in PROFILES:
            profile = data["profiles"][name]
            cpu_max = float(profile["cpu_max"])
            gpu_min = float(profile["gpu_min"])
            gpu_max = float(profile["gpu_max"])
            if not all(math.isfinite(value) for value in (cpu_max, gpu_min, gpu_max)):
                raise ValueError("numeric values must be finite")
            if not 0.35 <= cpu_max <= 1.0:
                raise ValueError(f"{name} CPU maximum is outside 35-100%")
            if not 0.0 <= gpu_min <= gpu_max <= 1.0:
                raise ValueError(f"{name} GPU range is invalid")
            if profile["fan_curve"] not in factory["fan_curves"]:
                raise ValueError(f"{name} fan curve is invalid")
        rendered = render_power(data, factory)
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"malformed power config: {exc}")
    atomically_write(POWER_CONFIG, rendered)
    apply_active_profile(data)
