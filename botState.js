// Estado en memoria compartido entre auth.js (que enlaza el Google Calendar
// de un trabajador) y el panel de administración.
//
// Antes vivía aquí el QR de whatsapp-web.js. Con la Cloud API de Meta el
// número ya se conoce por configuración, así que no hay nada que escanear.
//
// OJO con el alcance de esto: es memoria del proceso, no estado real. Se
// pierde en cada deploy y con varios workers de Render hay instancias
// distintas. La fuente de verdad de si un calendario está enlazado es la
// tabla `trabajadores.refresh_token`. Esto solo sirve para que la página
// pública pueda decir "hay calendarios enlazados" sin tocar la base.

/** trabajador_id -> correo del calendario enlazado */
const calendarios = new Map();

/**
 * Registra un calendario enlazado.
 * @param {string} trabajadorId
 * @param {string|null} correo
 */
function setCalendarConectado(trabajadorId, correo = null) {
    if (!trabajadorId) return;
    if (correo) {
        calendarios.set(trabajadorId, correo);
    } else {
        calendarios.set(trabajadorId, null);
    }
}

/**
 * Resumen para la página pública.
 * No devuelve los correos: esa ruta no lleva autenticación y un correo de
 * Google es dato personal de un tercero.
 */
function getState() {
    return {
        calendarConectado: calendarios.size > 0,
        calendariosEnlazados: calendarios.size
    };
}

module.exports = { setCalendarConectado, getState };
