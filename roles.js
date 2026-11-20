// ============================================================
// Resolución de rol del remitente WhatsApp (cliente vs dueño/staff).
//
// El mismo número del negocio atiende a clientes y al equipo. La
// identidad del dueño/staff vive en usuarios_admin.telefono (y
// opcionalmente bsuid) y en trabajadores.telefono.
//
// Match EXACTO tras normalizar con código de país. El dueño no debe
// activar username de WhatsApp: si Meta omite el número, el modo
// dueño solo funciona si ya guardamos su bsuid.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { normalizarTelefono, esBsuid } = require('./whatsappCloud');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const CACHE_TTL_MS = 60 * 1000;
let cacheRoles = new Map();

function codigoPaisDe(empresa) {
    const p = (empresa && typeof empresa.politicas === 'object' && empresa.politicas) || {};
    return String(p.codigo_pais || '57').replace(/\D/g, '') || '57';
}

/**
 * @returns {Promise<{
 *   tipo:'propietario'|'staff'|'trabajador'|'cliente',
 *   usuarioId?:string,
 *   trabajadorId?:string,
 *   telefono?:string|null,
 *   bsuid?:string|null
 * }>}
 */
async function resolverRol(empresaId, { telefono = null, bsuid = null, empresa = null } = {}) {
    if (!empresaId) return { tipo: 'cliente', telefono, bsuid };

    const codigo = codigoPaisDe(empresa);
    const tel = telefono && !esBsuid(telefono)
        ? normalizarTelefono(telefono, { codigoPaisDefault: codigo })
        : null;
    const uid = bsuid && esBsuid(bsuid) ? bsuid.trim() : (telefono && esBsuid(telefono) ? telefono.trim() : null);

    if (!tel && !uid) return { tipo: 'cliente', telefono: null, bsuid: null };

    const clave = `${empresaId}|${tel || ''}|${uid || ''}`;
    const cached = cacheRoles.get(clave);
    if (cached && cached.expiresAt > Date.now()) return cached.valor;

    // 1) Dueño / staff en usuarios_admin (dos queries: el BSUID trae
    // puntos y rompe el filtro .or de PostgREST).
    if (tel || uid) {
        let data = null;

        if (tel) {
            const r = await supabase
                .from('usuarios_admin')
                .select('id, rol, telefono, bsuid, activo')
                .eq('empresa_id', empresaId)
                .eq('activo', true)
                .in('rol', ['propietario', 'staff'])
                .eq('telefono', tel)
                .maybeSingle();
            if (r.error) console.error('❌ Error resolviendo rol admin (tel):', r.error.message);
            else data = r.data;
        }

        if (!data && uid) {
            const r = await supabase
                .from('usuarios_admin')
                .select('id, rol, telefono, bsuid, activo')
                .eq('empresa_id', empresaId)
                .eq('activo', true)
                .in('rol', ['propietario', 'staff'])
                .eq('bsuid', uid)
                .maybeSingle();
            if (r.error) console.error('❌ Error resolviendo rol admin (bsuid):', r.error.message);
            else data = r.data;
        }

        if (data) {
            const valor = {
                tipo: data.rol === 'propietario' ? 'propietario' : 'staff',
                usuarioId: data.id,
                telefono: data.telefono || tel,
                bsuid: data.bsuid || uid
            };
            cacheRoles.set(clave, { valor, expiresAt: Date.now() + CACHE_TTL_MS });
            return valor;
        }
    }

    // 2) Profesional (puede operar su agenda / bloqueos propios)
    if (tel) {
        const { data: trab, error: errT } = await supabase
            .from('trabajadores')
            .select('id, telefono, activo')
            .eq('empresa_id', empresaId)
            .eq('activo', true)
            .eq('telefono', tel)
            .maybeSingle();

        if (errT) {
            console.error('❌ Error resolviendo rol trabajador:', errT.message);
        } else if (trab) {
            const valor = {
                tipo: 'trabajador',
                trabajadorId: trab.id,
                telefono: trab.telefono || tel,
                bsuid: uid
            };
            cacheRoles.set(clave, { valor, expiresAt: Date.now() + CACHE_TTL_MS });
            return valor;
        }
    }

    const valor = { tipo: 'cliente', telefono: tel, bsuid: uid };
    cacheRoles.set(clave, { valor, expiresAt: Date.now() + CACHE_TTL_MS });
    return valor;
}

function esModoDueno(rol) {
    return rol && (rol.tipo === 'propietario' || rol.tipo === 'staff' || rol.tipo === 'trabajador');
}

function limpiarCache() {
    cacheRoles = new Map();
}

module.exports = {
    resolverRol,
    esModoDueno,
    codigoPaisDe,
    limpiarCache
};
