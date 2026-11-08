-- ============================================================
-- Migración v7: Fase 1/2 del piloto — número de prueba vs línea real
--
--  · modo 'prueba'      → número sandbox de Meta (máx. 5 destinatarios
--                          verificados; solo una empresa a la vez)
--  · modo 'produccion'  → línea real de la empresa (Fase 2): se pasa
--                          editando la conexión, sin tocar código
--  · waba_id            → la WABA a la que pertenece el número real
--                          (el número de prueba no la necesita)
--
-- RESPALDO OBLIGATORIO ANTES: _bak_numeros_bot_v7 (abajo).
--   Restaurarlo de ser necesario:
--     TRUNCATE numeros_bot;
--     INSERT INTO numeros_bot SELECT * FROM _bak_numeros_bot_v7;
--
-- Routing: el webhook de Meta llega con phone_number_id; el índice lo
-- hace la búsqueda principal del tenant.
--
-- Idempotente.
-- ============================================================

-- PASO 1: RESPALDO (no se sobreescribe si ya existe)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='_bak_numeros_bot_v7') THEN
    CREATE TABLE public._bak_numeros_bot_v7 AS SELECT * FROM public.numeros_bot;
  END IF;
END $$;

-- PASO 2: MIGRACIÓN
ALTER TABLE numeros_bot
    ADD COLUMN IF NOT EXISTS waba_id TEXT,
    ADD COLUMN IF NOT EXISTS modo TEXT NOT NULL DEFAULT 'prueba'
        CONSTRAINT numeros_bot_modo_valido
        CHECK (modo IN ('prueba','produccion'));

CREATE INDEX IF NOT EXISTS idx_numeros_bot_phone_id ON numeros_bot(phone_number_id);
