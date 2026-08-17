import { Field, PanelSection } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getFanControl, saveFanControl } from "../backend";
import { Hint, SelectEdit, SliderEdit } from "../components/widgets";
import type { Config, FanControlConfig } from "../types";

const FALLBACK_MODES = [
  { data: "silent", label: "Silent curve" },
  { data: "auto", label: "Balanced curve" },
  { data: "aggressive", label: "Aggressive curve" },
  { data: "manual", label: "Manual override" },
  { data: "off", label: "Off" },
];

const KNOWN_MODES = new Set(FALLBACK_MODES.map((entry) => entry.data));

export function FanControl({ config, setConfig }: {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config | null>>;
}) {
  const revision = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const busy = useRef(false);
  const [message, setMessage] = useState("");
  const state = config.fanControl;

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (busy.current) return;
      try {
        const next = await getFanControl();
        if (!cancelled && !busy.current) {
          setConfig((current) => (current ? { ...current, fanControl: next } : current));
        }
      } catch (error) {}
    };
    const poll = window.setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    };
  }, [setConfig]);

  if (!state?.supported) return null;
  const modeOptions = (state.modes && state.modes.length ? state.modes : FALLBACK_MODES);
  const mode = KNOWN_MODES.has(state.mode) ? state.mode : "auto";
  const minimum = state.minimumManualPercent || 20;
  const target = Math.max(minimum, Math.min(100, Math.round(state.targetPercent ?? state.percent ?? 40)));
  const telemetry = [
    state.percent !== null ? `${Math.round(state.percent)}%` : "speed unavailable",
    state.rpm !== null ? `${Math.round(state.rpm)} RPM` : "",
    state.name,
  ].filter(Boolean).join(" · ");

  const apply = (next: FanControlConfig, delay = 0) => {
    const request = ++revision.current;
    busy.current = true;
    setMessage(delay ? "Waiting to apply…" : "Applying…");
    setConfig((current) => current?.fanControl
      ? {
          ...current,
          fanControl: {
            ...current.fanControl,
            mode: next.mode,
            targetPercent: next.mode === "manual" ? next.targetPercent : current.fanControl.targetPercent,
          },
        }
      : current);
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    const commit = () => {
      timer.current = undefined;
      saveChain.current = saveChain.current.catch(() => {}).then(async () => {
        try {
          const saved = await saveFanControl(next);
          if (request === revision.current) {
            setConfig((current) => (current ? { ...current, fanControl: saved } : current));
            setMessage("Saved and applied");
          }
        } catch (error) {
          if (request === revision.current) setMessage(String(error));
        } finally {
          if (request === revision.current) busy.current = false;
        }
      });
    };
    if (delay) timer.current = window.setTimeout(commit, delay);
    else commit();
  };

  return (
    <PanelSection title="Fan control">
      <Hint
        label="Batocera qcom-fan"
        description="Same picker as Control Center (Home+A). Curve points are edited in the Fans tab."
      />
      <SelectEdit
        label="Mode"
        value={mode}
        options={modeOptions}
        disabled={!state.controllable}
        onChange={(nextMode) => apply({ mode: nextMode, targetPercent: target })}
      />
      {mode === "manual" ? (
        <>
          <SliderEdit
            label="Manual speed"
            value={target}
            min={minimum}
            max={100}
            step={5}
            format={(value) => `${Math.round(value)}%`}
            onChange={(targetPercent) => apply({ mode: "manual", targetPercent: Math.round(targetPercent) }, 200)}
          />
          <Hint
            label="Manual override active"
            description="Temperature curves resume when Silent, Balanced, or Aggressive is selected."
          />
        </>
      ) : null}
      <Field label="Current fan" description={telemetry} />
      {!state.controllable ? <Field label="Read only" description={state.reason} /> : null}
      {message ? <Field label="Last change" description={message} /> : null}
    </PanelSection>
  );
}
