import { call } from "@decky/api";
import type { BackPaddleBindings, BackPaddleState, CalibrationState, Capture, Config, CpuLimitConfig, CpuLimitState, EmulationState, FanControlConfig, FanControlState, InstalledGame, JoystickLedConfig, JoystickLedState, LsfgConfig, LsfgState, OledCareConfig, OledCareState, PowerConfig, Tweaks } from "./types";

export const getConfig = () => call<[], Config>("get_config");
export const getInstalledGames = () => call<[], InstalledGame[]>("get_installed_games");
export const savePowerConfig = (data: PowerConfig) => call<[PowerConfig], Config>("save_power_config", data);
export const getCpuLimit = () => call<[], CpuLimitState>("get_cpu_limit");
export const saveCpuLimit = (data: CpuLimitConfig) => call<[CpuLimitConfig], CpuLimitState>("save_cpu_limit", data);
export const getFanControl = () => call<[], FanControlState>("get_fan_control");
export const saveFanControl = (data: FanControlConfig) => call<[FanControlConfig], FanControlState>("save_fan_control", data);
export const saveTweaks = (data: Tweaks) => call<[Tweaks], Config>("save_tweaks", data);
export const getCompatApplied = () => call<[], string[]>("get_compat_applied");
let compatAppliedSaveChain = Promise.resolve<unknown>(undefined);
export const saveCompatApplied = (appids: string[]) => {
  const snapshot = [...appids];
  const request = compatAppliedSaveChain
    .catch(() => {})
    .then(() => call<[string[]], string[]>("save_compat_applied", snapshot));
  compatAppliedSaveChain = request;
  return request;
};
export const setSshEnabled = (enabled: boolean) => call<[boolean], boolean>("set_ssh_enabled", enabled);
export const setSleepMode = (value: string) => call<[string], string>("set_sleep_mode", value);
export const setCpuGovernor = (value: string) => call<[string], string>("set_cpu_governor", value);
export const setControllerType = (value: string) => call<[string], string>("set_controller_type", value);
export const getControllerState = () => call<[], CalibrationState>("get_controller_state");
export const saveCalibration = (capture: Capture) => call<[Capture], CalibrationState>("save_calibration", capture);
export const resetCalibration = () => call<[], CalibrationState>("reset_calibration");
export const beginCalibrationSession = (token: string) => call<[string], boolean>("begin_calibration_session", token);
export const endCalibrationSession = (token: string) => call<[string], boolean>("end_calibration_session", token);
export const saveJoystickLed = (data: JoystickLedConfig) => call<[JoystickLedConfig], JoystickLedState>("save_joystick_led", data);
export const saveOledCare = (data: OledCareConfig) => call<[OledCareConfig], OledCareState>("save_oled_care", data);
export const restartOledCare = () => call<[], OledCareState>("restart_oled_care");
export const saveBackPaddles = (data: BackPaddleBindings) => call<[BackPaddleBindings], BackPaddleState>("save_back_paddles", data);
export const saveLsfg = (data: LsfgConfig) => call<[LsfgConfig], LsfgState>("save_lsfg", data);
export const setLsfgGameEnabled = (appid: string, enabled: boolean) => call<[string, boolean], LsfgState>("set_lsfg_game_enabled", appid, enabled);
export const getEmulationManagedAppids = () => call<[], string[]>("get_emulation_managed_appids");
export const getEmulationState = (appid: string, emulator = "", core = "") =>
  call<[string, string, string], EmulationState>("get_emulation_state", appid, emulator, core);
export const setEmulationGameSetting = (appid: string, setting: string, value: string | null) =>
  call<[string, string, string | null], EmulationState>("set_emulation_game_setting", appid, setting, value);
