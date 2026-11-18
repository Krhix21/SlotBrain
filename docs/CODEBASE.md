# SLOTBRAIN â€” Cerebro del proyecto (referencia sin releer cÃ³digo)

> Destino final en el repo: `docs/CODEBASE.md`
> Proyecto: `C:\Users\USUARIO\Documents\SlotBrain`
> Generado: 2026-11-08, a partir de lectura completa del cÃ³digo.
> Si este doc existe y estÃ¡ actualizado, NO hace falta releer los fuentes para contexto general.

## 1. QuÃ© es

Bot de WhatsApp (Meta **Cloud API**, sin Puppeteer) que agenda citas a travÃ©s
de un LLM (Groq, modelo `openai/gpt-oss-120b`). Multi-empresa y
multi-profesional en un solo despliegue. Deploys: Render (ver
`DESPLEGUE-RENDER.md`).

Stack: Node 18+ (probado en 22), Express, `@supabase/supabase-js`,
`googleapis`, `groq-sdk`, `dotenv`. Sin TypeScript. Sin framework de tests.

## 2. Flujo de un mensaje (de punta a punta)

```
Cliente â†’ Meta â†’ POST /webhook/whatsapp (server.js)
  â”œâ”€ firma X-Hub-Signature-256 con META_APP_SECRET (timingSafeEqual, rawBody)
  â”œâ”€ dedup: INSERT message_id en mensajes_webhook (PK â†’ 23505 = duplicado)
  â”œâ”€ responde 200 YA y procesa en background
  â–¼
server.js â†’ extrae display_phone_number + phone_number_id + texto
  â–¼
bot.procesarMensajeWhatsapp({telefonoBot, phoneNumberId, telefonoCliente, texto, messageId})
  â”œâ”€ conversaciones.cargar(telefonoBot, telefonoCliente)   (estado en Supabase)
  â”œâ”€ numeros.resolverBot(telefonoBot) â†’ empresa_id  (cachÃ© 5 min)
  â”œâ”€ cargarConfiguracion(empresaId) â†’ {empresa, servicios}  (cachÃ© 5 min)
  â”œâ”€ 1Âª interacciÃ³n: saludo + pide nombre (no gasta LLM)
  â”œâ”€ 2Âª: extraerNombre() usa Groq temperature 0
  â”œâ”€ si hay pendingBooking y texto afirmativo â†’ agendar directo sin LLM
  â”œâ”€ si hay pendingBooking y "no" â†’ limpiar propuesta
  â””â”€ resto: Groq con tools ver_slots / agendar_cita / cancelar_cita / modificar_cita
       â””â”€ ver_slots â†’ disponibilidad.obtenerSlots â†’ ofrece horas (slot mÃ¡s temprano
          queda como pendiente en conv.pendingBooking, TTL 30 min)
       â””â”€ agendar_cita â†’ calendar.agendarCita (re-verifica y escribe evento)
```

El nÃºmero de WhatsApp identifica a la **empresa**, no al profesional
(`numeros_bot`). Un mismo nÃºmero atiende N profesionales de esa empresa.

## 3. Archivos (responsabilidad + funciones clave)

