// ============================================================
// Lista de espera para turnos liberados (migración v12).
//
// El cliente pide una hora ocupada y acepta quedar en lista; cuando
// esa cita se cancela o se mueve, el primero de la lista recibe la
// oferta por WhatsApp con una ventana corta (empresas.politicas
// ->>'lista_espera_minutos', default 30).
//
// Estados de lista_espera:
//   activa   → el cliente quiere el turno, aún sin oferta
//   avisada  → oferta enviada, esperando el SÍ dentro de la ventana
//   agendada → aceptó y la cita quedó creada
//   vencida  → la ventana pasó o el hueco lo ocupó otra persona
//   cancelada→ el cliente dijo NO
//
// El SÍ/NO del cliente viaja en conversaciones.pending_oferta (igual
// que pending_reminder) y lo interpreta bot.js (manejarRespuestaOferta).
//
// Requiere teléfono real del cliente: la lista no funciona para chats
// con solo BSUID (no habría a quién apartarle la cita).
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { enviarMensajeTexto } = require('./whatsappCloud');
const {
    normalizarHora,
    formatearFechaCercana,
    ZONA_POR_DEFECTO
} = require('./tiempo');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const VENTANA_DEFAULT_MIN = 30;
// La pregunta "¿te dejo en la lista?" caduca igual que una reserva pendiente.
const TTL_PREGUNTA_MS = 30 * 60 * 1000;

// calendar/disponibilidad/notificaciones se requieren dentro de las
// funciones: calendar.js y notificaciones.js llaman a este módulo y un
// require en la cima crearía dependencias circulares.

function ventanaMinutos(empresa) {
    const p = (empresa && typeof empresa.politicas === 'object' && empresa.politicas) || {};
    const n = Number(p.lista_espera_minutos);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : VENTANA_DEFAULT_MIN;
}

/** La hora viene de una columna TIME: llega "10:00:00" y hay que dejarla "10:00". */
function horaDeDb(hora) {
    return normalizarHora(String(hora || '').slice(0, 5));
}

/** Guarda (o deja) la preferencia del cliente por un turno que estaba ocupado. */
async function registrar({
    empresaId,
    servicioId = null,
    trabajadorId = null,
    fecha,
    horaDeseada,
    telefonoCliente,
    nombreCliente = null
}) {
    if (!empresaId || !fecha || !telefonoCliente) return null;
    const hora = normalizarHora(horaDeseada);
    if (!hora) return null;

    // Ya está en lista para ese mismo turno: no duplicar.
    const { data: existente } = await supabase
        .from('lista_espera')
        .select('id, estado')
        .eq('empresa_id', empresaId)
        .eq('fecha', fecha)
        .eq('hora_deseada', hora)
        .eq('telefono_cliente', telefonoCliente)
        .in('estado', ['activa', 'avisada'])
        .maybeSingle();
    if (existente) return existente;

    const { data, error } = await supabase
        .from('lista_espera')
        .insert({
            empresa_id: empresaId,
            servicio_id: servicioId || null,
            trabajador_id: trabajadorId || null,
            fecha,
            hora_deseada: hora,
            telefono_cliente: telefonoCliente,
            nombre_cliente: nombreCliente || null,
            estado: 'activa'
        })
        .select('id, estado')
        .single();

    if (error) {
        console.error('⚠️  Lista de espera (registro):', error.message);
        return null;
    }
    return data;
}

/**
 * Llamado por calendar.js cuando un turno queda libre (cancelación o
 * movimiento). Busca al primero de la lista para ese turno exacto,
 * revalida que siga libre y le envía la oferta por WhatsApp.
 * @returns {Promise<boolean>} true si se envió una oferta
 */
