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
// Requiere Node 18+ (usa el fetch global).
// ============================================================

const GRAPH_API_VERSION = 'v24.0';

let tokensPorNumero = null;

// Lee META_TOKENS_JSON una sola vez y lo cachea.
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

/**
 * Resuelve el phone_number_id y el token de un envío.
 * @param {string} phoneNumberId - Phone Number ID destino. Si se omite, usa META_PHONE_NUMBER_ID.
 */
function credenciales(phoneNumberId) {
    const id = phoneNumberId || process.env.META_PHONE_NUMBER_ID;
    const token = mapaDeTokens()[id] || process.env.META_WHATSAPP_TOKEN;

    if (!id || !token) {
        console.error(
            '⚠️  Faltan credenciales de Meta. ' +
            (id ? `No hay token para el phone_number_id ${id}.` : 'Falta META_PHONE_NUMBER_ID.') +
            ' Revisa META_TOKENS_JSON o META_WHATSAPP_TOKEN.'
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
 * @param {string} numeroDestino - Número internacional SIN "+" (ej. "573001234567")
 * @param {string} texto - Contenido del mensaje
 * @param {string} phoneNumberId - A qué número se responde. Opcional si hay uno solo.
 */
async function enviarMensajeTexto(numeroDestino, texto, phoneNumberId) {
    const cred = credenciales(phoneNumberId);
    if (!cred) return null;

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

        const data = await response.json();

        if (!response.ok) {
            console.error('❌ Error enviando mensaje vía Cloud API:', JSON.stringify(data));

            // 131049 = la ventana de 24 h con ese cliente está cerrada:
            // solo se puede responder si él nos escribió primero hoy.
            if (data?.error?.code === 131049) {
                console.warn('⚠️  La ventana de 24h con este cliente está cerrada. El mensaje no salió.');
            }
        }

        return data;
    } catch (error) {
        console.error('❌ Error de red enviando mensaje vía Cloud API:', error);
        return null;
    }
}

/**
 * Marca un mensaje entrante como leído (muestra el doble check azul).
 * @param {string} messageId - Id del mensaje entrante recibido en el webhook
 * @param {string} phoneNumberId - Número por el que llegó el mensaje
 */
async function marcarComoLeido(messageId, phoneNumberId) {
    if (!messageId) return null;

    const cred = credenciales(phoneNumberId);
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

/**
 * Normaliza cualquier teléfono a solo dígitos, sin signos ni prefijo "00".
 * El "display_phone_number" de Meta llega como "+1 555 555 0123" y
 * debe coincidir con el `telefono` guardado en `numeros_bot`.
 * @param {string} telefono
 * @returns {string|null}
 */
function normalizarTelefono(telefono) {
    if (!telefono) return null;

    let digitos = String(telefono).replace(/\D/g, '');

    // Prefijo internacional "00" -> ""
    if (digitos.startsWith('00')) digitos = digitos.slice(2);

    return digitos || null;
}

module.exports = { enviarMensajeTexto, marcarComoLeido, normalizarTelefono };
