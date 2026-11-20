// ============================================================
// Modo dueño/staff del agente WhatsApp.
//
// Tools de operación diaria + confirmación previa en acciones
// destructivas/masivas + escritura en auditoria_agente.
// Lo invoca bot.js cuando roles.esModoDueno(rol).
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const calendar = require('./calendar');
const disponibilidad = require('./disponibilidad');
const {
    formatearFechaLarga,
    hoyEnZona,
    sumarDias,
    esFechaValida,
    normalizarHora
} = require('./tiempo');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const TTL_OWNER_ACTION_MS = 10 * 60 * 1000;
const ESTADOS_MARCA = ['confirmada', 'completada', 'no_asistio', 'cancelada'];

const verAgendaTool = {
    type: 'function',
    function: {
        name: 'ver_agenda',
        description: 'Lista las citas vigentes de un día (hoy, mañana o fecha AAAA-MM-DD).',
        parameters: {
            type: 'object',
            properties: {
                fecha: { type: 'string', description: 'AAAA-MM-DD, "hoy" o "manana". Default hoy.' },
                profesional: { type: 'string', description: 'Nombre del profesional (opcional).' }
            }
        }
    }
};

const marcarEstadoTool = {
    type: 'function',
    function: {
        name: 'marcar_estado_cita',
        description:
            'Cambia el estado de una cita (confirmada, completada, no_asistio, cancelada). ' +
            'Si es cancelación masiva o afecta a varias, el sistema pedirá confirmación.',
        parameters: {
            type: 'object',
            properties: {
                estado: { type: 'string', description: 'confirmada|completada|no_asistio|cancelada' },
                fecha: { type: 'string', description: 'AAAA-MM-DD de la cita' },
                hora: { type: 'string', description: 'HH:MM de la cita' },
                nombre_cliente: { type: 'string', description: 'Nombre del cliente (opcional, ayuda a desambiguar)' },
                todo_el_dia: { type: 'boolean', description: 'true si cancela/marca todas las del día' }
            },
            required: ['estado']
        }
    }
};

const crearBloqueoTool = {
    type: 'function',
    function: {
        name: 'crear_bloqueo',
        description: 'Registra una ausencia/bloqueo de agenda para un profesional (día completo o rango horario).',
        parameters: {
            type: 'object',
            properties: {
                fecha: { type: 'string', description: 'AAAA-MM-DD' },
                hora_inicio: { type: 'string', description: 'HH:MM (omitir = día completo)' },
                hora_fin: { type: 'string', description: 'HH:MM' },
                profesional: { type: 'string', description: 'Nombre del profesional. Si el remitente es trabajador, se usa el suyo.' },
                motivo: { type: 'string' }
            },
            required: ['fecha']
        }
    }
};

const buscarClienteTool = {
    type: 'function',
    function: {
        name: 'buscar_cliente_agenda',
        description: 'Busca citas próximas de un cliente por nombre o teléfono.',
        parameters: {
            type: 'object',
            properties: {
                nombre: { type: 'string' },
                telefono: { type: 'string' }
            }
        }
    }
};

const TOOLS_DUENO = [verAgendaTool, marcarEstadoTool, crearBloqueoTool, buscarClienteTool];

function zonaDe(empresa) {
    return empresa?.zona_horaria || 'America/Bogota';
}

