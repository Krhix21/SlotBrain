// Chequeo de escJs y cssColor contra inyecciones.
function escHtml(s) {
    if (!s) return '';
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escJs(s) {
    if (!s) return '';
    return escHtml(String(s)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\r/g, '')
        .replace(/\n/g, '\\n'));
}
function cssColor(valor, fallback) {
    if (typeof valor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(valor.trim())) return valor.trim();
    return fallback;
}

const assert = (c, m) => { if (!c) { console.error('FALLO: ' + m); process.exitCode = 1; } else console.log('ok - ' + m); };

const ataque1 = "x'); alert('pwned";
const out1 = escJs(ataque1);
assert(!out1.includes("'), alert") && !out1.includes("') "), 'escJs neutraliza comilla simple');
// Al decodificar entidades HTML, el string JS resultante sigue siendo válido:
const decodificado = out1.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
assert(decodificado === "x\\'); alert(\\'pwned", 'tras decodificar HTML queda escapado para JS: ' + decodificado);

const ataque2 = 'red" onmouseover="alert(1)';
assert(cssColor(ataque2, '#f59e0b') === '#f59e0b', 'cssColor rechaza valor con comillas');
assert(cssColor('#4700E0', '#x') === '#4700E0', 'cssColor acepta hex válido');
assert(cssColor('#fff', '#x') === '#fff', 'cssColor acepta hex corto');
assert(cssColor(null, '#f59e0b') === '#f59e0b', 'cssColor usa fallback con null');
assert(cssColor('url(javascript:alert(1))', '#x') === '#x', 'cssColor rechaza url()');
