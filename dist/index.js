const manifest = {"name":"Batocera Control"};
const API_VERSION = 2;
const internalAPIConnection = window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit;
if (!internalAPIConnection) {
    throw new Error('[@decky/api]: Failed to connect to the loader as as the loader API was not initialized. This is likely a bug in Decky Loader.');
}
let api;
try {
    api = internalAPIConnection.connect(API_VERSION, manifest.name);
}
catch {
    api = internalAPIConnection.connect(1, manifest.name);
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version 1. Some features may not work.`);
}
if (api._version != API_VERSION) {
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version ${api._version}. Some features may not work.`);
}
const call = api.call;
const routerHook = api.routerHook;
const toaster = api.toaster;
const definePlugin = (fn) => {
    return (...args) => {
        return fn(...args);
    };
};

const getConfig = () => call("get_config");
const getInstalledGames = () => call("get_installed_games");
const savePowerConfig = (data) => call("save_power_config", data);
const getCpuLimit = () => call("get_cpu_limit");
const saveCpuLimit = (data) => call("save_cpu_limit", data);
const getFanControl = () => call("get_fan_control");
const saveFanControl = (data) => call("save_fan_control", data);
const saveTweaks = (data) => call("save_tweaks", data);
const getCompatApplied = () => call("get_compat_applied");
let compatAppliedSaveChain = Promise.resolve(undefined);
const saveCompatApplied = (appids) => {
    const snapshot = [...appids];
    const request = compatAppliedSaveChain
        .catch(() => { })
        .then(() => call("save_compat_applied", snapshot));
    compatAppliedSaveChain = request;
    return request;
};
const setSshEnabled = (enabled) => call("set_ssh_enabled", enabled);
const setSleepMode = (value) => call("set_sleep_mode", value);
const setCpuGovernor = (value) => call("set_cpu_governor", value);
const setControllerType = (value) => call("set_controller_type", value);
const getControllerState = () => call("get_controller_state");
const saveCalibration = (capture) => call("save_calibration", capture);
const resetCalibration = () => call("reset_calibration");
const beginCalibrationSession = (token) => call("begin_calibration_session", token);
const endCalibrationSession = (token) => call("end_calibration_session", token);
const saveJoystickLed = (data) => call("save_joystick_led", data);
const saveOledCare = (data) => call("save_oled_care", data);
const restartOledCare = () => call("restart_oled_care");
const saveBackPaddles = (data) => call("save_back_paddles", data);
const saveLsfg = (data) => call("save_lsfg", data);
const setLsfgGameEnabled = (appid, enabled) => call("set_lsfg_game_enabled", appid, enabled);
const getEmulationManagedAppids = () => call("get_emulation_managed_appids");
const getEmulationState = (appid, emulator = "", core = "") => call("get_emulation_state", appid, emulator, core);
const setEmulationGameSetting = (appid, setting, value) => call("set_emulation_game_setting", appid, setting, value);

let active = false;
const listeners = new Set();
function setOledScreensaverActive(value) {
    if (active === value)
        return;
    active = value;
    for (const listener of listeners)
        listener(active);
}
function useOledScreensaverActive() {
    const [value, setValue] = SP_REACT.useState(active);
    SP_REACT.useEffect(() => {
        listeners.add(setValue);
        return () => {
            listeners.delete(setValue);
        };
    }, []);
    return value;
}

function controllerButtonsPressed(changes) {
    return Array.isArray(changes) && changes.some((change) => {
        try {
            return BigInt(change?.ulButtons || 0) !== 0n || BigInt(change?.ulUpperButtons || 0) !== 0n;
        }
        catch (error) {
            return Number(change?.ulButtons || 0) !== 0 || Number(change?.ulUpperButtons || 0) !== 0;
        }
    });
}
function OledScreensaverOverlay() {
    const active = useOledScreensaverActive();
    const [clock, setClock] = SP_REACT.useState("");
    SP_REACT.useEffect(() => {
        if (!active)
            return;
        const update = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        update();
        const timer = window.setInterval(update, 30000);
        return () => window.clearInterval(timer);
    }, [active]);
    SP_REACT.useEffect(() => {
        if (!active)
            return;
        const exit = () => setOledScreensaverActive(false);
        const onKey = (event) => {
            if (event.key)
                exit();
        };
        window.addEventListener("keydown", onKey, true);
        let registration;
        const delay = window.setTimeout(() => {
            try {
                registration = window.SteamClient?.Input?.RegisterForControllerStateChanges?.((changes) => {
                    if (controllerButtonsPressed(changes))
                        exit();
                });
            }
            catch (error) { }
        }, 500);
        return () => {
            window.clearTimeout(delay);
            window.removeEventListener("keydown", onKey, true);
            try {
                registration?.unregister?.();
            }
            catch (error) { }
        };
    }, [active]);
    if (!active)
        return null;
    return (SP_JSX.jsxs("div", { "aria-label": "OLED screensaver; press any controller button or touch to exit", onPointerDown: () => setOledScreensaverActive(false), style: {
            position: "fixed",
            inset: 0,
            zIndex: 7003,
            overflow: "hidden",
            background: "#000",
            cursor: "none",
            pointerEvents: "auto",
        }, children: [SP_JSX.jsx("style", { children: `
        @keyframes batocera-control-oled-drift {
          0% { left: 7%; top: 9%; color: #3aa9c9; }
          24% { left: 73%; top: 16%; color: #786bc4; }
          49% { left: 68%; top: 76%; color: #3a9c78; }
          74% { left: 12%; top: 69%; color: #a16d85; }
          100% { left: 7%; top: 9%; color: #3aa9c9; }
        }
        .batocera-control-oled-mark {
          position: absolute;
          width: 20%;
          min-width: 128px;
          max-width: 240px;
          opacity: 0.52;
          animation: batocera-control-oled-drift 34s linear infinite;
          text-align: center;
          letter-spacing: 0.18em;
          font-size: 18px;
          font-weight: 600;
          user-select: none;
          will-change: left, top;
        }
        .batocera-control-oled-clock {
          display: block;
          margin-top: 7px;
          font-size: 13px;
          font-weight: 400;
          letter-spacing: 0.12em;
        }
      ` }), SP_JSX.jsxs("div", { className: "batocera-control-oled-mark", children: ["BATOCERA", SP_JSX.jsx("span", { className: "batocera-control-oled-clock", children: clock })] })] }));
}

function useDebouncedSave(options) {
    const { config, field, snapshot, save, setConfig, onError, delay = 900 } = options;
    const value = config ? config[field] : undefined;
    const saveChain = SP_REACT.useRef(Promise.resolve());
    const revision = SP_REACT.useRef(0);
    SP_REACT.useEffect(() => {
        if (!config || !snapshot.current)
            return;
        const current = JSON.stringify(value);
        if (current === snapshot.current)
            return;
        const request = ++revision.current;
        const savedValue = value;
        const timer = window.setTimeout(() => {
            saveChain.current = saveChain.current.catch(() => { }).then(async () => {
                try {
                    const next = await save(savedValue);
                    if (request !== revision.current)
                        return;
                    snapshot.current = JSON.stringify(next[field]);
                    setConfig((stored) => {
                        if (!stored)
                            return next;
                        if (JSON.stringify(stored[field]) !== current)
                            return stored;
                        return { ...stored, [field]: next[field] };
                    });
                }
                catch (error) {
                    if (request === revision.current)
                        onError?.(error);
                }
            });
        }, delay);
        return () => window.clearTimeout(timer);
    }, [delay, field, onError, save, setConfig, snapshot, value]);
}

function Icon({ path }) {
    return (SP_JSX.jsx("svg", { style: { display: "block" }, width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: path }));
}
const tabIcons = {
    LSFG: (SP_JSX.jsx(Icon, { path: SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("rect", { x: "3", y: "5", width: "13", height: "10", rx: "2" }), SP_JSX.jsx("rect", { x: "8", y: "9", width: "13", height: "10", rx: "2" }), SP_JSX.jsx("path", { d: "m12 12 2 2 3-4" })] }) })),
    Compatibility: (SP_JSX.jsx(Icon, { path: SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("line", { x1: "6", x2: "10", y1: "11", y2: "11" }), SP_JSX.jsx("line", { x1: "8", x2: "8", y1: "9", y2: "13" }), SP_JSX.jsx("line", { x1: "15", x2: "15.01", y1: "12", y2: "12" }), SP_JSX.jsx("line", { x1: "18", x2: "18.01", y1: "10", y2: "10" }), SP_JSX.jsx("path", { d: "M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" })] }) })),
    LEDs: (SP_JSX.jsx(Icon, { path: SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("circle", { cx: "12", cy: "12", r: "4" }), SP_JSX.jsx("path", { d: "M12 2v2" }), SP_JSX.jsx("path", { d: "M12 20v2" }), SP_JSX.jsx("path", { d: "m4.93 4.93 1.41 1.41" }), SP_JSX.jsx("path", { d: "m17.66 17.66 1.41 1.41" }), SP_JSX.jsx("path", { d: "M2 12h2" }), SP_JSX.jsx("path", { d: "M20 12h2" }), SP_JSX.jsx("path", { d: "m6.34 17.66-1.41 1.41" }), SP_JSX.jsx("path", { d: "m19.07 4.93-1.41 1.41" })] }) })),
    OLED: (SP_JSX.jsx(Icon, { path: SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("rect", { width: "18", height: "12", x: "3", y: "6", rx: "2" }), SP_JSX.jsx("path", { d: "M7 18v2" }), SP_JSX.jsx("path", { d: "M17 18v2" }), SP_JSX.jsx("path", { d: "M12 18v2" })] }) })),
    Paddles: (SP_JSX.jsx(Icon, { path: SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("rect", { width: "16", height: "10", x: "4", y: "7", rx: "2" }), SP_JSX.jsx("path", { d: "M8 7V5" }), SP_JSX.jsx("path", { d: "M16 7V5" })] }) })),
    Power: (SP_JSX.jsx(Icon, { path: SP_JSX.jsx(SP_JSX.Fragment, { children: SP_JSX.jsx("path", { d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" }) }) })),
    Advanced: (SP_JSX.jsx(Icon, { path: SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("path", { d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" }), SP_JSX.jsx("circle", { cx: "12", cy: "12", r: "3" })] }) })),
};

function gameDisplayName(game) {
    if (!game?.appid)
        return "";
    const base = game.name || `App ${game.appid}`;
    return game.nonSteam ? `${base} (Non-Steam)` : base;
}
function availableGames(config) {
    const games = new Map();
    for (const game of config.installedGames || []) {
        if (game?.appid) {
            games.set(String(game.appid), {
                appid: String(game.appid),
                name: game.name || `App ${game.appid}`,
                nonSteam: !!game.nonSteam,
            });
        }
    }
    for (const [appid, settings] of Object.entries(config.tweaks?.games || {})) {
        if (!appid)
            continue;
        const name = settings.name || `App ${appid}`;
        if (!games.has(appid)) {
            games.set(appid, { appid, name });
        }
    }
    return Array.from(games.values()).sort((a, b) => gameDisplayName(a).localeCompare(gameDisplayName(b)));
}
function editTargetOptions(config) {
    return [
        { data: "", label: "Default" },
        ...availableGames(config).map((game) => ({ data: game.appid, label: gameDisplayName(game) })),
    ];
}
function currentGame() {
    const running = DFL.Router?.MainRunningApp || window.Router?.MainRunningApp;
    const appid = running?.appid;
    if (!appid)
        return null;
    const id = String(appid);
    let name = running?.display_name || running?.displayName || "";
    try {
        const details = window.appDetailsStore?.GetAppDetails?.(Number(id));
        name = details?.strDisplayName || details?.strName || details?.name || name;
    }
    catch (error) {
    }
    return { appid: id, name: name || `App ${id}` };
}

const styles = `
      .armada-control-tabs {
        height: 95%;
        width: 316px;
        position: fixed;
        margin-top: -12px;
        margin-left: -8px;
        overflow: hidden;
      }
      .armada-control-tabs > div > div:first-child::before {
        background: #0D141C;
        box-shadow: none;
        backdrop-filter: none;
      }
      .armada-control-tabs [role="tabpanel"] {
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      .armada-control-tabs .armada-control-tab-content {
        padding-bottom: 24px;
      }
      .armada-control-tabs .armada-slider-field {
        width: 100%;
        max-width: none;
        overflow: hidden;
      }
      .armada-control-tabs .armada-slider-field * {
        min-width: 0 !important;
        max-width: 100% !important;
      }
      .armada-control-tabs .armada-reset-row {
        padding: 0 14px 8px;
      }
      .armada-control-tabs .armada-compat-note {
        box-sizing: border-box;
        width: 100%;
        padding: 8px 16px 8px;
        font-size: 12px;
        line-height: 16px;
        opacity: 0.62;
        text-align: left;
        justify-content: flex-start;
        align-self: stretch;
      }
    `;

function SelectEdit({ label, value, options, onChange, labelBelow, disabled }) {
    const rgOptions = options.map((option) => (typeof option === "string" ? { data: option, label: option } : option));
    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: label === undefined ? (SP_JSX.jsx(DFL.Dropdown, { disabled: disabled, selectedOption: value, rgOptions: rgOptions, onChange: (option) => onChange(option.data) })) : labelBelow ? (SP_JSX.jsx(DFL.Field, { label: label, childrenLayout: "below", childrenContainerWidth: "max", disabled: disabled, children: SP_JSX.jsx(DFL.Dropdown, { disabled: disabled, selectedOption: value, rgOptions: rgOptions, onChange: (option) => onChange(option.data) }) })) : (SP_JSX.jsx(DFL.DropdownItemInternal, { disabled: disabled, childrenContainerWidth: "max", label: label, selectedOption: value, rgOptions: rgOptions, onChange: (option) => onChange(option.data) })) }));
}
function ToggleRow({ label, value, onChange, disabled, description }) {
    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: label, description: description, checked: !!value, disabled: disabled, onChange: onChange }) }));
}
function SliderEdit({ label, value, min, max, step, onChange, format }) {
    const numeric = Number(value);
    const suffix = format && Number.isFinite(numeric) ? ` (${format(numeric)})` : "";
    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { className: "armada-slider-field", children: SP_JSX.jsx(DFL.SliderField, { label: `${label}${suffix}`, value: Number.isFinite(numeric) ? numeric : min, min: min, max: max, step: step, showValue: true, onChange: (next) => onChange(next) }) }) }));
}

