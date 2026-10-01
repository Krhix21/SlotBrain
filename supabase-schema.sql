-- ============================================================
-- Esquema v2 completo: Meta WhatsApp Cloud API + N profesionales
--
-- Este archivo es para una base NUEVA. Si ya tienes la base del
-- sistema v1 en producción, NO lo ejecutes de golpe: usa
-- supabase-migracion-v2.sql y luego supabase-migracion-v3-dedup.sql,
-- que están escritos para no romper los datos que ya tienes.
--
-- Diferencias clave respecto a v1:
--   · Un número de WhatsApp pertenece a una EMPRESA (numeros_bot),
--     no a un trabajador. Por eso un mismo número puede atender a
--     varios profesionales.
--   · Cada profesional tiene su propio Google Calendar (refresh_token).
--   · Los horarios se calculan de verdad: horario de la empresa, override
--     del profesional, bloques de librebusy y ausencias registradas.
--   · El estado conversacional vive en la base, no en un JSON en disco.
--   · El webhook deduplica por message_id.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1) Empresas
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS empresas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    telefono TEXT,
    direccion TEXT,
    -- Zona IANA, no offset fijo. Determina cómo se convierte "10:00"
    -- a UTC, incluyendo el horario de verano.
    zona_horaria TEXT DEFAULT 'America/Bogota',
    -- {"lun":[["09:00","18:00"]], ..., "dom":[]}
    horario JSONB DEFAULT
      '{"lun":[["09:00","18:00"]],"mar":[["09:00","18:00"]],"mie":[["09:00","18:00"]],
        "jue":[["09:00","18:00"]],"vie":[["09:00","18:00"]],"sab":[["09:00","14:00"]],"dom":[]}'::jsonb,
    slot_minutos INT DEFAULT 30,
    mensaje_bienvenida TEXT DEFAULT '¡Hola! Bienvenido a {nombre_negocio}. 👋 Soy tu asesor virtual. ¿Cómo te llamas?',
    mensaje_confirmacion TEXT DEFAULT '¡Listo {nombre}! Tu cita de {servicio} quedó agendada para el {fecha} a las {hora} con {profesional}. Te esperamos en {nombre_negocio}.',
    activo BOOLEAN DEFAULT true,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════
-- 2) Números de respuesta
--
-- `telefono` es el display_phone_number de Meta, solo dígitos y sin "+".
-- `phone_number_id` es el identificador con el que se manda cada mensaje.
--
-- El TOKEN NO ESTÁ AQUÍ. Va en las variables de entorno del servidor
-- (META_TOKENS_JSON), porque es una credencial y no un dato de negocio.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS numeros_bot (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    telefono TEXT NOT NULL UNIQUE,
    phone_number_id TEXT NOT NULL,
    etiqueta TEXT,
    activo BOOLEAN DEFAULT true,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════
-- 3) Servicios
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS servicios (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    precio INTEGER NOT NULL,
    duracion_minutos INTEGER NOT NULL DEFAULT 60,
    activo BOOLEAN DEFAULT true,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════
-- 4) Profesionales
--
-- `telefono_bot` se conserva por compatibilidad, pero queda SIEMPRE en
-- NULL: el número que responde es el de la empresa (numeros_bot).
-- Varios NULL en una columna UNIQUE es válido en PostgreSQL, así que
-- el índice único no estorba.
--
-- `correo` y `refresh_token` los escribe únicamente el callback de
-- Google (auth.js), nunca el panel de administración.
--
-- `horario` y `slot_minutos` en NULL = heredar los de la empresa.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS trabajadores (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    telefono_bot TEXT UNIQUE,
    telefono TEXT,
    correo TEXT,
    refresh_token TEXT,
    empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL,
    nombre TEXT,
    horario JSONB,
    slot_minutos INT,
    orden SMALLINT DEFAULT 0,
    activo BOOLEAN DEFAULT true,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trabajadores_telefono
    ON trabajadores(telefono) WHERE telefono IS NOT NULL;


-- ════════════════════════════════════════════════════════════
-- 5) Qué servicios ejecuta cada profesional
--
-- Tabla VACÍA = todos los profesionales ofrecen todos los servicios.
-- En cuanto tenga al menos una fila, el motor de disponibilidad filtra
-- por esa asignación. Es la razón por la que el panel tiene el botón
-- "Servicios" con la opción de dejarlo vacío.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS servicios_trabajadores (
    trabajador_id UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    servicio_id UUID NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
    PRIMARY KEY (trabajador_id, servicio_id)
);


-- ════════════════════════════════════════════════════════════
-- 6) Ausencias y excepciones
--
-- hora_inicio NULL = el día entero está bloqueado.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bloqueos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    trabajador_id UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    hora_inicio TEXT,
    hora_fin TEXT,
    motivo TEXT,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════
