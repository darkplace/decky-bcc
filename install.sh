#!/bin/bash
set -euo pipefail
export TZ=UTC

ROOT="$(cd "$(dirname "$0")" && pwd)"
USERDATA="${BATOCERA_USERDATA:-/userdata}"
TARGET_PARENT="${USERDATA}/system/homebrew/plugins"
TARGET="${TARGET_PARENT}/armada-control"
DISABLED_PARENT="${USERDATA}/system/homebrew/disabled-plugins"
STAGE="${USERDATA}/system/homebrew/.armada-control.new.$$"
BACKUP="${DISABLED_PARENT}/armada-control-previous"
LEGACY_BACKUP="${TARGET_PARENT}/.armada-control.previous"
LOCK="${USERDATA}/system/logs/batocera-control-install.lock"
LOG="${USERDATA}/system/logs/batocera-control-install.log"
PLUGIN_LOADER="${USERDATA}/system/homebrew/services/PluginLoader"
NO_RESTART=0

if [ "${1:-}" = "--no-restart" ]; then
    NO_RESTART=1
elif [ -n "${1:-}" ]; then
    echo "Usage: $0 [--no-restart]" >&2
    exit 2
fi

for required in plugin.json main.py dist/index.js py_modules/armada_control/config.py \
    py_modules/batocera-control-game-launch py_modules/batocera-control-lsfg-launch \
    py_modules/batocera-control-paddles-service py_modules/batocera-control-boot-service \
    py_modules/fex-profiles.json py_modules/power-profiles.factory.conf \
    PAYLOAD.sha256; do
    if [ ! -f "${ROOT}/${required}" ]; then
        echo "Batocera Control payload is incomplete: missing ${required}" >&2
        exit 1
    fi
done
if [ ! -s "${ROOT}/dist/index.js" ]; then
    echo "Batocera Control payload is incomplete: dist/index.js is empty" >&2
    exit 1
fi

if [ ! -x "$PLUGIN_LOADER" ]; then
    echo "Decky PluginLoader is not installed; install Decky from Steam Tools first" >&2
    exit 1
fi

mkdir -p "$(dirname "$LOCK")" "$(dirname "$LOG")" "$TARGET_PARENT" "$DISABLED_PARENT"
if ! mkdir "$LOCK" 2>/dev/null; then
    echo "Another Batocera Control install is already running" >&2
    exit 1
