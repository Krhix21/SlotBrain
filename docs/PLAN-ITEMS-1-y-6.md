# Plan de trabajo — Items 1 y 6 del informe de análisis
**Estado:** plan aprobado, SIN código generado todavía
**Fecha:** 2026-11-14
**Alcance:** (1) exposición de credenciales / RLS en Supabase y (6) doble reserva desde el panel.

---

## ITEM 1 — Seguridad: credenciales en la base y RLS

### Objetivo
Que una lectura anónima de la base (con la `SUPABASE_KEY` del entorno o filtrada)
no entregue nunca: `refresh_token` de Google en claro, tokens de sesión válidos,
hashes de contraseña, ni tokens de Meta cifrados.

### Fase A — Auditoría (sin tocar nada) ✋
| # | Tarea | Dónde | Resultado esperado |
|---|-------|-------|--------------------|
| A1 | Determinar qué tipo de key está en `SUPABASE_KEY` del `.env` (anon vs service_role) | Supabase Dashboard → Settings → API | Confirmar si el código habla con la DB como anónimo o como administrador |
| A2 | Listar el estado real de RLS tabla por tabla | Dashboard → Table Editor → cada tabla de `public` | Matriz: tabla / RLS on-off / políticas existentes |
| A3 | Inventario de columnas sensibles | `trabajadores.refresh_token`, `sesiones_admin.token`, `usuarios_admin.password_hash`, `numeros_bot.meta_token_cifrado`, `conversaciones.*` (teléfonos, historial), `citas.*` (datos personales) | Lista con clasificación de riesgo (alto/medio/bajo) |
| A4 | Comprobar el alcance de la key: intentar leer (desde el Dashboard como rol `anon`) una fila de `trabajadores` y de `sesiones_admin` | SQL queries de solo lectura | Prueba de fuego: ¿un anonkey puede SELECT real o no? |

**Salida de la Fase A:** nota de hallazgos en `docs/` con la matriz A2 y la
conclusión: *¿hay fuga activa o la key ya es service_role con RLS denegando anon?*
Si NO hay fuga (RLS correcto), el item baja de crítico a duro y se hace igual
la parte de cifrado (Fase C), pero sin urgencia de incendio.

### Fase B — Cerrar el agujero (si la auditoría confirma riesgo)
- B1: Asegurar RLS **deny-by-default** en todas las tablas del esquema público
  (habilitar RLS sin políticas = nadie puede leer por la API anónima; el servidor
  sigue operando con `service_role`, que la salta).
- B2: Verificar que el despliegue (Render) tenga la `service_role` SOLO como
  variable de entorno del servicio — nunca en `public/`, nunca en el bundle del
  panel.
- B3: Documentar en el README el contrato: *"el servidor es el único cliente
  válido de la DB; ningún front-facing code usa la key"*. Ajustar el comentario
  de `.env.example` que hoy dice "la anon key es pública y cualquiera puede
  leer las tablas" — con RLS deny-by-default esa frase queda obsoleta/mengante.

### Fase C — Defensa en profundidad (independiente del resultado de A)
- C1: **Cifrar `trabajadores.refresh_token`** con el utilitario que ya existe
  (`tokensMeta.js`, AES-256-GCM + `APP_ENCRYPTION_KEY`):
  - migración con re-cifrado en lotes de los tokens ya guardados (script de una
    sola corrida, idempotente);
  - los 4 puntos que leen/escriben el token deben actualizarse:
    `auth.js` (callback, escritura), `googleAuth.js` (lectura → descifrar),
    `notificaciones.js` e `index` implícito por `disponibilidad.js` (usan el
    token vía `googleAuth`), `admin.js:desconectarCalendar` (pone null);
  - plan de contingencia: si `APP_ENCRYPTION_KEY` se pierde, los profesionales
    re-vinculan calendario desde el panel (flujo ya existe).
- C2: **Hashear `sesiones_admin.token`** (SHA-256) en lugar de guardarlo en
    claro: el panel presenta el token en crudo, el servidor hashea y compara.
    Efecto colateral: las sesiones activas se invalidan al migrar (una desconexión
    única del panel — aceptable, comunicarlo en el changelog).
- C3: Decidir si `password_hash` se queda como está (bcrypt: aceptable) —
    nota: con RLS deny-by-default ya no es alcanzable por anon; no requiere cambio.

### Fase D — Verificación
- D1: Re-ejecutar la prueba A4: lectura `trabajadores` y `sesiones_admin` con
  `anon` debe devolver 0 filas / 403.
- D2: Prueba funcional del flujo OAuth: vincular calendario → agendar →
  recordatorio, todo con el token cifrado en DB.
- D3: Prueba de login de panel antes/después de la migración de sesiones.
- D4: Chequeo de que `GET /api/admin/*` no exponga en ningún payload campos de
  credenciales (auditar los `select(...)` explícitos que ya existen).

### Criterio de terminado (Item 1)
> Con la key del entorno filtrada, un atacante obtiene CERO credenciales útiles:
> ni refresh tokens (cifrados), ni sesiones (hasheadas), ni lectura posible
> (RLS deny-by-default). El flujo de vinculación de Calendar y el login del panel
> siguen funcionando.

### Riesgos y orden de ejecución
- Orden obligatorio: A → B → (deploy estable) → C → D. Nunca C antes de A/B:
  el cifrado del refresh_token toca el corazón del agendado.
