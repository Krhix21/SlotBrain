-- ============================================================
-- Migración v11: estilo conversacional + memoria de cliente
--
-- 1) empresas.estilo (JSONB): opciones CERRADAS de tono/tratamiento
--    para el bot de WhatsApp. Vacío = defaults buenos en código
--    (estilo.js). No confundir con la tabla `voces` (TTS clonado).
--
-- 2) clientes_memoria: nombre / último servicio / profesional por
--    empresa + teléfono (o bsuid). Aislado por tenant; borrable.
--
-- 3) conversaciones.bot_pausado + fallos_entendimiento: escalamiento
--    a humano (el bot deja de responder ese chat hasta que se reactive).
--
-- Idempotente. NO aplicar sin backup y autorización del dueño.
-- ============================================================

ALTER TABLE public.empresas
    ADD COLUMN IF NOT EXISTS estilo JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.clientes_memoria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    telefono TEXT,
    bsuid TEXT,
    nombre TEXT,
    ultimo_servicio TEXT,
    ultimo_profesional TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT clientes_memoria_identidad CHECK (telefono IS NOT NULL OR bsuid IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_memoria_empresa_tel
    ON public.clientes_memoria (empresa_id, telefono)
    WHERE telefono IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_memoria_empresa_bsuid
    ON public.clientes_memoria (empresa_id, bsuid)
    WHERE bsuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clientes_memoria_empresa
    ON public.clientes_memoria (empresa_id);

ALTER TABLE public.clientes_memoria ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.conversaciones
    ADD COLUMN IF NOT EXISTS bot_pausado BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS fallos_entendimiento INTEGER NOT NULL DEFAULT 0;
