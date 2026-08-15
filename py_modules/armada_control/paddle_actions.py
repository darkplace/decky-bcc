"""Execute back-paddle shortcut actions on Batocera."""

from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

from .system import settings_set

try:
    import evdev
    from evdev import UInput, ecodes
except ImportError:
    evdev = None
    ecodes = None
    UInput = None

BRIGHTNESS_STATE = Path("/var/run/odin-brightness-saved")
FAN_MODE_STATE = Path("/var/run/odin-fan-mode-state")
GOVERNOR_STATE = Path("/var/run/odin-governor-cycle-state")
MANGOHUDCTL = Path("/usr/bin/mangohudctl")
QCOM_FAN = Path("/usr/bin/qcom-fan")
ODIN_POWER = Path("/userdata/system/scripts/odin-power")
CONTROLCENTER = Path("/usr/bin/batocera-controlcenter")
MOUSE_MODE = Path("/usr/bin/batocera-mouse-mode")
SCREENSHOT = Path("/usr/bin/batocera-screenshot")
RECORD = Path("/usr/bin/batocera-record")
CPUFREQ_ROOT = Path("/sys/devices/system/cpu")

ACTIONS = [
    ("none", "None"),
    ("control_center", "Batocera Control Center (host app)"),
    ("mouse_toggle", "Toggle mouse mode (pauses gamepad navigation)"),
    ("mouse_left", "Left click"),
    ("mouse_right", "Right click"),
    ("mouse_middle", "Middle click"),
    ("mangohud_toggle", "Toggle MangoHud"),
    ("keyboard_toggle", "Toggle on-screen keyboard"),
    ("mute_toggle", "Toggle mute"),
    ("brightness_min_toggle", "Toggle minimum brightness"),
    ("led_toggle", "Toggle joystick LEDs"),
    ("wifi_toggle", "Toggle Wi-Fi"),
    ("bluetooth_toggle", "Toggle Bluetooth"),
    ("fan_mode_cycle", "Cycle fan (silent/auto/aggressive/manual 50%/off)"),
    ("power_profile_cycle", "Cycle power (odin-power or CPU governor)"),
    ("screenshot", "Screenshot"),
    ("volume_up", "Volume up"),
    ("volume_down", "Volume down"),
    ("key_f1", "F1 key"),
    ("key_f2", "F2 key"),
    ("key_f3", "F3 key"),
    ("key_f4", "F4 key"),
    ("key_f5", "F5 key"),
    ("key_f6", "F6 key"),
    ("key_f7", "F7 key"),
    ("key_f8", "F8 key"),
    ("key_f9", "F9 key"),
    ("key_f10", "F10 key"),
    ("key_f11", "F11 key"),
    ("key_f12", "F12 key"),
    ("key_esc", "Esc key"),
    ("key_enter", "Enter key"),
    ("key_space", "Space key"),
    ("key_tab", "Tab key"),
]

DEFAULT_BINDINGS = {
    "m1": "none",
    "m2": "none",
    "m1_m2": "none",
    "m1_start": "none",
    "m1_back": "none",
    "select_m2": "none",
    "home_m2": "none",
}


def _run(cmd: list[str], timeout: int = 15) -> str:
    try:
        result = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=timeout)
        return (result.stdout or result.stderr or "").strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def _settings_get(key: str) -> str:
    return _run(["batocera-settings-get", key])


def _settings_set(key: str, value: str) -> None:
    settings_set(key, value)


def _uinput_ready() -> bool:
    return UInput is not None and ecodes is not None and Path("/dev/uinput").exists()


def _tap_key(code: int) -> None:
    """Inject a key/button via uinput only (no userdata helper scripts)."""
    if not _uinput_ready():
        return
    try:
        ui = UInput(name="odin-paddle-keys", events={ecodes.EV_KEY: [code]})
        time.sleep(0.08)
        ui.write(ecodes.EV_KEY, code, 1)
        ui.syn()
        time.sleep(0.05)
        ui.write(ecodes.EV_KEY, code, 0)
        ui.syn()
        ui.close()
    except OSError:
        return


