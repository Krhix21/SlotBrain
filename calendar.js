const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const ZONA_HORARIA_DEFAULT = 'America/Bogota';
const OFFSET_DEFAULT = '-05:00';
const DURACION_DEFAULT_MS = 60 * 60 * 1000; // 60 min

async function getCalendarClientForTrabajador(telefono_bot) {
    const { data, error } = await supabase
        .from('trabajadores')
        .select('refresh_token, correo, empresa_id')
        .eq('telefono_bot', telefono_bot)
        .eq('activo', true)
        .single();

    if (error || !data) {
        console.error('❌ No se encontró trabajador conectado:', telefono_bot, error?.message);
        return null;
    }

    console.log(`🗓️  Usando el calendario de: ${data.correo} (telefono_bot: ${telefono_bot})`);

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ refresh_token: data.refresh_token });
    
    // Obtener configuración de la empresa si existe
    let empresaConfig = null;
    if (data.empresa_id) {
        const { data: empresa, error: empresaError } = await supabase
            .from('empresas')
            .select('*')
            .eq('id', data.empresa_id)
            .single();
        
        if (!empresaError && empresa) {
            empresaConfig = empresa;
        }
    }

    return {
        calendar: google.calendar({ version: 'v3', auth: oauth2Client }),
        correo: data.correo,
        empresaConfig
    };
}

async function consultarDisponibilidad(args, telefono_bot) {
    console.log('==> [consultar_disponibilidad] Args recibidos:', args, '| telefono_bot:', telefono_bot);

    const clientData = await getCalendarClientForTrabajador(telefono_bot);
    if (!clientData) {
        return { exitoso: false, mensaje: 'Este negocio todavía no ha conectado su calendario.' };
    }

    const { calendar, empresaConfig } = clientData;
    
    const zonaHoraria = empresaConfig?.zona_horaria || ZONA_HORARIA_DEFAULT;
    const offset = zonaHoraria === 'America/Bogota' ? OFFSET_DEFAULT : '+00:00';

    const inicio = new Date(`${args.fecha}T${args.hora}:00${offset}`);
    const fin = new Date(inicio.getTime() + DURACION_DEFAULT_MS);

    if (isNaN(inicio.getTime())) {
        console.error('❌ Fecha/hora inválida recibida del modelo:', args.fecha, args.hora);
        return { exitoso: false, mensaje: 'La fecha u hora no se entendió correctamente, ¿puedes repetirla en formato día y hora?' };
    }

    try {
        const { data } = await calendar.events.list({
            calendarId: 'primary',
            timeMin: inicio.toISOString(),
            timeMax: fin.toISOString(),
            singleEvents: true
        });

        const disponible = data.items.length === 0;
        console.log(`📅 Disponibilidad para ${args.fecha} ${args.hora}: ${disponible ? 'LIBRE' : 'OCUPADO'}`);

        return {
            exitoso: true,
            disponible,
            mensaje: disponible ? 'El horario está disponible.' : 'El horario ya está ocupado.'
        };
    } catch (err) {
        console.error('❌ Error consultando disponibilidad:', err.message);
        return { exitoso: false, mensaje: 'Hubo un problema técnico al consultar la agenda.' };
    }
}

