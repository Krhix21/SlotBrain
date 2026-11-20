// ============================================================
// Notificaciones programadas (Fase 4 + agente dueño).
//
// Cada minuto:
//   · recordatorio al profesional / cliente
//   · digest matutino al propietario (1×/día)
//
// Al enviar recordatorio al cliente se setea conversaciones.pending_reminder
// para el loop SÍ → confirmada / NO → reagenda (bot.js).
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { enviarMensajeTexto } = require('./whatsappCloud');
const {
    formatearFechaLarga,
    hoyEnZona,
    horaAhoraEnZona
} = require('./tiempo');
const disponibilidad = require('./disponibilidad');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const CICLO_MS = 60 * 1000;
const TTL_REMINDER_MS = 6 * 60 * 60 * 1000;

function politicasDe(empresa) {
    const p = (empresa && typeof empresa.politicas === 'object' && empresa.politicas) || {};
    return {
        recordatorio_profesional_horas: Number(p.recordatorio_profesional_horas) > 0
            ? Number(p.recordatorio_profesional_horas) : 24,
        recordatorio_cliente_horas: Number(p.recordatorio_cliente_horas) >= 0
            ? Number(p.recordatorio_cliente_horas) : 2,
        digest_hora: typeof p.digest_hora === 'string' && /^\d{2}:\d{2}$/.test(p.digest_hora)
            ? p.digest_hora : '08:00',
        avisar_dueno: p.avisar_dueno !== false,
        ultimo_digest_fecha: p.ultimo_digest_fecha || null
    };
}

function claveNotificacion(tipo, horas) {
    return tipo === 'profesional' ? `profesional_${horas}h` : `cliente_${horas}h`;
}

