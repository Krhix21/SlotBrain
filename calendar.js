// ============================================================
// Integración con Google Calendar.
//
// Cada cita pertenece a un TRABAJADOR, y cada trabajador tiene su propio
// Google Calendar enlazado por OAuth. Por eso todas las funciones
// reciben `trabajador` en lugar de un número de bot.
//
// Las fechas se manejan con la zona horaria IANA de la empresa
// (ver tiempo.js), no con offsets fijos.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { crearCalendar } = require('./googleAuth');
const { confirmarSlot } = require('./disponibilidad');
const {
    ZONA_POR_DEFECTO,
    zonedToUtc,
    esFechaValida,
    normalizarHora
} = require('./tiempo');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const ESTADOS_VIGENTES = ['agendada', 'confirmada'];

function zonaDe(empresa) {
    return empresa?.zona_horaria || ZONA_POR_DEFECTO;
}

function nombreDeTrabajador(trabajador, empresa) {
    const quien = trabajador?.nombre;
    if (quien) return quien;
    return 'el profesional';
}

function validacion(fecha, hora) {
    if (!esFechaValida(fecha)) return 'La fecha no se entendió bien.';
    if (!normalizarHora(hora)) return 'La hora no se entendió bien.';
    return null;
}

/** ¿Tiene este trabajador un calendario usable? */
async function trabajadorEstaConectado(trabajadorId) {
    const { data, error } = await supabase
        .from('trabajadores')
        .select('id, nombre, correo, empresa_id')
        .eq('id', trabajadorId)
        .eq('activo', true)
        .maybeSingle();

    if (error) {
        console.error('Error consultando trabajador:', error.message);
        return null;
    }
    if (!data || !data.correo) return null;
    return data;
}

/**
 * Crea la cita en el Google Calendar del trabajador y la registra en `citas`.
 * SIEMPRE re-verifica disponibilidad en el instante: entre que el bot
 * ofreció el slot y el cliente confirmó, alguien más pudo tomarlo.
 *
 * @returns {Promise<{exitoso:boolean, mensaje:string, cita?:object}>}
 */
async function agendarCita({ empresa, trabajador, servicio, fecha, hora, telefonoCliente, nombreCliente, bsuid = null }) {
    const problema = validacion(fecha, hora);
    if (problema) return { exitoso: false, mensaje: problema };

    hora = normalizarHora(hora);

    // Modo sin calendario (GOOGLE_CALENDAR_ON=false): no se exige refresh_token
    // y la cita se registra solo en la base. Con calendario activado, el
    // bloque de abajo se comporta igual que siempre.
    const calendarOn = String(process.env.GOOGLE_CALENDAR_ON || '').trim().toLowerCase() === 'true';

    if (calendarOn && !trabajador?.refresh_token) {
        return {
            exitoso: false,
            mensaje: `${nombreDeTrabajador(trabajador, empresa)} todavía no tiene un Google Calendar conectado.`
        };
    }

    const zona = zonaDe(empresa);
    const duracionMinutos = servicio?.duracion_minutos || 60;

    const verificacion = await confirmarSlot({ empresa, trabajador, fecha, hora, duracionMinutos });

    if (!verificacion.libre) {
        console.log(`⚠️  Slot rechazado (${fecha} ${hora}, ${nombreDeTrabajador(trabajador, empresa)}): ${verificacion.motivo}`);
        return {
            exitoso: false,
            mensaje: `Ese horario ${verificacion.motivo}.`
        };
    }

    const inicio = zonedToUtc(fecha, hora, zona);
    const fin = new Date(inicio.getTime() + duracionMinutos * 60 * 1000);

    const resumen = `${servicio?.nombre || 'Cita'} - ${nombreCliente || telefonoCliente}`;
    const descripcion = [
        `Cita reservada por el bot de WhatsApp de ${empresa?.nombre || 'nuestro negocio'}.`,
        `Cliente: ${nombreCliente || 'sin nombre'} (${telefonoCliente}).`
    ].join('\n');

    let eventoId = null;

    if (calendarOn) {
        try {
            const calendar = crearCalendar(trabajador.refresh_token);

            const { data: evento } = await calendar.events.insert({
                calendarId: 'primary',
                resource: {
                    summary: resumen,
                    description: descripcion,
                    location: empresa?.direccion || undefined,
                    start: { dateTime: inicio.toISOString(), timeZone: zona },
                    end: { dateTime: fin.toISOString(), timeZone: zona },
                    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] }
                }
            });

            eventoId = evento?.id;
            console.log(`✅ Cita creada en el calendario de ${nombreDeTrabajador(trabajador, empresa)}: ${eventoId}`);
        } catch (error) {
            console.error('❌ Error creando el evento en Google Calendar:', error.message);

            if (error.code === 401 || error.code === 403 || error.code === 400) {
                return {
                    exitoso: false,
                    mensaje: `La conexión con el calendario de ${nombreDeTrabajador(trabajador, empresa)} expiró o fue revocada. Hay que volver a enlazarla desde el panel.`
                };
            }
            return { exitoso: false, mensaje: 'Hubo un problema técnico al escribir en la agenda.' };
        }
    }

    // El evento ya existe: si falla el INSERT en Supabase lo registramos igual
    // (perder la trazabilidad en la base sería peor que un registro huérfano).
    let citaId = null;

    const { data: cita, error: errorCita } = await supabase
        .from('citas')
        .insert({
            empresa_id: empresa.id,
            trabajador_id: trabajador.id,
            nombre_cliente: nombreCliente || telefonoCliente || bsuid || 'cliente',
            telefono_cliente: telefonoCliente || null,
            bsuid: bsuid || null,
            servicio_id: servicio?.id || null,
            nombre_servicio: servicio?.nombre || 'Servicio',
            fecha,
            hora,
            duracion_minutos: duracionMinutos,
            inicio_utc: inicio.toISOString(),
            evento_google_id: eventoId,
            estado: 'confirmada',
            canal: 'whatsapp'
        })
        .select()
        .single();

    if (errorCita) {
        console.error('⚠️  Evento creado en Google pero la cita no se guardó en Supabase:', errorCita.message);
    } else {
        citaId = cita?.id;
    }

    // Lista de espera: el hueco que se acaba de ocupar deja de estar en oferta.
    try {
        const listaEspera = require('./listaEspera');
        await listaEspera.cerrarOfertasDeHueco({
            empresaId: empresa.id,
            trabajadorId: trabajador.id,
            fecha,
            hora,
            telefonoCliente: telefonoCliente || null
        });
    } catch (error) {
        console.warn('⚠️  Lista de espera (cierre):', error.message);
    }

    return {
        exitoso: true,
        mensaje: `Cita confirmada para el ${fecha} a las ${hora}.`,
        cita: cita || { id: citaId, fecha, hora }
    };
}

