# SLOTBRAIN - Cerebro del proyecto (referencia sin releer codigo)

> Destino: `docs/CODEBASE.md`
> Actualizado: 2026-11-18 (agente dueno + BSUID + digest).

## 1. Que es

Bot/agente de WhatsApp (Meta **Cloud API**) que:

1. **Modo cliente:** agenda citas con LLM (Groq `openai/gpt-oss-120b`) + Google Calendar.
2. **Modo dueno/staff:** el propietario o staff escribe al mismo numero del negocio y opera la agenda (ver citas, marcar estados, bloqueos).

Multi-empresa y multi-nicho en un solo despliegue. Deploys: Render.

Stack: Node 18+, Express, `@supabase/supabase-js`, `googleapis`, `groq-sdk`, `dotenv`. Sin TypeScript.

## 2. Flujo de un mensaje

```
Cliente/Dueno -> Meta -> POST /webhook/whatsapp (server.js)
  |- firma X-Hub-Signature-256
  |- dedup mensajes_webhook
  |- extrae from y/o BSUID (usernames Meta 2026)
  +- bot.procesarMensajeWhatsapp({telefonoBot, telefonoCliente, bsuid, ...})
       |- numeros.resolverBot -> empresa_id
       |- roles.resolverRol -> propietario|staff|trabajador|cliente
       |- si dueno: tools agenteDueno + pending_owner_action
       |- si cliente + pending_reminder: SI->confirmada / NO->reagenda
       +- si cliente: tools ver_slots / agendar / cancelar / modificar
```

El numero de WhatsApp identifica a la **empresa** (`numeros_bot`).

## 3. Archivos clave

| Archivo | Que hace |
|---|---|
| `server.js` | Webhook, firma, dedup, extraccion BSUID |
| `bot.js` | Bifurcacion cliente/dueno, tools cliente, loop recordatorio |
| `agenteDueno.js` | Tools dueno: ver_agenda, marcar_estado, crear_bloqueo, buscar_cliente |
| `roles.js` | Match telefono/BSUID -> rol (codigo pais via `politicas.codigo_pais`) |
| `notificaciones.js` | Recordatorios + pending_reminder + digest matutino + avisarDueno |
| `conversaciones.js` | Estado en Supabase; identidad telefono o BSUID |
| `calendar.js` | CRUD citas + Google; soporta `bsuid` en citas |
| `disponibilidad.js` | Slots / freebusy / bloqueos |
| `whatsappCloud.js` | Graph API; `normalizarTelefono({codigoPaisDefault})`; `esBsuid` |
| `admin.js` + `public/admin.html` | Panel multitenant; telefono del dueno para el agente |
| `supabase-migracion-v9-agente-dueno.sql` | telefono/bsuid admin, pending_*, auditoria_agente |

## 4. Tablas (resumen operativo)

- **empresas**: nicho (`terminologia`, `prompt_base`, `moneda`, `politicas` con `codigo_pais`, `digest_hora`, `avisar_dueno`, `ultimo_digest_fecha`).
- **usuarios_admin**: login panel; `telefono` + `bsuid` para modo dueno. Unique parcial `(empresa_id, telefono)`.
- **numeros_bot**: routing; token cifrado opcional.
- **trabajadores** / **servicios** / **servicios_trabajadores** / **bloqueos** / **citas** (+ `bsuid`, `notificaciones` JSONB).
- **conversaciones**: `pending_booking`, `pending_reminder`, `pending_owner_action`, `bsuid`.
- **auditoria_agente**: log append-only de mutaciones del modo dueno.
- **mensajes_webhook**: dedup.

## 5. Reglas invariables

1. Dedup webhook por INSERT; liberar si falla el proceso.
2. Siempre `confirmarSlot` antes de escribir en Google.
3. freebusy con `requestBody`; 1 llamada por trabajador.
4. `servicios_trabajadores` vacia = ese profesional ofrece todos.
5. Calendario ilegible != dia lleno (`inaccesible`).
6. `refresh_token`/`correo` solo desde OAuth Google.
7. PUT panel con `soloCampos`.
8. Tras editar empresa/numeros: invalidar caches (`bot`, `numeros`, `roles`).
9. Firma webhook con `timingSafeEqual`.
10. Telefonos del panel: normalizar con codigo de pais; match exacto.
11. Acciones destructivas/masivas del dueno: confirmacion via `pending_owner_action`.
12. Dueno: no activar username de WhatsApp (o el match por telefono falla).

## 6. Huecos / follow-ups

- `REQUEST_CONTACT_INFO` para pedir numero cuando solo hay BSUID.
- Plantillas WABA UTILITY en el send path de recordatorios (hoy texto libre).
- Auto `no_asistio` post-cita sin respuesta.
- CRM `clientes` (hoy identidad = telefono/BSUID en citas/conversaciones).
- Embedded Signup Meta; facturacion SaaS.

## 7. Como correr

```bash
npm install && cp .env.example .env
# migraciones: v2...v9 segun base
npm start
```

Panel: `/admin.html`. Health: `/health`.
