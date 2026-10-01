// ============================================================
// OAuth con Google Calendar.
//
// Cada trabajador enlaza SU calendario. La URL de arranque lleva un token
// firmado por el servidor con el id del trabajador: sin él, cualquiera que
// visitara /auth/google?telefono_bot=... podría sobreescribir el
// refresh_token de otro trabajador.
//
// Flujo:
//   1. El admin (ya autenticado en el panel) pide un link
//   2. Se lo pasa al trabajador, que abre el link
//   3. Google redirige a /auth/google/callback con el code
//   4. Se guarda el refresh_token de ESE trabajador por id
// ============================================================

const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const { crearCliente, SCOPES } = require('./googleAuth');
const botState = require('./botState');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const VIGENCIA_LINK_MS = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Secreto con el que se firman los enlaces de vinculación.
 *
 * Antes caía a una constante escrita en el código ('xheros'), lo que
 * dejaba la puerta abierta: sabiendo eso, cualquiera podía firmar un
 * enlace para el id que quisiera y enlazar su propio Google Calendar al
 * calendario de otro profesional. Si no hay secreto configurado, no se
 * firma nada: es preferible bloquear el enlace que firmarlo sin protección.
 *
 * @returns {string|null}
 */
function secretoFirma() {
    return process.env.SECRETO_ENLACE || process.env.GOOGLE_CLIENT_SECRET || null;
}

/**
 * Firma un id de trabajador con HMAC para que el link no se pueda alterar.
 * @param {string} trabajadorId
 * @returns {string} token opaco
 * @throws si no hay secreto configurado
 */
function firmarLink(trabajadorId) {
    const secreto = secretoFirma();
    if (!secreto) {
        throw new Error(
            'Falta SECRETO_ENLACE (o GOOGLE_CLIENT_SECRET) en el entorno: no se pueden generar enlaces de Google Calendar.'
        );
    }

    const expira = Date.now() + VIGENCIA_LINK_MS;
    const carga = `${trabajadorId}.${expira}`;
    const firma = require('crypto')
        .createHmac('sha256', secreto)
        .update(carga)
        .digest('base64url');

    return Buffer.from(`${carga}.${firma}`).toString('base64url');
}

/**
 * Valida un token de enlace.
 * @returns {{ok:true, trabajadorId:string}|{ok:false, motivo:string}}
 */
function verificarLink(token) {
    if (!token) return { ok: false, motivo: 'Link incompleto.' };

    const secreto = secretoFirma();
    if (!secreto) return { ok: false, motivo: 'Servidor sin secreto de vinculación configurado.' };

    let cargaYfirma;
    try {
        cargaYfirma = Buffer.from(token, 'base64url').toString('utf8');
    } catch {
        return { ok: false, motivo: 'Link inválido.' };
    }

    const partes = cargaYfirma.split('.');
    if (partes.length !== 3) return { ok: false, motivo: 'Link inválido.' };

    const [trabajadorId, expira, firma] = partes;

    // Un id de trabajador es un UUID: si no lo parece, el link está manipulado.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trabajadorId)) {
        return { ok: false, motivo: 'Link inválido.' };
    }

    const esperada = require('crypto')
        .createHmac('sha256', secreto)
        .update(`${trabajadorId}.${expira}`)
        .digest('base64url');

    const a = Buffer.from(firma);
    const b = Buffer.from(esperada);

    if (a.length !== b.length || !require('crypto').timingSafeEqual(a, b)) {
        return { ok: false, motivo: 'Link alterado. Pídele uno nuevo al administrador.' };
    }

    // Number() de algo no numérico da NaN, y NaN < fecha es false, así que
    // sin esta comprobación un token con expiración basura se aceptaba.
    if (!/^\d+$/.test(expira) || Number(expira) < Date.now()) {
        return { ok: false, motivo: 'Este link ya expiró. Pídele uno nuevo al administrador.' };
    }

    return { ok: true, trabajadorId };
}

