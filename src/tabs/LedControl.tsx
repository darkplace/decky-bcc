import { Field, PanelSection } from "@decky/ui";
import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { saveJoystickLed } from "../backend";
import { Hint, SelectEdit, SliderEdit } from "../components/widgets";
import type { Config, JoystickLedConfig, JoystickLedSide } from "../types";

const DEFAULT_BRIGHTNESS = 70;
const MIN_ACTIVE_BRIGHTNESS = 1;

const COLOR_OPTIONS = [
  { data: "red", label: "Red" },
  { data: "green", label: "Green" },
  { data: "blue", label: "Blue" },
  { data: "cyan", label: "Cyan" },
  { data: "magenta", label: "Magenta" },
  { data: "yellow", label: "Yellow" },
  { data: "orange", label: "Orange" },
  { data: "purple", label: "Purple" },
  { data: "white", label: "White" },
];

function presetForColor(hex: string, presets: Record<string, string>) {
  const entry = Object.entries(presets).find(([, value]) => value.toLowerCase() === hex.toLowerCase());
  return entry?.[0] || "blue";
}

export function LedControl({ config, setConfig }: {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config | null>>;
}) {
  const revision = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
  }, []);
  const led = config.joystickLed?.config;
  const presets = config.joystickLedPresets || {};
  const modes = config.joystickLedModes || [];
  if (!config.joystickLed?.supported || !led) {
    return <PanelSection title="Joystick LEDs">Not supported on this device.</PanelSection>;
  }

  const side = led.left;
  const isOff = side.mode === "off";

  const apply = (next: JoystickLedConfig, delay = 0) => {
    const unified: JoystickLedConfig = {
      linked: true,
      left: next.left,
      right: { ...next.left },
    };
    const request = ++revision.current;
    setConfig((current) => (current ? { ...current, joystickLed: { ...current.joystickLed!, config: unified } } : current));
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    const commit = () => {
      timer.current = undefined;
      saveChain.current = saveChain.current.catch(() => {}).then(async () => {
        try {
          const state = await saveJoystickLed(unified);
          if (request === revision.current) {
            setConfig((current) => (current ? { ...current, joystickLed: state } : current));
          }
        } catch (error) {
          console.error(error);
        }
      });
    };
    if (delay > 0) timer.current = window.setTimeout(commit, delay);
    else commit();
  };

  const update = (patch: Partial<JoystickLedSide>) => {
    apply({ linked: true, left: { ...side, ...patch }, right: { ...side, ...patch } });
  };

  const onModeChange = (mode: string) => {
    if (mode === "off") {
      update({ mode });
      return;
    }
    const brightness = side.brightness < MIN_ACTIVE_BRIGHTNESS ? DEFAULT_BRIGHTNESS : side.brightness;
    update({ mode, brightness });
  };

  return (
    <>
      <PanelSection title="Joystick LEDs">
        <Hint
          label="Batocera service"
          children="Uses batocera-led-handheld (same as EmulationStation). Both rings share color and mode."
        />
      </PanelSection>
      <PanelSection title="L/R rings">
        <SelectEdit label="Mode" value={side.mode} options={modes} onChange={onModeChange} />
        <SelectEdit
          label="Color"
          value={presetForColor(side.color, presets)}
          options={COLOR_OPTIONS}
          onChange={(preset) => update({ color: presets[preset] || side.color })}
        />
        {isOff ? (
          <Field label="Brightness" children="Off — pick another mode to turn LEDs on." />
        ) : (
          <SliderEdit
            label="Brightness"
            value={Math.max(MIN_ACTIVE_BRIGHTNESS, side.brightness)}
            min={MIN_ACTIVE_BRIGHTNESS}
            max={100}
            step={1}
            format={(value) => `${Math.round(value)}%`}
            onChange={(brightness) => {
              const next = Math.max(MIN_ACTIVE_BRIGHTNESS, Number(brightness));
              apply({ linked: true, left: { ...side, brightness: next }, right: { ...side, brightness: next } }, 150);
            }}
          />
        )}
      </PanelSection>
    </>
  );
}
