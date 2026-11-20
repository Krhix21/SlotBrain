// ============================================================
// Resolución del número de WhatsApp receptor.
//
// Meta envía en cada webhook `metadata.phone_number_id`, que ahora es
// la clave principal de routing (Fase 1/2: al pasarse del número de
// prueba a la línea real solo cambia la fila, y el webhook sigue
// llegando por el id). El número en texto queda como respaldo.
//
// Un mismo despliegue atiende N empresas a la vez: no hay número
// hardcodeado en ninguna parte del código.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { normalizarTelefono, esBsuid } = require('./whatsappCloud');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const CACHE_TTL_MS = 5 * 60 * 1000;
let cacheNumeros = new Map();

/**
 * Busca el número receptor en `numeros_bot`.
 *
 * PRINCIPAL: por `phone_number_id` (es lo que llega en el webhook y el
 * que sobrevive intacto a un cambio de número de prueba → línea real).
 * RESPALDO: por el número normalizado, para webhooks raros sin id.
 *
 * @param {string} displayPhoneNumber - tal como lo manda Meta ("+1 555 555 0123")
 * @param {string} phoneNumberIdMeta - metadata.phone_number_id (clave principal)
 * @returns {Promise<{telefono:string, phone_number_id:string, empresa_id:string, etiqueta:string|null, modo:string}|null>}
 */
async function resolverBot(displayPhoneNumber, phoneNumberIdMeta) {
    const telefono = normalizarTelefono(displayPhoneNumber);

    // La caché es por id cuando existe, por número cuando no.
    const claveCache = phoneNumberIdMeta || telefono || 'nada';
    if (claveCache === 'nada') return null;

    const cached = cacheNumeros.get(claveCache);
    if (cached && cached.expiresAt > Date.now()) return cached.row;

    let data = null;
    let error = null;

    // 1) Ruta principal: phone_number_id (sin ambigüedad de formatos).
    if (phoneNumberIdMeta) {
        ({ data, error } = await supabase
            .from('numeros_bot')
            .select('id, telefono, phone_number_id, empresa_id, etiqueta, activo, modo')
            .eq('phone_number_id', phoneNumberIdMeta)
            .eq('activo', true)
            .maybeSingle());
    }

    // 2) Respaldo: match por el número display normalizado.
    if (!data && !error && telefono) {
        ({ data, error } = await supabase
            .from('numeros_bot')
            .select('id, telefono, phone_number_id, empresa_id, etiqueta, activo, modo')
            .eq('telefono', telefono)
            .eq('activo', true)
            .maybeSingle());
    }

    if (error) {
        console.error(`❌ Error consultando numeros_bot (id ${phoneNumberIdMeta || 'n/a'} / tel ${telefono || 'n/a'}):`, error.message);
        return null;
    }

    if (!data) return null;

    const row = {
        id: data.id,
        telefono: data.telefono,
        phone_number_id: data.phone_number_id || phoneNumberIdMeta || null,
        empresa_id: data.empresa_id,
        etiqueta: data.etiqueta || null,
        modo: data.modo || 'prueba'
    };

    cacheNumeros.set(claveCache, { row, expiresAt: Date.now() + CACHE_TTL_MS });
    return row;
}

/** Lista los números de una empresa. SIN el token: se devuelve solo la
 * bandera "conectado"; una credencial de WhatsApp no viaja por la API. */
async function listarPorEmpresa(empresaId) {
    const { data, error } = await supabase
        .from('numeros_bot')
        .select('id, empresa_id, telefono, phone_number_id, waba_id, modo, etiqueta, activo, creado_en, meta_token_cifrado')
        .eq('empresa_id', empresaId)
        .order('creado_en');

    if (error) {
        console.error('Error listando números de la empresa:', error.message);
        return [];
    }
    // El token sale del payload: lo que ve el panel es una bandera.
    return (data || []).map(({ meta_token_cifrado, ...fila }) => ({
        ...fila,
        token_conectado: !!meta_token_cifrado
    }));
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
    normalizarTelefono,
    esBsuid
};
