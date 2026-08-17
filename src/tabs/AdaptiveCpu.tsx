import { Field, PanelSection } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getCpuLimit, saveCpuLimit } from "../backend";
import { Hint, SelectEdit } from "../components/widgets";
import type { Config, CpuLimitConfig } from "../types";

const MODE_LABELS: Record<string, string> = {
  off: "Off",
  auto: "Thermal guard",
  adaptive: "Adaptive FPS",
};

function capLabel(value: string) {
  if (value === "auto") return "Automatic / game setting";
  if (value === "none") return "No fixed cap";
  return `${value}% maximum`;
}

function targetLabel(value: string) {
  return value === "auto" ? "Automatic (infer from game)" : `${value} FPS`;
}

function runtimeLabel(state: NonNullable<Config["cpuLimit"]>) {
  const parts = [state.running ? "Limiter running" : "Limiter stopped"];
  if (state.fps !== null) parts.push(`${state.fps.toFixed(1)} FPS`);
  if (state.currentTdp !== null) parts.push(`${state.currentTdp} W`);
  if (state.minTdp !== null && state.maxTdp !== null) parts.push(`range ${state.minTdp}–${state.maxTdp} W`);
  if (state.temperatureC !== null) parts.push(`${state.temperatureC.toFixed(1)}°C`);
  if (state.fanPercent !== null) parts.push(`fan ${Math.round(state.fanPercent)}%`);
  return parts.join(" · ");
}

export function AdaptiveCpu({ config, setConfig }: {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config | null>>;
}) {
  const revision = useRef(0);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const busy = useRef(false);
  const [message, setMessage] = useState("");
  const state = config.cpuLimit;

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (busy.current) return;
      try {
        const next = await getCpuLimit();
        if (!cancelled && !busy.current) {
          setConfig((current) => (current ? { ...current, cpuLimit: next } : current));
        }
      } catch (error) {}
    };
    const timer = window.setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [setConfig]);

  if (!state?.supported) {
    return (
      <PanelSection title="Adaptive power">
        <Field label="Unavailable" description={state?.reason || "Batocera's adaptive power limiter is unavailable."} />
      </PanelSection>
    );
  }

  const apply = (patch: Partial<CpuLimitConfig>) => {
    const next: CpuLimitConfig = {
      mode: patch.mode ?? state.mode,
      globalCap: patch.globalCap ?? state.globalCap,
      globalTargetFps: patch.globalTargetFps ?? state.globalTargetFps,
    };
    const request = ++revision.current;
    busy.current = true;
    setMessage("Applying…");
    setConfig((current) => current?.cpuLimit
      ? { ...current, cpuLimit: { ...current.cpuLimit, ...next } }
      : current);
    saveChain.current = saveChain.current.catch(() => {}).then(async () => {
      try {
        const saved = await saveCpuLimit(next);
        if (request === revision.current) {
          setConfig((current) => (current ? { ...current, cpuLimit: saved } : current));
          setMessage("Saved and applied");
        }
      } catch (error) {
        if (request === revision.current) setMessage(String(error));
      } finally {
        if (request === revision.current) busy.current = false;
      }
    });
  };

  const modeOptions = state.modeOptions.map((value) => ({
    data: value,
    label: state.kind === "tdp" && value === "adaptive" ? "Adaptive TDP / FPS" : MODE_LABELS[value] || value,
  }));
  const capOptions = state.capOptions.map((value) => ({ data: value, label: capLabel(value) }));
  const targetOptions = state.targetOptions.map((value) => ({ data: value, label: targetLabel(value) }));

  return (
    <PanelSection title={state.kind === "tdp" ? "Adaptive TDP" : "Adaptive CPU"}>
      {state.kind === "tdp" ? (
        <Hint
          label="Batocera package-power limiter"
          description="Adaptive TDP trims package power while FPS has headroom. Your TDP setting stays the ceiling."
        />
      ) : (
        <Hint
          label="Batocera CPU limiter"
          description="Thermal guard reacts to temperature and fan load. Adaptive FPS trims the CPU ceiling with headroom. Never overclocks."
        />
      )}
      <SelectEdit label="Mode" value={state.mode} options={modeOptions} onChange={(mode) => apply({ mode })} />
      {state.kind === "cpu" ? (
        <SelectEdit label="CPU ceiling" value={state.globalCap} options={capOptions} onChange={(globalCap) => apply({ globalCap })} />
      ) : null}
      <SelectEdit
        label="Target frame rate"
        labelBelow
        value={state.globalTargetFps}
        options={targetOptions}
        disabled={state.mode !== "adaptive"}
        onChange={(globalTargetFps) => apply({ globalTargetFps })}
      />
      <Field label="Runtime" description={runtimeLabel(state)} />
      <Hint
        label="FPS source"
        description={`${state.dataSource}. Steam uses Gamescope stats; ES emulators use Batocera's FPS sampler.`}
      />
      {message ? <Field label="Last change" description={message} /> : null}
    </PanelSection>
  );
}
