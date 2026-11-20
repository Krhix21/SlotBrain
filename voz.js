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

// ---------------------------------------------------------------- guionizador
//
// Las frases de prueba sonaron naturales porque eran oraciones cortas y con
// puntuación ("Listo, te agendé el corte a las 3."). El modelo usa la
// puntuación como partitura: coma = pausa corta, punto = pausa larga, y las
// oraciones cortas mantienen la entonación viva. Las respuestas del bot llegan
// largas, con listas que al limpiarlas quedan atropelladas. Este paso las
// convierte en un guion de voz: oraciones cortas, puntuación garantizada y
// pausa después del saludo o la confirmación.

// Palabras de arranque que suenan mejor con pausa: "Sí, te agendo..." suena a
// persona; "Sí te agendo" sale atropellado. De la más larga a la más corta:
// "claro que sí" es una unidad en español (la coma va después de los tres).
// No incluimos "si" sin tilde: en "Si quieres te agendo" la coma sonaría mal.
const LEADS_CON_PAUSA = [
    'claro que sí', 'de acuerdo', 'perfecto', 'sí', 'claro', 'hola',
    'listo', 'vale', 'okay', 'bueno', 'dale', 'ok', 'hey'
];

/**
 * Agrega una pausa (coma) después del saludo o confirmación inicial de una
 * oración, si no la trae y no termina justo ahí. Compara normalizado NFC para
 * que las tildes coincieran vengan de donde vengan.
 * @param {string} frase
 * @returns {string}
 */
function _pausaInicial(frase) {
    const f = frase.normalize('NFC');
    const baja = f.toLowerCase();
    for (const lead of LEADS_CON_PAUSA) {
        if (!baja.startsWith(lead)) continue;
        const resto = f.slice(lead.length);
        if (/^\s/.test(resto)) {
            // Sigue un espacio: el lead es la palabra suelta.
            // Si la frase termina justo ahí o ya trae pausa, no toques nada.
            if (/^\s*[,.;:!?…]/.test(resto)) return f;
            return `${f.slice(0, lead.length)}, ${resto.trim()}`;
        }
        // Sin espacio: o termina justo tras el lead ("Sí."), o es prefijo de
        // una palabra más larga ("síndrome"). En el primer caso, no tocar; en
        // el segundo, probar el siguiente lead.
        if (/^[,.;:!?…]/.test(resto)) return f;
        continue;
    }
    return f;
}

/**
 * Parte una oración larga en dos por un conector seguro. Nunca parte entre
 * números, para no romper "de 9 a 12 y de 2 a 6". Recursiva: una parte que
 * siga larga se vuelve a partir.
 * @param {string} frase
 * @returns {string[]}
 */
function _partirLarga(frase) {
    if (frase.split(/\s+/).length <= 24) return [frase];

    const conectores = /(,?\s+)(pero|porque|entonces|así que|además|y)(\s+)/gi;
    let m;
    while ((m = conectores.exec(frase)) !== null) {
        const antes = frase.slice(0, m.index).trimEnd();
        const despues = frase.slice(m.index + m[0].length).trim();
        if (antes.split(/\s+/).length < 5) continue;            // no partes al inicio
        if (/\d$/.test(antes) || /^\d/.test(despues)) continue; // no partas entre números
        const conPunto = /[.!?…]$/.test(antes) ? antes : `${antes}.`;
        return [
            ..._partirLarga(conPunto),
            ..._partirLarga(despues.charAt(0).toUpperCase() + despues.slice(1))
        ];
    }
    return [frase];
}

/**
 * Convierte la respuesta del bot en un guion que el TTS lee con pausas.
 * Oraciones cortas, puntuación garantizada en cada una, pausa tras el
 * saludo/confirmación y números protegidos (no parte "3:00" ni "20.000").
 * @param {string} texto - Texto YA limpio (o crudo; lo limpia igual)
 * @returns {string}
 */
