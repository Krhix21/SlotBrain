// ============================================================
// Cliente ligero para la Meta WhatsApp Cloud API (Graph API).
// Reemplaza whatsapp-web.js: no usa navegador, solo HTTP.
// Requiere Node 18+ (usa el fetch global).
// ============================================================

const GRAPH_API_VERSION = 'v21.0';
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.META_WHATSAPP_TOKEN;

function validarConfiguracion() {
    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
        console.error('⚠️  Faltan META_PHONE_NUMBER_ID o META_WHATSAPP_TOKEN en las variables de entorno.');
        return false;
    }
    return true;
}

/**
 * Envía un mensaje de texto simple.
 * @param {string} numeroDestino - Número en formato internacional SIN "+" (ej. "573001234567")
 * @param {string} texto - Contenido del mensaje
 */
async function enviarMensajeTexto(numeroDestino, texto) {
    if (!validarConfiguracion()) return null;

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
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
        }

        return data;
    } catch (error) {
        console.error('❌ Error de red enviando mensaje vía Cloud API:', error);
        return null;
    }
}

/**
 * Marca un mensaje entrante como leído (opcional, mejora la experiencia del cliente
 * mostrando el doble check azul).
 * @param {string} messageId - El "id" del mensaje entrante recibido en el webhook
 */
async function marcarComoLeido(messageId) {
    if (!validarConfiguracion() || !messageId) return null;

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
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

module.exports = { enviarMensajeTexto, marcarComoLeido };
