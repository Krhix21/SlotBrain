const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const botState = require('./botState');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

function crearOAuthClient() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
}

function setupAuthRoutes(app) {
    // Paso A: el trabajador llega aquí (desde el botón de la página de vinculación)
    app.get('/auth/google', (req, res) => {
        const { telefono_bot } = req.query;
        if (!telefono_bot) {
            return res.status(400).send('Falta el parámetro telefono_bot en la URL.');
        }

        const oauth2Client = crearOAuthClient();

        const url = oauth2Client.generateAuthUrl({
            access_type: 'offline',   // necesario para obtener refresh_token
            prompt: 'consent',        // fuerza a que SIEMPRE devuelva refresh_token
            scope: SCOPES,
            state: telefono_bot       // así sabemos a quién pertenece cuando Google nos devuelva
        });

        res.redirect(url);
    });

    // Paso B: Google redirige aquí después de que el barbero acepta (o rechaza) los permisos
    app.get('/auth/google/callback', async (req, res) => {
        const { code, state: telefono_bot, error } = req.query;

        if (error) {
            // el barbero canceló o rechazó el permiso
            return res.send(paginaResultado(false, 'Cancelaste la conexión. Puedes intentarlo de nuevo cuando quieras.'));
        }

        if (!code || !telefono_bot) {
            return res.status(400).send(paginaResultado(false, 'Faltan datos en la respuesta de Google.'));
        }

        try {
            const oauth2Client = crearOAuthClient();
            const { tokens } = await oauth2Client.getToken(code);

            if (!tokens.refresh_token) {
                // Pasa cuando el trabajador ya había autorizado antes y Google no reenvía el refresh_token
                return res.status(400).send(paginaResultado(
                    false,
                    'No se pudo completar la conexión porque ya habías autorizado esta app antes. ' +
                    'Ve a https://myaccount.google.com/permissions, quita el acceso de esta app y vuelve a intentarlo.'
                ));
            }

            oauth2Client.setCredentials(tokens);

            // No pedimos scope de perfil/email aparte: el ID del calendario "primary"
            // ES el correo del usuario, así que lo sacamos directo de la API de Calendar
            // (evita el 401 de /oauth2/v2/userinfo por falta de scope).
            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
            const { data: calendarioPrincipal } = await calendar.calendarList.get({ calendarId: 'primary' });
            const correoUsuario = calendarioPrincipal.id;

            const { error: dbError } = await supabase
                .from('trabajadores')
                .upsert(
                    {
                        telefono_bot,
                        correo: correoUsuario,
                        refresh_token: tokens.refresh_token,
                        activo: true
                    },
                    { onConflict: 'telefono_bot' }
                );

            if (dbError) {
                console.error('❌ Error guardando en Supabase:', dbError);
                return res.status(500).send(paginaResultado(false, 'Hubo un error guardando tu conexión. Intenta de nuevo.'));
            }

            console.log(`✅ Trabajador conectado: ${telefono_bot} -> ${correoUsuario}`);
            botState.setCalendarConectado(true, correoUsuario);
            res.send(paginaResultado(true, `Tu calendario (${correoUsuario}) ya está conectado.`));
        } catch (err) {
            console.error('❌ Error en callback de Google:', err);
            res.status(500).send(paginaResultado(false, 'Hubo un error conectando tu cuenta. Intenta de nuevo.'));
        }
    });
}

function paginaResultado(exito, mensaje) {
    const color = exito ? '#f59e0b' : '#ef4444';
    const titulo = exito ? '¡Conexión exitosa! 💈' : 'Algo salió mal';
    return `
    <html>
      <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #0c0a09; color: #fff;">
        <h1 style="color: ${color}; font-size: 28px;">${titulo}</h1>
        <p style="color: #d6d3d1; font-size: 16px; margin-top: 10px;">${mensaje}</p>
        <p style="color: #78716c; font-size: 13px; margin-top: 20px;">Puedes cerrar esta pestaña.</p>
      </body>
    </html>
  `;
}

module.exports = { setupAuthRoutes };