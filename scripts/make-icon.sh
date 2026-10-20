#!/usr/bin/env bash
# Renders web/public/icon.svg into build/icon.icns (macOS only).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
TMP="$(mktemp -d)"
qlmanage -t -s 1024 -o "$TMP" build/icon-src.svg >/dev/null 2>&1
PNG="$TMP/icon-src.svg.png"
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 64 128 256 512; do
  sips -z $s $s "$PNG" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$PNG" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o build/icon.icns
echo "build/icon.icns"
