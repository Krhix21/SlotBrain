// ============================================================
// Cliente ligero para la Meta WhatsApp Cloud API (Graph API).
//
// No usa navegador, solo HTTP. Un mismo despliegue puede atender
// varios números a la vez: cada mensaje se envía indicando para
// cuál es, y el token se resuelve en tiempo de llamada.
//
// Requisitos de variables de entorno:
//   META_WHATSAPP_TOKEN  -> token de respaldo (número principal)
//   META_TOKENS_JSON     -> { "<phone_number_id>": "<token>", ... }
//   META_PHONE_NUMBER_ID -> phone_number_id principal (respaldo)
//
// MULTI-TENANT (Fase 3A): si un phone_number_id no está en el env,
// se busca su token CIFRADO en `numeros_bot.meta_token_cifrado`
// (ver tokensMeta.js). Con caché en memoria de 5 minutos; para
// invalidarla, tokensMeta.limpiarCache() tras editar un número.
//
// Requiere Node 18+ (usa el fetch global).
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const tokensMeta = require('./tokensMeta');
const { explicarErrorMeta } = require('./erroresMeta');

const GRAPH_API_VERSION = 'v24.0';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let tokensPorNumero = null;

// Tokens descifrados desde la base, con TTL corto: si rotan el token
// en el panel, la caché no los regresa eternamente.
const CACHE_TOKENS_MS = 5 * 60 * 1000;
let cacheTokensDb = new Map();

function mapaDeTokens() {
    if (tokensPorNumero) return tokensPorNumero;

    tokensPorNumero = {};

    const raw = process.env.META_TOKENS_JSON;
    if (!raw) return tokensPorNumero;

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            tokensPorNumero = parsed;
        } else {
            console.error('⚠️  META_TOKENS_JSON debe ser un objeto JSON { "id": "token" }.');
        }
    } catch (error) {
        console.error('❌ META_TOKENS_JSON no es un JSON válido:', error.message);
    }

    return tokensPorNumero;
}

/** Token de la base (descifrado) para un phone_number_id. */
async function tokenDeBase(phoneNumberId) {
    const cached = cacheTokensDb.get(phoneNumberId);
    if (cached && cached.expiraAt > Date.now()) return cached.token;

    const { data, error } = await supabase
        .from('numeros_bot')
        .select('meta_token_cifrado')
        .eq('phone_number_id', phoneNumberId)
        .eq('activo', true)
        .maybeSingle();

    if (error || !data?.meta_token_cifrado) return null;

    const token = tokensMeta.descifrar(data.meta_token_cifrado);
    if (!token) {
        console.error('❌ No se pudo descifrar el token de WhatsApp (¿cambió APP_ENCRYPTION_KEY?). Vuelve a conectar el número en el panel.');
        // No cachear el fallo: se reintentará, pero sin token responde null.
        return null;
    }

    cacheTokensDb.set(phoneNumberId, { token, expiraAt: Date.now() + CACHE_TOKENS_MS });
    return token;
}

/** Invalida la caché de tokens de la base. Llamar tras editar/crear un número. */
function limpiarCacheTokens(phoneNumberId) {
    if (phoneNumberId) cacheTokensDb.delete(phoneNumberId);
    else cacheTokensDb = new Map();
}

async function credenciales(phoneNumberId) {
    const id = phoneNumberId || process.env.META_PHONE_NUMBER_ID;

    if (!id) {
        console.error('⚠️  Falta MATA_PHONE_NUMBER_ID y no se indicó el phone_number_id del envío.');
        return null;
    }

    let token = mapaDeTokens()[id];
    if (!token) token = await tokenDeBase(id);

    if (!token) {
        console.error(
            '⚠️  No hay token de Meta para el phone_number_id ' + id + '. ' +
            'Regístralo en META_TOKENS_JSON o conecta el número desde el panel.'
        );
        return null;
    }

    return { phoneNumberId: id, token };
}

