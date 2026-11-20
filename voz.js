// ============================================================
// Voz para WhatsApp: notas de voz entrantes y salientes.
//
// Entrante: un ogg de WhatsApp se transcribe con Groq Whisper
// (mismo modelo y llamada que validamos en Claw3D) y el texto
// entra al cerebro del bot como un mensaje normal.
//
// Saliente: si el cliente escribió por voz, la respuesta del bot
// se sintetiza con la voz clonada del negocio (Qwen3-TTS en un
// endpoint de Modal) y se envía como nota de voz.
//
// Regla de diseño aprobada: el bot responde por voz SOLO si el
// cliente escribió por voz; si escribió texto, responde texto.
//
// Variables de entorno:
//   GROQ_API_KEY    -> transcripción (ya en .env.example)
//   MODAL_VOICE_URL -> URL del endpoint desplegado con
//                      `py -m modal deploy voz_clonada.py`
//                      (carpeta modal/ del repo). Sin esta var,
//                      las respuestas caen a texto sin romper nada.
// ============================================================

const whatsappCloud = require('./whatsappCloud');

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = 'whisper-large-v3-turbo';

// WhatsApp rechaza notas de voz pesadas; el endpoint ya sale en
// opus 24 kbps, pero por si acaso validamos antes de subir.
const LIMITE_OGG_BYTES = 512 * 1024;

/**
 * Prepara un texto del bot para que el TTS lo lea natural.
 * El cerebro responde con formato de WhatsApp (asteriscos de negrita,
 * emojis, viñetas) y todo eso lo pronuncia mal o le cambia la entonación.
 * No toca números ni fechas: "a las 3:00 pm" se lee bien tal cual.
 * @param {string} texto
 * @returns {string}
 */
function limpiarParaVoz(texto) {
    if (!texto || typeof texto !== 'string') return '';
    return texto
        .replace(/[*_~`]+/g, '')            // markdown de WhatsApp (negrita, cursiva, tachado, código)
        .replace(/https?:\/\/\S+/g, '')      // URLs: el TTS las deletrea
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '') // emojis y símbolos
        .replace(/^[ \t]*[-•\d]+[.)]?[ \t]+/gm, '') // viñetas y numeraciones
        .replace(/\s*\n+\s*/g, ' ')          // saltos de línea -> pausas suaves
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/**
 * Transcribe un audio (ogg de WhatsApp) a texto con Groq Whisper.
 * @param {Buffer} buffer
 * @param {string|null} mimeType - mime de Meta (audio/ogg; codecs=opus, etc.)
 * @returns {Promise<string|null>} texto, o null si no se pudo transcribir
 */
async function transcribir(buffer, mimeType) {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
        console.warn('⚠️  Nota de voz ignorada: falta GROQ_API_KEY en el entorno.');
        return null;
    }

    const extension = String(mimeType || '').includes('mpeg')
        ? '.mp3'
        : '.ogg';

    try {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(buffer)]), `audio${extension}`);
        form.append('model', GROQ_MODEL);
        form.append('response_format', 'json');

        const response = await fetch(GROQ_TRANSCRIPTION_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: form
        });

        if (!response.ok) {
            const cuerpo = await response.text().catch(() => '');
            console.error(`❌ Transcripción con Groq falló (HTTP ${response.status}): ${cuerpo.slice(0, 200)}`);
            return null;
        }

        const data = await response.json();
        const texto = typeof data.text === 'string' ? data.text.trim() : '';
        return texto || null;
    } catch (error) {
        console.error('❌ Error transcribiendo nota de voz con Groq:', error);
        return null;
    }
}

/**
 * Sintetiza un texto con la voz clonada del negocio.
 * @param {string} texto
 * @returns {Promise<Buffer|null>} ogg/opus listo para WhatsApp, o null
 */
async function sintetizar(texto) {
    const url = process.env.MODAL_VOICE_URL?.trim();
    if (!url) {
        console.warn('⚠️  Respuesta por voz omitida: falta MODAL_VOICE_URL (deploy del endpoint de Modal).');
        return null;
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texto })
        });

        if (!response.ok) {
            const cuerpo = await response.text().catch(() => '');
            console.error(`❌ Síntesis de voz falló (HTTP ${response.status}): ${cuerpo.slice(0, 200)}`);
            return null;
        }

        const ogg = Buffer.from(await response.arrayBuffer());
        if (ogg.length > LIMITE_OGG_BYTES) {
            console.warn(`⚠️  Audio de ${Math.round(ogg.length / 1024)} KB supera el límite de WhatsApp; respuesta cae a texto.`);
            return null;
        }

        return ogg;
    } catch (error) {
        console.error('❌ Error llamando al endpoint de voz:', error);
        return null;
    }
}

/**
 * Envía la respuesta del bot como nota de voz (sintetiza + sube + envía).
 * Si algo falla devuelve false: el llamador cae a texto y el cliente
 * nunca se queda sin respuesta.
 * @param {string} numeroDestino - Sin "+" (o BSUID, tal como lo trata el bot)
 * @param {string} texto - Respuesta limpia del bot
 * @param {string} phoneNumberId
 * @returns {Promise<boolean>}
 */
async function responderPorVoz(numeroDestino, texto, phoneNumberId) {
    const ogg = await sintetizar(limpiarParaVoz(texto));
    if (!ogg) return false;
    return whatsappCloud.enviarNotaVoz(numeroDestino, ogg, phoneNumberId);
}

module.exports = {
    transcribir,
    sintetizar,
    responderPorVoz,
    limpiarParaVoz
};
