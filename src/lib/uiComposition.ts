import { findModuleChild, findModuleExport } from "@decky/ui";
import { steamClient, steamWindow } from "./steamHost";

/** Same enum MagicBlackDecky / Steam GamepadUI use. */
export enum UIComposition {
  Hidden = 0,
  Notification = 1,
  Overlay = 2,
  Opaque = 3,
  OverlayKeyboard = 4,
  OverlayQAM = 5,
  OverlayKeyboard1 = 6,
}

type CompositionApi = {
  AddMinimumCompositionStateRequest: (token: unknown, state: UIComposition) => void;
  ChangeMinimumCompositionStateRequest?: (token: unknown, state: UIComposition) => void;
  RemoveMinimumCompositionStateRequest: (token: unknown) => void;
};

function looksLikeHook(value: unknown) {
  if (typeof value !== "function") return false;
  const source = value.toString();
  return (
    source.includes("AddMinimumCompositionStateRequest")
    && source.includes("ChangeMinimumCompositionStateRequest")
    && source.includes("RemoveMinimumCompositionStateRequest")
    && !source.includes("m_mapCompositionStateRequests")
  );
}

function looksLikeApi(value: unknown): value is CompositionApi {
  return (
    !!value
    && typeof (value as CompositionApi).AddMinimumCompositionStateRequest === "function"
    && typeof (value as CompositionApi).RemoveMinimumCompositionStateRequest === "function"
  );
}

function findCompositionApi(): CompositionApi | undefined {
  try {
    const exported = findModuleExport((exp: unknown) => looksLikeApi(exp));
    if (looksLikeApi(exported)) return exported;
  } catch {
    /* ignore */
  }
  try {
    const child = findModuleChild((mod: unknown) => {
      if (!mod || typeof mod !== "object") return undefined;
      for (const key of Object.keys(mod as Record<string, unknown>)) {
        const value = (mod as Record<string, unknown>)[key];
        if (looksLikeApi(value)) return value;
      }
      return undefined;
    });
    if (looksLikeApi(child)) return child;
  } catch {
    /* ignore */
  }
  const roots = [steamWindow(), window];
  for (const win of roots) {
    const store = (win as any).SteamUIStore;
    if (looksLikeApi(store)) return store;
    if (store && typeof store === "object") {
      for (const key of Object.keys(store)) {
        const value = store[key];
        if (looksLikeApi(value)) return value;
      }
    }
  }
  return undefined;
}

/** MagicBlack's React hook; no-op if this Steam build does not export it. */
export const useUIComposition: (composition: UIComposition) => void = (() => {
  try {
    const hook = findModuleChild((mod: unknown) => {
      if (!mod || typeof mod !== "object") return undefined;
      for (const key of Object.keys(mod as Record<string, unknown>)) {
        const value = (mod as Record<string, unknown>)[key];
        if (looksLikeHook(value)) return value;
      }
      return undefined;
    });
    if (typeof hook === "function") return hook as (composition: UIComposition) => void;
  } catch {
    /* ignore */
  }
  return () => {};
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

export function applyCoverChrome(doc: Document) {
  doc.documentElement.classList.add(BODY_CLASS);
  doc.body?.classList.add(BODY_CLASS);
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = COVER_CSS;
    doc.head.appendChild(style);
  }
}

export function releaseCoverChrome(doc: Document) {
  doc.documentElement.classList.remove(BODY_CLASS);
  doc.body?.classList.remove(BODY_CLASS);
  doc.getElementById(STYLE_ID)?.remove();
}

/** Raise GamepadUI to overlay composition so header/footer are not a separate layer. */
export function pushOverlayComposition(): () => void {
  const token = `batocera-oled-${Math.random().toString(36).slice(2)}`;
  const api = findCompositionApi();
  try {
    api?.AddMinimumCompositionStateRequest(token, UIComposition.Overlay);
  } catch {
    /* ignore */
  }
  const win = steamWindow();
  try {
    steamClient(win)?.Window?.SetComposition?.(UIComposition.Overlay, [], 1);
  } catch {
    /* ignore */
  }
  return () => {
    try {
      api?.RemoveMinimumCompositionStateRequest(token);
    } catch {
      /* ignore */
    }
    try {
      steamClient(win)?.Window?.SetComposition?.(UIComposition.Opaque, [], 1);
    } catch {
      /* ignore */
    }
  };
}
