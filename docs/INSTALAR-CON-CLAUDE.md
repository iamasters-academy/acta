# Instalar Acta con Claude — guía para el asistente

Esta guía la sigue **Claude Code** cuando alguien le pide «instálame Acta». La persona que la pide no tiene por qué saber programar: háblale en su idioma, sin jerga, un paso cada vez, y comprueba cada paso antes de pasar al siguiente.

## Reglas

- **Claves y contraseñas, nunca por el chat.** La persona pega su clave de IA directamente en Acta (Ajustes → Claves). No le pidas que te la escriba, no la leas de ningún archivo y no la muestres.
- **Nada que cueste dinero sin preguntar.** Groq tiene plan gratuito; OpenAI, Deepgram y Anthropic cobran por uso. Explícalo y deja que elija.
- **Pregunta antes de sustituir** una instalación de Acta que ya exista. Las notas no están dentro de la app (Mac: `~/Library/Application Support/Acta`; Windows: `%APPDATA%\Acta`), así que actualizar no las borra; aun así, avisa.
- Si algo falla, lee el error, explícalo en una frase y propón el siguiente intento. No sigas a ciegas.

## 0. Presenta el plan

En dos o tres frases: qué es Acta (notas de reuniones con IA que viven en su ordenador), qué vas a hacer (descargar, instalar, abrir) y qué tendrá que hacer la persona (crear una clave gratuita de Groq y pegarla en Acta, y aceptar los permisos del sistema). Unos 10 minutos.

## 1. Descarga la última versión

Averigua el sistema y la arquitectura (`uname -sm` en Mac; en Windows, `$env:PROCESSOR_ARCHITECTURE` o `uname -m` en Git Bash). Acta funciona en macOS 13 o más nuevo (Apple Silicon e Intel: el `.dmg` es universal) y en Windows 10 (versión 2004 o más nueva) u 11 de 64 bits. En otro sistema, dilo y para.

La última versión y sus archivos están en la API de GitHub:

```bash
curl -fsSL https://api.github.com/repos/iamasters-academy/acta/releases/latest | grep -E '"(tag_name|browser_download_url)"'
```

- Mac: el archivo que acaba en `-universal.dmg`.
- Windows: el que acaba en `-x64-Setup.exe`.

Descárgalo a la carpeta de Descargas con `curl -fL -o <ruta> <url>` (en PowerShell, `Invoke-WebRequest <url> -OutFile <ruta>`). Pesa entre 100 y 230 MB.

## 2. Instala

### Mac

```bash
hdiutil attach -nobrowse -quiet "$HOME/Downloads/<archivo>.dmg" -mountpoint /tmp/acta-dmg
```

- Si ya existe `/Applications/Acta.app`: pregunta si quiere actualizarla. Si dice que sí, cierra Acta (`osascript -e 'quit app "Acta"'`) y sustituye la app.
- Copia la app: `ditto /tmp/acta-dmg/Acta.app /Applications/Acta.app`
- Desmonta: `hdiutil detach /tmp/acta-dmg -quiet`
- Abre: `open -a /Applications/Acta.app`

Si macOS dice que no puede abrirla porque no está firmada por Apple: que la persona haga clic derecho sobre Acta en Aplicaciones → **Abrir** → **Abrir**, o que vaya a Ajustes del Sistema → Privacidad y seguridad → **Abrir igualmente**. Solo la primera vez. No desactives Gatekeeper.

### Windows

Ejecuta el instalador y espera a que termine:

```powershell
Start-Process "$env:USERPROFILE\Downloads\<archivo>-Setup.exe" -Wait
```

La persona pulsa **Siguiente** en el asistente. Si aparece SmartScreen («Windows protegió su PC»): **Más información** → **Ejecutar de todas formas**. Al acabar, que abra Acta desde el menú Inicio (o deja marcada la casilla de abrirla al terminar).

## 3. Comprueba que está en marcha

Acta abre un servidor local en el puerto 47331. Espera unos segundos tras abrirla y comprueba:

```bash
curl -s http://127.0.0.1:47331/api/state
```

Tiene que devolver un JSON con `"packaged":true`. Si no responde, espera 10 segundos más y repite. Si sigue sin responder, el registro está en `server.log` dentro de la carpeta de datos (paso de las reglas).

## 4. La clave de IA (la pone la persona)

1. Abre <https://console.groq.com/keys> en su navegador (`open <url>` en Mac, `start <url>` en Windows). Que cree una cuenta (gratis) y pulse **Create API Key**.
2. Que copie la clave y la pegue en **Acta → Ajustes → Claves → Groq**, y pulse **Guardar**.
3. Compruébalo sin ver la clave:

   ```bash
   curl -s http://127.0.0.1:47331/api/settings | grep -o '"GROQ_API_KEY":{"set":[a-z]*'
   ```

   Tiene que salir `"set":true`.

Si prefiere OpenAI o Anthropic, es lo mismo en su casilla. Con Groq basta para transcribir y para escribir las notas.

## 5. Permisos

- **Mac:** la primera grabación pide **Micrófono** y **Grabación de pantalla**. La grabación de pantalla solo sirve para oír el audio de la llamada; Acta no guarda la imagen. Si no sale el aviso: Acta → Ajustes → **Permisos de macOS**. Puedes abrir el panel del sistema con:
  `open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"`
  A veces hay que cerrar Acta y volver a abrirla tras concederlo.
- **Windows:** solo pide el micrófono la primera vez que graba.

## 6. Primera prueba

Que pulse **Nueva nota** → empezar a grabar, diga un par de frases y pare. En unos segundos debe ver el texto en la transcripción. Si no aparece nada, revisa el paso 4 y los permisos.

## 7. Calendario (opcional)

Pregunta si quiere ver sus reuniones en Acta y qué calendario usa.

- **Lo más rápido (1 minuto):** la dirección secreta iCal. En Google Calendar: ⚙️ → Configuración → su calendario → «Dirección secreta en formato iCal». En Outlook, la dirección `.ics` de publicar el calendario. Se pega en Acta → Ajustes → Calendario → Otras formas de conectar → **Añadir**.
- **En Mac**, si su cuenta de Google ya está en la app Calendario: Acta → Ajustes → Calendario → **Calendario del Mac**.
- **Conectar con Google (8 minutos, una sola vez):** sigue [docs/GOOGLE.md](GOOGLE.md) con ella, pantalla a pantalla. Abre tú cada enlace de Google Cloud y dile qué pulsar. Ella descarga el archivo JSON y lo carga en Acta con el botón **Cargar el archivo de Google (.json)**; no lo leas tú. Luego **Conectar con Google**. Avísale antes de que Google dirá «app no verificada» y que es normal: la app es suya.

## 8. Cierra

Resume en tres líneas: dónde está Acta, dónde están sus notas y que cerrar la ventana no la cierra (sigue en la barra de menús o junto al reloj para avisar de reuniones; para salir del todo, **Salir de Acta**). Atajos: `⌘K` buscar, `⌘N` nueva nota, `⌘J` preguntar (en Windows, `Ctrl`).

Para actualizar en el futuro basta con repetir esta guía: descarga la versión nueva y sustituye la app; las notas se conservan.
