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
const getFansState = () => call("get_fans_state");
const saveFanCurves = (fanCurves, fanSettings) => call("save_fan_curves", fanCurves, fanSettings);
const getCurrentTemp = () => call("get_current_temp");
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
const reapplyPerf = (appid) => call("reapply_perf", appid);
const setControllerType = (value) => call("set_controller_type", value);
const getControllerState = () => call("get_controller_state");
const saveCalibration = (capture) => call("save_calibration", capture);
const resetCalibration = () => call("reset_calibration");
const beginCalibrationSession = (token) => call("begin_calibration_session", token);
const endCalibrationSession = (token) => call("end_calibration_session", token);
const saveJoystickLed = (data) => call("save_joystick_led", data);
const saveOledCare = (data) => call("save_oled_care", data);
const restartOledCare = () => call("restart_oled_care");
const noteOledActivity = () => call("note_oled_activity");
const getOledIdle = () => call("get_oled_idle");
const saveBackPaddles = (data) => call("save_back_paddles", data);
const saveLsfg = (data) => call("save_lsfg", data);
const setLsfgGameEnabled = (appid, enabled) => call("set_lsfg_game_enabled", appid, enabled);
const getEmulationManagedAppids = () => call("get_emulation_managed_appids");
const getEmulationState = (appid, emulator = "", core = "") => call("get_emulation_state", appid, emulator, core);
const setEmulationGameSetting = (appid, setting, value) => call("set_emulation_game_setting", appid, setting, value);

let active$1 = false;
let durationSec = 3;
let passes = 3;
let swallowClicksUntil = 0;
const listeners$2 = new Set();
function setOledRefresherActive(value, opts) {
    if (opts?.durationSec != null)
        durationSec = Math.max(1, opts.durationSec);
    if (opts?.passes != null)
        passes = Math.max(1, opts.passes);
    if (active$1 === value) {
        for (const listener of listeners$2)
            listener(active$1);
        return;
    }
    active$1 = value;
    if (!value)
        swallowClicksUntil = performance.now() + 450;
    for (const listener of listeners$2)
        listener(active$1);
}
function getOledRefresherActive() {
    return active$1;
}
function getOledRefresherOpts() {
    return { durationSec, passes };
}
function oledRefresherSwallowingClick() {
    return performance.now() < swallowClicksUntil;
}
function useOledRefresherActive() {
    const [value, setValue] = SP_REACT.useState(active$1);
    SP_REACT.useEffect(() => {
        listeners$2.add(setValue);
        return () => {
            listeners$2.delete(setValue);
        };
    }, []);
    return value;
}

/** GamepadUI main window. Plugin `window` is often SharedJSContext (1×1). */
function steamWindow() {
    try {
        const sp = DFL.findSP();
        if (sp?.document?.documentElement)
            return sp;
    }
    catch {
        /* ignore */
    }
    return window;
}
function steamClient(win = steamWindow()) {
    return win.SteamClient || window.SteamClient;
}
function steamNavManager(win = steamWindow()) {
    return (win.SteamUIStore?.NavigationManager
        || window.SteamUIStore?.NavigationManager
        || DFL.getFocusNavController());
}

/** Same enum MagicBlackDecky / Steam GamepadUI use. */
var UIComposition;
(function (UIComposition) {
    UIComposition[UIComposition["Hidden"] = 0] = "Hidden";
    UIComposition[UIComposition["Notification"] = 1] = "Notification";
    UIComposition[UIComposition["Overlay"] = 2] = "Overlay";
    UIComposition[UIComposition["Opaque"] = 3] = "Opaque";
    UIComposition[UIComposition["OverlayKeyboard"] = 4] = "OverlayKeyboard";
    UIComposition[UIComposition["OverlayQAM"] = 5] = "OverlayQAM";
    UIComposition[UIComposition["OverlayKeyboard1"] = 6] = "OverlayKeyboard1";
})(UIComposition || (UIComposition = {}));
function looksLikeHook(value) {
    if (typeof value !== "function")
        return false;
    const source = value.toString();
    return (source.includes("AddMinimumCompositionStateRequest")
        && source.includes("ChangeMinimumCompositionStateRequest")
        && source.includes("RemoveMinimumCompositionStateRequest")
        && !source.includes("m_mapCompositionStateRequests"));
}
function looksLikeApi(value) {
    return (!!value
        && typeof value.AddMinimumCompositionStateRequest === "function"
        && typeof value.RemoveMinimumCompositionStateRequest === "function");
}
function findCompositionApi() {
    try {
        const exported = DFL.findModuleExport((exp) => looksLikeApi(exp));
        if (looksLikeApi(exported))
            return exported;
    }
    catch {
        /* ignore */
    }
    try {
        const child = DFL.findModuleChild((mod) => {
            if (!mod || typeof mod !== "object")
                return undefined;
            for (const key of Object.keys(mod)) {
                const value = mod[key];
                if (looksLikeApi(value))
                    return value;
            }
            return undefined;
        });
        if (looksLikeApi(child))
            return child;
    }
    catch {
        /* ignore */
    }
    const roots = [steamWindow(), window];
    for (const win of roots) {
        const store = win.SteamUIStore;
        if (looksLikeApi(store))
            return store;
        if (store && typeof store === "object") {
            for (const key of Object.keys(store)) {
                const value = store[key];
                if (looksLikeApi(value))
                    return value;
            }
        }
    }
    return undefined;
}
/** MagicBlack's React hook; no-op if this Steam build does not export it. */
const useUIComposition = (() => {
    try {
        const hook = DFL.findModuleChild((mod) => {
            if (!mod || typeof mod !== "object")
                return undefined;
            for (const key of Object.keys(mod)) {
                const value = mod[key];
                if (looksLikeHook(value))
                    return value;
            }
            return undefined;
        });
        if (typeof hook === "function")
            return hook;
    }
    catch {
        /* ignore */
    }
    return () => { };
})();
const STYLE_ID = "batocera-oled-cover-style";
const BODY_CLASS = "batocera-oled-cover";
const COVER_CSS = `
html.${BODY_CLASS},
body.${BODY_CLASS} {
  overflow: hidden !important;
}
#batocera-oled-refresh-root {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: auto !important;
  height: auto !important;
  z-index: 2147483646 !important;
  background: #000 !important;
  pointer-events: auto !important;
  cursor: none !important;
}
#batocera-oled-refresh-root canvas {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  display: block !important;
  image-rendering: pixelated !important;
}
`;
function applyCoverChrome(doc) {
    doc.documentElement.classList.add(BODY_CLASS);
    doc.body?.classList.add(BODY_CLASS);
    if (!doc.getElementById(STYLE_ID)) {
        const style = doc.createElement("style");
        style.id = STYLE_ID;
        style.textContent = COVER_CSS;
        doc.head.appendChild(style);
    }
}
function releaseCoverChrome(doc) {
    doc.documentElement.classList.remove(BODY_CLASS);
    doc.body?.classList.remove(BODY_CLASS);
    doc.getElementById(STYLE_ID)?.remove();
}
/** Raise GamepadUI to overlay composition so header/footer are not a separate layer. */
function pushOverlayComposition() {
    const token = `batocera-oled-${Math.random().toString(36).slice(2)}`;
    const api = findCompositionApi();
    try {
        api?.AddMinimumCompositionStateRequest(token, UIComposition.Overlay);
    }
    catch {
        /* ignore */
    }
    const win = steamWindow();
    try {
        steamClient(win)?.Window?.SetComposition?.(UIComposition.Overlay, [], 1);
    }
    catch {
        /* ignore */
    }
    return () => {
        try {
            api?.RemoveMinimumCompositionStateRequest(token);
        }
        catch {
            /* ignore */
        }
        try {
            steamClient(win)?.Window?.SetComposition?.(UIComposition.Opaque, [], 1);
        }
        catch {
            /* ignore */
        }
    };
}

const AYN_TEXT = "Anti-image-retention pixel refresh in progress, tap to exit (%ds)";
const CELL_PX = 3;
const ARM_MS = 450;
const SHIELD_MS = 480;
let mounted = null;
function controllerButtonsPressed$1(changes) {
    return Array.isArray(changes) && changes.some((change) => {
        try {
            return BigInt(String(change?.ulButtons ?? 0)) !== 0n
                || BigInt(String(change?.ulUpperButtons ?? 0)) !== 0n;
        }
        catch {
            return Number(change?.ulButtons || 0) !== 0 || Number(change?.ulUpperButtons || 0) !== 0;
        }
    });
}
function disableSmoothing(ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
}
/** Same recipe as the pygame smoke: fill 3×3 rects, then blit 1:1. */
function paintBand(ctx, width, height, cell) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    const inset = 16;
    const innerW = width - inset * 2;
    const innerH = height - inset * 2;
    if (innerW < cell || innerH < cell)
        return;
    const cols = Math.floor(innerW / cell);
    const rows = Math.floor(innerH / cell);
    for (let row = 0; row < rows; row++) {
        const y = inset + row * cell;
        for (let col = 0; col < cols; col++) {
            const x = inset + col * cell;
            ctx.fillStyle = `rgb(${(Math.random() * 256) | 0},${(Math.random() * 256) | 0},${(Math.random() * 256) | 0})`;
            ctx.fillRect(x, y, cell, cell);
        }
    }
}
function eat(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
}
function unmount(immediate = false) {
    const current = mounted;
    if (!current)
        return;
    current.stop();
    const finish = () => {
        if (mounted?.root !== current.root)
            return;
        current.releaseComposition();
        current.root.remove();
        releaseCoverChrome(current.doc);
        mounted = null;
    };
    if (immediate)
        finish();
    else
        current.win.setTimeout(finish, SHIELD_MS);
}
function openOledRefresher(opts) {
    setOledRefresherActive(true, opts);
    try {
        DFL.Navigation.CloseSideMenus();
    }
    catch {
        /* ignore */
    }
    window.setTimeout(() => mountOledRefresher(), 80);
}
function mountOledRefresher() {
    if (mounted)
        unmount(true);
    const win = steamWindow();
    const doc = win.document;
    const root = doc.createElement("div");
    root.id = "batocera-oled-refresh-root";
    root.setAttribute("aria-label", AYN_TEXT.replace("%ds", ""));
    const canvas = doc.createElement("canvas");
    const label = doc.createElement("div");
    label.style.cssText = "position:absolute;left:4%;right:4%;top:6%;text-align:center;color:#fff;font-size:22px;font-weight:600;line-height:1.35;user-select:none;pointer-events:none;z-index:1;";
    root.append(canvas, label);
    applyCoverChrome(doc);
    doc.body.appendChild(root);
    const opts = getOledRefresherOpts();
    const durationSec = Math.max(1, opts.durationSec);
    const passes = Math.max(1, opts.passes);
    let armed = false;
    let closing = false;
    let raf = 0;
    const cleanups = [];
    const close = () => {
        if (!armed || closing)
            return;
        closing = true;
        setOledRefresherActive(false);
        unmount();
    };
    const armTimer = win.setTimeout(() => {
        armed = true;
    }, ARM_MS);
    cleanups.push(() => win.clearTimeout(armTimer));
    const releaseComposition = pushOverlayComposition();
    const cell = CELL_PX;
    const dpr = win.devicePixelRatio || 1;
    const cssW = Math.max(1, win.innerWidth || root.clientWidth || win.screen?.width || 1920);
    const cssH = Math.max(1, win.innerHeight || root.clientHeight || win.screen?.height || 1080);
    // Steam is 1353×761 CSS at dpr 1.42 → 1920×1080 gamescope. Draw in that
    // backing store so 3×3 cells are real panel pixels, not 4.26px CSS blobs.
    const pixelW = Math.max(cell, Math.round((cssW * dpr) / cell) * cell);
    const pixelH = Math.max(cell, Math.round((cssH * dpr) / cell) * cell);
    canvas.width = pixelW;
    canvas.height = pixelH;
    const ctx = canvas.getContext("2d");
    const band = doc.createElement("canvas");
    const bandCtx = band.getContext("2d");
    if (ctx && bandCtx) {
        disableSmoothing(ctx);
        disableSmoothing(bandCtx);
        const bandH = Math.max(cell * 8, Math.floor(pixelH / 3 / cell) * cell);
        band.width = pixelW;
        band.height = bandH;
        const paintNoise = () => {
            disableSmoothing(bandCtx);
            paintBand(bandCtx, pixelW, bandH, cell);
        };
        paintNoise();
        const totalSec = durationSec * passes;
        const startedAt = win.performance.now();
        let lastPass = -1;
        const loop = (now) => {
            if (closing)
                return;
            const elapsed = (now - startedAt) / 1000;
            if (elapsed >= totalSec) {
                armed = true;
                close();
                return;
            }
            const pass = Math.min(passes - 1, Math.floor(elapsed / durationSec));
            if (pass !== lastPass) {
                lastPass = pass;
                paintNoise();
            }
            const frac = Math.min(1, (elapsed - pass * durationSec) / durationSec);
            const travel = Math.max(0, pixelH - bandH);
            const y = Math.floor((frac * travel) / cell) * cell;
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, pixelW, pixelH);
            disableSmoothing(ctx);
            ctx.drawImage(band, 0, y);
            label.textContent = AYN_TEXT.replace("%ds", `${Math.max(0, Math.ceil(totalSec - elapsed))}s`);
            raf = win.requestAnimationFrame(loop);
        };
        raf = win.requestAnimationFrame(loop);
        cleanups.push(() => win.cancelAnimationFrame(raf));
    }
    const onPointerDown = (event) => {
        eat(event);
        try {
            root.setPointerCapture(event.pointerId);
        }
        catch {
            /* ignore */
        }
    };
    const onPointerUp = (event) => {
        eat(event);
        close();
    };
    const onClick = (event) => eat(event);
    const onKey = (event) => {
        if (!event.key)
            return;
        eat(event);
        close();
    };
    root.addEventListener("pointerdown", onPointerDown, true);
    root.addEventListener("pointerup", onPointerUp, true);
    root.addEventListener("click", onClick, true);
    root.addEventListener("touchstart", onClick, { capture: true, passive: false });
    root.addEventListener("touchend", onPointerUp, { capture: true, passive: false });
    win.addEventListener("keydown", onKey, true);
    cleanups.push(() => {
        root.removeEventListener("pointerdown", onPointerDown, true);
        root.removeEventListener("pointerup", onPointerUp, true);
        root.removeEventListener("click", onClick, true);
        root.removeEventListener("touchstart", onClick, true);
        root.removeEventListener("touchend", onPointerUp, true);
        win.removeEventListener("keydown", onKey, true);
    });
    const nav = steamNavManager(win);
    try {
        const release = nav?.SetCatchAllGamepadInput?.(() => close());
        if (typeof release === "function")
            cleanups.push(release);
        else if (nav?.SetCatchAllGamepadInput) {
            cleanups.push(() => {
                try {
                    nav.SetCatchAllGamepadInput(null);
                }
                catch {
                    /* ignore */
                }
            });
        }
    }
    catch {
        /* ignore */
    }
    try {
        const registration = steamClient(win)?.Input?.RegisterForControllerStateChanges?.((changes) => {
            if (controllerButtonsPressed$1(changes))
                close();
        });
        if (registration?.unregister) {
            cleanups.push(() => {
                try {
                    registration.unregister();
                }
                catch {
                    /* ignore */
                }
            });
        }
    }
    catch {
        /* ignore */
    }
    const padPoll = win.setInterval(() => {
        if (!armed || closing)
            return;
        try {
            const pads = win.navigator.getGamepads?.() || [];
            for (const pad of pads) {
                if (!pad)
                    continue;
                if (pad.buttons.some((button) => button.pressed || button.value > 0.35)) {
                    close();
                    return;
                }
                if (pad.axes.some((axis) => Math.abs(axis) > 0.45)) {
                    close();
                    return;
                }
            }
        }
        catch {
            /* ignore */
        }
    }, 80);
    cleanups.push(() => win.clearInterval(padPoll));
    mounted = {
        root,
        win,
        doc,
        releaseComposition,
        stop: () => {
            for (const fn of cleanups.splice(0)) {
                try {
                    fn();
                }
                catch {
                    /* ignore */
                }
            }
        },
    };
}

