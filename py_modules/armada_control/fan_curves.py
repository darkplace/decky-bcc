"""Named qcom-fan curves — port of armada-os/armada#260 (Xtreme976).

Does not own fan runtime mode. Control Center (Home+A) and Power → Fan control
still call `qcom-fan silent|auto|aggressive|set|stop`. This module only edits
the point lists those modes follow.
"""

from __future__ import annotations

import json
import subprocess
import threading
from pathlib import Path

HELPER = Path("/usr/bin/qcom-fan")
_LOCK = threading.RLock()
CONTROL_DECK_CURVES = ("silent", "auto", "aggressive")


def _run(args: list[str], timeout: int = 15, stdin: str | None = None):
    try:
        return subprocess.run(
            [str(HELPER), *args],
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            input=stdin,
        )
    except (OSError, subprocess.SubprocessError):
        return None


def _unavailable(reason: str) -> dict:
    return {
        "fanCurves": {},
        "factoryFanCurves": {},
        "fanSettings": {"ramp_up": 36, "ramp_down": 6, "smoothing": 0.50, "min_pwm": 0},
        "factoryFanSettings": {"ramp_up": 36, "ramp_down": 6, "smoothing": 0.50, "min_pwm": 0},
        "profiles": {},
        "activeProfile": "",
        "runtimeMode": "",
        "currentTemp": None,
        "reason": reason,
        "supported": False,
    }


def get_state() -> dict:
    if not HELPER.is_file():
        return _unavailable("qcom-fan is not installed in this image")
    result = _run(["curves-json"])
    try:
        raw = json.loads(result.stdout) if result and result.stdout else {}
    except (TypeError, json.JSONDecodeError):
        raw = {}
    if not isinstance(raw, dict) or not raw.get("fanCurves"):
        return _unavailable("qcom-fan on this image does not expose named curves yet")
    raw["supported"] = True
    raw["reason"] = ""
    return raw


def get_current_temp():
    if not HELPER.is_file():
        return None
    result = _run(["temp"])
    if not result or not result.stdout:
        return None
    try:
        return int(str(result.stdout).strip().split()[0])
    except (TypeError, ValueError):
        return None


def save_all(fan_curves, fan_settings) -> dict:
    if not HELPER.is_file():
        raise RuntimeError("qcom-fan is not installed in this image")
    if not isinstance(fan_curves, dict) or not fan_curves:
        raise ValueError("at least one fan curve is required")
    for name in CONTROL_DECK_CURVES:
        if name not in fan_curves:
            raise ValueError(f"can't remove '{name}': Control Center (Home+A) still uses that mode")
    payload = {"fanCurves": fan_curves, "fanSettings": fan_settings or {}}
    with _LOCK:
        result = _run(["curves-write"], timeout=20, stdin=json.dumps(payload))
    if not result or result.returncode != 0:
        err = ((result.stderr or result.stdout) if result else "") or "qcom-fan rejected the curve update"
        raise RuntimeError(err.strip())
    try:
        raw = json.loads(result.stdout) if result.stdout else {}
    except json.JSONDecodeError:
        raw = {}
    if isinstance(raw, dict) and raw.get("fanCurves"):
        raw["supported"] = True
        raw["reason"] = ""
        return raw
    return get_state()