function guionizarParaVoz(texto) {
    if (!texto || typeof texto !== 'string') return '';

    // Cada línea del mensaje es una unidad propia: los ítems de una lista
    // (horarios, precios) quedan con pausa entre sí en vez de pegarse
    // corridos en una sola oración sin respirar.
    const lineas = String(texto).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const unidades = [];
    let items = [];
    const cerrarLista = () => {
        if (items.length) {
            unidades.push(items.join(', '));
            items = [];
        }
    };
    for (const linea of lineas) {
        const esItem = /^([-•*]|\d+[.)])\s*/.test(linea);
        const limpia = limpiarParaVoz(linea);
        if (!limpia) continue;
        if (esItem) items.push(limpia);
        else {
            cerrarLista();
            unidades.push(limpia);
        }
    }
    cerrarLista();
    if (!unidades.length) return '';

    // Símbolos que el TTS deletrea o pronuncia raro.
    const preparadas = unidades.map(u => u
        .replace(/\ba\.?m\.?\b/gi, 'am')
        .replace(/\bp\.?m\.?\b/gi, 'pm')
        .replace(/\s*\((?:hora\s+(?:de|en)\s+[^)]*)\)\s*/gi, ' ') // "(hora de America/Bogota)": dato técnico, no se lee
        .replace(/\s*[-–—]\s+/g, ', ')                        // "corte clásico - $20.000"
        .replace(/&/g, ' y ')
        .replace(/@/g, ' arroba ')
        .replace(/%/g, ' por ciento')
        .replace(/\$\s*(\d[\d.,]*\d|\d)/g, '$1 pesos')          // "$20.000" -> "20.000 pesos"
        .replace(/pesos\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/g, 'pesos. ')      // lista de precios -> oraciones
        .replace(/\b0(\d:\d{2})\b/g, '$1')                     // "09:00" -> "9:00": el cero inicial hace titubear al TTS
        // Sin dígitos en el lookahead: no mete espacios dentro de "3:00" ni "20.000".
        .replace(/([.!?,:;])(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])/g, '$1 ')
        .trim()
    );

    // Protege separadores dentro de números ("20.000", "1,500", "3:00") para
    // que ningún corte de oración los rompa. Se restauran al final.
    const PUNTO = '\uE000';
    const COMA = '\uE001';
    const DOS_PUNTOS = '\uE002';

    // "; " y ": " separan ideas -> oraciones nuevas (los de hora ya están protegidos).
    const oraciones = [];
    for (const trozo of preparadas) {
        const protegido = trozo
            .replace(/(\d)\.(?=\d)/g, `$1${PUNTO}`)
            .replace(/(\d),(?=\d)/g, `$1${COMA}`)
            .replace(/(\d):(?=\d)/g, `$1${DOS_PUNTOS}`);
        for (const pedazo of protegido.split(/\s*[;:]\s*/)) {
            const pedazos = pedazo.match(/[^.!?…]*[.!?…]+|[^.!?…]+/g) || [];
            for (let p of pedazos) {
                p = p.trim();
                if (!p) continue;
                for (let f of _partirLarga(p)) {
                    f = f.trim();
                    if (!f) continue;
                    if (!/[.!?…]$/.test(f)) f += '.';
                    // Pausa tras el saludo/confirmación inicial ("Sí, te agendo...").
                    f = _pausaInicial(f);
                    f = f.charAt(0).toUpperCase() + f.slice(1);
                    oraciones.push(f);
                }
            }
        }
    }

    return oraciones
        .join(' ')
        .replace(new RegExp(PUNTO, 'g'), '.')
        .replace(new RegExp(COMA, 'g'), ',')
        .replace(new RegExp(DOS_PUNTOS, 'g'), ':')
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
    const ogg = await sintetizar(guionizarParaVoz(texto));
    if (!ogg) return false;
    return whatsappCloud.enviarNotaVoz(numeroDestino, ogg, phoneNumberId);
}

module.exports = {
    transcribir,
    sintetizar,
    responderPorVoz,
    limpiarParaVoz,
    guionizarParaVoz
};
