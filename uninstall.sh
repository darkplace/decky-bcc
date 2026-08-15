#!/bin/bash
set -euo pipefail

USERDATA="${BATOCERA_USERDATA:-/userdata}"
TARGET="${USERDATA}/system/homebrew/plugins/armada-control"
BACKUP="${USERDATA}/system/homebrew/disabled-plugins/armada-control-previous"
LEGACY_BACKUP="${USERDATA}/system/homebrew/plugins/.armada-control.previous"
PADDLE_SERVICE_NAME="batocera_control_paddles"
PADDLE_SERVICE="${USERDATA}/system/services/${PADDLE_SERVICE_NAME}"
BOOT_SERVICE_NAME="batocera_control_boot"
BOOT_SERVICE="${USERDATA}/system/services/${BOOT_SERVICE_NAME}"

if [ -f "$PADDLE_SERVICE" ]; then
    "$PADDLE_SERVICE" stop >/dev/null 2>&1 || true
fi
if [ -f "$BOOT_SERVICE" ]; then
    "$BOOT_SERVICE" stop >/dev/null 2>&1 || true
fi
if command -v batocera-services >/dev/null 2>&1; then
    batocera-services disable "$PADDLE_SERVICE_NAME" >/dev/null 2>&1 || true
    batocera-services disable "$BOOT_SERVICE_NAME" >/dev/null 2>&1 || true
fi
rm -f "$PADDLE_SERVICE" /var/run/batocera-control-paddles.pid
rm -f "$BOOT_SERVICE"

rm -rf "$TARGET" "$BACKUP" "$LEGACY_BACKUP"

echo "Batocera Control plugin removed."
echo "Settings and the Batocera Control game/LSFG launch helpers were retained."
echo "The helpers must remain while any Steam game launch option references them."
echo "A migrated standalone LSFG plugin, if present, remains under homebrew/disabled-plugins."
