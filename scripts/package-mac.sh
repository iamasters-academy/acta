#!/usr/bin/env bash
# Builds a self-contained Acta.app plus a .dmg and a .zip.
#
# On a Mac (Apple Silicon or Intel, Xcode Command Line Tools):
#   npm install
#   npm run package:mac
#
# Output:
#   dist/Acta-<version>-universal.dmg
#   dist/Acta-<version>-universal.zip
#
# Apple Silicon only (faster, skips the Intel slice):
#   ACTA_ARCH=arm64 npm run package:mac
#
# Optional Google sign-in (not read from .env.local):
#   ACTA_GOOGLE_CLIENT_ID=... ACTA_GOOGLE_CLIENT_SECRET=... npm run package:mac
# Register the redirect http://localhost:47331/api/google/callback on that OAuth client,
# or pass ACTA_GOOGLE_REDIRECT_URI if the client already has another one.
#
# Optional Developer ID signing and notarization (omit both for an ad-hoc build):
#   ACTA_CODESIGN_IDENTITY="Developer ID Application: Nombre (TEAMID)" npm run package:mac
#   ACTA_NOTARIZE=1 APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=... \
#     ACTA_CODESIGN_IDENTITY="Developer ID Application: Nombre (TEAMID)" npm run package:mac
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  cat <<'EOF' >&2
El .dmg de Acta solo se puede crear en macOS (swiftc, lipo, hdiutil).

En este equipo puedes comprobar el resto:
  npm install
  npm run typecheck
  npm run build:payload
  npm run smoke

En un Mac (Apple Silicon o Intel, con Xcode Command Line Tools):
  npm install
  npm run package:mac

Salida: dist/Acta-<version>-universal.dmg y dist/Acta-<version>-universal.zip
EOF
  exit 2
fi

for tool in swiftc lipo hdiutil curl ditto codesign; do
  command -v "$tool" >/dev/null || { echo "Falta ${tool}. Instala Xcode Command Line Tools: xcode-select --install" >&2; exit 1; }
done

ARCH="${ACTA_ARCH:-universal}"
case "$ARCH" in
  universal|arm64|x64) ;;
  *) echo "ACTA_ARCH debe ser universal, arm64 o x64." >&2; exit 1 ;;
esac

VERSION="$(node -p "require('./package.json').version")"
ELECTRON_VERSION="$(node -p "require('electron/package.json').version")"
export ACTA_VERSION="$VERSION"
BUNDLE_ID="${ACTA_BUNDLE_ID:-app.acta.meetings}"

echo "Acta ${VERSION} · Electron ${ELECTRON_VERSION} · ${ARCH}"
node scripts/build-payload.mjs
ACTA_ARCH="$ARCH" bash native/build.sh
bash scripts/make-icon.sh || echo "Aviso: no se pudo generar build/icon.icns; la app usará el icono de Electron." >&2

CACHE="$ROOT/.cache/electron"
mkdir -p "$CACHE"
SUMS="$CACHE/SHASUMS256-${ELECTRON_VERSION}.txt"
if [[ ! -f "$SUMS" ]]; then
  curl -fL --retry 3 -o "$SUMS" "https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/SHASUMS256.txt"
fi

fetch_electron() {
  local arch="$1"
  local name="electron-v${ELECTRON_VERSION}-darwin-${arch}.zip"
  local zip="$CACHE/$name"
  local dest="$CACHE/darwin-${arch}"
  if [[ ! -d "$dest/Electron.app" ]]; then
    if [[ ! -f "$zip" ]]; then
      curl -fL --retry 3 -o "$zip" "https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${name}"
    fi
    (cd "$CACHE" && grep -E "[ *]${name}$" "SHASUMS256-${ELECTRON_VERSION}.txt" | shasum -a 256 -c -)
    rm -rf "$dest"
    mkdir -p "$dest"
    ditto -x -k "$zip" "$dest"
  fi
}

