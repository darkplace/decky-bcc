"""Back-paddle discovery and binding config for Batocera Control."""

from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path

from .es_paddle_hotkeys import merge_es_bindings, write_es_paddle_actions
from .paddle_actions import ACTIONS, DEFAULT_BINDINGS, action_choices, binding_health
from .system import atomically_write, run_cmd

try:
    import evdev
    from evdev import ecodes
except ImportError:
    evdev = None
    ecodes = None

CONFIG_PATH = Path("/userdata/system/configs/batocera-control/back-paddles.json")
INPUT_SYSFS = Path("/sys/class/input")

# Current Odin 3 kernels expose the rear buttons through rsinput. Keep these
# append-only codes in sync with the kernel and configgen mappings.
RSINPUT_M1_CODE = 710  # BTN_TRIGGER_HAPPY7, left rear paddle
RSINPUT_M2_CODE = 708  # BTN_TRIGGER_HAPPY5, right rear paddle
RSINPUT_REQUIRED_CODES = frozenset((RSINPUT_M1_CODE, RSINPUT_M2_CODE))
RSINPUT_SERVICE_NAME = "batocera_control_paddles"
RSINPUT_SERVICE = Path(f"/userdata/system/services/{RSINPUT_SERVICE_NAME}")
RSINPUT_PIDFILE = Path("/var/run/batocera-control-paddles.pid")

# Legacy patched images read the two GPIO lines directly. They remain
# supported so installing a new plugin does not regress an older image.
LEGACY_GPIO_CHIP = Path("/dev/gpiochip8")
LEGACY_SERVICE_NAME = "odin_backpaddles"
LEGACY_SERVICE = Path(f"/userdata/system/services/{LEGACY_SERVICE_NAME}")

_LOCK = threading.RLock()
_VALID_ACTIONS = {key for key, _label in ACTIONS}
CONFIG_VERSION = 2
# 0.2.6/0.2.7 unintentionally enabled mouse mode on every fresh install.
# Recognize that exact unversioned preset so upgrades become safe without
# overriding a later, explicitly saved mouse-mode binding.
LEGACY_UNSAFE_DEFAULT_BINDINGS = {
    "m1": "control_center",
    "m2": "mouse_toggle",
    "m1_m2": "mangohud_toggle",
    "m1_start": "none",
    "m1_back": "none",
    "select_m2": "none",
    "home_m2": "none",
}
# 0.2.8/0.2.9 still assigned two surprising host actions on a fresh install.
# Migrate only the exact unversioned preset; versioned files may represent an
# intentional user choice and must be preserved.
LEGACY_UNVERSIONED_ACTIVE_DEFAULT_BINDINGS = {
    "m1": "control_center",
    "m2": "none",
    "m1_m2": "mangohud_toggle",
    "m1_start": "none",
    "m1_back": "none",
    "select_m2": "none",
    "home_m2": "none",
}
SLOTS = [
    ("m1", "M1 / left paddle (tap)"),
    ("m2", "M2 / right paddle (tap)"),
    ("m1_m2", "M1 + M2"),
    ("m1_start", "M1 + Start"),
    ("m1_back", "M1 + Back"),
    ("select_m2", "Select + M2"),
    ("home_m2", "Home / Hotkey + M2"),
]


def _normalize(data: dict | None, *, strict=False) -> dict:
    merged = dict(DEFAULT_BINDINGS)
    if not isinstance(data, dict):
        if strict:
            raise ValueError("back-paddle bindings must be an object")
        return merged
    for key, _label in SLOTS:
        value = str(data.get(key, merged.get(key, "none")) or "none")
        if value not in _VALID_ACTIONS:
            if strict:
                raise ValueError(f"invalid action for {key}: {value}")
            value = merged.get(key, "none")
        merged[key] = value
    return merged


def _extract_bindings(data: dict | None) -> dict | None:
    """Accept {bindings:{...}} from disk or flat {m1:...} from Decky."""
    if not isinstance(data, dict):
        return None
    nested = data.get("bindings")
    if isinstance(nested, dict):
        return nested
    if any(key in data for key, _label in SLOTS):
        return data
    return None


def _payload_version(data: object) -> int:
    if not isinstance(data, dict):
        return 0
    try:
        return int(data.get("version", 0) or 0)
    except (TypeError, ValueError):
        return 0