| Archivo | QuÃ© hace | Claves |
|---|---|---|
| `server.js` | Express, verificaciÃ³n webhook (GET hub.verify_token), firma HMAC, dedup webhooks, limpieza cada 6 h de dedup > 24 h | `setupAuthRoutes`, `setupAdminRoutes`, `yaProcesado/liberarMensaje`, `firmaValida`, puerto `PORT||3000` |
| `whatsappCloud.js` | Graph API v24.0. `enviarMensajeTexto`, `marcarComoLeido`, `normalizarTelefono` | Token por `phone_number_id` desde `META_TOKENS_JSON` (mapa en env, NO en DB). Error 131049 = ventana 24 h cerrada |
| `numeros.js` | nÃºmero receptor â†’ empresa. `resolverBot`, `listarPorEmpresa`, `limpiarCache` | CachÃ© 5 min en memoria. `normalizarTelefono`: solo dÃ­gitos, sin "00" |
| `bot.js` | Prompt, 4 tools, decisiones, confirmaciones rÃ¡pidas | `MODELO='openai/gpt-oss-120b'`, TTL pending 30 min, regex `esConfirmacionAfirmativa/esNegacion`, `normalizarFecha` (acepta 28/09, "28 de septiembre"), plantillas `mensaje_bienvenida`/`mensaje_confirmacion` con placeholders `{nombre}{servicio}{fecha}{hora}{profesional}{nombre_negocio}`. **Precio formateado hardcodeado como "COP"** en `textoServicios` |
| `disponibilidad.js` | Motor de horarios. `obtenerSlots`, `slotDeTrabajador`, `confirmarSlot` | Ventanas desde `trabajador.horario` â†’ `empresa.horario` â†’ `HORARIO_POR_DEFECTO`. Paso `slot_minutos` (trabajadorâ†’empresaâ†’30). freebusy por trabajador (1 llamada c/u, `requestBody` obligatorio). Overlay de `bloqueos`. `MAX_SLOTS_POR_TRABAJADOR=24`. No descarta slots pasados si `incluirPasados`. **inaccesible â‰  sin horas**: se comunica como motivo. `confirmarSlot` tolera stepper/ignora el evento propio al mover (tolerancia 60 s) |
| `calendar.js` | CRUD de citas: `agendarCita`, `cancelarCita`, `modificarCita`, `buscarCita`, `citaVigente` | SIEMPRE re-verifica con `confirmarSlot` antes de escribir en Google. Escribe en `calendarId:'primary'` con zona IANA. Restaura: si Google falla 401/403/400 â†’ mensaje "re-enlazar". Estados vigentes: `agendada, confirmada`. Evento con reminder popup 60 min |
| `googleAuth.js` | Cliente OAuth2 por trabajador | `SCOPES=['https://www.googleapis.com/auth/calendar']` (scope COMPLETO: ver tambiÃ©n `docs/CALENDARIO-GRATIS.md`). `crearCalendar(refreshToken)` |
| `auth.js` | OAuth callback. `/auth/google` (link firmado) â†’ Google â†’ `/auth/google/callback` | Token = base64url `trabajadorId.expira.firmaHMAC(SECRETO_ENLACE)`, vale 24 h, valida UUID. `prompt:'consent'`+`access_type:'offline'` para SIEMPRE recibir refresh_token. Detecta "ya autorizaste antes" â†’ pide revocar en myaccount.google.com/permissions |
| `admin.js` | API del panel + login | Sesiones en memoria (Map, TTL 8 h; **se pierden en cada deploy**). Creds: ADMIN_USER/ADMIN_PASSWORD env (+delay 500 ms). `soloCampos()` lista blanca anti mass-assignment. `refresh_token`/`correo` NUNCA editables desde el panel |
| `botState.js` | Estado mÃ­nimo (`getState`, `setCalendarConectado`) | Solo informativo en `/api/estado` |
| `conversaciones.js` | `cargar/guardar/agregarMensaje/esPrimeraConversacion` | Estado conversacional en tabla `conversaciones` (JSONB), guarda mensajes usuario+bot |
| `tiempo.js` | Zonas IANA. `zonedToUtc`, `esFechaValida` (YYYY-MM-DD), `normalizarHora` (HH:MM), `hoyEnZona`, `sumarDias`, `formatearFechaLarga/Corta`, `minutosDesdeHora/horaDesdeMinutos`, `claveDiaSemana`, `ZONA_POR_DEFECTO`, `HORARIO_POR_DEFECTO` | `fecha`+`hora` = hora de pared; `inicio_utc` = instante real |
| `public/admin.html` | Panel SPA | Integra con admin.js |
| `public/vincular.html` | PÃ¡gina de vinculaciÃ³n | â€” |
| `supabase-schema.sql` | Base NUEVA | v2 completa |
| `supabase-migracion-v2.sql` / `v3.sql` | Migraciones idempotentes para base v1 con datos | v3 = `mensajes_webhook` + CHECK formato hora |

## 4. Tablas (resumen)

- **empresas**: nombre, descripcion, telefono, direccion, `zona_horaria` (IANA),
  `horario` JSONB `{"lun":[["09:00","18:00"]],...,"dom":[]}`, `slot_minutos`,
  `mensaje_bienvenida`, `mensaje_confirmacion`, activo.
- **numeros_bot**: empresa_id, telefono (UNIQUE, solo dÃ­gitos), phone_number_id,
  etiqueta, activo. **El token NO va aquÃ­** (estÃ¡ en env).
- **servicios**: empresa_id, nombre, descripcion, precio (INTEGER),
  duracion_minutos, activo.
