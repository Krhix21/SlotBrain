// ============================================================
// Estilo conversacional por empresa (NO es la voz TTS clonada).
//
// Opciones CERRADAS + defaults buenos. El prompt del modelo se
// arma desde estos enums; no se deja tono en texto libre.
// ============================================================

const ESTILO_DEFAULT = {
    nombre_asistente: null,
    tratamiento: 'tu',
    emojis: 'pocos',
    tono: 'neutro',
    vocabulario_cita: 'cita',
    vocabulario_profesional: null
};

const TRATAMIENTOS = new Set(['tu', 'usted']);
const EMOJIS = new Set(['ninguno', 'pocos', 'normal']);
const TONOS = new Set(['casual', 'neutro', 'formal']);
const VOCAB_CITA = new Set(['cita', 'turno', 'reserva']);

const TERMINOLOGIA_DEFAULT = {
    servicio_singular: 'servicio',
    servicio_plural: 'servicios',
    profesional_singular: 'profesional',
    profesional_plural: 'profesionales'
};

function terminologiaDe(empresa) {
    const t = (empresa && typeof empresa.terminologia === 'object' && empresa.terminologia) || {};
    return { ...TERMINOLOGIA_DEFAULT, ...t };
}

function estiloDe(empresa) {
    const crudo = (empresa && typeof empresa.estilo === 'object' && empresa.estilo) || {};
    const estilo = { ...ESTILO_DEFAULT, ...crudo };

    if (!TRATAMIENTOS.has(estilo.tratamiento)) estilo.tratamiento = ESTILO_DEFAULT.tratamiento;
    if (!EMOJIS.has(estilo.emojis)) estilo.emojis = ESTILO_DEFAULT.emojis;
    if (!TONOS.has(estilo.tono)) estilo.tono = ESTILO_DEFAULT.tono;
    if (!VOCAB_CITA.has(estilo.vocabulario_cita)) estilo.vocabulario_cita = ESTILO_DEFAULT.vocabulario_cita;

    const term = terminologiaDe(empresa);
    if (!estilo.vocabulario_profesional) {
        estilo.vocabulario_profesional = term.profesional_singular || 'profesional';
    }

    return estilo;
}

/** Personalidad base, igual para todas las empresas. */
function textoPersonalidadComun() {
    return `PERSONALIDAD (igual en todo SlotBrain)
- Mensajes de 1 a 3 líneas. Contesta primero lo que el cliente preguntó.
- No repitas lo que ya confirmaste en un mensaje anterior.
- No uses "amigo", "amiga" ni motes. Una sola pregunta por mensaje.
- Sin listas largas ni markdown (nada de asteriscos). Texto plano de WhatsApp.`;
}

function textoEstiloParaPrompt(empresa) {
    const e = estiloDe(empresa);
    const term = terminologiaDe(empresa);
    const cita = e.vocabulario_cita;
    const quien = e.vocabulario_profesional || term.profesional_singular;

    const trato = e.tratamiento === 'usted'
        ? 'Tratas de usted (formal, respetuoso).'
        : 'Tratas de tú (cercano, natural).';

    const emojis = e.emojis === 'ninguno'
        ? 'Sin emojis.'
        : e.emojis === 'normal'
            ? 'Puedes usar emojis con naturalidad, sin saturar.'
            : 'Como máximo un emoji por mensaje, solo si encaja.';

    const tono = e.tono === 'casual'
        ? 'Tono casual, como un compañero del negocio.'
        : e.tono === 'formal'
            ? 'Tono formal y profesional, sin ser frío.'
            : 'Tono neutro y amable, de recepcionista real.';

    const nombre = e.nombre_asistente
        ? `Te presentas solo si te preguntan quién eres: eres ${e.nombre_asistente}, asistente de WhatsApp del negocio.`
        : 'No te inventes un nombre propio; eres el asistente de WhatsApp del negocio.';

    return `VOZ DEL NEGOCIO
${trato}
${emojis}
${tono}
${nombre}
Vocabulario: lo que se agenda es una "${cita}"; quien atiende es un "${quien}" (plural: ${term.profesional_plural}).
Lo que se vende es un ${term.servicio_singular} (${term.servicio_plural} en lista).`;
}

const PLANTILLA_BIENVENIDA_LEGACY = /asesor virtual|c[oó]mo te llamas|c[oó]mo se llama/i;
const PLANTILLA_CONFIRMACION_DEFAULT = /Tu cita de \{servicio\} qued[oó] agendada/i;

function esPlantillaBienvenidaLegacy(texto) {
    if (!texto || !String(texto).trim()) return true;
    return PLANTILLA_BIENVENIDA_LEGACY.test(texto);
}

function esPlantillaConfirmacionVacia(texto) {
    if (!texto || !String(texto).trim()) return true;
    return false;
}

