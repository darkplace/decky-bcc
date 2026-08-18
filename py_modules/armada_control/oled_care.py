"""OLED Screen Protection — sync with batocera-oled-care / display.oledcare*.

Mirrors AYN OdinSettings:
  OLED Screen Protection (master)
  Pixel shifter + Radius + shifter duration
  Pixel refresher + Static screen timeout
  OLED Ultra Black Mode (mura)
"""

from __future__ import annotations

import os
import re
import subprocess
import threading
import time
from pathlib import Path

from .system import atomically_write, settings_set

CARE_BIN = Path("/usr/bin/batocera-oled-care")
REFRESHER_BIN = Path("/usr/bin/batocera-oled-refresher")
STATE_DIR = Path("/var/run/batocera-oled-care")
NATIVE_PYTHON = Path("/usr/bin/python3")
IDLE_HELPER = Path("/usr/bin/batocera-oled-idle-helper")
if not IDLE_HELPER.is_file():
    IDLE_HELPER = Path(__file__).resolve().parent / "oled_idle_helper.py"
IDLE_HELPER_PID = STATE_DIR / "idle-helper.pid"
CONFIG_PATH = Path("/userdata/system/configs/odin-oled-care/settings.conf")
BACKLIGHT = Path("/sys/class/backlight/ae94000.dsi.0")
MURA_SYSFS = Path("/sys/class/enhance_color_class/enhance_color_device/enhance_color")
_LOCK = threading.RLock()

# Map Decky/UI keys ↔ batocera.conf
KEY_MAP = {
    "ENABLED": "display.oledcare",
    "DETECT": "display.oledcare.detect",
    "STATIC_TIMEOUT": "display.oledcare.static_timeout",
    "REFRESHER": "display.oledcare.refresher",
    "REFRESHER_DURATION": "display.oledcare.refresher_duration",
    "REFRESHER_PASSES": "display.oledcare.refresher_passes",
    "SHIFTER": "display.oledcare.shifter",
    "SHIFTER_RADIUS": "display.oledcare.shifter_radius",
    "SHIFTER_DURATION": "display.oledcare.shifter_duration",
    "MURA": "display.oledcare.mura",
}

DEFAULTS: dict[str, int] = {
    "ENABLED": 0,
    "DETECT": 1,
    "STATIC_TIMEOUT": 30,
    "REFRESHER": 1,
    "REFRESHER_DURATION": 3,
    "REFRESHER_PASSES": 3,
    "SHIFTER": 1,
    "SHIFTER_RADIUS": 1,
    "SHIFTER_DURATION": 3,
    "MURA": 0,
}

# AYN OdinSettings strings (values/strings.xml)
KEY_LABELS = {
    "ENABLED": "OLED Screen Protection",
    "DETECT": "Static-image / idle detection",
    "STATIC_TIMEOUT": "Static screen timeout",
    "REFRESHER": "Pixel refresher",
    "REFRESHER_DURATION": "Refresher pass duration",
    "REFRESHER_PASSES": "Refresher passes",
    "SHIFTER": "Pixel shifter",
    "SHIFTER_RADIUS": "Radius",
    "SHIFTER_DURATION": "Pixel shifter duration",
    "MURA": "OLED Ultra Black Mode",
}

BOOL_KEYS = {"ENABLED", "DETECT", "REFRESHER", "SHIFTER", "MURA"}
CLAMP: dict[str, tuple[int, int]] = {
    "STATIC_TIMEOUT": (1, 300),
    "REFRESHER_DURATION": (1, 30),
    "REFRESHER_PASSES": (1, 10),
    "SHIFTER_RADIUS": (1, 10),
    "SHIFTER_DURATION": (1, 300),
}


def _run(cmd: list[str], timeout: int = 30) -> str:
    try:
        result = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=timeout)
        return (result.stdout or result.stderr or "").strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def _settings_get(key: str) -> str:
    return _run(["batocera-settings-get", key])


def stock_cli_available() -> bool:
    return CARE_BIN.is_file() and os.access(CARE_BIN, os.X_OK)


def panel_detected() -> bool:
    if BACKLIGHT.is_dir():
        return True
    return any(Path("/sys/class/backlight").glob("*/brightness"))