- **trabajadores**: nombre, empresa_id, telefono, `correo` y `refresh_token`
  (escritos SOLO por el callback de Google), `horario`/`slot_minutos` (NULL =
  hereda empresa), orden, activo. `telefono_bot` siempre NULL (legacy).
- **servicios_trabajadores**: PK (trabajador_id, servicio_id). **VACÃA = todos
  ofrecen todos.** (regla POR trabajador, no global)
- **bloqueos**: trabajador_id, fecha, hora_inicio/hora_fin (NULL inicio = dÃ­a
  completo), motivo.
- **citas**: empresa_id, trabajador_id, nombre_cliente, telefono_cliente,
  servicio_id, nombre_servicio, fecha, hora (`HH:MM` CHECK), duracion_minutos,
  `inicio_utc`, `evento_google_id`, estado
  (`agendada|confirmada|completada|cancelada|no_asistio`), canal
  (`whatsapp|panel`), cancelado_por, motivo_cancelacion.
- **conversaciones**: (telefono_bot, telefono_cliente) UNIQUE, user_name,
  mensajes JSONB, ultima_cita, pending_booking.
- **mensajes_webhook**: message_id PK, telefono_bot (dedup idempotente).

Todas con `actualizado_en` vÃ­a trigger `actualizar_timestamp()`.

## 5. Reglas invariables / gotchas (no romper)

1. **Dedup webhook**: la reserva se hace con el INSERT; si el procesamiento
   falla, hay que `liberarMensaje` para que Meta reintente.
2. **JamÃ¡s agendar sin `confirmarSlot`** (carrera: alguien pudo tomar la hora
   entre ofrecerla y confirmarla).
3. **freebusy** necesita `{requestBody: {...}}` (no params planos â†’ "Missing
   timeMin").
4. 1 llamada freebusy **por trabajador** (cada uno su propio token). No
   "optimizar" con 1 llamada global.
5. `trabajador.horario` overrides â†’ `empresa.horario` â†’ `HORARIO_POR_DEFECTO`.
   VacÃ­o (`dom`) = dÃ­a cerrado.
6. `servicios_trabajadores` vacÃ­a para un trabajador = ese profesional ofrece
   todos, **aunque otros tengan asignaciones**.
7. El calendario **ilegible no es "sin horas"**: se distingue con
   `inaccesible` y motivo sube al mensaje del bot.
8. `refresh_token/correo` solo desde el callback de Google; el panel los
   desconecta (pone NULL) pero nunca los edita.
9. Toda la hora es IANA por empresa; en `citas` guardar SIEMPRE `inicio_utc`
   junto a fecha/hora de pared.
10. Los `PUT` del panel filtran con lista blanca (`CAMPOS_*`). Sin esto,
    mass-assignment cambiaba credenciales.
11. Al crear/editar nÃºmero de respuesta o empresa/servicios: llamar
    `numeros.limpiarCache()` / `bot.limpiarCacheConfiguracion()`.
12. `enviarMensajeTexto(to, texto, phoneNumberId)`: resolver token por nÃºmero,
    no usar variable global salvo un solo nÃºmero.
13. Sesiones del panel en memoria: cualquier cambio honesto deberÃ­a moverlas a
    DB si se agrega una 2Âª persona.
14. Modelos Groq: seemed stable `openai/gpt-oss-120b`; extraerNombre usa
    temperature 0 y espera literal `null`.

## 6. Huecos conocidos (pendientes del roadmap)

- **No existe sistema de notificaciones/recordatorios** ni al profesional ni
  al cliente (sin cron de ningÃºn tipo). La Ãºnica alerta temprana es el popup
  de Google Calendar al profesional (reminder 60 min del evento).
- Panel con **un solo usuario** global (env). Ejecutar multitenant (ver
  `docs/ROADMAP-MULTITENANT.md`).
- Tokens de Meta por `phone_number_id` en **env** â†’ lÃ­mite duro para SaaS.
- Precio formateado como COP fijo en `bot.js`.
- `botState.js` es casi decorativo.
- No hay tests.

## 7. CÃ³mo correr

```bash
npm install
cp .env.example .env    # llenar variables (ver README, tabla completa)
npm start               # server.js en :3000, bot.iniciar() al boot
```
Panel: `/admin.html`. Health: `/health` (checa Supabase). DiagnÃ³stico bot:
`/api/estado`.