function BackPaddles({ config, setConfig }) {
    const revision = SP_REACT.useRef(0);
    const saveChain = SP_REACT.useRef(Promise.resolve());
    const bp = config.backPaddles;
    if (!bp?.supported) {
        return SP_JSX.jsx(DFL.PanelSection, { title: "Back paddles", children: SP_JSX.jsx(DFL.Field, { label: "Unavailable", description: bp?.reason || "Rear-paddle input was not detected." }) });
    }
    const bindings = bp.bindings;
    const slots = bp.slots || [];
    const actions = bp.actions || [];
    const health = bp.bindingHealth || {};
    const mouseModeAssigned = Object.values(bindings).includes("mouse_toggle");
    const backend = bp.source === "rsinput" ? "RSInput events + combos" : "Legacy GPIO + combos";
    const device = [bp.device?.name, bp.device?.path].filter(Boolean).join(" — ");
    const codeMap = bp.device?.m1Code != null && bp.device?.m2Code != null
        ? `M1 code ${bp.device.m1Code}, M2 code ${bp.device.m2Code}`
        : "";
    const activeHealth = Object.entries(bindings)
        .filter(([, action]) => action && action !== "none")
        .map(([slot, action]) => {
        const info = health[slot];
        if (!info)
            return `${slot}→${action}`;
        if (!info.available)
            return `${slot}→${action} unavailable`;
        return `${slot}→${info.backend}`;
    });
    const apply = (next) => {
        const request = ++revision.current;
        setConfig((current) => (current && current.backPaddles ? { ...current, backPaddles: { ...current.backPaddles, bindings: next } } : current));
        saveChain.current = saveChain.current.catch(() => { }).then(async () => {
            try {
                const state = await saveBackPaddles(next);
                if (request === revision.current) {
                    setConfig((current) => (current ? { ...current, backPaddles: state } : current));
                }
            }
            catch (error) {
                console.error(error);
            }
        });
    };
    const update = (slot, action) => {
        apply({ ...bindings, [slot]: action });
    };
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "Back paddles (M1 / M2)", children: [SP_JSX.jsx(DFL.Field, { label: backend, description: [device || "AYN rear-paddle input", codeMap].filter(Boolean).join(" · "), children: "Tap actions fire on release. Chords fire once while held. The listener observes without grabbing, so Steam, ES, and emulators still receive both paddles." }), bp.source === "rsinput" ? (SP_JSX.jsx(DFL.Field, { label: "Batocera hotkeys coexist", description: "Home/Hotkey + paddle is left to Batocera and suppresses the paddle tap action, preventing both mappings from firing together." })) : null, activeHealth.length ? (SP_JSX.jsx(DFL.Field, { label: "Binding targets", description: activeHealth.join(" · ") })) : null] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Bindings", children: [bp.warning ? SP_JSX.jsx(DFL.Field, { label: "Warning", description: bp.warning }) : null, mouseModeAssigned ? (SP_JSX.jsx(DFL.Field, { label: "Mouse mode pauses gamepad navigation", description: "Press the assigned paddle again to restore normal controls before changing or clearing its binding." })) : null, slots.map((slot) => (SP_JSX.jsx(SelectEdit, { label: slot.label, value: bindings[slot.data] || "none", options: actions, onChange: (value) => update(slot.data, value) }, slot.data)))] })] }));
}

const GLOBAL_RESOLUTION_KEY = "gamescope_game_resolution_global";
function getGlobalResolution() {
    return window.settingsStore?.GetClientSetting?.(GLOBAL_RESOLUTION_KEY)?.[0] || "Default";
}
async function setGlobalResolution(value) {
    const setting = window.settingsStore?.GetClientSetting?.(GLOBAL_RESOLUTION_KEY);
    const setter = setting?.[1];
    if (!setter)
        throw new Error("Steam settings are unavailable");
    await Promise.resolve(setter(value));
    return getGlobalResolution();
}

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
function update(obj, path, value) {
    const next = clone(obj);
    let cursor = next;
    for (let i = 0; i < path.length - 1; i += 1)
        cursor = cursor[path[i]];
    cursor[path[path.length - 1]] = value;
    return next;
}
function titleCase(value) {
    const text = String(value || "");
    return text.charAt(0).toUpperCase() + text.slice(1);
}

const apps = () => window.SteamClient?.Apps;
const settings = () => window.SteamClient?.Settings;
// Keep in sync with PROTON_TOOL_NAME (build) and PROTON_11_STABLE (armada-fixups).
const DEFAULT_WINDOWS_COMPAT_TOOL = "proton-cachyos-11.0-arm64";
const USE_DEFAULT_COMPAT = "__armada_default__";
const FOLLOW_STEAM_COMPAT = "__steam_default__";
let windowsCompatTool = DEFAULT_WINDOWS_COMPAT_TOOL;
let autoApplyCompat = true;
let launchWrapper = "";
const handledAppids = new Set();
let protonToolsCache = [];
let protonToolsCachedAt = 0;
let protonToolsRequest = null;
function setWindowsCompatTool(toolName) {
    windowsCompatTool = toolName || DEFAULT_WINDOWS_COMPAT_TOOL;
}
function configureCompatPolicy(toolName, autoApply, appids, wrapperPath = "") {
    setWindowsCompatTool(toolName);
    autoApplyCompat = autoApply;
    launchWrapper = wrapperPath === "/userdata/system/bin/batocera-control-game-launch" ? wrapperPath : "";
    handledAppids.clear();
    for (const appid of appids) {
        const id = String(appid);
        if (/^\d+$/.test(id))
            handledAppids.add(id);
    }
}
function setAutoApplyCompat(enabled) {
    autoApplyCompat = enabled;
}
function handledGameAppids() {
    return Array.from(handledAppids).sort((a, b) => Number(a) - Number(b));
}
function markCompatHandled(appid) {
    const size = handledAppids.size;
    handledAppids.add(appid);
    return handledAppids.size !== size;
}
function mapCompatTools(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .map((tool) => ({
        id: String(tool?.strToolName ?? tool?.strName ?? tool?.name ?? ""),
        label: String(tool?.strDisplayName ?? tool?.strToolName ?? tool?.strName ?? ""),
    }))
        .filter((tool) => tool.id);
}
async function getProtonTools(refresh = false) {
    if (!refresh && protonToolsCache.length && Date.now() - protonToolsCachedAt < 5000)
        return protonToolsCache;
    if (protonToolsRequest)
        return protonToolsRequest;
    protonToolsRequest = (async () => {
        try {
            // Steam exposes Proton globally; per-app Linux runtimes only appear in available tools.
            const tools = mapCompatTools(await settings()?.GetGlobalCompatTools?.());
            if (tools.length) {
                protonToolsCache = tools;
                protonToolsCachedAt = Date.now();
            }
            return tools.length ? tools : protonToolsCache;
        }
        catch (error) {
            return protonToolsCache;
        }
        finally {
            protonToolsRequest = null;
        }
    })();
    return protonToolsRequest;
}
// A game's supported tools per Steam's OS filtering (Proton, plus SLR for a Linux depot); for the per-game picker.
async function getAppCompatTools(appid) {
    try {
        return mapCompatTools(await apps()?.GetAvailableCompatTools?.(Number(appid)));
    }
    catch (error) {
        return [];
    }
}
function appDetails(appid) {
    try {
        return window.appDetailsStore?.GetAppDetails?.(Number(appid)) || null;
    }
    catch (error) {
        return null;
    }
}
async function resolveCompatState(appid) {
    const details = await resolveDetails(appid);
    if (!details)
        return null;
    return {
        tool: String(details.strCompatToolName || ""),
        priority: Number(details.nCompatToolPriority || 0),
    };
}
function compatSelection(state) {
    if (!state || !state.tool || state.priority < 250)
        return FOLLOW_STEAM_COMPAT;
    return state.tool === windowsCompatTool ? USE_DEFAULT_COMPAT : state.tool;
}
async function specifyCompatTool(appid, toolName) {
    const store = apps();
    if (!store?.SpecifyCompatTool)
        throw new Error("Steam compatibility settings are unavailable");
    await store.SpecifyCompatTool(Number(appid), toolName);
}
const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
function requestAppDetails(appid) {
    // Not in @decky/ui's type defs (incomplete); exists on the runtime store.
    try {
        window.appDetailsStore?.RequestAppDetails?.(Number(appid));
    }
    catch (error) {
    }
}
// Absolute path: launch options run via a shell without /usr/libexec on PATH.
const LEGACY_LAUNCH_WRAPPERS = ["/usr/libexec/armada/armada-game-launch"];
const COMMAND_TOKEN = "%command%";
// null when already wrapped (idempotent); preserves user options around %command%.
function wrapLaunchOptions(current) {
    const opts = current || "";
    if (!launchWrapper)
        return null;
    if (opts.includes(launchWrapper))
        return null;
    for (const legacy of LEGACY_LAUNCH_WRAPPERS) {
        if (opts.includes(legacy))
            return opts.split(legacy).join(launchWrapper);
    }
    if (opts.includes(COMMAND_TOKEN)) {
        return opts.replace(COMMAND_TOKEN, `${launchWrapper} ${COMMAND_TOKEN}`);
    }
    // No %command%: Steam appends bare options as args, so keep them after it.
    const trimmed = opts.trim();
    return trimmed
        ? `${launchWrapper} ${COMMAND_TOKEN} ${trimmed}`
        : `${launchWrapper} ${COMMAND_TOKEN}`;
}
async function resolveDetails(appid, attempts = 5) {
    for (let i = 0; i < attempts; i++) {
        const details = await subscribeAppDetails(appid);
        if (details)
            return details;
        requestAppDetails(appid);
        await delay(250);
    }
    return appDetails(appid);
}
const LSFG_WRAPPER_PATH = "/userdata/system/bin/batocera-control-lsfg-launch";
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function updateLsfgLaunchOptions(current, appid, enabled, wrapperPath) {
    if (!/^\d+$/.test(appid) || wrapperPath !== LSFG_WRAPPER_PATH) {
        throw new Error("The per-game LSFG launch helper is unavailable");
    }
    const fragment = `${wrapperPath} --appid ${appid} ${COMMAND_TOKEN}`;
    // Remove the managed prefix independently of %command%. Another plugin may
    // have inserted its own wrapper between ours and %command% after we saved it.
    const staleWrapper = new RegExp(`${escapeRegExp(wrapperPath)}\\s+--appid\\s+\\d+\\s*`, "g");
    let next = String(current || "").replace(staleWrapper, "").trim();
    if (!enabled)
        return next === COMMAND_TOKEN ? "" : next;
    if (next.includes(COMMAND_TOKEN))
        return next.replace(COMMAND_TOKEN, fragment);
    return next ? `${fragment} ${next}` : fragment;
}
async function setLsfgLaunchOption(appid, enabled, wrapperPath) {
    const steamApps = apps();
    if (!steamApps?.SetAppLaunchOptions)
        throw new Error("Steam launch-option controls are unavailable");
    const details = await resolveDetails(appid);
    if (!details)
        throw new Error("Steam has not loaded this game's details yet");
    const current = String(details.strLaunchOptions || "");
    const next = updateLsfgLaunchOptions(current, appid, enabled, wrapperPath);
    if (next === current)
        return;
    await steamApps.SetAppLaunchOptions(Number(appid), next);
    requestAppDetails(appid);
}
function subscribeAppDetails(appid) {
    return waitForAppDetails(appid, () => true).promise;
}
function resolveSettledCompatDetails(appid) {
    return waitForAppDetails(appid, () => true, 1500, 250, true).promise;
}
// app_type: 1 = Game. Polls because overviews load a beat after plugin init.
async function resolveOverviewType(appid) {
    for (let i = 0; i < 5; i++) {
        try {
            const type = window.appStore?.GetAppOverviewByAppID?.(Number(appid))?.app_type;
            if (type != null)
                return type;
        }
        catch (error) {
        }
        await delay(1000);
    }
    return null;
}
async function resolveCompatRoute(currentTool) {
    if (!currentTool)
        return "linux";
    const protonTools = await getProtonTools();
    if (!protonTools.length)
        return null;
    return protonTools.some((tool) => tool.id === currentTool) ? "windows" : "linux";
}
function waitForAppDetails(appid, accepts, timeoutMs = 1000, refreshMs = 0, settleEmpty = false) {
    let cancel = () => { };
    const promise = new Promise((resolve) => {
        const store = apps();
        if (!store?.RegisterForAppDetails) {
            resolve(null);
            return;
        }
        let done = false;
        let handle;
        let timeout;
        let refresh;
        let emptyTimer;
        let unregisterPending = false;
        const finish = (details) => {
            if (done)
                return;
            done = true;
            if (timeout !== undefined)
                window.clearTimeout(timeout);
            if (refresh !== undefined)
                window.clearInterval(refresh);
            if (emptyTimer !== undefined)
                window.clearTimeout(emptyTimer);
            if (handle) {
                try {
                    handle.unregister?.();
                }
                catch (error) {
                }
            }
            else {
                unregisterPending = true;
            }
            resolve(details || null);
        };
        cancel = () => finish(null);
        const accept = (details) => {
            if (!details || !accepts(details))
                return;
            if (!settleEmpty || String(details.strCompatToolName || "")) {
                finish(details);
            }
            else if (emptyTimer === undefined) {
                emptyTimer = window.setTimeout(() => finish(details), 500);
            }
        };
        try {
            handle = store.RegisterForAppDetails(Number(appid), accept);
            if (unregisterPending)
                handle?.unregister?.();
        }
        catch (error) {
            finish(null);
            return;
        }
        if (!done) {
            timeout = window.setTimeout(() => finish(null), timeoutMs);
            if (refreshMs > 0)
                refresh = window.setInterval(() => requestAppDetails(appid), refreshMs);
        }
    });
    return { promise, cancel };
}
async function clearCompatToolAndResolveRoute(appid) {
    const waiter = waitForAppDetails(appid, (details) => Number(details.nCompatToolPriority || 0) < 250, 5000, 250, true);
    try {
        await specifyCompatTool(appid, "");
    }
    catch (error) {
        waiter.cancel();
        return null;
    }
    requestAppDetails(appid);
    const details = await waiter.promise;
    if (!details)
        return null;
    return resolveCompatRoute(String(details.strCompatToolName || ""));
}
async function applyCompatDefaultForRoute(appid, route) {
    if (route === null)
        return false;
    if (route === "linux") {
        markCompatHandled(appid);
        return true;
    }
    const protonTools = await getProtonTools();
    if (!protonTools.some((tool) => tool.id === windowsCompatTool))
        return false;
    const waiter = waitForAppDetails(appid, (details) => Number(details.nCompatToolPriority || 0) >= 250
        && String(details.strCompatToolName || "") === windowsCompatTool, 5000, 250);
    try {
        await specifyCompatTool(appid, windowsCompatTool);
    }
    catch (error) {
        waiter.cancel();
        return false;
    }
    requestAppDetails(appid);
    if (!(await waiter.promise))
        return false;
    markCompatHandled(appid);
    return true;
}
// Wraps only a confirmed game (app_type 1), never a tool/runtime. Returns false if the
// overview/details were still cold, so the caller can retry; true once resolved.
async function applyLaunchWrapperToGame(appid) {
    if (!launchWrapper)
        return true;
    const type = await resolveOverviewType(appid);
    if (type === null)
        return false;
    if (type !== 1)
        return true;
    const details = await resolveDetails(appid);
    if (!details)
        return false;
    const next = wrapLaunchOptions(String(details.strLaunchOptions || ""));
    if (next === null)
        return true;
    try {
        await apps()?.SetAppLaunchOptions?.(Number(appid), next);
    }
    catch (error) {
    }
    return true;
}
async function applyWindowsCompatDefault(appid) {
    const type = await resolveOverviewType(appid);
    if (type === null)
        return false;
    if (type !== 1)
        return true;
    if (handledAppids.has(appid))
        return true;
    const details = await resolveSettledCompatDetails(appid);
    if (!details)
        return false;
    if (!autoApplyCompat || Number(details.nCompatToolPriority || 0) >= 250) {
        markCompatHandled(appid);
        return true;
    }
    const route = await resolveCompatRoute(String(details.strCompatToolName || ""));
    return applyCompatDefaultForRoute(appid, route);
}
async function applyGamePolicy(appid) {
    const wrapped = await applyLaunchWrapperToGame(appid);
    const compat = await applyWindowsCompatDefault(appid);
    return wrapped && compat;
}
async function applyGamePolicyWithRetries(appid, onHandledChange) {
    const before = handledAppids.size;
    for (let attempt = 0; attempt < 6; attempt++) {
        if (await applyGamePolicy(appid)) {
            if (handledAppids.size !== before)
                onHandledChange();
            return;
        }
        await delay(5000);
    }
}
async function migrateWindowsCompatTool(appids, oldTool, newTool) {
    if (!oldTool || oldTool === newTool)
        return;
    const protonTools = await getProtonTools();
    if (!protonTools.some((tool) => tool.id === newTool))
        return;
    setWindowsCompatTool(newTool);
    let next = 0;
    const worker = async () => {
        while (next < appids.length) {
            const appid = appids[next++];
            const type = await resolveOverviewType(appid);
            if (type !== 1)
                continue;
            const details = await resolveDetails(appid);
            if (!details)
                continue;
            if (Number(details.nCompatToolPriority || 0) < 250)
                continue;
            if (String(details.strCompatToolName || "") !== oldTool)
                continue;
            for (let attempt = 0; attempt < 3; attempt++) {
                if (await applyCompatDefaultForRoute(appid, "windows"))
                    break;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(10, appids.length) }, worker));
}
async function resetCompatToolToDefault(appid) {
    const type = await resolveOverviewType(appid);
    if (type !== 1)
        return "";
    const route = await clearCompatToolAndResolveRoute(appid);
    const applied = await applyCompatDefaultForRoute(appid, route);
    return applied && route === "windows" ? windowsCompatTool : "";
}
async function resetAllCompatTools(appids) {
    await getProtonTools(true);
    let next = 0;
    const worker = async () => {
        while (next < appids.length) {
            const appid = appids[next++];
            const type = await resolveOverviewType(appid);
            if (type !== 1)
                continue;
            await applyCompatDefaultForRoute(appid, await clearCompatToolAndResolveRoute(appid));
        }
    };
    await Promise.all(Array.from({ length: Math.min(10, appids.length) }, worker));
}
// Unknown app_type (overview not loaded yet) is treated as a game so a real game is never hidden.
function isGameApp(appid) {
    try {
        const type = window.appStore?.GetAppOverviewByAppID?.(Number(appid))?.app_type;
        return type == null || type === 1;
    }
    catch (error) {
        return true;
    }
}
async function resolveGameAppids(appids) {
    const games = [];
    let next = 0;
    const worker = async () => {
        while (next < appids.length) {
            const appid = appids[next++];
            if (await resolveOverviewType(appid) === 1)
                games.push(appid);
        }
    };
    await Promise.all(Array.from({ length: Math.min(10, appids.length) }, worker));
    return games;
}
// Manifests include tools/runtimes, so type-check each; cold overviews are retried across rounds, not dropped.
async function sweepInstalledGames(appids) {
    const installed = new Set(appids);
    for (const appid of handledAppids) {
        if (!installed.has(appid))
            handledAppids.delete(appid);
    }
    let pending = appids.filter(isGameApp);
    for (let round = 0; round < 6 && pending.length; round++) {
        if (round > 0)
            await delay(5000);
        const unresolved = [];
        let next = 0;
        const worker = async () => {
            while (next < pending.length) {
                const appid = pending[next++];
                if (!(await applyGamePolicy(appid)))
                    unresolved.push(appid);
            }
        };
        await Promise.all(Array.from({ length: Math.min(10, pending.length) }, worker));
        pending = unresolved;
    }
}
function registerDownloadWatcher(onHandledChange) {
    const downloads = window.SteamClient?.Downloads;
    if (!downloads?.RegisterForDownloadItems)
        return () => { };
    let timer;
    const pending = new Set();
    const flush = () => {
        timer = undefined;
        for (const appid of pending) {
            applyGamePolicyWithRetries(appid, onHandledChange);
        }
        pending.clear();
    };
    // Each queue item is { remote_client_id, item_data: [{ appid, ... }] } - the
    // appids live in the item_data entries, not on the item itself.
    const handle = downloads.RegisterForDownloadItems((_paused, items) => {
        if (!Array.isArray(items))
            return;
        for (const item of items) {
            const entries = item?.item_data;
            if (!entries || typeof entries !== "object")
                continue;
            for (const entry of Object.values(entries)) {
                const appid = String(entry?.appid ?? "");
                if (appid && appid !== "0" && isGameApp(appid))
                    pending.add(appid);
            }
        }
        if (timer === undefined)
            timer = window.setTimeout(flush, 1500);
    });
    return () => {
        if (timer !== undefined)
            window.clearTimeout(timer);
        try {
            handle?.unregister?.();
        }
        catch (error) {
        }
    };
}

