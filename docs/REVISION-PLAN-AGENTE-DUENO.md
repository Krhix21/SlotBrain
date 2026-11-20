# Revisión adjunta al plan "agente dueño de SlotBrain"

**Revisado por:** Investi (agente de investigación de Mi Negocio)
**Fecha:** 18 de noviembre de 2026
**Plan revisado:** C:\Users\USUARIO\.opencode\plan\1795013493934-agente-due-o-slotbrain.md

---

## Veredicto

**Aprobar con 4 ajustes antes de empezar.** El plan es sólido, su diagnóstico es correcto (verificado contra el código real del proyecto) y el orden de fases es el adecuado. Los ajustes son los que separan un "bot con más comandos" de un verdadero ayudante del dueño.

---

## 1. Diagnóstico verificado contra el código

- **usuarios_admin sin teléfono:** correcto. La migración v4 no trae columna de teléfono, así que hoy no existe la base para el modo dueño.
- **bot.js solo con tools de cliente (ver_slots, agendar_cita, cancelar_cita, modificar_cita):** correcto. Todo mensaje entrante se trata como cliente.
- **El SÍ de confirmación de recordatorios cae en el vacío:** correcto. En notificaciones.js se pide "Responde SÍ para confirmar o NO", pero en todo el proyecto no existe `pending_reminder`, ni `resolverRol`, ni `avisar_dueno`.

El plan dice la verdad sobre el estado del proyecto.

---

## 2. Fortalezas del plan

- No reescribe nada: bifurca en el mismo entrypoint antes del prompt de cliente.
- Reusa el patrón que ya existe (`pendingBooking`) para el loop SÍ/NO.
- Criterios de aceptación concretos y probables ("dueño pregunta quién viene hoy → lista real").
- Lista explícitamente lo que NO toca (reglas de disponibilidad, dedup, freebusy), que es lo más delicado de romper.
- El orden de fases es correcto: primero saber quién es el dueño, luego darle herramientas, luego cerrar el loop de recordatorios.
- Excluye el canal de voz explícitamente, en coherencia con el plan de voz documentado (audios primero, llamadas después). Son dos planes independientes que comparten número y cerebro.

---

## 3. Ajustes recomendados (los que pide la visión de "ayudante del dueño")

### Ajuste 1: digest diario mínimo dentro del MVP

El plan es reactivo: el dueño pregunta, el agente responde. Lo que hace que se sienta ayudante es la **proactividad mínima**. Las alertas están en el MVP, pero el digest quedó relegado a la Fase D.

**Propuesta:** subir una versión mínima del digest al MVP: un mensaje cada mañana con la agenda del día y los huecos libres. Es barato: ya tiene todas las queries que necesita.

### Ajuste 2: confirmación previa en acciones destructivas o masivas

El plan le da al agente tools que mutan datos (marcar no-show, cancelar, bloquear). Para frases sueltas está bien, pero un dueño puede decir "cancela todo el día de mañana" sin querer.

**Propuesta:** una regla de oro en el prompt de dueño: **acciones destructivas o masivas piden confirmación previa antes de ejecutar.**

### Ajuste 3: log de acciones del modo dueño

Si el agente cambia estados de citas por chat, hace falta un registro simple de lo que hace: qué pidió el dueño, qué cambió, cuándo.

**Propuesta:** log simple de acciones del modo dueño. Ya existe el patrón (`citas.notificaciones` JSONB), es barato y es lo que da confianza para dejarlo actuar. Sin log no hay confianza; sin confianza no se usa como ayudante.

### Ajuste 4: regla de normalización de teléfono definida en la migración v9

La identidad del dueño es el número de teléfono, y los números que llegan del webhook de Meta vienen en formato internacional sin "+" (ej: 57 + celular). El plan dice "normalizado a dígitos" pero no fija la regla exacta.

**Propuesta:** definir desde la migración v9 la regla exacta: guardar siempre con código de país y comparar por dígitos completos (o por terminación, si se prefiere más tolerancia). Si el dueño carga "3001234567" y Meta manda "573001234567", el modo dueño no lo reconoce y el dueño cree que el agente es sordo. **Este es el bug más probable de todo el MVP y se arregla definiendo la normalización desde el día uno.**

---

## 4. Validación del plan ajustado (v2, 1795037801292)

Los 4 ajustes anteriores quedaron bien incorporados en la versión ajustada del plan (digest dentro del MVP, `pending_owner_action` reusando el patrón de `pendingBooking`, tabla `auditoria_agente` append-only, y extensión de `normalizarTelefono` con `codigoPaisDefault`). Quedan dos correcciones antes de implementar:

