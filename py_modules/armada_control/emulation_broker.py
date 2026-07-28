"""Expose Batocera ES/configgen options for managed Steam ROM shortcuts."""

from __future__ import annotations

import copy
import json
import math
import sys
import zlib
from collections import OrderedDict
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from .system import BATOCERA_CONF, settings_remove, settings_remove_many, settings_set, settings_set_many


MANIFEST_PATH = Path("/userdata/system/configs/batocera-steam/managed-games.json")
LAUNCHERS_DIR = Path("/userdata/system/configs/batocera-steam/launchers")
ES_FEATURES_PATHS = (
    Path("/userdata/system/configs/emulationstation/es_features.cfg"),
    Path("/usr/share/emulationstation/es_features.cfg"),
)
ES_SYSTEMS_PATHS = (
    Path("/userdata/system/configs/emulationstation/es_systems.cfg"),
    Path("/usr/share/emulationstation/es_systems.cfg"),
)
SHADER_CONFIG_DIRS = (
    Path("/userdata/shaders/configs"),
    Path("/usr/share/batocera/shaders/configs"),
)

# These settings conflict with Steam/GamepadUI's own display, HUD, and power
# controls. Emulator rendering and emulator-specific features remain visible.
STEAM_MODE_EXCLUDED_VALUES = {
    "videomode",
    "hud",
    "hud_corner",
    "powermode",
    "batterymode",
    "tdp",
    "tdp_mode",
    "tdp_min",
    "tdp_max",
    "tdp_target_fps",
}
STEAM_MODE_EXCLUDED_PREFIXES = ("gamescope",)
STEAM_MODE_EXCLUDED_GROUPS = {"POWER OPTIONS"}
SWITCH_PRESETS = {"switch", "switchauto", "switchon", "switchoff"}
SLIDER_PRESETS = {"slider", "sliderauto"}
TEXT_PRESETS = {"input", "password", "image", "video", "folder", "document", "files"}


def _first_existing(paths: tuple[Path, ...]) -> Path:
    for path in paths:
        if path.is_file():
            return path
    raise FileNotFoundError(str(paths[-1]))


def _load_manifest() -> dict[str, Any]:
    data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("games"), dict):
        raise ValueError("invalid Batocera Steam managed-games manifest")
    return data


def _shortcut_appid(managed_id: str, name: str) -> int:
    alias = str(LAUNCHERS_DIR / managed_id)
    return (zlib.crc32((alias + name).encode("utf-8")) & 0xFFFFFFFF) | 0x80000000


def _managed_games() -> list[tuple[int, dict[str, Any]]]:
    manifest = _load_manifest()
    if not manifest.get("enabled", True):
        return []
    result = []
    for managed_id, raw_game in manifest["games"].items():
        if not isinstance(raw_game, dict) or not raw_game.get("enabled", True):
            continue
        game = dict(raw_game)
        game["id"] = str(game.get("id") or managed_id)
        appid = _shortcut_appid(game["id"], str(game.get("name") or ""))
        result.append((appid, game))
    return result


def managed_appids() -> list[str]:
    try:
        return [str(appid) for appid, _game in _managed_games()]
    except (OSError, ValueError, json.JSONDecodeError):
        return []


def _managed_game(appid: object) -> tuple[int, dict[str, Any]] | None:
    try:
        wanted = int(str(appid)) & 0xFFFFFFFF
    except (TypeError, ValueError):
        return None
    try:
        for candidate, game in _managed_games():
            if candidate == wanted:
                return candidate, game
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    return None


def _read_config() -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        lines = BATOCERA_CONF.read_text(encoding="utf-8").splitlines()
    except OSError:
        return values
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def _system_definition(root: ET.Element, system_name: str) -> ET.Element | None:
    for system in root.findall("./system"):
        if (system.findtext("name") or "").strip() == system_name:
            return system
    return None


def _emulator_options(system: ET.Element) -> tuple[list[dict[str, Any]], str, str]:
    options: list[dict[str, Any]] = []
    default_emulator = ""
    default_core = ""
    first_pair: tuple[str, str] | None = None
    for emulator in system.findall("./emulators/emulator"):
        emulator_name = str(emulator.get("name") or "")
        cores = []
        for core in emulator.findall("./cores/core"):
            core_name = (core.text or "").strip()
            if not core_name:
                continue
            if first_pair is None:
                first_pair = (emulator_name, core_name)
            if str(core.get("default") or "").casefold() == "true":
                default_emulator, default_core = emulator_name, core_name
            cores.append({"data": core_name, "label": core_name})
        if cores:
            options.append({"data": emulator_name, "label": emulator_name, "cores": cores})
    if not default_emulator and first_pair is not None:
        default_emulator, default_core = first_pair
    return options, default_emulator, default_core