const resolutionOptions = [
    { data: "Default", label: "Default" },
    { data: "Native", label: "Native" },
    { data: "1280x720", label: "1280x720" },
    { data: "960x540", label: "960x540" },
];
const fexKnobs = [
    { key: "TSOEnabled", label: "TSO Enabled" },
    { key: "X87ReducedPrecision", label: "X87 Reduced Precision" },
    { key: "Multiblock", label: "Multiblock" },
    { key: "VectorTSOEnabled", label: "Vector TSO Enabled" },
    { key: "MemcpySetTSOEnabled", label: "Memcpy Set TSO Enabled" },
    { key: "HalfBarrierTSOEnabled", label: "Half Barrier TSO Enabled" },
];
const thunkModules = [
    { module: "Vulkan", label: "Host Vulkan" },
    { module: "GL", label: "Host OpenGL" },
    { module: "EGL", label: "Host EGL" },
    { module: "asound", label: "Host ALSA" },
    { module: "drm", label: "Host DRM" },
    { module: "WaylandClient", label: "Host Wayland" },
];
function ConfirmResetAllModal({ closeModal, onConfirm }) {
    const confirm = () => {
        closeModal?.();
        onConfirm();
    };
    return (SP_JSX.jsxs(DFL.ModalRoot, { onCancel: closeModal, children: [SP_JSX.jsx(DFL.DialogBody, { children: "This removes all per-game Armada settings, resets resolution overrides, applies the default Proton where Steam selects Proton, and leaves native Linux selections with Steam." }), SP_JSX.jsxs(DFL.DialogFooter, { children: [SP_JSX.jsx(DFL.DialogButton, { onClick: confirm, children: "Reset All Games" }), SP_JSX.jsx(DFL.DialogButton, { onClick: closeModal, children: "Cancel" })] })] }));
}
function EnvVarModal({ closeModal, initialKey, initialValue, onSave, onDelete, }) {
    const [key, setKey] = SP_REACT.useState(initialKey);
    const [value, setValue] = SP_REACT.useState(initialValue);
    const [nameError, setNameError] = SP_REACT.useState("");
    const save = () => {
        const name = key.trim();
        if (!name || name.includes("=") || name.includes("\0")) {
            setNameError("Invalid name: must be non-empty, no '='");
            return;
        }
        onSave(name, value);
        closeModal?.();
    };
    return (SP_JSX.jsxs(DFL.ModalRoot, { onCancel: closeModal, children: [SP_JSX.jsxs(DFL.DialogBody, { children: [SP_JSX.jsx(DFL.TextField, { label: "Name", value: key, onChange: (event) => setKey(event.target.value) }), nameError ? SP_JSX.jsx(DFL.Field, { description: nameError }) : null, SP_JSX.jsx(DFL.TextField, { label: "Value", value: value, onChange: (event) => setValue(event.target.value) })] }), SP_JSX.jsx(DFL.DialogFooter, { children: SP_JSX.jsxs(DFL.Focusable, { style: { display: "flex", flexDirection: "row", gap: "8px", width: "100%" }, children: [SP_JSX.jsx(DFL.DialogButton, { onClick: save, children: "Save" }), onDelete ? (SP_JSX.jsx(DFL.DialogButton, { onClick: () => {
                                onDelete();
                                closeModal?.();
                            }, children: "Delete" })) : null, SP_JSX.jsx(DFL.DialogButton, { onClick: closeModal, children: "Cancel" })] }) })] }));
}
function Compatibility({ config, setConfig }) {
    const [resolution, setResolution] = SP_REACT.useState("Default");
    const [defaultResolution, setDefaultResolution] = SP_REACT.useState(getGlobalResolution());
    const [resolutionMessage, setResolutionMessage] = SP_REACT.useState("");
    const [resettingAll, setResettingAll] = SP_REACT.useState(false);
    const [customSelected, setCustomSelected] = SP_REACT.useState(false);
    const [showThunks, setShowThunks] = SP_REACT.useState(false);
    const [showEnv, setShowEnv] = SP_REACT.useState(false);
    const [compatTools, setCompatTools] = SP_REACT.useState([]);
    const [perGameTools, setPerGameTools] = SP_REACT.useState([]);
    const [currentTool, setCurrentTool] = SP_REACT.useState("");
    const [globalTool, setGlobalTool] = SP_REACT.useState(String(config.tweaks?.global?.windowsCompatTool || DEFAULT_WINDOWS_COMPAT_TOOL));
    const runtimeGame = config.game;
    const games = availableGames(config);
    const selectedGame = config.selectedGame || runtimeGame || null;
    const game = selectedGame;
    const selectedAppidRef = SP_REACT.useRef("");
    selectedAppidRef.current = game?.appid || "";
    const tweaks = config.tweaks;
    const apps = window.SteamClient?.Apps;
    const persistHandledGames = () => saveCompatApplied(handledGameAppids()).catch(() => { });
    SP_REACT.useEffect(() => {
        let cancelled = false;
        async function loadResolution() {
            if (!game?.appid || !apps?.GetResolutionOverrideForApp) {
                setResolution("Default");
                setResolutionMessage("");
                return;
            }
            try {
                const current = await apps.GetResolutionOverrideForApp(Number(game.appid));
                if (!cancelled) {
                    setResolution(current || "Default");
                    setResolutionMessage("");
                }
            }
            catch (error) {
                if (!cancelled)
                    setResolutionMessage("Resolution override is unavailable");
            }
        }
        loadResolution();
        return () => {
            cancelled = true;
        };
    }, [apps, game?.appid]);
    SP_REACT.useEffect(() => {
        setCustomSelected(false);
    }, [game?.appid]);
    SP_REACT.useEffect(() => {
        let cancelled = false;
        getProtonTools().then((tools) => {
            if (!cancelled)
                setCompatTools(tools);
        });
        return () => {
            cancelled = true;
        };
    }, []);
    SP_REACT.useEffect(() => {
        if (!game?.appid) {
            setCurrentTool("");
            setPerGameTools([]);
            return;
        }
        const appid = game.appid;
        let cancelled = false;
        setCurrentTool(FOLLOW_STEAM_COMPAT);
        resolveCompatState(appid).then((state) => {
            if (!cancelled)
                setCurrentTool(compatSelection(state));
        });
        getAppCompatTools(appid).then((tools) => {
            if (!cancelled)
                setPerGameTools(tools);
        });
        return () => {
            cancelled = true;
        };
    }, [game?.appid]);
    SP_REACT.useEffect(() => {
        if (!apps?.RegisterForAppOverviewChanges)
            return;
        let cancelled = false;
        let timer;
        const handle = apps.RegisterForAppOverviewChanges(() => {
            const appid = selectedAppidRef.current;
            if (!appid || cancelled)
                return;
            if (timer !== undefined)
                window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                resolveCompatState(appid).then((state) => {
                    if (!cancelled && selectedAppidRef.current === appid)
                        setCurrentTool(compatSelection(state));
                }).catch(() => { });
            }, 250);
        });
        return () => {
            cancelled = true;
            if (timer !== undefined)
                window.clearTimeout(timer);
            try {
                handle?.unregister?.();
            }
            catch (error) {
            }
        };
    }, [apps]);
    SP_REACT.useEffect(() => {
        setDefaultResolution(getGlobalResolution());
    }, []);
    const gameSettings = game?.appid ? tweaks.games[game.appid] || {} : {};
    const editingDefault = !game?.appid;
    const values = editingDefault ? tweaks.global : { ...tweaks.global, ...gameSettings };
    const patchSettings = (patch) => {
        setConfig((current) => {
            if (!current)
                return current;
            const next = clone(current);
            if (editingDefault) {
                Object.assign(next.tweaks.global, patch);
            }
            else if (game?.appid) {
                const existing = next.tweaks.games[game.appid] || {};
                next.tweaks.games[game.appid] = { ...existing, name: game.name || "", ...patch };
            }
            return next;
        });
    };
    const resetGame = async () => {
        if (!game?.appid)
            return;
        const appid = game.appid;
        setConfig((current) => {
            if (!current)
                return current;
            const next = clone(current);
            delete next.tweaks.games[appid];
            return next;
        });
        try {
            const tool = await resetCompatToolToDefault(appid);
            setCurrentTool(tool === globalTool ? USE_DEFAULT_COMPAT : tool || FOLLOW_STEAM_COMPAT);
            persistHandledGames();
        }
        catch (error) {
        }
        if (apps?.SetAppResolutionOverride) {
            try {
                await apps.SetAppResolutionOverride(Number(appid), "Default");
                setResolution("Default");
                setResolutionMessage("");
            }
            catch (error) {
            }
        }
    };
    const setSteamResolution = async (value) => {
        setResolution(value);
        if (!game?.appid || !apps?.SetAppResolutionOverride)
            return;
        try {
            await apps.SetAppResolutionOverride(Number(game.appid), value);
            setResolutionMessage("");
        }
        catch (error) {
            setResolutionMessage("Failed to set resolution override");
        }
    };
    const setSteamDefaultResolution = async (value) => {
        setDefaultResolution(value);
        try {
            const applied = await setGlobalResolution(value);
            setResolutionMessage("");
            setDefaultResolution(applied || "Default");
        }
        catch (error) {
            setResolutionMessage("Failed to set default resolution");
        }
    };
    const resetAllGames = async () => {
        if (resettingAll)
            return;
        setResettingAll(true);
        setConfig((current) => {
            if (!current)
                return current;
            const next = clone(current);
            next.tweaks.games = {};
            return next;
        });
        try {
            const gameAppids = await resolveGameAppids(games.map((installed) => installed.appid));
            let nextResolution = 0;
            const resetResolution = async () => {
                while (nextResolution < gameAppids.length) {
                    const appid = gameAppids[nextResolution++];
                    if (!apps?.SetAppResolutionOverride)
                        continue;
                    try {
                        await apps.SetAppResolutionOverride(Number(appid), "Default");
                    }
                    catch (error) {
                    }
                }
            };
            await Promise.all([
                resetAllCompatTools(gameAppids),
                Promise.all(Array.from({ length: Math.min(10, gameAppids.length) }, resetResolution)),
            ]);
            await saveCompatApplied(handledGameAppids());
            setResolution("Default");
            if (game?.appid)
                setCurrentTool(compatSelection(await resolveCompatState(game.appid)));
        }
        catch (error) {
        }
        finally {
            setResettingAll(false);
        }
    };
    const confirmResetAllGames = () => {
        DFL.showModal(SP_JSX.jsx(ConfirmResetAllModal, { onConfirm: () => { void resetAllGames(); } }));
    };
    const gameOptions = editTargetOptions(config);
    // "" is the explicit Default target, not "nothing selected"; store a sentinel
    // so it doesn't fall back to the running game in the selectedGame derivation.
    const setSelectedGame = (appid) => {
        const id = String(appid);
        if (!id) {
            setConfig((current) => (current ? { ...current, selectedGame: { appid: "", name: "Default" } } : current));
            return;
        }
        const saved = games.find((candidate) => candidate.appid === id);
        setConfig((current) => (current ? { ...current, selectedGame: saved || null } : current));
    };
    const toolOptions = compatTools.map((tool) => ({ data: tool.id, label: tool.label }));
    const onSelectGlobalDefault = async (choice) => {
        const name = String(choice);
        const oldTool = String(tweaks.global.windowsCompatTool || DEFAULT_WINDOWS_COMPAT_TOOL);
        setGlobalTool(name);
        setWindowsCompatTool(name);
        patchSettings({ windowsCompatTool: name });
        await migrateWindowsCompatTool(config.installedGames.filter((installed) => !installed.nonSteam).map((installed) => installed.appid), oldTool, name);
        persistHandledGames();
    };
    const selectableTools = new Map();
    for (const tool of [...perGameTools, ...compatTools])
        selectableTools.set(tool.id, tool);
    if (currentTool && currentTool !== USE_DEFAULT_COMPAT && currentTool !== FOLLOW_STEAM_COMPAT && !selectableTools.has(currentTool)) {
        selectableTools.set(currentTool, { id: currentTool, label: currentTool });
    }
    const perGameToolOptions = [
        { data: USE_DEFAULT_COMPAT, label: "Use Default" },
        { data: FOLLOW_STEAM_COMPAT, label: "Follow Steam" },
        ...Array.from(selectableTools.values()).map((tool) => ({ data: tool.id, label: tool.label })),
    ];
    const onSelectPerGameTool = async (choice) => {
        if (!game?.appid)
            return;
        const selection = String(choice);
        const target = selection === USE_DEFAULT_COMPAT
            ? globalTool
            : selection === FOLLOW_STEAM_COMPAT
                ? ""
                : selection;
        try {
            await specifyCompatTool(game.appid, target);
            markCompatHandled(game.appid);
            persistHandledGames();
            setCurrentTool(selection);
        }
        catch (error) {
        }
    };
    const presets = config.fexProfiles || {};
    const presetEntries = Object.entries(presets);
    const storedProfile = values.fexProfile;
    const storedConfig = values.fexConfig;
    const ownConfig = (editingDefault ? tweaks.global.fexConfig : gameSettings.fexConfig);
    const hasPreset = !!(storedProfile && presets[storedProfile]);
    const isCustom = customSelected || (!hasPreset && !!storedConfig);
    const fexValue = isCustom ? "custom" : hasPreset ? storedProfile : "default";
    const fexConfig = (isCustom ? storedConfig : presets[fexValue]?.config) || presets.default?.config || {};
    const fexOptions = [...presetEntries.map(([id, profile]) => ({ data: id, label: profile.label })), { data: "custom", label: "Custom" }];
    const onSelectFex = (id) => {
        if (id === "custom") {
            setCustomSelected(true);
            // First Custom for this target seeds from the Default preset; afterwards the
            // stored config is kept, including across visits to a preset.
            patchSettings({ fexProfile: "custom", fexConfig: { ...(ownConfig || presets.default?.config || {}) } });
            return;
        }
        setCustomSelected(false);
        patchSettings({ fexProfile: id });
    };
    const setKnob = (key, on) => patchSettings({ fexProfile: "custom", fexConfig: { ...fexConfig, [key]: on ? "1" : "0" } });
    const thunks = values.thunks || {};
    const setThunk = (module, on) => patchSettings({ thunks: { ...thunks, [module]: on } });
    // env merges per-entry; unchecking a default var stores a null tombstone
    const ownEnv = ((editingDefault ? tweaks.global.env : gameSettings.env) || {});
    const globalEnv = ((!editingDefault && tweaks.global.env) || {});
    const patchOwnEnv = (mutate) => {
        const next = { ...ownEnv };
        mutate(next);
        patchSettings({ env: Object.keys(next).length ? next : undefined });
    };
    const saveEnvVar = (oldKey, key, value) => {
        patchOwnEnv((next) => {
            if (oldKey && oldKey !== key)
                delete next[oldKey];
            next[key] = value;
        });
    };
    const deleteEnvVar = (key) => {
        patchOwnEnv((next) => {
            delete next[key];
        });
    };
    const openEnvVar = (key) => {
        DFL.showModal(SP_JSX.jsx(EnvVarModal, { initialKey: key || "", initialValue: key ? String(ownEnv[key] ?? "") : "", onSave: (nextKey, nextValue) => saveEnvVar(key, nextKey, nextValue), onDelete: key ? () => deleteEnvVar(key) : undefined }));
    };
    const inheritedEnvEntries = Object.entries(globalEnv).filter(([key]) => typeof ownEnv[key] !== "string");
    const ownEnvEntries = Object.entries(ownEnv).filter(([, value]) => typeof value === "string");
    const envControls = (SP_JSX.jsxs(SP_JSX.Fragment, { children: [inheritedEnvEntries.length ? SP_JSX.jsx("div", { className: "armada-subheader", children: "Default Variables" }) : null, inheritedEnvEntries.map(([key, value]) => (SP_JSX.jsx(DFL.ToggleField, { label: String(value) ? `${key}=${String(value)}` : key, checked: ownEnv[key] !== null, onChange: (on) => patchOwnEnv((next) => {
                    if (on)
                        delete next[key];
                    else
                        next[key] = null;
                }) }, key))), inheritedEnvEntries.length ? SP_JSX.jsx("div", { className: "armada-subheader", children: "Per-Game Variables" }) : null, ownEnvEntries.map(([key, value]) => (SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => openEnvVar(key), children: SP_JSX.jsx("div", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }, children: value ? `${key}=${value}` : key }) }, key))), SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => openEnvVar(null), children: "+ Add Variable" }), SP_JSX.jsx(DFL.Field, { label: "Applies on next launch", description: "Variables are injected by batocera-control-game-launch before the game starts." })] }));
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "EDIT GAME PROFILE", children: [SP_JSX.jsx(SelectEdit, { value: game?.appid || "", options: gameOptions, onChange: setSelectedGame }), SP_JSX.jsx("div", { className: "armada-compat-note", children: "Compatibility changes apply on next launch" })] }), SP_JSX.jsxs(DFL.PanelSection, { title: "PROFILE SETTINGS", children: [editingDefault ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(SelectEdit, { labelBelow: true, label: "Default Proton", value: globalTool, options: toolOptions, onChange: onSelectGlobalDefault }), SP_JSX.jsx(DFL.ToggleField, { label: "Apply to New Games", checked: tweaks.global.autoApplyCompat !== false, onChange: (enabled) => {
                                    setAutoApplyCompat(enabled);
                                    patchSettings({ autoApplyCompat: enabled });
                                } }), SP_JSX.jsx(SelectEdit, { label: "Game Resolution", value: defaultResolution, options: resolutionOptions, onChange: setSteamDefaultResolution })] })) : (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(SelectEdit, { labelBelow: true, label: "Compatibility Tool", value: currentTool, options: perGameToolOptions, onChange: onSelectPerGameTool }), SP_JSX.jsx(SelectEdit, { label: "Game Resolution", value: resolution, options: resolutionOptions, onChange: setSteamResolution })] })), resolutionMessage ? SP_JSX.jsx(DFL.Field, { label: "Status", description: resolutionMessage }) : null, config.fexRuntimeSupported ? (SP_JSX.jsx(SelectEdit, { label: "FEX Preset", value: fexValue, options: fexOptions, onChange: onSelectFex })) : (SP_JSX.jsx(DFL.Field, { label: "FEX presets unavailable", description: config.fexRuntimeReason || "The persistent Batocera launch helper could not be installed." })), config.fexRuntimeSupported && isCustom
                        ? fexKnobs.map((knob) => (SP_JSX.jsx(DFL.ToggleField, { label: knob.label, checked: fexConfig[knob.key] === "1", onChange: (value) => setKnob(knob.key, value) }, knob.key)))
                        : null] }), SP_JSX.jsxs(DFL.PanelSection, { title: "ADVANCED", children: [config.fexRuntimeSupported ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => setShowThunks((value) => !value), children: showThunks ? "Hide Host Thunks" : "Host Thunks" }), showThunks
                                ? thunkModules.map((thunk) => (SP_JSX.jsx(DFL.ToggleField, { label: thunk.label, checked: thunks[thunk.module] !== false, onChange: (value) => setThunk(thunk.module, value) }, thunk.module)))
                                : null] })) : null, SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => setShowEnv((value) => !value), children: showEnv ? "Hide Environment" : "Environment" }), showEnv ? SP_JSX.jsx("div", { className: "armada-advanced-group", children: envControls }) : null] }), !editingDefault ? (SP_JSX.jsx(DFL.PanelSection, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: resetGame, children: "Reset to Default" }) })) : (SP_JSX.jsx(DFL.PanelSection, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: resettingAll, onClick: confirmResetAllGames, children: resettingAll ? "Resetting..." : "Reset All Games" }) }))] }));
}

