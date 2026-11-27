// ============================================================
// Estado conversacional, guardado en Supabase (tabla `conversaciones`).
//
// Clave dual (Meta usernames 2026):
//   · preferida: (telefono_bot, telefono_cliente)
//   · alternativa: (telefono_bot, bsuid) cuando Meta omite el número
//
// Topes: últimos 6 mensajes, 500 chars; barrido a los 30 días.
// bot_pausado / fallos_entendimiento: columnas v11 (si no existen,
// se mantienen en memoria de proceso).
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { esBsuid } = require('./whatsappCloud');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const MAX_MENSAJES = 6;
const MAX_CHARS_MENSAJE = 500;
const DIAS_EXPIRA = 30;
const INTERVALO_BARRIDO_MS = 6 * 60 * 60 * 1000;

let ultimoBarrido = 0;
let columnasV11 = null;
let columnasV12 = null;
const pausasMemoria = new Map();

function clavePausa(telefonoBot, id) {
    return `${telefonoBot}|${id.telefonoCliente || ''}|${id.bsuid || ''}`;
}

function vacia() {
    return {
        userName: null,
        mensajes: [],
        ultimaCita: null,
        pendingBooking: null,
        pendingReminder: null,
        pendingOwnerAction: null,
        pendingOferta: null,
        botPausado: false,
        fallosEntendimiento: 0,
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

const SELECT_BASE = 'user_name, mensajes, ultima_cita, pending_booking, pending_reminder, pending_owner_action, bsuid, telefono_cliente';
const SELECT_V11 = SELECT_BASE + ', bot_pausado, fallos_entendimiento';
const SELECT_V12 = SELECT_V11 + ', pending_oferta';

async function selectConversacion(filtro) {
    // Degradación por etapas: si falta una columna (base sin migrar), se
    // reintenta sin ella en vez de romper toda la conversación.
    for (let intento = 0; intento < 3; intento++) {
        let cols = SELECT_BASE;
        if (columnasV11 !== false) cols += ', bot_pausado, fallos_entendimiento';
        if (columnasV12 !== false) cols += ', pending_oferta';

        let q = supabase.from('conversaciones').select(cols);
        for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v);
        const { data, error } = await q.maybeSingle();

        if (!error) return { data, error };

        const msg = error.message || '';
        if (columnasV12 !== false && /pending_oferta/i.test(msg)) {
            columnasV12 = false;
            continue;
        }
        if (columnasV11 !== false && /bot_pausado|fallos_entendimiento/i.test(msg)) {
            columnasV11 = false;
            continue;
        }
        if (/schema cache|does not exist/i.test(msg)) {
            // El error no dice qué columna falta: se degrada de a una.
            if (columnasV12 !== false) { columnasV12 = false; continue; }
            if (columnasV11 !== false) { columnasV11 = false; continue; }
        }
        return { data, error };
    }
    return { data: null, error: null };
}

async function cargar(telefonoBot, telefonoCliente, opts = {}) {
    const id = partirIdentidad(telefonoCliente, opts.bsuid || null);
    if (!telefonoBot || (!id.telefonoCliente && !id.bsuid)) return vacia();

    let data = null;
    let error = null;

    if (id.telefonoCliente) {
        ({ data, error } = await selectConversacion({
            telefono_bot: telefonoBot,
            telefono_cliente: id.telefonoCliente
        }));
    }

    if (!data && !error && id.bsuid) {
        ({ data, error } = await selectConversacion({
            telefono_bot: telefonoBot,
            bsuid: id.bsuid
        }));
    }

    if (error) {
        console.error('Error cargando conversación:', error.message);
        return vacia();
    }

    const mem = pausasMemoria.get(clavePausa(telefonoBot, id)) || {};

    if (!data) {
        const v = vacia();
        v.telefonoCliente = id.telefonoCliente;
        v.bsuid = id.bsuid;
        v.botPausado = Boolean(mem.botPausado);
        v.fallosEntendimiento = Number(mem.fallosEntendimiento) || 0;
        return v;
    }

    return {
        userName: data.user_name || null,
        mensajes: Array.isArray(data.mensajes) ? data.mensajes : [],
        ultimaCita: data.ultima_cita || null,
        pendingBooking: data.pending_booking || null,
        pendingReminder: data.pending_reminder || null,
        pendingOwnerAction: data.pending_owner_action || null,
        pendingOferta: data.pending_oferta || null,
        botPausado: Boolean(data.bot_pausado ?? mem.botPausado),
        fallosEntendimiento: Number(data.fallos_entendimiento ?? mem.fallosEntendimiento) || 0,
        bsuid: data.bsuid || id.bsuid || null,
        telefonoCliente: data.telefono_cliente || id.telefonoCliente || null
    };
}

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

    pausasMemoria.set(clavePausa(telefonoBot, id), {
        botPausado: Boolean(conv.botPausado),
        fallosEntendimiento: Number(conv.fallosEntendimiento) || 0
    });

    const filaBase = {
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

    const filaV11 = {
        ...filaBase,
        bot_pausado: Boolean(conv.botPausado),
        fallos_entendimiento: Number(conv.fallosEntendimiento) || 0
    };

    const filaV12 = {
        ...filaV11,
        pending_oferta: conv.pendingOferta || null
    };

    async function upsert(fila) {
        if (id.telefonoCliente) {
            return supabase.from('conversaciones').upsert(fila, {
                onConflict: 'telefono_bot,telefono_cliente'
            });
        }
        const { data: existente } = await supabase
            .from('conversaciones')
            .select('id')
            .eq('telefono_bot', telefonoBot)
            .eq('bsuid', id.bsuid)
            .maybeSingle();

        if (existente?.id) {
            return supabase.from('conversaciones').update(fila).eq('id', existente.id);
        }
        return supabase.from('conversaciones').insert(fila);
    }

    let { error } = await upsert(columnasV12 === false
        ? (columnasV11 === false ? filaBase : filaV11)
        : filaV12);

    if (error && columnasV12 !== false && /pending_oferta/i.test(error.message)) {
        columnasV12 = false;
        ({ error } = await upsert(columnasV11 === false ? filaBase : filaV11));
    }

    if (error && columnasV11 !== false && /bot_pausado|fallos_entendimiento/i.test(error.message)) {
        columnasV11 = false;
        ({ error } = await upsert(filaBase));
    }

    if (error && /schema cache|does not exist/i.test(error.message)) {
        // El error no dice qué columna falta: se degrada de a una.
        if (columnasV12 !== false) {
            columnasV12 = false;
            ({ error } = await upsert(columnasV11 === false ? filaBase : filaV11));
        } else if (columnasV11 !== false) {
            columnasV11 = false;
            ({ error } = await upsert(filaBase));
        }
    }

    if (!error) {
        if (columnasV11 !== false) columnasV11 = true;
        if (columnasV12 !== false) columnasV12 = true;
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

    pausasMemoria.delete(clavePausa(telefonoBot, id));

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
