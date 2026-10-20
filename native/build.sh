#!/usr/bin/env bash
# Builds the native audio/detection helper.
#   npm run build:native                  # this Mac's architecture -> bin/acta-audio
#   ACTA_ARCH=arm64|x64|universal bash native/build.sh
# Universal and x64 slices are for the distributable. Requires Xcode Command Line Tools.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "El capturador Swift solo se compila en macOS (swiftc, ScreenCaptureKit)." >&2
  echo "En un Mac: npm run build:native" >&2
  exit 1
fi
command -v swiftc >/dev/null || { echo "Falta swiftc. Instala las herramientas: xcode-select --install" >&2; exit 1; }

MIN="${ACTA_MACOS_MIN:-13.0}"
mkdir -p bin

compile() {
  local target="$1" out="$2"
  echo "swiftc ${target} -> ${out}"
  swiftc -O -target "$target" -o "$out" native/main.swift \
    -framework ScreenCaptureKit -framework AVFoundation -framework CoreAudio -framework CoreMedia \
    -framework AppKit -framework EventKit \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker native/Info.plist
  codesign -s - -f --identifier app.acta.meetings.audio "$out" >/dev/null 2>&1 || true
}

host_target() {
  local arch
  arch="$(uname -m)"
  if [[ "$arch" == "arm64" ]]; then echo "arm64-apple-macosx${MIN}"; else echo "x86_64-apple-macosx${MIN}"; fi
}

mode="${ACTA_ARCH:-host}"
case "$mode" in
  host)
    compile "$(host_target)" bin/acta-audio
    ;;
  arm64)
    compile "arm64-apple-macosx${MIN}" bin/acta-audio-arm64
    cp -f bin/acta-audio-arm64 bin/acta-audio
    ;;
  x64|x86_64)
    compile "x86_64-apple-macosx${MIN}" bin/acta-audio-x64
    cp -f bin/acta-audio-x64 bin/acta-audio
    ;;
  universal)
    compile "arm64-apple-macosx${MIN}" bin/acta-audio-arm64
    compile "x86_64-apple-macosx${MIN}" bin/acta-audio-x64
    lipo -create -output bin/acta-audio bin/acta-audio-arm64 bin/acta-audio-x64
    codesign -s - -f --identifier app.acta.meetings.audio bin/acta-audio >/dev/null 2>&1 || true
    ;;
  *)
    echo "ACTA_ARCH debe ser host, arm64, x64 o universal (es ${mode})." >&2
    exit 1
    ;;
esac
echo "bin/acta-audio listo (${mode})"
