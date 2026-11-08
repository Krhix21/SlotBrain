-- ============================================================
-- Migración v5: marca/nicho por empresa + recordatorios + clave temporal
--
-- 1) Identidad de marca y terminología por nicho (empresas):
--    · logo_url / color_primario → identidad visual del panel.
--    · moneda                    → el bot formatea precios con ella
--      (antes quedaba fijo "$ ... COP" en bot.js).
--    · terminologia (Jsonb)      → cómo llama el bot a las cosas por
--      nicho: servicio_singular, servicio_plural, profesional_singular,
--      profesional_plural. Vacía = barbería (valores por defecto).
--    · prompt_base               → texto libre que la empresa añade al
--      prompt del bot (tono, reglas de su nicho).
--    · politicas (JSONB)         → recordatorios, cobros, ventanas de
--      cancelación, etc. Vacía = defaults del código.
--
-- 2) notificaciones en `citas`: registro de idempotencia del scheduler
--    (qué recordatorios ya salieron para esa cita).
--    Tipos contemplados como claves: profesional_24h, cliente_2h.
--
-- 3) debe_cambiar_clave en `usuarios_admin`: cuando el superadmin crea
--    el usuario de una empresa con clave temporal, obliga a cambiarla
--    en el primer login.
--
-- 4) Índice para que el scheduler no escanee toda la tabla de citas.
--
-- Idempotente: puede ejecutarse sin romper nada.
-- ============================================================

ALTER TABLE empresas
    ADD COLUMN IF NOT EXISTS logo_url TEXT,
    ADD COLUMN IF NOT EXISTS color_primario TEXT,
    ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'COP',
    ADD COLUMN IF NOT EXISTS terminologia JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS prompt_base TEXT,
    ADD COLUMN IF NOT EXISTS politicas JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE citas
    ADD COLUMN IF NOT EXISTS notificaciones JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE usuarios_admin
    ADD COLUMN IF NOT EXISTS debe_cambiar_clave BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_citas_inicio_utc ON citas(inicio_utc);
