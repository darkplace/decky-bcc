import { Dropdown, DropdownItemInternal, Field, PanelSectionRow, SliderField, ToggleField } from "@decky/ui";
import type { ReactNode } from "react";
import type { DropdownChoice } from "../types";
import { useUiCompact } from "../lib/uiMode";

type Option = string | DropdownChoice;

// Explanatory helper text. Hidden in the default serious/compact layout and
// shown again when the user reverts to detailed descriptions.
export function Hint({ label, description, children }: {
  label?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  const compact = useUiCompact();
  if (compact) return null;
  return <Field label={label} description={description}>{children}</Field>;
}

export function SelectEdit({ label, value, options, onChange, labelBelow, disabled, wrapperClassName }: {
  label?: ReactNode;
  value: any;
  options: Option[];
  onChange: (data: any) => void;
  labelBelow?: boolean;
  disabled?: boolean;
  wrapperClassName?: string;
}) {
  const rgOptions = options.map((option) => (typeof option === "string" ? { data: option, label: option } : option));
  // QAM is ~316px. A long field label *or* a long selected value next to the
  // dropdown gets squeezed into a vertical column of letters / overlaps.
  const selected = rgOptions.find((option) => option.data === value);
  const selectedText = typeof selected?.label === "string" ? selected.label : "";
  const stacked =
    !!labelBelow
    || (typeof label === "string" && label.length >= 16)
    || selectedText.length >= 18;
  const dropdown = label === undefined ? (
    <Dropdown disabled={disabled} selectedOption={value} rgOptions={rgOptions} onChange={(option) => onChange(option.data)} />
  ) : stacked ? (
    <Field label={label} childrenLayout="below" childrenContainerWidth="max" disabled={disabled}>
      <Dropdown disabled={disabled} selectedOption={value} rgOptions={rgOptions} onChange={(option) => onChange(option.data)} />
    </Field>
  ) : (
    <DropdownItemInternal disabled={disabled} childrenContainerWidth="max" label={label} selectedOption={value} rgOptions={rgOptions} onChange={(option) => onChange(option.data)} />
  );
  return (
    <PanelSectionRow>
      {wrapperClassName ? <div className={wrapperClassName}>{dropdown}</div> : dropdown}
    </PanelSectionRow>
  );
}

export function ToggleRow({ label, value, onChange, disabled, description, wrapperClassName }: {
  label: ReactNode;
  value: any;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  description?: ReactNode;
  wrapperClassName?: string;
}) {
  const field = <ToggleField label={label} description={description} checked={!!value} disabled={disabled} onChange={onChange} />;
  return (
    <PanelSectionRow>
      {wrapperClassName ? <div className={wrapperClassName}>{field}</div> : field}
    </PanelSectionRow>
  );
}

export function SliderEdit({ label, value, min, max, step, onChange, format, disabled, wrapperClassName = "armada-slider-field" }: {
  label: ReactNode;
  value: any;
  min: number;
  max: number;
  step: number;
  onChange: (value: any) => void;
  format?: (value: number) => any;
  disabled?: boolean;
  wrapperClassName?: string;
}) {
  const numeric = Number(value);
  const suffix = format && Number.isFinite(numeric) ? ` (${format(numeric)})` : "";
  return (
    <PanelSectionRow>
      <div className={wrapperClassName}>
        <SliderField
          label={`${label}${suffix}`}
          value={Number.isFinite(numeric) ? numeric : min}
          min={min}
          max={max}
          step={step}
          showValue
          disabled={disabled}
          onChange={(next) => onChange(next)}
        />
      </div>
    </PanelSectionRow>
  );
}
