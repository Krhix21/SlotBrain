require('dotenv').config();
const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');

const { enviarMensajeTexto, marcarComoLeido, esBsuid } = require('./whatsappCloud');
const voz = require('./voz');
const numeros = require('./numeros');
const conversaciones = require('./conversaciones');
const disponibilidad = require('./disponibilidad');
const calendar = require('./calendar');
const roles = require('./roles');
const agenteDueno = require('./agenteDueno');
const notificaciones = require('./notificaciones');
const {
    formatearFechaLarga,
    formatearFechaCorta,
    hoyEnZona,
    sumarDias,
    esFechaValida,
    normalizarHora
} = require('./tiempo');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Una reserva pendiente ("¿te la agendo?") caduca a los 30 minutos.
const TTL_PENDING_MS = 30 * 60 * 1000;

const MODELO = 'openai/gpt-oss-120b';

const CACHE_TTL_MS = 5 * 60 * 1000;
let configCache = new Map();

// ============================================================
// Configuración por número de bot (empresa + servicios)
// ============================================================

async function cargarConfiguracion(empresaId) {
    const cached = configCache.get(empresaId);
    if (cached && cached.expiresAt > Date.now()) return cached.valor;

    const [empresaRes, serviciosRes] = await Promise.all([
        supabase.from('empresas').select('*').eq('id', empresaId).maybeSingle(),
        supabase.from('servicios').select('*').eq('empresa_id', empresaId).eq('activo', true).order('nombre')
    ]);

    if (serviciosRes.error) {
        console.error('❌ Error cargando servicios:', serviciosRes.error.message);
    }
    if (empresaRes.error) {
        console.error('❌ Error cargando empresa:', empresaRes.error.message);
    }

    const valor = { empresa: empresaRes.data || null, servicios: serviciosRes.data || [] };
    configCache.set(empresaId, { valor, expiresAt: Date.now() + CACHE_TTL_MS });

    return valor;
}

function limpiarCacheConfiguracion() {
    configCache = new Map();
}

/** Formatea un precio en la moneda de la empresa (default COP). */
function precioFormateado(precio, moneda) {
    const codigo = String(moneda || 'COP').toUpperCase().slice(0, 3);
    try {
        return new Intl.NumberFormat('es', {
            style: 'currency',
            currency: codigo,
            maximumFractionDigits: 0
        }).format(Number(precio || 0));
    } catch {
        return `${codigo} ${Number(precio || 0).toLocaleString('es')}`;
    }
}

function textoServicios(servicios, empresa) {
    if (!servicios.length) return '- (por definir)';
    return servicios
        .map(s => `- ${s.nombre}: ${precioFormateado(s.precio, empresa?.moneda)}, ${s.duracion_minutos || 60} min${s.descripcion ? ` — ${s.descripcion}` : ''}`)
        .join('\n');
}

/**
 * Vocabulario por nicho. Barbería por defecto; un consultorio dental
 * cambia profesional_singular a "dentista", etc. (empresas.terminologia).
 */
const TERMINOLOGIA_DEFAULT = {
    servicio_singular: 'servicio',
    servicio_plural: 'servicios',
    profesional_singular: 'barbero',
    profesional_plural: 'barberos'
};

function terminologiaDe(empresa) {
    const t = (empresa && typeof empresa.terminologia === 'object' && empresa.terminologia) || {};
    return { ...TERMINOLOGIA_DEFAULT, ...t };
}

// ============================================================
// Utilidades de texto
// ============================================================

// Ojo con el acento: en JS, \b tras "í" NO funciona (í no es carácter de
// palabra), así que "sí" con tilde nunca matcheaba. Se usa (?![a-z0-9]).
function esConfirmacionAfirmativa(texto) {
    return /^(s[ií]|si|claro|adelante|dale|ok|okey|correcto|exacto|confirmo|confirmar|sip|de una|listo|vamos)(?![a-z0-9])[\s.!?]*$/i
        .test(String(texto || '').trim());
}

function esNegacion(texto) {
    return /^(no|nop|nel|mejor no|ahora no|dejemos|otro d[ií]a|otra fecha|mejor otro)(?![a-z0-9])[\s.!?]*$/i
        .test(String(texto || '').trim());
}

/** El mensaje es apenas un saludo, sin ninguna petición ("hola", "buenas?"). */
function mensajeEsSoloSaludo(texto) {
    return /^(h[oó]l+a+|holi|hey|buenas?|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|qu[eé]\s+tal)[!¡.?\s]*$/i
        .test(String(texto || '').trim());
}

/** El mensaje solo dice el nombre (responde a "¿cómo te llamas?"). */
function mensajeEsSoloNombre(texto) {
    const t = String(texto || '').trim();
    if (!t || t.length > 40) return false;
    if (/^(soy|me llamo|mi nombre es)\s+[\wáéíóúñ\s]+[.!?]*$/i.test(t)) return true;
    // Palabra suelta: solo pasa aquí si extraerNombre ya validó que es un nombre.
    return /^[\wáéíóúñ\s]+[.!?]*$/i.test(t);
}

