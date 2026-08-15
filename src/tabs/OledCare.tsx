import { DialogButton, Field, Navigation, PanelSection } from "@decky/ui";
import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { restartOledCare, saveOledCare } from "../backend";
import { SliderEdit, ToggleRow } from "../components/widgets";
import { setOledScreensaverActive, useOledScreensaverActive } from "../lib/oledScreensaver";
import type { Config, OledCareConfig } from "../types";

function formatMinutes(seconds: number) {
  if (seconds >= 60) {
    const mins = Math.round(seconds / 60);
    return `${mins} min`;
  }
  return `${seconds} s`;
}

export function OledCare({ config, setConfig }: {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config | null>>;
}) {
  const revision = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const screensaverActive = useOledScreensaverActive();
  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
  }, []);
  const oled = config.oledCare;
  const screensaverPanel = oled?.panelDetected ? (
    <PanelSection title="OLED screensaver">
      <Field
        label="Mostly-black moving display"
        description="Keeps Steam and downloads running while replacing static UI with a dim, slowly moving mark. It does not suspend the system or change saved brightness."
      />
      <ToggleRow
        label={screensaverActive ? "Screensaver active" : "Start screensaver"}
        description="Press any controller button, keyboard key, or touch the screen to exit."
        value={screensaverActive}
        onChange={(enabled) => {
          setOledScreensaverActive(enabled);
          if (enabled) Navigation.CloseSideMenus();
        }}
      />
    </PanelSection>
  ) : null;
  if (!oled?.supported) {
    return (
      <>
        <PanelSection title="OLED care">
          <Field
            label="Idle dim deferred"
            description={
              oled?.reason
              || "Automatic idle dimming is planned for a future stock-native release. Use the screensaver below for burn-in mitigation in Steam."
            }
          />
        </PanelSection>
        {screensaverPanel}
      </>
    );
  }

  const cfg = oled.config;
  const runtime = oled.runtime;

  const apply = (patch: Partial<OledCareConfig>, delay = 0) => {
    const next = { ...cfg, ...patch };
    const request = ++revision.current;
    setConfig((current) =>
      current && current.oledCare
        ? { ...current, oledCare: { ...current.oledCare, config: next } }
        : current,
    );
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    const commit = () => {
      timer.current = undefined;
      saveChain.current = saveChain.current.catch(() => {}).then(async () => {
        try {
          const state = await saveOledCare(next);
          if (request === revision.current) {
            setConfig((current) => (current ? { ...current, oledCare: state } : current));
          }
        } catch (error) {
          console.error(error);
        }
      });
    };
    if (delay > 0) timer.current = window.setTimeout(commit, delay);
    else commit();
  };

  const onRestart = async () => {
    try {
      const state = await restartOledCare();
      setConfig((current) => (current ? { ...current, oledCare: state } : current));
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <>
      <PanelSection title="OLED care">
        <Field
          label="Burn-in protection"
          children="Caps brightness and dims the panel after idle time. Pixel refresh is disabled."
        />
        <ToggleRow
          label="Enabled"
          value={cfg.ENABLED === 1}
          onChange={(enabled) => apply({ ENABLED: enabled ? 1 : 0 })}
        />
        {runtime && (
          <Field
            label="Status"
            children={`Service ${runtime.serviceRunning ? "running" : "stopped"} · idle ${runtime.idleSeconds}s · brightness ${runtime.brightnessPct ?? "?"}%`}
          />
        )}
      </PanelSection>

      {screensaverPanel}

      {cfg.ENABLED === 1 && (
        <>
          <PanelSection title="Brightness">
            <SliderEdit
              label="Normal"
              value={cfg.BRIGHTNESS_NORMAL}
              min={10}
              max={100}
              step={1}
              format={(value) => `${Math.round(value)}%`}
              onChange={(value) => apply({ BRIGHTNESS_NORMAL: Math.round(Number(value)) }, 200)}
            />
            <SliderEdit
              label="Idle dim"
              value={cfg.BRIGHTNESS_IDLE}
              min={5}
              max={80}
              step={1}
              format={(value) => `${Math.round(value)}%`}
              onChange={(value) => apply({ BRIGHTNESS_IDLE: Math.round(Number(value)) }, 200)}
            />
          </PanelSection>

          <PanelSection title="Idle timing">
            <SliderEdit
              label="Dim after"
              value={cfg.IDLE_DIM_SECONDS}
              min={30}
              max={1800}
              step={30}
              format={formatMinutes}
              onChange={(value) => apply({ IDLE_DIM_SECONDS: Math.round(Number(value)) }, 200)}
            />
          </PanelSection>

          <PanelSection title="Actions">
            <DialogButton onClick={onRestart}>Restart OLED service</DialogButton>
          </PanelSection>
        </>
      )}
    </>
  );
}
