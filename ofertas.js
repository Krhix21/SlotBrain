const {
    formatearFechaCercana,
    hoyEnZona,
    sumarDias
} = require('./tiempo');
const estiloMod = require('./estilo');
const disponibilidad = require('./disponibilidad');

function pideLoMasPronto(texto) {
    const t = String(texto || '');
    if (/\b(hoy|mañana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|\d{1,2}\s+de\s+|\d{4}-\d{2}-\d{2})\b/i.test(t)) {
        return false;
    }
    return /\b(lo m[aá]s pronto|lo antes|cuanto antes|la m[aá]s cercana|primera que (tenga|haya|puedas)|lo que (tengan|haya))\b/i
        .test(t);
}

function formatearOfertaSlots({ empresa, slots, trabajadores, servicio, fecha, userName, prefijo }) {
    const multiProfesional = (trabajadores || []).length > 1;
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
    else pref = 'Ese día ya no tengo';

    let cuando;
    if (siguiente.fecha === manana) {
        const nombreDia = new Intl.DateTimeFormat('es-CO', { weekday: 'long', timeZone: 'UTC' })
            .format(new Date(`${siguiente.fecha}T12:00:00Z`));
        cuando = `mañana ${nombreDia}`;
    } else if (siguiente.fecha === hoy) {
        cuando = 'hoy';
    } else {
        cuando = formatearFechaCercana(siguiente.fecha, zona);
    }

    return `${pref}; ${cuando} tengo ${horasTxt}, ¿te aparto alguna?${nombreBit}`;
}

async function ofrecerProntoOAlterna({ config, servicio, fechaPedida, userName }) {
    const zona = config.empresa.zona_horaria || 'America/Bogota';
    const hoy = hoyEnZona(zona);
    const desde = fechaPedida && fechaPedida >= hoy ? fechaPedida : hoy;

    let hallado = await disponibilidad.buscarPrimerDiaConSlots({
        empresa: config.empresa,
        servicios: config.servicios,
        servicio,
        desdeFecha: desde,
        maxDias: 14
    });

    if ((!hallado.fecha || !hallado.slots.length) && desde !== hoy) {
        hallado = await disponibilidad.buscarPrimerDiaConSlots({
            empresa: config.empresa,
            servicios: config.servicios,
            servicio,
            desdeFecha: hoy,
            maxDias: 14
        });
    }

    if (!hallado.fecha || !hallado.slots.length) {
        return { respuesta: 'No encontré horarios libres en los próximos días.', pending: null };
    }

    const primerSlot = hallado.slots[0];
    const diaAlterno = Boolean(fechaPedida && hallado.fecha !== fechaPedida);

    let respuesta;
    if (diaAlterno) {
        respuesta = formatearOfertaDiaLleno({
            empresa: config.empresa,
            fechaPedida: fechaPedida || hoy,
            siguiente: hallado,
            userName
        });
    } else {
        respuesta = formatearOfertaSlots({
            empresa: config.empresa,
            slots: hallado.slots,
            trabajadores: hallado.trabajadores,
            servicio,
            fecha: hallado.fecha,
            userName
        });
    }

    return {
        respuesta,
        pending: {
            empresaId: config.empresa.id,
            servicio,
            fecha: hallado.fecha,
            hora: primerSlot.hora,
            trabajadorId: primerSlot.trabajador_id,
            slots: hallado.slots.slice(0, 3).map(s => `${s.trabajador_id}|${s.hora}`),
            modoOferta: 'lista'
        }
    };
}

module.exports = {
    pideLoMasPronto,
    formatearOfertaSlots,
    formatearOfertaDiaLleno,
    ofrecerProntoOAlterna
};
