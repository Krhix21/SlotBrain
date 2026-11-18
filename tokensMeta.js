// ============================================================
// Cifrado del token de Meta por número (Fase 3A).
//
// El token de la WABA de cada empresa vive en `numeros_bot.meta_
// token_cifrado`, cifrado con AES-256-GCM. La clave maestra es
// APP_ENCRYPTION_KEY del entorno: si se pierde, los tokens dejan de
// poder descifrarse (habría que re-conectar los números desde el
// panel). Nunca se devuelve el token por la API: solo se descifra
// internamente para enviar.
//
// Formato del texto cifrado: base64url(iv).base64url(tag).base64url(ct)
// ============================================================

const crypto = require('crypto');

function claveDe32() {
    const raw = process.env.APP_ENCRYPTION_KEY;
    if (!raw) {
        // Es preferible fallar ruidoso que guardar tokens en claro.
        throw new Error('Falta APP_ENCRYPTION_KEY en el entorno: no se pueden cifrar tokens de Meta.');
    }
    // Acepta una key de 64 hex (32 bytes) o deriva una de frase/cualquier string.
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
    return crypto.createHash('sha256').update(raw).digest();
}

/** @param {string} textoPlano */
function cifrar(textoPlano) {
    const clave = claveDe32();
    const iv = crypto.randomBytes(12);
    const cifrador = crypto.createCipheriv('aes-256-gcm', clave, iv);
    const ct = Buffer.concat([cifrador.update(String(textoPlano), 'utf8'), cifrador.final()]);
    const tag = cifrador.getAuthTag();
    return [
        iv.toString('base64url'),
        tag.toString('base64url'),
        ct.toString('base64url')
    ].join('.');
}

/** @param {string} textoCifrado @returns {string|null} null si no puede descifrar */
function descifrar(textoCifrado) {
    if (!textoCifrado) return null;
    const partes = String(textoCifrado).split('.');
    if (partes.length !== 3) return null;

    try {
        const [iv, tag, ct] = partes.map(p => Buffer.from(p, 'base64url'));
        const descifrador = crypto.createDecipheriv('aes-256-gcm', claveDe32(), iv);
        descifrador.setAuthTag(tag);
        return Buffer.concat([descifrador.update(ct), descifrador.final()]).toString('utf8');
    } catch {
        return null; // clave distinta o datos manipulados: SIN token
    }
}

module.exports = { cifrar, descifrar };
