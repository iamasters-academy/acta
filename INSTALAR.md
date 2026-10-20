# Instalar Acta en el Mac

Acta es un cuaderno de reuniones. Escucha la llamada, transcribe y, si quieres, convierte tus apuntes en notas. Todo se queda en tu Mac. No hay que instalar Node ni abrir una terminal.

Hace falta macOS 13 (Ventura) o más nuevo, en un Mac con Apple Silicon o Intel, según la copia que te hayan pasado.

## Instalar

1. Abre el archivo `Acta-….dmg`.
2. Arrastra **Acta** a la carpeta **Aplicaciones**.
3. Abre Acta desde Aplicaciones.

Si también te pasaron un `.zip`, descomprímelo y mueve `Acta.app` a Aplicaciones. Es la misma app.

### Si macOS dice que no puede abrirla

La copia todavía no está firmada por Apple. No está rota.

1. En el Finder, ve a Aplicaciones.
2. Haz **clic derecho** (o Control + clic) sobre **Acta**.
3. Elige **Abrir**, y otra vez **Abrir**.

Si no aparece esa opción: **Ajustes del Sistema → Privacidad y seguridad**, baja hasta el aviso de Acta y pulsa **Abrir igualmente**.

Solo hace falta hacerlo la primera vez.

## La primera vez

Acta se abre sola. Arriba verás un recuadro: **Añade tu clave para empezar**.

Acta no trae claves. Cada persona usa la de su cuenta. Sin una clave no puede transcribir ni escribir las notas.

1. Entra en **Ajustes** (o en el enlace del recuadro).
2. En **Claves**, pega al menos una:
   - **Groq** sirve para transcribir y para las notas. Es la más sencilla para empezar y tiene un plan gratuito con un tope de uso.
   - **OpenAI** también sirve para las dos cosas.
   - **Deepgram** solo transcribe.
   - **Anthropic** solo escribe notas y responde en el chat.
3. Pulsa **Guardar**. La clave queda en este Mac. No se envía a quien te pasó Acta.

Puedes crear la clave en la página de cada servicio (el enlace «Crear clave» de Ajustes). Si el servicio te cobra, el gasto es de tu cuenta, no de Acta.

En **Tú**, escribe tu nombre si quieres que las notas te llamen así.

## Permisos que va a pedir el Mac

| Permiso | Para qué | Dónde se concede |
|---|---|---|
| **Micrófono** | Tu voz («Yo») | Suele salir un aviso la primera vez que grabas. |
| **Grabación de pantalla** | El audio de la llamada («Ellos»). Acta no guarda la imagen. | Ajustes del Sistema → Privacidad y seguridad → Grabación de pantalla. Activa Acta. A veces hay que cerrar Acta y volver a abrirla. |
| **Calendario** | Leer las próximas reuniones de la app Calendario | Solo si activas «Calendario del Mac» en Ajustes. |

En Ajustes → Permisos de macOS puedes volver a pedirlos o abrir la pantalla correspondiente.

Para grabar: abre una nota y empieza. Acta usa el micrófono y, si el permiso de pantalla está concedido, también el audio de Zoom, Meet, Teams y el resto.

## Calendario

- **Dirección iCal.** En Outlook u otro calendario, copia la dirección secreta del calendario (acaba en `.ics`) y pégala en Ajustes → Calendario.
- **Calendario del Mac.** El interruptor de Ajustes lee los calendarios de la app Calendario, incluidas las cuentas que ya tengas añadidas ahí.
- **Conectar con Google** solo aparece si quien preparó esta copia de Acta configuró un acceso de Google. Si no ves el botón, usa una de las dos opciones de arriba. No es un fallo tuyo.

## Dónde están tus notas

En la primera apertura Acta crea esta carpeta:

`~/Library/Application Support/Acta`

Ahí están la base de datos, el audio (solo si lo activas; por defecto no se guarda), las exportaciones y, si algo falla, el archivo `server.log`.

En Ajustes → Datos puedes abrir esa carpeta. Para hacer una copia de seguridad, copia la carpeta con Acta cerrada (icono de la barra de menús → Salir de Acta).

Cerrar la ventana no sale de Acta: sigue en la barra de menús para avisarte de una reunión. Para salir del todo, usa **Salir de Acta**.

## Límites

- Hace falta internet para transcribir y para las notas, salvo que tengas montado whisper.cpp en el Mac (no viene incluido).
- Los límites y el precio los pone Groq, OpenAI, Deepgram o Anthropic, no Acta.
- Es para una sola persona. No hay app del iPhone ni carpetas compartidas con un equipo.
- Con altavoces, a veces tu voz se cuela en el audio de los demás. Con auriculares no pasa. Acta intenta quitar ese eco comparando el texto.
- Si el Mac pide «grabación de pantalla» y no la activas, Acta oye tu micrófono pero no a las otras personas.
