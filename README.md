# Bot de citas por WhatsApp

Bot de WhatsApp que agenda citas en Google Calendar. Usa la **Meta WhatsApp
Cloud API** y está pensado para varias empresas y varios profesionales
desde un solo despliegue.

## Cómo funciona

```
Cliente ──► Meta ──► /webhook/whatsapp ──► server.js
                                              │
                                    ¿qué número recibió el mensaje?
                                              │
                                        numeros.js
                                              │
                                        empresa
                                              │
                                     bot.js (Groq)
                                              │
                              ver_slots → confirmar → agendar
                                       │
                                  disponibilidad.js
                                  (Google freebusy)
                                       │
                                  calendar.js
                                  (evento + tabla citas)
```

La clave del diseño: **el número de WhatsApp identifica a la empresa, no al
profesional**. Meta manda en cada webhook el número por el que llegó el
mensaje (`metadata.display_phone_number`), el bot lo busca en la tabla
`numeros_bot` y con eso ya sabe a qué empresa pertenece la conversación. Por
eso un mismo número puede atender a cinco peluqueros distintos, y un mismo
despliegue puede atender a tres empresas distintas.

## Flujo de una reserva

1. El cliente escribe y el bot saluda, le pide el nombre y lo guarda.
2. Pide servicio y fecha. El modelo llama a `ver_slots`, que:
   - toma el horario del profesional (o el de la empresa si no tiene uno propio),
   - genera los turnos posibles según la duración del servicio,
   - consulta `freebusy` en el Google Calendar **de ese profesional**,
   - descuenta las ausencias registradas en `bloqueos`.
3. El bot ofrece las horas y guarda una propuesta en `pending_booking`
   (que caduca a los 30 minutos).
4. Cuando el cliente dice "sí", se agenda. **Antes de escribir en el
   calendario se vuelve a verificar disponibilidad**: entre el paso 3 y el 4
   alguien más pudo tomar esa hora.

## Requisitos

- Node 18 o superior (probado en 22)
- Un proyecto de Supabase
- Una app de Meta con WhatsApp configurado
- Un proyecto de Google Cloud con la API de Calendar habilitada

## Instalación

```bash
npm install
cp .env.example .env
```

## Base de datos

**Base nueva:** ejecuta `supabase-schema.sql`.

**Base que ya tiene los datos de la versión anterior:** ejecuta, en este orden,
`supabase-migracion-v2.sql` y después `supabase-migracion-v3.sql`. Los dos
archivos son idempotentes y crean copias `_bak_*` antes de tocar nada.

La v2 hace, entre otras cosas:

- crea la función `actualizar_timestamp()`, que **no existía** (por eso
  `actualizado_en` nunca se actualizaba),
- agrega la primary key y las tres foreign keys que faltaban en `citas`,
- crea `numeros_bot`, `servicios_trabajadores`, `bloqueos` y `conversaciones`,
- pone `telefono_bot` en `NULL` en todos los trabajadores para liberar el
  número a la empresa,
- crea los índices, que en la base anterior no había ninguno.

La v3 crea `mensajes_webhook` (para no agendar dos veces el mismo mensaje) y
agrega la restricción de formato de hora en `citas`.

## Variables de entorno

Copia `.env.example` y llénalo. Lo importante:

| Variable | Para qué |
|---|---|
| `META_WHATSAPP_TOKEN` | Token de acceso. Solo si tienes un número |
| `META_TOKENS_JSON` | `{"<phone_number_id>": "<token>"}` para varios números |
| `META_PHONE_NUMBER_ID` | Phone Number ID principal |
| `META_VERIFY_TOKEN` | El que inventas tú, debe coincidir con el de Meta |
| `META_APP_SECRET` | Verifica la firma del webhook |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth de Google |
| `GOOGLE_REDIRECT_URI` | Debe terminar en `/auth/google/callback` |
| `SECRETO_ENLACE` | Firma los enlaces de vinculación de Calendar |
| `SUPABASE_URL` / `SUPABASE_KEY` | Base de datos |
| `GROQ_API_KEY` | Modelo de lenguaje |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Acceso al panel |

**Los tokens de Meta viven solo en variables de entorno**, nunca en la base de
datos. La tabla `numeros_bot` guarda qué número es de quién y su
`phone_number_id`, que no es un secreto.

`SECRETO_ENLACE` firma los enlaces de vinculación de Google Calendar. Si no
pones ninguno, el panel **no genera enlaces**: antes caía a una constante
escrita en el código, y con ella cualquiera podía firmar un enlace para el id
que quisiera y enlazar su propio calendario al de otro profesional.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Configuración en Meta

