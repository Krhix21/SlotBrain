-- ============================================================
-- Migración v12: lista de espera para turnos liberados
--
-- 1) lista_espera: guarda qué cliente quería una fecha/hora que
--    estaba ocupada. Cuando esa cita se cancela o se mueve, el
--    bot ofrece el turno liberado al primero de la lista.
--    Estados: activa / avisada / agendada / vencida / cancelada.
--
-- 2) conversaciones.pending_oferta (JSONB): recuerda qué oferta de
--    turno liberado le hicimos a quién (igual que pending_reminder),
--    para interpretar el SÍ/NO del cliente.
--
-- La ventana de la oferta (minutos) es configurable por empresa en
-- empresas.politicas->>'lista_espera_minutos' (default 30 en código).
--
-- Idempotente. NO aplicar sin backup (_bak_conversaciones_v12).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lista_espera (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    servicio_id UUID REFERENCES public.servicios(id) ON DELETE SET NULL,
    trabajador_id UUID REFERENCES public.trabajadores(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    hora_deseada TIME NOT NULL,
    telefono_cliente TEXT NOT NULL,
    nombre_cliente TEXT,
    estado TEXT NOT NULL DEFAULT 'activa'
        CHECK (estado IN ('activa', 'avisada', 'agendada', 'vencida', 'cancelada')),
    expira_oferta_en TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Búsqueda rápida al liberarse un turno (por trabajador, fecha y estado)
CREATE INDEX IF NOT EXISTS idx_lista_espera_busqueda
    ON public.lista_espera (trabajador_id, fecha, estado);

-- Búsqueda cuando el cliente no pidió un trabajador concreto
CREATE INDEX IF NOT EXISTS idx_lista_espera_empresa_fecha
    ON public.lista_espera (empresa_id, fecha, estado);

ALTER TABLE public.lista_espera ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.conversaciones
    ADD COLUMN IF NOT EXISTS pending_oferta JSONB;
