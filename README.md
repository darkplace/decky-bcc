# Batocera Control

Batocera-native Decky controls for ARM and x86 handhelds, derived from Armada Control.
This repository contains source, a prebuilt Decky frontend, the Python backend,
and a network-free installer suitable for Batocera Steam Tools.

## Why this fork exists

The former Odin 3 installer cloned Armada's moving `main` branch, overlaid an
older Batocera patch set, and ran npm on the handheld. That became
non-reproducible when upstream interfaces changed. It also allowed the plugin
to overwrite the battery LED policy and inject a Steam launch helper that did
not exist on Batocera.

Version 0.2.6 is pinned to the provenance recorded in `SOURCE.json`. It keeps
the system-owned status LED separate from the joystick rings and uses native
Batocera services for SSH and RSInput calibration.

### Rear paddles

On current Odin 3 images, the plugin discovers M1/M2 from the AYN `rsinput`
gamepad capabilities instead of opening GPIO lines directly. The Decky/FEX
backend reads those capabilities through architecture-neutral sysfs; the
native listener uses python-evdev, observes without grabbing, and reconnects
if the controller is recreated after resume. It therefore coexists with Steam,
ES, emulators, and Batocera's in-game Hotkey+paddle mappings. Older images with
the legacy `odin_backpaddles` GPIO service remain supported as a fallback.
Every tap and chord is unassigned on a fresh install. Actions are opt-in, and
the host Control Center option is labeled explicitly so it is not confused
with this Decky panel. Mouse mode temporarily replaces normal gamepad
navigation until its assigned paddle is pressed again.

### Handy Steam / Decky shortcuts (Odin)

These are the shortcuts that matter most once Batocera Control is installed
inside Steam GamepadUI. **Home** is the physical Guide / Mode button.

| Shortcut | Where | What it does |
|----------|--------|--------------|
| **⋯ (QAM) → Performance → Performance Overlay** | Steam GamepadUI | Native FPS / HUD level (Off / FPS / full). Needs Gamescope **MangoApp** running (enabled by default on ARM SteamOS sessions). |
| **M1 + M2** (default after you opt in) | Batocera Control → Back Paddles | `Toggle MangoHud` via `mangohudctl toggle no_display` (show/hide without changing the QAM preset). |
| **⋯ → Batocera Control** | Steam Quick Access | Plugin tabs: Compatibility, Power, LSFG, Paddles, Settings, … |
| **Compatibility → Re-apply to running game** | Plugin | Push nice / CPU affinity to the live SteamLaunch tree (Non-Steam titles match signed UI ids and unsigned `AppId=`). |
| **Power → eco / balanced / performance** | Plugin | Stock Qualcomm path: CPU governor + `qcom-fan` (Silent / Auto / Aggressive). |
| **Paddle → Cycle power** | Back Paddles | Walks the same stock profiles (or governors if profiles are absent). |
| **Settings → Sleep Mode** | Plugin | `s2idle` / `deep` when the kernel advertises both; restored at boot by `batocera_control_boot`. |

**MangoHud tip:** the overlay starts **hidden** (`no_display` in
`~/.local/share/Steam/config/mangohud.conf`). Use the QAM slider to pick a
preset, then **M1+M2** (or QAM again) to show/hide. If neither works, the
Steam session likely started without `--mangoapp` — restart Steam after an
image/script update that enables `BATOCERA_STEAM_GS_MANGOAPP` on ARM.

**LSFG tip:** place the purchased DLL at
`/userdata/system/wine/lossless-scaling/Lossless.dll`. Global mode needs a
Steam restart; per-game mode wraps launch options and applies on the next
game start. Non-Steam shortcuts use the **unsigned** AppID in the LSFG list
(same value SteamLaunch prints as `AppId=`).

## Install on Batocera

Extract a release and run as root:

```sh
bash install.sh
```

Decky's `PluginLoader` must already be installed (Steam Tools handles that
first). The installer verifies `PAYLOAD.sha256`, atomically replaces
`/userdata/system/homebrew/plugins/armada-control`, and never uses git, npm, or
the network. It will restart an idle Decky loader, but leaves a running
Steam/GamepadUI session untouched; the updated plugin loads the next time
SteamOS Mode starts. Use `--no-restart` when installing from an image migration
or another service.

The FEX launch helper is installed at
`/userdata/system/bin/batocera-control-game-launch`. It intentionally lives
outside `/userdata/system/scripts`, because Batocera executes every file in
that directory as a game hook. The helper and FEX contract remain in userdata
if the plugin is removed so existing Steam launch options cannot become dead.

### LSFG-VK tab

The unified LSFG tab configures Batocera's system LSFG-VK integration for
Steam. It detects the native and x64/Wine layer files already supplied by the
image and requires the purchased DLL at:

```text
/userdata/system/wine/lossless-scaling/Lossless.dll
```

It does not download or bundle LSFG-VK or Lossless Scaling. Global all-games
mode applies after Steam/GamepadUI restarts. Per-game mode adds a managed,
persistent wrapper only to the selected game's Steam launch options and takes
effect on its next game launch without restarting Steam. The installer moves
an old standalone `decky-lsfg-vk` plugin to `homebrew/disabled-plugins` so only
one control tab is loaded, while retaining its config and `~/lsfg` script for
rollback. Remove the old `~/lsfg` prefix from per-game Steam launch options
before using either Batocera activation mode.

### Batocera emulation settings

