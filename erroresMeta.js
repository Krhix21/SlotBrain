// ============================================================
// Explicación legible de los errores de la Cloud API de Meta.
//
// Fuente: docs de Meta (developers.facebook.com/documentation/
// business-messaging/whatsapp/support/error-codes) y casos reales
// reportados en la comunidad (revi seo 2026-11).
//
// Reglas:
//  · `motivo` debe ser comprensible para el dueño del número, no para
//    un desarrollador: guía para resolver, no jerga.
//  · `crudo` guarda el JSON tal cual lo envió Meta: para el log y sin
//    editar (el mensaje exacto cambia con el tiempo).
//  · NUNCA se inventa un código: si no está mapeado, `tipo` es
//    'error_meta' y motivo es texto genérico con el mensaje original.
// ============================================================

/** Trata el payload de error de Graph ( puede ser {error:{...}} o plano). */
function explicarErrorMeta(raw) {
    const err = raw?.error || raw || {};
    const codigo = typeof err.code === 'number' ? err.code : null;
    const subcodigo = err.error_subcode ?? null;
    const details = err.error_data?.details || err.details || err.message || '';
    const crudo = JSON.stringify(raw).slice(0, 2000);

    let tipo = 'error_meta';
    let motivo = (typeof details === 'string' && details)
        ? `Error de Meta (${codigo ?? 'sin código'}): ${details}`
        : `Error de Meta (${codigo ?? 'sin código'}): ${err.message || 'respuesta no estándar'}`;

    switch (codigo) {
        case 131030:
            tipo = 'sandbox_destinatario_no_permitido';
            motivo = 'El destinatario no está en la lista de los números verificados del número de PRUEBA. ' +
                'Agrégalo en Meta for Developers → WhatsApp → API Setup → destinatarios de mensajes (máximo 5) ' +
                'o pasa la empresa a una línea real (modo producción).';
            break;

        case 131026:
            tipo = 'no_entregable';
            motivo = 'Meta no pudo entregar el mensaje (131026). Causas típicas: el número no tiene WhatsApp activo, ' +
                'no aceptó los Términos y la Política de privacidad, o usa una versión de WhatsApp muy vieja. ' +
                'No es culpa del bot: al escribir este destinatario desde el teléfono del negocio se sincroniza el estado.';
            break;

        case 131047:
            tipo = 'ventana_24h';
            motivo = 'Pasaron más de 24 h desde la última respuesta del destinatario (131047). ' +
                'Para escribir de nuevo se requiere una PLANTILLA aprobada por Meta (línea real) o que el destinatario ' +
                'escriba un mensaje primero. Este intento no se reenvió.';
            break;

        case 131049:
            tipo = 'ecosistema_protegido';
            motivo = 'Meta decidió NO entregar el mensaje para proteger al usuario de exceso de mensajes (131049). ' +
                'No reintentar de inmediato: espera y reduce la frecuencia. El mensaje quedó marcado como no enviado.';
            break;

        case 190:
            tipo = 'token_invalido';
            motivo = 'El token de Meta es inválido, expiró o fue revocado (190). ' +
                'Genera un token PERMANENTE usuario de sistema —no temporal de 24 h— y vuelve a conectar el número en el panel.';
            break;

        case 200:
            tipo = 'permisos_insuficientes';
            motivo = 'El token no tiene permisos sobre este número (200): faltan whatsapp_business_management / ' +
                'whatsapp_business_messaging, o la app no está suscrita a la WABA (POST /{waba_id}/subscribed_apps).';
            break;

        case 131051:
            tipo = 'tipo_no_soportado';
            motivo = 'El tipo de mensaje no está soportado por la API (131051). Revisa el payload del envío.';
            break;

        case 80007:
        case 130429:
            tipo = 'limite_tasa';
            motivo = 'Se alcanzó el límite de tasa de la Cloud API (80007/130429). Reintentar más tarde.';
            break;
    }

    return { codigo, subcodigo, tipo, motivo, crudo };
}

module.exports = { explicarErrorMeta };
