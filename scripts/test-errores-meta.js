#!/usr/bin/env node
// ============================================================
// Prueba en cuidado (sin red) del mapa de errores de Meta.
//
// Reproduce los 3 casos pedidos en la Fase 1 + token inválido.
//   · destinatario no autorizado  → 131030
//   · fuera de la ventana de 24 h → 131047
//   · salud del ecosistema        → 131049
//   · token inválido o vencido    → 190
//   + 131026 (no enttabla) como caso adicional de bucket
// ============================================================

const { explicarErrorMeta } = require('../erroresMeta');

const CASOS = [
    {
        nombre: 'Destinatario no autorizado (sandbox)',
        error: {
            error: {
                message: '(#131030) Recipient phone number not in allowed list',
                type: 'OAuthException', code: 131030,
                error_data: { messaging_product: 'whatsapp', details: 'El número de teléfono del destinatario no está en la lista de autorizados: Agrega el número de teléfono del destinatario a la lista de destinatarios y vuelve a intentar.' }
            }
        },
        esperado: 'sandbox_destinatario_no_permitido'
    },
    {
        nombre: 'Fuera de la ventana de 24 h',
        error: {
            error: {
                message: '(#131047) Re-engagement message',
                code: 131047,
                error_data: { details: 'More than 24 hours have passed since the recipient last replied to the sender number.' }
            }
        },
        esperado: 'ventana_24h'
    },
    {
        nombre: 'Salud del ecosistema (Meta no entrega)',
        error: {
            error: {
                message: '(#131049) This message was not delivered to maintain healthy ecosystem engagement.',
                code: 131049
            }
        },
        esperado: 'ecosistema_protegido'
    },
    {
        nombre: 'Token inválido o vencido',
        error: {
            error: {
                message: 'Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons.',
                type: 'OAuthException', code: 190, fbtrace_id: 'A0jU0dz3PLy'
            }
        },
        esperado: 'token_invalido'
    },
    {
        nombre: 'No entregable (bucket 131026)',
        error: { error: { message: '(#131026) Unable to deliver message. This may be because the user\'s phone number is not a WhatsApp phone number, ...', code: 131026 } },
        esperado: 'no_entregable'
    }
];

let fallos = 0;
for (const caso of CASOS) {
    const { tipo, motivo, crudo } = explicarErrorMeta(caso.error);
    const ok = tipo === caso.esperado;
    if (!ok) fallos++;
    console.log(`${ok ? '✅' : '❌'} ${caso.nombre}`);
    console.log(`   tipo: ${tipo}${ok ? '' : ` (esperado: ${caso.esperado})`}`);
    console.log(`   motivo: ${motivo.slice(0, 120)}${motivo.length > 120 ? '…' : ''}`);
    console.log(`   crudo presente: ${crudo.length > 0}`);
    console.log('');
}

process.exit(fallos === 0 ? 0 : 1);