let active = false;
const listeners$1 = new Set();
function setOledScreensaverActive(value) {
    if (active === value)
        return;
    active = value;
    for (const listener of listeners$1)
        listener(active);
}
function getOledScreensaverActive() {
    return active;
}
function useOledScreensaverActive() {
    const [value, setValue] = SP_REACT.useState(active);
    SP_REACT.useEffect(() => {
        listeners$1.add(setValue);
        return () => {
            listeners$1.delete(setValue);
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
function OledScreensaverSurface({ clock }) {
    useUIComposition(UIComposition.Overlay);
    SP_REACT.useEffect(() => {
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
            catch {
                registration = undefined;
            }
        }, 500);
        return () => {
            window.clearTimeout(delay);
            window.removeEventListener("keydown", onKey, true);
            try {
                registration?.unregister?.();
            }
            catch {
                /* ignore */
            }
        };
    }, []);
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
    if (!active)
        return null;
    return SP_JSX.jsx(OledScreensaverSurface, { clock: clock });
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
    Fans: (SP_JSX.jsx(Icon, { path: SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("path", { d: "M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z" }), SP_JSX.jsx("path", { d: "M12 12v.01" })] }) })),
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
      .armada-control-tabs > div > div:first-child {
        position: relative;
      }
      .armada-control-tabs > div > div:first-child::before {
        background: #0D141C;
        box-shadow: none;
        backdrop-filter: none;
      }
      .armada-control-tabs > div > div:first-child::after {
        content: "";
        position: absolute;
        top: 0;
        right: 0;
        width: 36px;
        height: 100%;
        pointer-events: none;
        z-index: 2;
        background: linear-gradient(to right, rgba(13, 20, 28, 0), #0D141C 88%);
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
      .armada-control-tabs [class*="FieldLabel"],
      .armada-control-tabs [class*="fieldlabel"] {
        writing-mode: horizontal-tb !important;
        word-break: normal !important;
        overflow-wrap: break-word;
        white-space: normal;
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

      .afc-scope .afc-field-note {
        box-sizing: border-box;
        width: 100%;
        margin-top: 4px;
        padding: 0 0 6px;
        font-size: 12px;
        line-height: 16px;
        opacity: 0.62;
      }
      .afc-scope .afc-used-by-note {
        padding-bottom: 0;
      }
      .afc-scope .afc-note {
        box-sizing: border-box;
        width: 100%;
        margin-top: 6px;
        padding: 0 0 6px;
        font-size: 12px;
        line-height: 16px;
        opacity: 0.62;
      }
      .afc-scope .afc-reset-row {
        padding: 0 14px 8px;
      }
      .afc-scope .afc-control-inset {
        box-sizing: border-box;
        width: 100%;
        padding: 0 8px;
      }
      .afc-scope .afc-control-inset > * {
        min-width: 0;
        max-width: 100%;
      }
      .afc-scope .afc-control-inset button {
        width: 100% !important;
      }
      .afc-scope .afc-error {
        box-sizing: border-box;
        width: 100%;
        padding: 8px 16px;
        font-size: 12px;
        line-height: 16px;
        color: #ff6b6b;
      }
      .afc-modal-footer {
        display: flex !important;
        flex-direction: column !important;
        gap: 8px;
      }
      .afc-modal-footer-row {
        display: flex;
        flex-direction: row;
        flex-wrap: nowrap;
        gap: 8px;
        width: 100%;
      }
      .afc-modal-footer-half {
        flex: 1;
        min-width: 0;
      }
      .afc-modal-footer-full {
        width: 100%;
      }
      .afc-scope .afc-modal-title {
        margin: 0;
        padding: 4px 0 10px;
        font-size: 20px;
        font-weight: 600;
      }
      .afc-scope .afc-modal-error {
        box-sizing: border-box;
        width: 100%;
        padding: 0 0 8px;
        font-size: 12px;
        line-height: 16px;
        color: #ff6b6b;
      }
      .afc-scope .afc-slider-field {
        width: 100%;
        max-width: none;
        overflow: hidden;
      }
      .afc-scope .afc-slider-field * {
        min-width: 0 !important;
        max-width: 100% !important;
      }
      .afc-scope .afc-graph-focusable {
        display: block;
        width: 100%;
        box-sizing: border-box;
        border-radius: 6px;
        border: 2px solid transparent;
      }
      .afc-scope .afc-graph-focusable.afc-graph-focused {
        border-color: #5cc8ff;
        box-shadow: 0 0 0 2px rgba(92, 200, 255, 0.35);
      }
      .afc-scope .afc-graph-focusable.afc-graph-editing.afc-graph-focused {
        border-color: #ffd166;
        box-shadow: 0 0 0 2px rgba(255, 209, 102, 0.45);
      }
      .afc-scope .afc-points-drawer {
        margin: 4px 0 4px 12px;
        padding: 6px 0 6px 10px;
        background: rgba(92, 200, 255, 0.06);
        border-left: 2px solid rgba(92, 200, 255, 0.45);
      }
      .afc-scope .afc-point-row {
        padding: 0 14px 0;
      }
      .afc-scope .afc-point-row + .afc-point-row {
        margin-top: -8px;
      }
      .afc-scope .afc-point-row-header {
        display: flex;
        align-items: stretch;
        gap: 6px;
      }
      .afc-scope .afc-point-row-header > *:first-child {
        flex: 1;
        min-width: 0;
      }
      .afc-scope .afc-point-row-header > *:last-child {
        flex: 0 0 40px;
        width: 40px;
      }
      .afc-scope .afc-point-row-header button {
        min-width: 0 !important;
        max-width: 100% !important;
      }
      .afc-scope .afc-point-row-header > *:last-child button {
        width: 100% !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      .afc-scope .afc-collapse {
        overflow: hidden;
        transition: max-height 200ms ease;
      }
      .afc-scope .afc-point-details-inner {
        margin: 4px 0 8px 8px;
        padding: 4px 4px 4px 6px;
      }
      .afc-scope .afc-controller-hint {
        box-sizing: border-box;
        width: 100%;
        margin-top: 4px;
        padding: 0 0 6px;
        font-size: 11px;
        line-height: 15px;
        color: #ffd166;
      }
      .afc-scope .afc-min-warning-button {
        border-left: 2px solid rgba(255, 209, 102, 0.6);
        background: rgba(255, 209, 102, 0.08);
        border-radius: 4px;
      }
      .afc-scope .afc-min-warning-hidden {
        display: none;
      }
      .afc-scope button:disabled,
      .afc-scope button[disabled] {
        opacity: 0.35 !important;
        filter: grayscale(70%) !important;
        cursor: not-allowed !important;
      }
    `;

// "Serious" layout is the default: helper descriptions are hidden and the menu
// stays compact. Turning it off restores the detailed guidance text.
let compact = true;
const listeners = new Set();
function getUiCompact() {
    return compact;
}
function setUiCompact(next) {
    if (compact === next)
        return;
    compact = next;
    listeners.forEach((listener) => listener());
}
function subscribe(listener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
function useUiCompact() {
    return SP_REACT.useSyncExternalStore(subscribe, getUiCompact, getUiCompact);
}

// Explanatory helper text. Hidden in the default serious/compact layout and
// shown again when the user reverts to detailed descriptions.
function Hint({ label, description, children }) {
    const compact = useUiCompact();
    if (compact)
        return null;
    return SP_JSX.jsx(DFL.Field, { label: label, description: description, children: children });
}
function SelectEdit({ label, value, options, onChange, labelBelow, disabled, wrapperClassName }) {
    const rgOptions = options.map((option) => (typeof option === "string" ? { data: option, label: option } : option));
    // QAM is ~316px. A long field label *or* a long selected value next to the
    // dropdown gets squeezed into a vertical column of letters / overlaps.
    const selected = rgOptions.find((option) => option.data === value);
    const selectedText = typeof selected?.label === "string" ? selected.label : "";
    const stacked = !!labelBelow
        || (typeof label === "string" && label.length >= 16)
        || selectedText.length >= 18;
    const dropdown = label === undefined ? (SP_JSX.jsx(DFL.Dropdown, { disabled: disabled, selectedOption: value, rgOptions: rgOptions, onChange: (option) => onChange(option.data) })) : stacked ? (SP_JSX.jsx(DFL.Field, { label: label, childrenLayout: "below", childrenContainerWidth: "max", disabled: disabled, children: SP_JSX.jsx(DFL.Dropdown, { disabled: disabled, selectedOption: value, rgOptions: rgOptions, onChange: (option) => onChange(option.data) }) })) : (SP_JSX.jsx(DFL.DropdownItemInternal, { disabled: disabled, childrenContainerWidth: "max", label: label, selectedOption: value, rgOptions: rgOptions, onChange: (option) => onChange(option.data) }));
    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: wrapperClassName ? SP_JSX.jsx("div", { className: wrapperClassName, children: dropdown }) : dropdown }));
}
function ToggleRow({ label, value, onChange, disabled, description, wrapperClassName }) {
    const field = SP_JSX.jsx(DFL.ToggleField, { label: label, description: description, checked: !!value, disabled: disabled, onChange: onChange });
    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: wrapperClassName ? SP_JSX.jsx("div", { className: wrapperClassName, children: field }) : field }));
}
function SliderEdit$1({ label, value, min, max, step, onChange, format, disabled, wrapperClassName = "armada-slider-field" }) {
    const numeric = Number(value);
    const suffix = format && Number.isFinite(numeric) ? ` (${format(numeric)})` : "";
    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { className: wrapperClassName, children: SP_JSX.jsx(DFL.SliderField, { label: `${label}${suffix}`, value: Number.isFinite(numeric) ? numeric : min, min: min, max: max, step: step, showValue: true, disabled: disabled, onChange: (next) => onChange(next) }) }) }));
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
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "Back paddles (M1 / M2)", children: [SP_JSX.jsx(Hint, { label: backend, description: [device || "AYN rear-paddle input", codeMap].filter(Boolean).join(" · "), children: "One system-wide bind. Steam/host actions fire on tap; ES/emulator actions use Home+paddle." }), SP_JSX.jsx(Hint, { label: "Binding targets", description: activeHealth.length ? activeHealth.join(" · ") : "None assigned" })] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Bindings", children: [bp.warning ? SP_JSX.jsx(DFL.Field, { label: "Warning", description: bp.warning }) : null, mouseModeAssigned ? (SP_JSX.jsx(DFL.Field, { label: "Mouse mode pauses gamepad navigation", description: "Press the assigned paddle again to restore controls before changing its binding." })) : null, slots.map((slot) => {
                        const isTap = slot.data === "m1" || slot.data === "m2";
                        const options = isTap ? actions : actions.filter((choice) => !String(choice.data).startsWith("es_"));
                        return (SP_JSX.jsx(SelectEdit, { label: slot.label, labelBelow: true, value: bindings[slot.data] || "none", options: options, onChange: (value) => update(slot.data, value) }, slot.data));
                    })] })] }));
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
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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
// Valve ARM tip (AppID 4628740) — Armada's Proton default; not x86 Proton Experimental.
const DEFAULT_WINDOWS_COMPAT_TOOL = "proton11_arm64";
const USE_DEFAULT_COMPAT = "__armada_default__";
const FOLLOW_STEAM_COMPAT = "__steam_default__";
/** x86 Steam Proton Experimental — broken/confusing on ARM handhelds. */
const HIDDEN_COMPAT_TOOL_IDS = new Set(["proton_experimental", "proton-experimental"]);
const HIDDEN_COMPAT_LABEL_RE = /proton\s*[- ]?experimental/i;
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
function decorateCompatTool(tool) {
    if (tool.id === "proton11_arm64" || tool.id === "Proton11ARM") {
        return { ...tool, label: "Proton 11.0 (ARM64) ★ recommended" };
    }
    return tool;
}
function isHiddenCompatTool(tool) {
    if (!tool.id)
        return true;
    if (HIDDEN_COMPAT_TOOL_IDS.has(tool.id))
        return true;
    return HIDDEN_COMPAT_LABEL_RE.test(tool.id) || HIDDEN_COMPAT_LABEL_RE.test(tool.label);
}
function mapCompatTools(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .map((tool) => ({
        id: String(tool?.strToolName ?? tool?.strName ?? tool?.name ?? ""),
        label: String(tool?.strDisplayName ?? tool?.strToolName ?? tool?.strName ?? ""),
    }))
        .filter((tool) => !isHiddenCompatTool(tool))
        .map(decorateCompatTool);
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
const corePresetOptions = [
    { data: "", label: "System default" },
    { data: "all", label: "All CPUs" },
    { data: "custom", label: "Custom cpulist" },
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
    const [showPerf, setShowPerf] = SP_REACT.useState(false);
    const [reapplying, setReapplying] = SP_REACT.useState(false);
    const [customCores, setCustomCores] = SP_REACT.useState("");
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
                }) }, key))), inheritedEnvEntries.length ? SP_JSX.jsx("div", { className: "armada-subheader", children: "Per-Game Variables" }) : null, ownEnvEntries.map(([key, value]) => (SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => openEnvVar(key), children: SP_JSX.jsx("div", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }, children: value ? `${key}=${value}` : key }) }, key))), SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => openEnvVar(null), children: "+ Add Variable" }), SP_JSX.jsx(Hint, { label: "Applies on next launch", description: "Variables are injected by batocera-control-game-launch before the game starts." })] }));
    const niceEnabled = typeof values.nice === "number";
    const niceValue = niceEnabled ? Number(values.nice) : 0;
    const storedCores = values.cores;
    const coresPreset = storedCores === undefined || storedCores === null || storedCores === ""
        ? ""
        : storedCores === "all"
            ? "all"
            : "custom";
    SP_REACT.useEffect(() => {
        if (coresPreset === "custom" && typeof storedCores === "string" && storedCores !== "all") {
            setCustomCores(storedCores);
        }
        else if (coresPreset !== "custom") {
            setCustomCores("");
        }
    }, [game?.appid, coresPreset, typeof storedCores === "string" ? storedCores : ""]);
    const setNiceEnabled = (on) => {
        if (on)
            patchSettings({ nice: 0 });
        else
            patchSettings({ nice: undefined });
    };
    const setCoresPreset = (choice) => {
        const next = String(choice);
        if (next === "")
            patchSettings({ cores: undefined });
        else if (next === "all")
            patchSettings({ cores: "all" });
        else
            patchSettings({ cores: customCores || "0" });
    };
    const onReapply = async () => {
        if (reapplying)
            return;
        setReapplying(true);
        try {
            const result = await reapplyPerf(game?.appid || null);
            toaster.toast({
                title: "Performance re-applied",
                body: `Touched ${result.pids} thread(s) on pid ${result.pid}`,
            });
        }
        catch (error) {
            toaster.toast({ title: "Could not re-apply", body: String(error) });
        }
        finally {
            setReapplying(false);
        }
    };
    const perfControls = (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.ToggleField, { label: "Override nice", checked: niceEnabled, onChange: setNiceEnabled }), niceEnabled ? (SP_JSX.jsx(SliderEdit$1, { label: "Nice", value: niceValue, min: -20, max: 19, step: 1, format: (value) => String(Math.round(value)), onChange: (value) => patchSettings({ nice: Math.round(value) }) })) : null, SP_JSX.jsx(SelectEdit, { label: "CPU affinity", value: coresPreset, options: corePresetOptions, onChange: setCoresPreset }), coresPreset === "custom" ? (SP_JSX.jsx(DFL.TextField, { label: "cpulist", value: customCores, onChange: (event) => {
                    const next = event.target.value;
                    setCustomCores(next);
                    patchSettings({ cores: next.trim() || undefined });
                } })) : null, SP_JSX.jsx(Hint, { label: "Applies on next launch", description: "Sets nice/affinity before exec. Re-apply can update a live SteamLaunch tree." }), SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: reapplying, onClick: () => { void onReapply(); }, children: reapplying ? "Re-applying..." : "Re-apply to running game" })] }));
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "EDIT GAME PROFILE", children: [SP_JSX.jsx(SelectEdit, { value: game?.appid || "", options: gameOptions, onChange: setSelectedGame }), SP_JSX.jsx("div", { className: "armada-compat-note", children: "Compatibility changes apply on next launch" })] }), SP_JSX.jsxs(DFL.PanelSection, { title: "PROFILE SETTINGS", children: [editingDefault ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(SelectEdit, { labelBelow: true, label: "Default Proton", value: globalTool, options: toolOptions, onChange: onSelectGlobalDefault }), SP_JSX.jsx(DFL.ToggleField, { label: "Apply to New Games", checked: tweaks.global.autoApplyCompat !== false, onChange: (enabled) => {
                                    setAutoApplyCompat(enabled);
                                    patchSettings({ autoApplyCompat: enabled });
                                } }), SP_JSX.jsx(SelectEdit, { label: "Game Resolution", value: defaultResolution, options: resolutionOptions, onChange: setSteamDefaultResolution })] })) : (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(SelectEdit, { labelBelow: true, label: "Compatibility Tool", value: currentTool, options: perGameToolOptions, onChange: onSelectPerGameTool }), SP_JSX.jsx(SelectEdit, { label: "Game Resolution", value: resolution, options: resolutionOptions, onChange: setSteamResolution })] })), resolutionMessage ? SP_JSX.jsx(DFL.Field, { label: "Status", description: resolutionMessage }) : null, config.fexRuntimeSupported ? (SP_JSX.jsx(SelectEdit, { label: "FEX Preset", value: fexValue, options: fexOptions, onChange: onSelectFex })) : (SP_JSX.jsx(DFL.Field, { label: "FEX presets unavailable", description: config.fexRuntimeReason || "The persistent Batocera launch helper could not be installed." })), config.fexRuntimeSupported && isCustom
                        ? fexKnobs.map((knob) => (SP_JSX.jsx(DFL.ToggleField, { label: knob.label, checked: fexConfig[knob.key] === "1", onChange: (value) => setKnob(knob.key, value) }, knob.key)))
                        : null] }), SP_JSX.jsxs(DFL.PanelSection, { title: "ADVANCED", children: [config.fexRuntimeSupported ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => setShowThunks((value) => !value), children: showThunks ? "Hide Host Thunks" : "Host Thunks" }), showThunks
                                ? thunkModules.map((thunk) => (SP_JSX.jsx(DFL.ToggleField, { label: thunk.label, checked: thunks[thunk.module] !== false, onChange: (value) => setThunk(thunk.module, value) }, thunk.module)))
                                : null] })) : null, SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => setShowEnv((value) => !value), children: showEnv ? "Hide Environment" : "Environment" }), showEnv ? SP_JSX.jsx("div", { className: "armada-advanced-group", children: envControls }) : null, SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => setShowPerf((value) => !value), children: showPerf ? "Hide Performance" : "Performance" }), showPerf ? SP_JSX.jsx("div", { className: "armada-advanced-group", children: perfControls }) : null] }), !editingDefault ? (SP_JSX.jsx(DFL.PanelSection, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: resetGame, children: "Reset to Default" }) })) : (SP_JSX.jsx(DFL.PanelSection, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: resettingAll, onClick: confirmResetAllGames, children: resettingAll ? "Resetting..." : "Reset All Games" }) }))] }));
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
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSection, { title: "Joystick LEDs", children: SP_JSX.jsx(Hint, { label: "Batocera service", children: "Uses batocera-led-handheld (same as EmulationStation). Both rings share color and mode." }) }), SP_JSX.jsxs(DFL.PanelSection, { title: "L/R rings", children: [SP_JSX.jsx(SelectEdit, { label: "Mode", value: side.mode, options: modes, onChange: onModeChange }), SP_JSX.jsx(SelectEdit, { label: "Color", value: presetForColor(side.color, presets), options: COLOR_OPTIONS, onChange: (preset) => update({ color: presets[preset] || side.color }) }), isOff ? (SP_JSX.jsx(DFL.Field, { label: "Brightness", children: "Off \u2014 pick another mode to turn LEDs on." })) : (SP_JSX.jsx(SliderEdit$1, { label: "Brightness", value: Math.max(MIN_ACTIVE_BRIGHTNESS, side.brightness), min: MIN_ACTIVE_BRIGHTNESS, max: 100, step: 1, format: (value) => `${Math.round(value)}%`, onChange: (brightness) => {
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
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "LSFG-VK frame generation", children: [SP_JSX.jsx(DFL.Field, { label: "Batocera system layer", description: `${layerStatus || "detected"}; no separate LSFG runtime is downloaded by this plugin.` }), SP_JSX.jsx(DFL.Field, { label: state.dllDetected ? "Lossless.dll detected" : "Lossless.dll missing", description: state.dllPath }), SP_JSX.jsx(ToggleRow, { label: "Enable for all Steam games", description: "Injects the layer into every Steam game after a restart. Off = use the per-game selector.", value: settings.enabled, disabled: !state.ready, onChange: (enabled) => apply({ enabled }) }), !state.dllDetected ? (SP_JSX.jsx(DFL.Field, { label: "Required file", description: "Copy Lossless.dll from a purchased Lossless Scaling installation to the path shown above." })) : null] }), SP_JSX.jsx(DFL.PanelSection, { title: "Per-game activation", children: games.length ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(SelectEdit, { label: "Steam game", value: selectedAppid, options: games.map((game) => ({ data: game.appid, label: game.name })), onChange: (appid) => setSelectedAppid(String(appid)) }), SP_JSX.jsx(ToggleRow, { label: "Enable for selected game", description: settings.enabled
                                ? "Global all-games mode is currently on, so this game already receives LSFG. This switch still controls its persistent per-game launch option."
                                : "Adds a managed wrapper only to this game's Steam launch options. Other games remain untouched, and Steam itself does not need to restart.", value: !!selectedAppid && state.enabledAppids.includes(selectedAppid), disabled: gameBusy || !state.ready || !state.perGameSupported || !selectedAppid, onChange: setGameEnabled })] })) : (SP_JSX.jsx(DFL.Field, { label: "No installed Steam games found", description: "Install or launch a game, then reopen this tab." })) }), SP_JSX.jsxs(DFL.PanelSection, { title: "Frame generation", children: [SP_JSX.jsx(Hint, { label: "Frame multiplier", description: "2x has the lowest GPU cost; 3x/4x need more headroom." }), SP_JSX.jsx(SelectEdit, { label: "Multiplier", value: settings.multiplier, options: MULTIPLIERS, onChange: (multiplier) => apply({ multiplier }) }), SP_JSX.jsx(Hint, { label: "Optical-flow resolution", description: "Lower values cost less at the expense of generated-frame detail." }), SP_JSX.jsx(SelectEdit, { label: "Flow scale", value: settings.flowScale, options: FLOW_SCALES, onChange: (flowScale) => apply({ flowScale }) }), SP_JSX.jsx(ToggleRow, { label: "Performance mode", description: "Lighter LSFG model. Recommended when GPU-bound.", value: settings.performanceMode, onChange: (performanceMode) => apply({ performanceMode }) }), SP_JSX.jsx(ToggleRow, { label: "HDR mode", description: "Only when both game and display use HDR.", value: settings.hdrMode, onChange: (hdrMode) => apply({ hdrMode }) }), SP_JSX.jsx(Hint, { label: "Present mode", description: "Automatic is safest. FIFO is tear-free; Mailbox/Immediate can reduce latency but may tear." }), SP_JSX.jsx(SelectEdit, { label: "Vulkan present mode", value: settings.presentMode, options: PRESENT_MODES, onChange: (presentMode) => apply({ presentMode }) })] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Activation", children: [SP_JSX.jsx(DFL.Field, { label: "Status", description: message || "Per-game applies on next launch; all-games mode needs a Steam restart." }), state.legacyPluginDetected || state.legacyConfigDetected || state.legacyLaunchScriptDetected ? (SP_JSX.jsx(DFL.Field, { label: "Legacy LSFG setup detected", description: "Old wrapper kept for rollback. Remove ~/lsfg from per-game launch options before enabling the global layer." })) : null, SP_JSX.jsx(Hint, { label: "Upstream", description: "System layer: PancakeTAS/lsfg-vk. UI derived from Decky LSFG-VK." })] })] }));
}

let cfg = {
    ENABLED: 0,
    DETECT: 1,
    REFRESHER: 1,
    STATIC_TIMEOUT: 30,
    REFRESHER_DURATION: 3,
    REFRESHER_PASSES: 3,
};
let lastActivity = performance.now();
let cooldownUntil = 0;
let overlayWasActive = false;
let lastPadSig = "";
function updateOledIdleConfig(next) {
    cfg = { ...cfg, ...next };
    bumpActivity();
}
function timeoutSec() {
    return Math.max(5, cfg.STATIC_TIMEOUT || 30);
}
let lastNote = 0;
function bumpActivity(persist = false) {
    lastActivity = performance.now();
    if (!persist)
        return;
    const now = performance.now();
    if (now - lastNote < 400)
        return;
    lastNote = now;
    void noteOledActivity().catch(() => { });
}
function armCooldown() {
    cooldownUntil = performance.now() + timeoutSec() * 1000;
    bumpActivity(true);
}
function canAutoStart() {
    return cfg.ENABLED === 1 && cfg.DETECT !== 0 && cfg.REFRESHER === 1;
}
function eatIfBlocking(event) {
    if (!getOledRefresherActive() && !oledRefresherSwallowingClick())
        return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
}
function maybeStart() {
    if (!canAutoStart())
        return;
    if (getOledRefresherActive() || getOledScreensaverActive())
        return;
    if (performance.now() < cooldownUntil)
        return;
    if ((performance.now() - lastActivity) / 1000 < timeoutSec())
        return;
    armCooldown();
    openOledRefresher({
        durationSec: cfg.REFRESHER_DURATION,
        passes: cfg.REFRESHER_PASSES,
    });
}
function padSignature(win) {
    try {
        const pads = win.navigator.getGamepads?.() || [];
        const parts = [];
        for (const pad of pads) {
            if (!pad)
                continue;
            const buttons = pad.buttons.map((button) => (button.pressed || button.value > 0.2 ? 1 : 0)).join("");
            const axes = pad.axes.map((axis) => Math.round(axis * 8)).join(",");
            parts.push(`${pad.index}:${buttons}:${axes}`);
        }
        return parts.join("|");
    }
    catch {
        return "";
    }
}
function bindSteamInput(win) {
    const input = steamClient(win)?.Input;
    const regs = [];
    const onActivity = () => bumpActivity(true);
    if (input) {
        try {
            const digital = input.RegisterForControllerInputMessages?.(onActivity);
            if (digital)
                regs.push(digital);
        }
        catch {
            /* ignore */
        }
        try {
            const analog = input.RegisterForControllerAnalogInputMessages?.(onActivity);
            if (analog)
                regs.push(analog);
        }
        catch {
            /* ignore */
        }
        try {
            const state = input.RegisterForControllerStateChanges?.((changes) => {
                if (!Array.isArray(changes) || !changes.length)
                    return;
                onActivity();
            });
            if (state)
                regs.push(state);
        }
        catch {
            /* ignore */
        }
    }
    return () => {
        for (const reg of regs) {
            try {
                reg.unregister?.();
            }
            catch {
                /* ignore */
            }
        }
    };
}
function bindWindow(win, onDom, block) {
    const domTypes = ["pointerdown", "touchstart", "keydown", "mousedown"];
    const blockTypes = ["click", "pointerup", "pointerdown", "touchstart", "mousedown"];
    for (const type of domTypes)
        win.addEventListener(type, onDom, true);
    for (const type of blockTypes)
        win.addEventListener(type, block, true);
    const unbindSteam = bindSteamInput(win);
    return () => {
        unbindSteam();
        for (const type of domTypes)
            win.removeEventListener(type, onDom, true);
        for (const type of blockTypes)
            win.removeEventListener(type, block, true);
    };
}
function startOledIdleWatch() {
    bumpActivity();
    armCooldown();
    const onDom = () => bumpActivity(true);
    const unbindPlugin = bindWindow(window, onDom, eatIfBlocking);
    let unbindSteamWin = () => { };
    try {
        const host = steamWindow();
        if (host !== window)
            unbindSteamWin = bindWindow(host, onDom, eatIfBlocking);
    }
    catch {
        unbindSteamWin = () => { };
    }
    const tick = window.setInterval(() => {
        const active = getOledRefresherActive();
        if (active) {
            overlayWasActive = true;
            bumpActivity();
            return;
        }
        if (overlayWasActive) {
            overlayWasActive = false;
            armCooldown();
            return;
        }
        const host = steamWindow();
        const sig = padSignature(host);
        if (sig && sig !== lastPadSig) {
            lastPadSig = sig;
            bumpActivity(true);
        }
        else if (!lastPadSig) {
            lastPadSig = sig;
        }
        void getOledIdle()
            .then((state) => {
            if (state?.enabled != null) {
                cfg = {
                    ...cfg,
                    ENABLED: state.enabled ? 1 : 0,
                    REFRESHER: state.refresher ? 1 : cfg.REFRESHER,
                    STATIC_TIMEOUT: state.timeout || cfg.STATIC_TIMEOUT,
                    REFRESHER_DURATION: state.duration || cfg.REFRESHER_DURATION,
                    REFRESHER_PASSES: state.passes || cfg.REFRESHER_PASSES,
                };
            }
            if (!canAutoStart() || getOledRefresherActive())
                return;
            if (performance.now() < cooldownUntil)
                return;
            const timeout = timeoutSec();
            const localIdle = (performance.now() - lastActivity) / 1000;
            if (localIdle < timeout)
                return;
            if (state?.watching) {
                if (state.idleSeconds < 2) {
                    bumpActivity();
                    return;
                }
                if (state.idleSeconds >= timeout)
                    maybeStart();
                return;
            }
            maybeStart();
        })
            .catch(() => {
            if (performance.now() < cooldownUntil)
                return;
            if ((performance.now() - lastActivity) / 1000 >= timeoutSec())
                maybeStart();
        });
    }, 250);
    return () => {
        window.clearInterval(tick);
        unbindPlugin();
        unbindSteamWin();
    };
}

function formatSeconds(seconds) {
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
    const refresherActive = useOledRefresherActive();
    SP_REACT.useEffect(() => () => {
        if (timer.current !== undefined)
            window.clearTimeout(timer.current);
    }, []);
    const oled = config.oledCare;
    if (!oled?.supported && !oled?.panelDetected) {
        return (SP_JSX.jsx(DFL.PanelSection, { title: "OLED Screen Protection", children: SP_JSX.jsx(DFL.Field, { label: "Panel not detected", description: oled?.reason || "No OLED backlight sysfs node found on this device." }) }));
    }
    const cfg = oled?.config || {
        ENABLED: 0,
        DETECT: 1,
        STATIC_TIMEOUT: 30,
        REFRESHER: 1,
        REFRESHER_DURATION: 3,
        REFRESHER_PASSES: 3,
        SHIFTER: 1,
        SHIFTER_RADIUS: 1,
        SHIFTER_DURATION: 3,
        MURA: 0,
    };
    const runtime = oled?.runtime;
    const apply = (patch, delay = 0) => {
        const next = { ...cfg, ...patch };
        if (patch.ENABLED !== undefined) {
            next.DETECT = patch.ENABLED ? 1 : 0;
        }
        const request = ++revision.current;
        setConfig((current) => current && current.oledCare
            ? { ...current, oledCare: { ...current.oledCare, config: next } }
            : current);
        updateOledIdleConfig(next);
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
    const onRefreshNow = async () => {
        openOledRefresher({
            durationSec: cfg.REFRESHER_DURATION,
            passes: cfg.REFRESHER_PASSES,
        });
    };
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "OLED Screen Protection", children: [SP_JSX.jsx(Hint, { label: "Anti-image-retention", description: oled?.stockCli
                            ? "Synced with EmulationStation via display.oledcare* in batocera.conf."
                            : "Settings sync to batocera.conf; the host watcher ships in the next image." }), SP_JSX.jsx(ToggleRow, { label: "OLED Screen Protection", description: "Runs the pixel refresher after the idle timeout.", value: cfg.ENABLED === 1, onChange: (enabled) => apply({ ENABLED: enabled ? 1 : 0 }) }), runtime && (SP_JSX.jsx(DFL.Field, { label: "Status", children: `Watch ${runtime.serviceRunning ? "on" : "off"} · idle ${runtime.idleSeconds}s · ${runtime.phase || "idle"}` }))] }), cfg.ENABLED === 1 && (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "Pixel refresher", children: [SP_JSX.jsx(ToggleRow, { label: "Pixel refresher", description: "Fullscreen refresher after the idle timeout. Tap to exit.", value: cfg.REFRESHER === 1, onChange: (v) => apply({ REFRESHER: v ? 1 : 0 }) }), SP_JSX.jsx(SliderEdit$1, { label: "Static screen timeout", value: cfg.STATIC_TIMEOUT, min: 5, max: 300, step: 5, format: formatSeconds, onChange: (value) => apply({ STATIC_TIMEOUT: Math.round(Number(value)) }, 200) }), SP_JSX.jsx(SliderEdit$1, { label: "Pass duration", value: cfg.REFRESHER_DURATION, min: 1, max: 10, step: 1, format: (v) => `${Math.round(v)} s`, onChange: (value) => apply({ REFRESHER_DURATION: Math.round(Number(value)) }, 200) }), SP_JSX.jsx(SliderEdit$1, { label: "Passes", value: cfg.REFRESHER_PASSES, min: 1, max: 6, step: 1, format: (v) => `${Math.round(v)}`, onChange: (value) => apply({ REFRESHER_PASSES: Math.round(Number(value)) }, 200) }), SP_JSX.jsx(DFL.DialogButton, { onClick: onRefreshNow, children: refresherActive ? "Refresher running…" : "Run pixel refresher" })] }), oled?.stockCli ? (SP_JSX.jsx(DFL.PanelSection, { title: "Service", children: SP_JSX.jsx(DFL.DialogButton, { onClick: onRestart, children: "Restart OLED Care watch" }) })) : null] })), SP_JSX.jsxs(DFL.PanelSection, { title: "Steam screensaver", children: [SP_JSX.jsx(Hint, { label: "Mostly-black moving mark", description: "Optional long-session helper inside Steam." }), SP_JSX.jsx(ToggleRow, { label: screensaverActive ? "Screensaver active" : "Start screensaver", description: "Any button / touch exits.", value: screensaverActive, onChange: (enabled) => {
                            setOledScreensaverActive(enabled);
                            if (enabled)
                                DFL.Navigation.CloseSideMenus();
                        } })] })] }));
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
    return (SP_JSX.jsxs(DFL.PanelSection, { title: state.kind === "tdp" ? "Adaptive TDP" : "Adaptive CPU", children: [state.kind === "tdp" ? (SP_JSX.jsx(Hint, { label: "Batocera package-power limiter", description: "Adaptive TDP trims package power while FPS has headroom. Your TDP setting stays the ceiling." })) : (SP_JSX.jsx(Hint, { label: "Batocera CPU limiter", description: "Thermal guard reacts to temperature and fan load. Adaptive FPS trims the CPU ceiling with headroom. Never overclocks." })), SP_JSX.jsx(SelectEdit, { label: "Mode", value: state.mode, options: modeOptions, onChange: (mode) => apply({ mode }) }), state.kind === "cpu" ? (SP_JSX.jsx(SelectEdit, { label: "CPU ceiling", value: state.globalCap, options: capOptions, onChange: (globalCap) => apply({ globalCap }) })) : null, SP_JSX.jsx(SelectEdit, { label: "Target frame rate", labelBelow: true, value: state.globalTargetFps, options: targetOptions, disabled: state.mode !== "adaptive", onChange: (globalTargetFps) => apply({ globalTargetFps }) }), SP_JSX.jsx(DFL.Field, { label: "Runtime", description: runtimeLabel(state) }), SP_JSX.jsx(Hint, { label: "FPS source", description: `${state.dataSource}. Steam uses Gamescope stats; ES emulators use Batocera's FPS sampler.` }), message ? SP_JSX.jsx(DFL.Field, { label: "Last change", description: message }) : null] }));
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
    return (SP_JSX.jsxs(DFL.PanelSection, { title: "Fan control", children: [SP_JSX.jsx(Hint, { label: "Batocera qcom-fan", description: "Same picker as Control Center (Home+A). Curve points are edited in the Fans tab." }), SP_JSX.jsx(SelectEdit, { label: "Mode", value: mode, options: modeOptions, disabled: !state.controllable, onChange: (nextMode) => apply({ mode: nextMode, targetPercent: target }) }), mode === "manual" ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(SliderEdit$1, { label: "Manual speed", value: target, min: minimum, max: 100, step: 5, format: (value) => `${Math.round(value)}%`, onChange: (targetPercent) => apply({ mode: "manual", targetPercent: Math.round(targetPercent) }, 200) }), SP_JSX.jsx(Hint, { label: "Manual override active", description: "Temperature curves resume when Silent, Balanced, or Aggressive is selected." })] })) : null, SP_JSX.jsx(DFL.Field, { label: "Current fan", description: telemetry }), !state.controllable ? SP_JSX.jsx(DFL.Field, { label: "Read only", description: state.reason }) : null, message ? SP_JSX.jsx(DFL.Field, { label: "Last change", description: message }) : null] }));
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
    const stockBackend = config.powerBackend === "stock";
    const p = config.power.profiles[profile] || {};
    const profiles = Object.entries(config.power.profiles || {}).map(([name, entry]) => ({
        data: name,
        label: entry.label || titleCase(name),
    }));
    const fanCurves = Object.entries(config.power.fan_curves || {}).map(([name, curve]) => ({
        data: name,
        label: curve.label || titleCase(name),
    }));
    const governorOptions = (config.cpuGovernors || []).map((name) => ({ data: name, label: titleCase(name) }));
    const selectProfile = (name) => {
        const next = String(name);
        setProfile(next);
        setConfig((current) => (current ? update(current, ["power", "general", "default_profile"], next) : current));
    };
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
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [profilesSupported ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "EDIT POWER PROFILE", children: [SP_JSX.jsx(SelectEdit, { value: profile, options: profiles, onChange: selectProfile }), stockBackend ? (SP_JSX.jsx(Hint, { label: "Stock backend", description: "Applies CPU governor + qcom-fan for this profile. CPU%/GPU% limits are not written to hardware here." })) : null] }), SP_JSX.jsxs(DFL.PanelSection, { title: "PROFILE SETTINGS", children: [SP_JSX.jsx(SelectEdit, { label: "Fan mode (Control Center)", labelBelow: true, value: p.fan_curve, options: fanCurves, onChange: (v) => setProfileValue("fan_curve", v) }), SP_JSX.jsx(Hint, { label: "Shared with Home+A", description: "Maps this profile onto Control Center Fan Mode. It does not edit curve points." }), governorOptions.length ? (SP_JSX.jsx(SelectEdit, { label: "CPU Governor", value: p.cpu_governor || config.cpuGovernor || governorOptions[0].data, options: governorOptions, onChange: (v) => setProfileValue("cpu_governor", v) })) : null, !stockBackend && supportsUnderclockPresets ? (SP_JSX.jsx(SelectEdit, { label: "CPU Underclock", value: underclockLevel, options: underclocks, onChange: (v) => setProfileValue("cpu_underclock", v) })) : null, !stockBackend && !supportsUnderclockPresets ? (SP_JSX.jsx(SliderEdit$1, { label: "CPU Max (%)", value: Math.round(Number(p.cpu_max || 0) * 100), min: 35, max: 100, step: 1, onChange: (v) => setProfileValue("cpu_max", (v / 100).toFixed(2)) })) : null, !stockBackend ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(SliderEdit$1, { label: "GPU Min (%)", value: Math.round(Number(p.gpu_min || 0) * 100), min: 0, max: 100, step: 1, onChange: (v) => setGpuValue("gpu_min", (v / 100).toFixed(2)) }), SP_JSX.jsx(SliderEdit$1, { label: "GPU Max (%)", value: Math.round(Number(p.gpu_max || 0) * 100), min: 35, max: 100, step: 1, onChange: (v) => setGpuValue("gpu_max", (v / 100).toFixed(2)) })] })) : null, SP_JSX.jsx("div", { className: "armada-reset-row", children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: resetProfile, children: "Reset to Default" }) })] })] })) : (SP_JSX.jsx(DFL.PanelSection, { title: "Power profiles", children: SP_JSX.jsx(DFL.Field, { label: "Unavailable on this image", description: config.powerReason
                        || "Per-profile CPU/GPU/fan-curve editing needs odin-power or stock qcom-fan. Adaptive CPU and Fan controls below remain available." }) })), !profilesSupported && governorOptions.length ? (SP_JSX.jsxs(DFL.PanelSection, { title: "CPU governor", children: [SP_JSX.jsx(SelectEdit, { label: "Scaling governor", value: config.cpuGovernor || governorOptions[0].data, options: governorOptions, onChange: setCpuGovernor$1 }), SP_JSX.jsx(Hint, { label: "Note", description: "Applies immediately via sysfs. Rear-paddle Cycle power walks the same governors." })] })) : null, SP_JSX.jsx(AdaptiveCpu, { config: config, setConfig: setConfig }), SP_JSX.jsx(FanControl, { config: config, setConfig: setConfig })] }));
}