Batocera-managed ROM shortcuts get an **Emulation Settings** item in the
game's settings menu. It exposes the emulator, core, and applicable
`es_features.cfg` options for that ROM. Values are validated by the backend and
stored as the same per-game keys ES writes to `batocera.conf`; choosing
**Inherit** removes the override. Changes apply on the next game launch.

### Power, adaptive CPU/TDP, and fan control

The Power tab retains the per-profile CPU/GPU/fan-curve editor and also wraps
Batocera's native runtime controls. Qualcomm images use
`batocera-cpu-limit`, including its persistent global CPU ceiling and target
FPS. Zen3/x86 images automatically use `batocera-tdp-limit`, which adjusts
package power inside the hardware and user-selected TDP limits without taking
ownership of the normal TDP slider. Steam sessions read Gamescope statistics
while ES-launched emulators use the system's hidden FPS sampler. That sampler
is independent of Steam's visible MangoHud performance overlay.

On supported Qualcomm handhelds, the same tab exposes `qcom-fan` modes used by
Control Center (**Home+A**): **Silent**, **Balanced (auto)**, **Aggressive**,
**Manual** (20–100%), and **Off**. That picker only selects the runtime mode.
Curve *points* are edited in the **Fans** tab (ported from Armada PR #260 by
**Xtreme976**; see `CREDITS.md`) into `/userdata/system/configs/qcom-fan-curves.conf`. There is still
a single `qcom-fan` daemon. Fan +/- in Control Center is a manual override;
named curves resume when Silent / Auto / Aggressive is chosen again.

The editable eco/balanced/performance power-profile block uses `odin-power`
when that maintainer helper is present. On stock Qualcomm images it uses a
bundled factory config and applies **CPU governor + qcom-fan** only (no GPU
underclocks). Without either backend, Adaptive CPU and fan controls remain.
Paddle "Cycle power" walks stock profiles when available, otherwise CPU
governors.

Compatibility can set per-game or default **nice** and **CPU affinity**, applied
by the launch helper on the next start, with an optional live Re-apply.
Sleep Mode chosen in Settings is restored at boot by `batocera_control_boot`.

Rear-paddle shortcuts call stock Batocera binaries where possible
(`mangohudctl`, `qcom-fan`, `batocera-brightness`, uinput). Maintainer-only
userdata scripts are never required for those actions.

Compatibility lists regular Steam apps and Non-Steam `shortcuts.vdf` titles,
and can edit environment variables that the launch helper injects on the next
game start. Settings exposes Sleep Mode when the kernel advertises more than
one `/sys/power/mem_sleep` option.

### OLED care and screensaver

On a detected OLED panel, **OLED Screen Protection** runs the pixel refresher
after an idle timeout inside Steam GamepadUI. Options sync through
`display.oledcare*` in `batocera.conf` (same keys EmulationStation uses when
the image ships `batocera-oled-care`).

A mostly-black moving screensaver remains available as a manual Steam helper.
It keeps Steam and downloads running and exits on the first button, key, or
touch.

On x86 handhelds, the x64/Wine layer is sufficient. Compatibility-tool,
resolution, LED, and LSFG controls remain available, while the ARM-only FEX
controls are disabled. Existing Batocera AMD TDP/SimpleDeckyTDP controls remain
the source of the manual ceiling; adaptive TDP only moves below that ceiling
during a game session and restores the prior value when stopped.

## Develop and verify

```sh
npm ci
npm run build
npx tsc --noEmit
python3 -m unittest discover -s tests -v
npm audit
```

`dist/index.js` is committed deliberately. A Batocera target installs the
prebuilt output and does not need Node.js.

Create deterministic release archives with:

```sh
tools/make-release.sh
```

## Batocera integration

The plugin is distributed independently from the Batocera image:

1. A version tag builds and tests the frontend in GitHub Actions.
2. The workflow publishes versioned `.tar.gz` and `.zip` files plus
   `SHA256SUMS` in the GitHub release.
3. Steam Tools installs/updates Decky, downloads this artifact, verifies its
   hash, and runs `install.sh`.

The `swy8750` main branch and 8550 branch only need the release URL/update logic
in Steam Tools. No Node.js build, branch clone, or plugin Buildroot package is
needed on the target. The release is architecture-independent; hardware tabs
feature-detect the services and sysfs interfaces provided by each image.

## Persistence and removal

Plugin settings live under `/userdata/system/configs/batocera-control` (OLED
care retains its existing dedicated config directory). `uninstall.sh` removes
the Decky plugin but keeps settings and both fail-open game/LSFG launch helpers.
This is deliberate: removing a helper still referenced by Steam launch options
would make games fail to start.

## Credits

- **Xtreme976** — Fan curve editor (Fans tab), from
  [armada-os/armada#260](https://github.com/armada-os/armada/pull/260), adapted
  to Batocera `qcom-fan`. Details in `CREDITS.md`.
- Armada Control: <https://github.com/virtudude/armada>
- Decky LSFG-VK UI reference: <https://github.com/xXJSONDeruloXx/decky-lsfg-vk>
- LSFG-VK system layer: <https://github.com/PancakeTAS/lsfg-vk>

## License and provenance

GPL-2.0-or-later. See `LICENSE.md`, `THIRD_PARTY_NOTICES.md`, and `SOURCE.json`.

Batocera handheld images live in
<https://github.com/darkplace/batocera.pocket> (this plugin is not a
continuation of the retired `batocera-odin3-patches` / community-patches tree).
