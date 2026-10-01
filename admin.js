const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const numeros = require('./numeros');
const bot = require('./bot');
const { firmarLink } = require('./auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ============================================================
// Sesiones
//
// En memoria: se pierden en cada deploy de Render, lo cual obliga a
// volver a entrar. Para un panel de un solo operador es aceptable; si
// hubiera varios, esto debería ir a una tabla o a Redis.
// ============================================================
const sessions = new Map();
const SESSION_TTL = 8 * 60 * 60 * 1000;

function generarToken() {
    return crypto.randomBytes(32).toString('hex');
}

function limpiarSesionesVencidas() {
    const ahora = Date.now();
    for (const [token, expira] of sessions) {
        if (ahora > expira) sessions.delete(token);
    }
}

function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    const token = auth.slice(7);
    const expira = sessions.get(token);

    if (!expira || Date.now() > expira) {
        sessions.delete(token);
        return res.status(401).json({ error: 'Sesión expirada' });
    }
    next();
}

async function login(req, res) {
    const { usuario, password } = req.body || {};

    if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) {
        console.error('❌ Faltan ADMIN_USER o ADMIN_PASSWORD. El panel queda bloqueado.');
        return res.status(503).json({ error: 'El panel no está configurado: faltan ADMIN_USER o ADMIN_PASSWORD.' });
    }

    // Frena la fuerza bruta a costa de 500 ms por intento.
    await new Promise(r => setTimeout(r, 500));

    const usuarioOk = comparar(req.body?.usuario, process.env.ADMIN_USER);
    const passOk = comparar(password, process.env.ADMIN_PASSWORD);

    if (!usuarioOk || !passOk) {
        console.warn(`⚠️  Intento de login fallido para "${usuario}".`);
        return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = generarToken();
    sessions.set(token, Date.now() + SESSION_TTL);
    res.json({ token, usuario: process.env.ADMIN_USER });
}

function logout(req, res) {
    const token = req.headers.authorization?.slice(7);
    if (token) sessions.delete(token);
    res.json({ ok: true });
}

function validateSession(req, res) {
    res.json({ valid: true });
}