async function revisarLiberacion({ empresa, trabajador, fecha, hora, telefonoExcluido = null }) {
    if (!empresa?.id || !trabajador?.id || !fecha) return false;
    const horaNorm = normalizarHora(hora) || horaDeDb(hora);
    if (!horaNorm) return false;

    const { data: candidatos, error } = await supabase
        .from('lista_espera')
        .select('id, servicio_id, telefono_cliente, nombre_cliente, hora_deseada')
        .eq('empresa_id', empresa.id)
        .eq('fecha', fecha)
        .eq('estado', 'activa')
        .or(`trabajador_id.eq.${trabajador.id},trabajador_id.is.null`)
        .order('creado_en', { ascending: true });

    if (error) {
        console.warn('⚠️  Lista de espera (búsqueda):', error.message);
        return false;
    }

    for (const candidato of candidatos || []) {
        const horaCandidato = horaDeDb(candidato.hora_deseada);
        if (horaCandidato !== horaNorm) continue;
        if (telefonoExcluido && candidato.telefono_cliente === telefonoExcluido) continue;

        const { data: servicio } = candidato.servicio_id
            ? await supabase
                .from('servicios')
                .select('nombre, duracion_minutos')
                .eq('id', candidato.servicio_id)
                .maybeSingle()
            : { data: null };

        // Revalidación en el instante: entre la cancelación y este punto
        // el turno pudo ocuparse por otra vía.
        const disponibilidad = require('./disponibilidad');
        const verificacion = await disponibilidad.confirmarSlot({
            empresa,
            trabajador,
            fecha,
            hora: horaNorm,
            duracionMinutos: servicio?.duracion_minutos || 60
        });
        if (!verificacion.libre) return false;

        const notificaciones = require('./notificaciones');
        const botNum = await notificaciones.phoneNumberIdDe(empresa.id);
        const zona = empresa.zona_horaria || ZONA_POR_DEFECTO;
        const fechaTxt = formatearFechaCercana(fecha, zona);
        const minutos = ventanaMinutos(empresa);
        const nombreBit = candidato.nombre_cliente ? ` ${candidato.nombre_cliente}` : '';
        const texto =
            `Hola${nombreBit} 👋 ¡Se liberó la cita que querías! ` +
            `${servicio?.nombre || 'Tu servicio'} ${fechaTxt} a las ${horaNorm} ` +
            `con ${trabajador.nombre || 'el profesional'}. ` +
            `Responde SÍ en los próximos ${minutos} minutos y te la aparto.`;

        const intento = await enviarMensajeTexto(
            candidato.telefono_cliente,
            texto,
            botNum?.phone_number_id,
            { diagnostico: true }
        );

        // El harness de pruebas devuelve { capturado: true } sin `enviado`.
        if (!intento?.enviado && !intento?.capturado) {
            console.warn('⚠️  Lista de espera: la oferta no salió, se reintentará con el siguiente ciclo.');
            return false;
        }

        const expira = Date.now() + minutos * 60 * 1000;
        const { error: eUpdate } = await supabase
            .from('lista_espera')
            .update({ estado: 'avisada', expira_oferta_en: new Date(expira).toISOString() })
            .eq('id', candidato.id);
        if (eUpdate) console.warn('⚠️  Lista de espera (marcar avisada):', eUpdate.message);

        await guardarPendingOferta({
            telefonoBot: botNum?.telefono || null,
            telefonoCliente: candidato.telefono_cliente,
            pending: {
                tipo: 'oferta',
                listaEsperaId: candidato.id,
                fecha,
                hora: horaNorm,
                servicio: servicio?.nombre || null,
                servicioId: candidato.servicio_id || null,
                trabajadorId: trabajador.id,
                creadoEn: Date.now(),
                expira
            }
        });

        notificaciones.avisarDueno({
            empresa,
            tipo: 'lista_espera',
            texto:
                `📬 Lista de espera: se ofreció ${fechaTxt} ${horaNorm} ` +
                `(${trabajador.nombre || 'el profesional'}) a ` +
                `${candidato.nombre_cliente || candidato.telefono_cliente}. Expira en ${minutos} min.`
        }).catch(() => {});

        console.log(`📬 Lista de espera: oferta enviada a ${candidato.telefono_cliente} (${fecha} ${horaNorm})`);
        return true;
    }

    return false;
}

/** Guarda pending_oferta en conversaciones (patrón de setPendingReminder). */
async function guardarPendingOferta({ telefonoBot, telefonoCliente, pending }) {
    if (!telefonoBot || !telefonoCliente) return;

    const { data: fila } = await supabase
        .from('conversaciones')
        .select('id')
        .eq('telefono_bot', telefonoBot)
        .eq('telefono_cliente', telefonoCliente)
        .maybeSingle();

    if (fila?.id) {
        await supabase
            .from('conversaciones')
            .update({ pending_oferta: pending })
            .eq('id', fila.id);
    } else {
        await supabase.from('conversaciones').insert({
            telefono_bot: telefonoBot,
            telefono_cliente: telefonoCliente,
            pending_oferta: pending,
            mensajes: []
        });
    }
}

