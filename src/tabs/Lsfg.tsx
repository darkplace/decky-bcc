import { Field, PanelSection } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { saveLsfg, setLsfgGameEnabled } from "../backend";
import { Hint, SelectEdit, ToggleRow } from "../components/widgets";
import { setLsfgLaunchOption } from "../lib/steamCompat";
import type { Config, LsfgConfig } from "../types";

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

export function Lsfg({ config, setConfig }: {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config | null>>;
}) {
  const revision = useRef(0);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const [message, setMessage] = useState("");
  const [gameBusy, setGameBusy] = useState(false);
  const state = config.lsfg;
  const games = [...(config.installedGames || [])];
  if (config.game?.appid && !games.some((game) => game.appid === config.game?.appid)) {
    games.push({ appid: config.game.appid, name: config.game.name });
  }
  games.sort((a, b) => a.name.localeCompare(b.name));
  const [selectedAppid, setSelectedAppid] = useState(config.game?.appid || games[0]?.appid || "");
  useEffect(() => {
    if (selectedAppid && games.some((game) => game.appid === selectedAppid)) return;
    setSelectedAppid(config.game?.appid || games[0]?.appid || "");
  }, [config.game?.appid, games.map((game) => game.appid).join(","), selectedAppid]);

  if (!state?.supported) {
    return (
      <PanelSection title="LSFG-VK frame generation">
        <Field label="System layer unavailable" description={state?.reason || "LSFG-VK is not installed in this image."} />
      </PanelSection>
    );
  }

  const settings = state.config;
  const layerStatus = [
    state.layers.native ? "native ARM" : "",
    state.layers.x64 ? "x64/Wine" : "",
  ].filter(Boolean).join(" + ");

  const apply = (patch: Partial<LsfgConfig>) => {
    const next = { ...settings, ...patch };
    const request = ++revision.current;
    setMessage("");
    setConfig((current) => current?.lsfg
      ? { ...current, lsfg: { ...current.lsfg, config: next } }
      : current);
    saveChain.current = saveChain.current.catch(() => {}).then(async () => {
      try {
        const saved = await saveLsfg(next);
        if (request === revision.current) {
          setConfig((current) => (current ? { ...current, lsfg: saved } : current));
          setMessage(next.enabled
            ? "Saved — all-games mode applies after Steam/GamepadUI is relaunched."
            : "Saved — selected-game profiles use these settings on their next launch.");
        }
      } catch (error) {
        if (request === revision.current) setMessage(String(error));
      }
    });
  };

  const setGameEnabled = async (enabled: boolean) => {
    if (!selectedAppid || !state) return;
    const previous = state.enabledAppids.includes(selectedAppid);
    if (enabled === previous) return;
    setGameBusy(true);
    setMessage("Updating Steam launch options…");
    try {
      const saved = await setLsfgGameEnabled(selectedAppid, enabled);
      try {
        await setLsfgLaunchOption(selectedAppid, enabled, saved.wrapperPath);
      } catch (error) {
        await setLsfgGameEnabled(selectedAppid, previous).catch(() => {});
        throw error;
      }
      setConfig((current) => (current ? { ...current, lsfg: saved } : current));
      setMessage(enabled
        ? "Enabled for this game — applies on its next launch; Steam does not need to restart."
        : "Disabled for this game and removed from its Steam launch options.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setGameBusy(false);
    }
  };

  return (
    <>
      <PanelSection title="LSFG-VK frame generation">
        <Field
          label="Batocera system layer"
          description={`${layerStatus || "detected"}; no separate LSFG runtime is downloaded by this plugin.`}
        />
        <Field
          label={state.dllDetected ? "Lossless.dll detected" : "Lossless.dll missing"}
          description={state.dllPath}
        />
        <ToggleRow
          label="Enable for all Steam games"
          description="Injects the layer into every Steam game after a restart. Off = use the per-game selector."
          value={settings.enabled}
          disabled={!state.ready}
          onChange={(enabled) => apply({ enabled })}
        />
        {!state.dllDetected ? (
          <Field label="Required file" description="Copy Lossless.dll from a purchased Lossless Scaling installation to the path shown above." />
        ) : null}
      </PanelSection>

      <PanelSection title="Per-game activation">
        {games.length ? (
          <>
            <SelectEdit
              label="Steam game"
              value={selectedAppid}
              options={games.map((game) => ({ data: game.appid, label: game.name }))}
              onChange={(appid) => setSelectedAppid(String(appid))}
            />
            <ToggleRow
              label="Enable for selected game"
              description={settings.enabled
                ? "Global all-games mode is currently on, so this game already receives LSFG. This switch still controls its persistent per-game launch option."
                : "Adds a managed wrapper only to this game's Steam launch options. Other games remain untouched, and Steam itself does not need to restart."}
              value={!!selectedAppid && state.enabledAppids.includes(selectedAppid)}
              disabled={gameBusy || !state.ready || !state.perGameSupported || !selectedAppid}
              onChange={setGameEnabled}
            />
          </>
        ) : (
          <Field label="No installed Steam games found" description="Install or launch a game, then reopen this tab." />
        )}
      </PanelSection>

      <PanelSection title="Frame generation">
        <Hint label="Frame multiplier" description="2x has the lowest GPU cost; 3x/4x need more headroom." />
        <SelectEdit label="Multiplier" value={settings.multiplier} options={MULTIPLIERS} onChange={(multiplier) => apply({ multiplier })} />
        <Hint label="Optical-flow resolution" description="Lower values cost less at the expense of generated-frame detail." />
        <SelectEdit label="Flow scale" value={settings.flowScale} options={FLOW_SCALES} onChange={(flowScale) => apply({ flowScale })} />
        <ToggleRow
          label="Performance mode"
          description="Lighter LSFG model. Recommended when GPU-bound."
          value={settings.performanceMode}
          onChange={(performanceMode) => apply({ performanceMode })}
        />
        <ToggleRow
          label="HDR mode"
          description="Only when both game and display use HDR."
          value={settings.hdrMode}
          onChange={(hdrMode) => apply({ hdrMode })}
        />
        <Hint label="Present mode" description="Automatic is safest. FIFO is tear-free; Mailbox/Immediate can reduce latency but may tear." />
        <SelectEdit label="Vulkan present mode" value={settings.presentMode} options={PRESENT_MODES} onChange={(presentMode) => apply({ presentMode })} />
      </PanelSection>

      <PanelSection title="Activation">
        <Field label="Status" description={message || "Per-game applies on next launch; all-games mode needs a Steam restart."} />
        {state.legacyPluginDetected || state.legacyConfigDetected || state.legacyLaunchScriptDetected ? (
          <Field
            label="Legacy LSFG setup detected"
            description="Old wrapper kept for rollback. Remove ~/lsfg from per-game launch options before enabling the global layer."
          />
        ) : null}
        <Hint label="Upstream" description="System layer: PancakeTAS/lsfg-vk. UI derived from Decky LSFG-VK." />
      </PanelSection>
    </>
  );
}
