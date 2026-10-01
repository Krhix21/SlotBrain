// ============================================================
// Helpers de fecha, hora y zona horaria.
//
// Nada de offsets fijos a mano: el código anterior usaba
// `offset = '-05:00'` para Bogotá y `'+00:00'` para todo lo demás,
// lo que dejaba a México, Lima o Madrid 5 horas corridas.
// Acá se resuelve con IANA (`America/Bogota`, `America/Mexico_City`, ...)
// usando las tablas de la IANA que trae Node, incluyendo el horario de verano.
// ============================================================

const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

/** Horario por defecto si la empresa no define uno. */
const HORARIO_POR_DEFECTO = {
    lun: [['09:00', '18:00']],
    mar: [['09:00', '18:00']],
    mie: [['09:00', '18:00']],
    jue: [['09:00', '18:00']],
    vie: [['09:00', '18:00']],
    sab: [['09:00', '14:00']],
    dom: []
};

const ZONA_POR_DEFECTO = 'America/Bogota';

/** "HH:MM" -> minutos desde medianoche. */
function minutosDesdeHora(hhmm) {
    const [h, m] = String(hhmm || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

/** Minutos desde medianoche -> "HH:MM". */
function horaDesdeMinutos(minutos) {
    const m = ((minutos % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "2026-09-28" -> "lun" */
function claveDiaSemana(fechaISO) {
    const [a, m, d] = String(fechaISO).split('-').map(Number);
    // Mediodía UTC: no importa en qué zona se lea, el día no cambia.
    const fecha = new Date(Date.UTC(a, m - 1, d, 12));
    return DIAS_SEMANA[fecha.getUTCDay()];
}

/** Suma días a un "YYYY-MM-DD" y devuelve otro "YYYY-MM-DD". */
function sumarDias(fechaISO, dias) {
    const [a, m, d] = String(fechaISO).split('-').map(Number);
    const fecha = new Date(Date.UTC(a, m - 1, d, 12));
    fecha.setUTCDate(fecha.getUTCDate() + dias);
    return fecha.toISOString().slice(0, 10);
}

/** El "YYYY-MM-DD" de hoy según la zona horaria de la empresa. */
function hoyEnZona(timeZone) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: timeZone || ZONA_POR_DEFECTO,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

/** Hora actual "HH:MM" en la zona de la empresa. */
function horaAhoraEnZona(timeZone) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: timeZone || ZONA_POR_DEFECTO,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(new Date());
}

/**
 * Convierte una hora de pared ("2026-09-28" + "10:00") en el instante
 * UTC real de esa zona, respetando el horario de verano.
 *
 * Truco: se parte de "10:00" tratado como UTC y se corrige el desfase
 * dos veces. La segunda pasada estabiliza el resultado.
 */
function zonedToUtc(fechaISO, hora, timeZone) {
    const [a, m, d] = String(fechaISO).split('-').map(Number);
    const [h, min] = String(hora).split(':').map(Number);

    const naive = Date.UTC(a, m - 1, d, h || 0, min || 0);
    let instante = naive;

    for (let i = 0; i < 2; i++) {
        const partes = new Intl.DateTimeFormat('en-US', {
            timeZone: timeZone || ZONA_POR_DEFECTO,
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).formatToParts(new Date(instante));

        const p = {};
        for (const parte of partes) p[parte.type] = parte.value;

        const comoUtc = Date.UTC(
            Number(p.year),
            Number(p.month) - 1,
            Number(p.day),
            Number(p.hour) % 24,
            Number(p.minute)
        );

        instante += naive - comoUtc;
    }

    return new Date(instante);
}

/** "2026-09-28" -> "28 de septiembre de 2026" */
function formatearFechaLarga(fechaISO) {
    const [a, m, d] = String(fechaISO).split('-').map(Number);
    const fecha = new Date(Date.UTC(a, m - 1, d, 12));

    return new Intl.DateTimeFormat('es-CO', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
    }).format(fecha);
}

/** "2026-09-28" -> "28/09/2026" */
function formatearFechaCorta(fechaISO) {
    const [a, m, d] = String(fechaISO).split('-');
    return `${d}/${m}/${a}`;
}

/** "¿10:00" -> true si es una hora con formato HH:MM */
function esHoraValida(hora) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(hora || ''));
}

/**
 * Normaliza lo que devuelve el modelo a "HH:MM".
 * Los modelos escriben "9:00" o "9:00 AM" con la misma frecuencia que
 * "09:00", así que se corrige en la frontera en lugar de confiar en él.
 * @returns {string|null} "HH:MM" o null si no se entiende
 */
function normalizarHora(hora) {
    if (hora === null || hora === undefined) return null;

    const texto = String(hora).trim().toLowerCase().replace(/\./g, '');

    // "9:00 am" / "9am" / "3 pm"  (los puntos ya se quitaron arriba)
    const conMomento = texto.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (conMomento && conMomento[3]) {
        let h = Number(conMomento[1]);
        const m = conMomento[2] || '00';
        if (conMomento[3].startsWith('p') && h < 12) h += 12;
        if (conMomento[3].startsWith('a') && h === 12) h = 0;
        if (h > 23) return null;
        return `${String(h).padStart(2, '0')}:${m}`;
    }

    // "9:00" / "09:00" / "0900" / "9"
    const simple = texto.match(/^(\d{1,2})(?::?(\d{2}))?$/);
    if (simple) {
        const h = Number(simple[1]);
        const m = simple[2] || '00';
        if (h > 23 || Number(m) > 59) return null;
        return `${String(h).padStart(2, '0')}:${m}`;
    }

    return null;
}

/** "¿2026-09-28?" -> true */
function esFechaValida(fecha) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) return false;

    const [a, m, d] = fecha.split('-').map(Number);
    const fechaReal = new Date(Date.UTC(a, m - 1, d, 12));
    return fechaReal.getUTCFullYear() === a
        && fechaReal.getUTCMonth() === m - 1
        && fechaReal.getUTCDate() === d;
}

module.exports = {
    DIAS_SEMANA,
    HORARIO_POR_DEFECTO,
    ZONA_POR_DEFECTO,
    minutosDesdeHora,
    horaDesdeMinutos,
    claveDiaSemana,
    sumarDias,
    hoyEnZona,
    horaAhoraEnZona,
    zonedToUtc,
    formatearFechaLarga,
    formatearFechaCorta,
    esHoraValida,
    normalizarHora,
    esFechaValida
};
