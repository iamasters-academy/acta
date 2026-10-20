#!/usr/bin/env bash
# Turns a stock Electron.app into an Acta shell: renames the executable and helpers
# the way Electron expects, and writes the usage strings macOS shows in permission dialogs.
set -euo pipefail
APP="${1:?ruta a Electron.app}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="${ACTA_PRODUCT_NAME:-Acta}"
BUNDLE_ID="${ACTA_BUNDLE_ID:-app.acta.meetings}"
VERSION="${ACTA_VERSION:?falta ACTA_VERSION}"
SRC_PLIST="$ROOT/electron/Info.plist"

pb_set() {
  local file="$1" key="$2" value="$3"
  if /usr/libexec/PlistBuddy -c "Print :${key}" "$file" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :${key} ${value}" "$file"
  else
    /usr/libexec/PlistBuddy -c "Add :${key} string ${value}" "$file"
  fi
}

copy_usage() {
  local file="$1"
  local key val
  for key in NSMicrophoneUsageDescription NSAudioCaptureUsageDescription NSScreenCaptureUsageDescription NSCalendarsFullAccessUsageDescription NSCalendarsUsageDescription; do
    val="$(/usr/libexec/PlistBuddy -c "Print :${key}" "$SRC_PLIST")"
    pb_set "$file" "$key" "$val"
  done
}

HELPERS_RENAMED=0
rename_helper() {
  local dir="$1" suffix="$2"
  local orig="Electron${suffix}" new="${NAME}${suffix}"
  local src="${dir}/${orig}.app"
  [[ -d "$src" ]] || return 0
  HELPERS_RENAMED=$((HELPERS_RENAMED + 1))
  local mac="${src}/Contents/MacOS"
  if [[ -e "${mac}/${orig}" ]]; then
    mv "${mac}/${orig}" "${mac}/${new}"
  fi
  local dest="${dir}/${new}.app"
  mv "$src" "$dest"
  local pl="${dest}/Contents/Info.plist"
  pb_set "$pl" CFBundleExecutable "$new"
  pb_set "$pl" CFBundleDisplayName "$new"
  pb_set "$pl" CFBundleName "$new"
  pb_set "$pl" CFBundleIdentifier "${BUNDLE_ID}.helper"
  pb_set "$pl" CFBundleShortVersionString "$VERSION"
  pb_set "$pl" CFBundleVersion "$VERSION"
  copy_usage "$pl"
}

brand_helpers_in() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  local suffix
  for suffix in " Helper" " Helper (GPU)" " Helper (Plugin)" " Helper (Renderer)" " Helper EH" " Helper NP" " Login Helper"; do
    rename_helper "$dir" "$suffix"
  done
}

MACOS="$APP/Contents/MacOS"
if [[ -e "$MACOS/Electron" ]]; then
  mv "$MACOS/Electron" "$MACOS/$NAME"
fi

PL="$APP/Contents/Info.plist"
pb_set "$PL" CFBundleExecutable "$NAME"
pb_set "$PL" CFBundleName "$NAME"
pb_set "$PL" CFBundleDisplayName "$NAME"
pb_set "$PL" CFBundleIdentifier "$BUNDLE_ID"
pb_set "$PL" CFBundleShortVersionString "$VERSION"
pb_set "$PL" CFBundleVersion "$VERSION"
pb_set "$PL" LSApplicationCategoryType "public.app-category.productivity"
pb_set "$PL" LSMinimumSystemVersion "${ACTA_MACOS_MIN:-13.0}"
copy_usage "$PL"
/usr/libexec/PlistBuddy -c "Delete :ElectronAsarIntegrity" "$PL" >/dev/null 2>&1 || true

brand_helpers_in "$APP/Contents/Frameworks"
brand_helpers_in "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers"
brand_helpers_in "$APP/Contents/Frameworks/Electron Framework.framework/Helpers"
brand_helpers_in "$APP/Contents/Library/LoginItems"

if [[ "$HELPERS_RENAMED" -lt 1 ]]; then
  echo "No encontré los helpers de Electron dentro de $APP. El zip de Electron cambió de estructura:" >&2
  find "$APP" -name '*.app' -o -name 'Electron' | head -50 >&2
  exit 1
fi

rm -rf "$APP/Contents/Resources/default_app.asar"
if [[ -f "$ROOT/build/icon.icns" ]]; then
  cp "$ROOT/build/icon.icns" "$APP/Contents/Resources/electron.icns"
fi
echo "Marcada como ${NAME}: $APP"
