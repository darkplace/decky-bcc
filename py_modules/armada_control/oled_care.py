"""OLED care settings — brightness cap + idle dim (no pixel refresh).

Idle-dim via the legacy userdata host service is deferred. The Decky UI still
exposes the mostly-black screensaver when the Odin OLED backlight is present.
"""

from __future__ import annotations

import re
import subprocess
import threading
import time
from pathlib import Path

from .system import atomically_write, settings_set

CONFIG_PATH = Path("/userdata/system/configs/odin-oled-care/settings.conf")
STAMP_PATH = Path("/var/run/odin-oled-last-input")
BACKLIGHT = Path("/sys/class/backlight/ae94000.dsi.0")
CARE_SCRIPT = Path("/userdata/system/scripts/odin-oled-care.sh")
CARE_SERVICE = Path("/userdata/system/services/odin_oled_care")
_LOCK = threading.RLock()

# Host idle-dim (odin-oled-care.sh) is not shipped on stock images. Keep the
# integration code for a future stock-native implementation, but do not offer
# or start the userdata service until this flag is flipped.
IDLE_DIM_ENABLED = False

DEFAULTS: dict[str, int] = {
    "ENABLED": 1,
    "BRIGHTNESS_NORMAL": 70,
    "BRIGHTNESS_IDLE": 20,
    "IDLE_DIM_SECONDS": 180,
}

KEY_LABELS = {
    "ENABLED": "Enabled",
    "BRIGHTNESS_NORMAL": "Brightness (syncs with ES display setting)",
    "BRIGHTNESS_IDLE": "Idle brightness (%)",
    "IDLE_DIM_SECONDS": "Dim after idle (s)",
}


def _run(cmd: list[str], timeout: int = 20) -> str:
    try:
        result = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=timeout)
        return (result.stdout or result.stderr or "").strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def supported() -> bool:
    if not IDLE_DIM_ENABLED:
        return False
    return BACKLIGHT.is_dir() and CARE_SCRIPT.is_file() and CARE_SERVICE.is_file()


def unsupported_reason() -> str:
    if not IDLE_DIM_ENABLED:
        return (
            "Idle dim is deferred for a future stock-native implementation; "
            "use the OLED screensaver below"
        )
    if not BACKLIGHT.is_dir():
        return "OLED backlight was not detected"
    if not CARE_SCRIPT.is_file() or not CARE_SERVICE.is_file():
        return "OLED care service is not installed"
    return ""


def _user_brightness_pct() -> int:
    out = _run(["batocera-settings-get", "display.brightness"])
    match = re.search(r"(\d+)", out)
    if match:
        return max(10, min(100, int(match.group(1))))
    current = _current_brightness_pct()
    if current is not None and current > 25:
        return current
    return DEFAULTS["BRIGHTNESS_NORMAL"]


def _parse_conf() -> dict[str, int]:
    data = dict(DEFAULTS)
    if CONFIG_PATH.exists():
        try:
            for line in CONFIG_PATH.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                match = re.match(r"^([A-Z_]+)=(.+)$", line)
                if not match:
                    continue
                key, raw = match.group(1), match.group(2).strip().strip('"').strip("'")
                if key not in DEFAULTS or key == "BRIGHTNESS_NORMAL":
                    continue
                try:
                    data[key] = int(raw)
                except ValueError:
                    pass
        except OSError:
            pass
    data["BRIGHTNESS_NORMAL"] = _user_brightness_pct()
    return data


def _write_conf(data: dict[str, int]) -> dict[str, int]:
    merged = dict(DEFAULTS)
    for key in DEFAULTS:
        if key in data:
            try:
                merged[key] = int(data[key])
            except (TypeError, ValueError):
                pass
    merged["ENABLED"] = 1 if merged["ENABLED"] else 0
    merged["BRIGHTNESS_NORMAL"] = max(10, min(100, merged["BRIGHTNESS_NORMAL"]))
    merged["BRIGHTNESS_IDLE"] = max(5, min(80, merged["BRIGHTNESS_IDLE"]))
    merged["IDLE_DIM_SECONDS"] = max(30, min(3600, merged["IDLE_DIM_SECONDS"]))

    lines = ["# Odin 3 OLED care — idle dim only; normal brightness = display.brightness", ""]
    for key, value in merged.items():
        if key == "BRIGHTNESS_NORMAL":
            continue
        lines.append(f"{key}={value}")
    lines.append("")
    atomically_write(CONFIG_PATH, "\n".join(lines), 0o644)
    return merged


def _service_running() -> bool:
    out = _run(["pgrep", "-f", "odin-oled-care.sh start"])
    return bool(out)


def _monitor_running() -> bool:
    out = _run(["pgrep", "-f", "odin-oled-idle-monitor.py"])
    return bool(out)


def _idle_seconds() -> int:
    if not STAMP_PATH.exists():
        return 0
    try:
        raw = STAMP_PATH.read_text(encoding="utf-8").strip().split(".", 1)[0]
        last = int(raw)
    except (OSError, ValueError):
        return 0
    return max(0, int(time.time()) - last)


def _current_brightness_pct() -> int | None:
    out = _run(["batocera-brightness"])
    match = re.search(r"(\d+)", out)
    if match:
        return int(match.group(1))
    try:
        brightness = int((BACKLIGHT / "brightness").read_text().strip())
        maximum = int((BACKLIGHT / "max_brightness").read_text().strip())
        if maximum > 0:
            return int(brightness * 100 / maximum)
    except (OSError, ValueError):
        pass
    return None


def _apply_normal_brightness(pct: int) -> None:
    pct = max(10, min(100, pct))
    settings_set("display.brightness", str(pct))
    _run(["batocera-brightness", str(pct)])


def get_state() -> dict:
    with _LOCK:
        cfg = _parse_conf()
    return {
        "supported": supported(),
        "panelDetected": BACKLIGHT.is_dir(),
        "reason": unsupported_reason(),
        "config": cfg,
        "labels": KEY_LABELS,
        "runtime": {
            "serviceRunning": _service_running(),
            "monitorRunning": _monitor_running(),
            "idleSeconds": _idle_seconds(),
            "brightnessPct": _current_brightness_pct(),
        },
    }


def save_state(data: dict) -> dict:
    if not supported():
        raise RuntimeError(unsupported_reason())
    if not isinstance(data, dict):
        raise ValueError("OLED care settings must be an object")
    with _LOCK:
        merged = _write_conf(data)
        if merged["ENABLED"]:
            _run(["batocera-services", "enable", "odin_oled_care"])
            if not _service_running():
                _run(["batocera-services", "start", "odin_oled_care"])
            if "BRIGHTNESS_NORMAL" in data:
                _apply_normal_brightness(merged["BRIGHTNESS_NORMAL"])
            try:
                STAMP_PATH.write_text(str(int(time.time())), encoding="utf-8")
            except OSError:
                pass
            if not _service_running():
                raise RuntimeError("OLED care service did not start")
        else:
            _run(["batocera-services", "disable", "odin_oled_care"])
            _run(["batocera-services", "stop", "odin_oled_care"])
    return get_state()


def restart_service() -> dict:
    if not supported():
        raise RuntimeError(unsupported_reason())
    with _LOCK:
        _run(["batocera-services", "restart", "odin_oled_care"])
        if not _service_running():
            raise RuntimeError("OLED care service did not restart")
    return get_state()