const DEFAULT_BRIGHTNESS = 70;
const MIN_ACTIVE_BRIGHTNESS = 1;
const COLOR_OPTIONS = [
    { data: "red", label: "Red" },
    { data: "green", label: "Green" },
    { data: "blue", label: "Blue" },
    { data: "cyan", label: "Cyan" },
    { data: "magenta", label: "Magenta" },
    { data: "yellow", label: "Yellow" },
    { data: "orange", label: "Orange" },
    { data: "purple", label: "Purple" },
    { data: "white", label: "White" },
];
function presetForColor(hex, presets) {
    const entry = Object.entries(presets).find(([, value]) => value.toLowerCase() === hex.toLowerCase());
    return entry?.[0] || "blue";
}
function LedControl({ config, setConfig }) {
    const revision = SP_REACT.useRef(0);
    const timer = SP_REACT.useRef(undefined);
    const saveChain = SP_REACT.useRef(Promise.resolve());
    SP_REACT.useEffect(() => () => {
        if (timer.current !== undefined)
            window.clearTimeout(timer.current);
    }, []);
    const led = config.joystickLed?.config;
    const presets = config.joystickLedPresets || {};
    const modes = config.joystickLedModes || [];
    if (!config.joystickLed?.supported || !led) {
        return SP_JSX.jsx(DFL.PanelSection, { title: "Joystick LEDs", children: "Not supported on this device." });
    }
    const side = led.left;
    const isOff = side.mode === "off";
    const apply = (next, delay = 0) => {
        const unified = {
            linked: true,
            left: next.left,
            right: { ...next.left },
        };
        const request = ++revision.current;
        setConfig((current) => (current ? { ...current, joystickLed: { ...current.joystickLed, config: unified } } : current));
        if (timer.current !== undefined)
            window.clearTimeout(timer.current);
        const commit = () => {
            timer.current = undefined;
            saveChain.current = saveChain.current.catch(() => { }).then(async () => {
                try {
                    const state = await saveJoystickLed(unified);
                    if (request === revision.current) {
                        setConfig((current) => (current ? { ...current, joystickLed: state } : current));
                    }
                }
                catch (error) {
                    console.error(error);
                }
            });
        };
        if (delay > 0)
            timer.current = window.setTimeout(commit, delay);
        else
            commit();
    };
    const update = (patch) => {
        apply({ left: { ...side, ...patch }});
    };
    const onModeChange = (mode) => {
        if (mode === "off") {
            update({ mode });
            return;
        }
        const brightness = side.brightness < MIN_ACTIVE_BRIGHTNESS ? DEFAULT_BRIGHTNESS : side.brightness;
        update({ mode, brightness });
    };
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSection, { title: "Joystick LEDs", children: SP_JSX.jsx(DFL.Field, { label: "Batocera service", children: "Uses batocera-led-handheld (same as EmulationStation). Left and right rings share color and mode." }) }), SP_JSX.jsxs(DFL.PanelSection, { title: "L/R rings", children: [SP_JSX.jsx(SelectEdit, { label: "Mode", value: side.mode, options: modes, onChange: onModeChange }), SP_JSX.jsx(SelectEdit, { label: "Color", value: presetForColor(side.color, presets), options: COLOR_OPTIONS, onChange: (preset) => update({ color: presets[preset] || side.color }) }), isOff ? (SP_JSX.jsx(DFL.Field, { label: "Brightness", children: "Off \u2014 pick another mode to turn LEDs on." })) : (SP_JSX.jsx(SliderEdit, { label: "Brightness", value: Math.max(MIN_ACTIVE_BRIGHTNESS, side.brightness), min: MIN_ACTIVE_BRIGHTNESS, max: 100, step: 1, format: (value) => `${Math.round(value)}%`, onChange: (brightness) => {
                            const next = Math.max(MIN_ACTIVE_BRIGHTNESS, Number(brightness));
                            apply({ left: { ...side, brightness: next }}, 150);
                        } }))] })] }));
}

