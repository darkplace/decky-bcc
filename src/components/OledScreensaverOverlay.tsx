import { useEffect, useState } from "react";
import { setOledScreensaverActive, useOledScreensaverActive } from "../lib/oledScreensaver";
import { UIComposition, useUIComposition } from "../lib/uiComposition";

function controllerButtonsPressed(changes: any[]) {
  return Array.isArray(changes) && changes.some((change) => {
    try {
      return BigInt(change?.ulButtons || 0) !== 0n || BigInt(change?.ulUpperButtons || 0) !== 0n;
    } catch (error) {
      return Number(change?.ulButtons || 0) !== 0 || Number(change?.ulUpperButtons || 0) !== 0;
    }
  });
}

function OledScreensaverSurface({ clock }: { clock: string }) {
  useUIComposition(UIComposition.Overlay);

  useEffect(() => {
    const exit = () => setOledScreensaverActive(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key) exit();
    };
    window.addEventListener("keydown", onKey, true);

    let registration: { unregister?: () => void } | undefined;
    const delay = window.setTimeout(() => {
      try {
        registration = window.SteamClient?.Input?.RegisterForControllerStateChanges?.((changes: any[]) => {
          if (controllerButtonsPressed(changes)) exit();
        });
      } catch {
        registration = undefined;
      }
    }, 500);
    return () => {
      window.clearTimeout(delay);
      window.removeEventListener("keydown", onKey, true);
      try {
        registration?.unregister?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return (
    <div
      aria-label="OLED screensaver; press any controller button or touch to exit"
      onPointerDown={() => setOledScreensaverActive(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 7003,
        overflow: "hidden",
        background: "#000",
        cursor: "none",
        pointerEvents: "auto",
      }}
    >
      <style>{`
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
      `}</style>
      <div className="batocera-control-oled-mark">
        BATOCERA
        <span className="batocera-control-oled-clock">{clock}</span>
      </div>
    </div>
  );
}

export function OledScreensaverOverlay() {
  const active = useOledScreensaverActive();
  const [clock, setClock] = useState("");

  useEffect(() => {
    if (!active) return;
    const update = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    update();
    const timer = window.setInterval(update, 30000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active) return null;
  return <OledScreensaverSurface clock={clock} />;
}