/** Comparación de longitud fija para no filtrar nada por tiempo de respuesta. */
function comparar(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// ============================================================
// Utilidades
// ============================================================

/**
 * Copia SOLO las claves permitidas del body.
 * Evita mass assignment: sin esto, un PUT podía mandar
 * `{ "refresh_token": "..." }` y cambiar credenciales ajenas.
 */
function soloCampos(body, permitidos) {
    const salida = {};
    for (const clave of permitidos) {
        if (body && body[clave] !== undefined) salida[clave] = body[clave];
    }
    return salida;
}

function fallo(res, mensaje, codigo = 400) {
    return res.status(codigo).json({ error: mensaje });
}

function servidorError(res, contexto, error) {
    console.error(`❌ ${contexto}:`, error.message || error);
    return res.status(500).json({ error: 'Error interno del servidor' });
}

// ============================================================
// Empresas
// ============================================================

const CAMPOS_EMPRESA = [
    'nombre', 'descripcion', 'telefono', 'direccion',
    'zona_horaria', 'horario', 'slot_minutos',
    'mensaje_bienvenida', 'mensaje_confirmacion'
];

async function getEmpresas(req, res) {
    try {
        const { data, error } = await supabase.from('empresas').select('*').order('nombre');
        if (error) throw error;
        res.json(data);
    } catch (error) {
        servidorError(res, 'Error obteniendo empresas', error);
    }
}

async function createEmpresa(req, res) {
    try {
        const updates = soloCampos(req.body, CAMPOS_EMPRESA);

        if (!updates.nombre) return fallo(res, 'El nombre de la empresa es requerido');

        updates.zona_horaria = updates.zona_horaria || 'America/Bogota';
        updates.slot_minutos = updates.slot_minutos || 30;

        const { data, error } = await supabase.from('empresas').insert(updates).select().single();
        if (error) throw error;

        res.status(201).json(data);
    } catch (error) {
        servidorError(res, 'Error creando empresa', error);
    }
}

async function updateEmpresa(req, res) {
    try {
        const updates = soloCampos(req.body, CAMPOS_EMPRESA);

        if (Object.keys(updates).length === 0) {
            return fallo(res, 'No enviaste ningún campo editable');
        }

        const { data, error } = await supabase
            .from('empresas')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return fallo(res, 'Empresa no encontrada', 404);

        bot.limpiarCacheConfiguracion();
        res.json(data);
    } catch (error) {
        servidorError(res, 'Error actualizando empresa', error);
    }
}

// ============================================
// Números de respuesta (Meta Cloud API)
// ============================================

async function getNumeros(req, res) {
    try {
        const lista = await numeros.listarPorEmpresa(req.params.empresa_id);
        res.json(lista);
    } catch (error) {
        servidorError(res, 'Error listando números', error);
    }
}

async function createNumero(req, res) {
    try {
        const { telefono, phone_number_id, etiqueta } = req.body || {};

        const telefonoNormalizado = numeros.normalizarTelefono(telefono);
        if (!telefonoNormalizado) {
            return fallo(res, 'El teléfono es requerido (formato internacional, ej. 573001234567)');
        }
        if (!phone_number_id) {
            return fallo(res, 'El phone_number_id de Meta es requerido');
        }

        const { data, error } = await supabase
            .from('numeros_bot')
            .insert({
                empresa_id: req.params.empresa_id,
                telefono: telefonoNormalizado,
                phone_number_id,
                etiqueta: etiqueta || null,
                activo: true
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return fallo(res, 'Ese teléfono o phone_number_id ya está registrado.', 409);
            }
            throw error;
        }

        numeros.limpiarCache();
        res.status(201).json(data);
    } catch (error) {
        servidorError(res, 'Error creando número', error);
    }
}

async function updateNumero(req, res) {
    try {
        const updates = soloCampos(req.body, ['phone_number_id', 'etiqueta', 'activo']);

        const { data, error } = await supabase
            .from('numeros_bot')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return fallo(res, 'Número no encontrado', 404);

        numeros.limpiarCache();
        res.json(data);
    } catch (error) {
        servidorError(res, 'Error actualizando número', error);
    }
}

async function deleteNumero(req, res) {
    try {
        const { data, error } = await supabase
            .from('numeros_bot')
            .delete()
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return fallo(res, 'Número no encontrado', 404);

        numeros.limpiarCache();
        res.json({ ok: true });
    } catch (error) {
        servidorError(res, 'Error eliminando número', error);
    }
}

// ============================================
// Trabajadores
// ============================================

// NOTA: refresh_token y correo NUNCA son editables desde aquí.
// El refresh_token solo se escribe en el callback de Google (auth.js).
const CAMPOS_TRABAJADOR = [
    'nombre', 'empresa_id', 'telefono', 'horario',
    'slot_minutos', 'orden', 'activo'
];

async function getTrabajadores(req, res) {
    try {
        let consulta = supabase
            .from('trabajadores')
            .select('id, nombre, empresa_id, telefono, correo, horario, slot_minutos, orden, activo, creado_en')
            .order('orden');

        if (req.query.empresa_id) consulta = consulta.eq('empresa_id', req.query.empresa_id);

        const { data, error } = await consulta;
        if (error) throw error;

        res.json(data);
    } catch (error) {
        servidorError(res, 'Error obteniendo trabajadores', error);
    }
}

async function createTrabajador(req, res) {
    try {
        const updates = soloCampos(req.body, CAMPOS_TRABAJADOR);

        if (!updates.empresa_id) return fallo(res, 'empresa_id es requerido');
        if (!updates.nombre) return fallo(res, 'nombre es requerido');

        updates.activo = updates.activo !== false;
        updates.slot_minutos = updates.slot_minutos || 30;

        const { data, error } = await supabase.from('trabajadores').insert(updates).select().single();
        if (error) throw error;

        res.status(201).json(data);
    } catch (error) {
        servidorError(res, 'Error creando trabajador', error);
    }
}

async function updateTrabajador(req, res) {
    try {
        const updates = soloCampos(req.body, CAMPOS_TRABAJADOR);

        if (Object.keys(updates).length === 0) {
            return fallo(res, 'No enviaste ningún campo editable');
        }

        const { data, error } = await supabase
            .from('trabajadores')
            .update(updates)
            .eq('id', req.params.id)
            .select('id, nombre, empresa_id, telefono, correo, horario, slot_minutos, orden, activo')
            .single();

        if (error) throw error;
        if (!data) return fallo(res, 'Trabajador no encontrado', 404);

        res.json(data);
    } catch (error) {
        servidorError(res, 'Error actualizando trabajador', error);
    }
}

/** Genera el link firmado para que un trabajador enlace SU calendario. */
async function linkCalendar(req, res) {
    try {
        const { data: trabajador, error } = await supabase
            .from('trabajadores')
            .select('id, nombre, correo')
            .eq('id', req.params.id)
            .maybeSingle();

        if (error) throw error;
        if (!trabajador) return fallo(res, 'Trabajador no encontrado', 404);

        const base = process.env.PUBLIC_URL
            || `${req.protocol}://${req.get('host')}`;

        const url = `${base}/auth/google?token=${firmarLink(trabajador.id)}`;

        res.json({ url, ya_conectado: !!trabajador.correo, correo: trabajador.correo });
    } catch (error) {
        if (/secreto de vinculaci/i.test(error.message)) {
            return res.status(500).json({ error: 'El servidor no tiene SECRETO_ENLACE configurado.' });
        }
        servidorError(res, 'Error generando link de calendar', error);
    }
}

async function desconectarCalendar(req, res) {
    try {
        const { data, error } = await supabase
            .from('trabajadores')
            .update({ refresh_token: null, correo: null })
            .eq('id', req.params.id)
            .select('id, nombre')
            .single();

        if (error) throw error;
        if (!data) return fallo(res, 'Trabajador no encontrado', 404);

        res.json({ ok: true });
    } catch (error) {
        servidorError(res, 'Error desconectando calendario', error);
    }
}

// ============================================
// Servicios por trabajador
// ============================================

async function getServiciosDeTrabajador(req, res) {
    try {
        const { data, error } = await supabase
            .from('servicios_trabajadores')
            .select('servicio_id')
            .eq('trabajador_id', req.params.id);

        if (error) throw error;
        res.json({ servicio_ids: (data || []).map(f => f.servicio_id) });
    } catch (error) {
        servidorError(res, 'Error obteniendo servicios del trabajador', error);
    }
}

/**
 * Reemplaza el set de servicios del trabajador.
 * Un array VACÍO significa "ofrece todos", que es la semántica
 * acordada: no se guarda ninguna fila.
 */
async function setServiciosDeTrabajador(req, res) {
    try {
        const { servicio_ids } = req.body || {};

        if (!Array.isArray(servicio_ids)) {
            return fallo(res, 'servicio_ids debe ser un array');
        }

        const trabajadorId = req.params.id;

        const { data: trabajador, error: errT } = await supabase
            .from('trabajadores')
            .select('id, empresa_id')
            .eq('id', trabajadorId)
            .maybeSingle();

        if (errT) throw errT;
        if (!trabajador) return fallo(res, 'Trabajador no encontrado', 404);

        // Validar que los servicios pertenecen a la misma empresa.
        if (servicio_ids.length > 0) {
            const { data: validos, error: errS } = await supabase
                .from('servicios')
                .select('id')
                .eq('empresa_id', trabajador.empresa_id)
                .in('id', servicio_ids);

            if (errS) throw errS;

            const encontrados = (validos || []).map(s => s.id);
            const ajenos = servicio_ids.filter(id => !encontrados.includes(id));

            if (ajenos.length > 0) {
                return fallo(res, `Estos servicios no son de esta empresa: ${ajenos.join(', ')}`);
            }
        }

        const { error: errDel } = await supabase
            .from('servicios_trabajadores')
            .delete()
            .eq('trabajador_id', trabajadorId);

        if (errDel) throw errDel;

        if (servicio_ids.length > 0) {
            const filas = servicio_ids.map(sid => ({
                trabajador_id: trabajadorId,
                servicio_id: sid
            }));

            const { error: errIns } = await supabase.from('servicios_trabajadores').insert(filas);
            if (errIns) throw errIns;
        }

        res.json({ ok: true, cantidad: servicio_ids.length });
    } catch (error) {
        servidorError(res, 'Error guardando servicios del trabajador', error);
    }
}

// ============================================
// Bloqueos de disponibilidad
// ============================================

async function getBloqueos(req, res) {
    try {
        let consulta = supabase.from('bloqueos').select('*').order('fecha');

        if (req.query.trabajador_id) consulta = consulta.eq('trabajador_id', req.query.trabajador_id);
        if (req.query.fecha) consulta = consulta.eq('fecha', req.query.fecha);

        const { data, error } = await consulta;
        if (error) throw error;

        res.json(data);
    } catch (error) {
        servidorError(res, 'Error obteniendo bloqueos', error);
    }
}

async function createBloqueo(req, res) {
    try {
        const { trabajador_id, fecha, hora_inicio, hora_fin, motivo } = req.body || {};

        if (!trabajador_id) return fallo(res, 'trabajador_id es requerido');
        if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
            return fallo(res, 'La fecha es requerida en formato AAAA-MM-DD');
        }

        if (hora_inicio && hora_fin && hora_inicio >= hora_fin) {
            return fallo(res, 'hora_inicio debe ser anterior a hora_fin');
        }

        const { data, error } = await supabase
            .from('bloqueos')
            .insert({
                trabajador_id,
                fecha,
                hora_inicio: hora_inicio || null,
                hora_fin: hora_fin || null,
                motivo: motivo || null
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json(data);
    } catch (error) {
        servidorError(res, 'Error creando bloqueo', error);
    }
}

async function deleteBloqueo(req, res) {
    try {
        const { error } = await supabase.from('bloqueos').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ ok: true });
    } catch (error) {
        servidorError(res, 'Error eliminando bloqueo', error);
    }
}

