// ============================================================
// Memoria de cliente por empresa (nombre, último servicio/
// profesional). Requiere migración v11 (tabla clientes_memoria).
// Si la tabla no existe, las funciones no rompen el bot.
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let tablaDisponible = null;

async function comprobarTabla() {
    if (tablaDisponible !== null) return tablaDisponible;
    const { error } = await supabase.from('clientes_memoria').select('id').limit(1);
    if (error && /does not exist|schema cache|Could not find/i.test(error.message)) {
        tablaDisponible = false;
        console.warn('⚠️  clientes_memoria no existe (aplica migración v11 para memoria de cliente).');
    } else {
        tablaDisponible = true;
    }
    return tablaDisponible;
}

async function obtener({ empresaId, telefono, bsuid }) {
    if (!empresaId || !(telefono || bsuid)) return null;
    if (!(await comprobarTabla())) return null;

    let data = null;
    let error = null;

    if (telefono) {
        ({ data, error } = await supabase
            .from('clientes_memoria')
            .select('nombre, ultimo_servicio, ultimo_profesional')
            .eq('empresa_id', empresaId)
            .eq('telefono', telefono)
            .maybeSingle());
    }

    if (!data && !error && bsuid) {
        ({ data, error } = await supabase
            .from('clientes_memoria')
            .select('nombre, ultimo_servicio, ultimo_profesional')
            .eq('empresa_id', empresaId)
            .eq('bsuid', bsuid)
            .maybeSingle());
    }

    if (error) {
        if (/does not exist|schema cache/i.test(error.message)) {
            tablaDisponible = false;
            return null;
        }
        console.error('memoria.obtener:', error.message);
        return null;
    }

    return data || null;
}

async function guardar({ empresaId, telefono, bsuid, nombre, servicio, profesional }) {
    if (!empresaId || !(telefono || bsuid)) return false;
    if (!(await comprobarTabla())) return false;

    const fila = {
        empresa_id: empresaId,
        telefono: telefono || null,
        bsuid: bsuid || null,
        nombre: nombre || null,
        ultimo_servicio: servicio || null,
        ultimo_profesional: profesional || null,
        actualizado_en: new Date().toISOString()
    };

    let error = null;

    if (telefono) {
        ({ error } = await supabase.from('clientes_memoria').upsert(fila, {
            onConflict: 'empresa_id,telefono'
        }));
        // Índices únicos parciales a veces no sirven de onConflict: fallback manual.
        if (error && /no unique|ON CONFLICT|constraint/i.test(error.message)) {
            const { data: ex } = await supabase
                .from('clientes_memoria')
                .select('id')
                .eq('empresa_id', empresaId)
                .eq('telefono', telefono)
                .maybeSingle();
            if (ex?.id) {
                ({ error } = await supabase.from('clientes_memoria').update(fila).eq('id', ex.id));
            } else {
                ({ error } = await supabase.from('clientes_memoria').insert(fila));
            }
        }
    } else {
        const { data: ex } = await supabase
            .from('clientes_memoria')
            .select('id')
            .eq('empresa_id', empresaId)
            .eq('bsuid', bsuid)
            .maybeSingle();
        if (ex?.id) {
            ({ error } = await supabase.from('clientes_memoria').update(fila).eq('id', ex.id));
        } else {
            ({ error } = await supabase.from('clientes_memoria').insert(fila));
        }
    }

    if (error) {
        if (/does not exist|schema cache/i.test(error.message)) {
            tablaDisponible = false;
            return false;
        }
        console.error('memoria.guardar:', error.message);
        return false;
    }
    return true;
}

async function borrar({ empresaId, telefono, bsuid }) {
    if (!empresaId || !(telefono || bsuid)) return false;
    if (!(await comprobarTabla())) return false;

    let query = supabase.from('clientes_memoria').delete().eq('empresa_id', empresaId);
    if (telefono) query = query.eq('telefono', telefono);
    else query = query.eq('bsuid', bsuid);

    const { error } = await query;
    if (error) {
        console.error('memoria.borrar:', error.message);
        return false;
    }
    return true;
}

function saludoRecurrente({ estilo, nombre, servicio, profesional, tratamiento }) {
    if (!nombre) return null;
    const trato = tratamiento || estilo?.tratamiento || 'tu';

    if (servicio && profesional) {
        return `¡Hola ${nombre}! ¿Otra ${servicio} con ${profesional}?`;
    }

    if (servicio) {
        return trato === 'usted'
            ? `¡Hola ${nombre}! ¿Le agendo otra ${servicio}?`
            : `¡Hola ${nombre}! ¿Otra ${servicio}?`;
    }

    return trato === 'usted'
        ? `¡Hola ${nombre}! ¿En qué le puedo ayudar?`
        : `¡Hola ${nombre}! ¿En qué te puedo ayudar?`;
}

module.exports = {
    obtener,
    guardar,
    borrar,
    saludoRecurrente,
    comprobarTabla
};