def _matching_system_node(parent: ET.Element | None, system_name: str) -> ET.Element | None:
    if parent is None:
        return None
    systems = parent.find("./systems")
    if systems is None:
        return None
    for system in systems.findall("./system"):
        if system.get("name") == system_name:
            return system
    return None


def _feature_from_element(node: ET.Element) -> dict[str, Any]:
    preset = str(node.get("preset") or "")
    params = str(node.get("preset-parameters") or "").split()
    choices = [
        {"data": str(choice.get("value") or ""), "label": str(choice.get("name") or choice.get("value") or "")}
        for choice in node.findall("./choice")
    ]
    if preset in SWITCH_PRESETS and not choices:
        choices = [{"data": "0", "label": "Off"}, {"data": "1", "label": "On"}]

    feature: dict[str, Any] = {
        "setting": str(node.get("value") or ""),
        "label": str(node.get("name") or node.get("value") or ""),
        "description": str(node.get("description") or ""),
        "group": str(node.get("group") or ""),
        "submenu": str(node.get("submenu") or ""),
        "preset": preset,
        "choices": choices,
        "order": int(node.get("order") or 0),
    }
    if preset in SLIDER_PRESETS and len(params) >= 3:
        try:
            feature["minimum"] = float(params[0])
            feature["maximum"] = float(params[1])
            feature["step"] = float(params[2])
            feature["suffix"] = params[3] if len(params) >= 4 else ""
            feature["kind"] = "slider"
        except ValueError:
            feature["kind"] = "text"
    elif choices:
        feature["kind"] = "select"
    elif preset in TEXT_PRESETS:
        feature["kind"] = "text"
    elif preset == "shaderset":
        feature["kind"] = "select"
        feature["choices"] = _shader_set_choices()
    else:
        feature["kind"] = "text"
    return feature


def _shader_set_choices() -> list[dict[str, str]]:
    names = {"none"}
    for base in SHADER_CONFIG_DIRS:
        try:
            for config in base.glob("*/rendering-defaults.yml"):
                names.add(config.parent.name)
        except OSError:
            continue
    return [{"data": name, "label": "None" if name == "none" else name} for name in sorted(names)]


def _merge_feature(base: dict[str, Any], override: ET.Element) -> dict[str, Any]:
    result = copy.deepcopy(base)
    mapping = {
        "name": "label",
        "description": "description",
        "group": "group",
        "submenu": "submenu",
        "preset": "preset",
    }
    for attribute, target in mapping.items():
        if attribute in override.attrib:
            result[target] = str(override.get(attribute) or "")
    if "order" in override.attrib:
        result["order"] = int(override.get("order") or 0)
    return result


def _add_node_features(
    result: "OrderedDict[str, dict[str, Any]]",
    node: ET.Element | None,
    shared: dict[str, dict[str, Any]],
) -> None:
    if node is None:
        return
    for name in str(node.get("features") or "").split(","):
        value = name.strip()
        if value and value in shared:
            result[value] = copy.deepcopy(shared[value])
    for child in list(node):
        if child.tag == "sharedFeature":
            value = str(child.get("value") or "")
            if value in shared:
                result[value] = _merge_feature(shared[value], child)
        elif child.tag == "feature":
            feature = _feature_from_element(child)
            if feature["setting"]:
                result[feature["setting"]] = feature


def _feature_definitions(
    features_root: ET.Element,
    system_name: str,
    emulator_name: str,
    core_name: str,
) -> list[dict[str, Any]]:
    shared: dict[str, dict[str, Any]] = {}
    for node in features_root.findall("./sharedFeatures/feature"):
        feature = _feature_from_element(node)
        if feature["setting"]:
            shared[feature["setting"]] = feature

    result: "OrderedDict[str, dict[str, Any]]" = OrderedDict()
    _add_node_features(result, features_root.find("./globalFeatures"), shared)

    feature_emulator = None
    for candidate in features_root.findall("./emulator"):
        if candidate.get("name") == emulator_name:
            feature_emulator = candidate
            break
    _add_node_features(result, feature_emulator, shared)
    _add_node_features(result, _matching_system_node(feature_emulator, system_name), shared)

    feature_core = None
    if feature_emulator is not None:
        for candidate in feature_emulator.findall("./cores/core"):
            if candidate.get("name") == core_name:
                feature_core = candidate
                break
    _add_node_features(result, feature_core, shared)
    _add_node_features(result, _matching_system_node(feature_core, system_name), shared)

    visible = []
    for sequence, feature in enumerate(result.values()):
        value = feature["setting"]
        if (
            feature["preset"] == "hidden"
            or value in STEAM_MODE_EXCLUDED_VALUES
            or value.startswith(STEAM_MODE_EXCLUDED_PREFIXES)
            or feature["group"] in STEAM_MODE_EXCLUDED_GROUPS
        ):
            continue
        feature["sequence"] = sequence
        visible.append(feature)
    return sorted(visible, key=lambda item: (item["order"], item["sequence"]))