// ============================================
// Servicios
// ============================================

const CAMPOS_SERVICIO = ['nombre', 'descripcion', 'precio', 'duracion_minutos', 'activo'];

async function getServiciosByEmpresa(req, res) {
    try {
        const incluirInactivos = req.query.todos === 'true';

        let consulta = supabase.from('servicios').select('*').eq('empresa_id', req.params.empresa_id);
        if (!incluirInactivos) consulta = consulta.eq('activo', true);

        const { data, error } = await consulta.order('nombre');
        if (error) throw error;

        res.json(data);
    } catch (error) {
        servidorError(res, 'Error obteniendo servicios', error);
    }
}

async function createServicio(req, res) {
    try {
        const updates = soloCampos(req.body, [...CAMPOS_SERVICIO, 'empresa_id']);

        if (!updates.empresa_id) return fallo(res, 'empresa_id es requerido');
        if (!updates.nombre) return fallo(res, 'nombre es requerido');
        if (updates.precio === undefined || updates.precio === null) {
            return fallo(res, 'precio es requerido');
        }

        updates.duracion_minutos = updates.duracion_minutos || 60;
        updates.activo = updates.activo !== false;

        const { data, error } = await supabase.from('servicios').insert(updates).select().single();
        if (error) throw error;

        bot.limpiarCacheConfiguracion();
        res.status(201).json(data);
    } catch (error) {
        servidorError(res, 'Error creando servicio', error);
    }
}