1. App de Meta → WhatsApp → API Setup. Ahí están el `Phone Number ID` y el token.
2. Webhooks → Callback URL: `https://tu-dominio.com/webhook/whatsapp`
3. Suscríbete al campo **messages**.
4. Usa el mismo `META_VERIFY_TOKEN` que pusiste en `.env`.

## Configuración inicial

```bash
npm start
```

Abre `http://localhost:3000/admin.html` y:

1. **Empresas** → crea el negocio con su zona horaria.
2. **Números** → registra el número de WhatsApp con su código de país, sin `+`,
   y el `phone_number_id` de Meta.
3. **Profesionales** → crea al menos uno y dale nombre y empresa.
4. Copia el enlace de Calendar de ese profesional y ábrelo tú para autorizar tu
   cuenta de Google. El enlace va firmado con el id del profesional, así que no
   sirve para sobrescribir el calendario de otro.
5. **Servicios** → crea los servicios con precio y duración.

## Zona horaria

Todo se calcula con la zona IANA de la empresa (`America/Bogota`,
`America/Mexico_City`, `Europe/Madrid`...) usando las tablas de la IANA que
trae Node. La versión anterior usaba offsets fijos (`-05:00` para todos),
lo que dejaba a México, Lima y Madrid con una hora de diferencia y a
Europa con el horario de verano mal puesto.

`fecha` y `hora` en `citas` son la hora de pared tal como la ve el cliente;
`inicio_utc` es el instante real.

## Multi-profesional

- Cada profesional tiene su propio `refresh_token` de Google.
- Por eso `freebusy.query` se llama **una vez por profesional**, aunque la API
  admita hasta 50 calendarios en una sola llamada: cada llamada usa las
  credenciales de quien la hace, y no hay un token compartido.
- Cada profesional puede tener su propio horario y su propia duración de turno.
- `servicios_trabajadores` filtra quién puede hacer qué. **Si la tabla está
  vacía, todos ofrecen todos los servicios.**
- Con más de un profesional libre, el bot muestra el nombre de cada uno.
  Con uno solo, solo la hora.
- Las ausencias se registran en `bloqueos` desde el panel. También se
  contempla que en el futuro el profesional le escriba al bot para
  declararlas por conversación.

## Seguridad

- `updateEmpresa` y el resto de los `PUT` filtran campos con una lista blanca.
  Sin eso, un `PUT {"refresh_token": "..."}` habría cambiado credenciales.
- El enlace de Google va firmado con HMAC, valida que el id tenga forma de
  UUID y expira en 24 horas. Sin secreto configurado no se emiten enlaces.
- El `refresh_token` de un profesional solo se escribe desde el callback de
  Google, nunca desde el panel.
- Se compara la firma del webhook con `timingSafeEqual`, y se compara el token
  del panel de la misma forma.
- El panel devuelve 503 si no hay `ADMIN_USER`/`ADMIN_PASSWORD`, en vez de
  caer a unas credenciales por defecto.

## Estructura

| Archivo | Responsabilidad |
|---|---|
| `server.js` | Express, webhook, verificación de firma, deduplicación |
| `whatsappCloud.js` | Graph API v24, envío y lectura, tokens por número |
| `numeros.js` | Número receptor → empresa, con caché de 5 minutos |
| `bot.js` | Prompt, herramientas, flujo de confirmación |
| `disponibilidad.js` | Horarios, `freebusy`, bloqueos, cálculo de turnos |
| `calendar.js` | Alta, baja y modificación de citas |
| `auth.js` | OAuth de Google con enlace firmado |
| `googleAuth.js` | Cliente OAuth2 reutilizable |
| `tiempo.js` | Zonas horarias y formato de fechas |
| `conversaciones.js` | Estado conversacional en Supabase |
| `admin.js` | API del panel, con listas blancas |
| `botState.js` | Estado mínimo de la sesión |

## Cosas que cambiaron respecto a la versión 1

- `whatsapp-web.js`, `puppeteer`, `qrcode` y Chromium quedaron fuera. El
  `Dockerfile` ya no los instala.
- No hay QR que escanear. El número se registra en el panel.
- `clientes.js` y `conversaciones.json` se eliminaron: no hay tabla de
  clientes y el estado conversacional vive en Supabase.
- El bot ya no inventa servicios: usa los que están activos en la base.
- Ya no puede agendar dos veces el mismo mensaje.

## Documentación

- `DESPLEGUE-RENDER.md` — despliegue en Render
- `DEPLOY-TESTING.md` — guía de pruebas con un profesional y un cliente
