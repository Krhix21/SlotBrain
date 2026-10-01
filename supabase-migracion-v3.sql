-- ════════════════════════════════════════════════════════════
-- Migración v3
--
-- Ejecutar DESPUÉS de supabase-migracion-v2.sql. Es idempotente:
-- se puede correr las veces que haga falta.
--
-- Contiene dos cosas:
--   1) Deduplicación de webhooks
--   2) Restricción de formato de la hora en `citas`
-- ════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════
-- 1) Deduplicación de webhooks
--
-- Por qué: Meta reintenta el POST del webhook si la respuesta tarda
-- más de unos segundos, y a veces entrega el mismo mensaje dos veces.
-- Con el bot v1 eso significaba que un "sí" del cliente terminaba
-- agendando DOS citas, porque agendar_cita se ejecutaba dos veces.
--
-- Cómo funciona: antes de procesar, insertamos el message_id. Si el
-- INSERT choca con el duplicado, el mensaje ya se atenderió y lo
-- descartamos. La clave primaria es el message_id de Meta (wamid.*),
-- que es globalmente único.
--
-- Nota: solo pasan por aquí los mensajes ENTRANTES. Los que genera el
-- bot no se registran, así que la tabla no crece por encima de lo que
-- escriben los clientes y el borrado diario alcanza.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mensajes_webhook (
    message_id    TEXT PRIMARY KEY,
    telefono_bot  TEXT,
    creado_en     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mensajes_webhook_creado ON mensajes_webhook(creado_en);


-- ════════════════════════════════════════════════════════════
-- 2) La hora de `citas` debe ser "HH:MM" de verdad
--
-- Antes, el bot escribía la hora tal como se la daba el modelo, así
-- que podían quedar filas con "9:00", "9:00 AM" o "9" y después los
-- cálculos de disponibilidad se descuadraban.
--
-- Se agrega como NOT VALID a propósito: las filas viejas no se
-- comprueban hasta que hagas VALIDATE CONSTRAINT, así que la
-- migración no falla aunque haya datos feos de antes.
-- ════════════════════════════════════════════════════════════

-- Primero mira si hay filas que no cumplirían la regla:
-- SELECT id, fecha, hora FROM citas WHERE hora !~ '^[0-2][0-9]:[0-5][0-9]$' LIMIT 20;

ALTER TABLE citas DROP CONSTRAINT IF EXISTS citas_hora_formato;
ALTER TABLE citas
    ADD CONSTRAINT citas_hora_formato
    CHECK (hora ~ '^[0-2][0-9]:[0-5][0-9]$') NOT VALID;


-- ════════════════════════════════════════════════════════════
-- 3) "miem" era una clave mal escrita del miércoles
--
-- El código busca el miércoles como "mie" (tiempo.js DIAS_SEMANA),
-- pero el horario por defecto que se guardó usaba "miem". El efecto:
-- toda empresa creada con el valor por defecto quedaba SIN ventanas
-- los miércoles, porque horario['mie'] venía vacío.
--
-- Se renombra la clave en los datos. -'miem' quita la clave; +'mie' la
-- pone. Solo toca filas que tengan el error, así que es inofensivo
-- en empresas que ya lo tienen bien.
-- ════════════════════════════════════════════════════════════

-- Para ver a quién afecta:
-- SELECT id, nombre, horario->'mie' AS mie, horario->'miem' AS miem
-- FROM empresas WHERE horario ? 'miem';

UPDATE empresas
   SET horario = (horario - 'miem') || jsonb_build_object(
           'mie', COALESCE(horario->'mie', horario->'miem', '[["09:00","18:00"]]'::jsonb))
 WHERE horario ? 'miem';

-- Verifica que no quede ninguna:
-- SELECT count(*) FROM empresas WHERE horario ? 'miem';


-- ════════════════════════════════════════════════════════════
-- 4) Índices que faltaban
-- ════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_citas_cliente
    ON citas(empresa_id, telefono_cliente);

CREATE INDEX IF NOT EXISTS idx_conversaciones_fecha
    ON conversaciones(actualizado_en);

CREATE INDEX IF NOT EXISTS idx_numeros_bot_activo
    ON numeros_bot(activo);


-- ════════════════════════════════════════════════════════════
-- Comprobaciones
--
-- La primera debe dar 0 filas.
-- Las de citas con hora rara te dicen si conviene arreglar datos viejos
-- antes de validar la restricción.
-- ════════════════════════════════════════════════════════════

-- SELECT * FROM mensajes_webhook;

-- SELECT count(*) FROM empresas WHERE horario ? 'miem';   -- debe dar 0

-- SELECT id, fecha, hora FROM citas WHERE hora !~ '^[0-2][0-9]:[0-5][0-9]$';

-- Cuando ya hayas corregido las horas raras, activa el chequeo completo:
-- ALTER TABLE citas VALIDATE CONSTRAINT citas_hora_formato;
