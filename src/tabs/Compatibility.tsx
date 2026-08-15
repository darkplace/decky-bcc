import {
  ButtonItem,
  DialogBody,
  DialogButton,
  DialogFooter,
  Field,
  Focusable,
  ModalRoot,
  PanelSection,
  TextField,
  ToggleField,
  showModal,
} from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toaster } from "@decky/api";
import { reapplyPerf, saveCompatApplied } from "../backend";
import { SelectEdit, SliderEdit } from "../components/widgets";
import { getGlobalResolution, setGlobalResolution } from "../lib/steamSettings";
import { clone } from "../lib/util";
import { availableGames, editTargetOptions } from "../lib/games";
import {
  DEFAULT_WINDOWS_COMPAT_TOOL,
  FOLLOW_STEAM_COMPAT,
  USE_DEFAULT_COMPAT,
  compatSelection,
  getAppCompatTools,
  getProtonTools,
  handledGameAppids,
  markCompatHandled,
  migrateWindowsCompatTool,
  resetCompatToolToDefault,
  resetAllCompatTools,
  resolveCompatState,
  resolveGameAppids,
  setAutoApplyCompat,
  setWindowsCompatTool,
  specifyCompatTool,
} from "../lib/steamCompat";
import type { CompatTool } from "../lib/steamCompat";
import type { Config } from "../types";

const resolutionOptions = [
  { data: "Default", label: "Default" },
  { data: "Native", label: "Native" },
  { data: "1280x720", label: "1280x720" },
  { data: "960x540", label: "960x540" },
];
const fexKnobs = [
  { key: "TSOEnabled", label: "TSO Enabled" },
  { key: "X87ReducedPrecision", label: "X87 Reduced Precision" },
  { key: "Multiblock", label: "Multiblock" },
  { key: "VectorTSOEnabled", label: "Vector TSO Enabled" },
  { key: "MemcpySetTSOEnabled", label: "Memcpy Set TSO Enabled" },
  { key: "HalfBarrierTSOEnabled", label: "Half Barrier TSO Enabled" },
];
const thunkModules = [
  { module: "Vulkan", label: "Host Vulkan" },
  { module: "GL", label: "Host OpenGL" },
  { module: "EGL", label: "Host EGL" },
  { module: "asound", label: "Host ALSA" },
  { module: "drm", label: "Host DRM" },
  { module: "WaylandClient", label: "Host Wayland" },
];
const corePresetOptions = [
  { data: "", label: "System default" },
  { data: "all", label: "All CPUs" },
  { data: "custom", label: "Custom cpulist" },
];