function setupAuthRoutes(app) {
    // Paso A: el trabajador abre el link firmado que le dio el administrador.
    app.get('/auth/google', (req, res) => {
        const { token } = req.query;

        const validado = verificarLink(token);
        if (!validado.ok) {
            return res.status(400).send(paginaResultado(false, validado.motivo));
        }

        const oauth2Client = crearCliente(null);

        const url = oauth2Client.generateAuthUrl({
            access_type: 'offline',   // necesario para obtener refresh_token
            prompt: 'consent',        // fuerza a que SIEMPRE devuelva refresh_token
            include_granted_scopes: true,
            scope: SCOPES,
            state: token              // el mismo token vuelve en el callback
        });

        res.redirect(url);
    });

    // Paso B: Google devuelve el control con el code.
    app.get('/auth/google/callback', async (req, res) => {
        const { code, state, error } = req.query;

        if (error) {
            return res.send(paginaResultado(false, 'Cancelaste la conexión. Puedes intentarlo de nuevo cuando quieras.'));
        }

        if (!code || !state) {
            return res.status(400).send(paginaResultado(false, 'Faltan datos en la respuesta de Google.'));
        }

        const validado = verificarLink(state);
        if (!validado.ok) {
            return res.status(400).send(paginaResultado(false, validado.motivo));
        }

        const { trabajadorId } = validado;

        try {
            const oauth2Client = crearCliente(null);
            const { tokens } = await oauth2Client.getToken(code);

            if (!tokens.refresh_token) {
                // Pasa cuando el trabajador ya había autorizado antes y Google
                // no reenvía el refresh_token.
                return res.status(400).send(paginaResultado(
                    false,
                    'No se pudo completar porque ya habías autorizado esta app antes. ' +
                    'Ve a https://myaccount.google.com/permissions, quita el acceso de esta app y vuelve a intentarlo.'
                ));
            }

            // El id del calendario "primary" ES el correo del usuario, así que
            // no hace falta pedir scope de perfil/email.
            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
            const { data: calendarioPrincipal } = await calendar.calendarList.get({ calendarId: 'primary' });
            const correoUsuario = calendarioPrincipal.id;

            const { data: trabajador, error: errorDb } = await supabase
                .from('trabajadores')
                .update({
                    correo: correoUsuario,
                    refresh_token: tokens.refresh_token,
                    activo: true
                })
                .eq('id', trabajadorId)
                .select('id, nombre, empresa_id')
                .single();

            if (errorDb) {
                console.error('❌ Error guardando en Supabase:', errorDb);
                return res.status(500).send(paginaResultado(false, 'Hubo un error guardando tu conexión. Intenta de nuevo.'));
            }

            console.log(`✅ Calendario enlazado: ${trabajador?.nombre || trabajadorId} → ${correoUsuario}`);
            botState.setCalendarConectado(trabajadorId, correoUsuario);

            res.send(paginaResultado(
                true,
                `Tu calendario (${correoUsuario}) ya está enlazado${trabajador?.nombre ? `, ${trabajador.nombre}` : ''}. Ya puedes cerrar esta pestaña.`
            ));
        } catch (err) {
            console.error('❌ Error en callback de Google:', err);
            res.status(500).send(paginaResultado(false, 'Hubo un error conectando tu cuenta. Intenta de nuevo.'));
        }
    });
}

function paginaResultado(exito, mensaje) {
    const color = exito ? '#f59e0b' : '#ef4444';
    const titulo = exito ? '¡Conexión exitosa!' : 'Algo salió mal';
    return `
    <html>
      <head><meta charset="utf-8"><title>${titulo}</title></head>
      <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #0c0a09; color: #fff;">
        <h1 style="color: ${color}; font-size: 28px;">${titulo}</h1>
        <p style="color: #d6d3d1; font-size: 16px; margin-top: 10px;">${mensaje}</p>
        <p style="color: #78716c; font-size: 13px; margin-top: 20px;">Puedes cerrar esta pestaña.</p>
      </body>
    </html>
  `;
}

module.exports = { setupAuthRoutes, firmarLink };
