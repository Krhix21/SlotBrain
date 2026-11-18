---
name: slotbrain
description: >-
  USAR SIEMPRE al trabajar en el proyecto SlotBrain (bot de WhatsApp Cloud API
  en Node para agendar citas con Google Calendar por OAuth, Supabase y
  Groq/Meta). Contiene convenciones, mapa del cÃ³digo, reglas invariables y
  trampas conocidas para NO releer los fuentes en cada sesiÃ³n.
---

# Skill: trabajar en SlotBrain

Antes de tocar cÃ³digo, lee `docs/CODEBASE.md` (destinatario de
`docs/CODEBASE.md`). Este skill resume cÃ³mo trabajar SIN releer todo.

## Mapa rÃ¡pido "Â¿dÃ³nde cambio X?"

| Quiero cambiar... | Archivo | Detalle |
|---|---|---|
| Texto/comportamiento del bot (saludo, reglas, tools) | `bot.js` | Prompt en `construirPrompt`; tools arriba del archivo |
| CÃ³mo se calculan los horarios libres | `disponibilidad.js` | `ventanasDelDia`, `pasoDeSlots`, `obtenerSlots`, `confirmarSlot` |
| QuÃ© pasa al agendar/cancelar/mover | `calendar.js` | Cada funciÃ³n re-verifica slot antes de escribir |
| Microservice WhatsApp (envÃ­o, tokens por nÃºmero) | `whatsappCloud.js` | Resolver por `phone_number_id` |
| Ruteo mensajeâ†’empresa | `numeros.js` | Recuerda `limpiarCache` tras escribir en `numeros_bot` |
| OAuth Google / vinculaciÃ³n de calendario | `auth.js` + `googleAuth.js` | refresh_token solo aquÃ­; el panel desconecta pero no edita |
| Panel/API admin | `admin.js` (+ `public/admin.html`) | `soloCampos()` lista blanca; credenciales via env |
| Zonas horarias / parsing fechas | `tiempo.js` | Ayuda: nunca guardar offset fijo |
| Estado conversacional | `conversaciones.js` | En Supabase, no en disco |
| Esquema DB | `supabase-schema.sql` (nueva) / `supabase-migracion-v*.sql` (existente) | Idempotentes, con backups `_bak_*` |

## Convenciones del repo

- JavaScript CommonJS (`require`), sin TS, sin ESLint. Comentarios en espaÃ±ol,
  con la regla de negocio explicada inline (mantener ese estilo: los
  comentarios explican el "por quÃ©", no el "quÃ©").
- `async/await` con manejo de error que retorna estructura
  `{exitoso, mensaje, ...}` (no lanzar errores hacia el bot).
- Consola con emojis de contexto (âœ… âŒ âš ï¸ ðŸ—‘ï¸ â™»ï¸ ðŸ”§).
- 2 espacios, comillas simples.
- Mensajes del bot: espaÃ±ol natural, breves; plantillas con placeholders
  `{nombre} {servicio} {fecha} {hora} {profesional} {nombre_negocio}`.
- Fechas: `hora` SIEMPRE `HH:MM` (24 h), `fecha` SIEMPRE `YYYY-MM-DD`;
  guardar `inicio_utc` (timestamp real) junto a la hora de pared al crear o
  mover cualquier cita.

## Reglas que no se deben romper (validadas a costa de bugs reales)

1. Dedup de webhook por `mensajes_webhook` (INSERT como reserva; liberar si
   falla). Un "sÃ­" duplicado = dos citas si se quita.
2. Re-verificar disponibilidad (`confirmarSlot`) justo antes de escribir el
   evento en Google. Siempre.
3. `freebusy` con `requestBody` (params planos â†’ "Missing timeMin").
4. 1 llamada freebusy por trabajador (tokens individuales).
5. `servicios_trabajadores` VACÃA = profesional ofrece todos (regla POR
   trabajador, no por tabla global).
6. Calendario ilegible â‰  dÃ­a lleno: propagar `motivo`/`inaccesible`.
7. No editar `refresh_token` ni `correo` desde el panel. Solo callback Google.
8. PUT del panel SIEMPRE con `soloCampos(CAMPOS_*)`.
9. Tras escribir empresa/servicio/`numeros_bot`, invalidar cachÃ©
   (`bot.limpiarCacheConfiguracion()` / `numeros.limpiarCache()`).
10. `META_APP_SECRET`+`X-Hub-Signature-256` con `timingSafeEqual`; no aceptar
    webhook sin firma si el secret existe.

## CÃ³mo probar (sin suite de tests)

- Arranque local: `npm start` â†’ revisar log de inicio (nÃºmeros activos =
  lista).
- Webhook: enviar mensaje de prueba con firma correcta; probar tambiÃ©n dedup
  (mismo mensaje dos veces â†’ solo 1 proceso).
- End-to-end con 2 nÃºmeros de prueba (admin + un profesional con Calendar
  enlazado con enlace del panel).
- Tras cambios en disponibilidad o calendar: verificar los 3 caminos: agendar
  nuevo, mover existente (no debe chocar consigo mismo), cancelar.
- `/health` â†’ `{"ok":true,"supabase":true}`.

## Trampas de entorno

- Sesiones del panel viven en memoria: cada deploy de Render pierde el login
  (comportamiento esperado, no bug). No "arreglar" sin mover a DB.
- Tokens de Meta solo en env (`META_TOKENS_JSON`): si el panel dice "sin
  token", aÃ±adir ahÃ­, no en la tabla.
- `SECRETO_ENLACE` ausente = el panel **no** genera enlaces de Calendar
  (comportamiento de seguridad intencional: sin secreto no se firman).
- Node 18+: `fetch` global y zonas IANA incluidas en el core; no aÃ±adir
  dependencias para cosas que ya resuelve Node.
- Trabajador sin `refresh_token` â†’ el bot responde "todavÃ­a no tiene un Google
  Calendar conectado" (NO crash).