const MULTIPLIERS = [
    { data: "2", label: "2x" },
    { data: "3", label: "3x" },
    { data: "4", label: "4x" },
];
const FLOW_SCALES = [
    { data: "1.0", label: "1.0 — best motion detail" },
    { data: "0.75", label: "0.75 — balanced" },
    { data: "0.5", label: "0.5 — faster" },
    { data: "0.25", label: "0.25 — fastest" },
];
const PRESENT_MODES = [
    { data: "", label: "Automatic" },
    { data: "fifo", label: "FIFO / VSync" },
    { data: "mailbox", label: "Mailbox" },
    { data: "immediate", label: "Immediate" },
];
function Lsfg({ config, setConfig }) {
    const revision = SP_REACT.useRef(0);
    const saveChain = SP_REACT.useRef(Promise.resolve());
    const [message, setMessage] = SP_REACT.useState("");
    const [gameBusy, setGameBusy] = SP_REACT.useState(false);
    const state = config.lsfg;
    const games = [...(config.installedGames || [])];
    if (config.game?.appid && !games.some((game) => game.appid === config.game?.appid)) {
        games.push({ appid: config.game.appid, name: config.game.name });
    }
    games.sort((a, b) => a.name.localeCompare(b.name));
    const [selectedAppid, setSelectedAppid] = SP_REACT.useState(config.game?.appid || games[0]?.appid || "");
    SP_REACT.useEffect(() => {
        if (selectedAppid && games.some((game) => game.appid === selectedAppid))
            return;
        setSelectedAppid(config.game?.appid || games[0]?.appid || "");
    }, [config.game?.appid, games.map((game) => game.appid).join(","), selectedAppid]);
    if (!state?.supported) {
        return (SP_JSX.jsx(DFL.PanelSection, { title: "LSFG-VK frame generation", children: SP_JSX.jsx(DFL.Field, { label: "System layer unavailable", description: state?.reason || "LSFG-VK is not installed in this image." }) }));
    }
    const settings = state.config;
    const layerStatus = [
        state.layers.native ? "native ARM" : "",
        state.layers.x64 ? "x64/Wine" : "",
    ].filter(Boolean).join(" + ");
    const apply = (patch) => {
        const next = { ...settings, ...patch };
        const request = ++revision.current;
        setMessage("");
        setConfig((current) => current?.lsfg
            ? { ...current, lsfg: { ...current.lsfg, config: next } }
            : current);
        saveChain.current = saveChain.current.catch(() => { }).then(async () => {
            try {
                const saved = await saveLsfg(next);
                if (request === revision.current) {
                    setConfig((current) => (current ? { ...current, lsfg: saved } : current));
                    setMessage(next.enabled
                        ? "Saved — all-games mode applies after Steam/GamepadUI is relaunched."
                        : "Saved — selected-game profiles use these settings on their next launch.");
                }
            }
            catch (error) {
                if (request === revision.current)
                    setMessage(String(error));
            }
        });
    };
    const setGameEnabled = async (enabled) => {
        if (!selectedAppid || !state)
            return;
        const previous = state.enabledAppids.includes(selectedAppid);
        if (enabled === previous)
            return;
        setGameBusy(true);
        setMessage("Updating Steam launch options…");
        try {
            const saved = await setLsfgGameEnabled(selectedAppid, enabled);
            try {
                await setLsfgLaunchOption(selectedAppid, enabled, saved.wrapperPath);
            }
            catch (error) {
                await setLsfgGameEnabled(selectedAppid, previous).catch(() => { });
                throw error;
            }
            setConfig((current) => (current ? { ...current, lsfg: saved } : current));
            setMessage(enabled
                ? "Enabled for this game — applies on its next launch; Steam does not need to restart."
                : "Disabled for this game and removed from its Steam launch options.");
        }
        catch (error) {
            setMessage(String(error));
        }
        finally {
            setGameBusy(false);
        }
    };
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "LSFG-VK frame generation", children: [SP_JSX.jsx(DFL.Field, { label: "Batocera system layer", description: `${layerStatus || "detected"}; no separate LSFG runtime is downloaded by this plugin.` }), SP_JSX.jsx(DFL.Field, { label: state.dllDetected ? "Lossless.dll detected" : "Lossless.dll missing", description: state.dllPath }), SP_JSX.jsx(ToggleRow, { label: "Enable for all Steam games", description: "Global mode injects the layer into every Steam Vulkan/DXVK game after Steam is restarted. Leave this off to use the per-game selector below.", value: settings.enabled, disabled: !state.ready, onChange: (enabled) => apply({ enabled }) }), !state.dllDetected ? (SP_JSX.jsx(DFL.Field, { label: "Required file", description: "Copy Lossless.dll from a purchased Lossless Scaling installation to the path shown above." })) : null] }), SP_JSX.jsx(DFL.PanelSection, { title: "Per-game activation", children: games.length ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(SelectEdit, { label: "Steam game", value: selectedAppid, options: games.map((game) => ({ data: game.appid, label: game.name })), onChange: (appid) => setSelectedAppid(String(appid)) }), SP_JSX.jsx(ToggleRow, { label: "Enable for selected game", description: settings.enabled
                                ? "Global all-games mode is currently on, so this game already receives LSFG. This switch still controls its persistent per-game launch option."
                                : "Adds a managed wrapper only to this game's Steam launch options. Other games remain untouched, and Steam itself does not need to restart.", value: !!selectedAppid && state.enabledAppids.includes(selectedAppid), disabled: gameBusy || !state.ready || !state.perGameSupported || !selectedAppid, onChange: setGameEnabled })] })) : (SP_JSX.jsx(DFL.Field, { label: "No installed Steam games found", description: "Install or launch a game, then reopen this tab." })) }), SP_JSX.jsxs(DFL.PanelSection, { title: "Frame generation", children: [SP_JSX.jsx(DFL.Field, { label: "Frame multiplier", description: "2x has the lowest GPU cost; 3x/4x synthesize more frames and require more headroom." }), SP_JSX.jsx(SelectEdit, { label: "Multiplier", value: settings.multiplier, options: MULTIPLIERS, onChange: (multiplier) => apply({ multiplier }) }), SP_JSX.jsx(DFL.Field, { label: "Optical-flow resolution", description: "Lower values reduce motion-estimation cost at the expense of generated-frame detail." }), SP_JSX.jsx(SelectEdit, { label: "Flow scale", value: settings.flowScale, options: FLOW_SCALES, onChange: (flowScale) => apply({ flowScale }) }), SP_JSX.jsx(ToggleRow, { label: "Performance mode", description: "Uses the lighter LSFG model. Recommended on SM8550/SM8750 when games are GPU-bound.", value: settings.performanceMode, onChange: (performanceMode) => apply({ performanceMode }) }), SP_JSX.jsx(ToggleRow, { label: "HDR mode", description: "Enable only when both the game and display session are using HDR.", value: settings.hdrMode, onChange: (hdrMode) => apply({ hdrMode }) }), SP_JSX.jsx(DFL.Field, { label: "Present mode", description: "Automatic is safest. FIFO favors tear-free output; Mailbox/Immediate may reduce latency but can stutter or tear." }), SP_JSX.jsx(SelectEdit, { label: "Vulkan present mode", value: settings.presentMode, options: PRESENT_MODES, onChange: (presentMode) => apply({ presentMode }) })] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Activation", children: [SP_JSX.jsx(DFL.Field, { label: "Status", description: message || "Per-game activation applies on the next game launch. Only global all-games mode requires a Steam/GamepadUI restart." }), state.legacyPluginDetected || state.legacyConfigDetected || state.legacyLaunchScriptDetected ? (SP_JSX.jsx(DFL.Field, { label: "Legacy LSFG setup detected", description: "The old Decky plugin/wrapper is retained for rollback. Remove ~/lsfg from per-game Steam launch options before enabling Batocera's global layer to avoid double injection." })) : null, SP_JSX.jsx(DFL.Field, { label: "Upstream", description: "System layer: PancakeTAS/lsfg-vk. UI integration derived from Decky LSFG-VK concepts." })] })] }));
}

function formatMinutes(seconds) {
    if (seconds >= 60) {
        const mins = Math.round(seconds / 60);
        return `${mins} min`;
    }
    return `${seconds} s`;
}
function OledCare({ config, setConfig }) {
    const revision = SP_REACT.useRef(0);
    const timer = SP_REACT.useRef(undefined);
    const saveChain = SP_REACT.useRef(Promise.resolve());
    const screensaverActive = useOledScreensaverActive();
    SP_REACT.useEffect(() => () => {
        if (timer.current !== undefined)
            window.clearTimeout(timer.current);
    }, []);
    const oled = config.oledCare;
    const screensaverPanel = oled?.panelDetected ? (SP_JSX.jsxs(DFL.PanelSection, { title: "OLED screensaver", children: [SP_JSX.jsx(DFL.Field, { label: "Mostly-black moving display", description: "Keeps Steam and downloads running while replacing static UI with a dim, slowly moving mark. It does not suspend the system or change saved brightness." }), SP_JSX.jsx(ToggleRow, { label: screensaverActive ? "Screensaver active" : "Start screensaver", description: "Press any controller button, keyboard key, or touch the screen to exit.", value: screensaverActive, onChange: (enabled) => {
                    setOledScreensaverActive(enabled);
                    if (enabled)
                        DFL.Navigation.CloseSideMenus();
                } })] })) : null;
    if (!oled?.supported) {
        return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSection, { title: "OLED care", children: SP_JSX.jsx(DFL.Field, { label: "Idle dim deferred", description: oled?.reason
                            || "Automatic idle dimming is planned for a future stock-native release. Use the screensaver below for burn-in mitigation in Steam." }) }), screensaverPanel] }));
    }
    const cfg = oled.config;
    const runtime = oled.runtime;
    const apply = (patch, delay = 0) => {
        const next = { ...cfg, ...patch };
        const request = ++revision.current;
        setConfig((current) => current && current.oledCare
            ? { ...current, oledCare: { ...current.oledCare, config: next } }
            : current);
        if (timer.current !== undefined)
            window.clearTimeout(timer.current);
        const commit = () => {
            timer.current = undefined;
            saveChain.current = saveChain.current.catch(() => { }).then(async () => {
                try {
                    const state = await saveOledCare(next);
                    if (request === revision.current) {
                        setConfig((current) => (current ? { ...current, oledCare: state } : current));
                    }
                }
                catch (error) {
                    console.error(error);
                }
            });
        };
        if (delay > 0)
            timer.current = window.setTimeout(commit, delay);
        else
            commit();
    };
    const onRestart = async () => {
        try {
            const state = await restartOledCare();
            setConfig((current) => (current ? { ...current, oledCare: state } : current));
        }
        catch (error) {
            console.error(error);
        }
    };
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "OLED care", children: [SP_JSX.jsx(DFL.Field, { label: "Burn-in protection", children: "Caps brightness and dims the panel after idle time. Pixel refresh is disabled." }), SP_JSX.jsx(ToggleRow, { label: "Enabled", value: cfg.ENABLED === 1, onChange: (enabled) => apply({ ENABLED: enabled ? 1 : 0 }) }), runtime && (SP_JSX.jsx(DFL.Field, { label: "Status", children: `Service ${runtime.serviceRunning ? "running" : "stopped"} · idle ${runtime.idleSeconds}s · brightness ${runtime.brightnessPct ?? "?"}%` }))] }), screensaverPanel, cfg.ENABLED === 1 && (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "Brightness", children: [SP_JSX.jsx(SliderEdit, { label: "Normal", value: cfg.BRIGHTNESS_NORMAL, min: 10, max: 100, step: 1, format: (value) => `${Math.round(value)}%`, onChange: (value) => apply({ BRIGHTNESS_NORMAL: Math.round(Number(value)) }, 200) }), SP_JSX.jsx(SliderEdit, { label: "Idle dim", value: cfg.BRIGHTNESS_IDLE, min: 5, max: 80, step: 1, format: (value) => `${Math.round(value)}%`, onChange: (value) => apply({ BRIGHTNESS_IDLE: Math.round(Number(value)) }, 200) })] }), SP_JSX.jsx(DFL.PanelSection, { title: "Idle timing", children: SP_JSX.jsx(SliderEdit, { label: "Dim after", value: cfg.IDLE_DIM_SECONDS, min: 30, max: 1800, step: 30, format: formatMinutes, onChange: (value) => apply({ IDLE_DIM_SECONDS: Math.round(Number(value)) }, 200) }) }), SP_JSX.jsx(DFL.PanelSection, { title: "Actions", children: SP_JSX.jsx(DFL.DialogButton, { onClick: onRestart, children: "Restart OLED service" }) })] }))] }));
}