function generarSaludo(empresa) {
    const e = estiloDe(empresa);
    const nombre = empresa?.nombre || 'nuestro negocio';
    const emoji = e.emojis === 'ninguno' ? '' : ' 👋';

    if (e.tratamiento === 'usted') {
        if (e.tono === 'formal') {
            return `Buenos días${emoji} Bienvenido a ${nombre}. ¿En qué podemos ayudarle?`;
        }
        return `¡Hola!${emoji} Bienvenido a ${nombre}. ¿En qué le puedo ayudar?`;
    }

    if (e.tono === 'casual') {
        return `¡Hola!${emoji} Bienvenido a ${nombre}. ¿Qué necesitas?`;
    }

    return `¡Hola!${emoji} Bienvenido a ${nombre}. ¿En qué te puedo ayudar?`;
}

function generarConfirmacion(empresa) {
    const e = estiloDe(empresa);
    const cita = e.vocabulario_cita;
    const quien = e.vocabulario_profesional || 'nuestro equipo';

    if (e.tratamiento === 'usted') {
        return `Listo{nombre}. Su ${cita} de {servicio} quedó para {fecha} a las {hora} con {profesional}. Le esperamos.`;
    }

    if (e.tono === 'casual') {
        return `¡Listo{nombre}! Tu ${cita} de {servicio} quedó {fecha} a las {hora} con {profesional}. ¡Te esperamos!`;
    }

    return `¡Listo{nombre}! Tu ${cita} de {servicio} quedó agendada para {fecha} a las {hora} con {profesional}. Te esperamos.`;
}

function saludoEfectivo(empresa) {
    const guardado = empresa?.mensaje_bienvenida;
    if (esPlantillaBienvenidaLegacy(guardado)) return generarSaludo(empresa);
    return String(guardado).replace('{nombre_negocio}', empresa?.nombre || 'nuestro negocio');
}

function confirmacionEfectiva(empresa) {
    const guardado = empresa?.mensaje_confirmacion;
    if (esPlantillaConfirmacionVacia(guardado)) return generarConfirmacion(empresa);
    return guardado;
}

function aplicarConfirmacion(plantilla, { nombreCliente, servicio, fecha, hora, profesional, nombreNegocio }) {
    const nombreBit = nombreCliente ? ` ${nombreCliente}` : '';
    return String(plantilla || '')
        .replace('{nombre}', nombreBit)
        .replace(' !', '!')
        .replace('{servicio}', servicio || 'tu servicio')
        .replace('{fecha}', fecha)
        .replace('{hora}', hora)
        .replace('{profesional}', profesional || 'nuestro equipo')
        .replace('{nombre_negocio}', nombreNegocio || 'nuestro negocio')
        .replace(/\s{2,}/g, ' ')
        .replace(/\bel el\b/gi, 'el')
        .replace(/\bpara el (hoy|mañana)\b/gi, 'para $1')
        .trim();
}

const APERTURAS_OFERTA = [
    (s, f) => `Para ${s} ${f} tengo estos horarios:`,
    (s, f) => `Mira, ${f} para ${s} me cuadran:`,
    (s, f) => `Estos horarios tengo ${f} para ${s}:`,
    (s, f) => `${f.charAt(0).toUpperCase() + f.slice(1)} para ${s} puedo ofrecerte:`,
    (s, f) => `Lo que tengo libre ${f} para ${s}:`,
    (s, f) => `Te muestro lo disponible ${f} para ${s}:`
];

function aperturaOferta(servicioNombre, fechaTexto) {
    const i = Math.floor(Math.random() * APERTURAS_OFERTA.length);
    return APERTURAS_OFERTA[i](servicioNombre, fechaTexto);
}

const RESPUESTAS_GRACIAS = [
    '¡De nada!',
    'Con gusto',
    '¡Un placer!'
];

function respuestaGracias() {
    return RESPUESTAS_GRACIAS[Math.floor(Math.random() * RESPUESTAS_GRACIAS.length)];
}

function respuestaDespedida(nombre) {
    if (nombre) {
        const conNombre = [
            `¡Hasta luego, ${nombre}!`,
            `¡Que tengas un buen día, ${nombre}!`
        ];
        return conNombre[Math.floor(Math.random() * conNombre.length)];
    }
    const sinNombre = [
        '¡Hasta luego!',
        '¡Que tengas un buen día!'
    ];
    return sinNombre[Math.floor(Math.random() * sinNombre.length)];
}

function sufijoPedirNombre(userName) {
    if (userName) return '';
    return ' ¿A nombre de quién?';
}

function respuestaEresUnBot(empresa) {
    const nombre = empresa?.nombre || 'este negocio';
    const e = estiloDe(empresa);
    if (e.tratamiento === 'usted') {
        return `Sí, soy el asistente virtual de ${nombre}. Puedo ayudarle a agendar; si prefiere una persona, dígamelo y aviso al equipo.`;
    }
    return `Sí, soy el asistente virtual de ${nombre}. Te ayudo a agendar; si quieres hablar con alguien del equipo, dímelo y les aviso.`;
}

module.exports = {
    ESTILO_DEFAULT,
    terminologiaDe,
    estiloDe,
    textoPersonalidadComun,
    textoEstiloParaPrompt,
    generarSaludo,
    generarConfirmacion,
    saludoEfectivo,
    confirmacionEfectiva,
    aplicarConfirmacion,
    aperturaOferta,
    respuestaGracias,
    respuestaDespedida,
    sufijoPedirNombre,
    respuestaEresUnBot,
    esPlantillaBienvenidaLegacy
};
