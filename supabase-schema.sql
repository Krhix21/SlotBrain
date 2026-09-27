-- ============================================
-- Esquema de base de datos para sistema multiservicio
-- ============================================

-- Tabla de empresas (negocios)
CREATE TABLE IF NOT EXISTS empresas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    telefono TEXT,
    direccion TEXT,
    zona_horaria TEXT DEFAULT 'America/Bogota',
    mensaje_bienvenida TEXT DEFAULT '¡Hola! Bienvenido a {nombre_negocio}. 👋 Soy tu asesor virtual. ¿Podrías decirme tu nombre para atenderte de manera más personal?',
    mensaje_confirmacion TEXT DEFAULT '¡Perfecto {nombre}! Ya quedó agendada tu cita de {servicio} para el {fecha} a las {hora}. Te esperamos en {nombre_negocio}.',
    activo BOOLEAN DEFAULT true,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla de servicios (relacionados con empresas)
CREATE TABLE IF NOT EXISTS servicios (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    precio INTEGER NOT NULL, -- en COP
    duracion_minutos INTEGER NOT NULL DEFAULT 60,
    activo BOOLEAN DEFAULT true,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla de trabajadores (profesionales independientes)
CREATE TABLE IF NOT EXISTS trabajadores (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    telefono_bot TEXT NOT NULL UNIQUE,
    correo TEXT,
    refresh_token TEXT,
    empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL,
    nombre TEXT,
    activo BOOLEAN DEFAULT true,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla de citas (historial)
CREATE TABLE IF NOT EXISTS citas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
    trabajador_id UUID REFERENCES trabajadores(id) ON DELETE SET NULL,
    nombre_cliente TEXT NOT NULL,
    telefono_cliente TEXT,
    servicio_id UUID REFERENCES servicios(id) ON DELETE SET NULL,
    nombre_servicio TEXT NOT NULL,
    fecha DATE NOT NULL,
    hora TEXT NOT NULL, -- formato HH:MM
    evento_google_id TEXT, -- ID del evento en Google Calendar
    estado TEXT DEFAULT 'agendada', -- agendada, cancelada, completada
    notas TEXT,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_servicios_empresa ON servicios(empresa_id);
CREATE INDEX IF NOT EXISTS idx_trabajadores_empresa ON trabajadores(empresa_id);
CREATE INDEX IF NOT EXISTS idx_trabajadores_telefono ON trabajadores(telefono_bot);
CREATE INDEX IF NOT EXISTS idx_citas_empresa ON citas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_citas_trabajador ON citas(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_citas_fecha ON citas(fecha, hora);
CREATE INDEX IF NOT EXISTS idx_citas_estado ON citas(estado);

-- Trigger para actualizar actualizado_en
CREATE OR REPLACE FUNCTION actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_empresas_actualizado
BEFORE UPDATE ON empresas
FOR EACH ROW
EXECUTE FUNCTION actualizar_timestamp();

CREATE TRIGGER trigger_servicios_actualizado
BEFORE UPDATE ON servicios
FOR EACH ROW
EXECUTE FUNCTION actualizar_timestamp();

CREATE TRIGGER trigger_trabajadores_actualizado
BEFORE UPDATE ON trabajadores
FOR EACH ROW
EXECUTE FUNCTION actualizar_timestamp();

CREATE TRIGGER trigger_citas_actualizado
BEFORE UPDATE ON citas
FOR EACH ROW
EXECUTE FUNCTION actualizar_timestamp();

-- Datos de ejemplo (opcional - para pruebas)
-- INSERT INTO empresas (nombre, descripcion, telefono, direccion) VALUES
-- ('Xheros Barber', 'Barbería premium en Bogotá', '573001234567', 'Calle 123 #45-67');

-- INSERT INTO servicios (empresa_id, nombre, descripcion, precio, duracion_minutos) VALUES
-- ((SELECT id FROM empresas WHERE nombre = 'Xheros Barber' LIMIT 1), 'Combo Zafiro', 'Corte tradicional con acabado profesional', 45000, 60),
-- ((SELECT id FROM empresas WHERE nombre = 'Xheros Barber' LIMIT 1), 'Precisión Total', 'Corte con asesoría personalizada según el rostro', 55000, 75),
-- ((SELECT id FROM empresas WHERE nombre = 'Xheros Barber' LIMIT 1), 'Combo Deluxe', 'Experiencia completa: corte, barba, limpieza e hidratación facial', 70000, 90);
