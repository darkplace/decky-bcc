import { ModalRoot, Navigation, findSP, showModal } from "@decky/ui";
import { useEffect, useRef } from "react";
import { getOledRefresherOpts, setOledRefresherActive } from "../lib/oledRefresher";

const AYN_TEXT = "Anti-image-retention pixel refresh in progress, tap to exit (%ds)";
/** Batocera/AYN: each noise grain is a 3×3 framebuffer pixel cell. */
const CELL_PX = 3;

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

function fillNoise(ctx: CanvasRenderingContext2D, cols: number, rows: number) {
  const image = ctx.createImageData(cols, rows);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (Math.random() * 256) | 0;
    data[i + 1] = (Math.random() * 256) | 0;
    data[i + 2] = (Math.random() * 256) | 0;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

export function openOledRefresher(opts?: { durationSec?: number; passes?: number }) {
  setOledRefresherActive(true, opts);
  try {
    Navigation.CloseSideMenus();
  } catch {
    /* ignore */
  }
  window.setTimeout(() => {
    showModal(<OledRefresherModal />, findSP() || window, { bHideActionIcons: true });
  }, 80);
}

export function OledRefresherModal({ closeModal }: { closeModal?: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const armed = useRef(false);
  const opts = getOledRefresherOpts();
  const durationSec = Math.max(1, opts.durationSec);
  const passes = Math.max(1, opts.passes);

  const close = () => {
    if (!armed.current) return;
    setOledRefresherActive(false);
    closeModal?.();
  };

  useEffect(() => {
    const armTimer = window.setTimeout(() => {
      armed.current = true;
    }, 500);

    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) {
      return () => window.clearTimeout(armTimer);
    }

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = Math.max(
      800,
      wrap.clientWidth || window.innerWidth || window.screen?.width || 1920,
    );
    const cssH = Math.max(
      480,
      wrap.clientHeight || window.innerHeight || window.screen?.height || 1080,
    );
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      return () => window.clearTimeout(armTimer);
    }
    ctx.imageSmoothingEnabled = false;

    const cell = CELL_PX;
    const bandH = Math.max(cell * 8, Math.floor(canvas.height / 3 / cell) * cell);
    const cols = Math.max(1, Math.ceil(canvas.width / cell));
    const rows = Math.max(1, Math.ceil(bandH / cell));
    const noise = document.createElement("canvas");
    const nctx = noise.getContext("2d", { alpha: false });
    if (!nctx) {
      return () => window.clearTimeout(armTimer);
    }

    const paintNoise = () => {
      noise.width = cols;
      noise.height = rows;
      fillNoise(nctx, cols, rows);
    };
    paintNoise();

    const totalSec = durationSec * passes;
    const startedAt = performance.now();
    let lastPass = -1;
    let raf = 0;
    const loop = (now: number) => {
      const elapsed = (now - startedAt) / 1000;
      if (elapsed >= totalSec) {
        armed.current = true;
        close();
        return;
      }
      const pass = Math.min(passes - 1, Math.floor(elapsed / durationSec));
      if (pass !== lastPass) {
        lastPass = pass;
        paintNoise();
      }
      const frac = Math.min(1, (elapsed - pass * durationSec) / durationSec);
      const travel = Math.max(0, canvas.height - bandH);
      const y = Math.floor((frac * travel) / cell) * cell;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(noise, 0, 0, cols, rows, 0, y, cols * cell, rows * cell);
      if (labelRef.current) {
        const left = Math.max(0, Math.ceil(totalSec - elapsed));
        labelRef.current.textContent = AYN_TEXT.replace("%ds", `${left}s`);
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);

    const onPointer = () => close();
    const onKey = (event: KeyboardEvent) => {
      if (event.key) close();
    };
    wrap.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);

    let registration: { unregister?: () => void } | undefined;
    const inputDelay = window.setTimeout(() => {
      try {
        registration = window.SteamClient?.Input?.RegisterForControllerStateChanges?.((changes: any[]) => {
          if (controllerButtonsPressed(changes)) close();
        });
      } catch {
        registration = undefined;
      }
    }, 500);

    return () => {
      window.clearTimeout(armTimer);
      window.clearTimeout(inputDelay);
      window.cancelAnimationFrame(raf);
      wrap.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      try {
        registration?.unregister?.();
      } catch {
        /* ignore */
      }
    };
  }, [closeModal, durationSec, passes]);

  return (
    <ModalRoot
      bAllowFullSize
      bHideCloseIcon
      bDisableBackgroundDismiss
      className="batocera-oled-refresh-modal"
      modalClassName="batocera-oled-refresh-modal"
      onCancel={close}
    >
      <style>{`
        .batocera-oled-refresh-modal,
        .batocera-oled-refresh-modal .DialogContent,
        .batocera-oled-refresh-modal .GenericDialog,
        .ModalOverlayContent:has(.batocera-oled-refresh-wrap) {
          width: 100vw !important;
          height: 100vh !important;
          max-width: none !important;
          max-height: none !important;
          padding: 0 !important;
          margin: 0 !important;
          background: #000 !important;
          border: 0 !important;
          box-shadow: none !important;
        }
      `}</style>
      <div
        ref={wrapRef}
        className="batocera-oled-refresh-wrap"
        style={{
          position: "relative",
          width: "100vw",
          height: "100vh",
          background: "#000",
          overflow: "hidden",
          cursor: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: "block",
            imageRendering: "pixelated",
          }}
        />
        <div
          ref={labelRef}
          style={{
            position: "absolute",
            left: "4%",
            right: "4%",
            top: "6%",
            textAlign: "center",
            color: "#fff",
            fontSize: "22px",
            fontWeight: 600,
            lineHeight: 1.35,
            userSelect: "none",
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      </div>
    </ModalRoot>
  );
}
