-- ============================================================
-- Migración v6: token de WhatsApp por empresa (Fase 3A/3D)
--
-- Cada empresa conecta SU número de WhatsApp desde el panel: el token
-- permanente (usuario de sistema de su meta business) queda CIFRADO en
-- esta columna (AES-256-GCM con APP_ENCRYPTION_KEY del entorno).
--
-- Reglas que la acompañan (en admin.js / whatsappCloud.js):
--  · NUNCA se devuelve el token por la API (los GET del panel no lo
--    exponen; solo indica si existe).
--  · El mapa de tokens del entorno (META_TOKENS_JSON) sigue siendo la
--    primera opción: la DB cifrada es el respaldo multi-tenant.
--
-- Idempotente.
-- ============================================================

ALTER TABLE numeros_bot
    ADD COLUMN IF NOT EXISTS meta_token_cifrado TEXT;
