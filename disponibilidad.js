// ============================================================
// Motor de disponibilidad.
//
// Responde: "¿quién está libre, para qué servicio, en qué fecha?"
//
// Para cada trabajador con calendario enlazado:
//   1. Se toma su horario (el propio, o el de la empresa si no tiene)
//   2. Se generan slots de N minutos dentro de ese horario
//   3. Se restan los bloques ocupados de SU Google Calendar (freebusy)
//   4. Se restan los bloqueos de la tabla `bloqueos`
//
// freebusy.query devuelve {busy:[{start,end}]} y acepta un `items[]` con
// hasta 50 calendarios, pero usando las credenciales de QUIEN LLAMA. Como
// cada trabajador tiene su propio refresh_token, hay que hacer una llamada
// por trabajador. Con 1-10 trabajadores son 1-10 llamadas baratas.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { crearCalendar } = require('./googleAuth');
const {
    HORARIO_POR_DEFECTO,
    ZONA_POR_DEFECTO,
    minutosDesdeHora,
    horaDesdeMinutos,
    claveDiaSemana,
    zonedToUtc,
    esFechaValida
} = require('./tiempo');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const MAX_SLOTS_POR_TRABAJADOR = 24;

/** Trabajadores de una empresa que tienen calendario realmente enlazado. */
async function obtenerTrabajadores(empresaId, soloConCalendar = true) {
    let consulta = supabase
        .from('trabajadores')
        .select('id, nombre, correo, refresh_token, empresa_id, horario, slot_minutos, orden, activo')
        .eq('empresa_id', empresaId)
        .eq('activo', true)
        .order('orden');

    const { data, error } = await consulta;

    if (error) {
        console.error('Error cargando trabajadores:', error.message);
        return [];
    }

    const trabajadores = data || [];
    return soloConCalendar
        ? trabajadores.filter(t => t.refresh_token && t.correo)
        : trabajadores;
}

/**
 * Servicios que puede hacer un trabajador.
 * Si no hay filas en `servicios_trabajadores`, puede hacer todos.
 */
async function serviciosDe(trabajadorId, servicios) {
    const { data, error } = await supabase
        .from('servicios_trabajadores')
        .select('servicio_id')
        .eq('trabajador_id', trabajadorId);

    if (error) {
        console.error('Error consultando servicios del trabajador:', error.message);
        return servicios;
    }

    if (!data || data.length === 0) return servicios;

    const permitidos = new Set(data.map(f => f.servicio_id));
    return servicios.filter(s => permitidos.has(s.id));
}

/** Mapa trabajador_id -> servicios que puede hacer. */
async function mapaServiciosPorTrabajador(trabajadores, servicios) {
    const { data, error } = await supabase
        .from('servicios_trabajadores')
        .select('trabajador_id, servicio_id');

    if (error) {
        console.error('Error consultando servicios_trabajadores:', error.message);
        return new Map();
    }

    // Agrupamos las asignaciones por trabajador.
    const asignados = new Map();
    for (const fila of data || []) {
        if (!asignados.has(fila.trabajador_id)) asignados.set(fila.trabajador_id, []);
        asignados.get(fila.trabajador_id).push(fila.servicio_id);
    }

    // La regla es POR profesional, no global: un trabajador sin filas suyas
    // ofrece todos los servicios, aunque otros trabajadores sí tengan
    // filas. Antes se vaciaba la lista de todos y solo se rellenaba la de
    // los que aparecían en la tabla, así que un profesional sin asignación
    // quedaba con cero servicios en cuanto cualquier otro tenga alguno.
    const porTrabajador = new Map();
    for (const t of trabajadores) {
        const ids = asignados.get(t.id);
        if (!ids || ids.length === 0) {
            porTrabajador.set(t.id, servicios);
        } else {
            const permitidos = new Set(ids);
            porTrabajador.set(t.id, servicios.filter(s => permitidos.has(s.id)));
        }
    }

    return porTrabajador;
}

