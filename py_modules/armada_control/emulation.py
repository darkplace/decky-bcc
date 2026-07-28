"""Decky-safe RPC wrapper around the system-Python ES feature broker."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any


SYSTEM_PYTHON = "/usr/bin/python3"
PY_MODULES = Path(__file__).resolve().parents[1]
BROKER_MODULE = "armada_control.emulation_broker"


def _call_broker(action: str, payload: dict[str, Any]) -> Any:
    environment = dict(os.environ)
    current = environment.get("PYTHONPATH", "")
    environment["PYTHONPATH"] = str(PY_MODULES) + (os.pathsep + current if current else "")
    try:
        result = subprocess.run(
            [SYSTEM_PYTHON, "-m", BROKER_MODULE, action, json.dumps(payload, separators=(",", ":"))],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            env=environment,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError("Batocera emulation feature broker is unavailable") from exc
    if result.returncode != 0:
        detail = result.stderr.strip().splitlines()
        raise RuntimeError(detail[-1] if detail else "Batocera emulation feature broker failed")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Batocera emulation feature broker returned invalid data") from exc


def managed_appids() -> list[str]:
    try:
        result = _call_broker("managed-appids", {})
    except RuntimeError:
        return []
    return [str(value) for value in result] if isinstance(result, list) else []


def get_state(appid: object, emulator: str = "", core: str = "") -> dict[str, Any]:
    result = _call_broker(
        "get-state",
        {"appid": appid, "emulator": str(emulator or ""), "core": str(core or "")},
    )
    if not isinstance(result, dict):
        raise RuntimeError("Batocera emulation feature broker returned invalid state")
    return result


def set_game_setting(appid: object, setting: object, value: object) -> dict[str, Any]:
    result = _call_broker(
        "set-game-setting",
        {"appid": appid, "setting": str(setting), "value": value},
    )
    if not isinstance(result, dict):
        raise RuntimeError("Batocera emulation feature broker returned invalid state")
    return result
