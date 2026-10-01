# Guía de pruebas

Alcance: **un número de prueba de Meta, un profesional y un cliente**. Es el
mínimo para recorrer el flujo completo, y mantiene los costos cerca de cero
porque Meta no cobra las conversaciones con el número de prueba.

## Las tres piezas

| Pieza | Qué es | Para qué |
|---|---|---|
| Número de prueba de Meta | El que aparece en WhatsApp → API Setup | Es el que puede escribirte gratis, sin plantillas |
| Profesional | Tu propia cuenta de Google Calendar | Para tener un `refresh_token` real |
| Cliente | Otro número de WhatsApp | Para probar desde el otro lado |

El número de prueba y el número del profesional **no tienen por qué ser el
mismo**, y en la práctica no pueden: el número de prueba de Meta no puede
recibir mensajes, solo enviar.

## Antes de empezar

Tener a la mano:

- El `Phone Number ID` y el token de acceso de Meta.
- El webhook apuntando al servicio desplegado y verificado.
- `META_APP_SECRET` en las variables de entorno.
- La app de Google Cloud con `https://tu-dominio/auth/google/callback` en los
  redirect URIs autorizados.
- El correo de Google del profesional en *Test users* de la pantalla de
  consentimiento.

## Abrir la ventana de 24 horas

Meta solo permite escribir libremente a alguien que te haya escrito a ti en las
últimas 24 horas. Como el número de prueba no tiene buzón, hay que hacerlo a
mano.

1. Desde el WhatsApp del **cliente**, envía `hello_world` al número del
   profesional. Si no tienes el número del profesional a mano, envía el mensaje
   al número de prueba desde cualquier cuenta que tenga la conversación abierta
   con él.
2. Verifica que llegó. A partir de ahí, el bot puede responderle freely durante
   24 horas.

Si no aparece en la lista de destinatarios permitidos, el número no está
registrado todavía.

## Configuración

1. Entra al panel y crea la empresa con su **zona horaria**.
2. En **Números**, registra el número de prueba con código de país y sin `+`,
   más su `phone_number_id`.
3. En **Profesionales**, crea uno, ponle nombre y asígnale la empresa.
4. Copia su **enlace de Calendar**, ábrelo, autoriza tu cuenta de Google y
   espera la pantalla de éxito.
5. En **Servicios**, crea al menos uno con duración (por ejemplo *Corte
   clásico*, 60 minutos).
6. En el profesional, deja **Servicios** sin marcar nada para que ofrezca todos.

## Recorrido de prueba

Escribe al número de prueba desde el WhatsApp del cliente.

**1. Saludo y nombre**
```
Cliente: hola
Bot:     ¡Hola! Bienvenido a Xheros Barber 👋 Soy tu asesor virtual, ¿cómo te llamas?
Cliente: soy Ana
Bot:     ¡Mucho gusto, Ana! ¿En qué te ayudo hoy?
```

Si el bot no te pide el nombre, es que ya había una conversación guardada.
Bórrala desde Supabase para empezar limpio:

```sql
DELETE FROM conversaciones WHERE telefono_cliente = '573XXXXXXXXX';
```

**2. Consulta de disponibilidad**

```
Cliente: quiero un corte
Bot:     ¿Para qué día te gustaría?
Cliente: el jueves
Bot:     Estos son los horarios libres para Corte clásico el jueves 1 de octubre:
         • 09:00
         • 09:30
         ...
         ¿Te aparto alguno?
```

Comprueba en `citas` que **no** hay ninguna fila todavía. Todavía no se agendó
nada.

**3. Confirmación**

```
Cliente: sí
Bot:     ¡Listo Ana! Tu cita de Corte clásico quedó agendada para el 1 de
         octubre a las 09:00 con Crhistian. Te esperamos en Xheros Barber.
```

Ahora sí debe existir una fila en `citas` **y** un evento en el Google Calendar
del profesional.

**4. Verificar que no se agendó dos veces**

Este era un bug real de la versión 1. Confirma en Supabase que hay una sola
cita para ese cliente:

```sql
SELECT fecha, hora, estado, evento_google_id
FROM citas
WHERE telefono_cliente = '573XXXXXXXXX'
ORDER BY creado_en DESC;
```

**5. Cancelar**

```
Cliente: quiero cancelar
Bot:     Listo Ana, tu cita del 01/10 a las 09:00 quedó cancelada.
```

El evento debe desaparecer del calendario y la cita quedar en `cancelada`.

**6. Slot tomado por un tercero**

Agenda con el cliente una hora, y a mano crea en el Google Calendar del
profesional un evento que se solape. Después pide esa misma hora de nuevo:

```
Cliente: el jueves a las 09:00
```

El bot **no debe** ofrecerla. Si la ofrece, hay un problema en el cálculo de
disponibilidad.

**7. Dos clientes a la vez**

Manda el mismo mensaje desde dos números distintos, casi al mismo tiempo. Cada
uno debe tener su propia conversación: la clave es
`(telefono_bot, telefono_cliente)`, no solo el teléfono del cliente.

## Comprobaciones en Supabase

```sql
-- Lo que dijo el bot, tal como se guardó
SELECT telefono_cliente, user_name,
       jsonb_array_length(mensajes) AS mensajes
FROM conversaciones
ORDER BY actualizado_en DESC;

-- Citas con el detalle completo
SELECT nombre_cliente, telefono_cliente, nombre_servicio,
       fecha, hora, duracion_minutos, inicio_utc, estado, canal
FROM citas
ORDER BY creado_en DESC;
```

Lo que deberías ver: `user_name` con el nombre del cliente, `mensajes` en un
número entre 1 y 6 (el tope), y en las citas `telefono_cliente`, `servicio_id`,
`duracion_minutos` e `inicio_utc` **rellenos**. Si `servicio_id` o
`inicio_utc` vinieran vacíos, el código nuevo no estaría ejecutándose.

## Cosas que deben fallar limpiamente

| Prueba | Resultado esperado |
|---|---|
| Fecha en el pasado | El bot avisa y ofrece lo más cercano |
| Servicio inexistente | Dice cuáles son los válidos, no inventa uno |
| Cliente pide cancelar sin tener cita | "No encontré ninguna cita tuya" |
| Profesional sin calendario enlazado | No ofrece ninguna hora, lo dice en el log |
| Desconectar el calendario a mitad de uso | La cita falla con un mensaje claro, no se cuelga |

## Limpieza

Las conversaciones se borran solas a los 30 días. Para las pruebas:

```sql
-- Todo lo de este cliente
DELETE FROM conversaciones WHERE telefono_cliente = '573XXXXXXXXX';

-- Webhooks registrados
DELETE FROM mensajes_webhook;
```

Las citas **no** se borran: son el historial. Si repetiste muchas veces, deja
las que te sirvan de evidencia y borra el resto.

## Si algo falla

1. Mira los logs del servicio en Render. Cada paso del bot deja una línea:
   qué herramienta llamó, qué resultado tuvo, si la cita se creó o se rechazó.
2. `GET /api/estado` dice cuántos calendarios se enlazaron en esta sesión
   (no dice cuáles: es una ruta sin autenticación).
3. `GET /health` confirma que Supabase responde.
4. Si un mensaje no genera respuesta, revisa si el número está en
   `numeros_bot` y activo. Un número inactivo se descarta en silencio a
   propósito.
5. Para que un reintento de Meta vuelva a intentar un mensaje que falló, su
   reserva tiene que estar libre. Si crees que quedó una a medias:
   `SELECT * FROM mensajes_webhook;` y luego `DELETE FROM mensajes_webhook;`
