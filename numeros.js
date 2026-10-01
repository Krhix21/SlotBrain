// ============================================================
// Resolución del número de WhatsApp receptor.
//
// Meta envía en cada webhook el número por el que llegó el mensaje
// (metadata.display_phone_number). Ese número identifica a una EMPRESA
// concreta, a través de la tabla `numeros_bot`.
//
// Un mismo despliegue atiende N empresas a la vez: no hay número
// hardcodeado en ninguna parte del código.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { normalizarTelefono } = require('./whatsappCloud');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const CACHE_TTL_MS = 5 * 60 * 1000;
let cacheNumeros = new Map();

/**
 * Busca el número receptor en `numeros_bot`.
 * @param {string} displayPhoneNumber - tal como lo manda Meta ("+1 555 555 0123")
 * @param {string} phoneNumberIdMeta - metadata.phone_number_id, usado como respaldo
 * @returns {Promise<{telefono:string, phone_number_id:string, empresa_id:string, etiqueta:string|null}|null>}
 */
async function resolverBot(displayPhoneNumber, phoneNumberIdMeta) {
    const telefono = normalizarTelefono(displayPhoneNumber);
    if (!telefono) return null;

    const cached = cacheNumeros.get(telefono);
    if (cached && cached.expiresAt > Date.now()) return cached.row;

    const { data, error } = await supabase
        .from('numeros_bot')
        .select('id, telefono, phone_number_id, empresa_id, etiqueta, activo')
        .eq('telefono', telefono)
        .eq('activo', true)
        .maybeSingle();

    if (error) {
        console.error(`❌ Error consultando numeros_bot para ${telefono}:`, error.message);
        return null;
    }

    if (!data) return null;

    const row = {
        id: data.id,
        telefono: data.telefono,
        phone_number_id: data.phone_number_id || phoneNumberIdMeta || null,
        empresa_id: data.empresa_id,
        etiqueta: data.etiqueta || null
    };

    cacheNumeros.set(telefono, { row, expiresAt: Date.now() + CACHE_TTL_MS });
    return row;
}

/** Lista los números de respuesta de una empresa. */
async function listarPorEmpresa(empresaId) {
    const { data, error } = await supabase
        .from('numeros_bot')
        .select('*')
        .eq('empresa_id', empresaId)
        .order('creado_en');

    if (error) {
        console.error('Error listando números de la empresa:', error.message);
        return [];
    }
    return data || [];
}

/** Empresa a la que pertenece un número. */
async function obtenerEmpresaDeNumero(telefono) {
    const bot = await resolverBot(telefono);
    if (!bot) return null;

    const { data, error } = await supabase
        .from('empresas')
        .select('*')
        .eq('id', bot.empresa_id)
        .maybeSingle();

    if (error) {
        console.error('Error cargando la empresa:', error.message);
        return null;
    }
    return data || null;
}

/**
 * Refresca (o limpia) la caché de números.
 * Llamar después de crear, editar o desactivar un número desde el panel.
 */
function limpiarCache(telefono) {
    if (telefono) {
        cacheNumeros.delete(normalizarTelefono(telefono));
    } else {
        cacheNumeros = new Map();
    }
}

module.exports = {
    resolverBot,
    listarPorEmpresa,
    obtenerEmpresaDeNumero,
    limpiarCache,
    normalizarTelefono
};