def mura_available() -> bool:
    return MURA_SYSFS.exists()


def supported() -> bool:
    # Always offer UI when OLED backlight is present; stock CLI optional.
    return panel_detected()


def unsupported_reason() -> str:
    if not panel_detected():
        return "OLED backlight was not detected"
    return ""


def _parse_local_conf() -> dict[str, int]:
    data = dict(DEFAULTS)
    if not CONFIG_PATH.exists():
        return data
    try:
        for line in CONFIG_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            match = re.match(r"^([A-Z_]+)=(.+)$", line)
            if not match:
                continue
            key, raw = match.group(1), match.group(2).strip().strip('"').strip("'")
            if key not in DEFAULTS:
                continue
            try:
                data[key] = int(raw)
            except ValueError:
                pass
    except OSError:
        pass
    return data


def _write_local_conf(data: dict[str, int]) -> None:
    lines = ["# OLED Care — mirror of display.oledcare* (decky / batocera sync)", ""]
    for key in DEFAULTS:
        lines.append(f"{key}={data[key]}")
    lines.append("")
    atomically_write(CONFIG_PATH, "\n".join(lines), 0o644)


def _normalize(data: dict) -> dict[str, int]:
    merged = dict(DEFAULTS)
    for key in DEFAULTS:
        if key not in data:
            continue
        try:
            value = int(data[key])
        except (TypeError, ValueError):
            continue
        if key in BOOL_KEYS:
            value = 1 if value else 0
        if key in CLAMP:
            lo, hi = CLAMP[key]
            value = max(lo, min(hi, value))
        merged[key] = value
    return merged


def _read_from_batocera() -> dict[str, int]:
    data = dict(DEFAULTS)
    for ui_key, conf_key in KEY_MAP.items():
        raw = _settings_get(conf_key)
        if not raw:
            continue
        match = re.search(r"-?\d+", raw)
        if match:
            data[ui_key] = int(match.group(0))
    return _normalize(data)


def _parse_conf() -> dict[str, int]:
    if stock_cli_available() or any(_settings_get(k) for k in KEY_MAP.values()):
        bat = _read_from_batocera()
        # Prefer batocera.conf; fill gaps from local
        local = _parse_local_conf()
        for key, value in local.items():
            if not _settings_get(KEY_MAP[key]):
                bat[key] = value
        return _normalize(bat)
    return _normalize(_parse_local_conf())


def _apply_to_batocera(data: dict[str, int]) -> None:
    for ui_key, conf_key in KEY_MAP.items():
        settings_set(conf_key, str(data[ui_key]))


def _service_running() -> bool:
    out = _run(["pgrep", "-f", "batocera-oled-care watch"])
    if out:
        return True
    pid = STATE_DIR / "watch.pid"
    if pid.exists():
        try:
            raw = pid.read_text(encoding="utf-8").strip()
            if raw and Path(f"/proc/{raw}").exists():
                return True
        except OSError:
            pass
    return False


def _idle_seconds() -> int:
    stamp = STATE_DIR / "last-input"
    if not stamp.exists():
        return 0
    try:
        last = float(stamp.read_text(encoding="utf-8").strip().split()[0])
    except (OSError, ValueError):
        return 0
    return max(0, int(time.time() - last))