function ConfirmResetAllModal({ closeModal, onConfirm }: { closeModal?: () => void; onConfirm: () => void }) {
  const confirm = () => {
    closeModal?.();
    onConfirm();
  };
  return (
    <ModalRoot onCancel={closeModal}>
      <DialogBody>
        This removes all per-game Armada settings, resets resolution overrides, applies the default Proton where Steam selects Proton, and leaves native Linux selections with Steam.
      </DialogBody>
      <DialogFooter>
        <DialogButton onClick={confirm}>Reset All Games</DialogButton>
        <DialogButton onClick={closeModal}>Cancel</DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}

function EnvVarModal({
  closeModal,
  initialKey,
  initialValue,
  onSave,
  onDelete,
}: {
  closeModal?: () => void;
  initialKey: string;
  initialValue: string;
  onSave: (key: string, value: string) => void;
  onDelete?: () => void;
}) {
  const [key, setKey] = useState(initialKey);
  const [value, setValue] = useState(initialValue);
  const [nameError, setNameError] = useState("");
  const save = () => {
    const name = key.trim();
    if (!name || name.includes("=") || name.includes("\0")) {
      setNameError("Invalid name: must be non-empty, no '='");
      return;
    }
    onSave(name, value);
    closeModal?.();
  };
  return (
    <ModalRoot onCancel={closeModal}>
      <DialogBody>
        <TextField label="Name" value={key} onChange={(event) => setKey(event.target.value)} />
        {nameError ? <Field description={nameError} /> : null}
        <TextField label="Value" value={value} onChange={(event) => setValue(event.target.value)} />
      </DialogBody>
      <DialogFooter>
        <Focusable style={{ display: "flex", flexDirection: "row", gap: "8px", width: "100%" }}>
          <DialogButton onClick={save}>Save</DialogButton>
          {onDelete ? (
            <DialogButton
              onClick={() => {
                onDelete();
                closeModal?.();
              }}
            >
              Delete
            </DialogButton>
          ) : null}
          <DialogButton onClick={closeModal}>Cancel</DialogButton>
        </Focusable>
      </DialogFooter>
    </ModalRoot>
  );
}

export function Compatibility({ config, setConfig }: { config: Config; setConfig: Dispatch<SetStateAction<Config | null>> }) {
  const [resolution, setResolution] = useState("Default");
  const [defaultResolution, setDefaultResolution] = useState(getGlobalResolution());
  const [resolutionMessage, setResolutionMessage] = useState("");
  const [resettingAll, setResettingAll] = useState(false);
  const [customSelected, setCustomSelected] = useState(false);
  const [showThunks, setShowThunks] = useState(false);
  const [showEnv, setShowEnv] = useState(false);
  const [showPerf, setShowPerf] = useState(false);
  const [reapplying, setReapplying] = useState(false);
  const [customCores, setCustomCores] = useState("");
  const [compatTools, setCompatTools] = useState<CompatTool[]>([]);
  const [perGameTools, setPerGameTools] = useState<CompatTool[]>([]);
  const [currentTool, setCurrentTool] = useState("");
  const [globalTool, setGlobalTool] = useState(
    String(config.tweaks?.global?.windowsCompatTool || DEFAULT_WINDOWS_COMPAT_TOOL),
  );
  const runtimeGame = config.game;
  const games = availableGames(config);
  const selectedGame = config.selectedGame || runtimeGame || null;
  const game = selectedGame;
  const selectedAppidRef = useRef("");
  selectedAppidRef.current = game?.appid || "";
  const tweaks = config.tweaks;
  const apps = window.SteamClient?.Apps;
  const persistHandledGames = () => saveCompatApplied(handledGameAppids()).catch(() => {});
  useEffect(() => {
    let cancelled = false;
    async function loadResolution() {
      if (!game?.appid || !apps?.GetResolutionOverrideForApp) {
        setResolution("Default");
        setResolutionMessage("");
        return;
      }
      try {
        const current = await apps.GetResolutionOverrideForApp(Number(game.appid));
        if (!cancelled) {
          setResolution(current || "Default");
          setResolutionMessage("");
        }
      } catch (error) {
        if (!cancelled) setResolutionMessage("Resolution override is unavailable");
      }
    }
    loadResolution();
    return () => {
      cancelled = true;
    };
  }, [apps, game?.appid]);
  useEffect(() => {
    setCustomSelected(false);
  }, [game?.appid]);
  useEffect(() => {
    let cancelled = false;
    getProtonTools().then((tools) => {
      if (!cancelled) setCompatTools(tools);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!game?.appid) {
      setCurrentTool("");
      setPerGameTools([]);
      return;
    }
    const appid = game.appid;
    let cancelled = false;
    setCurrentTool(FOLLOW_STEAM_COMPAT);
    resolveCompatState(appid).then((state) => {
      if (!cancelled) setCurrentTool(compatSelection(state));
    });
    getAppCompatTools(appid).then((tools) => {
      if (!cancelled) setPerGameTools(tools);
    });
    return () => {
      cancelled = true;
    };
  }, [game?.appid]);
  useEffect(() => {
    if (!apps?.RegisterForAppOverviewChanges) return;
    let cancelled = false;
    let timer: number | undefined;
    const handle = apps.RegisterForAppOverviewChanges(() => {
      const appid = selectedAppidRef.current;
      if (!appid || cancelled) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        resolveCompatState(appid).then((state) => {
          if (!cancelled && selectedAppidRef.current === appid) setCurrentTool(compatSelection(state));
        }).catch(() => {});
      }, 250);
    });
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      try {
        handle?.unregister?.();
      } catch (error) {
      }
    };
  }, [apps]);
  useEffect(() => {
    setDefaultResolution(getGlobalResolution());
  }, []);
  const gameSettings = game?.appid ? tweaks.games[game.appid] || {} : {};
  const editingDefault = !game?.appid;
  const values = editingDefault ? tweaks.global : { ...tweaks.global, ...gameSettings };
  const patchSettings = (patch: Record<string, any>) => {
    setConfig((current) => {
      if (!current) return current;
      const next = clone(current);
      if (editingDefault) {
        Object.assign(next.tweaks.global, patch);
      } else if (game?.appid) {
        const existing = next.tweaks.games[game.appid] || {};
        next.tweaks.games[game.appid] = { ...existing, name: game.name || "", ...patch };
      }
      return next;
    });
  };
  const resetGame = async () => {
    if (!game?.appid) return;
    const appid = game.appid;
    setConfig((current) => {
      if (!current) return current;
      const next = clone(current);
      delete next.tweaks.games[appid];
      return next;
    });
    try {
      const tool = await resetCompatToolToDefault(appid);
      setCurrentTool(tool === globalTool ? USE_DEFAULT_COMPAT : tool || FOLLOW_STEAM_COMPAT);
      persistHandledGames();
    } catch (error) {
    }
    if (apps?.SetAppResolutionOverride) {
      try {
        await apps.SetAppResolutionOverride(Number(appid), "Default");
        setResolution("Default");
        setResolutionMessage("");
      } catch (error) {
      }
    }
  };
  const setSteamResolution = async (value: string) => {
    setResolution(value);
    if (!game?.appid || !apps?.SetAppResolutionOverride) return;
    try {
      await apps.SetAppResolutionOverride(Number(game.appid), value);
      setResolutionMessage("");
    } catch (error) {
      setResolutionMessage("Failed to set resolution override");
    }
  };
  const setSteamDefaultResolution = async (value: string) => {
    setDefaultResolution(value);
    try {
      const applied = await setGlobalResolution(value);
      setResolutionMessage("");
      setDefaultResolution(applied || "Default");
    } catch (error) {
      setResolutionMessage("Failed to set default resolution");
    }
  };
  const resetAllGames = async () => {
    if (resettingAll) return;
    setResettingAll(true);
    setConfig((current) => {
      if (!current) return current;
      const next = clone(current);
      next.tweaks.games = {};
      return next;
    });
    try {
      const gameAppids = await resolveGameAppids(games.map((installed) => installed.appid));
      let nextResolution = 0;
      const resetResolution = async () => {
        while (nextResolution < gameAppids.length) {
          const appid = gameAppids[nextResolution++];
          if (!apps?.SetAppResolutionOverride) continue;
          try {
            await apps.SetAppResolutionOverride(Number(appid), "Default");
          } catch (error) {
          }
        }
      };
      await Promise.all([
        resetAllCompatTools(gameAppids),
        Promise.all(Array.from({ length: Math.min(10, gameAppids.length) }, resetResolution)),
      ]);
      await saveCompatApplied(handledGameAppids());
      setResolution("Default");
      if (game?.appid) setCurrentTool(compatSelection(await resolveCompatState(game.appid)));
    } catch (error) {
    } finally {
      setResettingAll(false);
    }
  };
  const confirmResetAllGames = () => {
    showModal(<ConfirmResetAllModal onConfirm={() => { void resetAllGames(); }} />);
  };
  const gameOptions = editTargetOptions(config);
  // "" is the explicit Default target, not "nothing selected"; store a sentinel
  // so it doesn't fall back to the running game in the selectedGame derivation.
  const setSelectedGame = (appid: any) => {
    const id = String(appid);
    if (!id) {
      setConfig((current) => (current ? { ...current, selectedGame: { appid: "", name: "Default" } } : current));
      return;
    }
    const saved = games.find((candidate) => candidate.appid === id);
    setConfig((current) => (current ? { ...current, selectedGame: saved || null } : current));
  };

  const toolOptions = compatTools.map((tool) => ({ data: tool.id, label: tool.label }));
  const onSelectGlobalDefault = async (choice: any) => {
    const name = String(choice);
    const oldTool = String(tweaks.global.windowsCompatTool || DEFAULT_WINDOWS_COMPAT_TOOL);
    setGlobalTool(name);
    setWindowsCompatTool(name);
    patchSettings({ windowsCompatTool: name });
    await migrateWindowsCompatTool(
      config.installedGames.filter((installed) => !installed.nonSteam).map((installed) => installed.appid),
      oldTool,
      name,
    );
    persistHandledGames();
  };
  const selectableTools = new Map<string, CompatTool>();
  for (const tool of [...perGameTools, ...compatTools]) selectableTools.set(tool.id, tool);
  if (currentTool && currentTool !== USE_DEFAULT_COMPAT && currentTool !== FOLLOW_STEAM_COMPAT && !selectableTools.has(currentTool)) {
    selectableTools.set(currentTool, { id: currentTool, label: currentTool });
  }
  const perGameToolOptions = [
    { data: USE_DEFAULT_COMPAT, label: "Use Default" },
    { data: FOLLOW_STEAM_COMPAT, label: "Follow Steam" },
    ...Array.from(selectableTools.values()).map((tool) => ({ data: tool.id, label: tool.label })),
  ];
  const onSelectPerGameTool = async (choice: any) => {
    if (!game?.appid) return;
    const selection = String(choice);
    const target = selection === USE_DEFAULT_COMPAT
      ? globalTool
      : selection === FOLLOW_STEAM_COMPAT
        ? ""
        : selection;
    try {
      await specifyCompatTool(game.appid, target);
      markCompatHandled(game.appid);
      persistHandledGames();
      setCurrentTool(selection);
    } catch (error) {
    }
  };

  const presets = config.fexProfiles || {};
  const presetEntries = Object.entries(presets);
  const storedProfile = values.fexProfile as string | undefined;
  const storedConfig = values.fexConfig as Record<string, string> | undefined;
  const ownConfig = (editingDefault ? tweaks.global.fexConfig : gameSettings.fexConfig) as Record<string, string> | undefined;
  const hasPreset = !!(storedProfile && presets[storedProfile]);
  const isCustom = customSelected || (!hasPreset && !!storedConfig);
  const fexValue = isCustom ? "custom" : hasPreset ? storedProfile! : "default";
  const fexConfig: Record<string, string> = (isCustom ? storedConfig : presets[fexValue]?.config) || presets.default?.config || {};
  const fexOptions = [...presetEntries.map(([id, profile]) => ({ data: id, label: profile.label })), { data: "custom", label: "Custom" }];
  const onSelectFex = (id: any) => {
    if (id === "custom") {
      setCustomSelected(true);
      // First Custom for this target seeds from the Default preset; afterwards the
      // stored config is kept, including across visits to a preset.
      patchSettings({ fexProfile: "custom", fexConfig: { ...(ownConfig || presets.default?.config || {}) } });
      return;
    }
    setCustomSelected(false);
    patchSettings({ fexProfile: id });
  };
  const setKnob = (key: string, on: boolean) => patchSettings({ fexProfile: "custom", fexConfig: { ...fexConfig, [key]: on ? "1" : "0" } });
  const thunks: Record<string, boolean> = values.thunks || {};
  const setThunk = (module: string, on: boolean) => patchSettings({ thunks: { ...thunks, [module]: on } });

  // env merges per-entry; unchecking a default var stores a null tombstone
  const ownEnv = ((editingDefault ? tweaks.global.env : gameSettings.env) || {}) as Record<string, string | null>;
  const globalEnv = ((!editingDefault && tweaks.global.env) || {}) as Record<string, string>;
  const patchOwnEnv = (mutate: (next: Record<string, string | null>) => void) => {
    const next = { ...ownEnv };
    mutate(next);
    patchSettings({ env: Object.keys(next).length ? next : undefined });
  };
  const saveEnvVar = (oldKey: string | null, key: string, value: string) => {
    patchOwnEnv((next) => {
      if (oldKey && oldKey !== key) delete next[oldKey];
      next[key] = value;
    });
  };
  const deleteEnvVar = (key: string) => {
    patchOwnEnv((next) => {
      delete next[key];
    });
  };
  const openEnvVar = (key: string | null) => {
    showModal(
      <EnvVarModal
        initialKey={key || ""}
        initialValue={key ? String(ownEnv[key] ?? "") : ""}
        onSave={(nextKey, nextValue) => saveEnvVar(key, nextKey, nextValue)}
        onDelete={key ? () => deleteEnvVar(key) : undefined}
      />,
    );
  };
  const inheritedEnvEntries = Object.entries(globalEnv).filter(([key]) => typeof ownEnv[key] !== "string");
  const ownEnvEntries = Object.entries(ownEnv).filter(([, value]) => typeof value === "string") as [string, string][];
  const envControls = (
    <>
      {inheritedEnvEntries.length ? <div className="armada-subheader">Default Variables</div> : null}
      {inheritedEnvEntries.map(([key, value]) => (
        <ToggleField
          key={key}
          label={String(value) ? `${key}=${String(value)}` : key}
          checked={ownEnv[key] !== null}
          onChange={(on) => patchOwnEnv((next) => {
            if (on) delete next[key];
            else next[key] = null;
          })}
        />
      ))}
      {inheritedEnvEntries.length ? <div className="armada-subheader">Per-Game Variables</div> : null}
      {ownEnvEntries.map(([key, value]) => (
        <ButtonItem key={key} layout="below" onClick={() => openEnvVar(key)}>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
            {value ? `${key}=${value}` : key}
          </div>
        </ButtonItem>
      ))}
      <ButtonItem layout="below" onClick={() => openEnvVar(null)}>
        + Add Variable
      </ButtonItem>
      <Field label="Applies on next launch" description="Variables are injected by batocera-control-game-launch before the game starts." />
    </>
  );

  const niceEnabled = typeof values.nice === "number";
  const niceValue = niceEnabled ? Number(values.nice) : 0;
  const storedCores = values.cores;
  const coresPreset =
    storedCores === undefined || storedCores === null || storedCores === ""
      ? ""
      : storedCores === "all"
        ? "all"
        : "custom";
  useEffect(() => {
    if (coresPreset === "custom" && typeof storedCores === "string" && storedCores !== "all") {
      setCustomCores(storedCores);
    } else if (coresPreset !== "custom") {
      setCustomCores("");
    }
  }, [game?.appid, coresPreset, typeof storedCores === "string" ? storedCores : ""]);
  const setNiceEnabled = (on: boolean) => {
    if (on) patchSettings({ nice: 0 });
    else patchSettings({ nice: undefined });
  };
  const setCoresPreset = (choice: any) => {
    const next = String(choice);
    if (next === "") patchSettings({ cores: undefined });
    else if (next === "all") patchSettings({ cores: "all" });
    else patchSettings({ cores: customCores || "0" });
  };
  const onReapply = async () => {
    if (reapplying) return;
    setReapplying(true);
    try {
      const result = await reapplyPerf(game?.appid || null);
      toaster.toast({
        title: "Performance re-applied",
        body: `Touched ${result.pids} thread(s) on pid ${result.pid}`,
      });
    } catch (error) {
      toaster.toast({ title: "Could not re-apply", body: String(error) });
    } finally {
      setReapplying(false);
    }
  };
  const perfControls = (
    <>
      <ToggleField label="Override nice" checked={niceEnabled} onChange={setNiceEnabled} />
      {niceEnabled ? (
        <SliderEdit
          label="Nice"
          value={niceValue}
          min={-20}
          max={19}
          step={1}
          format={(value) => String(Math.round(value))}
          onChange={(value) => patchSettings({ nice: Math.round(value) })}
        />
      ) : null}
      <SelectEdit label="CPU affinity" value={coresPreset} options={corePresetOptions} onChange={setCoresPreset} />
      {coresPreset === "custom" ? (
        <TextField
          label="cpulist"
          value={customCores}
          onChange={(event) => {
            const next = event.target.value;
            setCustomCores(next);
            patchSettings({ cores: next.trim() || undefined });
          }}
        />
      ) : null}
      <Field
        label="Applies on next launch"
        description="batocera-control-game-launch sets nice/affinity fail-open before exec. Re-apply can update a live SteamLaunch tree."
      />
      <ButtonItem layout="below" disabled={reapplying} onClick={() => { void onReapply(); }}>
        {reapplying ? "Re-applying..." : "Re-apply to running game"}
      </ButtonItem>
    </>
  );

  return (
    <>
      <PanelSection title="EDIT GAME PROFILE">
        <SelectEdit value={game?.appid || ""} options={gameOptions} onChange={setSelectedGame} />
        <div className="armada-compat-note">Compatibility changes apply on next launch</div>
      </PanelSection>
      <PanelSection title="PROFILE SETTINGS">
        {editingDefault ? (
          <>
            <SelectEdit labelBelow label="Default Proton" value={globalTool} options={toolOptions} onChange={onSelectGlobalDefault} />
            <ToggleField
              label="Apply to New Games"
              checked={tweaks.global.autoApplyCompat !== false}
              onChange={(enabled) => {
                setAutoApplyCompat(enabled);
                patchSettings({ autoApplyCompat: enabled });
              }}
            />
            <SelectEdit label="Game Resolution" value={defaultResolution} options={resolutionOptions} onChange={setSteamDefaultResolution} />
          </>
        ) : (
          <>
            <SelectEdit labelBelow label="Compatibility Tool" value={currentTool} options={perGameToolOptions} onChange={onSelectPerGameTool} />
            <SelectEdit label="Game Resolution" value={resolution} options={resolutionOptions} onChange={setSteamResolution} />
          </>
        )}
        {resolutionMessage ? <Field label="Status" description={resolutionMessage} /> : null}
        {config.fexRuntimeSupported ? (
          <SelectEdit label="FEX Preset" value={fexValue} options={fexOptions} onChange={onSelectFex} />
        ) : (
          <Field label="FEX presets unavailable" description={config.fexRuntimeReason || "The persistent Batocera launch helper could not be installed."} />
        )}
        {config.fexRuntimeSupported && isCustom
          ? fexKnobs.map((knob) => (
              <ToggleField key={knob.key} label={knob.label} checked={fexConfig[knob.key] === "1"} onChange={(value) => setKnob(knob.key, value)} />
            ))
          : null}
      </PanelSection>
      <PanelSection title="ADVANCED">
          {config.fexRuntimeSupported ? (
            <>
              <ButtonItem layout="below" onClick={() => setShowThunks((value) => !value)}>
                {showThunks ? "Hide Host Thunks" : "Host Thunks"}
              </ButtonItem>
              {showThunks
                ? thunkModules.map((thunk) => (
                    <ToggleField key={thunk.module} label={thunk.label} checked={thunks[thunk.module] !== false} onChange={(value) => setThunk(thunk.module, value)} />
                  ))
                : null}
            </>
          ) : null}
          <ButtonItem layout="below" onClick={() => setShowEnv((value) => !value)}>
            {showEnv ? "Hide Environment" : "Environment"}
          </ButtonItem>
          {showEnv ? <div className="armada-advanced-group">{envControls}</div> : null}
          <ButtonItem layout="below" onClick={() => setShowPerf((value) => !value)}>
            {showPerf ? "Hide Performance" : "Performance"}
          </ButtonItem>
          {showPerf ? <div className="armada-advanced-group">{perfControls}</div> : null}
        </PanelSection>
      {!editingDefault ? (
        <PanelSection>
          <ButtonItem layout="below" onClick={resetGame}>
            Reset to Default
          </ButtonItem>
        </PanelSection>
      ) : (
        <PanelSection>
          <ButtonItem layout="below" disabled={resettingAll} onClick={confirmResetAllGames}>
            {resettingAll ? "Resetting..." : "Reset All Games"}
          </ButtonItem>
        </PanelSection>
      )}
    </>
  );
}
