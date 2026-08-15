#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(cat "${ROOT}/VERSION")"
NAME="decky-bcc-${VERSION}"
STAGE="${ROOT}/.release-stage/${NAME}"
OUT="${ROOT}/release"
EPOCH="1783814400"
export TZ=UTC

cd "$ROOT"
npm ci --no-audit --no-fund
npm run build
npx tsc --noEmit
python3 -m unittest discover -s tests -v
node tests/test-launch-options.mjs
npm audit

find . -type d -name __pycache__ -prune -exec rm -rf {} +
find . -type f -name '*.pyc' -delete

PAYLOAD_FILES=(
    VERSION SOURCE.json LICENSE.md THIRD_PARTY_NOTICES.md package.json plugin.json main.py
    dist/index.js py_modules/batocera-control-game-launch py_modules/batocera-control-lsfg-launch
    py_modules/batocera-control-paddles-service py_modules/batocera-control-boot-service
    py_modules/fex-profiles.json py_modules/power-profiles.factory.conf
)
while IFS= read -r file; do PAYLOAD_FILES+=("$file"); done < <(find py_modules/armada_control -type f | sort)
sha256sum "${PAYLOAD_FILES[@]}" > PAYLOAD.sha256
bash tests/test_installer.sh

rm -rf "${ROOT}/.release-stage"
mkdir -p "$STAGE" "$OUT"
tar --exclude=.git --exclude=node_modules --exclude=release --exclude=.release-stage \
    --exclude='__pycache__' --exclude='*.pyc' -cf - . | tar -xf - -C "$STAGE"

rm -f "${OUT}/${NAME}.tar.gz" "${OUT}/${NAME}.zip"
tar --sort=name --mtime="@${EPOCH}" --owner=0 --group=0 --numeric-owner \
    -C "$(dirname "$STAGE")" -cf - "$NAME" | gzip -n -9 > "${OUT}/${NAME}.tar.gz"

if command -v zip >/dev/null 2>&1; then
    find "$STAGE" -exec touch -h -d "@${EPOCH}" {} +
    (cd "$(dirname "$STAGE")" && zip -X -q -9 -r "${OUT}/${NAME}.zip" "$NAME")
fi

RELEASE_FILES=("${NAME}.tar.gz")
if [ -f "${OUT}/${NAME}.zip" ]; then
    RELEASE_FILES+=("${NAME}.zip")
fi
(cd "$OUT" && sha256sum "${RELEASE_FILES[@]}" > SHA256SUMS)
rm -rf "${ROOT}/.release-stage"
echo "Release written to ${OUT}"
