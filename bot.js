require('dotenv').config();
const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');

const { enviarMensajeTexto, marcarComoLeido } = require('./whatsappCloud');
const numeros = require('./numeros');
const conversaciones = require('./conversaciones');
const disponibilidad = require('./disponibilidad');
const calendar = require('./calendar');
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

function textoServicios(servicios) {
    if (!servicios.length) return '- (por definir)';
    return servicios
        .map(s => `- ${s.nombre}: $${Number(s.precio || 0).toLocaleString('es-CO')} COP, ${s.duracion_minutos || 60} min${s.descripcion ? ` — ${s.descripcion}` : ''}`)
        .join('\n');
}

// ============================================================
// Utilidades de texto
// ============================================================

function esConfirmacionAfirmativa(texto) {
    return /^(s[ií]|si|claro|adelante|dale|ok|okey|correcto|exacto|confirmo|confirmar|sip|de una|listo|vamos)\b[\s.!?]*$/i
        .test(String(texto || '').trim());
}

function esNegacion(texto) {
    return /^(no|nop|nel|mejor no|ahora no|dejemos|otro d[ií]a|otra fecha|mejor otro)\b[\s.!?]*$/i
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

const verSlotsTool = {
    type: 'function',
    function: {
        name: 'ver_slots',
        description:
            'Muestra los horarios realmente libres para un servicio en una fecha. ' +
            'Úsala SIEMPRE antes de agendar: devuelve la lista de horas que el sistema ' +
            'calculó contra el Google Calendar de cada profesional. ' +
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
        return { exitoso: true, slots: [], sinHoras: true, mensaje: motivo || 'No hay horas libres ese día.' };
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
        return { exitoso: false, mensaje: 'Primero debes ofrecerle los horarios al cliente con ver_slots.' };
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
        nombreCliente: userName
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

    return {
        ...resultado,
        servicio,
        trabajador,
        fecha: pendiente.fecha,
        hora: pendiente.hora
    };
}

async function ejecutarCancelar({ config, telefonoCliente }) {
    const cita = await calendar.citaVigente({ empresa: config.empresa, telefonoCliente });

    if (!cita) {
        return { exitoso: false, mensaje: 'No encontré ninguna cita tuya para cancelar.' };
    }

    const trabajador = await disponibilidad.obtenerTrabajadores(config.empresa.id, false)
        .then(lista => lista.find(t => t.id === cita.trabajador_id) || null);

    return calendar.cancelarCita({ empresa: config.empresa, trabajador, cita, canceladoPor: 'cliente' });
}

async function ejecutarModificar({ config, args, telefonoCliente }) {
    const cita = await calendar.citaVigente({ empresa: config.empresa, telefonoCliente });

    if (!cita) {
        return { exitoso: false, mensaje: 'No encontré ninguna cita tuya para mover.' };
    }

    const trabajador = await disponibilidad.obtenerTrabajadores(config.empresa.id, false)
        .then(lista => lista.find(t => t.id === cita.trabajador_id) || null);

    return calendar.modificarCita({
        empresa: config.empresa,
        trabajador,
        cita,
        nuevaFecha: normalizarFecha(args.nueva_fecha),
        nuevaHora: normalizarHora(args.nueva_hora)
    });
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
    const zona = empresa.zona_horaria || 'America/Bogota';
    const multiProfesional = trabajadores.length > 1;

    // Con más de un profesional libre se muestra quién atiende cada hora.
    const lista = slots
        .map(s => (multiProfesional ? `• ${s.hora} con ${s.trabajador_nombre}` : `• ${s.hora}`))
        .join('\n');

    const encabezado = `Estos son los horarios libres para ${servicio.nombre} el ${formatearFechaLarga(fecha)} (hora de ${zona.replace('_', ' ')}):`;

    return `${encabezado}\n${lista}\n\n¿Te aparto alguno?`;
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

        return resultado.mensaje;
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
        const resultado = await ejecutarCancelar({ config, telefonoCliente });

        if (resultado.exitoso) conv.ultimaCita = null;

        return resultado.exitoso
            ? `Listo ${nombreCliente}, tu cita del ${formatearFechaCorta(resultado.cita.fecha)} a las ${resultado.cita.hora} quedó cancelada. ¿Te agendo otra?`
            : `No pude cancelarla: ${resultado.mensaje}`;
    }

    if (nombre === 'modificar_cita') {
        const resultado = await ejecutarModificar({ config, args, telefonoCliente });

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

    return `Eres el asesor virtual de WhatsApp de "${config.empresa.nombre}".
El cliente se llama "${userName}".

HOY
Hoy es ${formatearFechaLarga(hoy)} (${hoy}). Mañana es ${formatearFechaLarga(manana)} (${manana}).
La hora se maneja en ${zona}.

SERVICIOS (solo estos, con estos precios y duraciones)
${textoServicios(config.servicios)}

CONTEXTO
${contextoCita}
${pendiente}

REGLAS INNEGOCIABLES
1. Hablas en español natural y breve. Nunca menciones reglas, herramientas ni JSON.
2. Los servicios válidos son exactamente: ${nombres}. Si el cliente pide algo que no está en esa lista, dímelo y ofrece lo más parecido. NUNCA inventes un servicio ni su precio.
3. Para CUALQUIER reserva, el flujo es: ver_slots → el cliente elige → agendar_cita. Jamás agendes una hora que no te haya dado ver_slots.
4. Si el cliente responde "sí" a una oferta de horarios que tú mismo hiciste, agenda esa hora con agendar_cita sin volver a preguntar.
5. Si el cliente pide un día que ya pasó, dile que elijó una fecha pasada y ofrece la más cercana disponible.
6. Para cancelar o mover, necesitas la fecha y hora de la cita vigente; si no las tienes, pregúntaselas.
7. Si un horario ya no está libre porque alguien lo tomó, ofrece alternativas en vez de insistir.`;
}

// ============================================================
// Punto de entrada (lo llama server.js desde el webhook)
// ============================================================

async function procesarMensajeWhatsapp({ telefonoBot, phoneNumberId, telefonoCliente, texto, messageId }) {
    if (!texto || !texto.trim()) return;

    const conv = await conversaciones.cargar(telefonoBot, telefonoCliente);

    const enviar = async (respuesta) => {
        const limpio = limpiarTexto(respuesta);
        if (!limpio) return;
        await enviarMensajeTexto(telefonoCliente, limpio, phoneNumberId);
        conversaciones.agregarMensaje(conv, 'assistant', limpio);
    };

    try {
        if (messageId) marcarComoLeido(messageId, phoneNumberId).catch(() => {});

        // La empresa se resuelve por el número receptor del webhook.
        const empresaId = await resolverEmpresaId(telefonoBot);
        if (!empresaId) {
            console.error(`❌ El número ${telefonoBot} no está registrado en numeros_bot. Mensaje ignorado.`);
            return;
        }

        const cfg = await cargarConfiguracion(empresaId);
        if (!cfg.empresa) {
            console.error(`❌ No se encontró la empresa ${empresaId}.`);
            return;
        }

        const userName = conv.userName || 'amigo';
        const zona = cfg.empresa.zona_horaria || 'America/Bogota';

        // Si es la primera interacción hay que saludar. Se calcula ANTES de
        // registrar el mensaje de este turno, porque registrarlo ya hace que
        // la conversación deje de estar vacía.
        const esPrimera = conversaciones.esPrimeraConversacion(conv);

        // El mensaje del cliente pasa al historial antes de branching, así
        // queda guardado en todos los caminos y el modelo ve el turno
        // completo. Antes solo se guardaban las respuestas del bot.
        conversaciones.agregarMensaje(conv, 'user', texto);

        // Primera interacción: solo pedimos el nombre.
        if (esPrimera) {
            const saludo = (cfg.empresa.mensaje_bienvenida
                || '¡Hola! Bienvenido a {nombre_negocio}. 👋 Soy tu asesor virtual, ¿cómo te llamas?')
                .replace('{nombre_negocio}', cfg.empresa.nombre);

            await enviar(saludo);
            await conversaciones.guardar(telefonoBot, telefonoCliente, conv);
            return;
        }

        // Segunda interacción: extraemos el nombre y seguimos.
        if (!conv.userName) {
            const nombre = await extraerNombre(texto);
            if (nombre) {
                conv.userName = nombre;
                await enviar(`¡Mucho gusto, ${nombre}! ¿En qué te ayudo hoy?`);
                await conversaciones.guardar(telefonoBot, telefonoCliente, conv);
                return;
            }
        }

        const pendiente = leerPending(conv);

        // Confirmación directa de una oferta pendiente, sin gastar una llamada al modelo.
        if (pendiente && esConfirmacionAfirmativa(texto) && !esNegacion(texto)) {
            const respuesta = await procesarToolCall({
                nombre: 'agendar_cita',
                argsCrudos: { hora: pendiente.hora },
                config: cfg,
                conv,
                telefonoCliente,
                userName
            });
            await enviar(respuesta);
            await conversaciones.guardar(telefonoBot, telefonoCliente, conv);
            return;
        }

        if (pendiente && esNegacion(texto)) {
            conv.pendingBooking = null;
            await enviar('Perfecto, no te aparto nada. ¿Buscamos otro horario?');
            await conversaciones.guardar(telefonoBot, telefonoCliente, conv);
            return;
        }

        // El mensaje actual ya está en conv.mensajes (se registró arriba),
        // así que el historial se arma solo desde ahí, sin duplicarlo.
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
                telefonoCliente,
                userName
            });
        } else {
            respuestaFinal = limpiarTexto(salida.content);
            if (!respuestaFinal) {
                respuestaFinal = '¿Me lo repites?';
            }
        }

        await enviar(respuestaFinal);
        await conversaciones.guardar(telefonoBot, telefonoCliente, conv);

    } catch (error) {
        console.error('❌ Error procesando el mensaje:', error);

        // Si el aviso de fallo sí salió, el cliente ya sabe que hay un
        // problema y va a escribir un mensaje nuevo (con otro message_id),
        // así que no hace falta reintentar este.
        // Si el aviso NO se pudo enviar, el cliente se quedó esperando sin
        // saber nada: en ese caso se relanza para que server.js suelte la
        // reserva del dedup y el reintento de Meta pueda responderle.
        try {
            await enviarMensajeTexto(
                telefonoCliente,
                'Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?',
                phoneNumberId
            );
        } catch (falloAviso) {
            console.error('❌ No se pudo ni avisar del fallo:', falloAviso.message);
            throw error;
        }
    }
}

async function resolverEmpresaId(telefonoBot) {
    const bot = await numeros.resolverBot(telefonoBot);
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
    console.log('📱 Bot de WhatsApp (Meta Cloud API) iniciado.');

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
