import { findSP, getFocusNavController } from "@decky/ui";

/** GamepadUI main window. Plugin `window` is often SharedJSContext (1×1). */
export function steamWindow(): Window {
  try {
    const sp = findSP();
    if (sp?.document?.documentElement) return sp;
  } catch {
    /* ignore */
  }
  return window;
}

export function steamClient(win: Window = steamWindow()): any {
  return (win as any).SteamClient || (window as any).SteamClient;
}

export function steamNavManager(win: Window = steamWindow()): any {
  return (
    (win as any).SteamUIStore?.NavigationManager
    || (window as any).SteamUIStore?.NavigationManager
    || getFocusNavController()
  );
}
