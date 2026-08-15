#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT INT TERM

mkdir -p "$TEST_ROOT/system/homebrew/services"
printf '#!/bin/sh\nexit 0\n' > "$TEST_ROOT/system/homebrew/services/PluginLoader"
chmod 0755 "$TEST_ROOT/system/homebrew/services/PluginLoader"
mkdir -p "$TEST_ROOT/system/homebrew/plugins/decky-lsfg-vk"
printf '{"name":"legacy"}\n' > "$TEST_ROOT/system/homebrew/plugins/decky-lsfg-vk/plugin.json"

BATOCERA_USERDATA="$TEST_ROOT" bash "$ROOT/install.sh" --no-restart
test -s "$TEST_ROOT/system/homebrew/plugins/armada-control/dist/index.js"
test -s "$TEST_ROOT/system/homebrew/plugins/armada-control/PAYLOAD.sha256"
(
    cd "$TEST_ROOT/system/homebrew/plugins/armada-control"
    sha256sum -c PAYLOAD.sha256 >/dev/null
)
test -x "$TEST_ROOT/system/bin/batocera-control-game-launch"
test -x "$TEST_ROOT/system/bin/batocera-control-lsfg-launch"
test -x "$TEST_ROOT/system/services/batocera_control_paddles"
test -x "$TEST_ROOT/system/services/batocera_control_boot"
test -s "$TEST_ROOT/system/configs/batocera-control/fex-profiles.json"
test -s "$TEST_ROOT/system/configs/batocera-control/power-profiles.factory.conf"
test "$(cat "$TEST_ROOT/system/homebrew/plugins/armada-control/VERSION")" = "$(cat "$ROOT/VERSION")"
test ! -e "$TEST_ROOT/system/homebrew/plugins/decky-lsfg-vk"
test -f "$TEST_ROOT/system/homebrew/disabled-plugins/decky-lsfg-vk-merged/plugin.json"

# A second install exercises atomic replacement and the previous-version backup.
mkdir -p "$TEST_ROOT/system/homebrew/plugins/.armada-control.previous"
printf '{"name":"legacy backup"}\n' > "$TEST_ROOT/system/homebrew/plugins/.armada-control.previous/plugin.json"
BATOCERA_USERDATA="$TEST_ROOT" bash "$ROOT/install.sh" --no-restart
test ! -e "$TEST_ROOT/system/homebrew/plugins/.armada-control.previous"
test -d "$TEST_ROOT/system/homebrew/disabled-plugins/armada-control-previous"

BATOCERA_USERDATA="$TEST_ROOT" bash "$ROOT/uninstall.sh"
test ! -e "$TEST_ROOT/system/homebrew/plugins/armada-control"
test ! -e "$TEST_ROOT/system/homebrew/disabled-plugins/armada-control-previous"
test ! -e "$TEST_ROOT/system/services/batocera_control_paddles"
test ! -e "$TEST_ROOT/system/services/batocera_control_boot"
test -x "$TEST_ROOT/system/bin/batocera-control-game-launch"
test -x "$TEST_ROOT/system/bin/batocera-control-lsfg-launch"

echo "Installer smoke test passed"