def _chord_keys(codes: list[int]) -> None:
    if not _uinput_ready() or not codes:
        return
    try:
        ui = UInput(name="odin-paddle-keys", events={ecodes.EV_KEY: codes})
        time.sleep(0.05)
        for code in codes:
            ui.write(ecodes.EV_KEY, code, 1)
            ui.syn()
        time.sleep(0.05)
        for code in reversed(codes):
            ui.write(ecodes.EV_KEY, code, 0)
            ui.syn()
        ui.close()
    except OSError:
        return


MOUSE_BUTTONS: dict[str, int] = {}


def _build_mouse_buttons() -> dict[str, int]:
    if ecodes is None:
        return {}
    mapping = {}
    for name, attr in (
        ("mouse_left", "BTN_LEFT"),
        ("mouse_right", "BTN_RIGHT"),
        ("mouse_middle", "BTN_MIDDLE"),
    ):
        code = getattr(ecodes, attr, None)
        if code is not None:
            mapping[name] = code
    return mapping


MOUSE_BUTTONS = _build_mouse_buttons()


KEY_ACTIONS: dict[str, int] = {}


def _build_key_actions() -> dict[str, int]:
    if ecodes is None:
        return {}
    mapping = {}
    for i in range(1, 13):
        code = getattr(ecodes, f"KEY_F{i}", None)
        if code is not None:
            mapping[f"key_f{i}"] = code
    extras = {
        "key_esc": "KEY_ESC",
        "key_enter": "KEY_ENTER",
        "key_space": "KEY_SPACE",
        "key_tab": "KEY_TAB",
    }
    for name, attr in extras.items():
        code = getattr(ecodes, attr, None)
        if code is not None:
            mapping[name] = code
    return mapping


KEY_ACTIONS = _build_key_actions()


def _available_governors() -> list[str]:
    path = CPUFREQ_ROOT / "cpu0" / "cpufreq" / "scaling_available_governors"
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    preferred = ["powersave", "ondemand", "schedutil", "performance"]
    present = text.split()
    ordered = [name for name in preferred if name in present]
    for name in present:
        if name not in ordered:
            ordered.append(name)
    return ordered


def _current_governor() -> str:
    path = CPUFREQ_ROOT / "cpu0" / "cpufreq" / "scaling_governor"
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _set_governor(name: str) -> None:
    for cpu in CPUFREQ_ROOT.glob("cpu[0-9]*"):
        target = cpu / "cpufreq" / "scaling_governor"
        try:
            target.write_text(f"{name}\n", encoding="utf-8")
        except OSError:
            continue


def _cycle_stock_governor() -> str:
    governors = _available_governors()
    if not governors:
        return ""
    current = GOVERNOR_STATE.read_text(encoding="utf-8").strip() if GOVERNOR_STATE.exists() else _current_governor()
    try:
        idx = governors.index(current)
    except ValueError:
        idx = -1
    nxt = governors[(idx + 1) % len(governors)]
    try:
        GOVERNOR_STATE.write_text(nxt, encoding="utf-8")
    except OSError:
        pass
    _set_governor(nxt)
    return nxt


