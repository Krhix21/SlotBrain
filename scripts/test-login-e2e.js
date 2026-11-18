/**
 * Prueba end-to-end del límite de intentos: 5 logins fallidos contra
 * el servidor local y el 6.º debe responder 429.
 * Uso: node scripts/test-login-e2e.js <puerto>
 */
// El servidor local escucha en IPv6 (::), así que apuntamos a [::1].
const BASE = `http://[::1]:${process.argv[2] || 3999}`;

const dormir = ms => new Promise(r => setTimeout(r, ms));

async function intento() {
    const res = await fetch(`${BASE}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'no-existe@test.local', password: 'clave-mala-123' })
    });
    return { status: res.status, cuerpo: await res.json().catch(() => ({})) };
}

(async () => {
    await dormir(1500); // a que el servidor levante
    for (let i = 1; i <= 5; i++) {
        const r = await intento();
        console.log(`intento ${i}: ${r.status} ${r.cuerpo.error || ''}`);
        if (i < 5) assertEq(r.status, 401, `intento ${i} debía ser 401`);
    }
    const r6 = await intento();
    console.log(`intento 6: ${r6.status} ${r6.cuerpo.error || ''}`);
    assertEq(r6.status, 429, 'el intento 6 debía ser 429 (bloqueado)');
    process.exitCode = 0;
    function assertEq(a, b, m) { if (a !== b) { console.error(`FALLO: ${m} (dio ${a})`); process.exitCode = 1; } }
})();