### 4.1 Corrección SQL: el índice único del teléfono debe ser compuesto

La migración v9 propone índice único parcial en `usuarios_admin.telefono`. Ese índice global impediría que la misma persona sea propietaria de dos negocios (multitenant). **Corrección:** el índice único debe ser compuesto: `unique (empresa_id, telefono)` donde telefono no sea nulo. Es una línea de SQL, pero si se deja como está, el segundo negocio del mismo dueño no podrá guardar su teléfono.

### 4.2 Cambio de Meta: usuarios con username llegan sin número (BSUID)

Meta está desplegando en 2026 los usernames de WhatsApp: cuando un cliente activa su username, su número deja de llegar en el webhook. En su lugar llega un identificador nuevo, el **BSUID** (Business-Scoped User ID), formato `CC.alfanumérico` (ej: `US.13491208655302741918`), distinto por cada par usuario-negocio. Cronología real: los BSUID ya aparecen en los webhooks (desde abril 2026), desde mayo 2026 la API acepta enviar mensajes dirigidos a un BSUID, y desde junio 2026 se despliegan los usernames por países. El campo `from`/`wa_id` puede venir vacío para esos usuarios.

**Qué significa para el plan (afecta a la migración v9 y al webhook):**

1. **El agente siempre puede responder:** sí. Si llega sin número, se responde usando el BSUID como destinatario (la Cloud API ya lo soporta). También sirve contestar dentro de la ventana de 24 horas por la misma conversación. Limitación: los templates de autenticación/OTP no aceptan BSUID (no aplica a una barbería).
2. **El número del cliente solo se guarda si él lo comparte.** Tres vías: (a) si ya hubo interacción con su número en los últimos 30 días, el número sigue llegando en los webhooks aunque active username (la "contact book" de Meta conserva el mapeo número-BSUID); (b) pedirle el número dentro del chat con el botón oficial `REQUEST_CONTACT_INFO`, que requiere su consentimiento; (c) que él mismo lo escriba o mande su tarjeta de contacto.
3. **La continuidad no depende del número:** el BSUID es estable por usuario-negocio, así que el cliente que escribió sin compartir número sigue siendo el mismo al volver a escribir, aunque nunca sepamos su teléfono. Hoy el proyecto identifica clientes solo por teléfono; hay que agregar el BSUID como clave alternativa.
4. **Cambio requerido en la migración v9 (agregar al plan):** columna `bsuid` en `clientes` (y en `usuarios_admin` para el dueño), resolución de identidad por número O por BSUID, y almacenar ambos campos cuando estén disponibles. El handler del webhook no debe asumir que `from` es siempre un número.
5. **Regla para el modo dueño:** el dueño debe NO activar su username en WhatsApp (o mantener interacción reciente por número). Si el dueño oculta su número, el matching por teléfono del modo dueño se rompe. Aclararlo en la instrucción de configuración del dueño.

**Fuentes:** developers.facebook.com (Business-scoped user IDs; webhooks con `user_id`/`from_user_id`; video oficial "WhatsApp Usernames" con el botón REQUEST_CONTACT_INFO y la regla de 30 días), ChatMaxima (actualizaciones 2026: usernames desde 29 jun 2026, "usa el BSUID para responder cuando no tienes el número"), Whapi.cloud y Chatsell (guías de migración a BSUID antes de junio 2026, `from` puede ser nulo), Zendesk y 8x8 (envío por BSUID; OTP requiere número físico, error 131062), GitHub Baileys issue 2516 (cronología abril-mayo-junio 2026 y regla de 30 días de visibilidad del número), n8n community (`messages[].from` y `contacts[].wa_id` ausentes para usuarios con username).

---

## Conclusión

Con los 4 ajustes aplicados y las 2 correcciones de la validación (índice único compuesto + cobertura BSUID en la migración v9), el MVP entrega exactamente la visión de Crhistian: el dueño chatea con su negocio y el agente le responde como ayudante, no como menú.

**Resumen final para el agente que implemente el plan:**

1. Digest diario mínimo dentro del MVP (agenda del día + huecos, cada mañana).
2. Confirmación previa obligatoria en acciones destructivas o masivas.
3. Log simple de acciones del modo dueño (tabla `auditoria_agente`).
4. Regla de normalización de teléfono (con código de país, comparación por dígitos completos) fijada en la migración v9.
5. Índice único compuesto `(empresa_id, telefono)` en `usuarios_admin`, no un índice global por teléfono.
6. Cobertura BSUID: columna `bsuid` en `clientes` y `usuarios_admin`, resolución de identidad por número o BSUID, handler del webhook sin asumir que `from` es un número, e instrucción al dueño de no activar su username de WhatsApp.
