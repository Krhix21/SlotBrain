// ============================================================
// Notificaciones programadas (Fase 4).
//
// Un scheduler revisa cada minuto las citas vigentes y envía:
//   · al PROFESIONAL: recordatorio por WhatsApp antes de su cita
//     (por defecto 24 h antes).
//   · al CLIENTE: recordatorio (por defecto 2 h antes).
//
// La punto de verdad de "ya se avisó" es `citas.notificaciones`
// (JSONB), clave por tipo: { profesional_24h: ts, cliente_2h: ts }.
// Si el envío falla NO se marca como enviado: el siguiente ciclo lo
// reintenta (con los límites de ventana que Meta impone).
//
// Umbrales por empresa en `empresas.politicas`:
//   · recordatorio_profesional_horas (default 24)
//   · recordatorio_cliente_horas (default 2)
//
// IMPORTANTE (Meta): mensajes que el bot INICIA fuera de la ventana de
// 24 h exigen plantillas UTILITY aprobadas por WABA (Fase 3.3D). Con el
// número de prueba esto solo llegará a destinatarios verificados; por
// eso cada envío se registra aquí aunque Meta lo rechace.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { enviarMensajeTexto } = require('./whatsappCloud');
const {
    formatearFechaLarga
} = require('./tiempo');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const CICLO_MS = 60 * 1000; // revisa cada minuto

function politicasDe(empresa) {
    const p = (empresa && typeof empresa.politicas === 'object' && empresa.politicas) || {};
    return {
        recordatorio_profesional_horas: Number(p.recordatorio_profesional_horas) > 0
            ? Number(p.recordatorio_profesional_horas) : 24,
        recordatorio_cliente_horas: Number(p.recordatorio_cliente_horas) >= 0
            ? Number(p.recordatorio_cliente_horas) : 2
    };
}

function claveNotificacion(tipo, horas) {
    return tipo === 'profesional' ? `profesional_${horas}h` : `cliente_${horas}h`;
}

/**
 * Citas vigentes dentro de las próximas 24 h que requieren revisión.
 * El filtro en SQL evita escanear el histórico: el índice
 * idx_citas_inicio_utc hace el rango barato.
 */
async function citasARevisar() {
    const desde = new Date().toISOString();
    const hasta = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
        .from('citas')
        .select(`
            id, empresa_id, nombre_cliente, telefono_cliente,
            nombre_servicio, fecha, hora, inicio_utc, notificaciones,
            trabajadores (id, nombre, telefono),
            empresas (nombre, zona_horaria, politicas)
        `)
        .in('estado', ['agendada', 'confirmada'])
        .gt('inicio_utc', desde)
        .lt('inicio_utc', hasta);

    if (error) {
        console.error('❌ Error consultando citas para recordatorios:', error.message);
        return [];
    }
    return data || [];
}

/** phone_number_id activo de la empresa (del quemando se envía). */
async function phoneNumberIdDe(empresaId) {
    const { data } = await supabase
        .from('numeros_bot')
        .select('phone_number_id')
        .eq('empresa_id', empresaId)
        .eq('activo', true)
        .order('creado_en')
        .limit(1);
    return (data && data[0]?.phone_number_id) || null;
}

/**
 * Registra el resultado del intento sobre la clave (tipo) de esta cita.
 *   · { estado:'enviado', ts }  → el scheduler NO reenvía (idempotencia).
 *   · { estado:'fallido', motivo, ts } → el scheduler reintenta el
 *     siguiente ciclo y el panel puede revisar el motivo.
 * Se lee la fila fresca antes de escribir para no pisar otra clave
 * marcada en el mismo ciclo.
 */
async function registrarResultado(id, clave, estado, motivo = null) {
    const { data: cita } = await supabase
        .from('citas')
        .select('notificaciones')
        .eq('id', id)
        .maybeSingle();

    const actuales = (cita && cita.notificaciones) || {};
    actuales[clave] = estado === 'enviado'
        ? { estado, ts: new Date().toISOString() }
        : { estado, motivo: motivo || 'sin detalle', ts: new Date().toISOString() };

    return supabase
        .from('citas')
        .update({ notificaciones: actuales })
        .eq('id', id);
}

/** ¿Esta clave ya quedó ENVIADA? (los fallidos siempre se re-intentan)
 * Los registros viejos eran strings con la hora del envío: se respetan
 * como enviados para no reenviar recordatorios que ya salieron. */
