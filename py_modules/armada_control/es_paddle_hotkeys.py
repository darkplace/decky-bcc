"""Sync Decky M1/M2 paddle binds with EmulationStation evmapy hotkeys.

Batocera names the rear buttons paddle1/paddle2 in hotkeys.keys. On AYN
rsinput those names are swapped versus physical left/right:

  M1 / left  (BTN_TRIGGER_HAPPY7, 710) = ES paddle2
  M2 / right (BTN_TRIGGER_HAPPY5, 708) = ES paddle1

Host-only actions (mouse, MangoHud, OSK, …) clear the ES paddle entry so
the UI stays a single system-wide bind. ES-only actions (save state, exit,
…) are stored as es_* in back-paddles.json; the daemon does not fire them
on tap — Home+paddle is left to evmapy.
"""

from __future__ import annotations

import json
from pathlib import Path

from .system import atomically_write

SYSTEM_HOTKEYS = Path("/usr/share/evmapy/hotkeys.keys")
USER_HOTKEYS = Path("/userdata/system/configs/hotkeys.keys")
HOTKEY_MAP = Path("/etc/hotkeygen/default_mapping.conf")

# Physical Decky slot → evmapy button name.
DECKY_TO_ES_BUTTON = {"m1": "paddle2", "m2": "paddle1"}
ES_BUTTON_TO_DECKY = {button: slot for slot, button in DECKY_TO_ES_BUTTON.items()}

# Linux key → hotkeygen friendly name (same as /etc/hotkeygen/default_mapping.conf).
BUILTIN_KEY_TO_NAME = {
    "KEY_EXIT": "exit",
    "KEY_EURO": "coin",
    "KEY_MENU": "menu",
    "KEY_PAUSE": "pause",
    "KEY_RESTART": "reset",
    "KEY_FILE": "files",
    "KEY_SAVE": "save_state",
    "KEY_SEND": "restore_state",
    "KEY_NEXT": "next_slot",
    "KEY_PREVIOUS": "previous_slot",
    "KEY_REWIND": "rewind",
    "KEY_FASTFORWARD": "fastforward",
    "KEY_SYSRQ": "screenshot",
    "KEY_VOLUMEUP": "volumeup",
    "KEY_VOLUMEDOWN": "volumedown",
    "KEY_MUTE": "volumemute",
    "KEY_BRIGHTNESS_CYCLE": "brightness-cycle",
    "KEY_SUBTITLE": "translation",
    "KEY_FRONT": "bezels",
    "KEY_VIDEO_NEXT": "next_disk",
    "KEY_VIDEO_PREV": "previous_disk",
    "KEY_EJECTCD": "disk_eject",
    "KEY_CAMERA_FOCUS": "swap_screen",
    "KEY_PRESENTATION": "screen_layout",
    "KEY_CONTEXT_MENU": "controlcenter",
}

# Decky host action → hotkeygen name when the same gesture should work in ES.
HOST_TO_ES_NAME = {
    "screenshot": "screenshot",
    "mute_toggle": "volumemute",
    "volume_up": "volumeup",
    "volume_down": "volumedown",
    "control_center": "controlcenter",
}

# (decky action, UI label, hotkeygen name)
ES_ONLY_ACTIONS = [
    ("es_exit", "Exit emulator", "exit"),
    ("es_save_state", "Save state", "save_state"),
    ("es_restore_state", "Restore state", "restore_state"),
    ("es_next_slot", "Next save slot", "next_slot"),
    ("es_previous_slot", "Previous save slot", "previous_slot"),
    ("es_rewind", "Rewind", "rewind"),
    ("es_fastforward", "Fast forward", "fastforward"),
    ("es_menu", "Emulator menu", "menu"),
    ("es_pause", "Pause", "pause"),
    ("es_reset", "Reset", "reset"),
    ("es_coin", "Insert coin", "coin"),
    ("es_translation", "Translation overlay", "translation"),
    ("es_bezels", "Hide bezels", "bezels"),
    ("es_next_disk", "Next disk", "next_disk"),
    ("es_previous_disk", "Previous disk", "previous_disk"),
    ("es_disk_eject", "Eject disk", "disk_eject"),
    ("es_swap_screen", "Swap screen", "swap_screen"),
    ("es_screen_layout", "Screen layout", "screen_layout"),
]

ES_NAME_TO_ACTION = {name: key for key, _label, name in ES_ONLY_ACTIONS}
ES_ACTION_TO_NAME = {key: name for key, _label, name in ES_ONLY_ACTIONS}
ES_ACTION_LABELS = {key: label for key, label, _name in ES_ONLY_ACTIONS}
ES_HOTKEY_DESCRIPTIONS = {
    "exit": "Exit emulator",
    "save_state": "Save state",
    "restore_state": "Restore state",
    "next_slot": "Next save slot",
    "previous_slot": "Previous save slot",
    "rewind": "Rewind",
    "fastforward": "Fast forward",
    "screenshot": "Screenshot",
    "volumeup": "Volume up",
    "volumedown": "Volume down",
    "volumemute": "Mute",
    "controlcenter": "Batocera Control Center",
    "menu": "Menu",
    "pause": "Pause",
    "reset": "Reset",
    "coin": "Insert coin",
    "translation": "Translate",
    "bezels": "Hide bezels",
    "next_disk": "Next disk",
    "previous_disk": "Previous disk",
    "disk_eject": "Eject disk",
    "swap_screen": "Swap screen",
    "screen_layout": "Screen layout",
}


