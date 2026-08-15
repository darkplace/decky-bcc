"""Game compatibility tweaks — userdata-backed on Batocera (exFAT / no /etc/armada)."""

from __future__ import annotations

import copy
import json
from pathlib import Path

from .system import atomically_write

TWEAKS_USERDATA = Path("/userdata/system/configs/batocera-control/game-tweaks.json")
TWEAKS_SYSTEM = Path("/etc/armada/game-tweaks.json")
COMPAT_APPLIED_STATE = Path("/userdata/system/configs/batocera-control/compat-applied.json")
FEX_PROFILES_CONFIG = Path("/usr/share/armada/fex-profiles.json")
PLUGIN_FEX_PROFILES_CONFIG = Path(__file__).resolve().parent.parent / "fex-profiles.json"

_FALLBACK_CONTRACT = {
    "defaults": {"global": {"thunks": {}}, "games": {}},
    "profiles": {"default": {"label": "Default", "config": {}}},
}


def load_fex_contract():
    path = FEX_PROFILES_CONFIG if FEX_PROFILES_CONFIG.exists() else PLUGIN_FEX_PROFILES_CONFIG
    try:
        with path.open(encoding="utf-8") as f:
            contract = json.load(f)
    except (OSError, ValueError, json.JSONDecodeError):
        return copy.deepcopy(_FALLBACK_CONTRACT)
    profiles = contract.get("profiles")
    if not isinstance(contract.get("defaults"), dict) or not isinstance(profiles, dict) or "default" not in profiles:
        raise ValueError("invalid FEX profile contract")
    for profile in profiles.values():
        if not isinstance(profile, dict) or not isinstance(profile.get("config"), dict):
            raise ValueError("invalid FEX profile contract")
    return contract


def fex_profile_labels(contract):
    return {
        name: {"label": profile.get("label", name.title()), "config": profile.get("config", {})}
        for name, profile in contract["profiles"].items()
        if isinstance(profile, dict)
    }


def _read_tweaks_file(path: Path) -> dict | None:
    try:
        with path.open(encoding="utf-8") as f:
            loaded = json.load(f)
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    return loaded if isinstance(loaded, dict) else None


def _is_appid_key(value) -> bool:
    """True for Steam appids, including signed Non-Steam shortcut ids."""
    text = str(value).strip()
    if not text:
        return False
    if text[0] in "+-":
        text = text[1:]
    return text.isdigit()


def load_tweaks():
    contract = load_fex_contract()
    loaded = _read_tweaks_file(TWEAKS_USERDATA)
    if loaded is None:
        try:
            loaded = _read_tweaks_file(TWEAKS_SYSTEM)
        except OSError:
            loaded = None
    data = copy.deepcopy(contract["defaults"])
    if isinstance(loaded, dict):
        if isinstance(loaded.get("global"), dict):
            data["global"].update(loaded["global"])
        if isinstance(loaded.get("games"), dict):
            data["games"] = {
                str(k): v for k, v in loaded["games"].items()
                if _is_appid_key(k) and isinstance(v, dict)
            }
    data["games"] = {
        gid: {key: value for key, value in game.items() if key != "enabled"}
        for gid, game in data["games"].items()
        if isinstance(game, dict) and game.get("enabled") is not False
    }
    return data


def sanitize_tweaks(data):
    if not isinstance(data, dict):
        raise ValueError("tweaks must be an object")
    if len(json.dumps(data)) > 256 * 1024:
        raise ValueError("tweaks payload too large")
    clean = {"global": {}, "games": {}}
    if isinstance(data.get("global"), dict):
        clean["global"] = data["global"]
    raw_games = data.get("games")
    if isinstance(raw_games, dict):
        for gid, game in raw_games.items():
            if _is_appid_key(gid) and isinstance(game, dict):
                clean["games"][str(gid)] = game
    return clean


def save_tweaks(data):
    clean = sanitize_tweaks(data)
    text = json.dumps(clean, indent=2, sort_keys=True) + "\n"
    atomically_write(TWEAKS_USERDATA, text, 0o644)


def load_compat_applied():
    try:
        with COMPAT_APPLIED_STATE.open(encoding="utf-8") as f:
            loaded = json.load(f)
    except (OSError, ValueError, json.JSONDecodeError):
        return []
    appids = loaded.get("appids") if isinstance(loaded, dict) else None
    if not isinstance(appids, list):
        return []
    return sorted({str(appid) for appid in appids if _is_appid_key(appid)}, key=lambda value: int(value))


def save_compat_applied(appids):
    if not isinstance(appids, list) or len(appids) > 100_000:
        raise ValueError("invalid compatibility state")
    clean = sorted({str(appid) for appid in appids if _is_appid_key(appid)}, key=lambda value: int(value))
    text = json.dumps({"appids": clean}, indent=2, sort_keys=True) + "\n"
    atomically_write(COMPAT_APPLIED_STATE, text, 0o644)
    return clean
