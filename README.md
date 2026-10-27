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

Desde la 0.2.0, cada persona conecta su Google desde la propia app: carga en **Ajustes → Calendario** el archivo `.json` de un cliente OAuth «App de escritorio» que crea en su Google Cloud (gratis, unos 8 minutos, una sola vez). La guía paso a paso está en [docs/GOOGLE.md](docs/GOOGLE.md) y también dentro de la app («Cómo conseguirlo»). Así la build no lleva el cliente de nadie y no hay tope de usuarios.

Con un cliente propio, Acta usa la redirección de bucle local `http://127.0.0.1:<puerto de la app + 1>/` (47332 en la app empaquetada) y solo abre ese puerto mientras dura el inicio de sesión. Los clientes de escritorio no necesitan registrarla.

Opcional: meter un cliente de serie al empaquetar, para que nadie tenga que crear el suyo. `npm run package:mac` no lee `.env.local`; hay que exportarlo:

```bash
export ACTA_GOOGLE_CLIENT_ID="….apps.googleusercontent.com"
export ACTA_GOOGLE_CLIENT_SECRET="…"
# Solo si el cliente ya tiene otra redirección registrada.
# Si no, la app usa http://localhost:47331/api/google/callback.
# export ACTA_GOOGLE_REDIRECT_URI="http://localhost:47331/api/google/callback"
npm run package:mac
```

Ten en cuenta que Google limita a 100 usuarios las apps no verificadas con permisos de calendario, y que el secreto queda dentro de la app (en un programa de escritorio no es secreto de verdad): usa un proyecto de Google Cloud solo para Acta. Si una persona carga su propio cliente en Ajustes, se usa el suyo. La URL iCal y el Calendario del Mac funcionan siempre.

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

## Instalador de Windows

La app de Windows usa el mismo servidor y la misma interfaz. El audio no pasa por el binario Swift: el micrófono lo pide Chromium y el audio de la llamada es el loopback WASAPI que Electron ya trae (`desktopCapturer` + `audio: 'loopback'`). No hay que instalar nada más en el PC de quien usa Acta. Hace falta Windows 10 versión 2004 o más nueva, o Windows 11, en 64 bits.

La detección de reuniones (Zoom, Meet, Teams, Slack, Webex) es un programa pequeño, `acta-audio.exe`, que solo mira títulos de ventana y si el micrófono está en uso. No graba audio.

En un PC con Windows (hace falta Visual Studio con las herramientas de C++ de escritorio):

```bash
npm install
npm run package:win
```

En Linux o en un Mac hace falta el compilador cruzado `x86_64-w64-mingw32-g++` (en Debian/Ubuntu, `g++-mingw-w64-x86-64`). En Linux, además, Wine de 32 bits: electron-builder ejecuta el instalador NSIS, que es un stub de 32 bits, para extraer el desinstalador (`wine` y `wine32:i386`). En un Mac, electron-builder trae su propio Wine. El mismo comando genera el instalador:

```bash
npm install
npm run package:win
```

Salida: `dist/win/Acta-<versión>-x64-Setup.exe`.

Sin compilador de C++ a mano (por ejemplo, en un Mac sin MinGW), se puede reutilizar un `acta-audio.exe` ya compilado de una versión anterior, siempre que `native/win/acta-audio.cpp` no haya cambiado:

```bash
ACTA_WIN_HELPER=/ruta/a/acta-audio.exe npm run package:win
```

Las variables de Google son las mismas que en macOS, y este script tampoco lee `.env.local`. Sin ellas, cada persona carga su propio cliente en Ajustes (ver [docs/GOOGLE.md](docs/GOOGLE.md)). Los datos quedan en `%APPDATA%\Acta`. El puerto de la app empaquetada sigue siendo 47331.

Sin certificado, SmartScreen avisa. El texto para quien instala está en [INSTALAR.md](INSTALAR.md). Para firmar con Authenticode, exporta `CSC_LINK` (el .pfx en base64) y `CSC_KEY_PASSWORD` antes de `npm run package:win`.

El workflow `.github/workflows/windows-setup.yml` hace lo mismo en `windows-latest`.

## Qué hace

| Función | Cómo |
|---|---|
| Sin bot en la llamada | `bin/acta-audio` (Swift) graba el micrófono con AVAudioEngine y el audio del sistema con ScreenCaptureKit. |
| Transcripción | Groq Whisper por defecto, OpenAI, Deepgram o whisper.cpp local. |
| Detecta reuniones | En el Mac, el capturador Swift. En Windows, `acta-audio.exe` (ventanas y micrófono en uso). |
| Calendario | «Conectar con Google» (cada persona carga su cliente de Google en Ajustes, o la build trae uno de serie), URL iCal y, en el Mac, el Calendario del sistema. |
| Notas, plantillas, chat, tareas | En local. La IA solo entra cuando hay una clave en Ajustes. |
| Escritorio | Ventana, icono en la barra de menús, notificaciones, `⌘⇧N`. |

Atajos: `⌘K` buscar · `⌘N` nueva nota · `⌘J` preguntar.

## Piezas

- `server/` — API Express, WebSocket y `node:sqlite` + FTS5. En desarrollo, `node server/index.ts`. En la app, `scripts/build-payload.mjs` lo empaqueta con esbuild a JavaScript.
- `native/main.swift` — capturador, detector, permisos y eventos de calendario. Solo se compila en macOS.
- `native/win/acta-audio.cpp` — detector de reuniones para Windows. El audio lo captura Electron.
- `web/` — React 19, Tailwind 4 y TipTap.
- `electron/` — ventana y barra de menús. En la app empaquetada arranca el servidor con `ELECTRON_RUN_AS_NODE=1`.
- `scripts/package-mac.sh` — DMG y zip universales (arm64 + x64).
- `scripts/package-win.mjs` — instalador NSIS de 64 bits.

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
- En Windows el audio del sistema depende del loopback de Chromium. No está probado aquí contra Zoom, Teams ni Meet; el criterio y lo que quedaría por hacer si falla están en [docs/WINDOWS-PLAN.md](docs/WINDOWS-PLAN.md).
