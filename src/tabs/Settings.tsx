import { toaster } from "@decky/api";
import { ButtonItem, Field, PanelSection } from "@decky/ui";
import type { Dispatch, SetStateAction } from "react";
import {
  setControllerType as applyControllerType,
  setSleepMode as applySleepMode,
  setSshEnabled as applySshEnabled,
} from "../backend";
import { openCalibration } from "../components/Calibration";
import { SelectEdit, ToggleRow } from "../components/widgets";
import type { Config } from "../types";

export function Settings({ config, setConfig }: {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config | null>>;
}) {
  const setSshEnabled = async (enabled: boolean) => {
    if (enabled === !!config.sshEnabled) {
      return;
    }
    setConfig((current) => (current ? { ...current, sshEnabled: enabled } : current));
    try {
      const applied = await applySshEnabled(enabled);
      setConfig((current) => (current ? { ...current, sshEnabled: applied } : current));
    } catch (error) {
      setConfig((current) => (current ? { ...current, sshEnabled: !enabled } : current));
    }
  };
  const setControllerType = async (value: string) => {
    const previous = config.controllerType || "deck-uhid";
    setConfig((current) => (current ? { ...current, controllerType: value } : current));
    try {
      const applied = await applyControllerType(value);
      setConfig((current) => (current ? { ...current, controllerType: applied } : current));
    } catch (error) {
      setConfig((current) => (current ? { ...current, controllerType: previous } : current));
    }
  };
  const setSleepMode = async (value: string) => {
    const previous = config.sleepMode || "";
    setConfig((current) => (current ? { ...current, sleepMode: value } : current));
    try {
      const applied = await applySleepMode(value);
      setConfig((current) => (current ? { ...current, sleepMode: applied } : current));
    } catch (error) {
      setConfig((current) => (current ? { ...current, sleepMode: previous } : current));
      toaster.toast({ title: "Could not change sleep mode", body: String(error) });
    }
  };
  const sleepModes = config.sleepModes || [];
  return (
    <>
      <PanelSection title="Controller">
        {config.controllerSupported ? (
          <SelectEdit
            label="Emulation"
            value={config.controllerType || "deck-uhid"}
            options={config.controllerTypes || []}
            onChange={setControllerType}
          />
        ) : (
          <Field label="Controller emulation" description="Managed by Batocera/evmapy on this image; Armada's InputPlumber selector is not installed." />
        )}
        <ButtonItem layout="below" onClick={openCalibration}>Launch Calibration</ButtonItem>
      </PanelSection>
      <PanelSection title="System">
        <ToggleRow label="Enable SSH" description="Persists Batocera's Dropbear service setting." value={!!config.sshEnabled} onChange={setSshEnabled} />
        {sleepModes.length > 1 ? (
          <SelectEdit
            label="Sleep Mode"
            value={config.sleepMode || sleepModes[0]?.data || ""}
            options={sleepModes}
            onChange={setSleepMode}
          />
        ) : null}
        <Field label="OS Version" description={config.osVersion || "unknown"} />
        {(config.warnings || []).map((warning) => <Field key={warning} label="Plugin warning" description={warning} />)}
      </PanelSection>
    </>
  );
}