def _migrate_unversioned_defaults(payload: object, bindings: dict) -> dict:
    if _payload_version(payload) != 0:
        return bindings
    if bindings in (LEGACY_UNSAFE_DEFAULT_BINDINGS, LEGACY_UNVERSIONED_ACTIVE_DEFAULT_BINDINGS):
        return dict(DEFAULT_BINDINGS)
    return bindings


def load_bindings() -> dict:
    if not CONFIG_PATH.exists():
        return merge_es_bindings(dict(DEFAULT_BINDINGS))
    try:
        payload = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return merge_es_bindings(dict(DEFAULT_BINDINGS))
    bindings = _normalize(_extract_bindings(payload))
    return merge_es_bindings(_migrate_unversioned_defaults(payload, bindings))


def _event_sort_key(path: Path) -> tuple[int, str]:
    match = re.search(r"(\d+)$", path.name)
    return (int(match.group(1)) if match else 1 << 30, path.name)


def _input_candidates() -> list[Path]:
    override = os.environ.get("BATOCERA_CONTROL_PADDLE_DEVICE", "").strip()
    if override:
        return [Path(override)]
    return sorted(Path("/dev/input").glob("event*"), key=_event_sort_key)


def _bitmap_has_codes(text: str, codes: frozenset[int]) -> bool:
    """Read Linux input capability bitmaps without a native evdev module.

    Sysfs prints the most-significant machine word first and omits leading
    zeroes inside each word. Batocera currently uses 64-bit kernels, while the
    32-bit fallback keeps this parser correct for older images too.
    """
    try:
        words = [int(token, 16) for token in text.split()]
    except ValueError:
        return False
    if not words:
        return False
    for word_bits in (64, 32):
        if all(
            code // word_bits < len(words)
            and words[-1 - (code // word_bits)] & (1 << (code % word_bits))
            for code in codes
        ):
            return True
    return False


def _sysfs_rsinput_device_info(path: Path) -> dict | None:
    """Identify the AYN paddle event node using architecture-neutral sysfs."""
    event_name = path.resolve(strict=False).name
    device = INPUT_SYSFS / event_name / "device"
    try:
        name = (device / "name").read_text(encoding="utf-8").strip()
        vendor = int((device / "id/vendor").read_text(encoding="ascii").strip(), 16)
        keys = (device / "capabilities/key").read_text(encoding="ascii")
    except (OSError, ValueError):
        return None

    override = bool(os.environ.get("BATOCERA_CONTROL_PADDLE_DEVICE", "").strip())
    is_ayn = name.casefold().startswith("ayn ") or vendor == 0x2020
    if not _bitmap_has_codes(keys, RSINPUT_REQUIRED_CODES) or not (is_ayn or override):
        return None
    return {
        "name": name or "AYN gamepad",
        "path": str(path),
        "m1Code": RSINPUT_M1_CODE,
        "m2Code": RSINPUT_M2_CODE,
    }


def open_rsinput_device():
    """Open the AYN controller carrying both rsinput paddle events."""
    if evdev is None or ecodes is None:
        return None
    override = bool(os.environ.get("BATOCERA_CONTROL_PADDLE_DEVICE", "").strip())
    for path in _input_candidates():
        try:
            device = evdev.InputDevice(str(path))
            keys = set(device.capabilities().get(ecodes.EV_KEY, []))
            name = str(getattr(device, "name", "") or "")
            info = getattr(device, "info", None)
            vendor = int(getattr(info, "vendor", 0) or 0)
            is_ayn = name.casefold().startswith("ayn ") or vendor == 0x2020
            if RSINPUT_REQUIRED_CODES.issubset(keys) and (is_ayn or override):
                return device
            device.close()
        except (OSError, ValueError):
            continue
    return None


def rsinput_device_info() -> dict | None:
    # Decky Loader and its plugin backend are x86 binaries under FEX on ARM
    # Batocera. They cannot import the native ARM python-evdev extension, so
    # use sysfs for the read-only UI/support probe. The native listener still
    # opens the device through evdev below.
    for path in _input_candidates():
        info = _sysfs_rsinput_device_info(path)
        if info is not None:
            return info

    # Retain the evdev fallback for test environments and kernels that do not
    # publish the standard sysfs capability files.
    device = open_rsinput_device()
    if device is None:
        return None
    try:
        return {
            "name": str(getattr(device, "name", "") or "AYN gamepad"),
            "path": str(getattr(device, "path", "") or ""),
            "m1Code": RSINPUT_M1_CODE,
            "m2Code": RSINPUT_M2_CODE,
        }
    finally:
        device.close()


def _detect_backend() -> dict:
    info = rsinput_device_info()
    if info is not None:
        reason = "" if RSINPUT_SERVICE.is_file() else "Batocera Control rsinput paddle service is not installed"
        return {
            "source": "rsinput",
            "device": info,
            "service": RSINPUT_SERVICE,
            "service_name": RSINPUT_SERVICE_NAME,
            "reason": reason,
        }
    if LEGACY_GPIO_CHIP.exists():
        reason = "" if LEGACY_SERVICE.is_file() else "Legacy back-paddle service is not installed"
        return {
            "source": "gpio",
            "device": {"name": "Legacy Odin GPIO paddles", "path": str(LEGACY_GPIO_CHIP)},
            "service": LEGACY_SERVICE,
            "service_name": LEGACY_SERVICE_NAME,
            "reason": reason,
        }
    reason = "AYN rsinput paddle events were not detected"
    if evdev is None:
        reason = "Python evdev support is unavailable"
    return {"source": "", "device": {}, "service": None, "service_name": "", "reason": reason}


def _pid_running(pidfile: Path) -> bool:
    try:
        pid = int(pidfile.read_text(encoding="utf-8").strip())
        os.kill(pid, 0)
        cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ")
        return b"armada_control.paddle_daemon" in cmdline
    except (OSError, ValueError):
        return False


def _backend_running(backend: dict) -> bool:
    if backend.get("source") == "rsinput":
        return _pid_running(RSINPUT_PIDFILE)
    if backend.get("source") == "gpio":
        active = run_cmd(["pgrep", "-f", "[/]userdata/system/scripts/odin-backpaddles.py"])
        return bool(active and active.returncode == 0)
    return False


def get_state() -> dict:
    warning = ""
    if CONFIG_PATH.exists():
        try:
            payload = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            bindings = _normalize(_extract_bindings(payload))
            bindings = _migrate_unversioned_defaults(payload, bindings)
        except (OSError, json.JSONDecodeError):
            bindings = dict(DEFAULT_BINDINGS)
            warning = "Bindings file is malformed; defaults are shown"
    else:
        bindings = dict(DEFAULT_BINDINGS)
    bindings = merge_es_bindings(bindings)

    backend = _detect_backend()
    reason = str(backend.get("reason") or "")
    running = _backend_running(backend) if not reason else False
    if not reason and not running:
        warning = "; ".join(filter(None, (warning, "Paddle listener is stopped; saving a binding will restart it")))
    health = binding_health(bindings)
    broken = [
        f"{slot}→{info['action']} ({info.get('reason') or 'unavailable'})"
        for slot, info in health.items()
        if info.get("action") not in (None, "none") and not info.get("available")
    ]
    if broken:
        warning = "; ".join(filter(None, (warning, "Unavailable bindings: " + ", ".join(broken))))
    return {
        "supported": not reason,
        "reason": reason,
        "warning": warning,
        "source": backend.get("source", ""),
        "device": backend.get("device", {}),
        "serviceRunning": running,
        "bindings": bindings,
        "bindingHealth": health,
        "slots": [{"data": key, "label": label} for key, label in SLOTS],
        "actions": action_choices(set(bindings.values())),
    }


def save_state(data: dict) -> dict:
    backend = _detect_backend()
    if backend.get("reason"):
        raise RuntimeError(str(backend["reason"]))
    bindings = _normalize(_extract_bindings(data), strict=True)
    with _LOCK:
        atomically_write(
            CONFIG_PATH,
            json.dumps({"version": CONFIG_VERSION, "bindings": bindings}, indent=2, sort_keys=True) + "\n",
            0o644,
        )
        try:
            write_es_paddle_actions(bindings)
        except (OSError, TypeError, ValueError):
            pass
        _restart_daemon(backend)
    return get_state()


def _restart_daemon(backend: dict | None = None) -> None:
    backend = backend or _detect_backend()
    service = backend.get("service")
    service_name = str(backend.get("service_name") or "")
    if not isinstance(service, Path) or not service.is_file() or not service_name:
        raise RuntimeError("back-paddle service is not installed")

    result = run_cmd(["batocera-services", "restart", service_name], timeout=15)
    if not result or result.returncode != 0:
        result = run_cmd([str(service), "restart"], timeout=15)
    running = False
    if result and result.returncode == 0:
        for _attempt in range(20):
            if _backend_running(backend):
                running = True
                break
            threading.Event().wait(0.1)
    if not result or result.returncode != 0 or not running:
        raise RuntimeError("failed to start the back-paddle service")