-- 7) Citas
--
-- Esta tabla es la fuente de verdad. Cancelar y mover se hacen por
-- `id` y `evento_google_id`, nunca buscando por el nombre del cliente
-- dentro del calendario.
--
-- `inicio_utc` es el instante real en UTC; `fecha` + `hora` son la
-- hora de pared en la zona de la empresa.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS citas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    trabajador_id UUID REFERENCES trabajadores(id) ON DELETE SET NULL,
    nombre_cliente TEXT NOT NULL,
    telefono_cliente TEXT,
    servicio_id UUID REFERENCES servicios(id) ON DELETE SET NULL,
    nombre_servicio TEXT NOT NULL,
    fecha DATE NOT NULL,
    hora TEXT NOT NULL,
    duracion_minutos INT,
    inicio_utc TIMESTAMP WITH TIME ZONE,
    evento_google_id TEXT,
    estado TEXT DEFAULT 'agendada',
    canal TEXT DEFAULT 'whatsapp',
    cancelado_por TEXT,
    motivo_cancelacion TEXT,
    notas TEXT,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- agendada | confirmada | completada | cancelada | no_asistio
    CONSTRAINT citas_estado_valido CHECK (
        estado IS NULL OR estado IN ('agendada','confirmada','completada','cancelada','no_asistio')
    ),
    CONSTRAINT citas_hora_formato CHECK (hora ~ '^[0-2][0-9]:[0-5][0-9]$')
);


-- ════════════════════════════════════════════════════════════
-- 8) Conversaciones
--
-- Una fila por par (número del bot, cliente). Solo se guardan los
-- últimos 6 mensajes, recortados a 500 caracteres, para no gastar
-- cuota de Supabase ni mandar 5000 caracteres al modelo en cada turno.
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
-- 9) Deduplicación de webhooks
--
-- Meta reintenta el POST si la respuesta tarda. Sin esto, un "sí"
-- del cliente terminaba agendando dos citas. La clave primaria es el
-- message_id de Meta (wamid.*), que es globalmente único.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mensajes_webhook (
    message_id TEXT PRIMARY KEY,
    telefono_bot TEXT,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════
-- 10) Índices
-- ════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_servicios_empresa      ON servicios(empresa_id);
CREATE INDEX IF NOT EXISTS idx_trabajadores_empresa    ON trabajadores(empresa_id);
CREATE INDEX IF NOT EXISTS idx_numeros_bot_empresa    ON numeros_bot(empresa_id);
CREATE INDEX IF NOT EXISTS idx_numeros_bot_activo     ON numeros_bot(activo);
CREATE INDEX IF NOT EXISTS idx_bloqueos_trabajador    ON bloqueos(trabajador_id, fecha);
CREATE INDEX IF NOT EXISTS idx_citas_empresa          ON citas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_citas_trabajador       ON citas(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_citas_fecha            ON citas(fecha, hora);
CREATE INDEX IF NOT EXISTS idx_citas_estado           ON citas(estado);
CREATE INDEX IF NOT EXISTS idx_citas_trab_fecha       ON citas(trabajador_id, fecha, estado);
CREATE INDEX IF NOT EXISTS idx_citas_cliente          ON citas(empresa_id, telefono_cliente);
CREATE INDEX IF NOT EXISTS idx_conversaciones_cliente ON conversaciones(telefono_bot, telefono_cliente);
CREATE INDEX IF NOT EXISTS idx_conversaciones_fecha   ON conversaciones(actualizado_en);
CREATE INDEX IF NOT EXISTS idx_mensajes_webhook_creado ON mensajes_webhook(creado_en);


-- ════════════════════════════════════════════════════════════
-- 11) Triggers de actualizado_en
--
-- En la base v1 esta función NO existía, por lo que ninguna de las
-- tablas actualizaba su timestamp. Aquí se crea desde el inicio.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_empresas_actualizado      ON empresas;
CREATE TRIGGER trigger_empresas_actualizado
    BEFORE UPDATE ON empresas FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

DROP TRIGGER IF EXISTS trigger_servicios_actualizado      ON servicios;
CREATE TRIGGER trigger_servicios_actualizado
    BEFORE UPDATE ON servicios FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

DROP TRIGGER IF EXISTS trigger_trabajadores_actualizado   ON trabajadores;
CREATE TRIGGER trigger_trabajadores_actualizado
    BEFORE UPDATE ON trabajadores FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

DROP TRIGGER IF EXISTS trigger_numeros_bot_actualizado    ON numeros_bot;
CREATE TRIGGER trigger_numeros_bot_actualizado
    BEFORE UPDATE ON numeros_bot FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

DROP TRIGGER IF EXISTS trigger_citas_actualizado          ON citas;
CREATE TRIGGER trigger_citas_actualizado
    BEFORE UPDATE ON citas FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();


-- ════════════════════════════════════════════════════════════
-- 12) Comprobaciones
--
-- Ejecuta esto al terminar. Todas deben dar 0 filas.
-- ════════════════════════════════════════════════════════════

-- Citas sin empresa válida:
-- SELECT * FROM citas WHERE empresa_id IS NULL;

-- Citas sin profesional asignado (deben existir, pero conviene verlas):
-- SELECT id, nombre_cliente, fecha, hora FROM citas WHERE trabajador_id IS NULL;

-- Citas huérfanas por servicio borrado:
-- SELECT c.id, c.nombre_servicio FROM citas c
-- LEFT JOIN servicios s ON s.id = c.servicio_id
-- WHERE c.servicio_id IS NOT NULL AND s.id IS NULL;