/** Excepciones registradas para un trabajador en una fecha. */
async function obtenerBloqueos(trabajadorId, fecha) {
    const { data, error } = await supabase
        .from('bloqueos')
        .select('fecha, hora_inicio, hora_fin, motivo')
        .eq('trabajador_id', trabajadorId)
        .eq('fecha', fecha);

    if (error) {
        console.error('Error cargando bloqueos:', error.message);
        return [];
    }
    return data || [];
}

/** Bloqueos convertidos a intervalos absolutos (ms) dentro de la zona. */
function intervalosDeBloqueo(bloqueos, fecha, zona) {
    return bloqueos.map(b => {
        if (!b.hora_inicio) {
            const inicio = zonedToUtc(fecha, '00:00', zona).getTime();
            const fin = zonedToUtc(fecha, '23:59', zona).getTime() + 60000;
            return { inicio, fin, motivo: b.motivo };
        }

        const horaFin = b.hora_fin || '23:59';
        const mismoDia = minutosDesdeHora(b.hora_inicio) < minutosDesdeHora(horaFin);
        const diaFin = mismoDia ? fecha : sumarDia(fecha);

        return {
            inicio: zonedToUtc(fecha, b.hora_inicio, zona).getTime(),
            fin: zonedToUtc(diaFin, horaFin, zona).getTime() + 60000,
            motivo: b.motivo
        };
    });
}

function sumarDia(fechaISO) {
    const [a, m, d] = fechaISO.split('-').map(Number);
    const f = new Date(Date.UTC(a, m - 1, d, 12));
    f.setUTCDate(f.getUTCDate() + 1);
    return f.toISOString().slice(0, 10);
}

/** Bloques ocupados del calendario de un trabajador, en ms. */
async function consultarOcupado(trabajador, desdeIso, hastaIso, zona) {
    try {
        const calendar = crearCalendar(trabajador.refresh_token);

        const { data } = await calendar.freebusy.query({
            timeMin: desdeIso,
            timeMax: hastaIso,
            timeZone: zona,
            items: [{ id: 'primary' }]
        });

        const entrada = data?.calendars?.['primary'] || Object.values(data?.calendars || {})[0];

        if (entrada?.errors?.length) {
            console.warn(
                `⚠️  No se pudo leer el calendario de ${trabajador.nombre || trabajador.id}:`,
                entrada.errors.map(e => e.reason).join(', ')
            );
            return { bloques: [], inaccesible: true };
        }

        return {
            bloques: (entrada?.busy || []).map(b => ({
                inicio: new Date(b.start).getTime(),
                fin: new Date(b.end).getTime()
            })),
            inaccesible: false
        };
    } catch (error) {
        console.error(
            `❌ Error consultando el calendario de ${trabajador.nombre || trabajador.id}:`,
            error.message
        );
        return { bloques: [], inaccesible: true };
    }
}

function solapa(inicioMs, finMs, bloques) {
    return bloques.some(b => inicioMs < b.fin && finMs > b.inicio);
}

/** Ventanas (["09:00","18:00"]) que aplican a un trabajador en una fecha. */
function ventanasDelDia(trabajador, empresa, fecha) {
    const horario = (trabajador.horario && Object.keys(trabajador.horario).length)
        ? trabajador.horario
        : (empresa.horario && Object.keys(empresa.horario).length)
            ? empresa.horario
            : HORARIO_POR_DEFECTO;

    const dia = claveDiaSemana(fecha);
    return Array.isArray(horario[dia]) ? horario[dia] : [];
}

function pasoDeSlots(trabajador, empresa) {
    const paso = trabajador.slot_minutos || empresa.slot_minutos || 30;
    return paso >= 5 && paso <= 240 ? paso : 30;
}

/**
 * Slots libres de un trabajador concreto para una fecha.
 * @returns {Promise<{hora:string, trabajador_id:string, trabajador_nombre:string}[]>}
 */