function PseudoDropdown({ label, value, options, onChange }) {
    return (SP_JSX.jsx(SelectEdit, { label: label, value: value, options: options, onChange: onChange, wrapperClassName: "afc-control-inset" }));
}
function ToggleEdit({ label, description, checked, onChange }) {
    return (SP_JSX.jsx(ToggleRow, { label: label, value: checked, description: description, onChange: onChange, wrapperClassName: "afc-control-inset" }));
}
function NumberEdit({ label, value, rangeMin, rangeMax, onCommit }) {
    const [draft, setDraft] = SP_REACT.useState(null);
    const shown = draft ?? String(value);
    const commit = () => {
        if (draft === null)
            return;
        const parsed = parseInt(draft, 10);
        // Keeps an empty draft (e.g. mid on-screen-keyboard blur) instead of restoring the old value.
        if (!Number.isFinite(parsed))
            return;
        onCommit(clamp(parsed, rangeMin, rangeMax));
        setDraft(null);
    };
    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { className: "afc-control-inset", children: SP_JSX.jsx(DFL.Field, { label: label, childrenLayout: "below", childrenContainerWidth: "max", children: SP_JSX.jsx(DFL.TextField, { value: shown, onFocus: () => setDraft((current) => current ?? String(value)), onChange: (e) => setDraft(e.target.value), onBlur: commit }) }) }) }));
}
function SliderEdit({ label, value, min, max, step, onChange, disabled }) {
    return (SP_JSX.jsx(SliderEdit$1, { label: label, value: value, min: min, max: max, step: step, onChange: onChange, disabled: disabled, wrapperClassName: "afc-slider-field" }));
}

