import { DialogButton, Field, Navigation, PanelSection } from "@decky/ui";
import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { restartOledCare, saveOledCare } from "../backend";
import { openOledRefresher } from "../components/OledRefresherOverlay";
import { Hint, SliderEdit, ToggleRow } from "../components/widgets";
import { useOledRefresherActive } from "../lib/oledRefresher";
import { setOledScreensaverActive, useOledScreensaverActive } from "../lib/oledScreensaver";
import { updateOledIdleConfig } from "../lib/oledIdleWatch";
import type { Config, OledCareConfig } from "../types";

function formatSeconds(seconds: number) {
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
  const refresherActive = useOledRefresherActive();

  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
  }, []);

  const oled = config.oledCare;
  if (!oled?.supported && !oled?.panelDetected) {
    return (
      <PanelSection title="OLED Screen Protection">
        <Field
          label="Panel not detected"
          description={oled?.reason || "No OLED backlight sysfs node found on this device."}
        />
      </PanelSection>
    );
  }

  const cfg = oled?.config || {
    ENABLED: 0,
    DETECT: 1,
    STATIC_TIMEOUT: 30,
    REFRESHER: 1,
    REFRESHER_DURATION: 3,
    REFRESHER_PASSES: 3,
    SHIFTER: 1,
    SHIFTER_RADIUS: 1,
    SHIFTER_DURATION: 3,
    MURA: 0,
  };
  const runtime = oled?.runtime;

  const apply = (patch: Partial<OledCareConfig>, delay = 0) => {
    const next = { ...cfg, ...patch };
    if (patch.ENABLED !== undefined) {
      next.DETECT = patch.ENABLED ? 1 : 0;
    }
    const request = ++revision.current;
    setConfig((current) =>
      current && current.oledCare
        ? { ...current, oledCare: { ...current.oledCare, config: next } }
        : current,
    );
    updateOledIdleConfig(next);
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

  const onRefreshNow = async () => {
    openOledRefresher({
      durationSec: cfg.REFRESHER_DURATION,
      passes: cfg.REFRESHER_PASSES,
    });
  };

  return (
    <>
      <PanelSection title="OLED Screen Protection">
        <Hint
          label="Anti-image-retention"
          description={
            oled?.stockCli
              ? "Synced with EmulationStation via display.oledcare* in batocera.conf."
              : "Settings sync to batocera.conf; the host watcher ships in the next image."
          }
        />
        <ToggleRow
          label="OLED Screen Protection"
          description="Runs the pixel refresher after the idle timeout."
          value={cfg.ENABLED === 1}
          onChange={(enabled) => apply({ ENABLED: enabled ? 1 : 0 })}
        />
        {runtime && (
          <Field
            label="Status"
            children={`Watch ${runtime.serviceRunning ? "on" : "off"} · idle ${runtime.idleSeconds}s · ${runtime.phase || "idle"}`}
          />
        )}
      </PanelSection>

      {cfg.ENABLED === 1 && (
        <>
          <PanelSection title="Pixel refresher">
            <ToggleRow
              label="Pixel refresher"
              description="Fullscreen refresher after the idle timeout. Tap to exit."
              value={cfg.REFRESHER === 1}
              onChange={(v) => apply({ REFRESHER: v ? 1 : 0 })}
            />
            <SliderEdit
              label="Static screen timeout"
              value={cfg.STATIC_TIMEOUT}
              min={5}
              max={300}
              step={5}
              format={formatSeconds}
              onChange={(value) => apply({ STATIC_TIMEOUT: Math.round(Number(value)) }, 200)}
            />
            <SliderEdit
              label="Pass duration"
              value={cfg.REFRESHER_DURATION}
              min={1}
              max={10}
              step={1}
              format={(v) => `${Math.round(v)} s`}
              onChange={(value) => apply({ REFRESHER_DURATION: Math.round(Number(value)) }, 200)}
            />
            <SliderEdit
              label="Passes"
              value={cfg.REFRESHER_PASSES}
              min={1}
              max={6}
              step={1}
              format={(v) => `${Math.round(v)}`}
              onChange={(value) => apply({ REFRESHER_PASSES: Math.round(Number(value)) }, 200)}
            />
            <DialogButton onClick={onRefreshNow}>
              {refresherActive ? "Refresher running…" : "Run pixel refresher"}
            </DialogButton>
          </PanelSection>

          {oled?.stockCli ? (
            <PanelSection title="Service">
              <DialogButton onClick={onRestart}>Restart OLED Care watch</DialogButton>
            </PanelSection>
          ) : null}
        </>
      )}

      <PanelSection title="Steam screensaver">
        <Hint
          label="Mostly-black moving mark"
          description="Optional long-session helper inside Steam."
        />
        <ToggleRow
          label={screensaverActive ? "Screensaver active" : "Start screensaver"}
          description="Any button / touch exits."
          value={screensaverActive}
          onChange={(enabled) => {
            setOledScreensaverActive(enabled);
            if (enabled) Navigation.CloseSideMenus();
          }}
        />
      </PanelSection>
    </>
  );
}