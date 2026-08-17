import { getOledIdle, noteOledActivity } from "../backend";
import { openOledRefresher } from "../components/OledRefresherOverlay";
import { getOledRefresherActive, oledRefresherSwallowingClick } from "./oledRefresher";
import { getOledScreensaverActive } from "./oledScreensaver";

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
  if (now - lastNote < 500) return;
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
  armCooldown();
  openOledRefresher({
    durationSec: cfg.REFRESHER_DURATION,
    passes: cfg.REFRESHER_PASSES,
  });
}

function bindSteamInput() {
  const input = window.SteamClient?.Input;
  if (!input) return () => {};
  const regs: Array<{ unregister?: () => void }> = [];
  const onActivity = () => bumpActivity();
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

export function startOledIdleWatch() {
  bumpActivity();
  armCooldown();
  const onDom = () => bumpActivity(true);
  const domTypes = ["pointerdown", "touchstart", "keydown", "mousedown"];
  for (const type of domTypes) window.addEventListener(type, onDom, true);
  const blockTypes = ["click", "pointerup", "pointerdown", "touchstart", "mousedown"];
  for (const type of blockTypes) window.addEventListener(type, eatIfBlocking, true);
  const unbindSteam = bindSteamInput();

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
        if (state?.watching) {
          if (state.idleSeconds < 2) {
            bumpActivity();
            return;
          }
          if (state.idleSeconds >= timeout) maybeStart();
          return;
        }
        const localIdle = (performance.now() - lastActivity) / 1000;
        if (localIdle >= timeout) maybeStart();
      })
      .catch(() => {
        if (performance.now() < cooldownUntil) return;
        if ((performance.now() - lastActivity) / 1000 >= timeoutSec()) maybeStart();
      });
  }, 1000);

  return () => {
    window.clearInterval(tick);
    unbindSteam();
    for (const type of domTypes) window.removeEventListener(type, onDom, true);
    for (const type of blockTypes) window.removeEventListener(type, eatIfBlocking, true);
  };
}