const CURVE_TEMP_MIN = 0;
const CURVE_TEMP_MAX = 120;
const CURVE_PWM_MIN = 0;
const CURVE_PWM_MAX = 255;
const DEFAULT_POINT = { temp: 60, pwm: 128 };
function pwmToPercent(pwm) {
    return Math.round((Math.min(CURVE_PWM_MAX, Math.max(CURVE_PWM_MIN, pwm)) / CURVE_PWM_MAX) * 100);
}
function percentToPwm(percent) {
    return Math.round((Math.min(100, Math.max(0, percent)) / 100) * CURVE_PWM_MAX);
}
function parseCurve(text) {
    if (!text)
        return [];
    return text
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
        const [tempPart, pwmPart] = item.split(":");
        return { temp: parseInt(tempPart, 10), pwm: parseInt(pwmPart, 10) };
    })
        .filter((point) => Number.isFinite(point.temp) && Number.isFinite(point.pwm))
        .sort((a, b) => a.temp - b.temp);
}
function formatCurve(points) {
    return [...points]
        .sort((a, b) => a.temp - b.temp)
        .map((point) => `${Math.round(point.temp)}:${Math.round(point.pwm)}`)
        .join(",");
}
function slugifyCurveName(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 32);
}

function CreateCurveModal({ initial, setDraft, initialBaseCurve, onCreated, closeModal, }) {
    const names = Object.keys(initial.fanCurves || {}).sort();
    const defaultBase = names.includes(initialBaseCurve) ? initialBaseCurve : names[0] || "";
    const [newName, setNewName] = SP_REACT.useState("");
    const [baseCurve, setBaseCurve] = SP_REACT.useState(defaultBase);
    const name = slugifyCurveName(newName);
    const duplicateName = !!name && !!initial.fanCurves[name];
    const canCreate = !!name && !!baseCurve && !duplicateName;
    const createCurve = () => {
        if (!canCreate)
            return;
        const source = initial.fanCurves[baseCurve];
        if (!source)
            return;
        setDraft((current) => {
            if (!current || current.fanCurves[name])
                return current;
            const next = clone(current);
            next.fanCurves[name] = {
                label: titleCase(name.replace(/_/g, " ")),
                curve: source.curve,
            };
            return next;
        });
        onCreated(name);
        closeModal?.();
    };
    return (SP_JSX.jsxs(DFL.ModalRoot, { onCancel: () => closeModal?.(), children: [SP_JSX.jsx("style", { children: styles }), SP_JSX.jsxs(DFL.DialogBody, { className: "afc-scope", children: [SP_JSX.jsx("h2", { className: "afc-modal-title", children: "Create Curve" }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { className: "afc-control-inset", children: SP_JSX.jsx(DFL.Field, { label: "Curve Name", description: "Letters, numbers, spaces, hyphens, and underscores are supported.", childrenLayout: "below", childrenContainerWidth: "max", children: SP_JSX.jsx(DFL.TextField, { value: newName, onChange: (event) => setNewName(event.target.value) }) }) }) }), duplicateName ? (SP_JSX.jsxs("div", { className: "afc-modal-error", children: ["A curve named \u201C", name, "\u201D already exists."] })) : null, SP_JSX.jsx(PseudoDropdown, { label: "Base Curve", value: baseCurve, options: names.map((curveName) => ({
                            data: curveName,
                            label: initial.fanCurves[curveName]?.label || titleCase(curveName),
                        })), onChange: setBaseCurve }), SP_JSX.jsx("div", { className: "afc-note", children: "The new curve starts as a copy of the selected base curve. Changes remain unsaved until Save Changes is pressed." })] }), SP_JSX.jsxs(DFL.DialogFooter, { children: [SP_JSX.jsx(DFL.DialogButton, { onClick: () => closeModal?.(), children: "Cancel" }), SP_JSX.jsx(DFL.DialogButton, { onClick: createCurve, disabled: !canCreate, children: "Create Curve" })] })] }));
}

