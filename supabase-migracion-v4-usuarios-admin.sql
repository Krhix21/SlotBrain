-- ============================================================
-- Migración v4: usuarios de panel por empresa (multitenant)
--
-- Reemplaza el login único de ADMIN_USER/ADMIN_PASSWORD por una
-- tabla de usuarios ligados a una empresa:
--   · rol 'superadmin'  → empresa_id NULL, ve todas las empresas.
--   · rol 'propietario' → administra SU empresa y sus usuarios staff.
--   · rol 'staff'       → administra SU empresa, no gestiona usuarios.
--
-- Las sesiones viven en `sesiones_admin` (antes estaban en memoria
-- del proceso y se perdían en cada deploy).
--
-- El primer superadmin se crea con:
--   npm run crear-usuario -- <correo> <contraseña> --superadmin
-- (o automáticamente en el arranque si la tabla está vacía y
--  ADMIN_USER/ADMIN_PASSWORD siguen configurados en el entorno).
--
-- Idempotente: puede ejecutarse sin romper nada.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 1) Usuarios del panel
--    empresa_id NULL = superadmin (no pertenece a ninguna empresa).
--    El email se guarda en minúsculas; el login compara en minúsculas.
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios_admin (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    -- propietario | staff | superadmin
    rol TEXT NOT NULL DEFAULT 'staff'
        CONSTRAINT usuarios_admin_rol_valido
        CHECK (rol IN ('propietario','staff','superadmin')),
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_admin_empresa ON usuarios_admin(empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_admin_email
    ON usuarios_admin(lower(email));

-- ════════════════════════════════════════════════════════════
-- 2) Sesiones del panel
--
-- El token es opaco (randomBytes 32) y se guarda tal cual: expira solo,
-- se valida por la columna y se elimina en logout. TTL del lado del
-- servidor (8 h) y limpieza de vencidas.
-- ============================================================

CREATE TABLE IF NOT EXISTS sesiones_admin (
    token TEXT PRIMARY KEY,
    usuario_id UUID NOT NULL REFERENCES usuarios_admin(id) ON DELETE CASCADE,
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
    expira TIMESTAMP WITH TIME ZONE NOT NULL,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sesiones_admin_expira ON sesiones_admin(expira);

-- ════════════════════════════════════════════════════════════
-- 3) Trigger de actualizado_en (mismo patrón que el resto del esquema)
-- ============================================================

DROP TRIGGER IF EXISTS trigger_usuarios_admin_actualizado ON usuarios_admin;
CREATE TRIGGER trigger_usuarios_admin_actualizado
    BEFORE UPDATE ON usuarios_admin FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

-- ════════════════════════════════════════════════════════════
-- 4) Comprobaciones
--    Todas deben dar 0 filas:
--
--    SELECT * FROM usuarios_admin WHERE Empresa_id IS NOT NULL AND email <> lower(email);
--    SELECT s.* FROM sesiones_admin s
--      LEFT JOIN usuarios_admin u ON u.id = s.usuario_id WHERE u.id IS NULL;
-- ============================================================
