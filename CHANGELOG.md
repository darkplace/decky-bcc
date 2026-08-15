# Changelog

## 0.2.15 - 2026-08-15

- List Non-Steam / `shortcuts.vdf` titles in Compatibility (binary VDF parser).
- Add Environment variable editor (global + per-game, with inherit/tombstone)
  and apply those variables from `batocera-control-game-launch` on next launch.
- Expose stock CPU governor control on the Power tab when `odin-power` profiles
  are absent; persist governor choice via sysfs.
- Add Sleep Mode (s2idle/deep) to Settings when `/sys/power/mem_sleep` advertises
  more than one mode.

## 0.2.14 - 2026-08-15

- Drive paddle MangoHud toggle through stock `mangohudctl toggle no_display`
  (Shift_R+F12 uinput fallback) instead of a userdata Python helper.
- Inject paddle keyboard/mouse taps only via uinput; drop the
  `odin-key-send.py` userdata fallback.
- Cycle power from paddles through `odin-power` when present, otherwise through
  sysfs CPU governors on stock images.
- Surface paddle binding health (resolved backend/command) in plugin state and
  filter unavailable actions from the binding dropdown.
- Clarify Power-tab messaging when `odin-power` profiles are absent; Adaptive
  CPU and `qcom-fan` remain available.
- Document the full `qcom-fan` Silent/Auto/Aggressive/Manual/Off mode set.
- Defer OLED idle-dim (legacy userdata `odin-oled-care`) for a future
  stock-native implementation; keep the manual OLED screensaver.

## 0.2.13 - 2026-08-15

- Align Qualcomm fan controls with current `qcom-fan`: expose **Silent**,
  **Balanced (auto)**, **Aggressive**, **Manual**, and **Off** instead of
  collapsing every non-manual mode to Automatic.
- Cycle rear-paddle fan actions through the same `qcom-fan` curves when the
  helper is present; keep the older `odin-power` PWM cycle only as a fallback
  for maintainer userdata layouts.
- Skip power-profile paddle cycling when `/userdata/system/scripts/odin-power`
  is missing so stock images do not no-op with a hard-coded path error.

## 0.2.12 - 2026-07-28

- Add an **Emulation Settings** item to the GamepadUI settings menu for
  Batocera-managed ROM shortcuts, exposing validated per-game emulator, core,
  and applicable `es_features.cfg` options with configgen-compatible
  inheritance.
- Remove a per-game key when **Inherit** is selected, using the same
  `batocera.conf` locking and atomic-write protections as the rest of the
  plugin.
- Keep the emulation dialog within GamepadUI's available viewport and refresh
  the managed AppID set as ES adds or removes Steam shortcuts.
- Verify the fully staged plugin payload before installation and defer Decky
  reloads while Steam/GamepadUI is active, avoiding a mid-session webhelper
  disruption.
- Override the stale Rollup helper transitive dependencies with compatible
  audit-clean releases used only by the build pipeline.

## 0.2.11 - 2026-07-14

- Make every named joystick-ring color an exact RGB preset, so red writes
  `255 0 0` instead of the pink-tinted `255 32 32`, and migrate only the old
  softened preset values while preserving user-defined colors.

## 0.2.10 - 2026-07-14

- Leave every rear-paddle tap and chord unassigned on fresh installs instead
  of silently launching the host Batocera Control Center or toggling MangoHud.
- Migrate the exact unversioned 0.2.8/0.2.9 default preset to the safe,
  unassigned configuration without overwriting versioned user choices.
- Label the optional Control Center action as the Batocera host app so it is
  not confused with this Decky plugin.

## 0.2.9 - 2026-07-14

- Add Batocera's native thermal/adaptive CPU limiter to the Power tab, with
  persistent cap and target-FPS settings plus live FPS, temperature, fan, and
  data-source status. Keep its hidden FPS sampler distinct from the visible
  Steam MangoHud overlay.
- Feature-detect the Zen3/x86 `batocera-tdp-limit` sibling and expose adaptive
  package power without replacing the normal TDP ceiling; explicitly restore
  the pre-session TDP when the adaptive mode is switched off.
- Add feature-detected Qualcomm fan controls using the same `qcom-fan auto`
  and manual-speed paths as Batocera Control Center outside Steam.
- Add a mostly-black moving OLED screensaver for detected Odin OLED panels;
  it leaves Steam/downloads running and exits on controller, keyboard, or
  touch input without changing brightness or suspend state.
- Stage plugin upgrades outside Decky's active plugin directory so its hot
  loader cannot discover a half-copied temporary plugin during installation.