const COLLAPSE_TRANSITION_MS = 200;
function AnimatedCollapse({ isOpen, children }) {
    const [phase, setPhase] = SP_REACT.useState(isOpen ? "open" : "closed");
    const [height, setHeight] = SP_REACT.useState(isOpen ? "auto" : 0);
    const innerRef = SP_REACT.useRef(null);
    const firstRender = SP_REACT.useRef(true);
    SP_REACT.useEffect(() => {
        if (firstRender.current) {
            firstRender.current = false;
            return;
        }
        setPhase(isOpen ? "opening" : "closing");
    }, [isOpen]);
    SP_REACT.useEffect(() => {
        if (phase === "opening") {
            const raf = requestAnimationFrame(() => setHeight(innerRef.current?.scrollHeight ?? 0));
            const timeout = window.setTimeout(() => {
                setPhase("open");
                setHeight("auto");
            }, COLLAPSE_TRANSITION_MS);
            return () => {
                cancelAnimationFrame(raf);
                window.clearTimeout(timeout);
            };
        }
        if (phase === "closing") {
            setHeight(innerRef.current?.scrollHeight ?? 0);
            const raf = requestAnimationFrame(() => setHeight(0));
            const timeout = window.setTimeout(() => setPhase("closed"), COLLAPSE_TRANSITION_MS);
            return () => {
                cancelAnimationFrame(raf);
                window.clearTimeout(timeout);
            };
        }
        return undefined;
    }, [phase]);
    if (phase === "closed")
        return null;
    return (SP_JSX.jsx("div", { className: "afc-collapse", style: { maxHeight: height === "auto" ? "none" : height }, children: SP_JSX.jsx("div", { ref: innerRef, children: children }) }));
}

