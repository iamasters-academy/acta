# Conectar Acta con Google Calendar

Acta lee tu Google Calendar para enseñarte las próximas reuniones, avisarte al empezar y rellenar los asistentes de cada nota. Solo lee: no crea, no cambia y no borra eventos.

Hay dos caminos. Elige uno.

| Camino | Tiempo | Qué consigues |
|---|---|---|
| **A. Dirección iCal secreta** | 1 minuto | Tus reuniones y sus asistentes. Un calendario por dirección. |
| **B. Conectar con Google** | 8 minutos, una sola vez | Inicio de sesión de Google, varias cuentas y elegir qué calendarios ver. |

En el Mac hay un tercer camino: si tu cuenta de Google ya está en la app Calendario, activa **Ajustes → Calendario → Calendario del Mac**.

---

## A. Dirección iCal secreta (1 minuto)

1. Abre [Google Calendar](https://calendar.google.com) en el ordenador.
2. Arriba a la derecha, la rueda ⚙️ → **Configuración**.
3. A la izquierda, en **Configuración de mis calendarios**, pulsa tu calendario.
4. Baja hasta **Integrar el calendario** y copia la **Dirección secreta en formato iCal** (acaba en `.ics`).
5. En Acta: **Ajustes → Calendario → Otras formas de conectar**. Pega la dirección, ponle un nombre y pulsa **Añadir**.

Esa dirección da acceso de lectura a tu calendario a quien la tenga. No la compartas. Si se te escapa, en la misma pantalla de Google puedes restablecerla.

---

## B. Conectar con Google (8 minutos, una sola vez)

Acta no lleva dentro un acceso de Google de nadie. Cada persona crea el suyo en Google Cloud: es gratis, no pide tarjeta y la conexión queda solo entre tu Acta y tu cuenta. Después, conectar es un clic.

Lo que vas a crear es un **cliente OAuth de tipo «App de escritorio»**. Google te da un archivo `.json` y Acta lo carga.

> Los botones de Google Cloud cambian de sitio de vez en cuando. Si algo no coincide, busca la palabra en negrita en la pantalla.

### 1. Crea un proyecto

1. Abre <https://console.cloud.google.com/projectcreate> e inicia sesión con la cuenta de Google cuyo calendario quieres ver.
2. Si es tu primera vez en Google Cloud, acepta las condiciones.
3. **Nombre del proyecto:** `Acta`. Deja lo demás como está y pulsa **Crear**.
4. Espera unos segundos y comprueba que arriba, junto al logo de Google Cloud, pone **Acta**. Si no, cámbialo en ese selector.

### 2. Activa la API de Google Calendar

1. Abre <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>.
2. Con el proyecto **Acta** seleccionado arriba, pulsa **Habilitar**.

### 3. Configura la pantalla de acceso

1. Abre <https://console.cloud.google.com/auth/branding> y pulsa **Comenzar**.
2. **Información de la aplicación:** nombre `Acta` y, como correo de asistencia, el tuyo. **Siguiente**.
3. **Público:** elige **Externo**. **Siguiente**.
4. **Información de contacto:** tu correo. **Siguiente**.
5. Acepta la política de datos de usuario y pulsa **Crear**.

Si tu cuenta es de Google Workspace (de empresa) y solo la vas a usar tú, también vale **Interno**. En ese caso sáltate el paso 4.

### 4. Publica la app

1. Abre <https://console.cloud.google.com/auth/audience>.
2. En **Estado de publicación** pulsa **Publicar app** y confirma.

¿Por qué? Mientras la app está **En pruebas**, Google corta la conexión cada 7 días y tendrías que volver a conectar. Publicada, no caduca. Publicarla no la hace visible para nadie: sigue siendo tuya y solo la usas tú.

### 5. Crea el cliente de escritorio y descarga el archivo

1. Abre <https://console.cloud.google.com/auth/clients> y pulsa **Crear cliente**.
2. **Tipo de aplicación:** **App de escritorio**. **Nombre:** `Acta`. Pulsa **Crear**.
3. En la ventana que aparece, pulsa **Descargar JSON**. Guarda el archivo (se llama `client_secret_….json`).

El secreto del cliente solo se enseña en ese momento. Si cierras la ventana sin descargarlo, crea otro cliente: no pasa nada.

No hace falta añadir ninguna «URI de redireccionamiento». Los clientes de escritorio no la piden.

### 6. Cárgalo en Acta y conecta

1. En Acta: **Ajustes → Calendario → Cargar el archivo de Google (.json)** y elige el archivo del paso 5.
   - Si prefieres, **O pegar los datos a mano**: el ID de cliente (acaba en `.apps.googleusercontent.com`) y el secreto (empieza por `GOCSPX-`).
2. Pulsa **Conectar con Google**. Se abre el navegador.
3. Elige tu cuenta.
4. Google dirá **«Google no ha verificado esta aplicación»**. Es normal: la app la acabas de crear tú y no has pasado su verificación (solo hace falta para apps públicas). Pulsa **Configuración avanzada** → **Ir a Acta (no seguro)**.
5. Marca el permiso de **ver los eventos de tus calendarios** y pulsa **Continuar**.
6. Verás «Google conectado». Vuelve a Acta: aparecen tus calendarios con un interruptor cada uno. Por defecto se activan el principal y los que ves en Google Calendar.

Para añadir otra cuenta (la del trabajo, por ejemplo): **Añadir otra cuenta de Google**. Usa el mismo archivo; no hace falta repetir los pasos 1 a 5.

---

## Problemas frecuentes

| Ves esto | Qué hacer |
|---|---|
| «Ese cliente es de tipo Aplicación web» | En el paso 5 elegiste otro tipo. Crea un cliente nuevo de tipo **App de escritorio** y carga su archivo. |
| «La API de Google Calendar está desactivada» | Te saltaste el paso 2, o lo hiciste en otro proyecto. Acta muestra un botón **Activar la API**. Actívala, espera un minuto y pulsa ↻ en la cuenta. |
| «Acceso bloqueado: Acta no ha completado el proceso de verificación de Google» | La app sigue **En pruebas** y tu correo no está en la lista de usuarios de prueba. Haz el paso 4 (publicar). |
| Te desconecta cada semana | La app sigue **En pruebas**. Haz el paso 4 y vuelve a conectar. |
| «El puerto … está ocupado por otra app» | Otra aplicación usa el puerto que Acta abre durante el inicio de sesión. Ciérrala o reinicia el ordenador y vuelve a intentarlo. |
| «Google no devolvió permiso permanente» | Entra en <https://myaccount.google.com/connections>, quita **Acta** y vuelve a conectar. |
| El navegador no se abre al pulsar Conectar | Comprueba que tienes un navegador predeterminado. En el Mac: Ajustes del Sistema → Escritorio y Dock → Navegador web por omisión. |

## Qué guarda Acta y dónde

- El archivo del cliente y las sesiones de Google se guardan en la base de datos de Acta, en tu ordenador (Mac: `~/Library/Application Support/Acta`; Windows: `%APPDATA%\Acta`). No salen de ahí.
- Acta pide solo estos permisos: tu nombre, tu correo y **ver** tus calendarios (`calendar.readonly`).
- Para cortar el acceso: en Acta, el icono de salir junto a la cuenta; o en <https://myaccount.google.com/connections>.
- **Ajustes → Calendario → Quitar** borra tu cliente de Acta y desconecta las cuentas.

## Para quien compila Acta: incluir un cliente de serie

Si preparas una copia de Acta para un equipo y quieres que «Conectar con Google» funcione sin que cada persona cree su cliente, puedes meter uno al empaquetar (ver «Google Calendar» en el [README](../README.md)). Ten en cuenta:

- Google limita a **100 usuarios** las apps no verificadas que piden permisos de calendario. Para pasar de ahí hay que verificar la app en Google (política de privacidad publicada, dominio verificado y vídeo de demostración).
- El secreto queda dentro de la app. En un programa de escritorio no es secreto de verdad: usa un proyecto de Google Cloud solo para Acta.
- Si una persona carga su propio archivo en Ajustes, Acta usa el suyo y no el de serie.
