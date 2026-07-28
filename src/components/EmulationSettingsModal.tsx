import {
  DialogBody,
  DialogButton,
  DialogFooter,
  DialogHeader,
  DropdownItem,
  Field,
  ModalRoot,
  PanelSection,
  PanelSectionRow,
  SliderField,
  TextField,
  ToggleField,
} from "@decky/ui";
import { useEffect, useState } from "react";
import { getEmulationState, setEmulationGameSetting } from "../backend";
import type { EmulationChoice, EmulationFeature, EmulationState } from "../types";

const INHERIT = "__batocera_inherit__";

function inheritedLabel(feature: EmulationFeature): string {
  const value = feature.inheritedValue;
  if (value === null || value === undefined || value === "") return "Inherit (Auto)";
  const choice = feature.choices?.find((item) => item.data === value);
  return `Inherit (${choice?.label || value})`;
}

function SelectFeature({
  feature,
  disabled,
  onChange,
}: {
  feature: EmulationFeature;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const choices: EmulationChoice[] = [
    { data: INHERIT, label: inheritedLabel(feature) },
    ...(feature.choices || []),
  ];
  return (
    <PanelSectionRow>
      <DropdownItem
        label={feature.label}
        description={feature.description}
        disabled={disabled}
        selectedOption={feature.directValue === null ? INHERIT : feature.directValue}
        rgOptions={choices}
        onChange={(option) => onChange(option.data === INHERIT ? null : String(option.data))}
      />
    </PanelSectionRow>
  );
}

function SliderFeature({
  feature,
  disabled,
  onChange,
}: {
  feature: EmulationFeature;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const minimum = Number(feature.minimum ?? 0);
  const maximum = Number(feature.maximum ?? 100);
  const step = Number(feature.step ?? 1);
  const inherited = Number(feature.inheritedValue);
  const direct = Number(feature.directValue);
  const value = Number.isFinite(direct)
    ? direct
    : Number.isFinite(inherited)
      ? inherited
      : minimum;
  const overridden = feature.directValue !== null;
  return (
    <>
      <PanelSectionRow>
        <ToggleField
          label={feature.label}
          description={`${feature.description}${feature.description ? " " : ""}${inheritedLabel(feature)}.`}
          checked={overridden}
          disabled={disabled}
          onChange={(enabled) => onChange(enabled ? String(value) : null)}
        />
      </PanelSectionRow>
      {overridden ? (
        <PanelSectionRow>
          <SliderField
            label="Per-game value"
            value={value}
            min={minimum}
            max={maximum}
            step={step}
            valueSuffix={feature.suffix || ""}
            showValue
            disabled={disabled}
            onChange={(next) => onChange(String(next))}
          />
        </PanelSectionRow>
      ) : null}
    </>
  );
}

function TextFeature({
  feature,
  disabled,
  onChange,
}: {
  feature: EmulationFeature;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const [text, setText] = useState(feature.directValue ?? feature.inheritedValue ?? "");
  useEffect(() => {
    setText(feature.directValue ?? feature.inheritedValue ?? "");
  }, [feature.directValue, feature.inheritedValue, feature.setting]);
  const overridden = feature.directValue !== null;
  return (
    <>
      <PanelSectionRow>
        <ToggleField
          label={feature.label}
          description={`${feature.description}${feature.description ? " " : ""}${inheritedLabel(feature)}.`}
          checked={overridden}
          disabled={disabled}
          onChange={(enabled) => onChange(enabled ? text : null)}
        />
      </PanelSectionRow>
      {overridden ? (
        <PanelSectionRow>
          <Field label="Per-game value" childrenLayout="below">
            <TextField
              value={text}
              disabled={disabled}
              onChange={(event) => setText(event.currentTarget.value)}
              onBlur={() => {
                if (text !== feature.directValue) onChange(text);
              }}
            />
          </Field>
        </PanelSectionRow>
      ) : null}
    </>
  );
}

export function EmulationSettingsModal({
  appid,
  closeModal,
}: {
  appid: string;
  closeModal?: () => void;
}) {
  const [state, setState] = useState<EmulationState | null>(null);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getEmulationState(appid)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [appid]);

  const save = async (setting: string, value: string | null) => {
    setSaving(setting);
    setError("");
    try {
      setState(await setEmulationGameSetting(appid, setting, value));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving("");
    }
  };

  const featureControl = (feature: EmulationFeature) => {
    const props = {
      key: feature.setting,
      feature,
      disabled: !!saving,
      onChange: (value: string | null) => void save(feature.setting, value),
    };
    if (feature.kind === "slider") return <SliderFeature {...props} />;
    if (feature.kind === "text") return <TextFeature {...props} />;
    return <SelectFeature {...props} />;
  };

  return (
    <ModalRoot onCancel={closeModal}>
      <DialogHeader>Emulation Settings</DialogHeader>
      <DialogBody>
        <div
          style={{
            boxSizing: "border-box",
            width: "min(640px, calc(100vw - 160px))",
            maxWidth: "100%",
            maxHeight: "calc(100vh - 260px)",
            minHeight: "160px",
            overflowX: "hidden",
            overflowY: "auto",
            paddingRight: "8px",
          }}
        >
          {!state && !error ? <Field label="Loading Batocera settings…" /> : null}
          {state && !state.supported ? <Field label={state.reason || "This shortcut is not managed by Batocera."} /> : null}
          {error ? <Field label="Could not save setting" description={error} /> : null}
          {state?.supported && state.emulator && state.core ? (
            <>
            <Field
              label={`${state.name} — ${state.systemName}`}
              description="Per-game Batocera settings. Inherit removes the game override; changes apply on the next launch."
            />
            <PanelSection title="Emulator">
              <SelectFeature
                feature={state.emulator}
                disabled={!!saving}
                onChange={(value) => void save("emulator", value)}
              />
              <SelectFeature
                feature={state.core}
                disabled={!!saving}
                onChange={(value) => void save("core", value)}
              />
            </PanelSection>
            {(state.groups || []).map((group) => (
              <PanelSection key={group.name} title={group.name}>
                {group.features.map(featureControl)}
              </PanelSection>
            ))}
            </>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogButton onClick={closeModal}>Close</DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}