const WIDTH = 280;
const HEIGHT = 170;
const PAD_LEFT = 26;
const PAD_RIGHT = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 18;
const PLOT_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_H = HEIGHT - PAD_TOP - PAD_BOTTOM;
const TEMP_TICKS = [0, 20, 40, 60, 80, 100, 120];
const PWM_TICK_PERCENTS = [0, 25, 50, 75, 100];
const CONTROLLER_TEMP_STEP = 1;
const CONTROLLER_PWM_STEP = 5;
function xForTemp(temp) {
    return PAD_LEFT + (clamp(temp, CURVE_TEMP_MIN, CURVE_TEMP_MAX) - CURVE_TEMP_MIN) / (CURVE_TEMP_MAX - CURVE_TEMP_MIN) * PLOT_W;
}
function yForPwm(pwm) {
    return PAD_TOP + (1 - (clamp(pwm, CURVE_PWM_MIN, CURVE_PWM_MAX) - CURVE_PWM_MIN) / (CURVE_PWM_MAX - CURVE_PWM_MIN)) * PLOT_H;
}
function FanCurveGraph({ points, onChange, currentTemp }) {
    const svgRef = SP_REACT.useRef(null);
    const dragRef = SP_REACT.useRef(null);
    const [livePoints, setLivePoints] = SP_REACT.useState(null);
    const [activeIndex, setActiveIndex] = SP_REACT.useState(null);
    const [controllerActive, setControllerActive] = SP_REACT.useState(false);
    const [controllerIndex, setControllerIndex] = SP_REACT.useState(0);
    const shown = livePoints ?? points;
    const sorted = SP_REACT.useMemo(() => [...shown].sort((a, b) => a.temp - b.temp), [shown]);
    if (!sorted.length)
        return null;
    const eventToPoint = (e) => {
        const svg = svgRef.current;
        if (!svg)
            return null;
        const rect = svg.getBoundingClientRect();
        const fracX = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        const fracY = clamp((e.clientY - rect.top) / rect.height, 0, 1);
        const vbX = fracX * WIDTH;
        const vbY = fracY * HEIGHT;
        const temp = Math.round(CURVE_TEMP_MIN + clamp((vbX - PAD_LEFT) / PLOT_W, 0, 1) * (CURVE_TEMP_MAX - CURVE_TEMP_MIN));
        const pwm = Math.round(CURVE_PWM_MAX - clamp((vbY - PAD_TOP) / PLOT_H, 0, 1) * (CURVE_PWM_MAX - CURVE_PWM_MIN));
        return { temp: clamp(temp, CURVE_TEMP_MIN, CURVE_TEMP_MAX), pwm: clamp(pwm, CURVE_PWM_MIN, CURVE_PWM_MAX) };
    };
    const onPointerDown = (index) => (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { points: points.map((p) => ({ ...p })), index };
        setActiveIndex(index);
        setLivePoints(points.map((p) => ({ ...p })));
    };
    const onPointerMove = (e) => {
        const drag = dragRef.current;
        if (!drag)
            return;
        const next = eventToPoint(e);
        if (!next)
            return;
        drag.points[drag.index] = next;
        setLivePoints([...drag.points]);
    };
    const endDrag = (e) => {
        const drag = dragRef.current;
        if (!drag)
            return;
        dragRef.current = null;
        setActiveIndex(null);
        setLivePoints(null);
        onChange(drag.points);
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        catch {
            // already released (e.g. pointercancel) -- fine to ignore
        }
    };
    const enterControllerMode = () => {
        if (!points.length)
            return;
        setControllerActive(true);
        setControllerIndex((current) => clamp(current, 0, points.length - 1));
    };
    const exitControllerMode = () => setControllerActive(false);
    const cycleControllerPoint = (delta) => {
        if (!points.length)
            return;
        setControllerIndex((current) => (current + delta + points.length) % points.length);
    };
    const moveControllerPoint = (deltaTemp, deltaPwm) => {
        if (!points.length)
            return;
        const index = clamp(controllerIndex, 0, points.length - 1);
        const current = points[index];
        const lowerBound = index > 0 ? points[index - 1].temp + 1 : CURVE_TEMP_MIN;
        const upperBound = index < points.length - 1 ? points[index + 1].temp - 1 : CURVE_TEMP_MAX;
        const nextTemp = clamp(current.temp + deltaTemp, Math.max(CURVE_TEMP_MIN, lowerBound), Math.min(CURVE_TEMP_MAX, upperBound));
        const nextPwm = clamp(current.pwm + deltaPwm, CURVE_PWM_MIN, CURVE_PWM_MAX);
        if (nextTemp === current.temp && nextPwm === current.pwm)
            return;
        onChange(points.map((point, i) => (i === index ? { temp: nextTemp, pwm: nextPwm } : point)));
    };
    const handleGraphButtonDown = (e) => {
        switch (e.detail.button) {
            case DFL.GamepadButton.BUMPER_LEFT:
                cycleControllerPoint(-1);
                break;
            case DFL.GamepadButton.BUMPER_RIGHT:
                cycleControllerPoint(1);
                break;
            default:
                return;
        }
        e.preventDefault();
        e.stopPropagation();
    };
    const handleGraphDirection = (e) => {
        switch (e.detail.button) {
            case DFL.GamepadButton.DIR_UP:
                moveControllerPoint(0, CONTROLLER_PWM_STEP);
                break;
            case DFL.GamepadButton.DIR_DOWN:
                moveControllerPoint(0, -CONTROLLER_PWM_STEP);
                break;
            case DFL.GamepadButton.DIR_RIGHT:
                moveControllerPoint(CONTROLLER_TEMP_STEP, 0);
                break;
            case DFL.GamepadButton.DIR_LEFT:
                moveControllerPoint(-CONTROLLER_TEMP_STEP, 0);
                break;
            default:
                return;
        }
        e.preventDefault();
        e.stopPropagation();
    };
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const pathD = [
        `M ${PAD_LEFT} ${yForPwm(first.pwm)}`,
        `L ${xForTemp(first.temp)} ${yForPwm(first.pwm)}`,
        ...sorted.slice(1).map((p) => `L ${xForTemp(p.temp)} ${yForPwm(p.pwm)}`),
        `L ${PAD_LEFT + PLOT_W} ${yForPwm(last.pwm)}`,
    ].join(" ");
    const fanStopActive = first.pwm === 0;
    let fanStopBoundaryTemp = first.temp;
    for (const point of sorted) {
        if (point.pwm !== 0)
            break;
        fanStopBoundaryTemp = point.temp;
    }
    const fanStopX = xForTemp(fanStopBoundaryTemp);
    const hasCurrentTemp = typeof currentTemp === "number" && Number.isFinite(currentTemp);
    const currentTempX = hasCurrentTemp ? xForTemp(currentTemp) : 0;
    const interpolatePwm = (temp) => {
        if (temp <= first.temp)
            return first.pwm;
        if (temp >= last.temp)
            return last.pwm;
        for (let i = 0; i < sorted.length - 1; i += 1) {
            const a = sorted[i];
            const b = sorted[i + 1];
            if (temp >= a.temp && temp <= b.temp) {
                const t = b.temp === a.temp ? 0 : (temp - a.temp) / (b.temp - a.temp);
                return a.pwm + t * (b.pwm - a.pwm);
            }
        }
        return last.pwm;
    };
    const currentTempY = hasCurrentTemp ? yForPwm(interpolatePwm(currentTemp)) : 0;
    return (SP_JSX.jsxs(DFL.Focusable, { className: controllerActive ? "afc-graph-focusable afc-graph-editing" : "afc-graph-focusable", focusClassName: "afc-graph-focused", onActivate: enterControllerMode, onOKButton: enterControllerMode, onCancelButton: controllerActive ? exitControllerMode : undefined, onButtonDown: controllerActive ? handleGraphButtonDown : undefined, onGamepadDirection: controllerActive ? handleGraphDirection : undefined, onGamepadBlur: controllerActive ? exitControllerMode : undefined, onOKActionDescription: controllerActive ? undefined : "Edit Point", onCancelActionDescription: controllerActive ? "Stop Editing" : undefined, children: [SP_JSX.jsxs("svg", { ref: svgRef, viewBox: `0 0 ${WIDTH} ${HEIGHT}`, style: { width: "100%", height: "auto", display: "block", touchAction: "none", userSelect: "none" }, children: [SP_JSX.jsx("rect", { x: PAD_LEFT, y: PAD_TOP, width: PLOT_W, height: PLOT_H, fill: "rgba(255,255,255,0.04)", stroke: "rgba(255,255,255,0.15)" }), fanStopActive ? (SP_JSX.jsxs("g", { pointerEvents: "none", children: [SP_JSX.jsx("rect", { x: PAD_LEFT, y: PAD_TOP, width: Math.max(0, fanStopX - PAD_LEFT), height: PLOT_H, fill: "rgba(255,209,102,0.14)" }), SP_JSX.jsx("line", { x1: fanStopX, x2: fanStopX, y1: PAD_TOP, y2: PAD_TOP + PLOT_H, stroke: "rgba(255,209,102,0.55)", strokeDasharray: "2,2" }), SP_JSX.jsx("text", { x: PAD_LEFT + 2, y: PAD_TOP + 9, fontSize: "7", textAnchor: "start", fill: "rgba(255,209,102,0.85)", children: "FAN STOPPED" })] })) : null, PWM_TICK_PERCENTS.map((percent) => {
                        const pwm = percentToPwm(percent);
                        return (SP_JSX.jsxs("g", { children: [SP_JSX.jsx("line", { x1: PAD_LEFT, x2: PAD_LEFT + PLOT_W, y1: yForPwm(pwm), y2: yForPwm(pwm), stroke: "rgba(255,255,255,0.08)" }), SP_JSX.jsx("text", { x: PAD_LEFT - 4, y: yForPwm(pwm) + 3, fontSize: "7", textAnchor: "end", fill: "rgba(255,255,255,0.55)", children: `${percent}%` })] }, `pwm-${percent}`));
                    }), TEMP_TICKS.map((temp) => (SP_JSX.jsxs("g", { children: [SP_JSX.jsx("line", { x1: xForTemp(temp), x2: xForTemp(temp), y1: PAD_TOP, y2: PAD_TOP + PLOT_H, stroke: "rgba(255,255,255,0.06)" }), SP_JSX.jsx("text", { x: xForTemp(temp), y: HEIGHT - 4, fontSize: "7", textAnchor: "middle", fill: "rgba(255,255,255,0.55)", children: temp })] }, `temp-${temp}`))), SP_JSX.jsx("path", { d: pathD, fill: "none", stroke: "#5cc8ff", strokeWidth: 2 }), hasCurrentTemp ? (SP_JSX.jsxs("g", { pointerEvents: "none", children: [SP_JSX.jsx("circle", { cx: currentTempX, cy: currentTempY, r: 7, fill: "rgba(255,255,255,0.18)" }), SP_JSX.jsx("circle", { cx: currentTempX, cy: currentTempY, r: 3.5, fill: "#ffffff", stroke: "#0D141C", strokeWidth: 1.5 }), SP_JSX.jsx("text", { x: clamp(currentTempX, PAD_LEFT + 14, PAD_LEFT + PLOT_W - 14), y: currentTempY - 10 < PAD_TOP ? currentTempY + 15 : currentTempY - 10, fontSize: "7", textAnchor: "middle", fill: "#ffffff", children: `${currentTemp}°C` })] })) : null, sorted.map((point) => {
                        const index = shown.indexOf(point);
                        const isActive = activeIndex !== null
                            ? shown[activeIndex] === point
                            : controllerActive && clamp(controllerIndex, 0, points.length - 1) === index;
                        return (SP_JSX.jsxs("g", { children: [SP_JSX.jsx("circle", { cx: xForTemp(point.temp), cy: yForPwm(point.pwm), r: 14, fill: "transparent", onPointerDown: onPointerDown(index), onPointerMove: onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, style: { cursor: "grab", touchAction: "none" } }), SP_JSX.jsx("circle", { cx: xForTemp(point.temp), cy: yForPwm(point.pwm), r: isActive ? 6 : 4.5, fill: isActive ? "#ffd166" : "#5cc8ff", stroke: "#0D141C", strokeWidth: 1.5, pointerEvents: "none" }), isActive ? (SP_JSX.jsx("text", { x: xForTemp(point.temp), y: yForPwm(point.pwm) - 12 < PAD_TOP ? yForPwm(point.pwm) + 14 : yForPwm(point.pwm) - 12, fontSize: "8", textAnchor: "middle", fill: "#ffd166", children: `${point.temp}°C / ${pwmToPercent(point.pwm)}%` })) : null] }, `point-${index}`));
                    })] }), controllerActive ? (SP_JSX.jsx("div", { className: "afc-controller-hint", children: `D-Pad moves point ${clamp(controllerIndex, 0, points.length - 1) + 1} of ${points.length} · LB/RB switches points · B stops` })) : null] }));
}