async function slotsDeTrabajador({ trabajador, empresa, fecha, duracionMinutos, incluirPasados = false }) {
    const zona = empresa.zona_horaria || ZONA_POR_DEFECTO;
    const ventanas = ventanasDelDia(trabajador, empresa, fecha);

    if (ventanas.length === 0) return [];

    const paso = pasoDeSlots(trabajador, empresa);
    const ahora = Date.now();

    const [ocupado, bloqueos] = await Promise.all([
        consultarOcupado(
            trabajador,
            zonedToUtc(fecha, '00:00', zona).toISOString(),
            zonedToUtc(fecha, '23:59', zona).toISOString(),
            zona
        ),
        obtenerBloqueos(trabajador.id, fecha)
    ]);

    // El calendario no se pudo leer: no prometemos horas que no pudimos verificar.
    if (ocupado.inaccesible) return [];

    const bloqueados = intervalosDeBloqueo(bloqueos, fecha, zona);
    const ocupados = [...ocupado.bloques, ...bloqueados];

    const slots = [];

    for (const [ventanaIni, ventanaFin] of ventanas) {
        const desde = minutosDesdeHora(ventanaIni);
        const hasta = minutosDesdeHora(ventanaFin);

        for (let m = desde; m + duracionMinutos <= hasta; m += paso) {
            if (slots.length >= MAX_SLOTS_POR_TRABAJADOR) break;

            const hora = horaDesdeMinutos(m);
            const inicioMs = zonedToUtc(fecha, hora, zona).getTime();
            const finMs = zonedToUtc(fecha, horaDesdeMinutos(m + duracionMinutos), zona).getTime();

            if (!incluirPasados && inicioMs <= ahora) continue;
            if (solapa(inicioMs, finMs, ocupados)) continue;

            slots.push({
                hora,
                trabajador_id: trabajador.id,
                trabajador_nombre: trabajador.nombre || 'el profesional'
            });
        }
    }

    return slots;
}

/**
 * Slots libres de TODOS los trabajadores de la empresa.
 *
 * @param {object} params
 * @param {object} params.empresa        - fila de `empresas`
 * @param {Array}  params.servicios      - servicios activos de la empresa
 * @param {string} params.fecha          - "YYYY-MM-DD"
 * @param {number} params.duracionMinutos
 * @param {string} [params.servicioId]   - filtra por quien pueda hacer ese servicio
 * @param {string} [params.trabajadorId] - limita a un trabajador
 * @returns {Promise<{slots:Array, trabajadores:Array, motivo:string|null}>}
 */
async function obtenerSlots({ empresa, servicios = [], fecha, duracionMinutos = 60, servicioId = null, trabajadorId = null, incluirPasados = false }) {
    if (!empresa || !esFechaValida(fecha)) {
        return { slots: [], trabajadores: [], motivo: 'Fecha inválida' };
    }

    let candidatos = await obtenerTrabajadores(empresa.id);

    if (trabajadorId) {
        candidatos = candidatos.filter(t => t.id === trabajadorId);
    }

    if (candidatos.length === 0) {
        return {
            slots: [],
            trabajadores: [],
            motivo: trabajadorId
                ? 'Ese profesional todavía no tiene un Google Calendar conectado.'
                : 'Ningún profesional tiene un Google Calendar conectado.'
        };
    }

    // Solo considerar trabajadores que puedan hacer este servicio.
    let serviciosPorTrabajador = new Map(candidatos.map(t => [t.id, servicios]));

    if (servicioId) {
        serviciosPorTrabajador = await mapaServiciosPorTrabajador(candidatos, servicios);
        candidatos = candidatos.filter(t => (serviciosPorTrabajador.get(t.id) || []).length > 0);

        if (candidatos.length === 0) {
            return { slots: [], trabajadores: [], motivo: 'Ningún profesional ofrece ese servicio.' };
        }
    }

    const resultados = await Promise.all(
        candidatos.map(async trabajador => {
            const slots = await slotsDeTrabajador({
                trabajador,
                empresa,
                fecha,
                duracionMinutos,
                incluirPasados
            });
            return { trabajador, slots };
        })
    );

    const slots = resultados.flatMap(r => r.slots).sort((a, b) => a.hora.localeCompare(b.hora));
    const trabajadores = resultados
        .filter(r => r.slots.length > 0)
        .map(r => ({
            id: r.trabajador.id,
            nombre: r.trabajador.nombre || 'el profesional',
            correo: r.trabajador.correo,
            slots: r.slots.map(s => s.hora)
        }));

    return { slots, trabajadores, motivo: null };
}

