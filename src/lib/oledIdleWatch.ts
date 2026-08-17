import { getOledIdle, noteOledActivity } from "../backend";
import { openOledRefresher } from "../components/OledRefresherOverlay";
import { getOledRefresherActive, oledRefresherSwallowingClick } from "./oledRefresher";
import { getOledScreensaverActive } from "./oledScreensaver";
import { steamClient, steamWindow } from "./steamHost";

type IdleCfg = {
  ENABLED: number;
  DETECT: number;
  REFRESHER: number;
  STATIC_TIMEOUT: number;
  REFRESHER_DURATION: number;
  REFRESHER_PASSES: number;
};

let cfg: IdleCfg = {
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

export function updateOledIdleConfig(next: Partial<IdleCfg>) {
  cfg = { ...cfg, ...next };
  bumpActivity();
}

function timeoutSec() {
  return Math.max(5, cfg.STATIC_TIMEOUT || 30);
}

let lastNote = 0;

function bumpActivity(persist = false) {
  lastActivity = performance.now();
  if (!persist) return;
  const now = performance.now();
  if (now - lastNote < 400) return;
  lastNote = now;
  void noteOledActivity().catch(() => {});
}

function armCooldown() {
  cooldownUntil = performance.now() + timeoutSec() * 1000;
  bumpActivity(true);
}

function canAutoStart() {
  return cfg.ENABLED === 1 && cfg.DETECT !== 0 && cfg.REFRESHER === 1;
}

function eatIfBlocking(event: Event) {
  if (!getOledRefresherActive() && !oledRefresherSwallowingClick()) return;
  event.preventDefault();
  event.stopPropagation();
  (event as { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
}

function maybeStart() {
  if (!canAutoStart()) return;
  if (getOledRefresherActive() || getOledScreensaverActive()) return;
  if (performance.now() < cooldownUntil) return;
  if ((performance.now() - lastActivity) / 1000 < timeoutSec()) return;
  armCooldown();
  openOledRefresher({
    durationSec: cfg.REFRESHER_DURATION,
    passes: cfg.REFRESHER_PASSES,
  });
}

function padSignature(win: Window) {
  try {
    const pads = win.navigator.getGamepads?.() || [];
    const parts: string[] = [];
    for (const pad of pads) {
      if (!pad) continue;
      const buttons = pad.buttons.map((button) => (button.pressed || button.value > 0.2 ? 1 : 0)).join("");
      const axes = pad.axes.map((axis) => Math.round(axis * 8)).join(",");
      parts.push(`${pad.index}:${buttons}:${axes}`);
    }
    return parts.join("|");
  } catch {
    return "";
  }
}

function bindSteamInput(win: Window) {
  const input = steamClient(win)?.Input;
  const regs: Array<{ unregister?: () => void }> = [];
  const onActivity = () => bumpActivity(true);
  if (input) {
    try {
      const digital = input.RegisterForControllerInputMessages?.(onActivity);
      if (digital) regs.push(digital);
    } catch {
      /* ignore */
    }
    try {
      const analog = input.RegisterForControllerAnalogInputMessages?.(onActivity);
      if (analog) regs.push(analog);
    } catch {
      /* ignore */
    }
    try {
      const state = input.RegisterForControllerStateChanges?.((changes: any[]) => {
        if (!Array.isArray(changes) || !changes.length) return;
        onActivity();
      });
      if (state) regs.push(state);
    } catch {
      /* ignore */
    }
  }
  return () => {
    for (const reg of regs) {
      try {
        reg.unregister?.();
      } catch {
        /* ignore */
      }
    }
  };
}

function bindWindow(win: Window, onDom: () => void, block: (event: Event) => void) {
  const domTypes = ["pointerdown", "touchstart", "keydown", "mousedown"];
  const blockTypes = ["click", "pointerup", "pointerdown", "touchstart", "mousedown"];
  for (const type of domTypes) win.addEventListener(type, onDom, true);
  for (const type of blockTypes) win.addEventListener(type, block, true);
  const unbindSteam = bindSteamInput(win);
  return () => {
    unbindSteam();
    for (const type of domTypes) win.removeEventListener(type, onDom, true);
    for (const type of blockTypes) win.removeEventListener(type, block, true);
  };
}

export function startOledIdleWatch() {
  bumpActivity();
  armCooldown();
  const onDom = () => bumpActivity(true);
  const unbindPlugin = bindWindow(window, onDom, eatIfBlocking);
  let unbindSteamWin = () => {};
  try {
    const host = steamWindow();
    if (host !== window) unbindSteamWin = bindWindow(host, onDom, eatIfBlocking);
  } catch {
    unbindSteamWin = () => {};
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
    } else if (!lastPadSig) {
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
        if (!canAutoStart() || getOledRefresherActive()) return;
        if (performance.now() < cooldownUntil) return;
        const timeout = timeoutSec();
        const localIdle = (performance.now() - lastActivity) / 1000;
        if (localIdle < timeout) return;
        if (state?.watching) {
          if (state.idleSeconds < 2) {
            bumpActivity();
            return;
          }
          if (state.idleSeconds >= timeout) maybeStart();
          return;
        }
        maybeStart();
      })
      .catch(() => {
        if (performance.now() < cooldownUntil) return;
        if ((performance.now() - lastActivity) / 1000 >= timeoutSec()) maybeStart();
      });
  }, 250);

  return () => {
    window.clearInterval(tick);
    unbindPlugin();
    unbindSteamWin();
  };
}