def _key_to_name() -> dict[str, str]:
    mapping = dict(BUILTIN_KEY_TO_NAME)
    try:
        data = json.loads(HOTKEY_MAP.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return mapping
    if isinstance(data, dict):
        for key, name in data.items():
            if isinstance(key, str) and isinstance(name, str) and key.startswith("KEY_"):
                mapping[key] = name
    return mapping


def _name_to_key() -> dict[str, str]:
    return {name: key for key, name in _key_to_name().items()}


def _load_hotkeys_config() -> dict | None:
    for path in (USER_HOTKEYS, SYSTEM_HOTKEYS):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and isinstance(data.get("actions_player1"), list):
            return data
    return None


def _is_paddle_entry(entry: object, button: str) -> bool:
    if not isinstance(entry, dict):
        return False
    trigger = entry.get("trigger")
    return isinstance(trigger, list) and len(trigger) == 2 and trigger[0] == "hotkey" and trigger[1] == button


def read_es_paddle_actions() -> dict[str, str]:
    """Return {m1, m2} Decky action ids inferred from hotkeys.keys."""
    out = {"m1": "none", "m2": "none"}
    config = _load_hotkeys_config()
    if not config:
        return out
    key_to_name = _key_to_name()
    for entry in config.get("actions_player1") or []:
        if not isinstance(entry, dict):
            continue
        trigger = entry.get("trigger")
        if not isinstance(trigger, list) or len(trigger) != 2 or trigger[0] != "hotkey":
            continue
        button = trigger[1]
        slot = ES_BUTTON_TO_DECKY.get(button)
        if not slot:
            continue
        if entry.get("type") != "key":
            continue
        target = entry.get("target")
        if not isinstance(target, list) or not target:
            continue
        linux_key = str(target[0])
        name = key_to_name.get(linux_key)
        if not name:
            continue
        if name in HOST_TO_ES_NAME.values():
            host = next(action for action, es_name in HOST_TO_ES_NAME.items() if es_name == name)
            out[slot] = host
        elif name in ES_NAME_TO_ACTION:
            out[slot] = ES_NAME_TO_ACTION[name]
    return out


def merge_es_bindings(bindings: dict) -> dict:
    """Fill empty M1/M2 slots from the current ES paddle hotkeys."""
    merged = dict(bindings)
    es = read_es_paddle_actions()
    for slot in ("m1", "m2"):
        current = str(merged.get(slot, "none") or "none")
        seeded = str(es.get(slot, "none") or "none")
        if current in ("", "none") and seeded not in ("", "none"):
            merged[slot] = seeded
    return merged


def action_to_es_name(action: str) -> str | None:
    action = (action or "none").strip() or "none"
    if action == "none":
        return None
    if action in HOST_TO_ES_NAME:
        return HOST_TO_ES_NAME[action]
    if action in ES_ACTION_TO_NAME:
        return ES_ACTION_TO_NAME[action]
    return None


def write_es_paddle_actions(bindings: dict) -> None:
    """Write M1/M2 into userdata hotkeys.keys (creates the file from stock if needed)."""
    if not SYSTEM_HOTKEYS.is_file() and not USER_HOTKEYS.is_file():
        return
    config = _load_hotkeys_config()
    if not config:
        return
    name_to_key = _name_to_key()
    actions = list(config.get("actions_player1") or [])
    for slot, button in DECKY_TO_ES_BUTTON.items():
        es_name = action_to_es_name(str(bindings.get(slot, "none") or "none"))
        linux_key = name_to_key.get(es_name) if es_name else None
        next_actions = []
        found = False
        for entry in actions:
            if not _is_paddle_entry(entry, button):
                next_actions.append(entry)
                continue
            found = True
            if not linux_key:
                continue
            updated = dict(entry)
            updated["type"] = "key"
            updated["target"] = [linux_key]
            updated["description"] = ES_HOTKEY_DESCRIPTIONS.get(es_name or "", es_name or "")
            next_actions.append(updated)
        if not found and linux_key:
            next_actions.append(
                {
                    "trigger": ["hotkey", button],
                    "type": "key",
                    "target": [linux_key],
                    "description": ES_HOTKEY_DESCRIPTIONS.get(es_name or "", es_name or ""),
                }
            )
        actions = next_actions
    config["actions_player1"] = actions
    atomically_write(USER_HOTKEYS, json.dumps(config, indent=4) + "\n", 0o644)