async function updateServicio(req, res) {
    try {
        const updates = soloCampos(req.body, CAMPOS_SERVICIO);

        if (Object.keys(updates).length === 0) {
            return fallo(res, 'No enviaste ningún campo editable');
        }

        const { data, error } = await supabase
            .from('servicios')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return fallo(res, 'Servicio no encontrado', 404);

        bot.limpiarCacheConfiguracion();
        res.json(data);
    } catch (error) {
        servidorError(res, 'Error actualizando servicio', error);
    }
}

async function deleteServicio(req, res) {
    try {
        const { data, error } = await supabase
            .from('servicios')
            .update({ activo: false })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return fallo(res, 'Servicio no encontrado', 404);

        bot.limpiarCacheConfiguracion();
        res.json({ ok: true });
    } catch (error) {
        servidorError(res, 'Error eliminando servicio', error);
    }
}

// ============================================
// Citas
// ============================================

const ESTADOS_CITA = ['agendada', 'confirmada', 'completada', 'cancelada', 'no_asistio'];
const CAMPOS_CITA_MANUAL = [
    'empresa_id', 'trabajador_id', 'nombre_cliente', 'telefono_cliente',
    'servicio_id', 'nombre_servicio', 'fecha', 'hora',
    'duracion_minutos', 'estado'
];

async function getCitasByEmpresa(req, res) {
    try {
        const { estado, fecha_desde, fecha_hasta, trabajador_id } = req.query;

        let consulta = supabase
            .from('citas')
            .select('*, trabajadores (id, nombre)')
            .eq('empresa_id', req.params.empresa_id);

        if (estado) consulta = consulta.eq('estado', estado);
        if (trabajador_id) consulta = consulta.eq('trabajador_id', trabajador_id);
        if (fecha_desde) consulta = consulta.gte('fecha', fecha_desde);
        if (fecha_hasta) consulta = consulta.lte('fecha', fecha_hasta);

        const { data, error } = await consulta.order('fecha', { ascending: false }).order('hora');
        if (error) throw error;

        res.json(data);
    } catch (error) {
        servidorError(res, 'Error obteniendo citas', error);
    }
}

