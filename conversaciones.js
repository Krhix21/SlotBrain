// ============================================================
// Estado conversacional, guardado en Supabase (tabla `conversaciones`).
//
// Antes vivía en `conversaciones.json`, que en Render se pierde en
// cada deploy y además se releía completo en cada operación (hasta 8
// lecturas por mensaje). Ahora hay UN select y UN upsert por mensaje.
//
// Topes para no saturar Supabase:
//   - 1 fila por conversación, no 1 fila por mensaje
//   - solo los últimos 6 mensajes, recortados a 500 caracteres
//   - conversaciones sin actividad hace 30 días se eliminan
//
// Clave: (telefono_bot, telefono_cliente). El teléfono del bot entra en
// la clave porque el mismo cliente puede hablar con dos empresas distintas
// y su historial no debe mezclarse.
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const MAX_MENSAJES = 6;
const MAX_CHARS_MENSAJE = 500;
const DIAS_EXPIRA = 30;
const INTERVALO_BARRIDO_MS = 6 * 60 * 60 * 1000;

let ultimoBarrido = 0;

/** Estado vacío. */
function vacia() {
    return {
        userName: null,
        mensajes: [],
        ultimaCita: null,
        pendingBooking: null
    };
}

/**
 * Carga el estado de una conversación.
 * @returns {Promise<{userName:string|null, mensajes:Array, ultimaCita:object|null, pendingBooking:object|null}>}
 */
async function cargar(telefonoBot, telefonoCliente) {
    const { data, error } = await supabase
        .from('conversaciones')
        .select('user_name, mensajes, ultima_cita, pending_booking')
        .eq('telefono_bot', telefonoBot)
        .eq('telefono_cliente', telefonoCliente)
        .maybeSingle();

    if (error) {
        console.error('Error cargando conversación:', error.message);
        return vacia();
    }

    if (!data) return vacia();

    return {
        userName: data.user_name || null,
        mensajes: Array.isArray(data.mensajes) ? data.mensajes : [],
        ultimaCita: data.ultima_cita || null,
        pendingBooking: data.pending_booking || null
    };
}

/** Persiste el estado. Aplica los topes antes de escribir. */
async function guardar(telefonoBot, telefonoCliente, conv) {
    conv.mensajes = (conv.mensajes || []).slice(-MAX_MENSAJES);

    const { error } = await supabase.from('conversaciones').upsert(
        {
            telefono_bot: telefonoBot,
            telefono_cliente: telefonoCliente,
            user_name: conv.userName || null,
            mensajes: conv.mensajes,
            ultima_cita: conv.ultimaCita || null,
            pending_booking: conv.pendingBooking || null
        },
        { onConflict: 'telefono_bot,telefono_cliente' }
    );

    if (error) {
        console.error('Error guardando conversación:', error.message);
        return;
    }

    barrerEnSegundoPlano();
}

/** Agrega un mensaje al buffer respetando el tope de 6. */
function agregarMensaje(conv, role, content) {
    const limpio = String(content || '').slice(0, MAX_CHARS_MENSAJE);
    conv.mensajes = [...(conv.mensajes || []), { role, content: limpio }].slice(-MAX_MENSAJES);
}

/** ¿Es la primera interacción (no hay nombre ni historial)? */
function esPrimeraConversacion(conv) {
    return !conv.userName && (!conv.mensajes || conv.mensajes.length === 0);
}

/** Elimina el estado de una conversación. */
async function eliminar(telefonoBot, telefonoCliente) {
    const { error } = await supabase
        .from('conversaciones')
        .delete()
        .eq('telefono_bot', telefonoBot)
        .eq('telefono_cliente', telefonoCliente);

    if (error) console.error('Error eliminando conversación:', error.message);
}

/**
 * Elimina conversaciones sin actividad hace más de DIAS_EXPIRA.
 * Corre una vez cada INTERVALO_BARRIDO_MS, en segundo plano y sin
 * bloquear la respuesta al cliente.
 */
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
