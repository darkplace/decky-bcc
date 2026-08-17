import { ButtonItem, Field, PanelSection, Tabs } from "@decky/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getConfig, getInstalledGames, savePowerConfig, saveTweaks } from "./backend";
import { useDebouncedSave } from "./hooks/useDebouncedSave";
import { tabIcons } from "./icons";
import { currentGame } from "./lib/games";
import { styles } from "./styles";
import { setUiCompact } from "./lib/uiMode";
import { BackPaddles } from "./tabs/BackPaddles";
import { Compatibility } from "./tabs/Compatibility";
import { LedControl } from "./tabs/LedControl";
import { Lsfg } from "./tabs/Lsfg";
import { OledCare } from "./tabs/OledCare";
import { Power } from "./tabs/Power";
import { Fans } from "./tabs/Fans";
import { Settings } from "./tabs/Settings";
import type { Config } from "./types";

export function Content() {
  const [tab, setTab] = useState("Compatibility");
  const [config, setConfig] = useState<Config | null>(null);
  const [message, setMessage] = useState("Loading");
  const savedPowerSnapshot = useRef("");
  const savedTweaksSnapshot = useRef("");
  const installedGamesRequested = useRef(false);
  const load = useCallback(async () => {
    try {
      const next = await getConfig();
      next.game = currentGame();
      next.selectedGame = next.game || null;
      setUiCompact(next.tweaks?.global?.uiCompact !== false);
      savedPowerSnapshot.current = JSON.stringify(next.power);
      savedTweaksSnapshot.current = JSON.stringify(next.tweaks);
      setConfig((current) => ({ ...next, installedGames: current?.installedGames || next.installedGames }));
      setMessage("");
    } catch (error) {
      setMessage(String(error));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!config || installedGamesRequested.current) return;
    installedGamesRequested.current = true;
    let cancelled = false;
    getInstalledGames()
      .then((installedGames) => {
        if (!cancelled) setConfig((current) => (current ? { ...current, installedGames } : current));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [!!config]);
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    const refreshRuntime = async () => {
      try {
        const runtimeGame = currentGame();
        if (cancelled) return;
        setConfig((current) => {
          if (!current) return current;
          const currentApp = current.game?.appid || "";
          const nextApp = runtimeGame?.appid || "";
          const currentName = current.game?.name || "";
          const nextName = runtimeGame?.name || "";
          if (currentApp === nextApp && currentName === nextName) return current;
          return { ...current, game: runtimeGame };
        });
      } catch (error) {}
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
    return (
      <PanelSection title="Batocera Control">
        <Field label={message === "Loading" ? "Loading" : "Failed to load plugin settings"} description={message === "Loading" ? "" : message} />
        {message !== "Loading" ? <ButtonItem layout="below" onClick={load}>Retry</ButtonItem> : null}
      </PanelSection>
    );
  }
  const tabContent = (content: ReactNode) => (
    <div className="armada-control-tab-content">{content}</div>
  );
  return (
    <div className="armada-control-tabs">
      <style>{styles}</style>
      <Tabs
        activeTab={tab}
        onShowTab={setTab}
        tabs={[
          { id: "Compatibility", title: tabIcons.Compatibility, content: tabContent(<Compatibility config={config} setConfig={setConfig} />) },
          { id: "LSFG", title: tabIcons.LSFG, content: tabContent(<Lsfg config={config} setConfig={setConfig} />) },
          { id: "Power", title: tabIcons.Power, content: tabContent(<Power config={config} setConfig={setConfig} />) },
          { id: "Fans", title: tabIcons.Fans, content: tabContent(<Fans setConfig={setConfig} />) },
          { id: "LEDs", title: tabIcons.LEDs, content: tabContent(<LedControl config={config} setConfig={setConfig} />) },
          { id: "OLED", title: tabIcons.OLED, content: tabContent(<OledCare config={config} setConfig={setConfig} />) },
          { id: "Paddles", title: tabIcons.Paddles, content: tabContent(<BackPaddles config={config} setConfig={setConfig} />) },
          { id: "Advanced", title: tabIcons.Advanced, content: tabContent(<Settings config={config} setConfig={setConfig} />) },
        ]}
      />
    </div>
  );
}