/** Cita creada a mano desde el panel: no lleva evento de Google. */
async function createCita(req, res) {
    try {
        const updates = soloCampos(req.body, CAMPOS_CITA_MANUAL);

        if (!updates.empresa_id) return fallo(res, 'empresa_id es requerido');
        if (!updates.trabajador_id) return fallo(res, 'trabajador_id es requerido');
        if (!updates.nombre_cliente) return fallo(res, 'nombre_cliente es requerido');
        if (!updates.fecha) return fallo(res, 'fecha es requerida');
        if (!updates.hora) return fallo(res, 'hora es requerida');

        updates.estado = updates.estado || 'confirmada';
        updates.duracion_minutos = updates.duracion_minutos || 60;
        updates.canal = 'panel';

        const { data, error } = await supabase.from('citas').insert(updates).select().single();
        if (error) throw error;

        res.status(201).json(data);
    } catch (error) {
        servidorError(res, 'Error creando cita', error);
    }
}

async function updateCitaEstado(req, res) {
    try {
        const { estado } = req.body || {};

        if (!ESTADOS_CITA.includes(estado)) {
            return fallo(res, `Estado inválido. Valores permitidos: ${ESTADOS_CITA.join(', ')}`);
        }

        const { data, error } = await supabase
            .from('citas')
            .update({ estado })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return fallo(res, 'Cita no encontrada', 404);

        res.json(data);
    } catch (error) {
        servidorError(res, 'Error actualizando estado de la cita', error);
    }
}

// ============================================
// Rutas
// ============================================

function setupAdminRoutes(app) {
    app.post('/api/admin/login', login);
    app.post('/api/admin/logout', requireAuth, logout);
    app.get('/api/admin/validate', requireAuth, validateSession);

    // Empresas
    app.get('/api/admin/empresas', requireAuth, getEmpresas);
    app.post('/api/admin/empresas', requireAuth, createEmpresa);
    app.put('/api/admin/empresas/:id', requireAuth, updateEmpresa);

    // Números de respuesta
    app.get('/api/admin/numeros/:empresa_id', requireAuth, getNumeros);
    app.post('/api/admin/numeros/:empresa_id', requireAuth, createNumero);
    app.put('/api/admin/numeros/:id', requireAuth, updateNumero);
    app.delete('/api/admin/numeros/:id', requireAuth, deleteNumero);

    // Trabajadores
    app.get('/api/admin/trabajadores', requireAuth, getTrabajadores);
    app.post('/api/admin/trabajadores', requireAuth, createTrabajador);
    app.put('/api/admin/trabajadores/:id', requireAuth, updateTrabajador);
    app.get('/api/admin/trabajadores/:id/calendar-link', requireAuth, linkCalendar);
    app.delete('/api/admin/trabajadores/:id/calendar', requireAuth, desconectarCalendar);
    app.get('/api/admin/trabajadores/:id/servicios', requireAuth, getServiciosDeTrabajador);
    app.put('/api/admin/trabajadores/:id/servicios', requireAuth, setServiciosDeTrabajador);

    // Bloqueos
    app.get('/api/admin/bloqueos', requireAuth, getBloqueos);
    app.post('/api/admin/bloqueos', requireAuth, createBloqueo);
    app.delete('/api/admin/bloqueos/:id', requireAuth, deleteBloqueo);

    // Servicios
    app.get('/api/admin/servicios/empresa/:empresa_id', requireAuth, getServiciosByEmpresa);
    app.post('/api/admin/servicios', requireAuth, createServicio);
    app.put('/api/admin/servicios/:id', requireAuth, updateServicio);
    app.delete('/api/admin/servicios/:id', requireAuth, deleteServicio);

    // Citas
    app.get('/api/admin/citas/empresa/:empresa_id', requireAuth, getCitasByEmpresa);
    app.post('/api/admin/citas', requireAuth, createCita);
    app.put('/api/admin/citas/:id/estado', requireAuth, updateCitaEstado);
}

setInterval(limpiarSesionesVencidas, 60 * 60 * 1000).unref();

module.exports = { setupAdminRoutes };