/**
 * Busca la cita vigente de un cliente en una fecha y hora concretas.
 * Se consulta la tabla `citas`, no el summary del evento: buscar por
 * nombre en el calendario rompía con dos clientes homónimos.
 */
async function buscarCita({ empresa, telefonoCliente, fecha, hora, bsuid = null }) {
    let consulta = supabase
        .from('citas')
        .select('*')
        .eq('empresa_id', empresa.id)
        .in('estado', ESTADOS_VIGENTES);

    if (telefonoCliente) consulta = consulta.eq('telefono_cliente', telefonoCliente);
    else if (bsuid) consulta = consulta.eq('bsuid', bsuid);
    else return null;

    if (fecha) consulta = consulta.eq('fecha', fecha);
    if (hora) consulta = consulta.eq('hora', hora);

    const { data, error } = await consulta
        .order('creado_en', { ascending: false })
        .limit(1);

    if (error) {
        console.error('Error buscando la cita:', error.message);
        return null;
    }
    return (data && data[0]) || null;
}

/** Cita vigente más próxima del cliente, para "cancélala" sin dar la fecha. */
async function citaVigente({ empresa, telefonoCliente, bsuid = null }) {
    let consulta = supabase
        .from('citas')
        .select('*')
        .eq('empresa_id', empresa.id)
        .in('estado', ESTADOS_VIGENTES);

    if (telefonoCliente) consulta = consulta.eq('telefono_cliente', telefonoCliente);
    else if (bsuid) consulta = consulta.eq('bsuid', bsuid);
    else return null;

    const { data, error } = await consulta.order('fecha', { ascending: true }).limit(1);

    if (error) {
        console.error('Error buscando cita vigente:', error.message);
        return null;
    }
    return (data && data[0]) || null;
}

async function borrarEventoGoogle(trabajador, eventoGoogleId) {
    // Sin evento asociado no hay nada que borrar: la cancelación en la base
    // es válida igual (citas guardadas sin calendario o registro huérfano).
    if (!eventoGoogleId) return true;
    if (!trabajador?.refresh_token) return false;

    try {
        const calendar = crearCalendar(trabajador.refresh_token);
        await calendar.events.delete({ calendarId: 'primary', eventId: eventoGoogleId });
        return true;
    } catch (error) {
        // 404/410: el evento ya no está, que es justo lo que queríamos.
        if (error.code === 404 || error.code === 410) return true;
        console.error('❌ Error borrando el evento de Google:', error.message);
        return false;
    }
}

/**
 * Cancela una cita: borra el evento y marca el registro.
 * @returns {Promise<{exitoso:boolean, mensaje:string, cita?:object}>}
 */
