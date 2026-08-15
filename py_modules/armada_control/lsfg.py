"""Batocera-native LSFG-VK controls.

This module configures the LSFG layer already built into Batocera. It never
downloads a Vulkan layer or copies the proprietary Lossless.dll.
"""

from __future__ import annotations

import json
import os
import platform
import shlex
import threading
from pathlib import Path

from .system import atomically_write, run_cmd, settings_set_many

DEFAULT_DLL = Path("/userdata/system/wine/lossless-scaling/Lossless.dll")
NATIVE_LIBRARY = Path("/usr/lib/liblsfg-vk.so")
NATIVE_LAYER = Path("/usr/share/vulkan/explicit_layer.d/VkLayer_LS_frame_generation.json")
WINE_LIBRARY = Path("/usr/wine/lsfg-vk/x64/lib/liblsfg-vk.so")
WINE_LAYER = Path("/usr/wine/lsfg-vk/x64/share/vulkan/explicit_layer.d/VkLayer_LS_frame_generation.json")
LEGACY_PLUGIN = Path("/userdata/system/homebrew/plugins/decky-lsfg-vk")
LEGACY_CONFIG = Path("/userdata/system/.config/lsfg-vk/conf.toml")
LEGACY_SCRIPTS = (
    Path("/userdata/system/lsfg"),
    Path("/home/deck/lsfg"),
    Path("/root/lsfg"),
)
BUNDLED_WRAPPER = Path(__file__).resolve().parent.parent / "batocera-control-lsfg-launch"
STABLE_WRAPPER = Path("/userdata/system/bin/batocera-control-lsfg-launch")
RUNTIME_CONFIG = Path("/userdata/system/configs/batocera-control/lsfg.json")
RUNTIME_ENV = Path("/userdata/system/configs/batocera-control/lsfg.env")

SETTINGS_GET = "/usr/bin/batocera-settings-get"
PREFIX = "steam"
_LOCK = threading.RLock()

MULTIPLIERS = {"2", "3", "4"}
FLOW_SCALES = {"1.0", "0.75", "0.5", "0.25"}
PRESENT_MODES = {"", "fifo", "vsync", "mailbox", "immediate"}
_RUNTIME_VERSION = 1


def _key(name: str) -> str:
    return f"{PREFIX}.{name}"


def _get(name: str) -> str:
    result = run_cmd([SETTINGS_GET, _key(name)])
    if not result or result.returncode != 0:
        return ""
    return result.stdout.strip()


def _set_many(values: list[tuple[str, str]]) -> None:
    settings_set_many([(_key(name), value) for name, value in values])


def _is_arm() -> bool:
    # FEX can present an x86 personality to a process on ARM. The native layer
    # location is a reliable Batocera-side signal in that case.
    return platform.machine().lower() in {"aarch64", "arm64"} or NATIVE_LIBRARY.is_file()


def _bool(raw: str, default=False) -> bool:
    if not raw:
        return default
    return raw.strip().lower() in {"1", "true", "on", "enabled", "yes"}


def _layers() -> dict[str, bool]:
    return {
        "native": NATIVE_LIBRARY.is_file() and NATIVE_LAYER.is_file(),
        "x64": WINE_LIBRARY.is_file() and WINE_LAYER.is_file(),
    }