async function verificarYAgendarCita(args, telefono_bot) {
    console.log('==> [agendar_cita] Args recibidos:', args, '| telefono_bot:', telefono_bot);

    const clientData = await getCalendarClientForTrabajador(telefono_bot);
    if (!clientData) {
        return { exitoso: false, mensaje: 'Este negocio todavía no ha conectado su calendario. Debe hacerlo desde el panel.' };
    }

    const { calendar, empresaConfig } = clientData;
    
    // Usar configuración de empresa o valores por defecto
    const zonaHoraria = empresaConfig?.zona_horaria || ZONA_HORARIA_DEFAULT;
    const offset = zonaHoraria === 'America/Bogota' ? OFFSET_DEFAULT : '+00:00';
    
    // Obtener duración del servicio si existe
    let duracionMs = DURACION_DEFAULT_MS;
    if (empresaConfig && args.servicio) {
        const { data: servicio } = await supabase
            .from('servicios')
            .select('duracion_minutos')
            .eq('empresa_id', empresaConfig.id)
            .eq('nombre', args.servicio)
            .single();
        
        if (servicio) {
            duracionMs = servicio.duracion_minutos * 60 * 1000;
        }
    }

    const inicio = new Date(`${args.fecha}T${args.hora}:00${offset}`);
    const fin = new Date(inicio.getTime() + duracionMs);

    if (isNaN(inicio.getTime())) {
        console.error('❌ Fecha/hora inválida recibida del modelo:', args.fecha, args.hora);
        return { exitoso: false, mensaje: 'La fecha u hora no se entendió correctamente, ¿puedes repetirla en formato día y hora?' };
    }

    try {
        const { data: existentes } = await calendar.events.list({
            calendarId: 'primary',
            timeMin: inicio.toISOString(),
            timeMax: fin.toISOString(),
            singleEvents: true
        });

        if (existentes.items.length > 0) {
            console.log('⚠️  Horario ocupado, no se agenda.');
            return { exitoso: false, mensaje: `El horario de las ${args.hora} ya está ocupado.` };
        }

        const nombreEmpresa = empresaConfig?.nombre || 'Xheros Barber';
        const { data: eventoCreado } = await calendar.events.insert({
            calendarId: 'primary',
            resource: {
                summary: `💈 ${args.servicio} - ${args.nombre_cliente}`,
                description: `Cita agendada por XheroBot vía WhatsApp para ${nombreEmpresa}.`,
                start: { dateTime: inicio.toISOString(), timeZone: zonaHoraria },
                end: { dateTime: fin.toISOString(), timeZone: zonaHoraria },
                reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }
            }
        });

        console.log(`✅ Evento creado. ID: ${eventoCreado.id} | Link: ${eventoCreado.htmlLink}`);

        // Guardar cita en base de datos
        if (empresaConfig) {
            try {
                await supabase.from('citas').insert({
                    empresa_id: empresaConfig.id,
                    trabajador_id: (await supabase.from('trabajadores').select('id').eq('telefono_bot', telefono_bot).single()).data?.id,
                    nombre_cliente: args.nombre_cliente,
                    servicio_id: null, // TODO: obtener ID del servicio
                    nombre_servicio: args.servicio,
                    fecha: args.fecha,
                    hora: args.hora,
                    evento_google_id: eventoCreado.id,
                    estado: 'agendada'
                });
            } catch (dbError) {
                console.error('⚠️  Error guardando cita en DB:', dbError);
            }
        }

        return {
            exitoso: true,
            mensaje: `Cita agendada con éxito para ${args.nombre_cliente}. Servicio: ${args.servicio} el día ${args.fecha} a las ${args.hora}.`
        };
    } catch (err) {
        console.error('❌ Error agendando cita:', err.message);
        if (err.code === 401 || err.code === 400) {
            return { exitoso: false, mensaje: 'La conexión con el calendario de este negocio expiró o fue revocada. Debe reconectarla desde el panel.' };
        }
        return { exitoso: false, mensaje: 'Hubo un problema técnico al acceder a la agenda.' };
    }
}

async function cancelarCita(args, telefono_bot) {
    const clientData = await getCalendarClientForTrabajador(telefono_bot);
    if (!clientData) {
        return { exitoso: false, mensaje: 'Este negocio todavía no ha conectado su calendario.' };
    }

    const { calendar, empresaConfig } = clientData;
    
    const zonaHoraria = empresaConfig?.zona_horaria || ZONA_HORARIA_DEFAULT;
    const offset = zonaHoraria === 'America/Bogota' ? OFFSET_DEFAULT : '+00:00';

    const inicio = new Date(`${args.fecha}T${args.hora}:00${offset}`);
    const fin = new Date(inicio.getTime() + DURACION_DEFAULT_MS);

    try {
        const { data } = await calendar.events.list({
            calendarId: 'primary',
            timeMin: inicio.toISOString(),
            timeMax: fin.toISOString(),
            singleEvents: true
        });

        const evento = data.items.find(e => e.summary?.includes(args.nombre_cliente));
        if (!evento) {
            return { exitoso: false, mensaje: `No se encontró cita de ${args.nombre_cliente} para el día ${args.fecha} a las ${args.hora}.` };
        }

        await calendar.events.delete({ calendarId: 'primary', eventId: evento.id });

        // Actualizar estado en DB
        if (empresaConfig) {
            try {
                await supabase
                    .from('citas')
                    .update({ estado: 'cancelada' })
                    .eq('evento_google_id', evento.id);
            } catch (dbError) {
                console.error('⚠️  Error actualizando cita en DB:', dbError);
            }
        }

        return { exitoso: true, mensaje: `Cita cancelada con éxito para ${args.nombre_cliente} el día ${args.fecha} a las ${args.hora}.` };
    } catch (err) {
        console.error('❌ Error cancelando cita:', err.message);
        return { exitoso: false, mensaje: 'Hubo un problema técnico al cancelar la cita.' };
    }
}