fi
cleanup() {
    rm -rf "$STAGE"
    rmdir "$LOCK" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

exec > >(tee -a "$LOG") 2>&1
echo "=== Batocera Control $(cat "${ROOT}/VERSION") install $(date -Iseconds) ==="

(
    cd "$ROOT"
    sha256sum -c PAYLOAD.sha256
)

mkdir -p "$STAGE"
cp -a "${ROOT}/dist" "${ROOT}/py_modules" "$STAGE/"
cp -a "${ROOT}/main.py" "${ROOT}/plugin.json" "${ROOT}/package.json" \
    "${ROOT}/VERSION" "${ROOT}/SOURCE.json" "${ROOT}/LICENSE.md" \
    "${ROOT}/THIRD_PARTY_NOTICES.md" "${ROOT}/PAYLOAD.sha256" "$STAGE/"
find "$STAGE" -type d -exec chmod 0755 {} +
find "$STAGE" -type f -exec chmod 0644 {} +
chmod 0755 "$STAGE/py_modules/batocera-control-game-launch" \
    "$STAGE/py_modules/batocera-control-lsfg-launch" \
    "$STAGE/py_modules/batocera-control-paddles-service" \
    "$STAGE/py_modules/batocera-control-boot-service"

# Verify the exact staged tree, not only the source archive. A truncated Decky
# frontend can leave GamepadUI unusable even though the Python backend starts.
(
    cd "$STAGE"
    sha256sum -c PAYLOAD.sha256
)
sync

# Install this before enabling the frontend policy. It stays behind on uninstall
# so launch options already stored by Steam always reference a valid executable.
install -D -m 0755 "${ROOT}/py_modules/batocera-control-game-launch" \
    "${USERDATA}/system/bin/batocera-control-game-launch"
install -D -m 0755 "${ROOT}/py_modules/batocera-control-lsfg-launch" \
    "${USERDATA}/system/bin/batocera-control-lsfg-launch"
install -D -m 0644 "${ROOT}/py_modules/fex-profiles.json" \
    "${USERDATA}/system/configs/batocera-control/fex-profiles.json"
if [ ! -f "${USERDATA}/system/configs/batocera-control/power-profiles.factory.conf" ]; then
    install -D -m 0644 "${ROOT}/py_modules/power-profiles.factory.conf" \
        "${USERDATA}/system/configs/batocera-control/power-profiles.factory.conf"
fi

rm -rf "$BACKUP" "$LEGACY_BACKUP"
if [ -e "$TARGET" ]; then
    mv "$TARGET" "$BACKUP"
fi
if ! mv "$STAGE" "$TARGET"; then
    rm -rf "$TARGET"
    if [ -e "$BACKUP" ]; then
        mv "$BACKUP" "$TARGET"
    fi
    echo "Plugin replacement failed; previous version restored" >&2
    exit 1
fi
sync

echo "Installed Batocera Control $(cat "${TARGET}/VERSION")"

BOOT_SERVICE_NAME="batocera_control_boot"
BOOT_SERVICE="${USERDATA}/system/services/${BOOT_SERVICE_NAME}"
install -D -m 0755 "${ROOT}/py_modules/batocera-control-boot-service" \
    "${BOOT_SERVICE}"
if command -v batocera-services >/dev/null 2>&1; then
    batocera-services enable "${BOOT_SERVICE_NAME}" >/dev/null 2>&1 || true
fi
# Apply sleep + power once at install time as well as on next boot.
"${BOOT_SERVICE}" start >/dev/null 2>&1 || true

PADDLE_SERVICE_NAME="batocera_control_paddles"
PADDLE_SERVICE="${USERDATA}/system/services/${PADDLE_SERVICE_NAME}"
install -D -m 0755 "${ROOT}/py_modules/batocera-control-paddles-service" \
    "${PADDLE_SERVICE}"

# The current rsinput driver owns the Odin 3 paddle GPIOs and publishes them as
# normal gamepad events. Prefer the non-grabbing event listener and retire the
# old direct-GPIO reader only when that exact capability set is present.
if PYTHONPATH="${TARGET}/py_modules" python3 -m armada_control.paddle_daemon --probe >/dev/null 2>&1; then
    if command -v batocera-services >/dev/null 2>&1; then
        batocera-services disable odin_backpaddles >/dev/null 2>&1 || true
        batocera-services enable "${PADDLE_SERVICE_NAME}" >/dev/null 2>&1 || true
    fi
    if test -s /var/run/odin-backpaddles.pid; then
        kill "$(cat /var/run/odin-backpaddles.pid)" >/dev/null 2>&1 || true
        rm -f /var/run/odin-backpaddles.pid
    fi
    pkill -f "[/]userdata/system/scripts/odin-backpaddles.py" >/dev/null 2>&1 || true
    "${PADDLE_SERVICE}" restart
    echo "Enabled rsinput rear-paddle listener"
else
    "${PADDLE_SERVICE}" stop >/dev/null 2>&1 || true
    if command -v batocera-services >/dev/null 2>&1; then
        batocera-services disable "${PADDLE_SERVICE_NAME}" >/dev/null 2>&1 || true
    fi
fi

LEGACY_LSFG="${TARGET_PARENT}/decky-lsfg-vk"
DISABLED_LSFG="${DISABLED_PARENT}/decky-lsfg-vk-merged"
if [ -e "$LEGACY_LSFG" ]; then
    mkdir -p "$(dirname "$DISABLED_LSFG")"
    rm -rf "$DISABLED_LSFG"
    mv "$LEGACY_LSFG" "$DISABLED_LSFG"
    echo "Moved standalone Decky LSFG-VK plugin to ${DISABLED_LSFG}"
fi

if [ "$NO_RESTART" -eq 0 ] && pgrep -f "[/]${PLUGIN_LOADER#/}" >/dev/null 2>&1; then
    if pgrep -x steam >/dev/null 2>&1 ||
        pgrep -x steamwebhelper >/dev/null 2>&1 ||
        pgrep -x gamescope >/dev/null 2>&1; then
        echo "Decky update staged; PluginLoader will reload on the next SteamOS Mode session"
    else
        pkill -f "[/]${PLUGIN_LOADER#/}" 2>/dev/null || true
        sleep 1
        HOME="${USERDATA}/system" \
        XDG_DATA_HOME="${USERDATA}/system/.local/share" \
        XDG_CONFIG_HOME="${USERDATA}/system/.config" \
        XDG_CACHE_HOME="${USERDATA}/system/.cache" \
        DECKY_HOME="${USERDATA}/system/homebrew" \
        STEAM_COMPAT_CLIENT_INSTALL_PATH="${USERDATA}/system/.local/share/Steam" \
        STEAM_ROOT="${USERDATA}/system/.local/share/Steam" \
        nohup "$PLUGIN_LOADER" >> "${USERDATA}/system/logs/decky-loader.log" 2>&1 &
        echo "Decky PluginLoader restarted"
    fi
fi

echo "=== Install complete ==="
