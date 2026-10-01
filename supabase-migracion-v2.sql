-- ============================================================
-- supabase-migracion-v2.sql
--
-- Migración incremental para bases creadas con supabase-schema.sql (v1)
-- que quedó incompleta: sin función de triggers, sin triggers, sin índices,
-- y sin PRIMARY KEY ni FOREIGN KEYS en la tabla `citas`.
--
-- IDEMPOTENTE: se puede correr varias veces sin romper nada.
--
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 0) Respaldo de todo lo que existe antes de tocarlo
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS _bak_trabajadores_v1 AS SELECT * FROM trabajadores;
CREATE TABLE IF NOT EXISTS _bak_citas_v1       AS SELECT * FROM citas;
CREATE TABLE IF NOT EXISTS _bak_empresas_v1    AS SELECT * FROM empresas;
CREATE TABLE IF NOT EXISTS _bak_servicios_v1   AS SELECT * FROM servicios;


-- ════════════════════════════════════════════════════════════
-- 1) Función de timestamps
--    ESTA FUNCIÓN NO EXISTÍA: por eso no hay ningún trigger activo
--    y `actualizado_en` nunca se actualiza solo.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ════════════════════════════════════════════════════════════
-- 2) PRIMARY KEY que le falta a la tabla `citas`
-- ════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'citas'::regclass AND contype = 'p'
    ) THEN
        -- Saneamos duplicados por id antes de crear la clave primaria
        DELETE FROM citas WHERE ctid NOT IN (SELECT MIN(ctid) FROM citas GROUP BY id);
        ALTER TABLE citas ADD CONSTRAINT citas_pkey PRIMARY KEY (id);
        RAISE NOTICE 'OK: citas_pkey creada';
    ELSE
        RAISE NOTICE 'SKIP: citas ya tenía primary key';
    END IF;
END $$;


-- ════════════════════════════════════════════════════════════
-- 3) FOREIGN KEYS que le faltan a la tabla `citas`
--    Si falla con "violates foreign key constraint", ejecuta antes
--    la consulta de huérfanos que está al final de este archivo.
-- ════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'citas_empresa_id_fkey') THEN
        ALTER TABLE citas ADD CONSTRAINT citas_empresa_id_fkey
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;
        RAISE NOTICE 'OK: cita -> empresa';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'citas_trabajador_id_fkey') THEN
        ALTER TABLE citas ADD CONSTRAINT citas_trabajador_id_fkey
        FOREIGN KEY (trabajador_id) REFERENCES trabajadores(id) ON DELETE SET NULL;
        RAISE NOTICE 'OK: cita -> trabajador';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'citas_servicio_id_fkey') THEN
        ALTER TABLE citas ADD CONSTRAINT citas_servicio_id_fkey
        FOREIGN KEY (servicio_id) REFERENCES servicios(id) ON DELETE SET NULL;
        RAISE NOTICE 'OK: cita -> servicio';
    END IF;
END $$;


-- ════════════════════════════════════════════════════════════
-- 4) Números de respuesta por empresa
--    Un número de WhatsApp pertenece a la EMPRESA, no al trabajador.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS numeros_bot (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    telefono TEXT NOT NULL UNIQUE,     -- display_phone_number de Meta, normalizado (solo dígitos)
    phone_number_id TEXT NOT NULL,     -- Phone Number ID de Meta
    etiqueta TEXT,                     -- 'principal', 'pruebas'
    activo BOOLEAN DEFAULT true,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════
-- 5) Horario de atención de la empresa
--    Formato JSONB: { "lun": [["09:00","18:00"]], "dom": [] }
-- ════════════════════════════════════════════════════════════

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS horario JSONB DEFAULT
  '{"lun":[["09:00","18:00"]],"mar":[["09:00","18:00"]],"mie":[["09:00","18:00"]],
    "jue":[["09:00","18:00"]],"vie":[["09:00","18:00"]],"sab":[["09:00","14:00"]],"dom":[]}'::jsonb;

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS slot_minutos INT DEFAULT 30;


