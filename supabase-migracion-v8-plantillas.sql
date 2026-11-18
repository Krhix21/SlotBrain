-- ============================================================
-- Migración v8: plantillas de WhatsApp por empresa
--
-- Cada empresa registra AQUÍ sus plantillas de Meta (UTILITY,
-- MARKETING, AUTHENTICATION): hoy como borrador o registrando las
-- que ya creó a mano en su Meta Business (estado + meta_id).
-- Cuando Mi Negocio sea Tech Provider, el envío a validación de Meta
-- saldrá de esta misma información, sin copiarlas de un lado a otro.
--
-- Las reglas de validación (nombre en minúsculas con _, variables
-- consecutivas {{1}}..{{n}}, máx. 3 botones, cuerpo ≤ 1024) viven en
-- admin.js:validarPlantilla y copian las exigencias de Meta para que
-- el envío futuro no dé sorpresas.
--
-- Estado: 'borrador' | 'enviada' | 'aprobada' | 'rechazada' | 'pausada'.
--   'enviada'..'rechazada' los escribirá el panel cuando el envío a
--   Meta sea automático; hoy los marca la empresa si ya gestionó la
--   plantilla a mano.
--
-- Nota: RLS deny-by-default es el ITEM 1 del plan aprobado
-- (docs/PLAN-ITEMS-1-y-6.md), pendiente para TODAS las tablas; esta
-- no es la excepción.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS plantillas_whatsapp (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    categoria TEXT NOT NULL DEFAULT 'UTILITY'
        CHECK (categoria IN ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
    idioma TEXT NOT NULL DEFAULT 'es',
    cuerpo TEXT NOT NULL,
    -- Un valor de ejemplo por variable {{n}} (Meta los exige al validar).
    ejemplos JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- [{ tipo: 'QUICK_REPLY'|'URL', texto, url? }] — máx. 3 (regla de Meta).
    botones JSONB NOT NULL DEFAULT '[]'::jsonb,
    estado TEXT NOT NULL DEFAULT 'borrador'
        CHECK (estado IN ('borrador', 'enviada', 'aprobada', 'rechazada', 'pausada')),
    -- Datos reales de Meta cuando la plantilla ya existe allá:
    meta_id TEXT,
    meta_estado TEXT,
    motivo_rechazo TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Meta exige nombre único por WABA e idioma.
    UNIQUE (empresa_id, nombre, idioma)
);

CREATE INDEX IF NOT EXISTS idx_plantillas_empresa ON plantillas_whatsapp(empresa_id);