function yaEnviado(notificaciones, clave) {
    const registro = notificaciones?.[clave];
    if (!registro) return false;
    if (typeof registro === 'string') return true; // formato antiguo
    return registro.estado === 'enviado';
}

async function revisar() {
    const citas = await citasARevisar();
    if (citas.length === 0) return;

    const ahora = Date.now();

    for (const cita of citas) {
        const empresa = cita.empresas;
        const trabajador = cita.trabajadores;
        const politicas = politicasDe(empresa);
        const kilometro = new Date(cita.inicio_utc).getTime();
        const faltan = kilometro - ahora;

        // El profesional se entera con la antelación configurada.
        const horasProf = politicas.recordatorio_profesional_horas;
        if (faltan <= horasProf * 60 * 60 * 1000) {
            const clave = claveNotificacion('profesional', horasProf);
            if (!yaEnviado(cita.notificaciones, clave)) {
                if (trabajador?.telefono) {
                    const texto =
                        `🔔 Recordatorio ${empresa?.nombre || ''}: citas con ` +
                        `${cita.nombre_cliente} el ${formatearFechaLarga(cita.fecha)} ` +
                        `a las ${cita.hora} (${cita.nombre_servicio}). No olvides prepararte.`;

                    const phoneNumberId = await phoneNumberIdDe(cita.empresa_id);
                    const intento = await enviarMensajeTexto(trabajador.telefono, texto, phoneNumberId, { diagnostico: true });

                    if (intento.enviado) {
                        console.log(`📤 Recordatorio profesional ${clave} → ${trabajador.nombre} (${cita.fecha} ${cita.hora})`);
                        await registrarResultado(cita.id, clave, 'enviado');
                    } else {
                        console.warn(`⚠️  Recordatorio profesional ${clave} (cita ${cita.id}) → fallido. Se reintenta el próximo ciclo.`);
                        await registrarResultado(
                            cita.id, clave, 'fallido',
                            intento.error
                                ? `[${intento.error.tipo}] ${intento.error.motivo}`
                                : 'sin token de Meta configurado o el número no respondió'
                        );
                    }
                } else {
                    console.warn(`⚠️  El profesional ${trabajador?.nombre || cita.trabajador_id} no tiene teléfono: sin recordatorio.`);
                    await registrarResultado(cita.id, clave, 'fallido', 'el profesional no tiene teléfono en el panel'); // no reintentar para siempre
                }
            }
        }

        // El cliente se avisa más cerca de la cita.
        const horasCli = politicas.recordatorio_cliente_horas;
        if (faltan <= horasCli * 60 * 60 * 1000 && cita.telefono_cliente) {
            const clave = claveNotificacion('cliente', horasCli);
            if (!yaEnviado(cita.notificaciones, clave)) {
                const texto =
                    `Hola ${cita.nombre_cliente} 👋 Te recuerdo tu cita de ${cita.nombre_servicio} ` +
                    `en ${empresa?.nombre || 'nuestro negocio'} el ${formatearFechaLarga(cita.fecha)} ` +
                    `a las ${cita.hora}. Responde SÍ para confirmar o NO si necesitas cambiarla.`;

                const phoneNumberId = await phoneNumberIdDe(cita.empresa_id);
                const intento = await enviarMensajeTexto(cita.telefono_cliente, texto, phoneNumberId, { diagnostico: true });

                if (intento.enviado) {
                    console.log(`📤 Recordatorio cliente ${clave} → ${cita.telefono_cliente} (${cita.fecha} ${cita.hora})`);
                    await registrarResultado(cita.id, clave, 'enviado');
                } else {
                    console.warn(`⚠️  Recordatorio cliente ${clave} (cita ${cita.id}) → fallido. Se reintenta el próximo ciclo.`);
                    await registrarResultado(
                        cita.id, clave, 'fallido',
                        intento.error
                            ? `[${intento.error.tipo}] ${intento.error.motivo}`
                            : 'sin token de Meta configurado o el número no respondió'
                    );
                }
            }
        }
    }
}

function iniciar() {
    console.log('🕘 Scheduler de notificaciones activo (cada minuto).');
    // La primera revisión corre aparte para no retrasar el arranque.
    revisar().catch(err => console.error('Error en ciclo de notificaciones:', err));
    setInterval(() => {
        revisar().catch(err => console.error('Error en ciclo de notificaciones:', err));
    }, CICLO_MS).unref();
}

module.exports = { iniciar, revisar };