const MODE_LABELS = {
    off: "Off",
    auto: "Thermal guard",
    adaptive: "Adaptive FPS",
};
function capLabel(value) {
    if (value === "auto")
        return "Automatic / game setting";
    if (value === "none")
        return "No fixed cap";
    return `${value}% maximum`;
}
function targetLabel(value) {
    return value === "auto" ? "Automatic (infer from game)" : `${value} FPS`;
}
function runtimeLabel(state) {
    const parts = [state.running ? "Limiter running" : "Limiter stopped"];
    if (state.fps !== null)
        parts.push(`${state.fps.toFixed(1)} FPS`);
    if (state.currentTdp !== null)
        parts.push(`${state.currentTdp} W`);
    if (state.minTdp !== null && state.maxTdp !== null)
        parts.push(`range ${state.minTdp}–${state.maxTdp} W`);
    if (state.temperatureC !== null)
        parts.push(`${state.temperatureC.toFixed(1)}°C`);
    if (state.fanPercent !== null)
        parts.push(`fan ${Math.round(state.fanPercent)}%`);
    return parts.join(" · ");
}
function AdaptiveCpu({ config, setConfig }) {
    const revision = SP_REACT.useRef(0);
    const saveChain = SP_REACT.useRef(Promise.resolve());
    const busy = SP_REACT.useRef(false);
    const [message, setMessage] = SP_REACT.useState("");
    const state = config.cpuLimit;
    SP_REACT.useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            if (busy.current)
                return;
            try {
                const next = await getCpuLimit();
                if (!cancelled && !busy.current) {
                    setConfig((current) => (current ? { ...current, cpuLimit: next } : current));
                }
            }
            catch (error) { }
        };
        const timer = window.setInterval(refresh, 3000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [setConfig]);
    if (!state?.supported) {
        return (SP_JSX.jsx(DFL.PanelSection, { title: "Adaptive power", children: SP_JSX.jsx(DFL.Field, { label: "Unavailable", description: state?.reason || "Batocera's adaptive power limiter is unavailable." }) }));
    }
    const apply = (patch) => {
        const next = {
            mode: patch.mode ?? state.mode,
            globalCap: patch.globalCap ?? state.globalCap,
            globalTargetFps: patch.globalTargetFps ?? state.globalTargetFps,
        };
        const request = ++revision.current;
        busy.current = true;
        setMessage("Applying…");
        setConfig((current) => current?.cpuLimit
            ? { ...current, cpuLimit: { ...current.cpuLimit, ...next } }
            : current);
        saveChain.current = saveChain.current.catch(() => { }).then(async () => {
            try {
                const saved = await saveCpuLimit(next);
                if (request === revision.current) {
                    setConfig((current) => (current ? { ...current, cpuLimit: saved } : current));
                    setMessage("Saved and applied");
                }
            }
            catch (error) {
                if (request === revision.current)
                    setMessage(String(error));
            }
            finally {
                if (request === revision.current)
                    busy.current = false;
            }
        });
    };
    const modeOptions = state.modeOptions.map((value) => ({
        data: value,
        label: state.kind === "tdp" && value === "adaptive" ? "Adaptive TDP / FPS" : MODE_LABELS[value] || value,
    }));
    const capOptions = state.capOptions.map((value) => ({ data: value, label: capLabel(value) }));
    const targetOptions = state.targetOptions.map((value) => ({ data: value, label: targetLabel(value) }));
    return (SP_JSX.jsxs(DFL.PanelSection, { title: state.kind === "tdp" ? "Adaptive TDP" : "Adaptive CPU", children: [state.kind === "tdp" ? (SP_JSX.jsx(DFL.Field, { label: "Batocera package-power limiter", description: "Adaptive TDP lowers package power in one-watt steps while frame rate has headroom and raises it when FPS falls. Your existing TDP setting remains the ceiling; this control does not replace or override the normal TDP slider." })) : (SP_JSX.jsx(DFL.Field, { label: "Batocera CPU limiter", description: "Thermal guard reacts to temperature and fan load. Adaptive FPS also reduces the CPU ceiling while frame rate has headroom, then releases it when FPS falls. It never overclocks." })), SP_JSX.jsx(SelectEdit, { label: "Mode", value: state.mode, options: modeOptions, onChange: (mode) => apply({ mode }) }), state.kind === "cpu" ? (SP_JSX.jsx(SelectEdit, { label: "CPU ceiling", value: state.globalCap, options: capOptions, onChange: (globalCap) => apply({ globalCap }) })) : null, SP_JSX.jsx(SelectEdit, { label: "Target frame rate", value: state.globalTargetFps, options: targetOptions, disabled: state.mode !== "adaptive", onChange: (globalTargetFps) => apply({ globalTargetFps }) }), SP_JSX.jsx(DFL.Field, { label: "Runtime", description: runtimeLabel(state) }), SP_JSX.jsx(DFL.Field, { label: "FPS source", description: `${state.dataSource}. Steam uses Gamescope statistics; ES-launched emulators use Batocera's hidden FPS sampler. This is independent of the visible MangoHud performance overlay.` }), message ? SP_JSX.jsx(DFL.Field, { label: "Last change", description: message }) : null] }));
}

const FALLBACK_MODES = [
    { data: "silent", label: "Silent curve" },
    { data: "auto", label: "Balanced curve" },
    { data: "aggressive", label: "Aggressive curve" },
    { data: "manual", label: "Manual override" },
    { data: "off", label: "Off" },
];
const KNOWN_MODES = new Set(FALLBACK_MODES.map((entry) => entry.data));
function FanControl({ config, setConfig }) {
    const revision = SP_REACT.useRef(0);
    const timer = SP_REACT.useRef(undefined);
    const saveChain = SP_REACT.useRef(Promise.resolve());
    const busy = SP_REACT.useRef(false);
    const [message, setMessage] = SP_REACT.useState("");
    const state = config.fanControl;
    SP_REACT.useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            if (busy.current)
                return;
            try {
                const next = await getFanControl();
                if (!cancelled && !busy.current) {
                    setConfig((current) => (current ? { ...current, fanControl: next } : current));
                }
            }
            catch (error) { }
        };
        const poll = window.setInterval(refresh, 3000);
        return () => {
            cancelled = true;
            window.clearInterval(poll);
            if (timer.current !== undefined)
                window.clearTimeout(timer.current);
        };
    }, [setConfig]);
    if (!state?.supported)
        return null;
    const modeOptions = (state.modes && state.modes.length ? state.modes : FALLBACK_MODES);
    const mode = KNOWN_MODES.has(state.mode) ? state.mode : "auto";
    const minimum = state.minimumManualPercent || 20;
    const target = Math.max(minimum, Math.min(100, Math.round(state.targetPercent ?? state.percent ?? 40)));
    const telemetry = [
        state.percent !== null ? `${Math.round(state.percent)}%` : "speed unavailable",
        state.rpm !== null ? `${Math.round(state.rpm)} RPM` : "",
        state.name,
    ].filter(Boolean).join(" · ");
    const apply = (next, delay = 0) => {
        const request = ++revision.current;
        busy.current = true;
        setMessage(delay ? "Waiting to apply…" : "Applying…");
        setConfig((current) => current?.fanControl
            ? {
                ...current,
                fanControl: {
                    ...current.fanControl,
                    mode: next.mode,
                    targetPercent: next.mode === "manual" ? next.targetPercent : current.fanControl.targetPercent,
                },
            }
            : current);
        if (timer.current !== undefined)
            window.clearTimeout(timer.current);
        const commit = () => {
            timer.current = undefined;
            saveChain.current = saveChain.current.catch(() => { }).then(async () => {
                try {
                    const saved = await saveFanControl(next);
                    if (request === revision.current) {
                        setConfig((current) => (current ? { ...current, fanControl: saved } : current));
                        setMessage("Saved and applied");
                    }
                }
                catch (error) {
                    if (request === revision.current)
                        setMessage(String(error));
                }
                finally {
                    if (request === revision.current)
                        busy.current = false;
                }
            });
        };
        if (delay)
            timer.current = window.setTimeout(commit, delay);
        else
            commit();
    };
    return (SP_JSX.jsxs(DFL.PanelSection, { title: "Fan control", children: [SP_JSX.jsx(DFL.Field, { label: "Batocera qcom-fan", description: "Same curves as Batocera Control Center / CLI: silent, balanced, aggressive, manual, or off." }), SP_JSX.jsx(SelectEdit, { label: "Mode", value: mode, options: modeOptions, disabled: !state.controllable, onChange: (nextMode) => apply({ mode: nextMode, targetPercent: target }) }), mode === "manual" ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(SliderEdit, { label: "Manual speed", value: target, min: minimum, max: 100, step: 5, format: (value) => `${Math.round(value)}%`, onChange: (targetPercent) => apply({ mode: "manual", targetPercent: Math.round(targetPercent) }, 200) }), SP_JSX.jsx(DFL.Field, { label: "Manual override active", description: "Temperature curves are disabled until Silent, Balanced, or Aggressive is selected again." })] })) : null, SP_JSX.jsx(DFL.Field, { label: "Current fan", description: telemetry }), !state.controllable ? SP_JSX.jsx(DFL.Field, { label: "Read only", description: state.reason }) : null, message ? SP_JSX.jsx(DFL.Field, { label: "Last change", description: message }) : null] }));
}

const underclocks = [
    { data: "none", label: "None" },
    { data: "small", label: "Small" },
    { data: "medium", label: "Medium" },
    { data: "large", label: "Large" },
];
function Power({ config, setConfig }) {
    const [profile, setProfile] = SP_REACT.useState(config.power.general.default_profile || "balanced");
    const profilesSupported = config.powerSupported && !!Object.keys(config.power.profiles || {}).length;
    const p = config.power.profiles[profile] || {};
    const profiles = Object.entries(config.power.profiles || {}).map(([name, profile]) => ({
        data: name,
        label: profile.label || titleCase(name),
    }));
    const fanCurves = Object.entries(config.power.fan_curves || {}).map(([name, curve]) => ({
        data: name,
        label: curve.label || titleCase(name),
    }));
    const governorOptions = (config.cpuGovernors || []).map((name) => ({ data: name, label: titleCase(name) }));
    const setProfileValue = (name, value) => {
        setConfig((current) => (current ? update(current, ["power", "profiles", profile, name], value) : current));
    };
    const setGpuValue = (name, value) => {
        setConfig((current) => {
            if (!current)
                return current;
            const next = clone(current);
            const target = next.power.profiles[profile];
            target[name] = value;
            if (name === "gpu_min" && Number(value) > Number(target.gpu_max || 0)) {
                target.gpu_max = value;
            }
            if (name === "gpu_max" && Number(value) < Number(target.gpu_min || 0)) {
                target.gpu_min = value;
            }
            return next;
        });
    };
    const resetProfile = () => {
        const defaults = config.powerDefaults?.profiles?.[profile];
        if (!defaults)
            return;
        setConfig((current) => (current ? update(current, ["power", "profiles", profile], defaults) : current));
    };
    const setCpuGovernor$1 = async (value) => {
        const previous = config.cpuGovernor || "";
        setConfig((current) => (current ? { ...current, cpuGovernor: value } : current));
        try {
            const applied = await setCpuGovernor(value);
            setConfig((current) => (current ? { ...current, cpuGovernor: applied } : current));
        }
        catch (error) {
            setConfig((current) => (current ? { ...current, cpuGovernor: previous } : current));
            toaster.toast({ title: "Could not change CPU governor", body: String(error) });
        }
    };
    const underclockLevel = p.cpu_underclock || "";
    const supportsUnderclockPresets = !!config.power.underclocks?.[config.cpuDeviceClass];
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [profilesSupported ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSection, { title: "EDIT POWER PROFILE", children: SP_JSX.jsx(SelectEdit, { value: profile, options: profiles, onChange: setProfile }) }), SP_JSX.jsxs(DFL.PanelSection, { title: "PROFILE SETTINGS", children: [SP_JSX.jsx(SelectEdit, { label: "Fan Curve", value: p.fan_curve, options: fanCurves, onChange: (v) => setProfileValue("fan_curve", v) }), governorOptions.length ? (SP_JSX.jsx(SelectEdit, { label: "CPU Governor", value: p.cpu_governor || config.cpuGovernor || governorOptions[0].data, options: governorOptions, onChange: (v) => setProfileValue("cpu_governor", v) })) : null, supportsUnderclockPresets ? (SP_JSX.jsx(SelectEdit, { label: "CPU Underclock", value: underclockLevel, options: underclocks, onChange: (v) => setProfileValue("cpu_underclock", v) })) : (SP_JSX.jsx(SliderEdit, { label: "CPU Max (%)", value: Math.round(Number(p.cpu_max || 0) * 100), min: 35, max: 100, step: 1, onChange: (v) => setProfileValue("cpu_max", (v / 100).toFixed(2)) })), SP_JSX.jsx(SliderEdit, { label: "GPU Min (%)", value: Math.round(Number(p.gpu_min || 0) * 100), min: 0, max: 100, step: 1, onChange: (v) => setGpuValue("gpu_min", (v / 100).toFixed(2)) }), SP_JSX.jsx(SliderEdit, { label: "GPU Max (%)", value: Math.round(Number(p.gpu_max || 0) * 100), min: 35, max: 100, step: 1, onChange: (v) => setGpuValue("gpu_max", (v / 100).toFixed(2)) }), SP_JSX.jsx("div", { className: "armada-reset-row", children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: resetProfile, children: "Reset to Default" }) })] })] })) : (SP_JSX.jsx(DFL.PanelSection, { title: "Power profiles", children: SP_JSX.jsx(DFL.Field, { label: "Unavailable on this image", description: config.powerReason
                        || "Per-profile CPU/GPU/fan-curve editing needs odin-power. Adaptive CPU and Fan controls below remain available." }) })), !profilesSupported && governorOptions.length ? (SP_JSX.jsxs(DFL.PanelSection, { title: "CPU governor", children: [SP_JSX.jsx(SelectEdit, { label: "Scaling governor", value: config.cpuGovernor || governorOptions[0].data, options: governorOptions, onChange: setCpuGovernor$1 }), SP_JSX.jsx(DFL.Field, { label: "Note", description: "Applies immediately via sysfs. Rear-paddle Cycle power walks the same governors." })] })) : null, SP_JSX.jsx(AdaptiveCpu, { config: config, setConfig: setConfig }), SP_JSX.jsx(FanControl, { config: config, setConfig: setConfig })] }));
}

