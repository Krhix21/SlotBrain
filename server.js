require('dotenv').config();
const express = require('express');
const path = require('path');
const { setupAuthRoutes } = require('./auth');
const { setupAdminRoutes } = require('./admin');
const botState = require('./botState');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

setupAuthRoutes(app);
setupAdminRoutes(app);

// La página public/vincular.html consulta esto cada 2 segundos para saber
// si debe mostrar el QR de WhatsApp o ya el botón de "Conectar con Google".
app.get('/api/estado', (req, res) => {
    res.json(botState.getState());
});

app.get('/', (req, res) => {
    res.send('Xheros Barber backend activo 💈');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor de auth/backend corriendo en puerto ${PORT}`);
});

// Arrancamos el bot de WhatsApp en el mismo proceso.
// Si prefieres correrlo aparte (recomendado en producción), comenta esta línea
// y ejecuta `node bot.js` en un proceso separado.
require('./bot');
