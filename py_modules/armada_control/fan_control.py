"""Feature-detected controls for Batocera's native Qualcomm fan helper."""

from __future__ import annotations

import json
import threading
from pathlib import Path

from .system import run_cmd

HELPER = Path("/usr/bin/qcom-fan")
MIN_MANUAL_PERCENT = 20
# Keep in sync with qcom-fan AUTO_MODES + manual/off.
AUTO_MODES = ("silent", "auto", "aggressive")
SELECTABLE_MODES = (*AUTO_MODES, "manual", "off")
_LOCK = threading.RLock()


def _result(args: list[str], timeout: int = 10):
    return run_cmd([str(HELPER), *args], timeout=timeout)


def _normalize_mode(raw: str) -> str:
    mode = str(raw or "").strip().lower()
    if mode in SELECTABLE_MODES:
        return mode
    # qcom-fan may report "driver auto" / "read only" when idle.
    if "manual" in mode:
        return "manual"
    if mode in ("driver auto", "read only", ""):
        return "auto"
    return "auto"


def _unavailable(reason: str) -> dict:
    return {
        "supported": False,
        "reason": reason,
        "controllable": False,
        "name": "",
        "mode": "",
        "percent": None,
        "targetPercent": None,
        "rpm": None,
        "minimumManualPercent": MIN_MANUAL_PERCENT,
        "modes": [{"data": key, "label": label} for key, label in (
            ("silent", "Silent curve"),
            ("auto", "Balanced curve"),
            ("aggressive", "Aggressive curve"),
            ("manual", "Manual override"),
            ("off", "Off"),
        )],
    }


def get_state() -> dict:
    if not HELPER.is_file():
        return _unavailable("qcom-fan is not installed in this image")
    result = _result(["json"])
    try:
        raw = json.loads(result.stdout) if result and result.stdout else {}
    except (TypeError, json.JSONDecodeError):
        raw = {}
    if not isinstance(raw, dict) or not raw.get("available"):
        return _unavailable("No supported fan device was detected")
    return {
        "supported": True,
        "reason": "" if raw.get("control") else "Fan telemetry is read-only on this device",
        "controllable": bool(raw.get("control")),
        "name": str(raw.get("name") or "System fan"),
        "mode": _normalize_mode(str(raw.get("mode") or "")),
        "percent": raw.get("percent") if isinstance(raw.get("percent"), (int, float)) else None,
        "targetPercent": raw.get("target_percent") if isinstance(raw.get("target_percent"), (int, float)) else None,
        "rpm": raw.get("rpm") if isinstance(raw.get("rpm"), (int, float)) else None,
        "minimumManualPercent": MIN_MANUAL_PERCENT,
        "modes": [
            {"data": "silent", "label": "Silent curve"},
            {"data": "auto", "label": "Balanced curve"},
            {"data": "aggressive", "label": "Aggressive curve"},
            {"data": "manual", "label": "Manual override"},
            {"data": "off", "label": "Off"},
        ],
    }


def save_state(data: dict) -> dict:
    state = get_state()
    if not state["supported"]:
        raise RuntimeError(state["reason"])
    if not state["controllable"]:
        raise RuntimeError("Fan telemetry is read-only on this device")
    if not isinstance(data, dict):
        raise ValueError("fan settings must be an object")

    mode = _normalize_mode(str(data.get("mode") or ""))
    if mode not in SELECTABLE_MODES:
        raise ValueError("invalid fan mode")
    with _LOCK:
        if mode in AUTO_MODES:
            result = _result([mode], timeout=20)
        elif mode == "off":
            result = _result(["stop"], timeout=20)
        else:
            value = data.get("targetPercent")
            if isinstance(value, bool):
                raise ValueError("invalid manual fan speed")
            try:
                percent = int(round(float(value)))
            except (TypeError, ValueError):
                raise ValueError("invalid manual fan speed") from None
            if not MIN_MANUAL_PERCENT <= percent <= 100:
                raise ValueError(f"manual fan speed must be {MIN_MANUAL_PERCENT}-100%")
            result = _result(["set", str(percent)], timeout=20)
        if not result or result.returncode != 0:
            raise RuntimeError("the Batocera fan service rejected the requested setting")
    return get_state()