const CAPTURE_CONTROLS = ["left_x", "left_y", "right_x", "right_y", "left_trigger", "right_trigger"];
function controlValue(state, name) {
    return Number(state?.controls?.[name]?.value || 0);
}
function controlRange(state, name) {
    const control = state?.controls?.[name] || {};
    const min = Number(control.min);
    const max = Number(control.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max)
        return { min: -32768, max: 32767 };
    return { min, max };
}
function normalizedValue(state, name) {
    const { min, max } = controlRange(state, name);
    const value = controlValue(state, name);
    const side = value < 0 ? Math.abs(min) : max;
    if (!side)
        return 0;
    return Math.max(-1, Math.min(1, value / side));
}
function triggerPercent(state, name) {
    const { min, max } = controlRange(state, name);
    const value = controlValue(state, name);
    if (max === min)
        return 0;
    return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}
function makeCapture(state) {
    const capture = {};
    for (const name of CAPTURE_CONTROLS) {
        const value = controlValue(state, name);
        const range = controlRange(state, name);
        capture[name] = {
            center: value,
            min: value,
            max: value,
            range: range.max - range.min,
        };
    }
    return capture;
}
function updateCapture(capture, state) {
    const next = clone(capture || makeCapture(state));
    for (const name of Object.keys(next)) {
        const value = controlValue(state, name);
        next[name].min = Math.min(next[name].min, value);
        next[name].max = Math.max(next[name].max, value);
    }
    return next;
}

function StickPlot({ title, xName, yName, state }) {
    const x = normalizedValue(state, xName);
    const y = normalizedValue(state, yName);
    return (SP_JSX.jsxs("div", { style: { minWidth: 0 }, children: [SP_JSX.jsx("div", { style: { marginBottom: "10px", fontSize: "15px", fontWeight: 600, opacity: 0.9 }, children: title }), SP_JSX.jsxs("div", { style: {
                    position: "relative",
                    width: "132px",
                    height: "132px",
                    border: "2px solid rgba(255,255,255,0.34)",
                    background: "rgba(255,255,255,0.055)",
                    boxSizing: "border-box",
                }, children: [SP_JSX.jsx("div", { style: { position: "absolute", left: "8%", right: "8%", top: "50%", height: "1px", background: "rgba(255,255,255,0.22)" } }), SP_JSX.jsx("div", { style: { position: "absolute", top: "8%", bottom: "8%", left: "50%", width: "1px", background: "rgba(255,255,255,0.22)" } }), SP_JSX.jsx("div", { style: {
                            position: "absolute",
                            width: "18px",
                            height: "18px",
                            margin: "-9px 0 0 -9px",
                            border: "2px solid #fff",
                            borderRadius: "50%",
                            background: "#2677d8",
                            left: `${50 + x * 44}%`,
                            top: `${50 + y * 44}%`,
                        } })] })] }));
}
function TriggerBar({ title, name, state }) {
    return (SP_JSX.jsxs("div", { children: [SP_JSX.jsx("div", { style: { marginBottom: "10px", fontSize: "15px", fontWeight: 600, opacity: 0.9 }, children: title }), SP_JSX.jsx(DFL.ProgressBar, { nProgress: triggerPercent(state, name), nTransitionSec: 0 })] }));
}
const gridTwoCol = { display: "grid", gridTemplateColumns: "repeat(2, 132px)", gap: "22px", justifyContent: "center", width: "100%" };
// Modal input capture leaves gamepad focus frozen on the last-touched button.
const focusStyles = `
  .armada-cal-footer button.gpfocus,
  .armada-cal-footer button:focus,
  .armada-cal-footer button:hover {
    background-color: rgba(255, 255, 255, 0.1) !important;
    color: #ffffff !important;
    box-shadow: none !important;
    transform: none !important;
    -webkit-filter: none !important;
    filter: none !important;
  }
`;
function CalibrationModal({ closeModal }) {
    const [state, setState] = SP_REACT.useState(null);
    const [capture, setCapture] = SP_REACT.useState(null);
    const [phase, setPhase] = SP_REACT.useState("idle");
    const sessionToken = SP_REACT.useRef(`${Date.now()}-${Math.random()}`);
    const phaseRef = SP_REACT.useRef("idle");
    const canApply = !!state?.canApply;
    SP_REACT.useEffect(() => {
        phaseRef.current = phase;
    }, [phase]);
    SP_REACT.useEffect(() => {
        let cancelled = false;
        let inflight = false;
        const tick = async () => {
            if (cancelled || inflight)
                return;
            inflight = true;
            try {
                const next = await getControllerState();
                if (cancelled)
                    return;
                setState(next);
                if (phaseRef.current === "recording" && next.supported) {
                    setCapture((current) => updateCapture(current || makeCapture(next), next));
                }
            }
            catch (error) {
                if (!cancelled)
                    setState({ supported: false, reason: String(error), controls: {} });
            }
            finally {
                inflight = false;
            }
        };
        tick();
        const timer = window.setInterval(tick, 50);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, []);
    // Intercept input for the whole modal so stick/trigger movement (during, after,
    // or just viewing calibration) doesn't leak to Steam behind it.
    SP_REACT.useEffect(() => {
        const token = sessionToken.current;
        beginCalibrationSession(token).catch(() => { });
        return () => {
            endCalibrationSession(token).catch(() => { });
        };
    }, []);
    const close = () => {
        closeModal?.();
    };
    const start = () => {
        setCapture(null);
        setPhase("recording");
    };
    const save = async () => {
        if (!capture)
            return;
        try {
            const next = await saveCalibration(capture);
            setState(next);
            setCapture(null);
            setPhase("idle");
        }
        catch (error) {
            setState((current) => ({ ...(current || {}), supported: false, reason: String(error) }));
            setPhase("idle");
        }
    };
    const reset = async () => {
        try {
            const next = await resetCalibration();
            setState(next);
        }
        catch (error) {
            setState((current) => ({ ...(current || {}), supported: false, reason: String(error) }));
        }
    };
    const instructions = !state
        ? "Checking controller..."
        : !canApply
            ? "This device can't save calibration, but you can check stick and trigger response here."
            : phase === "recording"
                ? "Move both sticks in full circles and fully press both triggers, then Save."
                : "Press Start, then move sticks and triggers through full range.";
    return (SP_JSX.jsxs(DFL.ModalRoot, { onCancel: close, children: [SP_JSX.jsxs(DFL.DialogBody, { children: [SP_JSX.jsxs("div", { style: { ...gridTwoCol, alignItems: "start", marginBottom: "22px" }, children: [SP_JSX.jsx(StickPlot, { title: "Left Stick", xName: "left_x", yName: "left_y", state: state }), SP_JSX.jsx(StickPlot, { title: "Right Stick", xName: "right_x", yName: "right_y", state: state })] }), SP_JSX.jsxs("div", { style: { ...gridTwoCol, marginBottom: "16px" }, children: [SP_JSX.jsx(TriggerBar, { title: "LT", name: "left_trigger", state: state }), SP_JSX.jsx(TriggerBar, { title: "RT", name: "right_trigger", state: state })] }), SP_JSX.jsx("div", { style: { fontSize: "13px", lineHeight: "18px", opacity: 0.72, textAlign: "center" }, children: instructions })] }), SP_JSX.jsxs(DFL.DialogFooter, { children: [SP_JSX.jsx("style", { children: focusStyles }), !canApply ? (SP_JSX.jsx("div", { className: "armada-cal-footer", style: { display: "flex", gap: "10px" }, children: SP_JSX.jsx(DFL.DialogButton, { onClick: close, children: "Close" }) })) : phase === "recording" ? (SP_JSX.jsxs("div", { className: "armada-cal-footer", style: { display: "flex", gap: "10px" }, children: [SP_JSX.jsx(DFL.DialogButton, { onClick: save, disabled: !capture, children: "Save Calibration" }), SP_JSX.jsx(DFL.DialogButton, { onClick: close, children: "Close" })] })) : (SP_JSX.jsxs("div", { className: "armada-cal-footer", style: { display: "flex", gap: "10px" }, children: [SP_JSX.jsx(DFL.DialogButton, { onClick: start, children: "Start Calibration" }), SP_JSX.jsx(DFL.DialogButton, { onClick: reset, children: "Reset to Defaults" }), SP_JSX.jsx(DFL.DialogButton, { onClick: close, children: "Close" })] }))] })] }));
}
function openCalibration() {
    DFL.showModal(SP_JSX.jsx(CalibrationModal, {}));
}

function Settings({ config, setConfig }) {
    const setSshEnabled$1 = async (enabled) => {
        if (enabled === !!config.sshEnabled) {
            return;
        }
        setConfig((current) => (current ? { ...current, sshEnabled: enabled } : current));
        try {
            const applied = await setSshEnabled(enabled);
            setConfig((current) => (current ? { ...current, sshEnabled: applied } : current));
        }
        catch (error) {
            setConfig((current) => (current ? { ...current, sshEnabled: !enabled } : current));
        }
    };
    const setControllerType$1 = async (value) => {
        const previous = config.controllerType || "deck-uhid";
        setConfig((current) => (current ? { ...current, controllerType: value } : current));
        try {
            const applied = await setControllerType(value);
            setConfig((current) => (current ? { ...current, controllerType: applied } : current));
        }
        catch (error) {
            setConfig((current) => (current ? { ...current, controllerType: previous } : current));
        }
    };
    const setSleepMode$1 = async (value) => {
        const previous = config.sleepMode || "";
        setConfig((current) => (current ? { ...current, sleepMode: value } : current));
        try {
            const applied = await setSleepMode(value);
            setConfig((current) => (current ? { ...current, sleepMode: applied } : current));
        }
        catch (error) {
            setConfig((current) => (current ? { ...current, sleepMode: previous } : current));
            toaster.toast({ title: "Could not change sleep mode", body: String(error) });
        }
    };
    const sleepModes = config.sleepModes || [];
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "Controller", children: [config.controllerSupported ? (SP_JSX.jsx(SelectEdit, { label: "Emulation", value: config.controllerType || "deck-uhid", options: config.controllerTypes || [], onChange: setControllerType$1 })) : (SP_JSX.jsx(DFL.Field, { label: "Controller emulation", description: "Managed by Batocera/evmapy on this image; Armada's InputPlumber selector is not installed." })), SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: openCalibration, children: "Launch Calibration" })] }), SP_JSX.jsxs(DFL.PanelSection, { title: "System", children: [SP_JSX.jsx(ToggleRow, { label: "Enable SSH", description: "Persists Batocera's Dropbear service setting.", value: !!config.sshEnabled, onChange: setSshEnabled$1 }), sleepModes.length > 1 ? (SP_JSX.jsx(SelectEdit, { label: "Sleep Mode", value: config.sleepMode || sleepModes[0]?.data || "", options: sleepModes, onChange: setSleepMode$1 })) : null, SP_JSX.jsx(DFL.Field, { label: "OS Version", description: config.osVersion || "unknown" }), (config.warnings || []).map((warning) => SP_JSX.jsx(DFL.Field, { label: "Plugin warning", description: warning }, warning))] })] }));
}

function Content() {
    const [tab, setTab] = SP_REACT.useState("Compatibility");
    const [config, setConfig] = SP_REACT.useState(null);
    const [message, setMessage] = SP_REACT.useState("Loading");
    const savedPowerSnapshot = SP_REACT.useRef("");
    const savedTweaksSnapshot = SP_REACT.useRef("");
    const installedGamesRequested = SP_REACT.useRef(false);
    const load = SP_REACT.useCallback(async () => {
        try {
            const next = await getConfig();
            next.game = currentGame();
            next.selectedGame = next.game || null;
            savedPowerSnapshot.current = JSON.stringify(next.power);
            savedTweaksSnapshot.current = JSON.stringify(next.tweaks);
            setConfig((current) => ({ ...next, installedGames: current?.installedGames || next.installedGames }));
            setMessage("");
        }
        catch (error) {
            setMessage(String(error));
        }
    }, []);
    SP_REACT.useEffect(() => { load(); }, [load]);
    SP_REACT.useEffect(() => {
        if (!config || installedGamesRequested.current)
            return;
        installedGamesRequested.current = true;
        let cancelled = false;
        getInstalledGames()
            .then((installedGames) => {
            if (!cancelled)
                setConfig((current) => (current ? { ...current, installedGames } : current));
        })
            .catch(() => { });
        return () => { cancelled = true; };
    }, [!!config]);
    SP_REACT.useEffect(() => {
        if (!config)
            return;
        let cancelled = false;
        const refreshRuntime = async () => {
            try {
                const runtimeGame = currentGame();
                if (cancelled)
                    return;
                setConfig((current) => {
                    if (!current)
                        return current;
                    const currentApp = current.game?.appid || "";
                    const nextApp = runtimeGame?.appid || "";
                    const currentName = current.game?.name || "";
                    const nextName = runtimeGame?.name || "";
                    if (currentApp === nextApp && currentName === nextName)
                        return current;
                    return { ...current, game: runtimeGame };
                });
            }
            catch (error) { }
        };
        const timer = window.setInterval(refreshRuntime, 2000);
        refreshRuntime();
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [!!config]);
    useDebouncedSave({ config, field: "power", snapshot: savedPowerSnapshot, save: savePowerConfig, setConfig, onError: load });
    useDebouncedSave({ config, field: "tweaks", snapshot: savedTweaksSnapshot, save: saveTweaks, setConfig, onError: load });
    if (!config) {
        return (SP_JSX.jsxs(DFL.PanelSection, { title: "Batocera Control", children: [SP_JSX.jsx(DFL.Field, { label: message === "Loading" ? "Loading" : "Failed to load plugin settings", description: message === "Loading" ? "" : message }), message !== "Loading" ? SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: load, children: "Retry" }) : null] }));
    }
    const tabContent = (content) => (SP_JSX.jsx("div", { className: "armada-control-tab-content", children: content }));
    return (SP_JSX.jsxs("div", { className: "armada-control-tabs", children: [SP_JSX.jsx("style", { children: styles }), SP_JSX.jsx(DFL.Tabs, { activeTab: tab, onShowTab: setTab, tabs: [
                    { id: "Compatibility", title: tabIcons.Compatibility, content: tabContent(SP_JSX.jsx(Compatibility, { config: config, setConfig: setConfig })) },
                    { id: "LSFG", title: tabIcons.LSFG, content: tabContent(SP_JSX.jsx(Lsfg, { config: config, setConfig: setConfig })) },
                    { id: "Power", title: tabIcons.Power, content: tabContent(SP_JSX.jsx(Power, { config: config, setConfig: setConfig })) },
                    { id: "LEDs", title: tabIcons.LEDs, content: tabContent(SP_JSX.jsx(LedControl, { config: config, setConfig: setConfig })) },
                    { id: "OLED", title: tabIcons.OLED, content: tabContent(SP_JSX.jsx(OledCare, { config: config, setConfig: setConfig })) },
                    { id: "Paddles", title: tabIcons.Paddles, content: tabContent(SP_JSX.jsx(BackPaddles, { config: config, setConfig: setConfig })) },
                    { id: "Advanced", title: tabIcons.Advanced, content: tabContent(SP_JSX.jsx(Settings, { config: config, setConfig: setConfig })) },
                ] })] }));
}