def resolve_action(action: str) -> dict:
    """Describe how a paddle action is executed and whether it can run now."""
    action = (action or "none").strip() or "none"
    labels = dict(ACTIONS)
    if action not in labels:
        return {
            "action": action,
            "available": False,
            "backend": "unknown",
            "command": [],
            "reason": f"unknown action: {action}",
        }
    if action == "none":
        return {"action": action, "available": True, "backend": "noop", "command": [], "reason": ""}

    if action == "control_center":
        ok = CONTROLCENTER.is_file()
        return {
            "action": action,
            "available": ok,
            "backend": "batocera-controlcenter",
            "command": [str(CONTROLCENTER)],
            "reason": "" if ok else "batocera-controlcenter is not installed",
        }
    if action == "mouse_toggle":
        ok = MOUSE_MODE.is_file()
        return {
            "action": action,
            "available": ok,
            "backend": "batocera-mouse-mode",
            "command": [str(MOUSE_MODE), "toggle"],
            "reason": "" if ok else "batocera-mouse-mode is not installed",
        }
    if action in MOUSE_BUTTONS:
        ok = _uinput_ready()
        return {
            "action": action,
            "available": ok,
            "backend": "uinput",
            "command": ["uinput", f"BTN={MOUSE_BUTTONS[action]}"],
            "reason": "" if ok else "python-evdev/uinput is unavailable",
        }
    if action == "mangohud_toggle":
        if MANGOHUDCTL.is_file():
            return {
                "action": action,
                "available": True,
                "backend": "mangohudctl",
                "command": [str(MANGOHUDCTL), "toggle", "no_display"],
                "reason": "",
            }
        ok = _uinput_ready() and ecodes is not None
        return {
            "action": action,
            "available": ok,
            "backend": "uinput-Shift_R+F12",
            "command": ["uinput", "KEY_RIGHTSHIFT+KEY_F12"],
            "reason": "" if ok else "mangohudctl and uinput are unavailable",
        }
    if action == "keyboard_toggle":
        ok = CONTROLCENTER.is_file()
        return {
            "action": action,
            "available": ok,
            "backend": "batocera-controlcenter",
            "command": [str(CONTROLCENTER), "keyboard"],
            "reason": "" if ok else "batocera-controlcenter is not installed",
        }
    if action == "mute_toggle":
        return {
            "action": action,
            "available": True,
            "backend": "batocera-audio",
            "command": ["batocera-audio", "setSystemVolume", "mute-toggle"],
            "reason": "",
        }
    if action in ("volume_up", "volume_down"):
        return {
            "action": action,
            "available": True,
            "backend": "batocera-audio",
            "command": ["batocera-audio", "setSystemVolume", "+10" if action == "volume_up" else "-10"],
            "reason": "",
        }
    if action == "brightness_min_toggle":
        return {
            "action": action,
            "available": True,
            "backend": "batocera-brightness",
            "command": ["batocera-brightness"],
            "reason": "",
        }
    if action == "led_toggle":
        return {
            "action": action,
            "available": True,
            "backend": "joystick_led",
            "command": ["armada_control.joystick_led.toggle"],
            "reason": "",
        }
    if action == "wifi_toggle":
        if Path("/usr/bin/nmcli").is_file():
            return {
                "action": action,
                "available": True,
                "backend": "nmcli",
                "command": ["nmcli", "radio", "wifi", "toggle"],
                "reason": "",
            }
        return {
            "action": action,
            "available": True,
            "backend": "batocera-wifi",
            "command": ["batocera-wifi", "enable|disable"],
            "reason": "",
        }
    if action == "bluetooth_toggle":
        return {
            "action": action,
            "available": True,
            "backend": "batocera-bluetooth",
            "command": ["batocera-bluetooth", "enable|disable"],
            "reason": "",
        }
    if action == "fan_mode_cycle":
        if QCOM_FAN.is_file():
            return {
                "action": action,
                "available": True,
                "backend": "qcom-fan",
                "command": [str(QCOM_FAN), "silent|auto|aggressive|set 50|stop"],
                "reason": "",
            }
        if ODIN_POWER.is_file():
            return {
                "action": action,
                "available": True,
                "backend": "odin-power",
                "command": [str(ODIN_POWER), "fan", "cycle"],
                "reason": "",
            }
        return {
            "action": action,
            "available": False,
            "backend": "none",
            "command": [],
            "reason": "neither qcom-fan nor odin-power is installed",
        }
    if action == "power_profile_cycle":
        if ODIN_POWER.is_file():
            return {
                "action": action,
                "available": True,
                "backend": "odin-power",
                "command": [str(ODIN_POWER), "profile", "cycle"],
                "reason": "",
            }
        governors = _available_governors()
        if governors:
            return {
                "action": action,
                "available": True,
                "backend": "cpufreq-governor",
                "command": ["sysfs", "scaling_governor", "|".join(governors)],
                "reason": "",
            }
        return {
            "action": action,
            "available": False,
            "backend": "none",
            "command": [],
            "reason": "odin-power missing and no CPU governors exposed",
        }
    if action == "screenshot":
        if SCREENSHOT.is_file():
            return {
                "action": action,
                "available": True,
                "backend": "batocera-screenshot",
                "command": [str(SCREENSHOT)],
                "reason": "",
            }
        if RECORD.is_file():
            return {
                "action": action,
                "available": True,
                "backend": "batocera-record",
                "command": [str(RECORD), "screenshot"],
                "reason": "",
            }
        return {
            "action": action,
            "available": False,
            "backend": "none",
            "command": [],
            "reason": "screenshot helper is not installed",
        }
    if action in KEY_ACTIONS or action.startswith("key_"):
        ok = _uinput_ready() and action in KEY_ACTIONS
        return {
            "action": action,
            "available": ok,
            "backend": "uinput",
            "command": ["uinput", f"KEY={KEY_ACTIONS.get(action, action)}"],
            "reason": "" if ok else "python-evdev/uinput is unavailable",
        }
    if action in MOUSE_BUTTONS or action in ("mouse_left", "mouse_right", "mouse_middle"):
        ok = _uinput_ready() and action in MOUSE_BUTTONS
        return {
            "action": action,
            "available": ok,
            "backend": "uinput",
            "command": ["uinput", f"BTN={MOUSE_BUTTONS.get(action, action)}"],
            "reason": "" if ok else "python-evdev/uinput is unavailable",
        }
    return {
        "action": action,
        "available": False,
        "backend": "unimplemented",
        "command": [],
        "reason": "action has no resolver",
    }


