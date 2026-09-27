const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function yaExisteRegistro(user_id, role) {
    const { data, error } = await supabase
        .from('historial_chats')
        .select('id')
        .eq('user_id', user_id)
        .eq('role', role)
        .limit(1);

    if (error) {
        console.error('Error consultando historial:', error.message);
        return false;
    }
    return data && data.length > 0;
}

async function insertarEvento(user_id, role, content) {
    const { error } = await supabase.from('historial_chats').insert({
        user_id,
        role,
        content,
        timestamp: new Date().toISOString()
    });

    if (error) console.error('Error guardando en historial_chats:', error.message);
}

async function guardarCliente(_telefono_bot, telefono_cliente, nombre) {
    if (!telefono_cliente || !nombre) return;

    const yaRegistrado = await yaExisteRegistro(telefono_cliente, 'cliente');
    if (yaRegistrado) return;

    await insertarEvento(
        telefono_cliente,
        'cliente',
        `Nombre: ${nombre} | Teléfono: ${telefono_cliente}`
    );
    console.log(`💾 Cliente guardado en historial_chats: ${nombre} (${telefono_cliente})`);
}

async function registrarCitaAgendada(_telefono_bot, telefono_cliente, { servicio, fecha, hora, nombre_cliente }) {
    if (!telefono_cliente) return;

    await insertarEvento(
        telefono_cliente,
        'cita_agendada',
        `Cita agendada: ${servicio} | ${fecha} ${hora} | Cliente: ${nombre_cliente}`
    );
    console.log(`💾 Cita guardada en historial_chats: ${nombre_cliente} - ${servicio} (${fecha} ${hora})`);
}

async function registrarCitaCancelada(_telefono_bot, telefono_cliente, { fecha, hora, nombre_cliente }) {
    if (!telefono_cliente) return;

    await insertarEvento(
        telefono_cliente,
        'cita_cancelada',
        `Cita cancelada: ${fecha} ${hora} | Cliente: ${nombre_cliente}`
    );
    console.log(`💾 Cita cancelada en historial_chats: ${nombre_cliente} (${fecha} ${hora})`);
}

async function registrarCitaModificada(_telefono_bot, telefono_cliente, args) {
    if (!telefono_cliente) return;

    await insertarEvento(
        telefono_cliente,
        'cita_modificada',
        `Cita modificada: de ${args.fecha_actual} ${args.hora_actual} a ${args.nueva_fecha} ${args.nueva_hora} | Cliente: ${args.nombre_cliente}`
    );
    console.log(`💾 Cita modificada en historial_chats: ${args.nombre_cliente}`);
}

module.exports = {
    guardarCliente,
    registrarCitaAgendada,
    registrarCitaCancelada,
    registrarCitaModificada
};
