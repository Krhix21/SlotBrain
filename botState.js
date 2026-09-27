// Estado en memoria compartido entre bot.js (que genera el QR y detecta el número)
// y server.js/auth.js (que lo exponen a la página de vinculación vía /api/estado).

const state = {
    qrDataUrl: null,      // imagen QR en base64 para mostrar en el navegador
    whatsappListo: false, // true cuando ya se escaneó el QR y whatsapp-web.js está conectado
    telefonoBot: null,    // número de WhatsApp del barbero, obtenido automáticamente al conectar
    calendarConectado: false,
    correoCalendario: null
};

function setQr(dataUrl) {
    state.qrDataUrl = dataUrl;
    state.whatsappListo = false;
}

function setWhatsappListo(telefonoBot) {
    state.whatsappListo = true;
    state.qrDataUrl = null;
    state.telefonoBot = telefonoBot;
}

function setCalendarConectado(conectado, correo = null) {
    state.calendarConectado = conectado;
    state.correoCalendario = correo;
}

function getState() {
    return { ...state };
}

module.exports = { setQr, setWhatsappListo, setCalendarConectado, getState };