/**
 * Última verificación antes de escribir en Google Calendar.
 * Vuelve a leer freebusy en ese instante exacto, porque entre que el bot
 * ofreció el slot y el cliente confirmó pueden haberse tomado citas ajenas.
 *
 * @returns {Promise<{libre:boolean, motivo:string|null}>}
 */
/**
 * Confirma que un slot sigue libre en el momento de usarlo.
 *
 * Se usa tanto al agendar como al mover una cita, y por eso acepta
 * `ignorarIntervalo`: al mover, el evento de la cita que se está moviendo
 * ocupa el rango viejo y aparecería como conflicto consigo mismo. Solo se
 * descarta el bloque que *contiene* el rango viejo (o sea, el propio evento);
 * un tercero que haya metido algo dentro de ese rango sigue contando como
 * conflicto.
 *
 * @param {{ignorarIntervalo?:{inicioMs:number,finMs:number}|null}} [opciones]
 */
async function confirmarSlot({ empresa, trabajador, fecha, hora, duracionMinutos = 60, ignorarIntervalo = null }) {
    const zona = empresa.zona_horaria || ZONA_POR_DEFECTO;

    const inicioMs = zonedToUtc(fecha, hora, zona).getTime();
    const finMs = zonedToUtc(fecha, horaDesdeMinutos(minutosDesdeHora(hora) + duracionMinutos), zona).getTime();

    if (inicioMs <= Date.now()) {
        return { libre: false, motivo: 'ese horario ya pasó' };
    }

    const ventanas = ventanasDelDia(trabajador, empresa, fecha);
    const dentroDeHorario = ventanas.some(([ini, fin]) => {
        const m = minutosDesdeHora(hora);
        return m >= minutosDesdeHora(ini) && m + duracionMinutos <= minutosDesdeHora(fin);
    });

    if (!dentroDeHorario) {
        return { libre: false, motivo: 'está fuera del horario de atención' };
    }

    const [ocupado, bloqueos] = await Promise.all([
        consultarOcupado(
            trabajador,
            new Date(inicioMs).toISOString(),
            new Date(finMs).toISOString(),
            zona
        ),
        obtenerBloqueos(trabajador.id, fecha)
    ]);

    if (ocupado.inaccesible) {
        return { libre: false, motivo: 'no pude verificar el calendario' };
    }

    const bloqueados = intervalosDeBloqueo(bloqueos, fecha, zona);

    // Tolerancia de 1 minuto: el evento se guardó con la misma zona, pero
    // el redondeo de la zona horaria puede moverlo unos segundos.
    const TOLERANCIA_MS = 60 * 1000;
    let relevantes = ocupado.bloques;
    if (ignorarIntervalo) {
        relevantes = ocupado.bloques.filter(b =>
            !(b.inicio <= ignorarIntervalo.inicioMs + TOLERANCIA_MS
              && b.fin >= ignorarIntervalo.finMs - TOLERANCIA_MS)
        );
    }

    if (solapa(inicioMs, finMs, [...relevantes, ...bloqueados])) {
        return { libre: false, motivo: 'alguien más lo acaba de tomar' };
    }

    return { libre: true, motivo: null };
}

module.exports = {
    obtenerTrabajadores,
    obtenerSlots,
    slotsDeTrabajador,
    confirmarSlot,
    serviciosDe,
    ventanasDelDia
};