const INHERIT = "__batocera_inherit__";
function inheritedLabel(feature) {
    const value = feature.inheritedValue;
    if (value === null || value === undefined || value === "")
        return "Inherit (Auto)";
    const choice = feature.choices?.find((item) => item.data === value);
    return `Inherit (${choice?.label || value})`;
}
function SelectFeature({ feature, disabled, onChange, }) {
    const choices = [
        { data: INHERIT, label: inheritedLabel(feature) },
        ...(feature.choices || []),
    ];
    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.DropdownItem, { label: feature.label, description: feature.description, disabled: disabled, selectedOption: feature.directValue === null ? INHERIT : feature.directValue, rgOptions: choices, onChange: (option) => onChange(option.data === INHERIT ? null : String(option.data)) }) }));
}
function SliderFeature({ feature, disabled, onChange, }) {
    const minimum = Number(feature.minimum ?? 0);
    const maximum = Number(feature.maximum ?? 100);
    const step = Number(feature.step ?? 1);
    const inherited = Number(feature.inheritedValue);
    const direct = Number(feature.directValue);
    const value = Number.isFinite(direct)
        ? direct
        : Number.isFinite(inherited)
            ? inherited
            : minimum;
    const overridden = feature.directValue !== null;
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: feature.label, description: `${feature.description}${feature.description ? " " : ""}${inheritedLabel(feature)}.`, checked: overridden, disabled: disabled, onChange: (enabled) => onChange(enabled ? String(value) : null) }) }), overridden ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.SliderField, { label: "Per-game value", value: value, min: minimum, max: maximum, step: step, valueSuffix: feature.suffix || "", showValue: true, disabled: disabled, onChange: (next) => onChange(String(next)) }) })) : null] }));
}
function TextFeature({ feature, disabled, onChange, }) {
    const [text, setText] = SP_REACT.useState(feature.directValue ?? feature.inheritedValue ?? "");
    SP_REACT.useEffect(() => {
        setText(feature.directValue ?? feature.inheritedValue ?? "");
    }, [feature.directValue, feature.inheritedValue, feature.setting]);
    const overridden = feature.directValue !== null;
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: feature.label, description: `${feature.description}${feature.description ? " " : ""}${inheritedLabel(feature)}.`, checked: overridden, disabled: disabled, onChange: (enabled) => onChange(enabled ? text : null) }) }), overridden ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "Per-game value", childrenLayout: "below", children: SP_JSX.jsx(DFL.TextField, { value: text, disabled: disabled, onChange: (event) => setText(event.currentTarget.value), onBlur: () => {
                            if (text !== feature.directValue)
                                onChange(text);
                        } }) }) })) : null] }));
}
function EmulationSettingsModal({ appid, closeModal, }) {
    const [state, setState] = SP_REACT.useState(null);
    const [saving, setSaving] = SP_REACT.useState("");
    const [error, setError] = SP_REACT.useState("");
    SP_REACT.useEffect(() => {
        let cancelled = false;
        getEmulationState(appid)
            .then((next) => {
            if (!cancelled)
                setState(next);
        })
            .catch((reason) => {
            if (!cancelled)
                setError(String(reason));
        });
        return () => {
            cancelled = true;
        };
    }, [appid]);
    const save = async (setting, value) => {
        setSaving(setting);
        setError("");
        try {
            setState(await setEmulationGameSetting(appid, setting, value));
        }
        catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        }
        finally {
            setSaving("");
        }
    };
    const featureControl = (feature) => {
        const props = {
            key: feature.setting,
            feature,
            disabled: !!saving,
            onChange: (value) => void save(feature.setting, value),
        };
        if (feature.kind === "slider")
            return SP_JSX.jsx(SliderFeature, { ...props });
        if (feature.kind === "text")
            return SP_JSX.jsx(TextFeature, { ...props });
        return SP_JSX.jsx(SelectFeature, { ...props });
    };
    return (SP_JSX.jsxs(DFL.ModalRoot, { onCancel: closeModal, children: [SP_JSX.jsx(DFL.DialogHeader, { children: "Emulation Settings" }), SP_JSX.jsx(DFL.DialogBody, { children: SP_JSX.jsxs("div", { style: {
                        boxSizing: "border-box",
                        width: "min(640px, calc(100vw - 160px))",
                        maxWidth: "100%",
                        maxHeight: "calc(100vh - 260px)",
                        minHeight: "160px",
                        overflowX: "hidden",
                        overflowY: "auto",
                        paddingRight: "8px",
                    }, children: [!state && !error ? SP_JSX.jsx(DFL.Field, { label: "Loading Batocera settings\u2026" }) : null, state && !state.supported ? SP_JSX.jsx(DFL.Field, { label: state.reason || "This shortcut is not managed by Batocera." }) : null, error ? SP_JSX.jsx(DFL.Field, { label: "Could not save setting", description: error }) : null, state?.supported && state.emulator && state.core ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.Field, { label: `${state.name} — ${state.systemName}`, description: "Per-game Batocera settings. Inherit removes the game override; changes apply on the next launch." }), SP_JSX.jsxs(DFL.PanelSection, { title: "Emulator", children: [SP_JSX.jsx(SelectFeature, { feature: state.emulator, disabled: !!saving, onChange: (value) => void save("emulator", value) }), SP_JSX.jsx(SelectFeature, { feature: state.core, disabled: !!saving, onChange: (value) => void save("core", value) })] }), (state.groups || []).map((group) => (SP_JSX.jsx(DFL.PanelSection, { title: group.name, children: group.features.map(featureControl) }, group.name)))] })) : null] }) }), SP_JSX.jsx(DFL.DialogFooter, { children: SP_JSX.jsx(DFL.DialogButton, { onClick: closeModal, children: "Close" }) })] }));
}

const MENU_ITEM_KEY = "batocera-emulation-settings";
let managedAppids = new Set();
function unsignedAppid(value) {
    return Number(value) >>> 0;
}
async function refreshEmulationManagedAppids() {
    const appids = await getEmulationManagedAppids();
    managedAppids = new Set(appids.map(unsignedAppid).filter(Boolean));
}
function eligible(appid) {
    return managedAppids.has(unsignedAppid(appid));
}
function openSettings(appid) {
    if (!eligible(appid))
        return;
    DFL.showModal(SP_REACT.createElement(EmulationSettingsModal, { appid: String(unsignedAppid(appid)) }));
}
function dedupe(items) {
    const index = items.findIndex((item) => item?.key === MENU_ITEM_KEY);
    if (index >= 0)
        items.splice(index, 1);
}
function resolveItemsAppid(items, fallback) {
    const owned = items;
    const current = owned.find((item) => {
        const appid = item?._owner?.pendingProps?.overview?.appid;
        return !!appid && appid !== fallback;
    })?._owner?.pendingProps?.overview?.appid;
    if (current)
        return current;
    const found = DFL.findInTree(items, (node) => !!node?.app?.appid, { walkable: ["props", "children"] });
    return found?.app?.appid ?? fallback;
}
function insertItem(items, fallbackAppid) {
    dedupe(items);
    const appid = resolveItemsAppid(items, fallbackAppid);
    if (!eligible(appid))
        return;
    const propertiesIndex = items.findIndex((item) => DFL.findInReactTree(item, (node) => !!node?.onSelected && node.onSelected.toString().includes("AppProperties")));
    const menuItem = SP_REACT.createElement(DFL.MenuItem, { key: MENU_ITEM_KEY, onSelected: () => openSettings(appid) }, "Emulation Settings");
    if (propertiesIndex >= 0)
        items.splice(propertiesIndex, 0, menuItem);
    else
        items.push(menuItem);
}
function isLibraryAppMenu(items) {
    return (Array.isArray(items) &&
        !!DFL.findInReactTree(items, (node) => !!node?.props?.onSelected &&
            node.props.onSelected.toString().includes("launchSource")));
}
function componentAppid(component) {
    const ownerAppid = component?._owner?.pendingProps?.overview?.appid;
    if (ownerAppid)
        return ownerAppid;
    const found = DFL.findInTree(component?.props?.children, (node) => !!node?.app?.appid, { walkable: ["props", "children"] });
    return found?.app?.appid ?? 0;
}
function libraryContextMenu() {
    try {
        const module = DFL.findModuleByExport((candidate) => typeof candidate?.toString === "function" &&
            candidate.toString().includes("().LibraryContextMenu"));
        const factory = Object.values(module || {}).find((candidate) => typeof candidate?.toString === "function" &&
            candidate.toString().includes("navigator:"));
        return factory ? DFL.fakeRenderComponent(factory)?.type ?? null : null;
    }
    catch (error) {
        console.error("[Batocera Control] LibraryContextMenu lookup failed", error);
        return null;
    }
}
function applyEmulationMenuPatch() {
    const menu = libraryContextMenu();
    if (!menu)
        return { unpatch: () => undefined };
    const patches = [];
    let innerInstalled = false;
    const outer = DFL.afterPatch(menu.prototype, "render", (_args, component) => {
        const appid = componentAppid(component);
        if (!innerInstalled) {
            innerInstalled = true;
            const inner = DFL.afterPatch(component, "type", (_innerArgs, rendered) => {
                const prototype = rendered?.type?.prototype;
                if (!prototype)
                    return rendered;
                patches.push(DFL.afterPatch(prototype, "render", (_renderArgs, result) => {
                    const items = result?.props?.children?.[0];
                    if (isLibraryAppMenu(items)) {
                        try {
                            insertItem(items, appid);
                        }
                        catch (error) {
                            console.error("[Batocera Control] menu insertion failed", error);
                        }
                    }
                    return result;
                }));
                if (typeof prototype.shouldComponentUpdate === "function") {
                    patches.push(DFL.afterPatch(prototype, "shouldComponentUpdate", (updateArgs, shouldUpdate) => {
                        const next = updateArgs?.[0]?.children;
                        if (Array.isArray(next)) {
                            dedupe(next);
                            if (shouldUpdate === true)
                                insertItem(next, appid);
                        }
                        return shouldUpdate;
                    }));
                }
                return rendered;
            });
            patches.push(inner);
        }
        else {
            const children = component?.props?.children;
            if (Array.isArray(children))
                insertItem(children, appid);
        }
        return component;
    });
    patches.push(outer);
    return {
        unpatch() {
            for (const patch of [...patches].reverse()) {
                try {
                    if (!patch.hasUnpatched)
                        patch.unpatch();
                }
                catch (error) {
                    console.error("[Batocera Control] menu unpatch failed", error);
                }
            }
        },
    };
}

var index = definePlugin(() => {
    routerHook.addGlobalComponent("BatoceraControlOledSaver", () => SP_JSX.jsx(OledScreensaverOverlay, {}));
    const emulationMenuPatch = applyEmulationMenuPatch();
    void refreshEmulationManagedAppids().catch(() => { });
    const emulationManifestTimer = window.setInterval(() => void refreshEmulationManagedAppids().catch(() => { }), 15000);
    let unregisterDownloadWatcher = () => { };
    let cancelled = false;
    const persistHandledGames = () => saveCompatApplied(handledGameAppids()).catch(() => { });
    const handledRequest = getCompatApplied()
        .then((appids) => ({ appids, loaded: true }))
        .catch(() => ({ appids: [], loaded: false }));
    Promise.all([getConfig(), getInstalledGames(), handledRequest])
        .then(([config, games, handled]) => {
        if (cancelled)
            return;
        configureCompatPolicy(config.tweaks?.global?.windowsCompatTool, handled.loaded && config.tweaks?.global?.autoApplyCompat !== false, handled.appids, config.launchWrapperPath);
        const persist = handled.loaded ? persistHandledGames : () => { };
        unregisterDownloadWatcher = registerDownloadWatcher(persist);
        window.setTimeout(() => {
            if (cancelled)
                return;
            sweepInstalledGames(games.map((game) => game.appid)).then(persist).catch(() => { });
        }, 3000);
    })
        .catch(() => { });
    return {
        name: "Batocera Control",
        content: SP_JSX.jsx(Content, {}),
        onDismount() {
            cancelled = true;
            unregisterDownloadWatcher();
            window.clearInterval(emulationManifestTimer);
            emulationMenuPatch.unpatch();
            setOledScreensaverActive(false);
            routerHook.removeGlobalComponent("BatoceraControlOledSaver");
        },
        icon: (SP_JSX.jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", width: "24", height: "24", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [SP_JSX.jsx("path", { d: "M14 17H5" }), SP_JSX.jsx("path", { d: "M19 7h-9" }), SP_JSX.jsx("circle", { cx: "17", cy: "17", r: "3" }), SP_JSX.jsx("circle", { cx: "7", cy: "7", r: "3" })] })),
        alwaysRender: true,
    };
});

export { index as default };
//# sourceMappingURL=index.js.map