async function citasARevisar() {
    const desde = new Date().toISOString();
    const hasta = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
        .from('citas')
        .select(`
            id, empresa_id, nombre_cliente, telefono_cliente, bsuid,
            nombre_servicio, fecha, hora, inicio_utc, notificaciones,
            trabajadores (id, nombre, telefono),
            empresas (id, nombre, zona_horaria, politicas)
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

async function phoneNumberIdDe(empresaId) {
    const { data } = await supabase
        .from('numeros_bot')
        .select('phone_number_id, telefono')
        .eq('empresa_id', empresaId)
        .eq('activo', true)
        .order('creado_en')
        .limit(1);
    return (data && data[0]) || null;
}

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

function yaEnviado(notificaciones, clave) {
    const registro = notificaciones?.[clave];
    if (!registro) return false;
    if (typeof registro === 'string') return true;
    return registro.estado === 'enviado';
}

async function setPendingReminder({ telefonoBot, telefonoCliente, bsuid, citaId }) {
    if (!telefonoBot || (!telefonoCliente && !bsuid)) return;

    let fila = null;
    if (telefonoCliente) {
        const { data } = await supabase
            .from('conversaciones')
            .select('id, pending_reminder, bsuid')
            .eq('telefono_bot', telefonoBot)
            .eq('telefono_cliente', telefonoCliente)
            .maybeSingle();
        fila = data;
    }
    if (!fila && bsuid) {
        const { data } = await supabase
            .from('conversaciones')
            .select('id, pending_reminder, bsuid')
            .eq('telefono_bot', telefonoBot)
            .eq('bsuid', bsuid)
            .maybeSingle();
        fila = data;
    }

    const pending = {
        citaId,
        creadoEn: Date.now(),
        expira: Date.now() + TTL_REMINDER_MS
    };

    if (fila?.id) {
        await supabase
            .from('conversaciones')
            .update({ pending_reminder: pending, bsuid: bsuid || fila.bsuid || null })
            .eq('id', fila.id);
    } else {
        await supabase.from('conversaciones').insert({
            telefono_bot: telefonoBot,
            telefono_cliente: telefonoCliente || null,
            bsuid: bsuid || null,
            pending_reminder: pending,
            mensajes: []
        });
    }
}

async function registrarRespuestaCliente(citaId, respuesta) {
    const { data: cita } = await supabase
        .from('citas')
        .select('notificaciones')
        .eq('id', citaId)
        .maybeSingle();
    const actuales = (cita && cita.notificaciones) || {};
    actuales.respuesta_cliente = { valor: respuesta, ts: new Date().toISOString() };
    await supabase.from('citas').update({ notificaciones: actuales }).eq('id', citaId);
}

async function destinoDueno(empresaId) {
    const { data } = await supabase
        .from('usuarios_admin')
        .select('telefono, bsuid')
        .eq('empresa_id', empresaId)
        .eq('rol', 'propietario')
        .eq('activo', true)
        .not('telefono', 'is', null)
        .limit(1);

    if (data && data[0]?.telefono) return data[0].telefono;

    const { data: conBsuid } = await supabase
        .from('usuarios_admin')
        .select('telefono, bsuid')
        .eq('empresa_id', empresaId)
        .eq('rol', 'propietario')
        .eq('activo', true)
        .not('bsuid', 'is', null)
        .limit(1);

    return (conBsuid && (conBsuid[0].telefono || conBsuid[0].bsuid)) || null;
}

/**
 * Aviso corto al dueño tras agendar/cancelar/modificar.
 * Best-effort: nunca bloquea el flujo de la cita.
 */
async function avisarDueno({ empresa, tipo, texto }) {
    if (!empresa?.id) return;
    const politicas = politicasDe(empresa);
    if (!politicas.avisar_dueno) return;

    const destino = await destinoDueno(empresa.id);
    if (!destino) {
        console.warn(`⚠️  Sin teléfono/BSUID de propietario para avisar (${empresa.nombre || empresa.id}).`);
        return;
    }

    const botNum = await phoneNumberIdDe(empresa.id);
    if (!botNum?.phone_number_id) return;

    const intento = await enviarMensajeTexto(destino, texto, botNum.phone_number_id, { diagnostico: true });
    if (!intento.enviado) {
        console.warn(`⚠️  Aviso dueño (${tipo}) falló:`, intento.error?.motivo || 'sin detalle');
    }
}

async function marcarDigestEnviado(empresaId, politicas, fechaLocal) {
    const nuevas = { ...(politicas || {}), ultimo_digest_fecha: fechaLocal };
    // Releer politicas frescas de la fila
    const { data: emp } = await supabase
        .from('empresas')
        .select('politicas')
        .eq('id', empresaId)
        .maybeSingle();
    const base = (emp && typeof emp.politicas === 'object' && emp.politicas) || {};
    await supabase
        .from('empresas')
        .update({ politicas: { ...base, ultimo_digest_fecha: fechaLocal } })
        .eq('id', empresaId);
    return nuevas;
}

async function enviarDigestEmpresa(empresa) {
    const zona = empresa.zona_horaria || 'America/Bogota';
    const politicas = politicasDe(empresa);
    const hoy = hoyEnZona(zona);
    const hora = horaAhoraEnZona(zona);

    if (politicas.ultimo_digest_fecha === hoy) return;
    if (hora < politicas.digest_hora) return;
    // Ventana corta: solo dentro de la hora del digest (evita spam si el proceso estuvo caído)
    const [hDig] = politicas.digest_hora.split(':').map(Number);
    const [hAhora] = hora.split(':').map(Number);
    if (hAhora > hDig) {
        // Ya pasó la hora: marcar como enviado vacío para no bombardear al mediodía
        await marcarDigestEnviado(empresa.id, empresa.politicas, hoy);
        return;
    }

    const destino = await destinoDueno(empresa.id);
    if (!destino) {
        console.warn(`⚠️  Digest: propietario sin teléfono (${empresa.nombre}).`);
        await marcarDigestEnviado(empresa.id, empresa.politicas, hoy);
        return;
    }

    const { data: citas } = await supabase
        .from('citas')
        .select('nombre_cliente, nombre_servicio, hora, estado, trabajadores(nombre)')
        .eq('empresa_id', empresa.id)
        .eq('fecha', hoy)
        .in('estado', ['agendada', 'confirmada'])
        .order('hora');

    const lista = citas || [];
    let huecosTxt = '';
    try {
        const { slots, trabajadores } = await disponibilidad.obtenerSlots({
            empresa,
            fecha: hoy,
            duracionMinutos: empresa.slot_minutos || 30
        });
        if (!trabajadores.length) huecosTxt = 'Sin profesionales activos.';
        else if (!slots.length) huecosTxt = 'Sin huecos libres hoy.';
        else {
            const porProf = {};
            for (const s of slots) {
                const k = s.trabajador_nombre || 'equipo';
                porProf[k] = (porProf[k] || 0) + 1;
            }
            huecosTxt = Object.entries(porProf)
                .map(([n, c]) => `${n}: ${c} hueco(s)`)
                .join(', ');
        }
    } catch (err) {
        huecosTxt = 'No pude calcular huecos.';
        console.warn('⚠️  Digest huecos:', err.message);
    }

    const lineas = lista.length
        ? lista.map(c =>
            `• ${c.hora} ${c.nombre_cliente || 'cliente'} — ${c.nombre_servicio || 'servicio'} ` +
            `(${c.trabajadores?.nombre || '—'}) [${c.estado}]`
        ).join('\n')
        : '• Sin citas vigentes';

    const texto =
        `☀️ Buenos días — agenda de ${empresa.nombre} (${formatearFechaLarga(hoy)}):\n` +
        `${lineas}\n\nHuecos: ${huecosTxt}`;

    const botNum = await phoneNumberIdDe(empresa.id);
    if (!botNum?.phone_number_id) {
        await marcarDigestEnviado(empresa.id, empresa.politicas, hoy);
        return;
    }

    const intento = await enviarMensajeTexto(destino, texto, botNum.phone_number_id, { diagnostico: true });
    if (intento.enviado) {
        console.log(`📤 Digest matutino → ${destino} (${empresa.nombre})`);
    } else {
        console.warn(`⚠️  Digest fallido (${empresa.nombre}):`, intento.error?.motivo || 'sin detalle');
    }
    await marcarDigestEnviado(empresa.id, empresa.politicas, hoy);
}

async function revisarDigestos() {
    const { data, error } = await supabase
        .from('empresas')
        .select('id, nombre, zona_horaria, politicas, slot_minutos, horario, activo')
        .eq('activo', true);

    if (error) {
        console.error('❌ Digest empresas:', error.message);
        return;
    }

    for (const empresa of data || []) {
        try {
            await enviarDigestEmpresa(empresa);
        } catch (err) {
            console.error(`❌ Digest ${empresa.id}:`, err.message);
        }
    }
}

async function revisar() {
    const citas = await citasARevisar();
    const ahora = Date.now();

    for (const cita of citas) {
        const empresa = cita.empresas;
        const trabajador = cita.trabajadores;
        const politicas = politicasDe(empresa);
        const kilometro = new Date(cita.inicio_utc).getTime();
        const faltan = kilometro - ahora;

        const horasProf = politicas.recordatorio_profesional_horas;
        if (faltan <= horasProf * 60 * 60 * 1000) {
            const clave = claveNotificacion('profesional', horasProf);
            if (!yaEnviado(cita.notificaciones, clave)) {
                if (trabajador?.telefono) {
                    const texto =
                        `🔔 Recordatorio ${empresa?.nombre || ''}: cita con ` +
                        `${cita.nombre_cliente} el ${formatearFechaLarga(cita.fecha)} ` +
                        `a las ${cita.hora} (${cita.nombre_servicio}). No olvides prepararte.`;

                    const botNum = await phoneNumberIdDe(cita.empresa_id);
                    const intento = await enviarMensajeTexto(
                        trabajador.telefono,
                        texto,
                        botNum?.phone_number_id,
                        { diagnostico: true }
                    );

                    if (intento.enviado) {
                        console.log(`📤 Recordatorio profesional ${clave} → ${trabajador.nombre}`);
                        await registrarResultado(cita.id, clave, 'enviado');
                    } else {
                        await registrarResultado(
                            cita.id, clave, 'fallido',
                            intento.error
                                ? `[${intento.error.tipo}] ${intento.error.motivo}`
                                : 'sin token de Meta configurado o el número no respondió'
                        );
                    }
                } else {
                    console.warn(`⚠️  El profesional ${trabajador?.nombre || '?'} no tiene teléfono.`);
                    await registrarResultado(cita.id, clave, 'fallido', 'el profesional no tiene teléfono en el panel');
                }
            }
        }

        const destinoCliente = cita.telefono_cliente || cita.bsuid;
        const horasCli = politicas.recordatorio_cliente_horas;
        if (faltan <= horasCli * 60 * 60 * 1000 && destinoCliente) {
            const clave = claveNotificacion('cliente', horasCli);
            if (!yaEnviado(cita.notificaciones, clave)) {
                const texto =
                    `Hola ${cita.nombre_cliente} 👋 Te recuerdo tu cita de ${cita.nombre_servicio} ` +
                    `en ${empresa?.nombre || 'nuestro negocio'} el ${formatearFechaLarga(cita.fecha)} ` +
                    `a las ${cita.hora}. Responde SÍ para confirmar o NO si necesitas cambiarla.`;

                const botNum = await phoneNumberIdDe(cita.empresa_id);
                const intento = await enviarMensajeTexto(
                    destinoCliente,
                    texto,
                    botNum?.phone_number_id,
                    { diagnostico: true }
                );

                if (intento.enviado) {
                    console.log(`📤 Recordatorio cliente ${clave} → ${destinoCliente}`);
                    await registrarResultado(cita.id, clave, 'enviado');
                    await setPendingReminder({
                        telefonoBot: botNum?.telefono || null,
                        telefonoCliente: cita.telefono_cliente || null,
                        bsuid: cita.bsuid || null,
                        citaId: cita.id
                    });
                } else {
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

    await revisarDigestos();
}

function iniciar() {
    console.log('🕘 Scheduler de notificaciones activo (cada minuto, con digest).');
    revisar().catch(err => console.error('Error en ciclo de notificaciones:', err));
    setInterval(() => {
        revisar().catch(err => console.error('Error en ciclo de notificaciones:', err));
    }, CICLO_MS).unref();
}

module.exports = {
    iniciar,
    revisar,
    avisarDueno,
    registrarRespuestaCliente
};