function useSelectedFanCurve(state, setState, selected) {
    const names = Object.keys(state.fanCurves || {}).sort();
    const curveName = names.includes(selected) ? selected : names[0] || "";
    const curve = curveName ? state.fanCurves[curveName] : undefined;
    const points = curve ? parseCurve(curve.curve) : [];
    const factoryCurve = curveName ? state.factoryFanCurves?.[curveName] : undefined;
    const commitPoints = (nextPoints) => {
        if (!curveName)
            return;
        setState((current) => current ? update(current, ["fanCurves", curveName, "curve"], formatCurve(nextPoints)) : current);
    };
    const resetCurve = () => {
        if (!curveName || !factoryCurve)
            return;
        setState((current) => (current ? update(current, ["fanCurves", curveName], clone(factoryCurve)) : current));
    };
    const setPoint = (index, key, value) => {
        commitPoints(points.map((point, i) => (i === index ? { ...point, [key]: value } : point)));
    };
    const removePoint = (index) => {
        commitPoints(points.filter((_, i) => i !== index));
    };
    const addPoint = () => {
        const usedTemps = new Set(points.map((point) => point.temp));
        let temp = DEFAULT_POINT.temp;
        while (usedTemps.has(temp) && temp < CURVE_TEMP_MAX)
            temp += 1;
        if (usedTemps.has(temp))
            return;
        commitPoints([...points, { ...DEFAULT_POINT, temp }]);
    };
    const belowMinPoint = points.some((point) => point.pwm < state.fanSettings.min_pwm);
    const fixMinPwm = () => {
        if (!points.length)
            return;
        const lowestPwm = clamp(Math.min(...points.map((point) => point.pwm)), CURVE_PWM_MIN, CURVE_PWM_MAX);
        setState((current) => (current ? update(current, ["fanSettings", "min_pwm"], lowestPwm) : current));
    };
    return {
        names,
        curveName,
        curve,
        points,
        factoryCurve,
        commitPoints,
        resetCurve,
        setPoint,
        removePoint,
        addPoint,
        belowMinPoint,
        fixMinPwm,
    };
}

const DEFAULT_FAN_STOP_TEMP = 60;
const MIN_FAN_SPEED = 0;
const MAX_FAN_SPEED = 100;
const FAN_STOP_SPAN = 20;
function FanCurveEditor({ state, setState, selected, onSelectedChange, onOpenFullscreen, onOpenCreateCurve: _onOpenCreateCurve, currentTemp, }) {
    const selectedCurve = useSelectedFanCurve(state, setState, selected);
    const { names, curveName, curve, points, commitPoints } = selectedCurve;
    const [showPointEditor, setShowPointEditor] = SP_REACT.useState(false);
    const [deleteTarget, setDeleteTarget] = SP_REACT.useState("");
    const [confirmDelete, setConfirmDelete] = SP_REACT.useState(false);
    const preFanStopPoints = SP_REACT.useRef(null);
    const usedBy = Object.values(state.profiles || {}).filter((p) => p.fan_curve === curveName);
    const deletableNames = names.filter((name) => {
        if (state.factoryFanCurves?.[name])
            return false;
        return !Object.values(state.profiles || {}).some((p) => p.fan_curve === name);
    });
    const deleteTargetName = deletableNames.includes(deleteTarget) ? deleteTarget : deletableNames[0] || "";
    let zeroRunEnd = 0;
    while (zeroRunEnd < points.length && points[zeroRunEnd].pwm === 0)
        zeroRunEnd += 1;
    const fanStopEnabled = zeroRunEnd > 0;
    const fanStopTemp = fanStopEnabled ? points[zeroRunEnd - 1].temp : DEFAULT_FAN_STOP_TEMP;
    const restoreFanStopPoints = (allPoints, runEnd) => {
        if (runEnd <= 0)
            return allPoints;
        const zeroRun = allPoints.slice(0, runEnd);
        const rest = allPoints.slice(runEnd);
        const restorePwm = rest.length ? rest[0].pwm : DEFAULT_POINT.pwm;
        const restored = zeroRun.map((point) => ({ ...point, pwm: restorePwm || DEFAULT_POINT.pwm }));
        if (rest.length)
            return [...restored, ...rest];
        const lastTemp = restored[restored.length - 1].temp;
        return [
            ...restored,
            { temp: clamp(lastTemp + FAN_STOP_SPAN, lastTemp + 1, CURVE_TEMP_MAX), pwm: DEFAULT_POINT.pwm },
        ];
    };
    const buildFanStopPoints = (temp, allPoints) => {
        const zeroed = allPoints.filter((point) => point.temp <= temp).map((point) => ({ ...point, pwm: 0 }));
        const above = allPoints.filter((point) => point.temp > temp);
        const hasBoundaryPoint = zeroed.some((point) => point.temp === temp);
        const zone = hasBoundaryPoint ? zeroed : [...zeroed, { temp, pwm: 0 }];
        if (above.length)
            return [...zone, ...above];
        const fallbackPwm = allPoints.length ? allPoints[allPoints.length - 1].pwm : DEFAULT_POINT.pwm;
        return [
            ...zone,
            { temp: clamp(temp + FAN_STOP_SPAN, temp + 1, CURVE_TEMP_MAX), pwm: fallbackPwm || DEFAULT_POINT.pwm },
        ];
    };
    const toggleFanStop = (checked) => {
        if (!curveName)
            return;
        let nextPoints;
        if (checked) {
            preFanStopPoints.current = { name: curveName, points };
            nextPoints = buildFanStopPoints(clamp(DEFAULT_FAN_STOP_TEMP, CURVE_TEMP_MIN, CURVE_TEMP_MAX), points);
        }
        else {
            const cached = preFanStopPoints.current;
            nextPoints = cached && cached.name === curveName ? cached.points : restoreFanStopPoints(points, zeroRunEnd);
            preFanStopPoints.current = null;
        }
        setState((current) => {
            if (!current)
                return current;
            return update(current, ["fanCurves", curveName, "curve"], formatCurve(nextPoints));
        });
    };
    const setFanStopTemp = (value) => {
        const cached = preFanStopPoints.current;
        const base = cached && cached.name === curveName ? cached.points : restoreFanStopPoints(points, zeroRunEnd);
        commitPoints(buildFanStopPoints(value, base));
    };
    const handleDeleteClick = () => {
        if (confirmDelete) {
            if (!deleteTargetName)
                return;
            setState((current) => {
                if (!current)
                    return current;
                const next = clone(current);
                delete next.fanCurves[deleteTargetName];
                return next;
            });
            if (deleteTargetName === curveName) {
                onSelectedChange("");
            }
            setDeleteTarget("");
            setConfirmDelete(false);
        }
        else {
            setConfirmDelete(true);
        }
    };
    const setFanSetting = (key, value) => {
        setState((current) => (current ? update(current, ["fanSettings", key], value) : current));
    };
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "EDIT CURVE", children: [names.length ? (SP_JSX.jsx(PseudoDropdown, { label: "Curve", value: curveName, options: names.map((name) => ({ data: name, label: state.fanCurves[name]?.label || titleCase(name) })), onChange: onSelectedChange })) : (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "No fan curves found" }) })), curveName ? (SP_JSX.jsx("div", { className: "afc-field-note afc-used-by-note", children: usedBy.length
                            ? `Used by Control Center Fan Mode: ${usedBy.map((p) => p.label).join(", ")}`
                            : "Not selectable in Control Center — only Silent / Auto / Aggressive appear under Home+A" })) : null] }), curve ? (SP_JSX.jsx(PointsPanel, { selectedCurve: selectedCurve, showPointEditor: showPointEditor, onToggleShowPointEditor: () => setShowPointEditor((v) => !v), onOpenFullscreen: onOpenFullscreen, currentTemp: currentTemp, fanStopEnabled: fanStopEnabled, fanStopTemp: fanStopTemp, onToggleFanStop: toggleFanStop, onFanStopTempChange: setFanStopTemp }, curveName)) : null, SP_JSX.jsxs(DFL.PanelSection, { title: "FAN RESPONSIVENESS", children: [SP_JSX.jsx("div", { className: "afc-note", children: "Ramp and temperature smoothing stay inside qcom-fan (fast rise / slow fall), shared with Control Center. They are not duplicated here. Saving here never changes Control Center's current Fan Mode." }), SP_JSX.jsx(SliderEdit, { label: "Minimum Fan Speed (%)", value: pwmToPercent(state.fanSettings.min_pwm), min: MIN_FAN_SPEED, max: MAX_FAN_SPEED, step: 1, onChange: (v) => setFanSetting("min_pwm", percentToPwm(v)) }), SP_JSX.jsx("div", { className: "afc-field-note", children: "Hard floor in qcom-fan: the fan never drops below this, including over Fan Stop / 0% curve points. Save to apply." })] }), SP_JSX.jsxs(DFL.PanelSection, { title: "MANAGE CURVES", children: [SP_JSX.jsx("div", { className: "afc-note", children: "Extra named curves are disabled: Control Center (Home+A) can only pick Silent / Auto / Aggressive. Edit those three, or reset one to factory." }), deletableNames.length ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(PseudoDropdown, { label: "Curve To Delete", value: deleteTargetName, options: deletableNames.map((name) => ({
                                    data: name,
                                    label: state.fanCurves[name]?.label || titleCase(name),
                                })), onChange: (v) => {
                                    setDeleteTarget(v);
                                    setConfirmDelete(false);
                                } }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { className: "afc-control-inset", children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: handleDeleteClick, disabled: !deleteTargetName, children: confirmDelete ? "Tap Again To Confirm Delete" : "Delete Curve" }) }) })] })) : (SP_JSX.jsx("div", { className: "afc-note", children: "No extra presets to delete. Silent / Auto / Aggressive cannot be removed \u2014 Control Center Fan Mode needs them." }))] })] }));
}
function FanCurveGraphEditor({ state, setState, selected, onSelectedChange, currentTemp }) {
    const { names, curveName, curve, points, factoryCurve, commitPoints, resetCurve, belowMinPoint, fixMinPwm } = useSelectedFanCurve(state, setState, selected);
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSection, { title: "EDIT CURVE", children: names.length ? (SP_JSX.jsx(PseudoDropdown, { label: "Curve", value: curveName, options: names.map((name) => ({ data: name, label: state.fanCurves[name]?.label || titleCase(name) })), onChange: onSelectedChange })) : (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "No fan curves found" }) })) }), curve ? (SP_JSX.jsxs(DFL.PanelSection, { title: "POINTS", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(FanCurveGraph, { points: points, onChange: commitPoints, currentTemp: currentTemp }) }), SP_JSX.jsx(MinPwmWarningButton, { onFix: fixMinPwm, visible: belowMinPoint }), SP_JSX.jsx("div", { className: "afc-note", children: "Drag a point, or press A to steer it with the D-Pad. LB/RB switches points; B exits." }), factoryCurve ? (SP_JSX.jsx("div", { className: "afc-reset-row", children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: resetCurve, children: "Reset Curve To Factory" }) })) : null, SP_JSX.jsx("div", { className: "afc-note", children: "Nothing here is written to disk until you press Save Changes." })] })) : null] }));
}
// Wrapper row stays mounted (avoids a scroll jump); only the button itself is conditionally
// rendered, since `disabled` alone left it selectable via gamepad nav.
function MinPwmWarningButton({ onFix, visible }) {
    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { className: `afc-control-inset afc-min-warning-button${visible ? "" : " afc-min-warning-hidden"}`, children: visible ? (SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: onFix, description: "Also adjustable via the Minimum Fan Speed slider in Fan Responsiveness.", children: "⚠ Below the Minimum Fan Speed floor -- tap to lower it to match" })) : null }) }));
}
function PointsPanel({ selectedCurve, showPointEditor, onToggleShowPointEditor, onOpenFullscreen, currentTemp, fanStopEnabled, fanStopTemp, onToggleFanStop, onFanStopTempChange, }) {
    const { curveName, points, factoryCurve, commitPoints, resetCurve, setPoint, removePoint, addPoint, belowMinPoint, fixMinPwm, } = selectedCurve;
    const [expanded, setExpanded] = SP_REACT.useState(new Set());
    const toggleExpanded = (index) => {
        setExpanded((current) => {
            const next = new Set(current);
            if (next.has(index))
                next.delete(index);
            else
                next.add(index);
            return next;
        });
    };
    // Removing a point shifts later indices down by one, so expanded rows are remapped here.
    const handleRemovePoint = (index) => {
        setExpanded((current) => {
            const next = new Set();
            current.forEach((i) => {
                if (i === index)
                    return;
                next.add(i > index ? i - 1 : i);
            });
            return next;
        });
        removePoint(index);
    };
    return (SP_JSX.jsxs(DFL.PanelSection, { title: "POINTS", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(FanCurveGraph, { points: points, onChange: commitPoints, currentTemp: currentTemp }) }), SP_JSX.jsx(MinPwmWarningButton, { onFix: fixMinPwm, visible: belowMinPoint }), SP_JSX.jsxs("div", { className: "afc-note", children: ["Drag a point, or press A to steer it with the D-Pad. LB/RB switches points; B exits. Advanced editing uses raw ", CURVE_PWM_MIN, "-", CURVE_PWM_MAX, " PWM."] }), SP_JSX.jsx(ToggleEdit, { label: "Fan Stop", description: "Fan off below the set temperature.", checked: fanStopEnabled, onChange: onToggleFanStop }), fanStopEnabled ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(NumberEdit, { label: "Stop Until (\u00B0C)", value: fanStopTemp, rangeMin: CURVE_TEMP_MIN, rangeMax: CURVE_TEMP_MAX, onCommit: onFanStopTempChange }), SP_JSX.jsx("div", { className: "afc-note", children: "The 0% minimum applies globally while Fan Stop is enabled." })] })) : null, onOpenFullscreen ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { className: "afc-control-inset", children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: onOpenFullscreen, children: "Fullscreen Editor" }) }) })) : null, SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { className: "afc-control-inset", children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: onToggleShowPointEditor, children: showPointEditor ? "Hide Points" : "Edit Curve Points" }) }) }), SP_JSX.jsx(AnimatedCollapse, { isOpen: showPointEditor, children: SP_JSX.jsxs("div", { className: "afc-points-drawer", children: [points.map((point, index) => (SP_JSX.jsx(PointRow, { index: index, point: point, isExpanded: expanded.has(index), onToggle: () => toggleExpanded(index), onCommitTemp: (v) => setPoint(index, "temp", v), onCommitPwm: (v) => setPoint(index, "pwm", v), onRemove: () => handleRemovePoint(index), canRemove: points.length > 1 }, `${curveName}-${index}`))), SP_JSX.jsx("div", { className: "afc-reset-row", children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: addPoint, children: "Add Point" }) })] }) }), factoryCurve ? (SP_JSX.jsx("div", { className: "afc-reset-row", children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: resetCurve, children: "Reset Curve To Factory" }) })) : null, SP_JSX.jsx("div", { className: "afc-note", children: "Nothing here is written to disk until you press Save Changes." })] }));
}
function PointRow({ index, point, isExpanded, onToggle, onCommitTemp, onCommitPwm, onRemove, canRemove, }) {
    const percent = pwmToPercent(point.pwm);
    return (SP_JSX.jsxs("div", { className: "afc-point-row", children: [SP_JSX.jsxs("div", { className: "afc-point-row-header", children: [SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: onToggle, children: `${isExpanded ? "▾" : "▸"}  P${index + 1}: ${point.temp}°C / ${percent}%` }), SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: onRemove, disabled: !canRemove, children: "\u00D7" })] }), SP_JSX.jsx(AnimatedCollapse, { isOpen: isExpanded, children: SP_JSX.jsxs("div", { className: "afc-point-details-inner", children: [SP_JSX.jsx(NumberEdit, { label: "Temperature (\u00B0C)", value: point.temp, rangeMin: CURVE_TEMP_MIN, rangeMax: CURVE_TEMP_MAX, onCommit: onCommitTemp }), SP_JSX.jsx(NumberEdit, { label: `PWM (${CURVE_PWM_MIN}-${CURVE_PWM_MAX})`, value: point.pwm, rangeMin: CURVE_PWM_MIN, rangeMax: CURVE_PWM_MAX, onCommit: onCommitPwm })] }) })] }));
}

