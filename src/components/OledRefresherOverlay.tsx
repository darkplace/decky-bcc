import { Navigation } from "@decky/ui";
import { getOledRefresherOpts, setOledRefresherActive } from "../lib/oledRefresher";
import { steamClient, steamNavManager, steamWindow } from "../lib/steamHost";
import { applyCoverChrome, pushOverlayComposition, releaseCoverChrome } from "../lib/uiComposition";

const AYN_TEXT = "Anti-image-retention pixel refresh in progress, tap to exit (%ds)";
const CELL_PX = 3;
const ARM_MS = 450;
const SHIELD_MS = 480;

let mounted: {
  root: HTMLDivElement;
  win: Window;
  doc: Document;
  stop: () => void;
  releaseComposition: () => void;
} | null = null;

function controllerButtonsPressed(changes: any[]) {
  return Array.isArray(changes) && changes.some((change) => {
    try {
      return BigInt(String(change?.ulButtons ?? 0)) !== 0n
        || BigInt(String(change?.ulUpperButtons ?? 0)) !== 0n;
    } catch {
      return Number(change?.ulButtons || 0) !== 0 || Number(change?.ulUpperButtons || 0) !== 0;
    }
  });
}

function disableSmoothing(ctx: CanvasRenderingContext2D) {
  ctx.imageSmoothingEnabled = false;
  (ctx as CanvasRenderingContext2D & { webkitImageSmoothingEnabled?: boolean }).webkitImageSmoothingEnabled = false;
}

/** Same recipe as the pygame smoke: fill 3×3 rects, then blit 1:1. */
function paintBand(ctx: CanvasRenderingContext2D, width: number, height: number, cell: number) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  const inset = 16;
  const innerW = width - inset * 2;
  const innerH = height - inset * 2;
  if (innerW < cell || innerH < cell) return;
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

function eat(event: Event) {
  event.preventDefault();
  event.stopPropagation();
  (event as { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
}

function unmount(immediate = false) {
  const current = mounted;
  if (!current) return;
  current.stop();
  const finish = () => {
    if (mounted?.root !== current.root) return;
    current.releaseComposition();
    current.root.remove();
    releaseCoverChrome(current.doc);
    mounted = null;
  };
  if (immediate) finish();
  else current.win.setTimeout(finish, SHIELD_MS);
}

export function openOledRefresher(opts?: { durationSec?: number; passes?: number }) {
  setOledRefresherActive(true, opts);
  try {
    Navigation.CloseSideMenus();
  } catch {
    /* ignore */
  }
  window.setTimeout(() => mountOledRefresher(), 80);
}

function mountOledRefresher() {
  if (mounted) unmount(true);
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
  const cleanups: Array<() => void> = [];

  const close = () => {
    if (!armed || closing) return;
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
    const loop = (now: number) => {
      if (closing) return;
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

  const onPointerDown = (event: PointerEvent) => {
    eat(event);
    try {
      root.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    eat(event);
    close();
  };
  const onClick = (event: Event) => eat(event);
  const onKey = (event: KeyboardEvent) => {
    if (!event.key) return;
    eat(event);
    close();
  };
  root.addEventListener("pointerdown", onPointerDown, true);
  root.addEventListener("pointerup", onPointerUp, true);
  root.addEventListener("click", onClick, true);
  root.addEventListener("touchstart", onClick, { capture: true, passive: false });
  root.addEventListener("touchend", onPointerUp as EventListener, { capture: true, passive: false });
  win.addEventListener("keydown", onKey, true);
  cleanups.push(() => {
    root.removeEventListener("pointerdown", onPointerDown, true);
    root.removeEventListener("pointerup", onPointerUp, true);
    root.removeEventListener("click", onClick, true);
    root.removeEventListener("touchstart", onClick, true);
    root.removeEventListener("touchend", onPointerUp as EventListener, true);
    win.removeEventListener("keydown", onKey, true);
  });

  const nav = steamNavManager(win);
  try {
    const release = nav?.SetCatchAllGamepadInput?.(() => close());
    if (typeof release === "function") cleanups.push(release);
    else if (nav?.SetCatchAllGamepadInput) {
      cleanups.push(() => {
        try {
          nav.SetCatchAllGamepadInput(null);
        } catch {
          /* ignore */
        }
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const registration = steamClient(win)?.Input?.RegisterForControllerStateChanges?.((changes: any[]) => {
      if (controllerButtonsPressed(changes)) close();
    });
    if (registration?.unregister) {
      cleanups.push(() => {
        try {
          registration.unregister();
        } catch {
          /* ignore */
        }
      });
    }
  } catch {
    /* ignore */
  }

  const padPoll = win.setInterval(() => {
    if (!armed || closing) return;
    try {
      const pads = win.navigator.getGamepads?.() || [];
      for (const pad of pads) {
        if (!pad) continue;
        if (pad.buttons.some((button) => button.pressed || button.value > 0.35)) {
          close();
          return;
        }
        if (pad.axes.some((axis) => Math.abs(axis) > 0.45)) {
          close();
          return;
        }
      }
    } catch {
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
        } catch {
          /* ignore */
        }
      }
    },
  };
}