function urlMensajes(phoneNumberId) {
    return `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
}

function cabeceras(token) {
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}

/**
 * Envía un mensaje de texto simple.
 *
 * Contrato normal: SOLO devuelve el payload cuando el mensaje se
 * admitió (HTTP 2xx). Cualquier error de Meta queda logueado legible
 * (con el JSON crudo de Meta para el rastro) y devuelve null: así el
 * llamador (bot/recordatorios) no confunde "enviado" con "rechazado",
 * que antes marcaba recordatorios como enviados cuando Meta rechazó.
 *
 * @param {string} numeroDestino - Número internacional SIN "+" (ej. "573001234567")
 * @param {string} texto - Contenido del mensaje
 * @param {string} phoneNumberId - A qué número se responde. Opcional si hay uno solo.
 * @param {{diagnostico?:boolean}} [opciones]
 * @returns {Promise<object|null|{enviado:boolean, error:{tipo,motivo}|null}>}
 *          con {diagnostico:true} devuelve {enviado, error|null} con el
 *          error explicado (para registrar el motivo del intento fallido).
 */
async function enviarMensajeTexto(numeroDestino, texto, phoneNumberId, opciones = {}) {
    const cred = await credenciales(phoneNumberId);
    const finalizar = (enviado, payload, errorExplicado) => {
        if (opciones.diagnostico) return { enviado, error: errorExplicado || null };
        return enviado ? payload : null;
    };

    if (!cred) {
        return finalizar(false, null, null);
    }

    try {
        const response = await fetch(urlMensajes(cred.phoneNumberId), {
            method: 'POST',
            headers: cabeceras(cred.token),
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: numeroDestino,
                type: 'text',
                text: { body: texto, preview_url: false }
            })
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            const { tipo, motivo, crudo } = explicarErrorMeta(data);
            console.error(`❌ Envío a ${numeroDestino} RECHAZADO por Meta [${tipo}]`);
            console.error(`   ${motivo}`);
            console.error(`   crudo: ${crudo}`);
            return finalizar(false, null, { tipo, motivo });
        }

        return finalizar(true, response.json());
    } catch (error) {
        console.error('❌ Error de red enviando mensaje vía Cloud API:', error);
        return finalizar(false, null, null);
    }
}

/**
 * Marca un mensaje entrante como leído (muestra el doble check azul).
 * @param {string} messageId - Id del mensaje entrante recibido en el webhook
 * @param {string} phoneNumberId - Número por el que llegó el mensaje
 */
async function marcarComoLeido(messageId, phoneNumberId) {
    if (!messageId) return null;

    const cred = await credenciales(phoneNumberId);
    if (!cred) return null;

    try {
        const response = await fetch(urlMensajes(cred.phoneNumberId), {
            method: 'POST',
            headers: cabeceras(cred.token),
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId
            })
        });

        return await response.json();
    } catch (error) {
        console.error('❌ Error marcando mensaje como leído:', error);
        return null;
    }
}

// ============================================================
// Media (notas de voz)
//
// Descarga: los mensajes de audio del webhook no traen el archivo,
// solo su id. Para bajarlo son dos pasos contra Graph API: primero
// se pide la metadata del media (que incluye la URL temporal) y
// después se baja el binario de esa URL autenticado con el token.
//
// Envío: para mandar una nota de voz, el ogg/opus se sube primero
// a Meta (endpoint /media) y el envío referencia el id devuelto.
// WhatsApp reproduce como nota de voz el audio ogg/opus mono.
// ============================================================

function urlMedia(mediaId) {
    return `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`;
}

/**
 * Descarga un archivo de media (por id) desde Meta.
 * @param {string} mediaId - mensaje.audio.id del webhook
 * @param {string} phoneNumberId - Número por el que llegó el mensaje
 * @returns {Promise<{buffer:Buffer, mimeType:string|null}|null>}
 */
async function descargarMedia(mediaId, phoneNumberId) {
    if (!mediaId) return null;

    const cred = await credenciales(phoneNumberId);
    if (!cred) return null;

    try {
        const infoRes = await fetch(urlMedia(mediaId), { headers: cabeceras(cred.token) });
        if (!infoRes.ok) {
            const data = await infoRes.json().catch(() => ({}));
            const { tipo, motivo, crudo } = explicarErrorMeta(data);
            console.error(`❌ No se pudo obtener la URL del media ${mediaId} [${tipo}]: ${motivo} (${crudo})`);
            return null;
        }

        const info = await infoRes.json();
        if (!info.url) {
            console.error(`❌ Meta no devolvió URL para el media ${mediaId}.`);
            return null;
        }

        const binRes = await fetch(info.url, { headers: { 'Authorization': `Bearer ${cred.token}` } });
        if (!binRes.ok) {
            console.error(`❌ Falló la descarga del media ${mediaId}: HTTP ${binRes.status}`);
            return null;
        }

        const buffer = Buffer.from(await binRes.arrayBuffer());
        return { buffer, mimeType: info.mime_type || null };
    } catch (error) {
        console.error('❌ Error de red descargando media de Meta:', error);
        return null;
    }
}

/**
 * Sube un archivo a Meta y devuelve el id de media para referenciarlo
 * en un envío. El token y el phone_number_id son los del número emisor.
 * @param {Buffer} buffer - Contenido del archivo
 * @param {string} mimeType - Ej. "audio/ogg"
 * @param {string} phoneNumberId
 * @returns {Promise<string|null>} id de media, o null si falló
 */
async function subirMedia(buffer, mimeType, phoneNumberId) {
    const cred = await credenciales(phoneNumberId);
    if (!cred) return null;

    try {
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('file', new Blob([buffer], { type: mimeType }), 'nota_voz.ogg');

        const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${cred.phoneNumberId}/media`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${cred.token}` },
            body: form
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            const { tipo, motivo, crudo } = explicarErrorMeta(data);
            console.error(`❌ Subida de media a Meta RECHAZADA [${tipo}]`);
            console.error(`   ${motivo}`);
            console.error(`   crudo: ${crudo}`);
            return null;
        }

        const data = await response.json();
        return data.id || null;
    } catch (error) {
        console.error('❌ Error de red subiendo media a Meta:', error);
        return null;
    }
}

/**
 * Envía una nota de voz ya subida a Meta (por su id de media).
 * @param {string} numeroDestino - Sin "+" (ej. "573001234567")
 * @param {string} mediaId - Id devuelto por subirMedia
 * @param {string} phoneNumberId
 * @returns {Promise<object|null>} payload de Meta si se admitió, null si no
 */
async function enviarMensajeVoz(numeroDestino, mediaId, phoneNumberId) {
    const cred = await credenciales(phoneNumberId);
    if (!cred || !mediaId) return null;

    try {
        const response = await fetch(urlMensajes(cred.phoneNumberId), {
            method: 'POST',
            headers: cabeceras(cred.token),
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: numeroDestino,
                type: 'audio',
                audio: { id: mediaId, voice: true }
            })
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            const { tipo, motivo, crudo } = explicarErrorMeta(data);
            console.error(`❌ Nota de voz a ${numeroDestino} RECHAZADA por Meta [${tipo}]`);
            console.error(`   ${motivo}`);
            console.error(`   crudo: ${crudo}`);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error('❌ Error de red enviando nota de voz vía Cloud API:', error);
        return null;
    }
}

/**
 * Atajo: sube el ogg y lo envía como nota de voz en un solo paso.
 * @returns {Promise<boolean>} true si Meta admitió el audio
 */
async function enviarNotaVoz(numeroDestino, oggBuffer, phoneNumberId) {
    const mediaId = await subirMedia(oggBuffer, 'audio/ogg', phoneNumberId);
    if (!mediaId) return false;
    const payload = await enviarMensajeVoz(numeroDestino, mediaId, phoneNumberId);
    return Boolean(payload);
}

/**
 * ¿Parece un BSUID de Meta (usernames WhatsApp)? Formato `CC.alfanumérico`.
 * No es un teléfono: no se normaliza a dígitos.
 */
function esBsuid(valor) {
    return typeof valor === 'string' && /^[A-Z]{2}\.[A-Za-z0-9]+$/.test(valor.trim());
}

/**
 * Normaliza cualquier teléfono a solo dígitos, sin signos ni prefijo "00".
 * El "display_phone_number" de Meta llega como "+1 555 555 0123" y
 * debe coincidir con el `telefono` guardado en `numeros_bot`.
 *
 * Con `codigoPaisDefault` (ej. "57"): si el valor parece local (10 dígitos
 * sin código), se antepone el código. Evita que el panel guarde
 * "3001234567" y el webhook mande "573001234567" sin match.
 *
 * Si el valor es un BSUID, se devuelve tal cual (no son dígitos).
 *
 * @param {string} telefono
 * @param {{codigoPaisDefault?:string}} [opciones]
 * @returns {string|null}
 */
function normalizarTelefono(telefono, opciones = {}) {
    if (!telefono) return null;

    const crudo = String(telefono).trim();
    if (esBsuid(crudo)) return crudo;

    let digitos = crudo.replace(/\D/g, '');

    // Prefijo internacional "00" -> ""
    if (digitos.startsWith('00')) digitos = digitos.slice(2);

    if (!digitos) return null;

    const codigo = String(opciones.codigoPaisDefault || '').replace(/\D/g, '');
    if (codigo && !digitos.startsWith(codigo)) {
        // Heurística LATAM: 10 dígitos locales (celular CO/MX típico).
        if (digitos.length === 10) digitos = codigo + digitos;
    }

    return digitos;
}

module.exports = {
    enviarMensajeTexto,
    enviarNotaVoz,
    enviarMensajeVoz,
    subirMedia,
    descargarMedia,
    marcarComoLeido,
    normalizarTelefono,
    esBsuid,
    limpiarCacheTokens
};
