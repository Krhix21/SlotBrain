// ============================================================
// Estado conversacional, guardado en Supabase (tabla `conversaciones`).
//
// Clave dual (Meta usernames 2026):
//   · preferida: (telefono_bot, telefono_cliente)
//   · alternativa: (telefono_bot, bsuid) cuando Meta omite el número
//
// Topes: últimos 6 mensajes, 500 chars; barrido a los 30 días.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { esBsuid } = require('./whatsappCloud');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const MAX_MENSAJES = 6;
const MAX_CHARS_MENSAJE = 500;
const DIAS_EXPIRA = 30;
const INTERVALO_BARRIDO_MS = 6 * 60 * 60 * 1000;

let ultimoBarrido = 0;

function vacia() {
    return {
        userName: null,
        mensajes: [],
        ultimaCita: null,
        pendingBooking: null,
        pendingReminder: null,
        pendingOwnerAction: null,
        bsuid: null,
        telefonoCliente: null
    };
}

function partirIdentidad(telefonoCliente, bsuid) {
    let tel = telefonoCliente ? String(telefonoCliente).trim() : null;
    let uid = bsuid ? String(bsuid).trim() : null;
    if (tel && esBsuid(tel) && !uid) {
        uid = tel;
        tel = null;
    }
    if (uid && !esBsuid(uid)) uid = null;
    return { telefonoCliente: tel || null, bsuid: uid || null };
}

/**
 * @param {string} telefonoBot
 * @param {string|null} telefonoCliente
 * @param {{bsuid?:string|null}} [opts]
 */
async function cargar(telefonoBot, telefonoCliente, opts = {}) {
    const id = partirIdentidad(telefonoCliente, opts.bsuid || null);
    if (!telefonoBot || (!id.telefonoCliente && !id.bsuid)) return vacia();

    let data = null;
    let error = null;

    if (id.telefonoCliente) {
        ({ data, error } = await supabase
            .from('conversaciones')
            .select('user_name, mensajes, ultima_cita, pending_booking, pending_reminder, pending_owner_action, bsuid, telefono_cliente')
            .eq('telefono_bot', telefonoBot)
            .eq('telefono_cliente', id.telefonoCliente)
            .maybeSingle());
    }

    if (!data && !error && id.bsuid) {
        ({ data, error } = await supabase
            .from('conversaciones')
            .select('user_name, mensajes, ultima_cita, pending_booking, pending_reminder, pending_owner_action, bsuid, telefono_cliente')
            .eq('telefono_bot', telefonoBot)
            .eq('bsuid', id.bsuid)
            .maybeSingle());
    }

    if (error) {
        console.error('Error cargando conversación:', error.message);
        return vacia();
    }

    if (!data) {
        const v = vacia();
        v.telefonoCliente = id.telefonoCliente;
        v.bsuid = id.bsuid;
        return v;
    }

    return {
        userName: data.user_name || null,
        mensajes: Array.isArray(data.mensajes) ? data.mensajes : [],
        ultimaCita: data.ultima_cita || null,
        pendingBooking: data.pending_booking || null,
        pendingReminder: data.pending_reminder || null,
        pendingOwnerAction: data.pending_owner_action || null,
        bsuid: data.bsuid || id.bsuid || null,
        telefonoCliente: data.telefono_cliente || id.telefonoCliente || null
    };
}

/**
 * Persiste el estado. Si conv.bsuid existe y no hay teléfono, upsert por BSUID.
 * @param {string} telefonoBot
 * @param {string|null} telefonoCliente
 * @param {object} conv
 */
async function guardar(telefonoBot, telefonoCliente, conv) {
    if (!conv) return;

    const id = partirIdentidad(
        telefonoCliente || conv.telefonoCliente,
        conv.bsuid || null
    );

    if (!telefonoBot || (!id.telefonoCliente && !id.bsuid)) {
        console.error('Error guardando conversación: falta identidad (teléfono o bsuid)');
        return;
    }

    conv.mensajes = (conv.mensajes || []).slice(-MAX_MENSAJES);
    conv.telefonoCliente = id.telefonoCliente;
    conv.bsuid = id.bsuid;

    const fila = {
        telefono_bot: telefonoBot,
        telefono_cliente: id.telefonoCliente,
        bsuid: id.bsuid,
        user_name: conv.userName || null,
        mensajes: conv.mensajes,
        ultima_cita: conv.ultimaCita || null,
        pending_booking: conv.pendingBooking || null,
        pending_reminder: conv.pendingReminder || null,
        pending_owner_action: conv.pendingOwnerAction || null
    };

    let error = null;

    if (id.telefonoCliente) {
        ({ error } = await supabase.from('conversaciones').upsert(fila, {
            onConflict: 'telefono_bot,telefono_cliente'
        }));
    } else {
        const { data: existente } = await supabase
            .from('conversaciones')
            .select('id')
            .eq('telefono_bot', telefonoBot)
            .eq('bsuid', id.bsuid)
            .maybeSingle();

        if (existente?.id) {
            ({ error } = await supabase.from('conversaciones').update(fila).eq('id', existente.id));
        } else {
            ({ error } = await supabase.from('conversaciones').insert(fila));
        }
    }

    if (error) {
        console.error('Error guardando conversación:', error.message);
        return;
    }

    barrerEnSegundoPlano();
}

function agregarMensaje(conv, role, content) {
    const limpio = String(content || '').slice(0, MAX_CHARS_MENSAJE);
    conv.mensajes = [...(conv.mensajes || []), { role, content: limpio }].slice(-MAX_MENSAJES);
}

function esPrimeraConversacion(conv) {
    return !conv.userName && (!conv.mensajes || conv.mensajes.length === 0);
}

async function eliminar(telefonoBot, telefonoCliente, opts = {}) {
    const id = partirIdentidad(telefonoCliente, opts.bsuid || null);
    let query = supabase.from('conversaciones').delete().eq('telefono_bot', telefonoBot);

    if (id.telefonoCliente) query = query.eq('telefono_cliente', id.telefonoCliente);
    else if (id.bsuid) query = query.eq('bsuid', id.bsuid);
    else return;

    const { error } = await query;
    if (error) console.error('Error eliminando conversación:', error.message);
}

function barrerEnSegundoPlano() {
    if (Date.now() - ultimoBarrido < INTERVALO_BARRIDO_MS) return;
    ultimoBarrido = Date.now();

    const limite = new Date(Date.now() - DIAS_EXPIRA * 24 * 60 * 60 * 1000).toISOString();

    supabase
        .from('conversaciones')
        .delete()
        .lt('actualizado_en', limite)
        .then(({ error, count }) => {
            if (error) {
                console.error('Error barriendo conversaciones:', error.message);
            } else if (count) {
                console.log(`🧹 Conversaciones inactivas hace ${DIAS_EXPIRA}+ días eliminadas: ${count}`);
            }
        })
        .catch(err => console.error('Error barriendo conversaciones:', err.message));
}

module.exports = {
    cargar,
    guardar,
    agregarMensaje,
    esPrimeraConversacion,
    eliminar,
    MAX_MENSAJES,
    MAX_CHARS_MENSAJE
};
