require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const { setupAuthRoutes } = require('./auth');
const { setupAdminRoutes } = require('./admin');
const botState = require('./botState');
const bot = require('./bot');
const numeros = require('./numeros');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Guardamos el rawBody porque lo necesitamos para verificar la firma
// que Meta envía en cada POST del webhook (X-Hub-Signature-256).
app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(express.static(path.join(__dirname, 'public')));

setupAuthRoutes(app);
setupAdminRoutes(app);

app.get('/api/estado', (req, res) => {
    res.json(botState.getState());
});

app.get('/health', async (req, res) => {
    try {
        const { error } = await supabase.from('numeros_bot').select('id').limit(1);
        res.json({ ok: !error, supabase: !error });
    } catch (error) {
        res.status(503).json({ ok: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    res.send('Bot de WhatsApp con Meta Cloud API activo 💈');
});

// ============================================================
// Webhook de Meta WhatsApp Cloud API
// ============================================================

// 1) Verificación del webhook (Meta hace un GET la primera vez que
//    guardas la URL, y cada vez que la reconfigures).
app.get('/webhook/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
        console.log('✅ Webhook de WhatsApp verificado correctamente.');
        return res.status(200).send(challenge);
    }

    console.warn('⚠️  Intento de verificación de webhook con token inválido.');
    return res.sendStatus(403);
});

// ============================================================
// Dedup de webhooks
//
// Meta reintenta el POST si la respuesta tarda, y a veces entrega el
// mismo mensaje dos veces. Sin esto, un "sí" del cliente se podía
// procesar dos veces y agendar dos citas.
//
// Guardamos el message_id en Supabase con una clave primaria: si el
// INSERT choca con el duplicado, el mensaje ya se procesó y se descarta.
//
// El INSERT hace de "reserva" atómica: dos entregas simultáneas del mismo
// mensaje, solo una gana. Si el procesamiento falla después, la reserva se
// borra (liberarMensaje) para que el reintento de Meta pueda hacer su
// trabajo. Marcarlo como visto antes de saber si salió bien hacía que un
// fallo en el camino perdiera el mensaje sin que nadie lo notara.
// ============================================================
const REINTENTO_MS = 24 * 60 * 60 * 1000;

async function yaProcesado(messageId, botTelefono) {
    if (!messageId) return false;

    const { error } = await supabase
        .from('mensajes_webhook')
        .insert({ message_id: messageId, telefono_bot: botTelefono });

    if (!error) {
        // El registro ya existía: es un reintento de Meta.
        return true;
    }

    // 23505 = duplicate key. Cualquier otro error no debe bloquear el mensaje.
    if (error.code === '23505') return true;

    console.warn('⚠️  No se pudo registrar el message_id para dedup:', error.message);
    return false;
}

/** Libera la reserva de un mensaje que no se pudo procesar. */
async function liberarMensaje(messageId) {
    if (!messageId) return;
    const { error } = await supabase
        .from('mensajes_webhook')
        .delete()
        .eq('message_id', messageId);

    if (error) {
        console.warn(`⚠️  No se pudo liberar el message_id ${messageId}:`, error.message);
    }
}

// 2) Recepción de mensajes entrantes.
app.post('/webhook/whatsapp', (req, res) => {
    // Respondemos 200 de inmediato: Meta espera una respuesta rápida
    // y reintenta el POST si no la recibe en pocos segundos.
    res.sendStatus(200);

    procesarWebhook(req).catch(error => {
        console.error('❌ Error procesando webhook de WhatsApp:', error);
    });
});

async function procesarWebhook(req) {
    try {
        if (process.env.META_APP_SECRET && !firmaValida(req)) {
            console.warn('⚠️  Firma de webhook inválida, mensaje ignorado.');
            return;
        }

        // Un solo POST puede traer varias entradas y varios cambios.
        for (const entry of req.body?.entry || []) {
            for (const change of entry.changes || []) {
                if (change.field !== 'messages') continue;
                await procesarCambio(change.value);
            }
        }
    } catch (error) {
        console.error('❌ Error en procesarWebhook:', error);
    }
}

async function procesarCambio(value) {
    const telefonoBot = numeros.normalizarTelefono(value?.metadata?.display_phone_number);
    const phoneNumberIdMeta = value?.metadata?.phone_number_id;

    for (const mensaje of value?.messages || []) {
        const texto = extraerTexto(mensaje);
        const telefonoCliente = mensaje.from;

        if (!texto) {
            console.log(`ℹ️  Mensaje de tipo "${mensaje.type}" sin texto plano, se ignora.`);
            continue;
        }

        if (await yaProcesado(mensaje.id, telefonoBot)) {
            console.log(`♻️  Mensaje ${mensaje.id} duplicado, se ignora.`);
            continue;
        }

        // No hay await: ya respondimos 200, esto corre en segundo plano.
        // Si algo falla, se suelta la reserva del dedup para que el
        // reintento de Meta vuelva a intentar en vez de descartarse.
        bot.procesarMensajeWhatsapp({
            telefonoBot,
            phoneNumberId: phoneNumberIdMeta,
            telefonoCliente,
            texto,
            messageId: mensaje.id
        })
            .catch(error => {
                console.error('❌ Error en procesarMensajeWhatsapp:', error);
                return liberarMensaje(mensaje.id);
            });
    }
}

function extraerTexto(mensaje) {
    if (mensaje.type === 'text') return mensaje.text?.body;
    if (mensaje.type === 'button') return mensaje.button?.text;
    if (mensaje.type === 'interactive') {
        return mensaje.interactive?.button_reply?.title
            || mensaje.interactive?.list_reply?.title
            || null;
    }
    return null;
}

function firmaValida(req) {
    const firmaRecibida = req.get('X-Hub-Signature-256');
    if (!firmaRecibida || !req.rawBody) return false;

    const firmaEsperada = 'sha256=' + crypto
        .createHmac('sha256', process.env.META_APP_SECRET)
        .update(req.rawBody)
        .digest('hex');

    // Comparación de longitud fija para no filtrar nada por el tiempo de respuesta.
    const a = Buffer.from(firmaRecibida);
    const b = Buffer.from(firmaEsperada);

    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Limpieza periódica de ids de webhooks ya viejos.
setInterval(() => {
    supabase
        .from('mensajes_webhook')
        .delete()
        .lt('creado_en', new Date(Date.now() - REINTENTO_MS).toISOString())
        .then(({ error }) => {
            if (error) console.warn('Error limpiando mensajes_webhook:', error.message);
        })
        .catch(() => {});
}, 6 * 60 * 60 * 1000).unref();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
    bot.iniciar();
});
