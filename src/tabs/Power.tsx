import { toaster } from "@decky/api";
import { ButtonItem, Field, PanelSection } from "@decky/ui";
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { setCpuGovernor as applyCpuGovernor } from "../backend";
import { SelectEdit, SliderEdit } from "../components/widgets";
import { clone, titleCase, update } from "../lib/util";
import type { Config, PowerProfile } from "../types";
import { AdaptiveCpu } from "./AdaptiveCpu";
import { FanControl } from "./FanControl";

const underclocks = [
  { data: "none", label: "None" },
  { data: "small", label: "Small" },
  { data: "medium", label: "Medium" },
  { data: "large", label: "Large" },
];

export function Power({ config, setConfig }: { config: Config; setConfig: Dispatch<SetStateAction<Config | null>> }) {
  const [profile, setProfile] = useState(config.power.general.default_profile || "balanced");
  const profilesSupported = config.powerSupported && !!Object.keys(config.power.profiles || {}).length;
  const stockBackend = config.powerBackend === "stock";
  const p = config.power.profiles[profile] || ({} as PowerProfile);
  const profiles = Object.entries(config.power.profiles || {}).map(([name, entry]) => ({
    data: name,
    label: entry.label || titleCase(name),
  }));
  const fanCurves = Object.entries(config.power.fan_curves || {}).map(([name, curve]) => ({
    data: name,
    label: curve.label || titleCase(name),
  }));
  const governorOptions = (config.cpuGovernors || []).map((name) => ({ data: name, label: titleCase(name) }));
  const selectProfile = (name: any) => {
    const next = String(name);
    setProfile(next);
    setConfig((current) => (current ? update(current, ["power", "general", "default_profile"], next) : current));
  };
  const setProfileValue = (name: string, value: any) => {
    setConfig((current) => (current ? update(current, ["power", "profiles", profile, name], value) : current));
  };
  const setGpuValue = (name: string, value: any) => {
    setConfig((current) => {
      if (!current) return current;
      const next = clone(current);
      const target: any = next.power.profiles[profile];
      target[name] = value;
      if (name === "gpu_min" && Number(value) > Number(target.gpu_max || 0)) {
        target.gpu_max = value;
      }
      if (name === "gpu_max" && Number(value) < Number(target.gpu_min || 0)) {
        target.gpu_min = value;
      }
      return next;
    });
  };
  const resetProfile = () => {
    const defaults = config.powerDefaults?.profiles?.[profile];
    if (!defaults) return;
    setConfig((current) => (current ? update(current, ["power", "profiles", profile], defaults) : current));
  };
  const setCpuGovernor = async (value: string) => {
    const previous = config.cpuGovernor || "";
    setConfig((current) => (current ? { ...current, cpuGovernor: value } : current));
    try {
      const applied = await applyCpuGovernor(value);
      setConfig((current) => (current ? { ...current, cpuGovernor: applied } : current));
    } catch (error) {
      setConfig((current) => (current ? { ...current, cpuGovernor: previous } : current));
      toaster.toast({ title: "Could not change CPU governor", body: String(error) });
    }
  };
  const underclockLevel = p.cpu_underclock || "";
  const supportsUnderclockPresets = !!config.power.underclocks?.[config.cpuDeviceClass];
  return (
    <>
      {profilesSupported ? (
        <>
          <PanelSection title="EDIT POWER PROFILE">
            <SelectEdit value={profile} options={profiles} onChange={selectProfile} />
            {stockBackend ? (
              <Field
                label="Stock backend"
                description="Applies CPU governor + qcom-fan for the selected profile. CPU%/GPU% limits are kept for odin-power images and are not written to hardware here."
              />
            ) : null}
          </PanelSection>
          <PanelSection title="PROFILE SETTINGS">
            <SelectEdit label="Fan Curve" value={p.fan_curve} options={fanCurves} onChange={(v) => setProfileValue("fan_curve", v)} />
            {governorOptions.length ? (
              <SelectEdit
                label="CPU Governor"
                value={p.cpu_governor || config.cpuGovernor || governorOptions[0].data}
                options={governorOptions}
                onChange={(v) => setProfileValue("cpu_governor", v)}
              />
            ) : null}
            {!stockBackend && supportsUnderclockPresets ? (
              <SelectEdit label="CPU Underclock" value={underclockLevel} options={underclocks} onChange={(v) => setProfileValue("cpu_underclock", v)} />
            ) : null}
            {!stockBackend && !supportsUnderclockPresets ? (
              <SliderEdit label="CPU Max (%)" value={Math.round(Number(p.cpu_max || 0) * 100)} min={35} max={100} step={1} onChange={(v) => setProfileValue("cpu_max", (v / 100).toFixed(2))} />
            ) : null}
            {!stockBackend ? (
              <>
                <SliderEdit label="GPU Min (%)" value={Math.round(Number(p.gpu_min || 0) * 100)} min={0} max={100} step={1} onChange={(v) => setGpuValue("gpu_min", (v / 100).toFixed(2))} />
                <SliderEdit label="GPU Max (%)" value={Math.round(Number(p.gpu_max || 0) * 100)} min={35} max={100} step={1} onChange={(v) => setGpuValue("gpu_max", (v / 100).toFixed(2))} />
              </>
            ) : null}
            <div className="armada-reset-row">
              <ButtonItem layout="below" onClick={resetProfile}>Reset to Default</ButtonItem>
            </div>
          </PanelSection>
        </>
      ) : (
        <PanelSection title="Power profiles">
          <Field
            label="Unavailable on this image"
            description={
              config.powerReason
              || "Per-profile CPU/GPU/fan-curve editing needs odin-power or stock qcom-fan. Adaptive CPU and Fan controls below remain available."
            }
          />
        </PanelSection>
      )}
      {!profilesSupported && governorOptions.length ? (
        <PanelSection title="CPU governor">
          <SelectEdit
            label="Scaling governor"
            value={config.cpuGovernor || governorOptions[0].data}
            options={governorOptions}
            onChange={setCpuGovernor}
          />
          <Field label="Note" description="Applies immediately via sysfs. Rear-paddle Cycle power walks the same governors." />
        </PanelSection>
      ) : null}
      <AdaptiveCpu config={config} setConfig={setConfig} />
      <FanControl config={config} setConfig={setConfig} />
    </>
  );
}