-- ════════════════════════════════════════════════════════════
-- 6) LIBERAR telefono_bot
--    Este es el cambio que permite registrar N trabajadores para
--    un mismo número de bot.
--
--    El UNIQUE 'trabajadores_telefono_bot_key' se mantiene a propósito:
--    en PostgreSQL varios NULL dentro de una columna UNIQUE son válidos.
-- ════════════════════════════════════════════════════════════

ALTER TABLE trabajadores ALTER COLUMN telefono_bot DROP NOT NULL;

UPDATE trabajadores SET telefono_bot = NULL WHERE telefono_bot IS NOT NULL;


-- ════════════════════════════════════════════════════════════
-- 7) Trabajadores: horario propio, WhatsApp personal, orden
--    horario / slot_minutos en NULL = heredar los de la empresa
-- ════════════════════════════════════════════════════════════

ALTER TABLE trabajadores ADD COLUMN IF NOT EXISTS horario JSONB;
ALTER TABLE trabajadores ADD COLUMN IF NOT EXISTS slot_minutos INT;
ALTER TABLE trabajadores ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE trabajadores ADD COLUMN IF NOT EXISTS orden SMALLINT DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trabajadores_telefono
    ON trabajadores(telefono) WHERE telefono IS NOT NULL;


-- ════════════════════════════════════════════════════════════
-- 8) Qué servicios ejecuta cada trabajador
--    Tabla VACÍA = todos los trabajadores ofrecen todos los servicios.
--    En cuanto tenga filas, el motor filtra por esa asignación.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS servicios_trabajadores (
    trabajador_id UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    servicio_id UUID NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
    PRIMARY KEY (trabajador_id, servicio_id)
);


-- ════════════════════════════════════════════════════════════
-- 9) Excepciones de disponibilidad
--    Hoy la tabla queda vacía. Es el destino del futuro comando
--    "no voy a estar disponible el jueves" que el trabajador le
--    escriba al bot.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bloqueos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    trabajador_id UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    hora_inicio TEXT,                   -- NULL = el día entero
    hora_fin TEXT,
    motivo TEXT,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════
-- 10) Citas completas (base del panel futuro)
--     telefono_cliente y servicio_id YA EXISTEN en la tabla;
--     lo que falta es llenarlos desde el código.
-- ════════════════════════════════════════════════════════════

ALTER TABLE citas ADD COLUMN IF NOT EXISTS canal TEXT DEFAULT 'whatsapp';
ALTER TABLE citas ADD COLUMN IF NOT EXISTS cancelado_por TEXT;          -- 'cliente' | 'admin'
ALTER TABLE citas ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT;
ALTER TABLE citas ADD COLUMN IF NOT EXISTS duracion_minutos INT;
ALTER TABLE citas ADD COLUMN IF NOT EXISTS inicio_utc TIMESTAMP WITH TIME ZONE;

-- Estados válidos esperados por el código:
--   agendada | confirmada | completada | cancelada | no_asistio


-- ════════════════════════════════════════════════════════════
-- 11) Conversaciones en Supabase
--     Reemplaza el archivo conversaciones.json, que en Render se
--     pierde en cada deploy y además se reescribe completo en cada
--     mensaje (condición de carrera con mensajes simultáneos).
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS conversaciones (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    telefono_bot TEXT NOT NULL,
    telefono_cliente TEXT NOT NULL,
    user_name TEXT,
    mensajes JSONB DEFAULT '[]'::jsonb,
    ultima_cita JSONB,
    pending_booking JSONB,
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (telefono_bot, telefono_cliente)
);


