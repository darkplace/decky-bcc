export interface PowerProfile {
  label: string;
  cpu_governor: string;
  cpu_max: string;
  cpu_underclock: string;
  gpu_max: string;
  gpu_min: string;
  fan_curve: string;
}

export interface FanCurve {
  label: string;
  curve: string;
}

export interface PowerConfig {
  general: { default_profile: string };
  profiles: Record<string, PowerProfile>;
  fan_curves: Record<string, FanCurve>;
  fan: Record<string, string>;
  underclocks: Record<string, Record<string, Record<string, string>>>;
}

export interface CpuLimitState {
  supported: boolean;
  reason: string;
  kind: "cpu" | "tdp";
  mode: string;
  globalCap: string;
  globalTargetFps: string;
  running: boolean;
  temperatureC: number | null;
  fanPercent: number | null;
  fps: number | null;
  currentTdp: number | null;
  minTdp: number | null;
  maxTdp: number | null;
  session: Record<string, any>;
  dataSource: string;
  modeOptions: string[];
  capOptions: string[];
  targetOptions: string[];
}

export interface CpuLimitConfig {
  mode: string;
  globalCap: string;
  globalTargetFps: string;
}

export interface FanControlState {
  supported: boolean;
  reason: string;
  controllable: boolean;
  name: string;
  mode: string;
  percent: number | null;
  targetPercent: number | null;
  rpm: number | null;
  minimumManualPercent: number;
  modes?: { data: string; label: string }[];
}

export interface FanControlConfig {
  mode: "silent" | "auto" | "aggressive" | "manual" | "off" | string;
  targetPercent: number;
}

export interface ProfileSummary {
  label: string;
  fan_curve: string;
}

export interface FanSettings {
  ramp_up: number;
  ramp_down: number;
  smoothing: number;
  min_pwm: number;
}

export interface CurvesState {
  fanCurves: Record<string, FanCurve>;
  factoryFanCurves: Record<string, FanCurve>;
  fanSettings: FanSettings;
  factoryFanSettings: FanSettings;
  profiles: Record<string, ProfileSummary>;
  activeProfile: string;
  runtimeMode?: string;
  currentTemp: number | null;
  supported?: boolean;
  reason?: string;
}

export interface GameTweak {
  enabled?: boolean;
  name?: string;
  fexProfile?: string;
  fexConfig?: Record<string, string>;
  thunks?: Record<string, boolean>;
  [key: string]: any;
}

export interface Tweaks {
  global: Record<string, any>;
  games: Record<string, GameTweak>;
}

export interface InstalledGame {
  appid: string;
  name: string;
  nonSteam?: boolean;
}

export interface EmulationChoice {
  data: string;
  label: string;
  cores?: EmulationChoice[];
}

export interface EmulationFeature {
  setting: string;
  label: string;
  description: string;
  kind: "select" | "slider" | "text";
  preset?: string;
  choices: EmulationChoice[];
  directValue: string | null;
  inheritedValue: string | null;
  inheritedFrom: string | null;
  effectiveValue: string | null;
  effectiveLabel?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  suffix?: string;
}

export interface EmulationState {
  supported: boolean;
  reason: string;
  appid?: string;
  managedId?: string;
  name?: string;
  system?: string;
  systemName?: string;
  rom?: string;
  configPrefix?: string;
  applies?: "next-launch";
  emulator?: EmulationFeature;
  core?: EmulationFeature;
  groups?: { name: string; features: EmulationFeature[] }[];
}

export interface FexProfile {
  label: string;
  config?: Record<string, string>;
}

export interface AbsControl {
  value: number;
  min: number;
  max: number;
  flat: number;
  fuzz: number;
  resolution: number;
}

export interface CalibrationState {
  supported: boolean;
  reason: string;
  controls: Record<string, AbsControl>;
  event: any;
  canApply?: boolean;
  backend?: string;
  saved?: boolean;
  params?: Record<string, number>;
}

export interface GameRef {
  appid: string;
  name: string;
  nonSteam?: boolean;
}

export interface JoystickLedSide {
  mode: string;
  color: string;
  brightness: number;
}