/** Aceptación de la oferta sin elegir hora ("sí, la primera", "cualquiera me sirve"). */
function aceptaLaPrimeraOferta(texto) {
    return /^(¡|s[ií]|si)(?![a-z0-9])[,\s¡!]*(la\s+|el\s+)?(primera|primero|cualquiera|que\s+sea|la\s+que\s+sea|cualquier)/i
        .test(String(texto || '').trim());
}

function limpiarJsonEscapado(texto) {
    // Los modelos json.tool_call a veces mandan claves con guion bajo y valor envuelto en comillas.
    return String(texto || '').replace(/^["']|["']$/g, '').trim();
}

/** Quita el andamiaje que algunos modelos agregan alrededor del contenido. */
function limpiarTexto(texto) {
    if (!texto || typeof texto !== 'string') return '';
    return texto
        .replace(/<function=[^>]+>\s*([\s\S]*?)\s*<\/function>/gi, '$1')
        .trim();
}

function parseJsonObjeto(texto) {
    const limpio = limpiarTexto(texto);
    const candidatos = [limpio];
    const match = limpio.match(/\{[\s\S]*\}/);
    if (match) candidatos.push(match[0]);

    for (const candidato of candidatos) {
        try {
            const parsed = JSON.parse(candidato);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch { /* siguiente candidato */ }
    }
    return null;
}

function parseArgsBrutos(brutos) {
    if (brutos && typeof brutos === 'object') return brutos;
    return parseJsonObjeto(brutos) || {};
}

// ============================================================
// Tools para Groq
// ============================================================

const calendarOnParaBot = String(process.env.GOOGLE_CALENDAR_ON || '').trim().toLowerCase() === 'true';

const verSlotsTool = {
    type: 'function',
    function: {
        name: 'ver_slots',
        description:
            'Muestra los horarios realmente libres para un servicio en una fecha. ' +
            'Úsala SIEMPRE antes de agendar: devuelve la lista de horas disponibles ' +
            (calendarOnParaBot
                ? 'según el Google Calendar de cada profesional. '
                : 'según el horario de atención del negocio. ') +
            'Después de llamarla, NO agendes nada por tu cuenta: ofrece los horarios y espera la confirmación del cliente.',
        parameters: {
            type: 'object',
            properties: {
                servicio: { type: 'string', description: 'Nombre exacto del servicio, tal como aparece en la lista.' },
                fecha: { type: 'string', description: 'Fecha en formato AAAA-MM-DD.' }
            },
            required: ['servicio', 'fecha']
        }
    }
};

const agendarCitaTool = {
    type: 'function',
    function: {
        name: 'agendar_cita',
        description:
            'Crea la cita. SOLO se llama después de que el cliente haya confirmado un horario ' +
            'que le ofreciste con ver_slots. Nunca la llames sin confirmación explícita del cliente.',
        parameters: {
            type: 'object',
            properties: {
                servicio: { type: 'string', description: 'Nombre exacto del servicio.' },
                fecha: { type: 'string', description: 'Fecha confirmada en formato AAAA-MM-DD.' },
                hora: { type: 'string', description: 'Hora confirmada en formato HH:MM (24 horas).' },
                nombre_cliente: { type: 'string', description: 'Nombre del cliente.' }
            },
            required: ['servicio', 'fecha', 'hora', 'nombre_cliente']
        }
    }
};

const cancelarCitaTool = {
    type: 'function',
    function: {
        name: 'cancelar_cita',
        description: 'Cancela una cita existente. Úsala cuando el cliente dice cancelar, anular o que no va.',
        parameters: {
            type: 'object',
            properties: {
                fecha: { type: 'string', description: 'Fecha de la cita a cancelar (AAAA-MM-DD).' },
                hora: { type: 'string', description: 'Hora de la cita a cancelar (HH:MM).' }
            },
            required: ['fecha', 'hora']
        }
    }
};

const modificarCitaTool = {
    type: 'function',
    function: {
        name: 'modificar_cita',
        description: 'Mueve una cita que el cliente ya tiene a otra fecha u hora.',
        parameters: {
            type: 'object',
            properties: {
                fecha_actual: { type: 'string', description: 'Fecha actual (AAAA-MM-DD).' },
                hora_actual: { type: 'string', description: 'Hora actual (HH:MM).' },
                nueva_fecha: { type: 'string', description: 'Nueva fecha (AAAA-MM-DD).' },
                nueva_hora: { type: 'string', description: 'Nueva hora (HH:MM).' }
            },
            required: ['fecha_actual', 'hora_actual', 'nueva_fecha', 'nueva_hora']
        }
    }
};

const TOOLS = [verSlotsTool, agendarCitaTool, cancelarCitaTool, modificarCitaTool];

// ============================================================
// Ejecución de herramientas
// ============================================================

function servicioPorNombre(servicios, nombre) {
    if (!nombre) return null;
    const objetivo = limpiarJsonEscapado(nombre).toLowerCase();
    return servicios.find(s => s.nombre.toLowerCase() === objetivo)
        || servicios.find(s => objetivo.includes(s.nombre.toLowerCase()) || s.nombre.toLowerCase().includes(objetivo))
        || null;
}

async function ejecutarVerSlots({ config, args }) {
    const servicio = servicioPorNombre(config.servicios, args.servicio);

    if (!servicio) {
        return {
            exitoso: false,
            mensaje: `No encontré el servicio "${limpiarJsonEscapado(args.servicio)}". Los servicios son: ${config.servicios.map(s => s.nombre).join(', ')}.`
        };
    }

    const fecha = normalizarFecha(args.fecha);

    if (!esFechaValida(fecha)) {
        return { exitoso: false, mensaje: 'No entendí la fecha. Pídela de nuevo.' };
    }

    const { slots, trabajadores, motivo } = await disponibilidad.obtenerSlots({
        empresa: config.empresa,
        servicios: config.servicios,
        fecha,
        duracionMinutos: servicio.duracion_minutos || 60,
        servicioId: servicio.id
    });

    if (slots.length === 0) {
        // "Ese día" confunde cuando el cliente nunca mencionó una fecha:
        // se dice para qué día es (hoy, mañana o la fecha corta).
        const zona = config.empresa.zona_horaria || 'America/Bogota';
        const hoy = hoyEnZona(zona);
        const manana = sumarDias(hoy, 1);
        const relativo = fecha === hoy
            ? 'Para hoy'
            : fecha === manana
                ? 'Para mañana'
                : `Para el ${formatearFechaCorta(fecha)}`;
        return { exitoso: true, slots: [], sinHoras: true, mensaje: motivo || `${relativo} ya no nos quedan horas. ¿Te ofrezco otro día?` };
    }

    return {
        exitoso: true,
        slots,
        trabajadores,
        fecha,
        mensaje: `Horas libres el ${formatearFechaLarga(fecha)} para ${servicio.nombre}: ${slots.map(s => s.hora).join(', ')}`
    };
}

async function ejecutarAgendar({ config, bot, args, conv, telefonoCliente, userName }) {
    const pendiente = leerPending(conv);

    if (!pendiente) {
        // Esta cadena la ve el CLIENTE tal cual (el resultado de la tool es la
        // respuesta final). Antes decía "Primero debes ofrecerle los horarios
        // con ver_slots": jerga interna con nombre de herramienta.
        // Si el modelo manda agendar cuando ya hay cita vigente (pasa en
        // despedidas tras confirmar), se responde con contexto y no con error.
        const citaVigente = await calendar.citaVigente({
            empresa: config.empresa,
            telefonoCliente,
            bsuid: conv?.bsuid || null
        });
        if (citaVigente) {
            return {
                exitoso: false,
                mensaje: `Tranquilo: tu cita del ${formatearFechaCorta(citaVigente.fecha)} a las ${citaVigente.hora} ya quedó agendada.`
            };
        }
        return { exitoso: false, mensaje: 'Déjame revisar la agenda: ¿para qué día y hora la necesitas?' };
    }

    const servicio = servicioPorNombre(config.servicios, pendiente.servicio);
    if (!servicio) {
        conv.pendingBooking = null;
        return { exitoso: false, mensaje: 'Perdí el detalle del servicio. ¿Cuál servicio quieres?' };
    }

    const trabajador = await buscarTrabajadorDeSlot(pendiente);

    if (!trabajador) {
        conv.pendingBooking = null;
        return { exitoso: false, mensaje: 'Ese profesional ya no está disponible. ¿Te ofrezco otros horarios?' };
    }

    const resultado = await calendar.agendarCita({
        empresa: config.empresa,
        trabajador,
        servicio,
        fecha: pendiente.fecha,
        hora: pendiente.hora,
        telefonoCliente,
        nombreCliente: userName,
        bsuid: conv.bsuid || null
    });

    if (!resultado.exitoso) {
        return resultado;
    }

    conv.pendingBooking = null;
    conv.ultimaCita = {
        servicio: servicio.nombre,
        fecha: pendiente.fecha,
        hora: pendiente.hora,
        trabajador: trabajador.nombre
    };

    notificaciones.avisarDueno({
        empresa: config.empresa,
        tipo: 'nueva_cita',
        texto:
            `📅 Nueva cita: ${userName || telefonoCliente} — ${servicio.nombre} ` +
            `${pendiente.fecha} ${pendiente.hora} con ${trabajador.nombre}`
    }).catch(err => console.warn('⚠️  Aviso dueño (nueva):', err.message));

    return {
        ...resultado,
        servicio,
        trabajador,
        fecha: pendiente.fecha,
        hora: pendiente.hora
    };
}

async function ejecutarCancelar({ config, telefonoCliente, conv }) {
    const cita = await calendar.citaVigente({
        empresa: config.empresa,
        telefonoCliente,
        bsuid: conv?.bsuid || null
    });

    if (!cita) {
        return { exitoso: false, mensaje: 'No encontré ninguna cita tuya para cancelar.' };
    }

    const trabajador = await disponibilidad.obtenerTrabajadores(config.empresa.id, false)
        .then(lista => lista.find(t => t.id === cita.trabajador_id) || null);

    const resultado = await calendar.cancelarCita({
        empresa: config.empresa,
        trabajador,
        cita,
        canceladoPor: 'cliente'
    });

    if (resultado.exitoso) {
        notificaciones.avisarDueno({
            empresa: config.empresa,
            tipo: 'cancelada',
            texto:
                `🗑️ Cita cancelada: ${cita.nombre_cliente || telefonoCliente} — ` +
                `${cita.nombre_servicio} ${cita.fecha} ${cita.hora}`
        }).catch(err => console.warn('⚠️  Aviso dueño (cancel):', err.message));
    }

    return resultado;
}

async function ejecutarModificar({ config, args, telefonoCliente, conv }) {
    const cita = await calendar.citaVigente({
        empresa: config.empresa,
        telefonoCliente,
        bsuid: conv?.bsuid || null
    });

    if (!cita) {
        return { exitoso: false, mensaje: 'No encontré ninguna cita tuya para mover.' };
    }

    const trabajador = await disponibilidad.obtenerTrabajadores(config.empresa.id, false)
        .then(lista => lista.find(t => t.id === cita.trabajador_id) || null);

    const resultado = await calendar.modificarCita({
        empresa: config.empresa,
        trabajador,
        cita,
        nuevaFecha: normalizarFecha(args.nueva_fecha),
        nuevaHora: normalizarHora(args.nueva_hora)
    });

    if (resultado.exitoso) {
        notificaciones.avisarDueno({
            empresa: config.empresa,
            tipo: 'modificada',
            texto:
                `↪️ Cita movida: ${cita.nombre_cliente || telefonoCliente} → ` +
                `${resultado.cita.fecha} ${resultado.cita.hora}`
        }).catch(err => console.warn('⚠️  Aviso dueño (move):', err.message));
    }

    return resultado;
}

/** El modelo puede devolver "28/09/2026" o "28 de septiembre": se normaliza a ISO. */
function normalizarFecha(fecha) {
    if (!fecha) return fecha;

    const texto = String(fecha).trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;

    // "28/09/2026" o "28-09-2026"
    const dmy = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmy) {
        return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
    }

    // "28 de septiembre de 2026"
    const meses = {
        enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
        julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
        noviembre: '11', diciembre: '12'
    };

    const largo = texto.toLowerCase()
        .match(/^(\d{1,2})\s*(?:de\s*)?([a-zé]+)(?:\s*de)?\s*(\d{4})$/);

    if (largo && meses[largo[2]]) {
        return `${largo[3]}-${meses[largo[2]]}-${String(largo[1]).padStart(2, '0')}`;
    }

    return texto;
}

async function buscarTrabajadorDeSlot(pendiente) {
    if (!pendiente.trabajadorId) return null;

    const lista = await disponibilidad.obtenerTrabajadores(pendiente.empresaId, false);
    return lista.find(t => t.id === pendiente.trabajadorId) || null;
}

// ============================================================
// pending_booking
// ============================================================

function leerPending(conv) {
    const pendiente = conv.pendingBooking;
    if (!pendiente) return null;

    if (Date.now() - (pendiente.creadoEn || 0) > TTL_PENDING_MS) {
        console.log('⏳ Reserva pendiente expirada (TTL 30 min), se descarta.');
        conv.pendingBooking = null;
        return null;
    }
    return pendiente;
}

function guardarPending(conv, { empresaId, servicio, fecha, hora, trabajadorId, slots }) {
    conv.pendingBooking = {
        empresaId,
        servicio: servicio.nombre,
        fecha,
        hora,
        trabajadorId,
        slotsOfrecidos: slots,
        creadoEn: Date.now()
    };
}

function formatearOfertaSlots({ empresa, slots, trabajadores, servicio, fecha }) {
    const multiProfesional = trabajadores.length > 1;

    // Como una recepcionista: se ofrecen hasta 5 opciones, no el día entero
    // (una lista de 17 horas se lee robótica y abruma). El resto de los
    // slots sigue vivo en la reserva pendiente, así que agendar una hora
    // no listada sigue validando igual.
    const ofrecidos = slots.slice(0, 5);

    // Con más de un profesional libre se muestra quién atiende cada hora.
    const lista = ofrecidos
        .map(s => (multiProfesional ? `• ${s.hora} con ${s.trabajador_nombre}` : `• ${s.hora}`))
        .join('\n');

    const encabezado = `Estos son los horarios libres para ${servicio.nombre} el ${formatearFechaLarga(fecha)}:`;

    return `${encabezado}\n${lista}\n\n¿Te aparto alguno? Si prefieres otra hora, dime cuál y te digo si queda.`;
}

function respuestaConfirmacion({ empresa, nombreCliente, servicio, fecha, hora, trabajador }) {
    const plantilla = empresa?.mensaje_confirmacion
        || '¡Listo {nombre}! Tu cita de {servicio} quedó agendada para el {fecha} a las {hora} con {profesional}. Te esperamos en {nombre_negocio}.';

    return plantilla
        .replace('{nombre}', nombreCliente || 'amigo')
        .replace('{servicio}', servicio?.nombre || 'tu servicio')
        .replace('{fecha}', formatearFechaLarga(fecha))
        .replace('{hora}', hora)
        .replace('{profesional}', trabajador?.nombre || 'nuestro equipo')
        .replace('{nombre_negocio}', empresa?.nombre || 'nuestro negocio');
}

// ============================================================
// Orquestación de tools
// ============================================================

async function procesarToolCall({ nombre, argsCrudos, config, bot, conv, telefonoCliente, userName }) {
    const args = parseArgsBrutos(argsCrudos);
    const nombreCliente = userName || 'amigo';

    if (nombre === 'ver_slots') {
        const resultado = await ejecutarVerSlots({ config, args });

        if (resultado.exitoso && resultado.slots.length > 0) {
            const servicio = servicioPorNombre(config.servicios, args.servicio);
            const primerSlot = resultado.slots[0];

            guardarPending(conv, {
                empresaId: config.empresa.id,
                servicio,
                fecha: resultado.fecha,
                hora: primerSlot.hora,
                trabajadorId: primerSlot.trabajador_id,
                slots: resultado.slots.map(s => `${s.trabajador_id}|${s.hora}`)
            });

            return formatearOfertaSlots({
                empresa: config.empresa,
                slots: resultado.slots,
                trabajadores: resultado.trabajadores,
                servicio,
                fecha: resultado.fecha
            });
        }

        // Si el motivo es un detalle técnico (calendarios, tokens, base de
        // datos), el cliente no debe enterarse: se traduce a algo natural.
        const motivo = String(resultado.mensaje || '');
        const esTecnico = /calendar|calendario|token|panel|base de datos/i.test(motivo);
        return esTecnico
            ? 'Ahora mismo no tengo horarios disponibles para esa fecha. ¿Quieres que mire otro día?'
            : motivo || 'No encontré horarios disponibles para esa fecha.';
    }

    if (nombre === 'agendar_cita') {
        // El cliente puede haber confirmado una hora distinta a la primera ofrecida.
        const pendiente = leerPending(conv);
        const horaPedida = normalizarHora(args.hora);

        if (pendiente && horaPedida && horaPedida !== pendiente.hora) {
            const elegido = pendiente.slotsOfrecidos?.find(s => s.endsWith(`|${horaPedida}`));
            if (elegido) {
                pendiente.hora = horaPedida;
                pendiente.trabajadorId = elegido.split('|')[0];
            }
        }

        const resultado = await ejecutarAgendar({ config, bot, args, conv, telefonoCliente, userName });

        if (!resultado.exitoso) return resultado.mensaje;

        return respuestaConfirmacion({
            empresa: config.empresa,
            nombreCliente,
            servicio: resultado.servicio,
            fecha: resultado.fecha,
            hora: resultado.hora,
            trabajador: resultado.trabajador
        });
    }

    if (nombre === 'cancelar_cita') {
        const resultado = await ejecutarCancelar({ config, telefonoCliente, conv });

        if (resultado.exitoso) conv.ultimaCita = null;

        return resultado.exitoso
            ? `Listo ${nombreCliente}, tu cita del ${formatearFechaCorta(resultado.cita.fecha)} a las ${resultado.cita.hora} quedó cancelada. ¿Te agendo otra?`
            : `No pude cancelarla: ${resultado.mensaje}`;
    }

    if (nombre === 'modificar_cita') {
        const resultado = await ejecutarModificar({ config, args, telefonoCliente, conv });

        if (resultado.exitoso) {
            conv.ultimaCita = {
                servicio: resultado.cita.nombre_servicio,
                fecha: resultado.cita.fecha,
                hora: resultado.cita.hora
            };
        }

        return resultado.exitoso
            ? `Perfecto ${nombreCliente}, tu cita se movió al ${formatearFechaLarga(resultado.cita.fecha)} a las ${resultado.cita.hora}.`
            : `No pude moverla: ${resultado.mensaje}`;
    }

    return 'No pude entender eso. ¿Me lo repites?';
}

const TTL_REMINDER_MS = 6 * 60 * 60 * 1000;

function leerPendingReminder(conv) {
    const p = conv.pendingReminder;
    if (!p || !p.citaId) return null;
    if (p.expira && Date.now() > Number(p.expira)) {
        conv.pendingReminder = null;
        return null;
    }
    if (p.creadoEn && Date.now() - Number(p.creadoEn) > TTL_REMINDER_MS) {
        conv.pendingReminder = null;
        return null;
    }
    return p;
}

async function manejarRespuestaRecordatorio({ texto, conv, config, telefonoCliente }) {
    const pendiente = leerPendingReminder(conv);
    if (!pendiente) return null;

    if (esConfirmacionAfirmativa(texto) && !esNegacion(texto)) {
        const { error } = await supabase
            .from('citas')
            .update({ estado: 'confirmada' })
            .eq('id', pendiente.citaId)
            .in('estado', ['agendada', 'confirmada']);

        conv.pendingReminder = null;

        if (error) {
            console.error('❌ Confirmar recordatorio:', error.message);
            return 'No pude confirmar tu cita ahora. ¿Lo intentamos de nuevo?';
        }

        await notificaciones.registrarRespuestaCliente(pendiente.citaId, 'si');
        return '¡Perfecto! Tu cita quedó confirmada. Te esperamos 🙌';
    }

    if (esNegacion(texto)) {
        const cita = await calendar.citaVigente({
            empresa: config.empresa,
            telefonoCliente,
            bsuid: conv.bsuid || null
        });

        conv.pendingReminder = null;
        await notificaciones.registrarRespuestaCliente(pendiente.citaId, 'no');

        if (cita && cita.id === pendiente.citaId) {
            const trabajador = await disponibilidad.obtenerTrabajadores(config.empresa.id, false)
                .then(lista => lista.find(t => t.id === cita.trabajador_id) || null);
            await calendar.cancelarCita({
                empresa: config.empresa,
                trabajador,
                cita,
                canceladoPor: 'cliente',
                motivo: 'cliente pidió cambiar tras recordatorio'
            });
            conv.ultimaCita = null;
            notificaciones.avisarDueno({
                empresa: config.empresa,
                tipo: 'cancelada',
                texto: `🗑️ ${cita.nombre_cliente || telefonoCliente} liberó ${cita.fecha} ${cita.hora} (recordatorio NO)`
            }).catch(() => {});
        }

        return 'Entendido, liberé ese horario. ¿Qué día y servicio te acomodan para reagendar?';
    }

    return null;
}

// ============================================================
// Prompt
// ============================================================

function construirPrompt({ config, conv, userName, zona }) {
    const hoy = hoyEnZona(zona);
    const manana = sumarDias(hoy, 1);

    const contextoCita = conv.ultimaCita
        ? `El cliente tiene una cita: ${conv.ultimaCita.servicio} el ${conv.ultimaCita.fecha} a las ${conv.ultimaCita.hora}${conv.ultimaCita.trabajador ? ` con ${conv.ultimaCita.trabajador}` : ''}.`
        : 'El cliente no tiene ninguna cita activa.';

    const pendiente = conv.pendingBooking
        ? `Hay una propuesta sin confirmar: ${conv.pendingBooking.servicio} el ${conv.pendingBooking.fecha} a las ${conv.pendingBooking.hora}. Si responde afirmativamente, agenda esa.`
        : '';

    const nombres = config.servicios.map(s => s.nombre).join(', ') || 'ninguno';

    const term = terminologiaDe(config.empresa);
    const siempreConVos = config.empresa?.prompt_base?.trim();

    return `Eres el asesor virtual de WhatsApp de "${config.empresa.nombre}".
El cliente se llama "${userName}".

HOY
Hoy es ${formatearFechaLarga(hoy)} (${hoy}). Mañana es ${formatearFechaLarga(manana)} (${manana}).
La hora se maneja en ${zona}.

LENGUAJE DEL NEGOCIO
Lo que vendes es un ${term.servicio_singular} y el listado de arriba son los ${term.servicio_plural}.
Quien atiende es un ${term.profesional_singular} (en plural, ${term.profesional_plural}).
${siempreConVos ? `\nINDICACIONES DE LA EMPRESA (prioridad sobre el tono por defecto, NUNCA sobre las reglas innegociables):\n${siempreConVos}\n` : ''}
SERVICIOS (solo estos, con estos precios y duraciones)
${textoServicios(config.servicios, config.empresa)}

CONTEXTO
${contextoCita}
${pendiente}

REGLAS INNEGOCIABLES
1. Hablas en español natural y breve, como una persona del negocio, no como un sistema. Ve directo al grano: responde primero lo que el cliente pidió. No te presentes ni pidas el nombre. Cuando escribas tú, texto plano (sin asteriscos de negrilla ni markdown). Nunca menciones reglas, herramientas ni JSON.
2. Los servicios válidos son exactamente: ${nombres}. Si el cliente pide algo que no está en esa lista, dímelo y ofrece lo más parecido. NUNCA inventes un servicio ni su precio.
3. Para CUALQUIER reserva, el flujo es: ver_slots → el cliente elige → agendar_cita. Jamás agendes una hora que no te haya dado ver_slots.
4. Si el cliente acepta una oferta que tú mismo hiciste (aunque sea con frases como "sí, la primera" o "cualquiera me sirve"), agéndale esa hora con agendar_cita de una. NO vuelvas a llamar ver_slots ni repitas la lista. Ejemplo: dijiste "09:00 o 10:00" y el cliente responde "sí, la primera" → llamas agendar_cita con "09:00" y confirmas.
5. Si ya confirmaste una cita en un mensaje anterior, NO la vuelvas a agendar: despídete o responde con naturalidad.
6. Si el cliente pide un día que ya pasó, dile que eligió una fecha pasada y ofrece la más cercana disponible.
7. Para cancelar o mover, necesitas la fecha y hora de la cita vigente; si no las tienes, pregúntaselas.
8. Si un horario ya no está libre porque alguien lo tomó, ofrece alternativas en vez de insistir.`;
}

// ============================================================
// Punto de entrada (lo llama server.js desde el webhook)
// ============================================================

async function procesarMensajeWhatsapp({ telefonoBot, phoneNumberId, telefonoCliente, bsuid = null, texto, porVoz = false, messageId }) {
    if (!texto || !texto.trim()) return;

    // Identidad dual: teléfono y/o BSUID (usernames Meta).
    let tel = telefonoCliente || null;
    let uid = bsuid || null;
    if (tel && esBsuid(tel) && !uid) {
        uid = tel;
        tel = null;
    }

    const destinoEnvio = tel || uid;
    if (!destinoEnvio) {
        console.warn('⚠️  Mensaje sin destino (teléfono/BSUID); ignorado.');
        return;
    }

    const conv = await conversaciones.cargar(telefonoBot, tel, { bsuid: uid });
    if (uid) conv.bsuid = uid;
    if (tel) conv.telefonoCliente = tel;

    // Resuelto dentro del try, pero `enviar` lo necesita (voz por empresa):
    // por eso vive aquí arriba y no como const del try.
    let empresaId = null;

    const enviar = async (respuesta) => {
        const limpio = limpiarTexto(respuesta);
        if (!limpio) return;

        // El cliente escribió por voz -> respondemos con la voz clonada
        // del negocio. Si la síntesis o el envío fallan, cae a texto:
        // el cliente nunca se queda sin respuesta.
        let enviadoPorVoz = false;
        if (porVoz) {
            enviadoPorVoz = await voz.responderPorVoz(destinoEnvio, limpio, phoneNumberId, empresaId);
            if (!enviadoPorVoz) console.warn('⚠️  Respuesta por voz no salió, se envía como texto.');
        }
        if (!enviadoPorVoz) {
            await enviarMensajeTexto(destinoEnvio, limpio, phoneNumberId);
        }
        conversaciones.agregarMensaje(conv, 'assistant', limpio);
    };

    const persistir = async () => conversaciones.guardar(telefonoBot, tel, conv);

    try {
        if (messageId) marcarComoLeido(messageId, phoneNumberId).catch(() => {});

        empresaId = await resolverEmpresaId(telefonoBot, phoneNumberId);
        if (!empresaId) {
            console.error(`❌ El número ${telefonoBot} no está registrado en numeros_bot. Mensaje ignorado.`);
            return;
        }

        const cfg = await cargarConfiguracion(empresaId);
        if (!cfg.empresa) {
            console.error(`❌ No se encontró la empresa ${empresaId}.`);
            return;
        }

        const zona = cfg.empresa.zona_horaria || 'America/Bogota';
        const rol = await roles.resolverRol(empresaId, {
            telefono: tel,
            bsuid: uid,
            empresa: cfg.empresa
        });

        conversaciones.agregarMensaje(conv, 'user', texto);

        // ── Modo dueño / staff / trabajador ───────────────────
        if (roles.esModoDueno(rol)) {
            const pendingOwner = agenteDueno.leerPendingOwner(conv);
            if (pendingOwner && esConfirmacionAfirmativa(texto) && !esNegacion(texto)) {
                const r = await agenteDueno.confirmarPendingOwner({ empresa: cfg.empresa, rol, conv });
                await enviar(r.mensaje);
                await persistir();
                return;
            }
            if (pendingOwner && esNegacion(texto)) {
                conv.pendingOwnerAction = null;
                await enviar('Ok, no hago ese cambio.');
                await persistir();
                return;
            }

            const mensajes = [
                { role: 'system', content: agenteDueno.construirPromptDueno({ empresa: cfg.empresa, rol, zona, conv }) },
                ...conv.mensajes.map(m => ({ role: m.role, content: m.content }))
            ];

            const response = await groq.chat.completions.create({
                model: MODELO,
                messages: mensajes,
                tools: agenteDueno.TOOLS_DUENO,
                tool_choice: 'auto',
                temperature: 0.3
            });

            const salida = response.choices[0].message;
            const toolCall = salida.tool_calls?.[0];
            let respuestaFinal;

            if (toolCall) {
                console.log(`🔧 Tool dueño: ${toolCall.function.name}`, toolCall.function.arguments);
                const args = parseArgsBrutos(toolCall.function.arguments);
                const r = await agenteDueno.procesarToolDueno({
                    nombre: toolCall.function.name,
                    args,
                    empresa: cfg.empresa,
                    rol,
                    conv
                });
                respuestaFinal = r.mensaje || 'Listo.';
            } else {
                respuestaFinal = limpiarTexto(salida.content) || '¿En qué te ayudo con la agenda?';
            }

            await enviar(respuestaFinal);
            await persistir();
            return;
        }

        // ── Modo cliente ──────────────────────────────────────
        const esPrimera = conversaciones.esPrimeraConversacion({
            userName: conv.userName,
            mensajes: conv.mensajes.slice(0, -1)
        });

        // El saludo de bienvenida SOLO cuando el cliente apenas está saludando.
        // Si trae una petición ("quería una cita..."), el modelo responde de una:
        // como una recepcionista real, que no interrumpe con "¿cómo te llamas?".
        if (esPrimera && mensajeEsSoloSaludo(texto)) {
            const saludo = (cfg.empresa.mensaje_bienvenida
                || '¡Hola! Bienvenido a {nombre_negocio}. 👋 Soy tu asesor virtual, ¿cómo te llamas?')
                .replace('{nombre_negocio}', cfg.empresa.nombre);

            await enviar(saludo);
            await persistir();
            return;
        }

        // El nombre se captura ANTES de decidir la respuesta: si el mensaje trae
        // nombre y petición ("soy Laura, quería cita mañana"), el prompt ya conoce
        // el nombre y el modelo responde todo en un solo mensaje.
        let nombreRecien = false;
        if (!conv.userName) {
            const nombre = await extraerNombre(texto);
            if (nombre) {
                conv.userName = nombre;
                nombreRecien = true;
            }
        }

        const userName = conv.userName || 'amigo';

        // Contestó solo el nombre a la pregunta de bienvenida → saludo corto.
        if (nombreRecien && mensajeEsSoloNombre(texto)) {
            await enviar(`¡Mucho gusto, ${conv.userName}! ¿En qué te ayudo hoy?`);
            await persistir();
            return;
        }

        // Loop cerrado de recordatorio (antes del pending de reserva).
        const respReminder = await manejarRespuestaRecordatorio({
            texto,
            conv,
            config: cfg,
            telefonoCliente: tel
        });
        if (respReminder) {
            await enviar(respReminder);
            await persistir();
            return;
        }

        const pendiente = leerPending(conv);

        if (pendiente && (esConfirmacionAfirmativa(texto) || aceptaLaPrimeraOferta(texto)) && !esNegacion(texto)) {
            const respuesta = await procesarToolCall({
                nombre: 'agendar_cita',
                argsCrudos: { hora: pendiente.hora },
                config: cfg,
                conv,
                telefonoCliente: tel,
                userName
            });
            await enviar(respuesta);
            await persistir();
            return;
        }

        if (pendiente && esNegacion(texto)) {
            conv.pendingBooking = null;
            await enviar('Perfecto, no te aparto nada. ¿Buscamos otro horario?');
            await persistir();
            return;
        }

        const mensajes = [
            { role: 'system', content: construirPrompt({ config: cfg, conv, userName, zona }) },
            ...conv.mensajes.map(m => ({ role: m.role, content: m.content }))
        ];

        const response = await groq.chat.completions.create({
            model: MODELO,
            messages: mensajes,
            tools: TOOLS,
            tool_choice: 'auto',
            temperature: 0.5
        });

        const salida = response.choices[0].message;
        const toolCall = salida.tool_calls?.[0];

        let respuestaFinal;

        if (toolCall) {
            console.log(`🔧 Tool: ${toolCall.function.name}`, toolCall.function.arguments);
            respuestaFinal = await procesarToolCall({
                nombre: toolCall.function.name,
                argsCrudos: toolCall.function.arguments,
                config: cfg,
                conv,
                telefonoCliente: tel,
                userName
            });
        } else {
            respuestaFinal = limpiarTexto(salida.content);
            if (!respuestaFinal) {
                respuestaFinal = '¿Me lo repites?';
            }
        }

        await enviar(respuestaFinal);
        await persistir();

    } catch (error) {
        console.error('❌ Error procesando el mensaje:', error);

        try {
            await enviarMensajeTexto(
                destinoEnvio,
                'Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?',
                phoneNumberId
            );
        } catch (falloAviso) {
            console.error('❌ No se pudo ni avisar del fallo:', falloAviso.message);
            throw error;
        }
    }
}

async function resolverEmpresaId(telefonoBot, phoneNumberId) {
    const bot = await numeros.resolverBot(telefonoBot, phoneNumberId);
    return bot ? bot.empresa_id : null;
}

async function extraerNombre(texto) {
    try {
        const response = await groq.chat.completions.create({
            model: MODELO,
            temperature: 0,
            messages: [
                { role: 'system', content: 'Extrae SOLO el nombre propio de este mensaje. Si no hay un nombre propio claro, responde exactamente: null' },
                { role: 'user', content: texto }
            ]
        });

        const nombre = response.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
        return nombre && nombre.toLowerCase() !== 'null' && nombre.length <= 60 ? nombre : null;
    } catch (error) {
        console.error('Error extrayendo el nombre:', error.message);
        return null;
    }
}

// ============================================================
// Arranque
// ============================================================

async function iniciar() {
    console.log('📱 SlotBrain (bot de citas por WhatsApp, Meta Cloud API) iniciado.');

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
        console.error('❌ Faltan SUPABASE_URL o SUPABASE_KEY.');
        return;
    }
    if (!process.env.GROQ_API_KEY) {
        console.error('❌ Falta GROQ_API_KEY.');
        return;
    }

    const { data: numerosActivos, error } = await supabase
        .from('numeros_bot')
        .select('telefono, phone_number_id, empresa_id, activo')
        .eq('activo', true);

    if (error) {
        console.error('❌ No se pudieron leer los números de `numeros_bot`:', error.message);
        return;
    }

    if (!numerosActivos?.length) {
        console.warn('⚠️  No hay ningún número activo en `numeros_bot`. Registra uno en /admin.html o los mensajes entrantes se ignorarán.');
        return;
    }

    console.log(`✅ ${numerosActivos.length} número(s) de respuesta activo(s):`);
    for (const n of numerosActivos) {
        console.log(`   • ${n.telefono} → ${n.phone_number_id || 'sin phone_number_id'}`);
    }

    const { data: sinCalendar } = await supabase
        .from('trabajadores')
        .select('nombre')
        .eq('activo', true)
        .is('correo', null);

    if (sinCalendar?.length) {
        console.warn(`⚠️  ${sinCalendar.length} profesional(es) sin Google Calendar: ${sinCalendar.map(t => t.nombre).join(', ')}`);
    }
}

module.exports = { iniciar, procesarMensajeWhatsapp, limpiarCacheConfiguracion };