async function cancelarCita({ empresa, trabajador, cita, canceladoPor = 'cliente', motivo = null }) {
    if (!cita) {
        return { exitoso: false, mensaje: 'No encontré ninguna cita tuya para cancelar.' };
    }

    const borrado = await borrarEventoGoogle(trabajador, cita.evento_google_id);

    if (!borrado) {
        return {
            exitoso: false,
            mensaje: 'No pude borrar la cita del calendario. Inténtalo de nuevo en un momento.'
        };
    }

    const { error } = await supabase
        .from('citas')
        .update({
            estado: 'cancelada',
            cancelado_por: canceladoPor,
            motivo_cancelacion: motivo
        })
        .eq('id', cita.id);

    if (error) {
        console.error('⚠️  Evento borrado de Google pero la cita no se actualizó:', error.message);
    }

    console.log(`🗑️  Cita cancelada: ${cita.fecha} ${cita.hora} (${nombreDeTrabajador(trabajador, empresa)})`);

    // Lista de espera: este hueco quedó libre, se le ofrece al primero.
    try {
        const listaEspera = require('./listaEspera');
        await listaEspera.revisarLiberacion({
            empresa,
            trabajador,
            fecha: cita.fecha,
            hora: cita.hora,
            telefonoExcluido: cita.telefono_cliente || null
        });
    } catch (error) {
        console.warn('⚠️  Lista de espera (liberación):', error.message);
    }

    return {
        exitoso: true,
        mensaje: `Cita del ${cita.fecha} a las ${cita.hora} cancelada.`,
        cita
    };
}

/**
 * Mueve una cita. Verifica que el nuevo horario esté libre antes de tocar nada.
 * @returns {Promise<{exitoso:boolean, mensaje:string, cita?:object}>}
 */
async function modificarCita({ empresa, trabajador, cita, nuevaFecha, nuevaHora }) {
    if (!cita) {
        return { exitoso: false, mensaje: 'No encontré ninguna cita tuya para mover.' };
    }

    nuevaHora = normalizarHora(nuevaHora);

    const problema = validacion(nuevaFecha, nuevaHora);
    if (problema) return { exitoso: false, mensaje: problema };

    // Si la hora no cambió, no hay nada que hacer.
    if (nuevaFecha === cita.fecha && nuevaHora === cita.hora) {
        return { exitoso: false, mensaje: 'Esa es la misma hora que ya tienes.' };
    }

    const zona = zonaDe(empresa);
    const duracionMinutos = cita.duracion_minutos || 60;

    const inicioNuevo = zonedToUtc(nuevaFecha, nuevaHora, zona);
    const finNuevo = new Date(inicioNuevo.getTime() + duracionMinutos * 60 * 1000);
    const inicioViejo = zonedToUtc(cita.fecha, cita.hora, zona);
    const finViejo = new Date(inicioViejo.getTime() + duracionMinutos * 60 * 1000);

    // Mismas comprobaciones que al agendar (¿ya pasó? ¿dentro del horario?
    // ¿libre en Google? ¿bloqueado?), pero ignorando el evento de esta misma
    // cita, que ocupa el rango viejo. Antes aquí solo se miraba el
    // freebusy: se podía mover una cita a un domingo o a una hora ya pasada
    // porque el calendario estaba libre.
    const comprobacion = await confirmarSlot({
        empresa,
        trabajador,
        fecha: nuevaFecha,
        hora: nuevaHora,
        duracionMinutos,
        ignorarIntervalo: { inicioMs: inicioViejo.getTime(), finMs: finViejo.getTime() }
    });

    if (!comprobacion.libre) {
        return {
            exitoso: false,
            mensaje: `No pude mover la cita a esa hora porque ${comprobacion.motivo}.`
        };
    }

    if (cita.evento_google_id && trabajador?.refresh_token) {
        try {
            const calendar = crearCalendar(trabajador.refresh_token);
            await calendar.events.patch({
                calendarId: 'primary',
                eventId: cita.evento_google_id,
                resource: {
                    start: { dateTime: inicioNuevo.toISOString(), timeZone: zona },
                    end: { dateTime: finNuevo.toISOString(), timeZone: zona }
                }
            });
        } catch (error) {
            console.error('❌ Error moviendo el evento en Google Calendar:', error.message);
            return { exitoso: false, mensaje: 'No pude mover la cita en el calendario. Inténtalo de nuevo.' };
        }
    }

    const { data: actualizada, error } = await supabase
        .from('citas')
        .update({
            fecha: nuevaFecha,
            hora: nuevaHora,
            inicio_utc: inicioNuevo.toISOString()
        })
        .eq('id', cita.id)
        .select()
        .single();

    if (error) {
        console.error('⚠️  Evento movido en Google pero la cita no se actualizó:', error.message);
    }

    console.log(`↪️  Cita movida: ${cita.fecha} ${cita.hora} → ${nuevaFecha} ${nuevaHora}`);

    // Lista de espera: el hueco viejo quedó libre, se le ofrece al primero.
    try {
        const listaEspera = require('./listaEspera');
        await listaEspera.revisarLiberacion({
            empresa,
            trabajador,
            fecha: cita.fecha,
            hora: cita.hora,
            telefonoExcluido: cita.telefono_cliente || null
        });
    } catch (error) {
        console.warn('⚠️  Lista de espera (liberación):', error.message);
    }

    return {
        exitoso: true,
        mensaje: `Cita movida al ${nuevaFecha} a las ${nuevaHora}.`,
        cita: actualizada || cita
    };
}

module.exports = {
    agendarCita,
    cancelarCita,
    modificarCita,
    buscarCita,
    citaVigente,
    trabajadorEstaConectado,
    ESTADOS_VIGENTES
};