- Riesgo mayor: perder `APP_ENCRYPTION_KEY` → todos los refresh tokens
  inutilizables. Mitigación: backup de la key en el gestor de secretos ANTES de
  correr el re-cifrado.
- Ventana de migración C1: hacerla fuera de horario operativo (los profesionales
  con calendario enlazado no agendan durante el re-cifrado, pocos minutos).

---

## ITEM 6 — Doble reserva: citas del panel invisibles para el motor de slots

### Problema (resumen del análisis)
1. `admin.js:createCita` guarda la cita en `citas` con `canal:'panel'` pero **sin
   evento en Google Calendar** → `disponibilidad.js` (freebusy) no la ve y el bot
   puede ofrecer esa hora.
2. No existe ninguna restricción en la base que impida dos filas vigentes
   `(trabajador_id, fecha, hora)` — la carrera se resuelve hoy solo con
   freebusy + re-check, que no cubre lo nacido del panel.

### Decisión de diseño pendiente (única que necesita al dueño)
| Opción | Qué hace | Pro | Contra |
|--------|----------|-----|--------|
| **A — Evento Google para citas del panel** | `createCita` pasa por el mismo camino que `calendar.agendarCita` (con `confirmarSlot` + evento real) | Fuente de verdad única; freebusy lo resuelve todo | El profesional debe tener Calendar enlazado; cita "manual" sin calendario es imposible |
| **B — Fuente de verdad local** | El motor de slots consulta también la tabla `citas` (vigentes del trabajador en la fecha), y se agrega un índice único parcial | Funciona sin calendario enlazado; el panel es soberano | Doble verificación (freebusy + citas locales); más lecturas |
| **A+B (recomendada)** | B como garantía dura (constraint en DB) + A como mejora UX cuando hay Calendar | Seguridad total; lo manual convive con Google | Un poco más de trabajo |

> **Recomendación del plan:** A+B. B sola ya elimina la doble reserva (es la
> garantía mínima); A se puede dejar para un segundo momento.

### Fases (sin código en este documento)
- F1 — **Garantía en la base** (migración v8, idempotente, con `_bak_citas`):
  - índice único parcial sobre `citas(trabajador_id, fecha, hora)` filtrando
    `estado IN ('agendada','confirmada')` y `trabajador_id IS NOT NULL`;
  - estudio previo del histórico: SELECT de duplicados existentes ANTES de crear
    el índice (si hay duplicados reales, el plan define: se marcan
    `no_asistio`/`cancelada` a mano con el dueño, no se borra nada);
  - el INSERT del bot (`calendar.js:agendarCita`) y del panel (`admin.js:createCita`)
    deben manejar el error de constraint (23505) como "esa hora ya está tomada"
    con mensaje legible — mismo tono que el resto de los errores.
- F2 — **Motor de disponibilidad local-aware**:
  - `disponibilidad.js:slotsDeTrabajador` y `confirmarSlot` consultan en paralelo
    (ya hacen `Promise.all`) las citas vigentes de la fecha para ese trabajador y
    las restan como un bloque más — mismo formato de intervalo que los `bloqueos`;
  - sin cambios de semántica en `freebusy`: esto se suma, no reemplaza.
- F3 — **Coherencia con Google (opción A, segunda iteración)**:
  - si el trabajador tiene Calendar enlazado, `createCita` desde el panel crea el
    evento y guarda `evento_google_id` (reutilizando `calendar.js`);
  - si no tiene, la cita queda `canal:'panel'` sin evento — ahora visible para el
    bot gracias a F2.
- F4 — **Verificación**:
  - caso 1: cita manual 10:00 → bot ofrece horas → 10:00 NO aparece;
  - caso 2: cliente reserva 10:00 por WhatsApp → intento de cita manual 10:00 →
    rechazado con mensaje claro;
  - caso 3: dos reservas simultáneas por WhatsApp en el mismo slot (simulación de
    carrera) → exactamente una gana (el constraint como red final);
  - caso 4: mover/cancelar deja de bloquear el slot (el índice es parcial por
    estado, el histórico cancelado no interfiere);
  - caso 5: empresa con 2 profesionales: slot libre en uno, tomado en el otro →
    solo se oculta la hora del ocupado.

### Criterio de terminado (Item 6)
> Es imposible materialmente que existan dos citas vigentes del mismo profesional
> en la misma hora, venga la reserva del bot, del panel o de dos clientes a la
> vez — garantizado por la base, no solo por la verificación de Google.

---

## Orden integrado sugerido (ambos items)

| Sem | Qué | Por qué en este orden |
|-----|-----|----------------------|
| 1 | Item 1 Fase A (auditoría RLS/key) | Sin datos no se sabe si hay incendio; no toca nada |
| 2 | Item 1 Fase B (RLS deny-by-default) | Es la que corta la fuga si existe; deploy inmediato |
| 3 | Item 6 F1 (constraint único) + F2 | Integridad del negocio; independiente del item 1; migración pequeña |
| 4 | Item 1 Fase C (cifrado refresh + hash sesiones) | Requiere plan de re-cifrado y ventana de migración |
| 5 | Item 6 F3 (evento Google desde panel) | Mejora, no garantía; la garantía quedó en F1/F2 |

Estimativa a bulto: A/B = medio día; F1+F2 = un día; C = un día + migración;
F3 = un día. Todo pasa por verificación de cada fase antes de subir la siguiente.

**Este documento es el plan. Ningún archivo de código fue modificado ni generado.**