def _helper_pid() -> int | None:
    try:
        pid = int(IDLE_HELPER_PID.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None
    if pid > 0 and Path(f"/proc/{pid}").exists():
        return pid
    return None


def stop_idle_watch() -> None:
    pid = _helper_pid()
    if pid:
        try:
            os.kill(pid, 15)
        except OSError:
            pass
    try:
        IDLE_HELPER_PID.unlink()
    except OSError:
        pass


def ensure_idle_watch(enabled: bool) -> None:
    """Native python3 helper stamps last-input; FEX PluginLoader cannot import evdev."""
    if not enabled:
        stop_idle_watch()
        return
    if _helper_pid():
        return
    if not NATIVE_PYTHON.is_file() or not IDLE_HELPER.is_file():
        return
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (STATE_DIR / "last-input").write_text(str(time.time()), encoding="utf-8")
    proc = subprocess.Popen(
        [str(NATIVE_PYTHON), str(IDLE_HELPER)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    IDLE_HELPER_PID.write_text(str(proc.pid), encoding="utf-8")


def ensure_decky_idle_watch(enabled: bool) -> None:
    """Decky-only fallback when batocera-oled-care is not on the image."""
    if stock_cli_available():
        stop_idle_watch()
        return
    ensure_idle_watch(enabled)


def _phase() -> str:
    state = STATE_DIR / "state"
    if not state.exists():
        return "idle"
    try:
        for line in state.read_text(encoding="utf-8").splitlines():
            if line.startswith("phase="):
                return line.split("=", 1)[1].strip() or "idle"
    except OSError:
        pass
    if (STATE_DIR / "refresh-active").exists():
        return "refreshing"
    return "idle"


def get_state() -> dict:
    with _LOCK:
        cfg = _parse_conf()
        ensure_decky_idle_watch(cfg["ENABLED"] == 1)
    watching = _service_running() if stock_cli_available() else bool(_helper_pid())
    return {
        "supported": supported(),
        "panelDetected": panel_detected(),
        "stockCli": stock_cli_available(),
        "muraAvailable": mura_available(),
        "reason": unsupported_reason(),
        "config": cfg,
        "labels": KEY_LABELS,
        "runtime": {
            "serviceRunning": watching,
            "monitorRunning": watching,
            "idleSeconds": _idle_seconds(),
            "phase": _phase(),
            "brightnessPct": None,
        },
    }


def save_state(data: dict) -> dict:
    if not supported():
        raise RuntimeError(unsupported_reason() or "OLED Care not supported")
    if not isinstance(data, dict):
        raise ValueError("OLED care settings must be an object")
    with _LOCK:
        merged = _normalize(data)
        merged["DETECT"] = 1 if merged["ENABLED"] else 0
        _write_local_conf(merged)
        _apply_to_batocera(merged)
        ensure_decky_idle_watch(merged["ENABLED"] == 1)
        if stock_cli_available():
            if merged["ENABLED"]:
                _run(["batocera-services", "enable", "oledcare"])
                _run([str(CARE_BIN), "reload"])
            else:
                _run(["batocera-services", "disable", "oledcare"])
                _run([str(CARE_BIN), "stop"])
    return get_state()


def note_activity() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (STATE_DIR / "last-input").write_text(str(time.time()), encoding="utf-8")


def idle_snapshot() -> dict:
    with _LOCK:
        cfg = _parse_conf()
        ensure_decky_idle_watch(cfg["ENABLED"] == 1)
    # GamepadUI cannot show the host pygame refresher. Always let the Decky
    # overlay use its own Steam idle clock; batocera-oled-care still runs
    # for ES / emulators outside Steam.
    return {
        "idleSeconds": 0,
        "watching": False,
        "enabled": cfg["ENABLED"] == 1,
        "refresher": cfg["REFRESHER"] == 1,
        "timeout": int(cfg["STATIC_TIMEOUT"]),
        "duration": int(cfg["REFRESHER_DURATION"]),
        "passes": int(cfg["REFRESHER_PASSES"]),
    }


def restart_service() -> dict:
    with _LOCK:
        if stock_cli_available():
            _run([str(CARE_BIN), "reload"])
        else:
            raise RuntimeError("batocera-oled-care is not installed on this image yet")
    return get_state()


def run_refresh_now() -> dict:
    """Trigger AYN-style refresher immediately (host or headless marker)."""
    with _LOCK:
        if stock_cli_available():
            _run([str(CARE_BIN), "refresh-now"], timeout=120)
        elif REFRESHER_BIN.is_file():
            cfg = _parse_conf()
            _run(
                [
                    str(REFRESHER_BIN),
                    "--duration",
                    str(cfg["REFRESHER_DURATION"]),
                    "--passes",
                    str(cfg["REFRESHER_PASSES"]),
                ],
                timeout=120,
            )
        else:
            # Signal decky UI overlay via state file
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            (STATE_DIR / "refresh-active").write_text("decky", encoding="utf-8")
    return get_state()
