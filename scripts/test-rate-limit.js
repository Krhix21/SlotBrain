/**
 * Prueba del límite de intentos del login: 5 fallos en 15 min
 * bloquean la IP 15 minutos. Se extrae la lógica de admin.js
 * replicándola aquí para probarla sin levantar el servidor.
 */
const LOGIN_VENTANA_MS = 15 * 60 * 1000;
const LOGIN_MAX_FALLOS = 5;
const LOGIN_BLOQUEO_MS = 15 * 60 * 1000;
const intentosLogin = new Map();

function loginBloqueado(ip, ahora = Date.now()) {
    const registro = intentosLogin.get(ip);
    if (!registro) return 0;
    if (registro.bloqueadoHasta && registro.bloqueadoHasta > ahora) {
        return Math.ceil((registro.bloqueadoHasta - ahora) / 1000);
    }
    return 0;
}

function registrarFalloLogin(ip, ahora = Date.now()) {
    const registro = intentosLogin.get(ip) || { fallos: [], bloqueadoHasta: 0 };
    registro.fallos = [...(registro.fallos || []), ahora]
        .filter(ts => ahora - ts < LOGIN_VENTANA_MS);
    if (registro.fallos.length >= LOGIN_MAX_FALLOS) {
        registro.bloqueadoHasta = ahora + LOGIN_BLOQUEO_MS;
        registro.fallos = [];
    }
    intentosLogin.set(ip, registro);
}

const fallos = [];
const assert = (cond, msg) => { if (!cond) { console.error('FALLO: ' + msg); process.exitCode = 1; } else console.log('ok - ' + msg); };

const ahora0 = Date.now();
for (let i = 0; i < 4; i++) {
    registrarFalloLogin('1.2.3.4', ahora0 + i * 1000);
    fallos.push(loginBloqueado('1.2.3.4', ahora0 + i * 1000));
}
assert(fallos.every(s => s === 0), 'con 4 fallos no bloquea');
registrarFalloLogin('1.2.3.4', ahora0 + 4000);
assert(loginBloqueado('1.2.3.4', ahora0 + 4000) > 890, 'al 5.º fallo bloquea ~15 min');
assert(loginBloqueado('5.6.7.8', ahora0) === 0, 'otra IP no queda bloqueada');
// Expira el bloqueo
assert(loginBloqueado('1.2.3.4', ahora0 + LOGIN_BLOQUEO_MS + 5000) === 0, 'el bloqueo expira pasados los 15 min');
// Ventana de fallos: fallos viejos no cuentan
intentosLogin.delete('1.2.3.4');
intentosLogin.delete('9.9.9.9');
const viejo = ahora0 - LOGIN_VENTANA_MS - 1000;
registrarFalloLogin('9.9.9.9', viejo);
registrarFalloLogin('9.9.9.9', viejo + 100);
registrarFalloLogin('9.9.9.9', viejo + 200);
registrarFalloLogin('9.9.9.9', viejo + 300);
// 4 fallos nuevos DENTRO de la ventana: todavía no bloquea.
for (let i = 0; i < 4; i++) {
    registrarFalloLogin('9.9.9.9', ahora0 + i * 1000);
    assert(loginBloqueado('9.9.9.9', ahora0 + i * 1000) === 0, `los fallos viejos fuera de la ventana no cuentan (intento ${i + 1})`);
}
// El 5.º dentro de la ventana sí bloquea.
registrarFalloLogin('9.9.9.9', ahora0 + 4000);
assert(loginBloqueado('9.9.9.9', ahora0 + 4000) > 890, '5 fallos DENTRO de la ventana sí bloquean');
