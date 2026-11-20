-- ============================================================
-- Migración v9: agente dueño (WhatsApp) + BSUID + auditoría
--
-- 1) usuarios_admin.telefono / bsuid: identidad del dueño/staff en el
--    mismo número del negocio. Unique COMPUESTO (empresa_id, telefono)
--    para que la misma persona pueda ser propietaria de dos negocios.
-- 2) conversaciones.pending_reminder / pending_owner_action / bsuid:
--    loop SÍ/NO de recordatorios, confirmación de acciones destructivas
--    y continuidad cuando Meta omite el número (usernames → BSUID).
-- 3) citas.bsuid: recontactar sin teléfono físico.
-- 4) auditoria_agente: log append-only de mutaciones del modo dueño.
--
-- Idempotente.
-- ============================================================

-- ── usuarios_admin: teléfono + BSUID ──────────────────────────
ALTER TABLE usuarios_admin
    ADD COLUMN IF NOT EXISTS telefono TEXT,
    ADD COLUMN IF NOT EXISTS bsuid TEXT;

-- Unique por empresa (no global): un dueño puede operar N negocios.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_admin_empresa_telefono
    ON usuarios_admin (empresa_id, telefono)
    WHERE telefono IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_admin_empresa_bsuid
    ON usuarios_admin (empresa_id, bsuid)
    WHERE bsuid IS NOT NULL;

-- ── conversaciones: pending + BSUID ───────────────────────────
ALTER TABLE conversaciones
    ADD COLUMN IF NOT EXISTS pending_reminder JSONB,
    ADD COLUMN IF NOT EXISTS pending_owner_action JSONB,
    ADD COLUMN IF NOT EXISTS bsuid TEXT;

-- telefono_cliente puede faltar si solo hay BSUID (usernames Meta 2026).
ALTER TABLE conversaciones
    ALTER COLUMN telefono_cliente DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'conversaciones_identidad_minima'
    ) THEN
        ALTER TABLE conversaciones
            ADD CONSTRAINT conversaciones_identidad_minima
            CHECK (telefono_cliente IS NOT NULL OR bsuid IS NOT NULL);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversaciones_bot_bsuid
    ON conversaciones (telefono_bot, bsuid)
    WHERE bsuid IS NOT NULL;

-- ── citas: BSUID para recontacto ──────────────────────────────
ALTER TABLE citas
    ADD COLUMN IF NOT EXISTS bsuid TEXT;

CREATE INDEX IF NOT EXISTS idx_citas_bsuid
    ON citas (empresa_id, bsuid)
    WHERE bsuid IS NOT NULL;

-- ── auditoría del modo dueño ─────────────────────────────────
CREATE TABLE IF NOT EXISTS auditoria_agente (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    actor_telefono TEXT,
    actor_bsuid TEXT,
    actor_rol TEXT NOT NULL,
    accion TEXT NOT NULL,
    detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
    cita_id UUID REFERENCES citas(id) ON DELETE SET NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_agente_empresa_fecha
    ON auditoria_agente (empresa_id, creado_en DESC);

-- Verificación rápida (opcional):
--   \d usuarios_admin
--   \d conversaciones
--   \d auditoria_agente
