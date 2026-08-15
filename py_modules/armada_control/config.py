import copy

from .controller import CONTROLLER_TYPES, controller_type, supported as controller_supported
from .back_paddles import get_state as back_paddles_state
from .cpu_limit import get_state as cpu_limit_state
from .fan_control import get_state as fan_control_state
from .joystick_led import COLOR_PRESETS, get_state as joystick_led_state
from .lsfg import get_state as lsfg_state
from .oled_care import get_state as oled_care_state
from .power import (
    backend as power_backend,
    factory_power_defaults,
    parse_power,
    supported as power_supported,
    unsupported_reason as power_unsupported_reason,
)
from .runtime import ensure_runtime
from .steam import installed_games
from .system import cpu_device_class, cpu_governor, cpu_governors, os_version, sleep_mode, sleep_modes, ssh_enabled
from .tweaks import fex_profile_labels, load_fex_contract, load_tweaks

_POWER_STUB = {
    "general": {"default_profile": "balanced"},
    "profiles": {},
    "fan_curves": {},
    "fan": {},
    "underclocks": {},
}

_TWEAKS_STUB = {"global": {"thunks": {}}, "games": {}}


def _safe(label, loader, fallback, warnings):
    try:
        return loader()
    except Exception as exc:
        warnings.append(f"{label}: {exc}")
        return copy.deepcopy(fallback)


def _load_power(warnings):
    if not power_supported():
        return copy.deepcopy(_POWER_STUB), copy.deepcopy(_POWER_STUB)
    try:
        power = parse_power()
        defaults = factory_power_defaults()
        return power, defaults
    except Exception as exc:
        warnings.append(f"Power profiles: {exc}")
        return copy.deepcopy(_POWER_STUB), copy.deepcopy(_POWER_STUB)


def build_config(include_games=True):
    warnings = []
    fex_contract = _safe(
        "FEX profiles",
        load_fex_contract,
        {"defaults": _TWEAKS_STUB, "profiles": {"default": {"label": "Default", "config": {}}}},
        warnings,
    )
    led = _safe(
        "Joystick LEDs",
        joystick_led_state,
        {"supported": False, "native": True, "modes": [], "colors": [], "config": None},
        warnings,
    )
    power, power_defaults = _load_power(warnings)
    runtime = _safe(
        "Steam launch helper",
        ensure_runtime,
        {"supported": False, "path": "", "reason": "helper installation failed"},
        warnings,
    )
    return {
        "power": power,
        "powerDefaults": power_defaults,
        "powerSupported": power_supported(),
        "powerReason": power_unsupported_reason(),
        "powerBackend": power_backend(),
        "cpuLimit": _safe(
            "Adaptive power",
            cpu_limit_state,
            {
                "supported": False,
                "reason": "Adaptive power state is unavailable",
                "kind": "cpu",
                "mode": "off",
                "globalCap": "auto",
                "globalTargetFps": "auto",
                "running": False,
                "temperatureC": None,
                "fanPercent": None,
                "fps": None,
                "currentTdp": None,
                "minTdp": None,
                "maxTdp": None,
                "session": {},
                "dataSource": "Waiting for a game session",
                "modeOptions": ["off", "auto", "adaptive"],
                "capOptions": ["auto", "none", "95", "90", "85", "80", "75", "70", "65", "60", "55", "50"],
                "targetOptions": ["auto", "30", "50", "60", "90", "120"],
            },
            warnings,
        ),
        "fanControl": _safe(
            "Fan control",
            fan_control_state,
            {
                "supported": False,
                "reason": "Fan state is unavailable",
                "controllable": False,
                "name": "",
                "mode": "",
                "percent": None,
                "targetPercent": None,
                "rpm": None,
                "minimumManualPercent": 20,
            },
            warnings,
        ),
        "tweaks": _safe("Game tweaks", load_tweaks, _TWEAKS_STUB, warnings),
        "installedGames": _safe("Steam games", installed_games, [], warnings) if include_games else [],
        "fexProfiles": _safe("FEX profile labels", lambda: fex_profile_labels(fex_contract), {}, warnings),
        "fexRuntimeSupported": bool(runtime.get("supported")),
        "fexRuntimeReason": str(runtime.get("reason") or ""),
        "launchWrapperPath": str(runtime.get("path") or ""),
        "cpuDeviceClass": _safe("Device class", cpu_device_class, "UNKNOWN", warnings),
        "osVersion": _safe("OS version", os_version, "batocera", warnings),
        "sshEnabled": _safe("SSH status", ssh_enabled, False, warnings),
        "sleepMode": _safe("Sleep mode", sleep_mode, "", warnings),
        "sleepModes": _safe("Sleep modes", sleep_modes, [], warnings),
        "cpuGovernor": _safe("CPU governor", cpu_governor, "", warnings),
        "cpuGovernors": _safe("CPU governors", cpu_governors, [], warnings),
        "controllerSupported": controller_supported(),
        "controllerType": _safe("Controller mode", controller_type, "deck-uhid", warnings),
        "controllerTypes": [{"data": key, "label": label} for key, label in CONTROLLER_TYPES.items()],
        "joystickLed": led,
        "joystickLedColors": led.get("colors", []),
        "joystickLedModes": led.get("modes", []),
        "joystickLedPresets": {key: value for key, value in COLOR_PRESETS.items()},
        "oledCare": _safe(
            "OLED care",
            oled_care_state,
            {"supported": False, "panelDetected": False, "reason": "OLED care state is unavailable", "config": {}, "labels": {}, "runtime": {}},
            warnings,
        ),
        "backPaddles": _safe(
            "Back paddles",
            back_paddles_state,
            {"supported": False, "reason": "Back-paddle state is unavailable", "bindings": {}, "slots": [], "actions": []},
            warnings,
        ),
        "lsfg": _safe(
            "LSFG-VK",
            lsfg_state,
            {
                "supported": False,
                "reason": "LSFG-VK state is unavailable",
                "ready": False,
                "perGameSupported": False,
                "dllDetected": False,
                "dllPath": "/userdata/system/wine/lossless-scaling/Lossless.dll",
                "layers": {"native": False, "x64": False},
                "config": {
                    "enabled": False,
                    "multiplier": "2",
                    "flowScale": "0.75",
                    "performanceMode": True,
                    "hdrMode": False,
                    "presentMode": "",
                },
                "enabledAppids": [],
                "wrapperPath": "",
                "legacyPluginDetected": False,
                "legacyConfigDetected": False,
                "legacyLaunchScriptDetected": False,
                "appliesOnNextSteamLaunch": True,
                "perGameAppliesOnNextGameLaunch": True,
            },
            warnings,
        ),
        "warnings": warnings,
    }