## 0.2.8 - 2026-07-14

- Stop assigning mouse mode to M2 by default; the old preset could replace
  Steam gamepad navigation as soon as the right paddle was pressed.
- Safely migrate the exact unversioned 0.2.6/0.2.7 preset, version future
  binding saves, and warn how to exit mouse mode when it is explicitly chosen.

## 0.2.7 - 2026-07-14

- Detect AYN rsinput paddle capabilities through sysfs in Decky's x86/FEX
  backend, while retaining native python-evdev for the persistent ARM listener.
  This prevents a working Odin 3 listener from being mislabeled as an
  unavailable legacy GPIO backend in the Steam panel.

## 0.2.6 - 2026-07-14

- Detect Odin 3 rear paddles from the current `rsinput` event capabilities
  (`BTN_TRIGGER_HAPPY7`/`BTN_TRIGGER_HAPPY5`) instead of requiring the retired
  direct-GPIO interface, without hard-coding an `eventN` number.
- Add a persistent, non-grabbing paddle listener with hotplug/resume recovery,
  tap and combo actions, and coexistence with Batocera's Hotkey+paddle mappings.
- Retain the legacy GPIO backend for older images and label M1/left and M2/right
  explicitly in the Decky UI.

## 0.2.5 - 2026-07-12

- Add per-game LSFG-VK activation that preserves existing Steam launch options,
  coexists with the FEX wrapper, and applies on the next game launch without a
  Steam restart; retain the optional global all-games mode with clearer text.
- Install the LSFG helper at a stable userdata path and keep it fail-open when
  its layer, DLL, or validated app allowlist is unavailable.
- Serialize and batch every Batocera setting write made by the plugin, repair
  only known NUL/orphan-brightness race damage, back up corrupt input, validate
  after writes, and restore the prior config if the system writer fails.
- Prevent simultaneous LED, OLED-care, paddle, and LSFG writes from corrupting
  `batocera.conf` while retaining Batocera's independent battery/status LED.

## 0.2.4 - 2026-07-12

- Remove the legacy hidden rollback directory left by pre-0.2.3 installs while
  preserving the current previous-version backup outside Decky's active path.

## 0.2.3 - 2026-07-12

- Keep the previous plugin version in `homebrew/disabled-plugins` instead of a
  hidden directory under Decky's active plugin path, preventing any chance of
  the rollback copy being loaded as a second plugin.

## 0.2.2 - 2026-07-12

- Distinguish an x86 AMD handheld from ARM images that happen to include the
  generic AMD TDP utility, and suppress irrelevant power-profile warnings when
  a platform-specific power backend is unavailable.

## 0.2.1 - 2026-07-12

- Support the x64-only Batocera LSFG-VK layer used by x86 handhelds while
  continuing to require the user's purchased `Lossless.dll`.
- Keep Proton, resolution, LED, and LSFG controls available on x86, but never
  offer or auto-inject the ARM-only FEX launch wrapper there.
- Detect Batocera's native AMD TDP stack and direct x86 users to the installed
  SimpleDeckyTDP controls instead of reporting a missing Odin service.

## 0.2.0 - 2026-07-12

- Prevent joystick LED controls and paddle shortcuts from changing the
  independent battery/status power LED or replacing `leds.conf`.
- Preserve the last joystick-ring brightness across Off/On and serialize UI
  saves to prevent stale slider requests winning races.
- Use Batocera's Dropbear service and persistent SSH setting instead of a
  nonexistent systemd `sshd` unit.
- Save controller calibration in Batocera's native RSInput key/value format,
  apply it live, validate full-range captures, and work without InputPlumber.
- Hide unsupported Armada controller emulation and unavailable power, OLED,
  and paddle services instead of reporting false success.
- Validate paddle bindings, repair Wi-Fi/Bluetooth toggles, and tolerate a
  corrupt saved brightness value.
- Restore the latest upstream compatibility-state RPC integration that the old
  Batocera overlay omitted.
- Install a persistent, fail-open Batocera FEX launch helper before adding it
  to Steam launch options; migrate the old nonexistent Armada helper path.
- Use atomic, durable writes for persistent plugin settings.
- Add bounded privileged-socket responses, per-subsystem config fallbacks,
  source provenance, tests, and reproducible release tooling.
- Merge LSFG-VK controls into a feature-detected tab that configures
  Batocera's built-in native/x64 layers and the standard user-provided
  `/userdata/system/wine/lossless-scaling/Lossless.dll`, without downloading a
  second LSFG runtime.