-- ════════════════════════════════════════════════════════════
-- 12) Índices
--     La base actual no tiene ninguno: todos se crean aquí.
-- ════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_servicios_empresa      ON servicios(empresa_id);
CREATE INDEX IF NOT EXISTS idx_trabajadores_empresa    ON trabajadores(empresa_id);
CREATE INDEX IF NOT EXISTS idx_numeros_bot_empresa    ON numeros_bot(empresa_id);
CREATE INDEX IF NOT EXISTS idx_bloqueos_trabajador    ON bloqueos(trabajador_id, fecha);
CREATE INDEX IF NOT EXISTS idx_citas_empresa          ON citas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_citas_trabajador       ON citas(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_citas_fecha            ON citas(fecha, hora);
CREATE INDEX IF NOT EXISTS idx_citas_estado           ON citas(estado);
CREATE INDEX IF NOT EXISTS idx_citas_trab_fecha       ON citas(trabajador_id, fecha, estado);
CREATE INDEX IF NOT EXISTS idx_conversaciones_cliente ON conversaciones(telefono_bot, telefono_cliente);


-- ════════════════════════════════════════════════════════════
-- 13) Triggers
--     Ninguno existía. Se usa DROP ... IF EXISTS para poder
--     reejecutar la migración sin fallar.
-- ════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trigger_empresas_actualizado     ON empresas;
CREATE TRIGGER trigger_empresas_actualizado
    BEFORE UPDATE ON empresas FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

DROP TRIGGER IF EXISTS trigger_servicios_actualizado    ON servicios;
CREATE TRIGGER trigger_servicios_actualizado
    BEFORE UPDATE ON servicios FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

DROP TRIGGER IF EXISTS trigger_trabajadores_actualizado ON trabajadores;
CREATE TRIGGER trigger_trabajadores_actualizado
    BEFORE UPDATE ON trabajadores FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

DROP TRIGGER IF EXISTS trigger_citas_actualizado        ON citas;
CREATE TRIGGER trigger_citas_actualizado
    BEFORE UPDATE ON citas FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

DROP TRIGGER IF EXISTS trigger_numeros_bot_actualizado  ON numeros_bot;
CREATE TRIGGER trigger_numeros_bot_actualizado
    BEFORE UPDATE ON numeros_bot FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();


-- ════════════════════════════════════════════════════════════
-- 14) Verificación final
--     Debe devolver 5 triggers, 1 PK en citas y 3 FKs en citas.
-- ════════════════════════════════════════════════════════════

SELECT c.relname AS tabla, con.conname, con.contype
FROM pg_class c
LEFT JOIN pg_constraint con ON con.conrelid = c.oid
WHERE c.relname IN ('empresas', 'servicios', 'trabajadores', 'citas', 'numeros_bot')
  AND con.contype IN ('p', 'f', 'u')
ORDER BY c.relname, con.contype;

SELECT tgname, relname AS tabla
FROM pg_trigger t
JOIN pg_class rel ON rel.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND relname IN ('empresas', 'servicios', 'trabajadores', 'citas', 'numeros_bot')
ORDER BY relname, tgname;

-- Trabajadores tras la migración: telefono_bot debe quedar en NULL
SELECT id, nombre, telefono_bot, correo, empresa_id, activo, telefono, horario
FROM trabajadores
ORDER BY nombre;

-- Las empresas heredan el horario por defecto
SELECT id, nombre, zona_horaria, slot_minutos, horario FROM empresas;


-- ============================================================
-- Si el paso 3 (FOREIGN KEYS) falla con error de violación,
-- ejecuta primero esta consulta para ver las filas huérfanas:
--
-- SELECT 'empresa' AS ref, id, empresa_id FROM citas
--   WHERE empresa_id IS NOT NULL AND empresa_id NOT IN (SELECT id FROM empresas)
-- UNION ALL
-- SELECT 'trabajador', id, trabajador_id FROM citas
--   WHERE trabajador_id IS NOT NULL AND trabajador_id NOT IN (SELECT id FROM trabajadores)
-- UNION ALL
-- SELECT 'servicio', id, servicio_id FROM citas
--   WHERE servicio_id IS NOT NULL AND servicio_id NOT IN (SELECT id FROM servicios);
--
-- Si devuelve filas, o las borras, o pones sus referencias en NULL:
--
-- UPDATE citas SET empresa_id = NULL    WHERE empresa_id    IS NOT NULL AND empresa_id    NOT IN (SELECT id FROM empresas);
-- UPDATE citas SET trabajador_id = NULL  WHERE trabajador_id IS NOT NULL AND trabajador_id NOT IN (SELECT id FROM trabajadores);
-- UPDATE citas SET servicio_id = NULL    WHERE servicio_id   IS NOT NULL AND servicio_id   NOT IN (SELECT id FROM servicios);
-- ============================================================
