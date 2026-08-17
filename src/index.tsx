import { definePlugin, routerHook } from "@decky/api";
import { getCompatApplied, getConfig, getInstalledGames, saveCompatApplied } from "./backend";
import { openOledRefresher } from "./components/OledRefresherOverlay";
import { OledScreensaverOverlay } from "./components/OledScreensaverOverlay";
import { Content } from "./Content";
import {
  configureCompatPolicy,
  handledGameAppids,
  registerDownloadWatcher,
  sweepInstalledGames,
} from "./lib/steamCompat";
import { applyEmulationMenuPatch, refreshEmulationManagedAppids } from "./lib/emulationMenu";
import { setOledRefresherActive } from "./lib/oledRefresher";
import { setOledScreensaverActive } from "./lib/oledScreensaver";
import { startOledIdleWatch, updateOledIdleConfig } from "./lib/oledIdleWatch";

export default definePlugin(() => {
  (window as any).__batoceraOpenOledRefresher = openOledRefresher;
  routerHook.addGlobalComponent("BatoceraControlOledSaver", () => <OledScreensaverOverlay />);
  const emulationMenuPatch = applyEmulationMenuPatch();
  const stopOledIdleWatch = startOledIdleWatch();
  void refreshEmulationManagedAppids().catch(() => {});
  const emulationManifestTimer = window.setInterval(
    () => void refreshEmulationManagedAppids().catch(() => {}),
    15000,
  );
  let unregisterDownloadWatcher = () => {};
  let cancelled = false;
  const persistHandledGames = () => saveCompatApplied(handledGameAppids()).catch(() => {});
  const handledRequest = getCompatApplied()
    .then((appids) => ({ appids, loaded: true }))
    .catch(() => ({ appids: [] as string[], loaded: false }));
  Promise.all([getConfig(), getInstalledGames(), handledRequest])
    .then(([config, games, handled]) => {
      if (cancelled) return;
      const oled = config.oledCare?.config;
      if (oled) updateOledIdleConfig(oled);
      configureCompatPolicy(
        config.tweaks?.global?.windowsCompatTool,
        handled.loaded && config.tweaks?.global?.autoApplyCompat !== false,
        handled.appids,
        config.launchWrapperPath,
      );
      const persist = handled.loaded ? persistHandledGames : () => {};
      unregisterDownloadWatcher = registerDownloadWatcher(persist);
      window.setTimeout(() => {
        if (cancelled) return;
        sweepInstalledGames(games.map((game) => game.appid)).then(persist).catch(() => {});
      }, 3000);
    })
    .catch(() => {});
  return {
    name: "Batocera Control",
    content: <Content />,
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
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 17H5" />
        <path d="M19 7h-9" />
        <circle cx="17" cy="17" r="3" />
        <circle cx="7" cy="7" r="3" />
      </svg>
    ),
    alwaysRender: true,
  };
});