const POLL_INTERVAL_MS = 3000;
function useCurrentTemp() {
    const [temp, setTemp] = SP_REACT.useState(null);
    SP_REACT.useEffect(() => {
        let cancelled = false;
        const poll = async () => {
            try {
                const next = await getCurrentTemp();
                if (!cancelled)
                    setTemp(next);
            }
            catch {
                // Transient read failure -- skip this tick rather than surfacing an error.
            }
        };
        poll();
        const timer = window.setInterval(poll, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, []);
    return temp;
}

function useFanCurvesSave({ working, saved, setSaved, setWorking, save, onSaved }) {
    const [saving, setSaving] = SP_REACT.useState(false);
    const [saveError, setSaveError] = SP_REACT.useState("");
    const dirty = !!saved && !!working && JSON.stringify(saved.fanCurves) + JSON.stringify(saved.fanSettings) !==
        JSON.stringify(working.fanCurves) + JSON.stringify(working.fanSettings);
    const handleSave = async () => {
        if (!working || saving)
            return;
        setSaving(true);
        try {
            const next = await save(working.fanCurves, working.fanSettings);
            setSaveError("");
            setWorking(clone(next));
            setSaved(next);
            onSaved?.(next);
        }
        catch (error) {
            setSaveError(String(error));
        }
        finally {
            setSaving(false);
        }
    };
    const handleRevert = () => {
        if (!saved)
            return;
        setSaveError("");
        setWorking(clone(saved));
    };
    return { dirty, saving, saveError, handleSave, handleRevert };
}

function FanCurveEditorModal({ initial, setDraft, initialSelected, onSelectedChange, saved, onSaved, closeModal, }) {
    const [state, setState] = SP_REACT.useState(initial);
    const [selected, setSelected] = SP_REACT.useState(initialSelected);
    const [savedState, setSavedState] = SP_REACT.useState(saved);
    const currentTemp = useCurrentTemp();
    const setBoth = (value) => {
        setState((current) => {
            const next = typeof value === "function"
                ? value(current)
                : value;
            return next ?? current;
        });
        setDraft(value);
    };
    const setSelectedBoth = (value) => {
        setSelected(value);
        onSelectedChange(value);
    };
    const { dirty, saving, saveError, handleSave, handleRevert } = useFanCurvesSave({
        working: state,
        saved: savedState,
        setSaved: setSavedState,
        setWorking: setBoth,
        save: saveFanCurves,
        onSaved,
    });
    return (SP_JSX.jsxs(DFL.ModalRoot, { bAllowFullSize: true, onCancel: () => closeModal?.(), children: [SP_JSX.jsx("style", { children: styles }), SP_JSX.jsxs(DFL.DialogBody, { className: "afc-scope", children: [saveError ? SP_JSX.jsx("div", { className: "afc-error", children: saveError }) : null, SP_JSX.jsx(FanCurveGraphEditor, { state: state, setState: setBoth, selected: selected, onSelectedChange: setSelectedBoth, currentTemp: currentTemp })] }), SP_JSX.jsxs(DFL.DialogFooter, { className: "afc-modal-footer", children: [SP_JSX.jsxs("div", { className: "afc-modal-footer-row", children: [SP_JSX.jsx(DFL.DialogButton, { className: "afc-modal-footer-half", onClick: handleSave, disabled: !dirty || saving, children: saving ? "Saving..." : "Save Changes" }), SP_JSX.jsx(DFL.DialogButton, { className: "afc-modal-footer-half", onClick: handleRevert, disabled: !dirty || saving, children: "Revert Changes" })] }), SP_JSX.jsx(DFL.DialogButton, { className: "afc-modal-footer-full", onClick: () => closeModal?.(), children: "Close" })] })] }));
}

function Fans({ setConfig: _setConfig }) {
    const [saved, setSaved] = SP_REACT.useState(null);
    const [draft, setDraft] = SP_REACT.useState(null);
    const [message, setMessage] = SP_REACT.useState("Loading");
    const [selectedCurve, setSelectedCurve] = SP_REACT.useState("");
    const currentTemp = useCurrentTemp();
    const load = SP_REACT.useCallback(async () => {
        try {
            const next = await getFansState();
            setSaved(next);
            setDraft(clone(next));
            const names = Object.keys(next.fanCurves || {}).sort();
            const activeCurve = next.profiles?.[next.activeProfile]?.fan_curve;
            setSelectedCurve(activeCurve && names.includes(activeCurve) ? activeCurve : names[0] || "");
        }
        catch (error) {
            setMessage(String(error));
        }
    }, []);
    SP_REACT.useEffect(() => {
        load();
    }, [load]);
    const syncSharedFanCurves = (_next) => {
        // Do not merge edited points into power.fan_curves. Power profiles and
        // Control Center only know silent/auto/aggressive as *mode names*.
    };
    const { dirty, saving, saveError, handleSave, handleRevert } = useFanCurvesSave({
        working: draft,
        saved,
        setSaved,
        setWorking: setDraft,
        save: saveFanCurves,
        onSaved: syncSharedFanCurves,
    });
    if (!draft) {
        return (SP_JSX.jsx(DFL.PanelSection, { title: "Fan curves", children: SP_JSX.jsx(DFL.Field, { label: message }) }));
    }
    const openFullscreen = () => DFL.showModal(SP_JSX.jsx(FanCurveEditorModal, { initial: draft, setDraft: setDraft, initialSelected: selectedCurve, onSelectedChange: setSelectedCurve, saved: saved, onSaved: (next) => {
            setSaved(next);
        } }));
    const openCreateCurve = () => DFL.showModal(SP_JSX.jsx(CreateCurveModal, { initial: draft, setDraft: setDraft, initialBaseCurve: selectedCurve, onCreated: setSelectedCurve }));
    return (SP_JSX.jsxs("div", { className: "afc-scope", children: [SP_JSX.jsx(DFL.PanelSection, { title: "qcom-fan curves", children: SP_JSX.jsx(Hint, { label: "Shared with Control Center", description: draft.runtimeMode === "manual" || draft.runtimeMode === "off"
                        ? `Control Center (Home+A) is in ${draft.runtimeMode}. Edited curves apply again when that mode is selected.`
                        : "This tab edits the Silent / Auto / Aggressive curves. It does not change the current mode." }) }), saveError ? SP_JSX.jsx("div", { className: "afc-error", children: saveError }) : null, SP_JSX.jsx(FanCurveEditor, { state: draft, setState: setDraft, selected: selectedCurve, onSelectedChange: setSelectedCurve, onOpenFullscreen: openFullscreen, onOpenCreateCurve: openCreateCurve, currentTemp: currentTemp }), SP_JSX.jsxs(DFL.PanelSection, { title: "SAVE", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { className: "afc-control-inset", children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: handleSave, disabled: !dirty || saving, children: saving ? "Saving..." : "Save Changes" }) }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { className: "afc-control-inset", children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: handleRevert, disabled: !dirty || saving, children: "Revert Changes" }) }) }), dirty ? SP_JSX.jsx("div", { className: "afc-note", children: "You have unsaved changes." }) : null] })] }));
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
    const compact = useUiCompact();
    const setCompactLayout = (serious) => {
        setUiCompact(serious);
        const global = { ...(config.tweaks?.global || {}), uiCompact: serious };
        const tweaks = { global, games: config.tweaks?.games || {} };
        setConfig((current) => (current ? { ...current, tweaks } : current));
        saveTweaks(tweaks).catch(() => { });
    };
    const sleepModes = config.sleepModes || [];
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSection, { title: "Interface", children: SP_JSX.jsx(ToggleRow, { label: "Serious layout", description: "Compact menu with helper descriptions hidden. Turn off to show detailed guidance.", value: compact, onChange: setCompactLayout }) }), SP_JSX.jsxs(DFL.PanelSection, { title: "Controller", children: [config.controllerSupported ? (SP_JSX.jsx(SelectEdit, { label: "Emulation", value: config.controllerType || "deck-uhid", options: config.controllerTypes || [], onChange: setControllerType$1 })) : (SP_JSX.jsx(DFL.Field, { label: "Controller emulation", description: "Managed by Batocera/evmapy on this image; Armada's InputPlumber selector is not installed." })), SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: openCalibration, children: "Launch Calibration" })] }), SP_JSX.jsxs(DFL.PanelSection, { title: "System", children: [SP_JSX.jsx(ToggleRow, { label: "Enable SSH", description: "Persists Batocera's Dropbear service setting.", value: !!config.sshEnabled, onChange: setSshEnabled$1 }), sleepModes.length > 1 ? (SP_JSX.jsx(SelectEdit, { label: "Sleep Mode", value: config.sleepMode || sleepModes[0]?.data || "", options: sleepModes, onChange: setSleepMode$1 })) : null, SP_JSX.jsx(DFL.Field, { label: "OS Version", description: config.osVersion || "unknown" }), (config.warnings || []).map((warning) => SP_JSX.jsx(DFL.Field, { label: "Plugin warning", description: warning }, warning))] })] }));
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
            setUiCompact(next.tweaks?.global?.uiCompact !== false);
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
                    { id: "Fans", title: tabIcons.Fans, content: tabContent(SP_JSX.jsx(Fans, { setConfig: setConfig })) },
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
    window.__batoceraOpenOledRefresher = openOledRefresher;
    routerHook.addGlobalComponent("BatoceraControlOledSaver", () => SP_JSX.jsx(OledScreensaverOverlay, {}));
    const emulationMenuPatch = applyEmulationMenuPatch();
    const stopOledIdleWatch = startOledIdleWatch();
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
        const oled = config.oledCare?.config;
        if (oled)
            updateOledIdleConfig(oled);
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
            stopOledIdleWatch();
            emulationMenuPatch.unpatch();
            setOledScreensaverActive(false);
            setOledRefresherActive(false);
            routerHook.removeGlobalComponent("BatoceraControlOledSaver");
        },
        icon: (SP_JSX.jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", width: "24", height: "24", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [SP_JSX.jsx("path", { d: "M14 17H5" }), SP_JSX.jsx("path", { d: "M19 7h-9" }), SP_JSX.jsx("circle", { cx: "17", cy: "17", r: "3" }), SP_JSX.jsx("circle", { cx: "7", cy: "7", r: "3" })] })),
        alwaysRender: true,
    };
});

export { index as default };
//# sourceMappingURL=index.js.map