export interface JoystickLedConfig {
  left: JoystickLedSide;
  right: JoystickLedSide;
  linked: boolean;
}

export interface JoystickLedState {
  supported: boolean;
  reason?: string;
  modes: DropdownChoice[];
  colors: DropdownChoice[];
  config: JoystickLedConfig;
}

export interface OledCareConfig {
  ENABLED: number;
  DETECT: number;
  STATIC_TIMEOUT: number;
  REFRESHER: number;
  REFRESHER_DURATION: number;
  REFRESHER_PASSES: number;
  SHIFTER: number;
  SHIFTER_RADIUS: number;
  SHIFTER_DURATION: number;
  MURA: number;
}

export interface OledCareRuntime {
  serviceRunning: boolean;
  monitorRunning: boolean;
  idleSeconds: number;
  phase?: string;
  brightnessPct: number | null;
}

export interface OledCareState {
  supported: boolean;
  panelDetected: boolean;
  stockCli?: boolean;
  muraAvailable?: boolean;
  reason?: string;
  config: OledCareConfig;
  labels: Record<string, string>;
  runtime: OledCareRuntime;
}

export interface BackPaddleBindings {
  m1: string;
  m2: string;
  m1_m2: string;
  m1_start: string;
  m1_back: string;
  select_m2: string;
  home_m2: string;
}

export interface BackPaddleActionHealth {
  action: string;
  available: boolean;
  backend: string;
  command: string[];
  reason?: string;
}

export interface BackPaddleState {
  supported: boolean;
  reason?: string;
  warning?: string;
  source?: "rsinput" | "gpio" | "";
  device?: {
    name?: string;
    path?: string;
    m1Code?: number;
    m2Code?: number;
  };
  serviceRunning?: boolean;
  bindings: BackPaddleBindings;
  bindingHealth?: Record<string, BackPaddleActionHealth>;
  slots: DropdownChoice[];
  actions: DropdownChoice[];
}

export interface LsfgConfig {
  enabled: boolean;
  multiplier: string;
  flowScale: string;
  performanceMode: boolean;
  hdrMode: boolean;
  presentMode: string;
}

export interface LsfgState {
  supported: boolean;
  reason: string;
  ready: boolean;
  perGameSupported: boolean;
  dllDetected: boolean;
  dllPath: string;
  layers: { native: boolean; x64: boolean };
  config: LsfgConfig;
  enabledAppids: string[];
  wrapperPath: string;
  legacyPluginDetected: boolean;
  legacyConfigDetected: boolean;
  legacyLaunchScriptDetected: boolean;
  appliesOnNextSteamLaunch: boolean;
  perGameAppliesOnNextGameLaunch: boolean;
}

export interface Config {
  power: PowerConfig;
  powerDefaults: PowerConfig;
  powerSupported: boolean;
  powerReason: string;
  powerBackend?: "odin-power" | "stock" | "none" | string;
  cpuLimit?: CpuLimitState;
  fanControl?: FanControlState;
  tweaks: Tweaks;
  installedGames: InstalledGame[];
  fexProfiles: Record<string, FexProfile>;
  fexRuntimeSupported: boolean;
  fexRuntimeReason: string;
  launchWrapperPath: string;
  cpuDeviceClass: string;
  osVersion: string;
  sshEnabled: boolean;
  sleepMode?: string;
  sleepModes?: DropdownChoice[];
  cpuGovernor?: string;
  cpuGovernors?: string[];
  controllerSupported: boolean;
  controllerType: string;
  controllerTypes: DropdownChoice[];
  joystickLed?: JoystickLedState;
  joystickLedColors?: DropdownChoice[];
  joystickLedModes?: DropdownChoice[];
  joystickLedPresets?: Record<string, string>;
  oledCare?: OledCareState;
  backPaddles?: BackPaddleState;
  lsfg?: LsfgState;
  calibration?: CalibrationState;
  game?: GameRef | null;
  selectedGame?: GameRef | null;
  warnings?: string[];
}

export type Capture = Record<string, { center: number; min: number; max: number; range: number }>;

export interface DropdownChoice {
  data: string;
  label: string;
}