assemble() {
  local arch="$1"
  local app="$ROOT/dist/Acta-${arch}.app"
  local helper="$ROOT/bin/acta-audio-${arch}"
  [[ -x "$helper" ]] || { echo "No está ${helper}. ¿Falló swiftc para ${arch}?" >&2; exit 1; }
  fetch_electron "$arch"
  rm -rf "$app"
  ditto "$CACHE/darwin-${arch}/Electron.app" "$app"
  ACTA_VERSION="$VERSION" ACTA_BUNDLE_ID="$BUNDLE_ID" bash scripts/brand-mac-app.sh "$app"
  rm -rf "$app/Contents/Resources/app"
  ditto "$ROOT/dist/payload" "$app/Contents/Resources/app"
  mkdir -p "$app/Contents/Resources/app/bin"
  cp "$helper" "$app/Contents/Resources/app/bin/acta-audio"
  chmod +x "$app/Contents/Resources/app/bin/acta-audio"
  echo "Montada: $app"
}

mkdir -p dist
if [[ "$ARCH" == "arm64" || "$ARCH" == "universal" ]]; then assemble arm64; fi
if [[ "$ARCH" == "x64" || "$ARCH" == "universal" ]]; then assemble x64; fi

FINAL="$ROOT/dist/Acta.app"
rm -rf "$FINAL"
if [[ "$ARCH" == "universal" ]]; then
  node scripts/make-universal.mjs "$ROOT/dist/Acta-x64.app" "$ROOT/dist/Acta-arm64.app" "$FINAL"
  rm -rf "$ROOT/dist/Acta-x64.app" "$ROOT/dist/Acta-arm64.app"
else
  mv "$ROOT/dist/Acta-${ARCH}.app" "$FINAL"
fi

if [[ -n "${ACTA_CODESIGN_IDENTITY:-}" ]]; then
  node scripts/sign-mac-app.mjs "$FINAL"
else
  codesign --force --deep --sign - --identifier "$BUNDLE_ID" "$FINAL"
  echo "Firma ad-hoc (sin Developer ID). Quien descargue el dmg tendrá que abrirlo con clic derecho → Abrir."
fi

TAG="Acta-${VERSION}-${ARCH}"
ZIP="$ROOT/dist/${TAG}.zip"
DMG="$ROOT/dist/${TAG}.dmg"
rm -f "$ZIP" "$DMG"
ditto -c -k --keepParent "$FINAL" "$ZIP"

if [[ "${ACTA_NOTARIZE:-}" == "1" ]]; then
  [[ -n "${ACTA_CODESIGN_IDENTITY:-}" ]] || { echo "ACTA_NOTARIZE=1 requiere ACTA_CODESIGN_IDENTITY." >&2; exit 1; }
  : "${APPLE_ID:?falta APPLE_ID}"
  : "${APPLE_APP_SPECIFIC_PASSWORD:?falta APPLE_APP_SPECIFIC_PASSWORD}"
  : "${APPLE_TEAM_ID:?falta APPLE_TEAM_ID}"
  xcrun notarytool submit "$ZIP" --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
  xcrun stapler staple "$FINAL"
  ditto -c -k --keepParent "$FINAL" "$ZIP"
fi

STAGE="$(mktemp -d)"
cp -R "$FINAL" "$STAGE/Acta.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Acta" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
rm -rf "$STAGE"
if [[ -n "${ACTA_CODESIGN_IDENTITY:-}" ]]; then
  codesign --force --sign "$ACTA_CODESIGN_IDENTITY" "$DMG" || echo "Aviso: no se pudo firmar el dmg." >&2
fi

echo
echo "Listo:"
echo "  $DMG"
echo "  $ZIP"
echo "  $FINAL"
if [[ -z "${ACTA_CODESIGN_IDENTITY:-}" ]]; then
  cat <<'EOF'

Build sin notarizar. En un Mac limpio, tras descargar:
  1. Abre el dmg y arrastra Acta a Aplicaciones.
  2. La primera vez: clic derecho sobre Acta → Abrir → Abrir.
     Si macOS sigue bloqueándola: Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente.
  3. Permisos que pedirá: Micrófono, Grabación de pantalla (audio del sistema, no la imagen) y, si activan el calendario del Mac, Calendario.
EOF
fi