def _layer_value(
    config: dict[str, str],
    system_name: str,
    rom: Path,
    game_prefix: str,
    setting: str,
) -> tuple[str | None, str | None, str | None]:
    layers = (
        ("global", f"global.{setting}"),
        ("system", f"{system_name}.{setting}"),
        ("folder", f'{system_name}.folder["{rom.parent}"].{setting}'),
    )
    inherited = None
    inherited_from = None
    for source, key in layers:
        if key in config and config[key] not in {"", "auto"}:
            inherited = config[key]
            inherited_from = source
    direct = config.get(f"{game_prefix}.{setting}")
    if direct in {"", "auto"}:
        direct = None
    return direct, inherited, inherited_from


def _choice_label(feature: dict[str, Any], value: str | None) -> str:
    if value is None:
        return "Auto"
    for choice in feature.get("choices", []):
        if choice["data"] == value:
            return str(choice["label"])
    return value


def _state(appid: object, emulator_override: str = "", core_override: str = "") -> dict[str, Any]:
    matched = _managed_game(appid)
    if matched is None:
        return {"supported": False, "reason": "This is not a Batocera-managed ROM shortcut."}
    unsigned_appid, game = matched
    system_name = str(game.get("system") or "")
    rom = Path(str(game.get("rom") or ""))
    if not system_name or not rom.name:
        return {"supported": False, "reason": "The managed shortcut has incomplete ROM metadata."}

    try:
        systems_root = ET.parse(_first_existing(ES_SYSTEMS_PATHS)).getroot()
        features_root = ET.parse(_first_existing(ES_FEATURES_PATHS)).getroot()
    except (OSError, ET.ParseError) as exc:
        return {"supported": False, "reason": f"Batocera ES configuration is unavailable: {exc}"}

    system = _system_definition(systems_root, system_name)
    if system is None:
        return {"supported": False, "reason": f"ES system '{system_name}' is not installed."}

    emulators, default_emulator, default_core = _emulator_options(system)
    if not emulators:
        return {"supported": False, "reason": f"ES has no emulator choices for '{system_name}'."}

    config = _read_config()
    sanitized_name = rom.name.replace("=", "").replace("#", "")
    game_prefix = f'{system_name}["{sanitized_name}"]'
    emulator_direct, emulator_inherited, emulator_source = _layer_value(
        config, system_name, rom, game_prefix, "emulator"
    )
    core_direct, core_inherited, core_source = _layer_value(
        config, system_name, rom, game_prefix, "core"
    )
    emulator = emulator_override or emulator_direct or emulator_inherited or default_emulator
    valid_emulators = {item["data"]: item for item in emulators}
    if emulator not in valid_emulators:
        emulator = default_emulator
    core_choices = valid_emulators[emulator]["cores"]
    valid_cores = {item["data"] for item in core_choices}
    core = core_override or core_direct or core_inherited
    if core not in valid_cores:
        core = default_core if emulator == default_emulator and default_core in valid_cores else core_choices[0]["data"]

    features = _feature_definitions(features_root, system_name, emulator, core)
    groups: "OrderedDict[str, list[dict[str, Any]]]" = OrderedDict()
    for feature in features:
        direct, inherited, inherited_from = _layer_value(
            config, system_name, rom, game_prefix, feature["setting"]
        )
        feature["directValue"] = direct
        feature["inheritedValue"] = inherited
        feature["inheritedFrom"] = inherited_from
        feature["effectiveValue"] = direct if direct is not None else inherited
        feature["effectiveLabel"] = _choice_label(feature, feature["effectiveValue"])
        section = feature["group"] or feature["submenu"] or "Emulation"
        groups.setdefault(section, []).append(feature)

    emulator_feature = {
        "setting": "emulator",
        "label": "Emulator",
        "description": "Batocera emulator backend. Changing it refreshes the available cores and features.",
        "kind": "select",
        "choices": [{"data": item["data"], "label": item["label"]} for item in emulators],
        "directValue": emulator_direct,
        "inheritedValue": emulator_inherited or default_emulator,
        "inheritedFrom": emulator_source or "default",
        "effectiveValue": emulator,
    }
    core_feature = {
        "setting": "core",
        "label": "Core",
        "description": "Core or implementation used by the selected emulator.",
        "kind": "select",
        "choices": core_choices,
        "directValue": core_direct,
        "inheritedValue": core_inherited or (
            default_core if emulator == default_emulator else core_choices[0]["data"]
        ),
        "inheritedFrom": core_source or "default",
        "effectiveValue": core,
    }
    return {
        "supported": True,
        "reason": "",
        "appid": str(unsigned_appid),
        "managedId": str(game.get("id") or ""),
        "name": str(game.get("name") or rom.stem),
        "system": system_name,
        "systemName": str(game.get("system_name") or system_name),
        "rom": str(rom),
        "configPrefix": game_prefix,
        "applies": "next-launch",
        "emulator": emulator_feature,
        "core": core_feature,
        "groups": [{"name": name, "features": items} for name, items in groups.items()],
    }


