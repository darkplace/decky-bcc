import { Field, PanelSection } from "@decky/ui";
import { useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { saveBackPaddles } from "../backend";
import { SelectEdit } from "../components/widgets";
import type { BackPaddleBindings, Config } from "../types";

export function BackPaddles({ config, setConfig }: {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config | null>>;
}) {
  const revision = useRef(0);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const bp = config.backPaddles;
  if (!bp?.supported) {
    return <PanelSection title="Back paddles"><Field label="Unavailable" description={bp?.reason || "Rear-paddle input was not detected."} /></PanelSection>;
  }

  const bindings = bp.bindings;
  const slots = bp.slots || [];
  const actions = bp.actions || [];
  const health = bp.bindingHealth || {};
  const mouseModeAssigned = Object.values(bindings).includes("mouse_toggle");
  const backend = bp.source === "rsinput" ? "RSInput events + combos" : "Legacy GPIO + combos";
  const device = [bp.device?.name, bp.device?.path].filter(Boolean).join(" — ");
  const codeMap =
    bp.device?.m1Code != null && bp.device?.m2Code != null
      ? `M1 code ${bp.device.m1Code}, M2 code ${bp.device.m2Code}`
      : "";
  const activeHealth = Object.entries(bindings)
    .filter(([, action]) => action && action !== "none")
    .map(([slot, action]) => {
      const info = health[slot];
      if (!info) return `${slot}→${action}`;
      if (!info.available) return `${slot}→${action} unavailable`;
      return `${slot}→${info.backend}`;
    });

  const apply = (next: BackPaddleBindings) => {
    const request = ++revision.current;
    setConfig((current) => (current && current.backPaddles ? { ...current, backPaddles: { ...current.backPaddles, bindings: next } } : current));
    saveChain.current = saveChain.current.catch(() => {}).then(async () => {
      try {
        const state = await saveBackPaddles(next);
        if (request === revision.current) {
          setConfig((current) => (current ? { ...current, backPaddles: state } : current));
        }
      } catch (error) {
        console.error(error);
      }
    });
  };

  const update = (slot: keyof BackPaddleBindings, action: string) => {
    apply({ ...bindings, [slot]: action });
  };

  return (
    <>
      <PanelSection title="Back paddles (M1 / M2)">
        <Field
          label={backend}
          description={[device || "AYN rear-paddle input", codeMap].filter(Boolean).join(" · ")}
          children="Tap actions fire on release. Chords fire once while held. The listener observes without grabbing, so Steam, ES, and emulators still receive both paddles."
        />
        {bp.source === "rsinput" ? (
          <Field
            label="Batocera hotkeys coexist"
            description="Home/Hotkey + paddle is left to Batocera and suppresses the paddle tap action, preventing both mappings from firing together."
          />
        ) : null}
        {activeHealth.length ? (
          <Field label="Binding targets" description={activeHealth.join(" · ")} />
        ) : null}
      </PanelSection>
      <PanelSection title="Bindings">
        {bp.warning ? <Field label="Warning" description={bp.warning} /> : null}
        {mouseModeAssigned ? (
          <Field
            label="Mouse mode pauses gamepad navigation"
            description="Press the assigned paddle again to restore normal controls before changing or clearing its binding."
          />
        ) : null}
        {slots.map((slot) => (
          <SelectEdit
            key={slot.data}
            label={slot.label}
            value={bindings[slot.data as keyof BackPaddleBindings] || "none"}
            options={actions}
            onChange={(value) => update(slot.data as keyof BackPaddleBindings, value)}
          />
        ))}
      </PanelSection>
    </>
  );
}
