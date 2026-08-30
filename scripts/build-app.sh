#!/usr/bin/env bash
# Build, ad-hoc sign, and package the Mac app.
#
# Apple silicon refuses to run a completely unsigned binary — macOS reports it as
# "damaged", not as an unidentified developer. An ad-hoc signature (`-`) satisfies
# that requirement. It is not notarised, so a downloaded copy still carries the
# quarantine flag and needs one right-click → Open (or xattr -dr).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
APP="$ROOT/dist-app/mac-arm64/Familiar.app"
DMG="$ROOT/dist-app/Familiar-0.1.0-arm64.dmg"

echo "→ building the web dashboard"
( cd web && npx vite build >/dev/null )
rm -rf hold/web-dist && cp -r web/dist hold/web-dist

echo "→ bundling the server"
npx esbuild server/src/index.ts --bundle --platform=node --target=node22 \
  --format=cjs --outfile=hold/server-bundle/server.cjs --external:node:sqlite --log-level=error

echo "→ packaging and ad-hoc signing (electron-builder signs inside-out)"
( cd hold && npx electron-builder --mac dmg --publish never )

echo
ls -lah "$DMG"
codesign -dv "$APP" 2>&1 | grep -E "Signature|Identifier" || true
codesign --verify --strict --verbose=2 "$APP" 2>&1 | tail -2