function resolverFechaRelativa(texto, zona) {
    const t = String(texto || 'hoy').trim().toLowerCase();
    const hoy = hoyEnZona(zona);
    if (!t || t === 'hoy' || t === 'today') return hoy;
    if (t === 'manana' || t === 'mañana' || t === 'tomorrow') return sumarDias(hoy, 1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    return t;
}

async function registrarAuditoria({ empresaId, rol, accion, detalle, citaId = null }) {
    const { error } = await supabase.from('auditoria_agente').insert({
        empresa_id: empresaId,
        actor_telefono: rol.telefono || null,
        actor_bsuid: rol.bsuid || null,
        actor_rol: rol.tipo,
        accion,
        detalle: detalle || {},
        cita_id: citaId
    });
    if (error) console.error('⚠️  No se pudo escribir auditoria_agente:', error.message);
}

async function listarTrabajadores(empresaId) {
    const { data } = await supabase
        .from('trabajadores')
        .select('id, nombre, telefono, activo')
        .eq('empresa_id', empresaId)
        .eq('activo', true)
        .order('orden');
    return data || [];
}

function trabajadorPorNombre(lista, nombre) {
    if (!nombre) return null;
    const n = String(nombre).toLowerCase().trim();
    return lista.find(t => t.nombre.toLowerCase() === n)
        || lista.find(t => t.nombre.toLowerCase().includes(n) || n.includes(t.nombre.toLowerCase()))
        || null;
}

async function ejecutarVerAgenda({ empresa, rol, args }) {
    const zona = zonaDe(empresa);
    const fecha = resolverFechaRelativa(args.fecha, zona);
    if (!esFechaValida(fecha)) {
        return { exitoso: false, mensaje: 'No entendí la fecha. Usa hoy, mañana o AAAA-MM-DD.' };
    }

    let consulta = supabase
        .from('citas')
        .select('id, nombre_cliente, telefono_cliente, nombre_servicio, fecha, hora, estado, trabajador_id, trabajadores(nombre)')
        .eq('empresa_id', empresa.id)
        .eq('fecha', fecha)
        .in('estado', ['agendada', 'confirmada'])
        .order('hora');

    if (rol.tipo === 'trabajador' && rol.trabajadorId) {
        consulta = consulta.eq('trabajador_id', rol.trabajadorId);
    } else if (args.profesional) {
        const lista = await listarTrabajadores(empresa.id);
        const t = trabajadorPorNombre(lista, args.profesional);
        if (!t) return { exitoso: false, mensaje: `No encontré al profesional "${args.profesional}".` };
        consulta = consulta.eq('trabajador_id', t.id);
    }

    const { data, error } = await consulta;
    if (error) {
        console.error('❌ ver_agenda:', error.message);
        return { exitoso: false, mensaje: 'No pude leer la agenda ahora.' };
    }

    const citas = data || [];
    if (!citas.length) {
        return { exitoso: true, mensaje: `No hay citas vigentes el ${formatearFechaLarga(fecha)}.` };
    }

    const lineas = citas.map(c => {
        const prof = c.trabajadores?.nombre || '—';
        return `• ${c.hora} — ${c.nombre_cliente || 'sin nombre'} (${c.nombre_servicio || 'servicio'}) con ${prof} [${c.estado}]`;
    });

    return {
        exitoso: true,
        mensaje: `Agenda del ${formatearFechaLarga(fecha)} (${citas.length}):\n${lineas.join('\n')}`
    };
}

async function buscarCitasFiltro({ empresa, rol, fecha, hora, nombreCliente, todoElDia }) {
    let consulta = supabase
        .from('citas')
        .select('*')
        .eq('empresa_id', empresa.id)
        .in('estado', ['agendada', 'confirmada']);

    if (fecha) consulta = consulta.eq('fecha', fecha);
    if (hora && !todoElDia) consulta = consulta.eq('hora', hora);
    if (rol.tipo === 'trabajador' && rol.trabajadorId) {
        consulta = consulta.eq('trabajador_id', rol.trabajadorId);
    }

    const { data, error } = await consulta.order('hora');
    if (error) {
        console.error('❌ buscar citas dueño:', error.message);
        return [];
    }

    let lista = data || [];
    if (nombreCliente) {
        const n = String(nombreCliente).toLowerCase();
        lista = lista.filter(c => String(c.nombre_cliente || '').toLowerCase().includes(n));
    }
    return lista;
}

function esDestructivaOMasiva({ estado, todoElDia, cantidad }) {
    if (todoElDia || cantidad > 1) return true;
    if (estado === 'cancelada' || estado === 'no_asistio') return cantidad !== 1;
    return false;
}

async function aplicarEstados({ empresa, rol, citas, estado }) {
    const resultados = [];
    for (const cita of citas) {
        if (estado === 'cancelada') {
            const trabajadores = await disponibilidad.obtenerTrabajadores(empresa.id, false);
            const trabajador = trabajadores.find(t => t.id === cita.trabajador_id) || null;
            const r = await calendar.cancelarCita({
                empresa,
                trabajador,
                cita,
                canceladoPor: rol.tipo,
                motivo: 'cancelada por agente dueño'
            });
            if (r.exitoso) {
                await registrarAuditoria({
                    empresaId: empresa.id,
                    rol,
                    accion: 'marcar_estado_cita',
                    detalle: { estado, fecha: cita.fecha, hora: cita.hora, cliente: cita.nombre_cliente },
                    citaId: cita.id
                });
            }
            resultados.push(r);
        } else {
            const { error } = await supabase
                .from('citas')
                .update({ estado })
                .eq('id', cita.id);
            if (error) {
                resultados.push({ exitoso: false, mensaje: error.message, cita });
            } else {
                await registrarAuditoria({
                    empresaId: empresa.id,
                    rol,
                    accion: 'marcar_estado_cita',
                    detalle: { estado, fecha: cita.fecha, hora: cita.hora, cliente: cita.nombre_cliente },
                    citaId: cita.id
                });
                resultados.push({ exitoso: true, cita });
            }
        }
    }
    return resultados;
}

async function ejecutarMarcarEstado({ empresa, rol, args, conv }) {
    const estado = String(args.estado || '').toLowerCase().trim();
    if (!ESTADOS_MARCA.includes(estado)) {
        return { exitoso: false, mensaje: `Estado inválido. Usa: ${ESTADOS_MARCA.join(', ')}.` };
    }

    const zona = zonaDe(empresa);
    const fecha = args.fecha ? resolverFechaRelativa(args.fecha, zona) : hoyEnZona(zona);
    const hora = args.hora ? normalizarHora(args.hora) : null;
    const todoElDia = !!args.todo_el_dia;

    if (!esFechaValida(fecha)) {
        return { exitoso: false, mensaje: 'Necesito una fecha válida (hoy / mañana / AAAA-MM-DD).' };
    }

    const citas = await buscarCitasFiltro({
        empresa,
        rol,
        fecha,
        hora,
        nombreCliente: args.nombre_cliente,
        todoElDia
    });

    if (!citas.length) {
        return { exitoso: false, mensaje: 'No encontré citas que coincidan.' };
    }

    if (esDestructivaOMasiva({ estado, todoElDia, cantidad: citas.length }) || (estado === 'cancelada' && (todoElDia || citas.length > 1))) {
        conv.pendingOwnerAction = {
            tipo: 'marcar_estado_cita',
            estado,
            citaIds: citas.map(c => c.id),
            creadoEn: Date.now(),
            resumen: `${estado} × ${citas.length} cita(s) el ${fecha}${hora ? ` ${hora}` : ''}`
        };
        return {
            exitoso: true,
            mensaje: `Voy a marcar ${citas.length} cita(s) como "${estado}" el ${formatearFechaLarga(fecha)}. ¿Confirmas? Responde SÍ o NO.`
        };
    }

    // Unitaria no destructiva masiva: ejecuta directo
    const resultados = await aplicarEstados({ empresa, rol, citas, estado });
    const ok = resultados.filter(r => r.exitoso).length;
    if (!ok) return { exitoso: false, mensaje: resultados[0]?.mensaje || 'No pude actualizar.' };

    const c = citas[0];
    return {
        exitoso: true,
        mensaje: `Listo: ${c.nombre_cliente || 'cliente'} (${c.hora}) → ${estado}.`
    };
}

async function ejecutarCrearBloqueo({ empresa, rol, args, conv }) {
    const zona = zonaDe(empresa);
    const fecha = resolverFechaRelativa(args.fecha, zona);
    if (!esFechaValida(fecha)) {
        return { exitoso: false, mensaje: 'Fecha inválida para el bloqueo.' };
    }

    const lista = await listarTrabajadores(empresa.id);
    let trabajador = null;
    if (rol.tipo === 'trabajador' && rol.trabajadorId) {
        trabajador = lista.find(t => t.id === rol.trabajadorId) || null;
    } else if (args.profesional) {
        trabajador = trabajadorPorNombre(lista, args.profesional);
    } else if (lista.length === 1) {
        trabajador = lista[0];
    }

    if (!trabajador) {
        return { exitoso: false, mensaje: 'Indica el nombre del profesional a bloquear.' };
    }

    const horaInicio = args.hora_inicio ? normalizarHora(args.hora_inicio) : null;
    const horaFin = args.hora_fin ? normalizarHora(args.hora_fin) : null;
    const diaCompleto = !horaInicio;

    if (diaCompleto) {
        conv.pendingOwnerAction = {
            tipo: 'crear_bloqueo',
            trabajadorId: trabajador.id,
            fecha,
            horaInicio: null,
            horaFin: null,
            motivo: args.motivo || 'bloqueo por agente',
            creadoEn: Date.now(),
            resumen: `bloqueo día completo ${fecha} (${trabajador.nombre})`
        };
        return {
            exitoso: true,
            mensaje: `Voy a bloquear el día completo del ${formatearFechaLarga(fecha)} para ${trabajador.nombre}. ¿Confirmas? SÍ / NO.`
        };
    }

    const { error } = await supabase.from('bloqueos').insert({
        trabajador_id: trabajador.id,
        fecha,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        motivo: args.motivo || 'bloqueo por agente'
    });

    if (error) {
        console.error('❌ crear_bloqueo:', error.message);
        return { exitoso: false, mensaje: 'No pude crear el bloqueo.' };
    }

    await registrarAuditoria({
        empresaId: empresa.id,
        rol,
        accion: 'crear_bloqueo',
        detalle: { fecha, horaInicio, horaFin, profesional: trabajador.nombre, motivo: args.motivo || null }
    });

    return {
        exitoso: true,
        mensaje: horaInicio
            ? `Bloqueo creado el ${formatearFechaLarga(fecha)} de ${horaInicio} a ${horaFin} (${trabajador.nombre}).`
            : `Día ${formatearFechaLarga(fecha)} bloqueado para ${trabajador.nombre}.`
    };
}

async function ejecutarBuscarCliente({ empresa, rol, args }) {
    let consulta = supabase
        .from('citas')
        .select('nombre_cliente, telefono_cliente, nombre_servicio, fecha, hora, estado, trabajadores(nombre)')
        .eq('empresa_id', empresa.id)
        .in('estado', ['agendada', 'confirmada'])
        .gte('fecha', hoyEnZona(zonaDe(empresa)))
        .order('fecha')
        .limit(15);

    if (rol.tipo === 'trabajador' && rol.trabajadorId) {
        consulta = consulta.eq('trabajador_id', rol.trabajadorId);
    }
    if (args.telefono) {
        const digitos = String(args.telefono).replace(/\D/g, '');
        consulta = consulta.ilike('telefono_cliente', `%${digitos.slice(-10)}%`);
    }

    const { data, error } = await consulta;
    if (error) {
        return { exitoso: false, mensaje: 'No pude buscar ahora.' };
    }

    let lista = data || [];
    if (args.nombre) {
        const n = String(args.nombre).toLowerCase();
        lista = lista.filter(c => String(c.nombre_cliente || '').toLowerCase().includes(n));
    }

    if (!lista.length) {
        return { exitoso: true, mensaje: 'No encontré citas próximas con ese criterio.' };
    }

    const lineas = lista.map(c =>
        `• ${c.fecha} ${c.hora} — ${c.nombre_cliente || 'sin nombre'} (${c.nombre_servicio}) [${c.estado}]`
    );
    return { exitoso: true, mensaje: `Encontré ${lista.length}:\n${lineas.join('\n')}` };
}

function leerPendingOwner(conv) {
    const p = conv.pendingOwnerAction;
    if (!p) return null;
    if (Date.now() - (p.creadoEn || 0) > TTL_OWNER_ACTION_MS) {
        conv.pendingOwnerAction = null;
        return null;
    }
    return p;
}

async function confirmarPendingOwner({ empresa, rol, conv }) {
    const p = leerPendingOwner(conv);
    if (!p) return { exitoso: false, mensaje: 'No hay ninguna acción pendiente de confirmar.' };

    conv.pendingOwnerAction = null;

    if (p.tipo === 'marcar_estado_cita') {
        const { data: citas } = await supabase
            .from('citas')
            .select('*')
            .in('id', p.citaIds || []);
        const resultados = await aplicarEstados({ empresa, rol, citas: citas || [], estado: p.estado });
        const ok = resultados.filter(r => r.exitoso).length;
        return { exitoso: ok > 0, mensaje: `Hecho: ${ok} cita(s) → ${p.estado}.` };
    }

    if (p.tipo === 'crear_bloqueo') {
        const { error } = await supabase.from('bloqueos').insert({
            trabajador_id: p.trabajadorId,
            fecha: p.fecha,
            hora_inicio: p.horaInicio,
            hora_fin: p.horaFin,
            motivo: p.motivo || 'bloqueo por agente'
        });
        if (error) return { exitoso: false, mensaje: 'No pude crear el bloqueo.' };
        await registrarAuditoria({
            empresaId: empresa.id,
            rol,
            accion: 'crear_bloqueo',
            detalle: { fecha: p.fecha, profesionalId: p.trabajadorId, motivo: p.motivo }
        });
        return { exitoso: true, mensaje: `Bloqueo confirmado: ${p.resumen}.` };
    }

    return { exitoso: false, mensaje: 'No reconocí la acción pendiente.' };
}

async function procesarToolDueno({ nombre, args, empresa, rol, conv }) {
    if (nombre === 'ver_agenda') return ejecutarVerAgenda({ empresa, rol, args });
    if (nombre === 'marcar_estado_cita') return ejecutarMarcarEstado({ empresa, rol, args, conv });
    if (nombre === 'crear_bloqueo') return ejecutarCrearBloqueo({ empresa, rol, args, conv });
    if (nombre === 'buscar_cliente_agenda') return ejecutarBuscarCliente({ empresa, rol, args });
    return { exitoso: false, mensaje: 'No pude ejecutar esa acción.' };
}

function construirPromptDueno({ empresa, rol, zona, conv }) {
    const hoy = hoyEnZona(zona);
    const pendiente = conv.pendingOwnerAction
        ? `Hay una acción pendiente de confirmar: ${conv.pendingOwnerAction.resumen}. Si dice SÍ, confírmala; si dice NO, cancélala.`
        : '';

    return `Eres el asistente operativo de WhatsApp del negocio "${empresa.nombre}".
Hablas con el ${rol.tipo} del negocio (NO con un cliente). No pidas su nombre.

HOY es ${formatearFechaLarga(hoy)} (${hoy}), zona ${zona}.

HERRAMIENTAS
- ver_agenda: citas del día
- marcar_estado_cita: confirmada / completada / no_asistio / cancelada
- crear_bloqueo: ausencias
- buscar_cliente_agenda: buscar por nombre o teléfono

REGLAS
1. Español breve y claro. Sin mencionar tools ni JSON.
2. Prefiere SIEMPRE las herramientas para datos reales. No inventes citas.
3. Acciones destructivas o masivas (cancelar varias, bloquear día completo) deben pedir confirmación antes de ejecutarse.
4. Si eres trabajador, solo operas tu propia agenda.
${pendiente}`;
}

module.exports = {
    TOOLS_DUENO,
    procesarToolDueno,
    construirPromptDueno,
    leerPendingOwner,
    confirmarPendingOwner,
    registrarAuditoria
};
