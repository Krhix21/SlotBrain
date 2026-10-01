// ============================================================
// Cliente OAuth2 de Google, uno por trabajador.
//
// Cada trabajador autoriza SU propio Google Calendar, así que cada uno
// tiene su refresh_token y su propio cliente. No hay un token compartido:
// por eso `freebusy.query` se llama una vez por trabajador y no una sola
// vez con los 50 calendarios del endpoint.
// ============================================================

const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * @param {string} refreshToken - refresh_token guardado en `trabajadores`
 * @param {Array<string>} scopes
 */
function crearCliente(refreshToken, scopes = SCOPES) {
    const cliente = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    cliente.setCredentials({ refresh_token: refreshToken });
    return cliente;
}

/** Cliente de Calendar ya autenticado con el token del trabajador. */
function crearCalendar(refreshToken) {
    return google.calendar({ version: 'v3', auth: crearCliente(refreshToken) });
}

module.exports = { crearCliente, crearCalendar, SCOPES };