/** El cliente respondió SÍ a la oferta: revalida todo y agenda. */
async function confirmarOferta({ conv, config, telefonoCliente }) {
    const calendar = require('./calendar');
    const disponibilidad = require('./disponibilidad');
    const notificaciones = require('./notificaciones');

    const oferta = conv.pendingOferta;

    // Revalidación 1: la fila sigue en oferta y la ventana no venció.
    let fila = null;
    if (oferta?.listaEsperaId) {
        const { data } = await supabase
            .from('lista_espera')
            .select('*')
            .eq('id', oferta.listaEsperaId)
            .maybeSingle();
        fila = data;
    }

    if (!fila || fila.estado !== 'avisada'
        || (fila.expira_oferta_en && Date.now() > new Date(fila.expira_oferta_en).getTime())) {
        conv.pendingOferta = null;
        return {
            exitoso: false,
            mensaje: 'Uy, la oferta del turno ya venció. ¿Te busco otra hora?'
        };
    }

    const trabajador = await disponibilidad.obtenerTrabajadores(config.empresa.id, false)
        .then(lista => lista.find(t => t.id === fila.trabajador_id) || null);

    if (!trabajador) {
        conv.pendingOferta = null;
        await supabase.from('lista_espera').update({ estado: 'vencida' }).eq('id', fila.id);
        return { exitoso: false, mensaje: 'Ese profesional ya no está disponible. ¿Te agendo con alguien más?' };
    }

    const { data: servicio } = fila.servicio_id
        ? await supabase
            .from('servicios')
            .select('id, nombre, duracion_minutos')
            .eq('id', fila.servicio_id)
            .maybeSingle()
        : { data: null };

    // Revalidación 2 (última barrera): agendarCita vuelve a confirmar el slot.
    const resultado = await calendar.agendarCita({
        empresa: config.empresa,
        trabajador,
        servicio: servicio || { id: null, nombre: 'Servicio', duracion_minutos: 60 },
        fecha: fila.fecha,
        hora: horaDeDb(fila.hora_deseada),
        telefonoCliente: telefonoCliente || fila.telefono_cliente,
        nombreCliente: fila.nombre_cliente || conv.userName || null,
        bsuid: conv.bsuid || null
    });

    if (!resultado.exitoso) {
        // Se ocupó entre el aviso y el SÍ.
        conv.pendingOferta = null;
        await supabase.from('lista_espera').update({ estado: 'vencida' }).eq('id', fila.id);
        return {
            exitoso: false,
            mensaje: `Uy, el turno se ocupó hace un momento. ${resultado.mensaje || ''}`.trim()
        };
    }

    await supabase.from('lista_espera').update({ estado: 'agendada' }).eq('id', fila.id);
    conv.pendingOferta = null;

    const zona = config.empresa.zona_horaria || ZONA_POR_DEFECTO;
    const horaAceptada = horaDeDb(fila.hora_deseada) || fila.hora_deseada;
    notificaciones.avisarDueno({
        empresa: config.empresa,
        tipo: 'lista_espera',
        texto:
            `✅ Lista de espera: ${fila.nombre_cliente || telefonoCliente || 'un cliente'} tomó el hueco de ` +
            `${formatearFechaCercana(fila.fecha, zona)} ${horaAceptada} ` +
            `(${trabajador.nombre || 'el profesional'}).`
    }).catch(() => {});

    return {
        exitoso: true,
        fecha: fila.fecha,
        hora: horaAceptada,
        servicio: servicio?.nombre || null,
        profesional: trabajador.nombre || null,
        cita: resultado.cita
    };
}

/** El cliente respondió NO: se libera la oferta y se busca al siguiente. */
async function rechazarOferta({ conv, config }) {
    const oferta = conv.pendingOferta;
    conv.pendingOferta = null;

    if (oferta?.listaEsperaId) {
        await supabase
            .from('lista_espera')
            .update({ estado: 'cancelada' })
            .eq('id', oferta.listaEsperaId);
    }

    // El turno sigue libre: se le ofrece al siguiente de la lista.
    if (oferta?.fecha && oferta?.hora && oferta?.trabajadorId) {
        const disponibilidad = require('./disponibilidad');
        const trabajador = await disponibilidad.obtenerTrabajadores(config.empresa.id, false)
            .then(lista => lista.find(t => t.id === oferta.trabajadorId) || null);
        if (trabajador) {
            await revisarLiberacion({
                empresa: config.empresa,
                trabajador,
                fecha: oferta.fecha,
                hora: oferta.hora,
                telefonoExcluido: conv.telefonoCliente || null
            });
        }
    }
}

/** Al ocuparse un turno, las ofertas (avisada) por ese hueco exacto mueren. */
async function cerrarOfertasDeHueco({ empresaId, trabajadorId, fecha, hora, telefonoCliente = null }) {
    if (!empresaId || !fecha) return;
    const horaNorm = normalizarHora(hora) || horaDeDb(hora);
    if (!horaNorm) return;

    let consulta = supabase
        .from('lista_espera')
        .update({ estado: 'vencida' })
        .eq('empresa_id', empresaId)
        .eq('fecha', fecha)
        .eq('hora_deseada', horaNorm)
        .in('estado', ['avisada']);

    if (trabajadorId) {
        consulta = consulta.or(`trabajador_id.eq.${trabajadorId},trabajador_id.is.null`);
    }
    if (telefonoCliente) {
        // El teléfono que está agendando conserva su fila: el manejador del
        // SÍ la marca 'agendada' justo después.
        consulta = consulta.neq('telefono_cliente', telefonoCliente);
    }

    const { error } = await consulta;
    if (error) console.warn('⚠️  Lista de espera (cierre de ofertas):', error.message);
}

/** Cada minuto (desde notificaciones.revisar): ofertas cuya ventana ya pasó. */
async function barrerOfertasVencidas() {
    const { data, error } = await supabase
        .from('lista_espera')
        .update({ estado: 'vencida' })
        .lt('expira_oferta_en', new Date().toISOString())
        .eq('estado', 'avisada')
        .select('id');

    if (error) {
        console.warn('⚠️  Lista de espera (barrido):', error.message);
        return;
    }
    if (data?.length) {
        console.log(`⌛ Lista de espera: ${data.length} oferta(s) vencida(s) cerradas.`);
    }
}

module.exports = {
    registrar,
    revisarLiberacion,
    confirmarOferta,
    rechazarOferta,
    cerrarOfertasDeHueco,
    barrerOfertasVencidas,
    ventanaMinutos,
    TTL_PREGUNTA_MS
};
