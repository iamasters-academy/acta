# Windows

El instalador NSIS ya existe (`npm run package:win`, workflow `windows-setup.yml`). El audio del sistema es el loopback WASAPI de Chromium, dentro de Electron, para no pedir otro programa a quien instala. `native/win/acta-audio.exe` solo detecta reuniones. El calendario del Mac no se muestra fuera de macOS. Lo que sigue sin hacerse es la prueba real con Zoom, Teams y Meet, y un capturador WASAPI propio si ese loopback se queda mudo o mezcla el micrófono.

# Plan original

Acta en macOS depende de un binario Swift (`native/main.swift`) para cuatro cosas. El servidor, la base de datos, la interfaz y el OAuth de Google no dependen de Swift. Una versión de Windows reutiliza el payload de `scripts/build-payload.mjs` (JavaScript del servidor + `web/dist`) y el shell de Electron. Lo que hay que sustituir es el capturador.

No está estimado en días. El tamaño es el de los bloques de abajo.

## 1. Audio: micrófono y audio del sistema

Hoy el helper publica dos canales PCM a 16 kHz: micrófono (`me`, AVAudioEngine) y audio del sistema (`them`, ScreenCaptureKit). El servidor no sabe cómo se capturaron; solo recibe esos canales (`recorder.ts`, comando `capture`).

En Windows el camino más corto es no portar Swift y usar el Chromium que ya trae Electron:

- Micrófono: `getUserMedia({ audio: true })`. `web/src/lib/browserCapture.ts` ya baja el micrófono a 16 kHz y lo manda por el WebSocket (canal 0).
- Audio del sistema: loopback de WASAPI, que Chromium expone en Windows 10 2004 o más nuevo. Desde el proceso principal, `desktopCapturer.getSources({ types: ['screen'] })` y, en el renderer, `getUserMedia` con `chromeMediaSource: 'desktop'` y el `chromeMediaSourceId` de la pantalla. Se descarta el vídeo y se queda el audio (canal 1). Así no hace falta el diálogo de «compartir pantalla» si el id se elige en código.
- `session.setDisplayMediaRequestHandler` es la otra vía, con el selector del sistema. Peor para una app que quiere parecerse a la del Mac.
- Un helper nativo (WASAPI loopback en C++ o C#) solo compensa si el loopback de Chromium falla con unos auriculares, una app concreta o el dispositivo de comunicación de Windows. No hace falta para el primer corte.

El cambio toca `browserCapture.ts`, el arranque de la grabación en `store.tsx` (hoy, si no hay helper y la plataforma es darwin, cae al navegador) y el shell, para pedir el permiso de micrófono de Windows. No toca el protocolo de transcripción.

Riesgo: en algunos equipos el loopback de Chromium mezcla el micrófono o se queda en silencio hasta reiniciar el proceso de audio. Hay que probarlo con Zoom, Teams y Meet en un Windows real. Este entorno no puede hacerlo.

## 2. Detección de reuniones

`server/detector.ts` solo arranca el helper en `darwin`. El helper escribe una línea JSON cada dos segundos: `micInUse`, lista `{ app, bundleId, title }` y permisos. Con eso Acta avisa al empezar una llamada y puede parar sola cuando la ventana desaparece.

En Windows no existe ScreenCaptureKit ni `CGWindowList`. El reemplazo es un proceso pequeño que hable el mismo JSON:

- Ventanas: `EnumWindows` + título. Los mismos textos que ya mira el Swift (Meet, Zoom Meeting, Teams, huddle de Slack).
- Procesos: `Zoom.exe`, `Teams.exe`, `Slack.exe` como respaldo cuando el título viene vacío, igual que el fallback actual si no hay permiso de pantalla.
- Micrófono en uso: `IAudioSessionManager2` (sesiones activas). Es la parte menos documentada. Sin ella se puede avisar solo por la ventana de la reunión y perder el caso «hay micrófono pero no reconocemos la app».

Un ejecutable de unas pocas páginas en C# (ya viene el runtime en Windows moderno) o C++ es más estable que un módulo nativo de Node, que habría que recompilar para Electron. El servidor solo tendría que dejar de exigir `process.platform === 'darwin'` y buscar `acta-audio.exe` junto a la app.

Tamaño: es el bloque nuevo de verdad. El resto del detector (avisos, parada automática, calendario) ya está en TypeScript.

## 3. Calendario

- URL iCal: ya funciona en cualquier sistema (`calendar.ts`, `ical-expander`).
- Google OAuth: el mismo `server/google.ts`, con la misma regla de la build de Mac (oculto si no hay client id al empaquetar). La redirección sigue siendo localhost.
- «Calendario del Mac» es EventKit. En Windows el equivalente (citas de la app Calendario vía WinRT) exige una identidad de paquete y es fácil que se quede a medias. Para la primera versión: ocultar ese interruptor fuera de macOS y dejar iCal + Google. Outlook se cubre con la dirección secreta `.ics`, que la gente ya puede copiar.

## 4. Instalador

`electron-builder` con target `nsis` en un runner `windows-latest` produce un `Acta-Setup.exe`. El mismo payload, más `acta-audio.exe` cuando exista. No hace falta el script de `hdiutil`.

La firma es opcional, con `CSC_LINK` / `CSC_KEY_PASSWORD` (certificado Authenticode). Sin firmar, SmartScreen avisa parecido a Gatekeeper: «Más información» → «Ejecutar de todas formas». Hay que documentarlo en un `INSTALAR-WINDOWS.md` cuando exista el instalador.

El shell tiene que usar la misma idea que en Mac: servidor con `ELECTRON_RUN_AS_NODE`, datos en `app.getPath('userData')` (`%APPDATA%\Acta`), sin caminar `.env.local`.

## Qué no hace falta rehacer

Servidor, SQLite, FTS5, interfaz, claves en Ajustes, plantillas, chat, exportaciones, MCP y el empaquetado del JavaScript. El workflow de Mac ya demuestra que ese payload arranca sin un Node instalado.

## Orden razonable

1. En Windows, grabar micrófono + loopback con el código que ya existe en el renderer, e instalar con NSIS una app que transcribe. Sin detección automática.
2. Helper de ventanas con el mismo JSON, y enchufarlo a `detector.ts`.
3. Probar Zoom, Teams y Meet con auriculares y con altavoces. Decidir si el loopback de Chromium basta o hace falta WASAPI propio.
4. Firma Authenticode cuando haya certificado. Hasta entonces, el texto de SmartScreen.

El paso 1 es el que desbloquea a alguien en Windows. El 2 es lo que iguala el comportamiento del Mac. El 3 es el que puede obligar a escribir código nativo de audio.
