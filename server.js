require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { setupAuthRoutes } = require('./auth');
const { setupAdminRoutes } = require('./admin');
const botState = require('./botState');
const bot = require('./bot');

const app = express();

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

app.get('/', (req, res) => {
    res.send('Xheros Barber backend activo 💈');
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

// 2) Recepción de mensajes entrantes (Meta hace POST cada vez que
//    llega un mensaje, un estado de entrega, etc.)
app.post('/webhook/whatsapp', (req, res) => {
    // Respondemos 200 de inmediato: Meta espera una respuesta rápida
    // y reintenta el POST si no la recibe en pocos segundos.
    res.sendStatus(200);

    try {
        if (process.env.META_APP_SECRET && !firmaValida(req)) {
            console.warn('⚠️  Firma de webhook inválida, mensaje ignorado.');
            return;
        }

        const entry = req.body?.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;
        const mensaje = value?.messages?.[0];

        if (!mensaje) {
            // Puede ser un evento de "status" (entregado/leído), no un mensaje nuevo.
            return;
        }

        const telefonoCliente = mensaje.from; // ya viene sin "+", ej "573001234567"
        const messageId = mensaje.id;

        let textoMensaje = null;
        if (mensaje.type === 'text') {
            textoMensaje = mensaje.text?.body;
        } else if (mensaje.type === 'button') {
            textoMensaje = mensaje.button?.text;
        } else if (mensaje.type === 'interactive') {
            textoMensaje = mensaje.interactive?.button_reply?.title
                || mensaje.interactive?.list_reply?.title;
        }

        if (!textoMensaje) {
            console.log(`ℹ️  Mensaje entrante de tipo "${mensaje.type}" sin texto plano, se ignora.`);
            return;
        }

        // No usamos await aquí a propósito: ya respondimos 200 arriba,
        // esto corre en segundo plano.
        bot.procesarMensajeWhatsapp(telefonoCliente, textoMensaje, messageId);
    } catch (error) {
        console.error('❌ Error procesando webhook de WhatsApp:', error);
    }
});

function firmaValida(req) {
    const firmaRecibida = req.get('X-Hub-Signature-256');
    if (!firmaRecibida || !req.rawBody) return false;

    const firmaEsperada = 'sha256=' + crypto
        .createHmac('sha256', process.env.META_APP_SECRET)
        .update(req.rawBody)
        .digest('hex');

    try {
        return crypto.timingSafeEqual(Buffer.from(firmaRecibida), Buffer.from(firmaEsperada));
    } catch {
        return false;
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor de auth/backend corriendo en puerto ${PORT}`);
    bot.iniciar();
});