def action_available(action: str) -> bool:
    return bool(resolve_action(action).get("available"))


def binding_health(bindings: dict) -> dict[str, dict]:
    """Map each paddle slot to its resolved command health."""
    out: dict[str, dict] = {}
    for slot, action in (bindings or {}).items():
        info = resolve_action(str(action or "none"))
        out[str(slot)] = info
    return out


def action_choices(include: set[str] | None = None) -> list[dict[str, str]]:
    """Dropdown entries: always-available actions plus currently bound ones."""
    keep = set(include or ())
    choices = []
    for key, label in ACTIONS:
        if key == "none" or key in keep or action_available(key):
            choices.append({"data": key, "label": label})
    return choices


def run_action(action: str) -> None:
    action = (action or "none").strip()
    if not action or action == "none":
        return
    if action not in {key for key, _label in ACTIONS}:
        return

    if action == "control_center":
        _run([str(CONTROLCENTER)])
        return

    if action == "mouse_toggle":
        _run([str(MOUSE_MODE), "toggle"])
        return

    if action == "mangohud_toggle":
        if MANGOHUDCTL.is_file():
            _run([str(MANGOHUDCTL), "toggle", "no_display"])
            return
        if ecodes is not None:
            shift = getattr(ecodes, "KEY_RIGHTSHIFT", None)
            f12 = getattr(ecodes, "KEY_F12", None)
            if shift is not None and f12 is not None:
                _chord_keys([shift, f12])
        return

    if action == "keyboard_toggle":
        out = _run([str(CONTROLCENTER), "keyboard"])
        if not out or "Usage" in out or "error" in out.lower():
            _run([str(CONTROLCENTER), "virtualkeyboard"])
        return

    if action == "mute_toggle":
        _run(["batocera-audio", "setSystemVolume", "mute-toggle"])
        return

    if action == "volume_up":
        vol = _run(["batocera-audio", "getSystemVolume"])
        match = re.search(r"(\d+)", vol)
        current = int(match.group(1)) if match else 50
        _run(["batocera-audio", "setSystemVolume", str(min(100, current + 10))])
        return

    if action == "volume_down":
        vol = _run(["batocera-audio", "getSystemVolume"])
        match = re.search(r"(\d+)", vol)
        current = int(match.group(1)) if match else 50
        _run(["batocera-audio", "setSystemVolume", str(max(0, current - 10))])
        return

    if action == "brightness_min_toggle":
        current = _run(["batocera-brightness"])
        match = re.search(r"(\d+)", current)
        pct = int(match.group(1)) if match else 70
        if BRIGHTNESS_STATE.exists():
            try:
                saved = int(BRIGHTNESS_STATE.read_text(encoding="utf-8").strip() or "70")
            except (OSError, ValueError):
                saved = 70
            saved = max(10, min(100, saved))
            _run(["batocera-brightness", str(saved)])
            BRIGHTNESS_STATE.unlink(missing_ok=True)
        else:
            BRIGHTNESS_STATE.write_text(str(max(10, min(100, pct))), encoding="utf-8")
            _run(["batocera-brightness", "10"])
        return

    if action == "led_toggle":
        # Accent-only toggle: never disable or zero the battery/status LED.
        from .joystick_led import toggle

        toggle()
        return

    if action == "wifi_toggle":
        if Path("/usr/bin/nmcli").exists():
            state = _run(["nmcli", "-t", "-f", "WIFI", "radio", "wifi"]).lower()
            _run(["nmcli", "radio", "wifi", "off" if state == "enabled" else "on"])
        else:
            enabled = _settings_get("wifi.enabled") == "1"
            _run(["batocera-wifi", "disable" if enabled else "enable"])
        return

    if action == "bluetooth_toggle":
        enabled = _settings_get("controllers.bluetooth.enabled") == "1"
        _run(["batocera-bluetooth", "disable" if enabled else "enable"])
        return

    if action == "fan_mode_cycle":
        # Prefer native qcom-fan curves when available (stock Batocera image).
        # Fall back to maintainer userdata odin-power PWM presets when present.
        if QCOM_FAN.is_file():
            order = ["silent", "auto", "aggressive", "50", "off"]
            current = FAN_MODE_STATE.read_text(encoding="utf-8").strip() if FAN_MODE_STATE.exists() else "auto"
            try:
                idx = order.index(current)
            except ValueError:
                idx = -1
            nxt = order[(idx + 1) % len(order)]
            FAN_MODE_STATE.write_text(nxt, encoding="utf-8")
            if nxt == "50":
                _run([str(QCOM_FAN), "set", "50"])
            elif nxt == "off":
                _run([str(QCOM_FAN), "stop"])
            else:
                _run([str(QCOM_FAN), nxt])
            return
        if ODIN_POWER.is_file():
            order = ["255", "128", "0", "auto"]
            current = FAN_MODE_STATE.read_text(encoding="utf-8").strip() if FAN_MODE_STATE.exists() else "auto"
            try:
                idx = order.index(current)
            except ValueError:
                idx = -1
            nxt = order[(idx + 1) % len(order)]
            if nxt == "auto":
                FAN_MODE_STATE.unlink(missing_ok=True)
            else:
                FAN_MODE_STATE.write_text(nxt, encoding="utf-8")
            _run([str(ODIN_POWER), "fan", nxt])
        return

    if action == "power_profile_cycle":
        if ODIN_POWER.is_file():
            _run([str(ODIN_POWER), "profile", "cycle"])
            return
        _cycle_stock_governor()
        return

    if action == "screenshot":
        if SCREENSHOT.exists():
            _run([str(SCREENSHOT)])
        else:
            _run([str(RECORD), "screenshot"])
        return

    if action in KEY_ACTIONS:
        _tap_key(KEY_ACTIONS[action])
        return

    if action in MOUSE_BUTTONS:
        _tap_key(MOUSE_BUTTONS[action])
        return
