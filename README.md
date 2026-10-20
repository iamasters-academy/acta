# Acta — cuaderno de reuniones con IA, en local

Acta es un cuaderno de reuniones al estilo Granola para usar en un Mac: transcribe la llamada sin meter un bot, y la IA completa las notas a partir de lo que escribes. El audio y el texto solo salen hacia el proveedor que cada persona configura (Groq, OpenAI, Deepgram o Anthropic).

Quien va a instalar la app (sin tocar código) tiene la guía en [INSTALAR.md](INSTALAR.md).

## Desarrollo

Hace falta Node.js 22 o más reciente. El servidor en desarrollo se ejecuta como TypeScript nativo.

```bash
npm install
npm run dev          # http://127.0.0.1:4848
```

App de escritorio contra el código del repo (usa el Node del sistema y, si existe, `.env.local`):

```bash
npm run build:native # solo macOS, Xcode Command Line Tools
npm run app          # electron .
```

En desarrollo, las claves se leen de `.env.local` subiendo carpetas (la más cercana gana) y no pisan variables que ya estén en el entorno. La app empaquetada no hace eso: cada persona escribe sus claves en Ajustes.

## Instalador de macOS

La app que se distribuye no usa el Node del sistema ni un directorio de trabajo concreto. El servidor va compilado a JavaScript, la interfaz es el build de Vite, el capturador Swift va dentro del bundle y el proceso corre con el Node que trae Electron 38 (`node:sqlite` y FTS5). Los datos (base de datos, audio, exportaciones, `server.log`) se crean en la primera apertura en `~/Library/Application Support/Acta`.

En un Mac (Apple Silicon o Intel, con `xcode-select --install` ya hecho):

```bash
npm install
npm run package:mac
```

Eso genera:

- `dist/Acta-<versión>-universal.dmg`
- `dist/Acta-<versión>-universal.zip`
- `dist/Acta.app`

Solo Apple Silicon, si el slice de Intel da problemas:

```bash
ACTA_ARCH=arm64 npm run package:mac
```

`ACTA_ARCH` también puede ser `x64`. El mínimo del binario Swift es macOS 13.

### Google Calendar

`npm run package:mac` no lee `.env.local`. «Conectar con Google» queda oculto salvo que, al empaquetar, exportes un cliente OAuth pensado solo para Acta (scope de calendario de solo lectura). Crea un cliente nuevo para esta app; no reutilices uno de otro proyecto.

```bash
export ACTA_GOOGLE_CLIENT_ID="….apps.googleusercontent.com"
export ACTA_GOOGLE_CLIENT_SECRET="…"
# Solo si el cliente ya tiene otra redirección registrada.
# Si no, la app usa http://localhost:47331/api/google/callback.
# export ACTA_GOOGLE_REDIRECT_URI="http://localhost:47331/api/google/callback"
npm run package:mac
```

La redirección por defecto de la app empaquetada es `http://localhost:47331/api/google/callback` (el puerto fijo de la app). Hay que registrarla en Google Cloud. La URL iCal y el Calendario del Mac siguen disponibles aunque Google no esté incluido.

El secreto del cliente queda dentro de la app: en un programa de escritorio no es secreto de verdad. Usa un cliente solo para Acta.

### Firma y notarización (opcionales)

Sin certificado, el script firma en ad-hoc para que macOS pueda recordar los permisos. Quien descargue esa build tiene que abrirla con clic derecho → Abrir, o desde Privacidad y seguridad → Abrir igualmente. El detalle está en [INSTALAR.md](INSTALAR.md).

Con un certificado Developer ID ya instalado en el llavero:

```bash
export ACTA_CODESIGN_IDENTITY="Developer ID Application: Nombre (TEAMID)"
npm run package:mac
```

Para notarizar (hace falta para que se abra con doble clic tras descargarla):

```bash
export ACTA_NOTARIZE=1
export APPLE_ID="tu@correo"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"
export ACTA_CODESIGN_IDENTITY="Developer ID Application: Nombre (TEAMID)"
npm run package:mac
```

`APPLE_APP_SPECIFIC_PASSWORD` es una contraseña de aplicación de Apple, no la de la cuenta.

El identificador del bundle es `app.acta.meetings`. Se puede cambiar con `ACTA_BUNDLE_ID` antes de empaquetar. Cambiarlo después hace que macOS vuelva a pedir los permisos.

En GitHub Actions, el workflow `.github/workflows/macos-dmg.yml` ejecuta el mismo script. Si existen los secretos `CSC_LINK` (el .p12 en base64) y `CSC_KEY_PASSWORD`, importa el certificado en el runner antes de firmar. La notarización usa `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y `APPLE_TEAM_ID`.

## Qué hace

| Función | Cómo |
|---|---|
| Sin bot en la llamada | `bin/acta-audio` (Swift) graba el micrófono con AVAudioEngine y el audio del sistema con ScreenCaptureKit. |
| Transcripción | Groq Whisper por defecto, OpenAI, Deepgram o whisper.cpp local. |
| Detecta reuniones | El capturador vigila el micrófono y ventanas de Zoom, Meet, Teams, Slack, FaceTime, Webex y Discord. |
| Calendario | Google OAuth si la build lo incluye; si no, URL iCal o el Calendario del Mac. |
| Notas, plantillas, chat, tareas | En local. La IA solo entra cuando hay una clave en Ajustes. |
| Escritorio | Ventana, icono en la barra de menús, notificaciones, `⌘⇧N`. |

Atajos: `⌘K` buscar · `⌘N` nueva nota · `⌘J` preguntar.

## Piezas

- `server/` — API Express, WebSocket y `node:sqlite` + FTS5. En desarrollo, `node server/index.ts`. En la app, `scripts/build-payload.mjs` lo empaqueta con esbuild a JavaScript.
- `native/main.swift` — capturador, detector, permisos y eventos de calendario. Solo se compila en macOS.
- `web/` — React 19, Tailwind 4 y TipTap.
- `electron/` — ventana y barra de menús. En la app empaquetada arranca el servidor con `ELECTRON_RUN_AS_NODE=1`.
- `scripts/package-mac.sh` — DMG y zip universales (arm64 + x64).

## Comprobar sin un Mac

```bash
npm install
npm run typecheck
npm run build:payload
npm run smoke
```

`smoke` arranca el servidor empaquetado, comprueba que ignora `.env.local` y que crea la base de datos en el directorio de datos.

## Límites conocidos

- La cancelación de eco de Apple a veces no arranca (error -10875). Con auriculares no hay eco; si no, Acta compara el texto de los dos canales.
- Los permisos de micrófono, grabación de pantalla y calendario los pide macOS la primera vez. La grabación de pantalla solo se usa para el audio del sistema.
- No hay app de iPhone ni carpetas compartidas: Acta es de una sola persona.
- Windows no está hecho. El plan está en [docs/WINDOWS-PLAN.md](docs/WINDOWS-PLAN.md).