def get_state(appid: object, emulator: str = "", core: str = "") -> dict[str, Any]:
    return _state(appid, str(emulator or ""), str(core or ""))


def _find_feature(state: dict[str, Any], setting: str) -> dict[str, Any] | None:
    if setting == "emulator":
        return state["emulator"]
    if setting == "core":
        return state["core"]
    for group in state["groups"]:
        for feature in group["features"]:
            if feature["setting"] == setting:
                return feature
    return None


def _validate_value(feature: dict[str, Any], value: str) -> None:
    if "\n" in value or "\r" in value or len(value) > 1024:
        raise ValueError("invalid setting value")
    choices = feature.get("choices") or []
    if choices and value not in {str(choice["data"]) for choice in choices}:
        raise ValueError(f"unsupported value for {feature['setting']}")
    if feature.get("kind") == "slider":
        try:
            numeric = float(value)
        except ValueError as exc:
            raise ValueError(f"invalid slider value for {feature['setting']}") from exc
        minimum = float(feature["minimum"])
        maximum = float(feature["maximum"])
        step = float(feature["step"])
        if not minimum <= numeric <= maximum:
            raise ValueError(f"value outside slider range for {feature['setting']}")
        if step > 0:
            units = (numeric - minimum) / step
            if not math.isclose(units, round(units), abs_tol=1e-6):
                raise ValueError(f"value does not match slider step for {feature['setting']}")


def set_game_setting(appid: object, setting: object, value: object) -> dict[str, Any]:
    state = _state(appid)
    if not state.get("supported"):
        raise ValueError(str(state.get("reason") or "unsupported game"))
    setting_name = str(setting)
    feature = _find_feature(state, setting_name)
    if feature is None:
        raise ValueError("setting is not available for this emulator/core")
    full_key = f"{state['configPrefix']}.{setting_name}"
    if value is None:
        if setting_name == "emulator":
            settings_remove_many([full_key, f"{state['configPrefix']}.core"])
        else:
            settings_remove(full_key)
    else:
        normalized = str(value)
        _validate_value(feature, normalized)
        if setting_name == "emulator":
            preview = _state(appid, emulator_override=normalized)
            selected_core = str(preview["core"]["effectiveValue"])
            settings_set_many(
                [
                    (full_key, normalized),
                    (f"{state['configPrefix']}.core", selected_core),
                ]
            )
        else:
            settings_set(full_key, normalized)
    return _state(appid)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: emulation_broker ACTION JSON", file=sys.stderr)
        return 2
    action = sys.argv[1]
    payload = json.loads(sys.argv[2])
    if not isinstance(payload, dict):
        raise ValueError("invalid broker request")
    if action == "managed-appids":
        result = managed_appids()
    elif action == "get-state":
        result = get_state(
            payload.get("appid"),
            str(payload.get("emulator") or ""),
            str(payload.get("core") or ""),
        )
    elif action == "set-game-setting":
        result = set_game_setting(
            payload.get("appid"),
            payload.get("setting"),
            payload.get("value"),
        )
    else:
        raise ValueError("unknown broker action")
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