async function modificarCita(args, telefono_bot) {
    const clientData = await getCalendarClientForTrabajador(telefono_bot);
    if (!clientData) {
        return { exitoso: false, mensaje: 'Este negocio todavía no ha conectado su calendario.' };
    }

    const { calendar, empresaConfig } = clientData;
    
    const zonaHoraria = empresaConfig?.zona_horaria || ZONA_HORARIA_DEFAULT;
    const offset = zonaHoraria === 'America/Bogota' ? OFFSET_DEFAULT : '+00:00';

    const inicioActual = new Date(`${args.fecha_actual}T${args.hora_actual}:00${offset}`);
    const finActual = new Date(inicioActual.getTime() + DURACION_DEFAULT_MS);

    try {
        const { data } = await calendar.events.list({
            calendarId: 'primary',
            timeMin: inicioActual.toISOString(),
            timeMax: finActual.toISOString(),
            singleEvents: true
        });

        const evento = data.items.find(e => e.summary?.includes(args.nombre_cliente));
        if (!evento) {
            return { exitoso: false, mensaje: `No se encontró cita de ${args.nombre_cliente} para modificar.` };
        }

        const inicioNuevo = new Date(`${args.nueva_fecha}T${args.nueva_hora}:00${offset}`);
        const finNuevo = new Date(inicioNuevo.getTime() + DURACION_DEFAULT_MS);

        const { data: choque } = await calendar.events.list({
            calendarId: 'primary',
            timeMin: inicioNuevo.toISOString(),
            timeMax: finNuevo.toISOString(),
            singleEvents: true
        });

        if (choque.items.length > 0) {
            return { exitoso: false, mensaje: `El nuevo horario (${args.nueva_fecha} a las ${args.nueva_hora}) ya está ocupado.` };
        }

        await calendar.events.patch({
            calendarId: 'primary',
            eventId: evento.id,
            resource: {
                start: { dateTime: inicioNuevo.toISOString(), timeZone: zonaHoraria },
                end: { dateTime: finNuevo.toISOString(), timeZone: zonaHoraria }
            }
        });

        // Actualizar en DB
        if (empresaConfig) {
            try {
                await supabase
                    .from('citas')
                    .update({ 
                        fecha: args.nueva_fecha,
                        hora: args.nueva_hora
                    })
                    .eq('evento_google_id', evento.id);
            } catch (dbError) {
                console.error('⚠️  Error actualizando cita en DB:', dbError);
            }
        }

        return { exitoso: true, mensaje: `Cita modificada con éxito. Nuevo horario: ${args.nueva_fecha} a las ${args.nueva_hora}.` };
    } catch (err) {
        console.error('❌ Error modificando cita:', err.message);
        return { exitoso: false, mensaje: 'Hubo un problema técnico al modificar la cita.' };
    }
}

// Útil para el panel/admin: saber si un trabajador ya conectó su calendario
async function trabajadorEstaConectado(telefono_bot) {
    const { data } = await supabase
        .from('trabajadores')
        .select('correo, empresa_id')
        .eq('telefono_bot', telefono_bot)
        .eq('activo', true)
        .single();
    return data || null;
}

module.exports = { verificarYAgendarCita, cancelarCita, modificarCita, consultarDisponibilidad, trabajadorEstaConectado };