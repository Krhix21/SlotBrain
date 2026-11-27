require('dotenv').config();
const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');

const { enviarMensajeTexto, marcarComoLeido, esBsuid } = require('./whatsappCloud');
const voz = require('./voz');
const estiloMod = require('./estilo');
const ofertas = require('./ofertas');
const memoria = require('./memoria');
const numeros = require('./numeros');
const conversaciones = require('./conversaciones');
const disponibilidad = require('./disponibilidad');
const calendar = require('./calendar');
const roles = require('./roles');
const agenteDueno = require('./agenteDueno');
const notificaciones = require('./notificaciones');
const listaEspera = require('./listaEspera');
const {
    formatearFechaLarga,
    formatearFechaCercana,
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

function dormir(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function llamarGroq(params, { intentos = 4 } = {}) {
    let ultimo = null;
    for (let i = 0; i < intentos; i++) {
        try {
            return await groq.chat.completions.create(params);
        } catch (e) {
            ultimo = e;
            const status = e?.status || e?.statusCode;
            const retriable = status === 429 || status === 503 || status === 502;
            if (!retriable || i === intentos - 1) throw e;
            const retryAfter = Number(e?.headers?.['retry-after'] || 0);
            const esperaMs = Math.max(retryAfter * 1000, Math.min(90_000, 2000 * (2 ** i)));
            console.warn(`⚠️  Groq ${status}: reintento ${i + 1}/${intentos - 1} en ${Math.round(esperaMs / 1000)}s`);
            await dormir(esperaMs);
        }
    }
    throw ultimo;
}

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

/** Para harness: fuerza estilo/terminología en caché sin exigir columnas nuevas en DB. */
async function sembrarConfigConOverrides(empresaId, overrides = {}) {
    const cfg = await cargarConfiguracion(empresaId);
    if (cfg.empresa) {
        if (overrides.estilo && typeof overrides.estilo === 'object') {
            cfg.empresa.estilo = { ...(cfg.empresa.estilo || {}), ...overrides.estilo };
        }
        if (overrides.terminologia && typeof overrides.terminologia === 'object') {
            cfg.empresa.terminologia = { ...(cfg.empresa.terminologia || {}), ...overrides.terminologia };
        }
    }
    configCache.set(empresaId, { valor: cfg, expiresAt: Date.now() + 60 * 60 * 1000 });
    return cfg;
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

const terminologiaDe = estiloMod.terminologiaDe;

// ============================================================
// Utilidades de texto
// ============================================================

// Ojo con el acento: en JS, \b tras "í" NO funciona (í no es carácter de
// palabra), así que "sí" con tilde nunca matcheaba. Se usa (?![a-z0-9]).
function esConfirmacionAfirmativa(texto) {
    // Se quitan las cortesías ("listo, muchas gracias" -> "listo") y luego
    // se aceptan afirmaciones sueltas o en combos cortos ("ok sí", "sí perfecto").
    const t = String(texto || '').trim()
        .replace(/(?:,\s*)?(?:muchas\s+)?gracias\b/gi, '')
        .replace(/[.!?\s]+$/, '')
        .trim();
    return /^(s[ií]|claro|adelante|dale|ok|okey|correcto|exacto|confirmo|confirmar|sip|de una|listo|vamos|perfecto|hecho|vale|va|bien)(?![a-z0-9])([\s,]*(s[ií]|ok|perfecto|claro|de una|parce)(?![a-z0-9]))?[\s.!?]*$/i
        .test(t);
}

function esNegacion(texto) {
    return /^(no|nop|nel|mejor no|ahora no|dejemos|otro d[ií]a|otra fecha|mejor otro)(?![a-z0-9])[\s.!?]*$/i
        .test(String(texto || '').trim());
}

/** Solo gracias / despedida, sin pedir nada más (no llama tools). */
function clasificarCortesia(texto) {
    const t = String(texto || '').trim();
    if (!t || t.length > 80) return null;
    if (/^(muchas\s+|mil\s+)?gracias\b/i.test(t) && !/\b(cita|agend|horario|cancel)/i.test(t)) return 'gracias';
    if (/^(chao|adi[oó]s|hasta luego|nos vemos|bye|hasta pronto|que est[eé]s bien)[.!?¡\s]*$/i.test(t)) return 'despedida';
    if (/^(perfecto|listo|ok|vale|genial|excelente)[,!]{0,3}\s+(muchas\s+)?gracias([\s.].*)?$/i.test(t)) return 'gracias';
    if (/^(perfecto|listo|ok)[,!]{0,3}\s+(gracias[,!]{0,3}\s+)?(hasta luego|chao|adi[oó]s|nos vemos).*$/i.test(t)) return 'despedida';
    return null;
}

function pideHablarConHumano(texto) {
    return /\b(asesor|humano|persona|alguien del (equipo|negocio|local)|hablar con (alguien|una persona|un asesor)|atenci[oó]n humana|operador)\b/i
        .test(String(texto || ''))
        || /\b(pasame|pásame|pasa me|quiero hablar) con (un |una )?(humano|persona|asesor|alguien)\b/i.test(String(texto || ''));
}

function preguntaSiEsBot(texto) {
    return /\b(eres un bot|sos un bot|es un bot|eres (una )?ia|eres (una )?inteligencia|hablando con un bot|sos (un )?robot)\b/i
        .test(String(texto || ''));
}

function pideLoMasPronto(texto) {
    return /\b(lo m[aá]s pronto|lo antes|cuanto antes|la m[aá]s cercana|primera que (tenga|haya|puedas)|lo que (tengan|haya))\b/i
        .test(String(texto || ''));
}


/** El cliente pide explícitamente un día que ya pasó. */
function pideFechaPasada(texto, zona) {
    const t = String(texto || '').toLowerCase();
    if (/\b(ayer|anteayer|el d[ií]a de ayer|la semana pasada|el mes pasado)\b/.test(t)) return true;
    const m = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (m) {
        const iso = `${m[1]}-${m[2]}-${m[3]}`;
        if (esFechaValida(iso) && iso < hoyEnZona(zona)) return true;
    }
    return false;
}

function respuestaFechaPasada(estilo) {
    const e = estilo || {};
    if (e.tratamiento === 'usted') {
        return 'Ese día ya pasó. ¿Le sirve hoy o mañana?';
    }
    return '¡Uy, ese día ya pasó! ¿Para hoy o mañana te viene mejor?';
}

function horasUnicasOfrecidas(pendiente) {
    const set = new Set();
    for (const s of pendiente?.slotsOfrecidos || []) {
        const hora = String(s).split('|')[1];
        if (hora) set.add(hora);
    }
    if (pendiente?.hora) set.add(pendiente.hora);
    return [...set];
}

function repreguntarHora(horas) {
    const lista = horas.slice(0, 4);
    if (lista.length === 2) return `¿Con cuál: ${lista[0]} o ${lista[1]}?`;
    return `¿Con cuál: ${lista.join(', ')}?`;
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

/** Aceptación de la oferta sin elegir hora ("sí, la primera", "cualquiera me sirve",
 *  "sí, la más cercana que tenga"). */
function aceptaLaPrimeraOferta(texto) {
    return /^(¡|s[ií]|si|dale|ok|listo)?(?![a-z0-9])?[\s,¡!]*(la\s+|el\s+|lo\s+)?(primera|primero|cualquiera|cualquier|que\s+sea|la\s+que\s+sea|m[aá]s\s+cercana|primera\s+que\s+tenga|que\s+tenga|la\s+que\s+haya|lo\s+que\s+tengan|la\s+que\s+salga)/i
        .test(String(texto || '').trim());
}

/** El cliente eligió una hora concreta de las ofrecidas ("la de 15:30", "a las 4"). */
function horaElegidaEnTexto(texto, horasOfrecidas) {
    const t = String(texto || '').toLowerCase();
    const concreta = horaConcretaDelTexto(t);
    if (concreta && horasOfrecidas.includes(concreta)) return concreta;

    for (const h of horasOfrecidas) {
        const [hh, mm] = h.split(':');
        const hNum = Number(hh);
        const variantes = [
            h,
            `${hNum}:${mm}`,
            `${hNum}`,
            mm === '00' ? `${hNum}` : null
        ].filter(Boolean);
        for (const v of variantes) {
            if (new RegExp(`\\b(a\s+las\s+|las\s+|la\s+de\s+)?${v.replace('.', '\\.')}\\b`).test(t)) {
                return h;
            }
        }
    }
    return null;
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
                nombre_cliente: { type: 'string', description: 'Nombre del cliente si ya lo dijo; no inventes uno ni bloquees por no tenerlo.' }
            },
            required: ['servicio', 'fecha', 'hora']
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

    const zona = config.empresa.zona_horaria || 'America/Bogota';
    if (fecha < hoyEnZona(zona)) {
        return {
            exitoso: false,
            fechaPasada: true,
            mensaje: respuestaFechaPasada(estiloMod.estiloDe(config.empresa))
        };
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
        return { exitoso: true, slots: [], sinHoras: true, mensaje: motivo || `${relativo} ya no nos quedan horas.` };
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
                mensaje: `¡Tranquilo! Tu cita del ${formatearFechaCorta(citaVigente.fecha)} a las ${citaVigente.hora} ya está agendada. ¿Algo más en lo que te ayude?`
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

function guardarPending(conv, { empresaId, servicio, fecha, hora, trabajadorId, slots, modoOferta, horaOcupada }) {
    conv.pendingBooking = {
        empresaId,
        servicio: servicio.nombre,
        fecha,
        hora,
        trabajadorId,
        slotsOfrecidos: slots,
        modoOferta: modoOferta || 'lista',
        // Hora que el cliente pidió y estaba ocupada (solo en la oferta de
        // "la más cercana"): sirve para ofrecerle la lista de espera después.
        horaOcupada: horaOcupada || null,
        creadoEn: Date.now()
    };
}

/** "¿Tiene a las 09:00?" -> "09:00". Extrae la hora concreta que el cliente
 *  mencionó en su mensaje (la primera con formato HH:MM), o null si no hay. */
function horaConcretaDelTexto(texto) {
    const m = String(texto || '').match(/(\d{1,2}:\d{2})/);
    return m ? normalizarHora(m[1]) : null;
}

/** De los slots libres, el más cercano a la hora que el cliente pidió. */
function slotMasCercano(slots, hora) {
    const [h, min] = hora.split(':').map(Number);
    const objetivo = h * 60 + min;
    let mejor = null;
    let mejorDif = Infinity;
    for (const s of slots) {
        const [sh, smin] = s.hora.split(':').map(Number);
        const dif = Math.abs(sh * 60 + smin - objetivo);
        if (dif < mejorDif) { mejor = s; mejorDif = dif; }
    }
    return mejor;
}

function formatearOfertaSlots({ empresa, slots, trabajadores, servicio, fecha, userName, prefijo }) {
    const multiProfesional = trabajadores.length > 1;
    const zona = empresa?.zona_horaria || 'America/Bogota';
    const ofrecidos = slots.slice(0, 3);
    const lista = ofrecidos
        .map(s => (multiProfesional ? `• ${s.hora} con ${s.trabajador_nombre}` : `• ${s.hora}`))
        .join('\n');

    const fechaTexto = formatearFechaCercana(fecha, zona);
    const encabezado = estiloMod.aperturaOferta(servicio.nombre, fechaTexto);
    const nombreBit = estiloMod.sufijoPedirNombre(userName);
    const cabeza = prefijo ? `${prefijo}\n` : '';
    return `${cabeza}${encabezado}\n${lista}\n\n¿Te aparto alguno?${nombreBit}`;
}

function formatearOfertaDiaLleno({ empresa, fechaPedida, siguiente, userName }) {
    const zona = empresa?.zona_horaria || 'America/Bogota';
    const hoy = hoyEnZona(zona);
    const manana = sumarDias(hoy, 1);
    const ofrecidos = siguiente.slots.slice(0, 3);
    const horasTxt = ofrecidos.map(s => s.hora).join(', ');
    const nombreBit = estiloMod.sufijoPedirNombre(userName);

    let pref;
    if (fechaPedida === hoy) pref = 'Hoy ya no tengo';
    else if (fechaPedida === manana) pref = 'Mañana ya no tengo';
    else pref = `Ese día ya no tengo`;

    let cuando;
    if (siguiente.fecha === manana) {
        const nombreDia = new Intl.DateTimeFormat('es-CO', { weekday: 'long', timeZone: 'UTC' })
            .format(new Date(siguiente.fecha + 'T12:00:00Z'));
        cuando = `mañana ${nombreDia}`;
    } else if (siguiente.fecha === hoy) {
        cuando = 'hoy';
    } else {
        cuando = formatearFechaCercana(siguiente.fecha, zona);
    }

    return `${pref}; ${cuando} tengo ${horasTxt}, ¿te aparto alguna?${nombreBit}`;
}

function respuestaConfirmacion({ empresa, nombreCliente, servicio, fecha, hora, trabajador }) {
    const zona = empresa?.zona_horaria || 'America/Bogota';
    const plantilla = estiloMod.confirmacionEfectiva(empresa);
    let texto = estiloMod.aplicarConfirmacion(plantilla, {
        nombreCliente,
        servicio: servicio?.nombre || 'tu servicio',
        fecha: formatearFechaCercana(fecha, zona),
        hora,
        profesional: trabajador?.nombre || 'nuestro equipo',
        nombreNegocio: empresa?.nombre || 'nuestro negocio'
    });

    return texto;
}

// ============================================================
// Orquestación de tools
// ============================================================

async function procesarToolCall({ nombre, argsCrudos, config, bot, conv, telefonoCliente, userName, textoCliente }) {
    const args = parseArgsBrutos(argsCrudos);
    const nombreCliente = userName || null;

    if (nombre === 'ver_slots') {
        let resultado = await ejecutarVerSlots({ config, args });
        const servicio = servicioPorNombre(config.servicios, args.servicio);
        const zona = config.empresa.zona_horaria || 'America/Bogota';
        const fechaPedida = normalizarFecha(args.fecha);

        if (resultado.exitoso && (!resultado.slots || resultado.slots.length === 0) && servicio) {
            const oferta = await ofertas.ofrecerProntoOAlterna({
                config,
                servicio,
                fechaPedida,
                userName
            });
            if (oferta.pending) {
                guardarPending(conv, {
                    empresaId: oferta.pending.empresaId,
                    servicio: oferta.pending.servicio,
                    fecha: oferta.pending.fecha,
                    hora: oferta.pending.hora,
                    trabajadorId: oferta.pending.trabajadorId,
                    slots: oferta.pending.slots,
                    modoOferta: oferta.pending.modoOferta
                });
            }
            return oferta.respuesta;
        }

        if (resultado.exitoso && resultado.slots.length > 0) {
            let primerSlot = resultado.slots[0];
            let respuesta = null;
            const fechaTxt = formatearFechaCercana(resultado.fecha, zona);
            let modoOferta = 'lista';
            const nombreBit = estiloMod.sufijoPedirNombre(userName);
            let horaOcupada = null;

            const horaPedida = horaConcretaDelTexto(textoCliente);
            if (horaPedida) {
                const exacto = resultado.slots.find(s => s.hora === horaPedida);
                if (exacto) {
                    primerSlot = exacto;
                    modoOferta = 'unica';
                    respuesta = `Sí, a las ${horaPedida} hay espacio para ${servicio.nombre} ${fechaTxt}. ¿Te la aparto?${nombreBit}`;
                } else {
                    const cercano = slotMasCercano(resultado.slots, horaPedida);
                    if (cercano) {
                        primerSlot = cercano;
                        modoOferta = 'unica';
                        respuesta = `A las ${horaPedida} ya está reservada; la más cercana libre es a las ${cercano.hora}. ¿Te la aparto?${nombreBit}`;
                        horaOcupada = horaPedida;
                    }
                }
            }

            if (!respuesta) {
                respuesta = ofertas.formatearOfertaSlots({
                    empresa: config.empresa,
                    slots: resultado.slots,
                    trabajadores: resultado.trabajadores,
                    servicio,
                    fecha: resultado.fecha,
                    userName
                });
                modoOferta = 'lista';
            }

            guardarPending(conv, {
                empresaId: config.empresa.id,
                servicio,
                fecha: resultado.fecha,
                hora: primerSlot.hora,
                trabajadorId: primerSlot.trabajador_id,
                slots: modoOferta === 'unica'
                    ? [`${primerSlot.trabajador_id}|${primerSlot.hora}`]
                    : resultado.slots.slice(0, 3).map(s => `${s.trabajador_id}|${s.hora}`),
                modoOferta,
                horaOcupada
            });

            return respuesta;
        }

        if (resultado.fechaPasada) return resultado.mensaje;

        const motivo = String(resultado.mensaje || '');
        const esTecnico = /calendar|calendario|token|panel|base de datos/i.test(motivo);
        return esTecnico
            ? 'Ahora mismo no tengo horarios disponibles.'
            : (motivo.replace(/¿Te ofrezco otro día\?/gi, '').trim() || 'No encontré horarios disponibles en los próximos días.');
    }

    if (nombre === 'agendar_cita') {
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

        // Lista de espera: agendó una alternativa porque la hora que pidió
        // estaba ocupada. Se le ofrece quedar en lista por si la hora
        // original se libera (el SÍ/NO lo resuelve manejarRespuestaOferta).
        let extraLista = '';
        if (pendiente?.horaOcupada && pendiente.horaOcupada !== resultado.hora) {
            conv.pendingOferta = {
                tipo: 'pregunta',
                fecha: pendiente.fecha,
                horaDeseada: pendiente.horaOcupada,
                servicioId: resultado.servicio?.id || null,
                trabajadorId: resultado.trabajador?.id || null,
                creadoEn: Date.now(),
                expira: Date.now() + listaEspera.TTL_PREGUNTA_MS
            };
            extraLista = `\n\n¿Te dejo en la lista por si se libera la de las ${pendiente.horaOcupada}? Te escribo apenas se libre.`;
        }

        memoria.guardar({
            empresaId: config.empresa.id,
            telefono: telefonoCliente,
            bsuid: conv?.bsuid || null,
            nombre: nombreCliente,
            servicio: resultado.servicio?.nombre,
            profesional: resultado.trabajador?.nombre
        }).catch(() => {});

        return respuestaConfirmacion({
            empresa: config.empresa,
            nombreCliente,
            servicio: resultado.servicio,
            fecha: resultado.fecha,
            hora: resultado.hora,
            trabajador: resultado.trabajador,
        }) + extraLista;
    }

    if (nombre === 'cancelar_cita') {
        const resultado = await ejecutarCancelar({ config, telefonoCliente, conv });

        if (resultado.exitoso) conv.ultimaCita = null;

        return resultado.exitoso
            ? `Listo${nombreCliente ? ` ${nombreCliente}` : ''}, tu cita del ${formatearFechaCorta(resultado.cita.fecha)} a las ${resultado.cita.hora} quedó cancelada. ¿Te agendo otra?`
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
            memoria.guardar({
                empresaId: config.empresa.id,
                telefono: telefonoCliente,
                bsuid: conv?.bsuid || null,
                nombre: nombreCliente,
                servicio: resultado.cita.nombre_servicio,
                profesional: resultado.cita.trabajadores?.nombre || null
            }).catch(() => {});
        }

        const zonaMod = config.empresa.zona_horaria || 'America/Bogota';
        const fechaMov = formatearFechaCercana(resultado.cita.fecha, zonaMod);
        const fechaMovTxt = fechaMov.startsWith('el ') ? `al ${fechaMov.slice(3)}` : fechaMov;
        return resultado.exitoso
            ? `Listo${nombreCliente ? ` ${nombreCliente}` : ''}, tu cita se movió ${fechaMovTxt} a las ${resultado.cita.hora}.`
            : `No pude moverla: ${resultado.mensaje}`;

    }

    conv.fallosEntendimiento = (conv.fallosEntendimiento || 0) + 1;
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
// Lista de espera: SÍ/NO de la pregunta ("¿te dejo en la lista?")
// y de la oferta de hueco liberado ("se liberó la cita que querías").
// ============================================================

function leerPendingOferta(conv) {
    const p = conv.pendingOferta;
    if (!p || !p.tipo) return null;
    if (p.expira && Date.now() > Number(p.expira)) {
        conv.pendingOferta = null;
        return null;
    }
    return p;
}

// Detectores más anchos que los del flujo de reserva: aquí el cliente
// acaba de recibir una pregunta de sí/no, así que "sí, déjame en la
// lista" o "no gracias" también cuentan (esConfirmacionAfirmativa
// estricta los dejaría caer al modelo, que no conoce la oferta).
// Ojo: (?![a-z0-9]) y no \b — tras "í" el \b no funciona en JS.
function respuestaListaAfirmativa(texto) {
    return /^(s[ií]|si|claro|dale|ok|okey|va|de una|listo|perfecto|ap[úu]ntame|an[óo]tame|d[eé]jame)(?![a-z0-9])/i
        .test(String(texto || '').trim())
        && !respuestaListaNegativa(texto);
}

function respuestaListaNegativa(texto) {
    return /^(no|nop|nel|mejor no|ahora no|nada)(?![a-z0-9])/i
        .test(String(texto || '').trim());
}

async function manejarRespuestaOferta({ texto, conv, config, telefonoCliente }) {
    const pendiente = leerPendingOferta(conv);
    if (!pendiente) return null;

    // La pregunta llega pegada a la confirmación de la cita: el cliente
    // responde si quiere quedar en lista por la hora ocupada que pidió.
    if (pendiente.tipo === 'pregunta') {
        if (respuestaListaAfirmativa(texto)) {
            const fila = await listaEspera.registrar({
                empresaId: config.empresa.id,
                servicioId: pendiente.servicioId || null,
                trabajadorId: pendiente.trabajadorId || null,
                fecha: pendiente.fecha,
                horaDeseada: pendiente.horaDeseada,
                telefonoCliente,
                nombreCliente: conv.userName || null
            });
            conv.pendingOferta = null;
            if (!fila) return null;

            const fechaTxt = formatearFechaCercana(pendiente.fecha, config.empresa.zona_horaria || 'America/Bogota');
            return `Listo, quedas en la lista por si se libera la del ${fechaTxt} a las ${pendiente.horaDeseada}. Te escribo apenas se libre.`;
        }
        if (respuestaListaNegativa(texto)) {
            conv.pendingOferta = null;
            return 'Va, sin problema.';
        }
        return null;
    }

    // La oferta: avisamos que se liberó el turno que quería.
    if (pendiente.tipo === 'oferta') {
        if (respuestaListaAfirmativa(texto)) {
            const r = await listaEspera.confirmarOferta({ conv, config, telefonoCliente });
            if (!r.exitoso) return r.mensaje;

            const fechaTxt = formatearFechaCercana(r.fecha, config.empresa.zona_horaria || 'America/Bogota');
            return `¡Listo! Te aparté la cita: ${r.servicio || 'tu servicio'} ${fechaTxt} a las ${r.hora} con ${r.profesional || 'nuestro equipo'}. Te esperamos.`;
        }
        if (respuestaListaNegativa(texto)) {
            await listaEspera.rechazarOferta({ conv, config });
            return 'Va, no hay problema. ¿Te agendo otra hora?';
        }
        return null;
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
        ? `Hay una propuesta sin confirmar: ${conv.pendingBooking.servicio} el ${conv.pendingBooking.fecha} a las ${conv.pendingBooking.hora} (modo ${conv.pendingBooking.modoOferta || 'lista'}). Si acepta una sola hora inequívoca, agenda esa.`
        : '';

    const nombres = config.servicios.map(s => s.nombre).join(', ') || 'ninguno';
    const reglasNegocio = config.empresa?.prompt_base?.trim();

    return `Eres el asistente de WhatsApp de "${config.empresa.nombre}".
${userName
        ? `El cliente se llama "${userName}".`
        : 'No sabes el nombre del cliente: no lo inventes ni uses motes; si te lo dice, úsalo. No bloquees el agendamiento por no tener nombre.'}

${estiloMod.textoPersonalidadComun()}

${estiloMod.textoEstiloParaPrompt(config.empresa)}

HOY
Hoy es ${formatearFechaLarga(hoy)} (${hoy}). Mañana es ${formatearFechaLarga(manana)} (${manana}).
Zona horaria: ${zona}. Di fechas cercanas como "hoy", "mañana" o "el martes"; sin año.

SERVICIOS (solo estos, con estos precios y duraciones; NUNCA inventes precios ni servicios)
${textoServicios(config.servicios, config.empresa)}

CONTEXTO
${contextoCita}
${pendiente}
${reglasNegocio ? `\nREGLAS DE NEGOCIO DE LA EMPRESA (nunca pisan las innegociables ni el estilo):\n${reglasNegocio}\n` : ''}
REGLAS INNEGOCIABLES
1. Responde primero lo que preguntaron. Una sola pregunta por mensaje. Texto plano.
2. Servicios válidos: ${nombres}. Si pide algo fuera de la lista, dilo y ofrece lo más parecido. Nunca inventes precio.
3. Flujo de reserva: ver_slots → el cliente elige → agendar_cita. Jamás agendes una hora que no vino de ver_slots.
4. Si hay una sola hora pendiente y el cliente acepta, agéndala sin relistar. Si ofresciste varias y responde ambiguo ("ok sí"), pregunta cuál. No hace falta el nombre para agendar.
5. Tras confirmar, no reagendes. Gracias o despedida: sin herramientas, respuesta breve.
6. Fecha pasada: no llames ver_slots; el sistema ya la corta. Ofrece hoy o mañana.
7. Cancelar → cancelar_cita. Mover cita existente → modificar_cita (nunca agendar encima).
8. Si preguntan si eres un bot, dilo con honestidad: eres el asistente virtual del negocio.
9. Si piden hablar con una persona, indícalo; el sistema avisará al dueño.`;
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

            const response = await llamarGroq({
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
        if (conv.botPausado) {
            console.log(`⏸️  Bot pausado en chat ${destinoEnvio}; mensaje ignorado.`);
            return;
        }

        const estiloEmp = estiloMod.estiloDe(cfg.empresa);

        if (preguntaSiEsBot(texto)) {
            await enviar(estiloMod.respuestaEresUnBot(cfg.empresa));
            await persistir();
            return;
        }

        if (pideHablarConHumano(texto)) {
            conv.botPausado = true;
            notificaciones.avisarDueno({
                empresa: cfg.empresa,
                tipo: 'escalamiento',
                texto: `🙋 ${conv.userName || tel || destinoEnvio} pide hablar con una persona.`
            }).catch(() => {});
            await enviar(estiloEmp.tratamiento === 'usted'
                ? 'Claro, ya avisé al equipo para que le escriban por aquí.'
                : 'Claro, ya avisé al equipo para que te escriban por aquí.');
            await persistir();
            return;
        }

        let nombreRecien = false;
        if (!conv.userName) {
            const nombre = await extraerNombre(texto);
            if (nombre) {
                conv.userName = nombre;
                nombreRecien = true;
            }
        }

        if (pideFechaPasada(texto, zona)) {
            await enviar(respuestaFechaPasada(estiloEmp));
            await persistir();
            return;
        }

        const esPrimera = conversaciones.esPrimeraConversacion({
            userName: conv.userName,
            mensajes: conv.mensajes.slice(0, -1)
        });

        if (esPrimera && mensajeEsSoloSaludo(texto)) {
            let saludo = null;
            const mem = await memoria.obtener({
                empresaId: cfg.empresa.id,
                telefono: tel,
                bsuid: conv.bsuid || null
            });
            if (mem?.nombre) {
                if (!conv.userName) conv.userName = mem.nombre;
                saludo = memoria.saludoRecurrente({
                    estilo: estiloEmp,
                    nombre: mem.nombre,
                    servicio: mem.ultimo_servicio,
                    profesional: mem.ultimo_profesional,
                    tratamiento: estiloEmp.tratamiento
                });
            }
            if (!saludo) saludo = estiloMod.saludoEfectivo(cfg.empresa);

            await enviar(saludo);
            await persistir();
            return;
        }

        const userName = conv.userName || null;

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

        // Loop cerrado de lista de espera (pregunta del cliente y oferta
        // de un hueco que se liberó). Antes del pending de reserva: el
        // "sí" no puede chocar con una reserva pendiente.
        const respOferta = await manejarRespuestaOferta({
            texto,
            conv,
            config: cfg,
            telefonoCliente: tel
        });
        if (respOferta) {
            await enviar(respOferta);
            await persistir();
            return;
        }

        const pendiente = leerPending(conv);

        const cortesia = !pendiente ? clasificarCortesia(texto) : null;
        if (cortesia === 'gracias') {
            await enviar(estiloMod.respuestaGracias());
            await persistir();
            return;
        }
        if (cortesia === 'despedida') {
            await enviar(estiloMod.respuestaDespedida(userName || conv.userName || null));
            await persistir();
            return;
        }

        if (pendiente && !esNegacion(texto)) {
            const horas = horasUnicasOfrecidas(pendiente);
            const horaElegida = horaElegidaEnTexto(texto, horas);
            const aceptaPrimera = aceptaLaPrimeraOferta(texto);
            const afirmativa = esConfirmacionAfirmativa(texto);
            const ofertaUnica = pendiente.modoOferta === 'unica' || horas.length <= 1;

            if (horaElegida || aceptaPrimera || (afirmativa && ofertaUnica)) {
                if (horaElegida) {
                    const elegido = pendiente.slotsOfrecidos?.find(s => s.endsWith(`|${horaElegida}`));
                    if (elegido) {
                        pendiente.hora = horaElegida;
                        pendiente.trabajadorId = elegido.split('|')[0];
                    } else {
                        pendiente.hora = horaElegida;
                    }
                }

                let mover = false;
                if (conv.ultimaCita
                    && (conv.ultimaCita.fecha !== pendiente.fecha || conv.ultimaCita.hora !== pendiente.hora)) {
                    const vigente = await calendar.citaVigente({
                        empresa: cfg.empresa,
                        telefonoCliente: tel,
                        bsuid: conv?.bsuid || null
                    });
                    mover = Boolean(vigente)
                        && (vigente.fecha !== pendiente.fecha || vigente.hora !== pendiente.hora);
                }

                const respuesta = await procesarToolCall({
                    nombre: mover ? 'modificar_cita' : 'agendar_cita',
                    argsCrudos: mover
                        ? { nueva_fecha: pendiente.fecha, nueva_hora: pendiente.hora }
                        : { hora: pendiente.hora },
                    config: cfg,
                    conv,
                    telefonoCliente: tel,
                    userName,
                    textoCliente: texto
                });
                await enviar(respuesta);
                await persistir();
                return;
            }

            if (afirmativa && !ofertaUnica) {
                await enviar(repreguntarHora(horas));
                await persistir();
                return;
            }
        }

        if (pendiente && esNegacion(texto)) {
            conv.pendingBooking = null;
            await enviar('Va, no te aparto nada. ¿Buscamos otro horario?');
            await persistir();
            return;
        }

        if (ofertas.pideLoMasPronto(texto) && !leerPending(conv)) {
            const servicioPronto = cfg.servicios[0] || null;
            if (servicioPronto) {
                const oferta = await ofertas.ofrecerProntoOAlterna({
                    config: cfg,
                    servicio: servicioPronto,
                    fechaPedida: hoyEnZona(zona),
                    userName
                });
                if (oferta.pending) {
                    guardarPending(conv, {
                        empresaId: oferta.pending.empresaId,
                        servicio: oferta.pending.servicio,
                        fecha: oferta.pending.fecha,
                        hora: oferta.pending.hora,
                        trabajadorId: oferta.pending.trabajadorId,
                        slots: oferta.pending.slots,
                        modoOferta: oferta.pending.modoOferta
                    });
                }
                await enviar(oferta.respuesta);
                await persistir();
                return;
            }
        }

        const mensajes = [
            { role: 'system', content: construirPrompt({ config: cfg, conv, userName, zona }) },
            ...conv.mensajes.map(m => ({ role: m.role, content: m.content }))
        ];

        const response = await llamarGroq({
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
                userName,
                textoCliente: texto
            });
            conv.fallosEntendimiento = 0;
        } else {
            respuestaFinal = limpiarTexto(salida.content);
            if (!respuestaFinal || /no (pude|logré) entender|me lo repites/i.test(respuestaFinal)) {
                conv.fallosEntendimiento = (conv.fallosEntendimiento || 0) + 1;
                if (!respuestaFinal) respuestaFinal = '¿Me lo repites?';
            } else {
                conv.fallosEntendimiento = 0;
            }
        }

        if ((conv.fallosEntendimiento || 0) >= 2) {
            conv.botPausado = true;
            notificaciones.avisarDueno({
                empresa: cfg.empresa,
                tipo: 'escalamiento',
                texto: `⚠️ ${userName || tel || destinoEnvio}: el bot no entendió 2 veces seguidas.`
            }).catch(() => {});
            respuestaFinal = estiloEmp.tratamiento === 'usted'
                ? 'Disculpe, mejor le paso con alguien del equipo. Ya les avisé.'
                : 'Uy, mejor te paso con alguien del equipo. Ya les avisé.';
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
        const response = await llamarGroq({
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

module.exports = { iniciar, procesarMensajeWhatsapp, limpiarCacheConfiguracion, sembrarConfigConOverrides };
