-- ============================================================
-- Migración v10: voz clonada por empresa
--
-- El sample de voz deja de vivir solo quemado en el deploy de Modal:
-- cada empresa registra la SUYA (grabación del dueño o de quien él
-- elija) desde el panel, y el bot la usa al responder notas de voz.
--
-- 1) tabla voces: una voz ACTIVA por empresa (audio en Storage, la
--    transcripción EXACTA del sample — Qwen3-TTS la exige para clonar —
--    y el estilo deseado del tono).
-- 2) bucket privado `voces`: igual que `marcas` pero sin URL pública;
--    el audio solo lo lee el servidor (service role) y viaja al
--    endpoint de Modal por llamada (ref_audio_b64).
--
-- Nota de alcance: el estilo se guarda y se muestra, pero el modelo de
-- clonación (Qwen3-TTS-12Hz-*-Base) no acepta instrucciones por llamada
-- (solo los CustomVoice/VoiceDesign la traen). El tono/actitud sale del
-- sample mismo; el campo queda listo para el día en que cambiemos de
-- modelo.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.voces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    activa BOOLEAN NOT NULL DEFAULT true,
    storage_path TEXT NOT NULL,                 -- ruta dentro del bucket `voces`
    mime_type TEXT NOT NULL DEFAULT 'audio/mpeg',
    tamano_bytes INTEGER,
    ref_text TEXT NOT NULL,                     -- transcripción palabra por palabra del sample
    estilo TEXT,                                -- tono deseado del recepcionista (reservada, ver arriba)
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una sola voz activa por empresa: si el dueño sube una nueva, la
-- anterior se desactiva (queda como historial) y esta pasa a mandar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_voces_empresa_activa
    ON public.voces (empresa_id) WHERE activa;

CREATE INDEX IF NOT EXISTS idx_voces_empresa
    ON public.voces (empresa_id);

-- RLS activado SIN políticas públicas: solo el servidor (service role)
-- lee/escribe esta tabla. El audio de una persona es dato sensible.
ALTER TABLE public.voces ENABLE ROW LEVEL SECURITY;

-- ── bucket privado `voces` ───────────────────────────────────
-- 10 MB por archivo; mimes de audio que pueden venir de una grabación
-- de celular (m4a), WhatsApp (ogg) o del micrófono del navegador (webm).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'voces',
    'voces',
    false,
    10485760,
    ARRAY[
        'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a',
        'audio/ogg', 'application/ogg', 'audio/webm',
        'audio/wav', 'audio/x-wav', 'audio/aac'
    ]
)
ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = 10485760,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Verificación rápida (opcional):
--   \d voces
--   select id, name, public from storage.buckets where id = 'voces';