def _load_runtime() -> dict[str, object]:
    default: dict[str, object] = {"version": _RUNTIME_VERSION, "enabledAppids": []}
    try:
        data = json.loads(RUNTIME_CONFIG.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default
    if not isinstance(data, dict):
        return default
    raw_appids = data.get("enabledAppids", [])
    if not isinstance(raw_appids, list):
        raw_appids = []
    appids = sorted(
        {str(appid) for appid in raw_appids if str(appid).isdigit() and int(str(appid)) > 0},
        key=int,
    )
    return {"version": _RUNTIME_VERSION, "enabledAppids": appids}


def _layer_root() -> Path | None:
    # Steam and Proton are x86_64 even on ARM/FEX, so prefer the Wine layer.
    if WINE_LIBRARY.is_file() and WINE_LAYER.is_file():
        return WINE_LIBRARY.parent.parent
    if NATIVE_LIBRARY.is_file() and NATIVE_LAYER.is_file():
        return Path("/usr")
    return None


def _ensure_wrapper() -> bool:
    try:
        text = BUNDLED_WRAPPER.read_text(encoding="utf-8")
        if "BATOCERA_CONTROL_LSFG_LAUNCH" not in text:
            raise ValueError("bundled LSFG launch helper is invalid")
        try:
            unchanged = STABLE_WRAPPER.read_text(encoding="utf-8") == text
        except OSError:
            unchanged = False
        if not unchanged or not os.access(STABLE_WRAPPER, os.X_OK):
            atomically_write(STABLE_WRAPPER, text, 0o755)
        return os.access(STABLE_WRAPPER, os.X_OK)
    except (OSError, ValueError):
        return False


def _write_runtime(runtime: dict[str, object], config: dict[str, object]) -> None:
    appids = list(runtime.get("enabledAppids", []))
    payload = {"version": _RUNTIME_VERSION, "enabledAppids": appids}
    atomically_write(RUNTIME_CONFIG, json.dumps(payload, indent=2, sort_keys=True) + "\n", 0o600)

    root = _layer_root()
    values = {
        "BATOCERA_LSFG_ENABLED_APPIDS": " ".join(str(appid) for appid in appids),
        "BATOCERA_LSFG_LAYER_ROOT": str(root or ""),
        "BATOCERA_LSFG_PRESENT_MODE": str(config.get("presentMode", "")),
        "LSFG_DLL_PATH": str(DEFAULT_DLL),
        "LSFG_MULTIPLIER": str(config.get("multiplier", "2")),
        "LSFG_FLOW_SCALE": str(config.get("flowScale", "0.75" if _is_arm() else "1.0")),
        "LSFG_PERFORMANCE_MODE": "1" if config.get("performanceMode", _is_arm()) else "0",
        "LSFG_HDR_MODE": "1" if config.get("hdrMode", False) else "0",
    }
    lines = ["# Generated by Batocera Control; read by batocera-control-lsfg-launch."]
    lines.extend(f"{name}={shlex.quote(value)}" for name, value in values.items())
    # Steam games run as the Batocera desktop user while Decky's backend runs
    # as root. The file contains only validated scalar settings and must be
    # readable by the per-game wrapper, but remains root-owned and non-writable.
    atomically_write(RUNTIME_ENV, "\n".join(lines) + "\n", 0o644)


def _config() -> dict[str, object]:
    multiplier = _get("lsfg_vk_multiplier") or "2"
    flow_scale = _get("lsfg_vk_flow_scale") or ("0.75" if _is_arm() else "1.0")
    present_mode = _get("lsfg_vk_present_mode")
    return {
        "enabled": _bool(_get("lsfg_vk"), False),
        "multiplier": multiplier if multiplier in MULTIPLIERS else "2",
        "flowScale": flow_scale if flow_scale in FLOW_SCALES else ("0.75" if _is_arm() else "1.0"),
        "performanceMode": _bool(_get("lsfg_vk_performance"), _is_arm()),
        "hdrMode": _bool(_get("lsfg_vk_hdr"), False),
        "presentMode": present_mode if present_mode in PRESENT_MODES else "",
    }


def get_state() -> dict[str, object]:
    with _LOCK:
        layers = _layers()
        dll_detected = DEFAULT_DLL.is_file()
        supported = layers["native"] or layers["x64"]
        config = _config()
        runtime = _load_runtime()
        wrapper_ready = _ensure_wrapper()
        runtime_error = ""
        try:
            _write_runtime(runtime, config)
        except OSError as exc:
            runtime_error = str(exc)
            wrapper_ready = False
    reason = "" if supported else "The Batocera LSFG-VK Vulkan layer is not installed in this image"
    if supported and not wrapper_ready:
        reason = runtime_error or "The persistent per-game LSFG launch helper could not be installed"
    return {
        "supported": supported,
        "reason": reason,
        "ready": supported and dll_detected,
        "perGameSupported": supported and wrapper_ready,
        "dllDetected": dll_detected,
        "dllPath": str(DEFAULT_DLL),
        "layers": layers,
        "config": config,
        "enabledAppids": list(runtime["enabledAppids"]),
        "wrapperPath": str(STABLE_WRAPPER) if wrapper_ready else "",
        "legacyPluginDetected": LEGACY_PLUGIN.is_dir(),
        "legacyConfigDetected": LEGACY_CONFIG.is_file(),
        "legacyLaunchScriptDetected": any(path.is_file() for path in LEGACY_SCRIPTS),
        "appliesOnNextSteamLaunch": True,
        "perGameAppliesOnNextGameLaunch": True,
    }


def _sanitize(data: object) -> dict[str, object]:
    if not isinstance(data, dict):
        raise ValueError("LSFG-VK settings must be an object")
    multiplier = str(data.get("multiplier", "2"))
    flow_scale = str(data.get("flowScale", "0.75" if _is_arm() else "1.0"))
    present_mode = str(data.get("presentMode", ""))
    if multiplier not in MULTIPLIERS:
        raise ValueError("LSFG-VK multiplier must be 2x, 3x, or 4x")
    if flow_scale not in FLOW_SCALES:
        raise ValueError("LSFG-VK flow scale is invalid")
    if present_mode not in PRESENT_MODES:
        raise ValueError("LSFG-VK present mode is invalid")
    for name in ("enabled", "performanceMode", "hdrMode"):
        if name in data and not isinstance(data[name], bool):
            raise ValueError(f"LSFG-VK {name} must be a boolean")
    return {
        "enabled": bool(data.get("enabled", False)),
        "multiplier": multiplier,
        "flowScale": flow_scale,
        "performanceMode": bool(data.get("performanceMode", _is_arm())),
        "hdrMode": bool(data.get("hdrMode", False)),
        "presentMode": present_mode,
    }


def save_state(data: object) -> dict[str, object]:
    clean = _sanitize(data)
    with _LOCK:
        state = get_state()
        if clean["enabled"] and not state["supported"]:
            raise RuntimeError(str(state["reason"]))
        if clean["enabled"] and not state["dllDetected"]:
            raise RuntimeError(f"Lossless.dll was not found at {DEFAULT_DLL}")

        desired = {
            "lsfg_vk_dll": str(DEFAULT_DLL),
            "lsfg_vk_multiplier": str(clean["multiplier"]),
            "lsfg_vk_flow_scale": str(clean["flowScale"]),
            "lsfg_vk_performance": "1" if clean["performanceMode"] else "0",
            "lsfg_vk_hdr": "1" if clean["hdrMode"] else "0",
            "lsfg_vk_present_mode": str(clean["presentMode"]),
            # Enable last so a partially written configuration can never activate.
            "lsfg_vk": "1" if clean["enabled"] else "0",
        }
        previous: dict[str, str] = {}
        changed: list[tuple[str, str]] = []
        try:
            for name, value in desired.items():
                current = _get(name)
                previous[name] = current
                if current == value:
                    continue
                changed.append((name, value))
            # mini_settings accepts multiple key/value pairs and rewrites the
            # config once. This avoids seven independent batocera.conf writes.
            _set_many(changed)
            if not _ensure_wrapper():
                raise RuntimeError("failed to install the persistent per-game LSFG launch helper")
            _write_runtime(_load_runtime(), clean)
        except Exception:
            try:
                _set_many([(name, previous[name]) for name, _value in changed])
            except Exception:
                pass
            raise

    return get_state()


def _normalize_steam_appid(appid: object) -> str:
    """Steam UI may pass signed Non-Steam ids; LSFG/SteamLaunch use unsigned."""
    text = str(appid).strip()
    if not text:
        raise ValueError("Steam app ID must be a positive integer")
    try:
        value = int(text)
    except ValueError as exc:
        raise ValueError("Steam app ID must be a positive integer") from exc
    unsigned = value & 0xFFFFFFFF
    if unsigned == 0:
        raise ValueError("Steam app ID must be a positive integer")
    return str(unsigned)


def set_game_enabled(appid: object, enabled: object) -> dict[str, object]:
    appid = _normalize_steam_appid(appid)
    if not isinstance(enabled, bool):
        raise ValueError("per-game LSFG enabled state must be a boolean")

    with _LOCK:
        runtime = _load_runtime()
        appids = set(str(value) for value in runtime["enabledAppids"])
        if enabled:
            state = get_state()
            if not state["ready"]:
                raise RuntimeError(str(state["reason"] or f"Lossless.dll was not found at {DEFAULT_DLL}"))
            if not state["perGameSupported"]:
                raise RuntimeError(str(state["reason"]))
            appids.add(appid)
        else:
            appids.discard(appid)

        runtime["enabledAppids"] = sorted(appids, key=int)
        if not _ensure_wrapper() and enabled:
            raise RuntimeError("failed to install the persistent per-game LSFG launch helper")
        _write_runtime(runtime, _config())

    return get_state()
