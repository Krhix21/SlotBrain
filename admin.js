const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ============================================
// SESSION MANAGEMENT
// ============================================
const sessions = new Map(); // token -> expiresAt
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 horas

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    const token = auth.slice(7);
    const exp = sessions.get(token);
    if (!exp || Date.now() > exp) {
        sessions.delete(token);
        return res.status(401).json({ error: 'Sesión expirada' });
    }
    next();
}

// ============================================
// AUTH ENDPOINTS
// ============================================

async function login(req, res) {
    const { usuario, password } = req.body;
    const ADMIN_USER = process.env.ADMIN_USER || 'admin';
    const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

    // Pequeño delay para dificultar fuerza bruta
    await new Promise(r => setTimeout(r, 500));

    if (usuario !== ADMIN_USER || password !== ADMIN_PASS) {
        return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = generateToken();
    sessions.set(token, Date.now() + SESSION_TTL);
    res.json({ token, usuario });
}

function logout(req, res) {
    const token = req.headers.authorization?.slice(7);
    if (token) sessions.delete(token);
    res.json({ ok: true });
}

function validateSession(req, res) {
    res.json({ valid: true });
}

// ============================================
// ENDPOINTS PARA EMPRESAS
// ============================================

// Listar todas las empresas
async function getEmpresas(req, res) {
    try {
        const { data, error } = await supabase
            .from('empresas')
            .select('*')
            .order('nombre');

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Error obteniendo empresas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

// Obtener empresa por teléfono del bot
async function getEmpresaByTelefonoBot(req, res) {
    try {
        const { telefono_bot } = req.params;

        const { data: trabajador, error: trabajadorError } = await supabase
            .from('trabajadores')
            .select('empresa_id, nombre')
            .eq('telefono_bot', telefono_bot)
            .single();

        if (trabajadorError || !trabajador) {
            return res.status(404).json({ error: 'Trabajador no encontrado' });
        }

        if (!trabajador.empresa_id) {
            return res.status(404).json({ error: 'El trabajador no tiene una empresa asignada' });
        }

        const { data: empresa, error: empresaError } = await supabase
            .from('empresas')
            .select('*')
            .eq('id', trabajador.empresa_id)
            .single();

        if (empresaError || !empresa) {
            return res.status(404).json({ error: 'Empresa no encontrada' });
        }

        res.json({ ...empresa, nombre_trabajador: trabajador.nombre });
    } catch (error) {
        console.error('Error obteniendo empresa:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

// Crear nueva empresa
async function createEmpresa(req, res) {
    try {
        const { nombre, descripcion, telefono, direccion, zona_horaria, mensaje_bienvenida, mensaje_confirmacion } = req.body;

        if (!nombre) {
            return res.status(400).json({ error: 'El nombre de la empresa es requerido' });
        }

        const { data, error } = await supabase
            .from('empresas')
            .insert({
                nombre,
                descripcion,
                telefono,
                direccion,
                zona_horaria: zona_horaria || 'America/Bogota',
                mensaje_bienvenida,
                mensaje_confirmacion
            })
            .select()
            .single();

        if (error) {
            console.error('Error creando empresa:', error);
            return res.status(500).json({ error: 'Error al crear la empresa' });
        }

        res.status(201).json(data);
    } catch (error) {
        console.error('Error creando empresa:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

// Actualizar empresa
async function updateEmpresa(req, res) {
    try {
        const { id } = req.params;
        const updates = req.body;

        const { data, error } = await supabase
            .from('empresas')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Error actualizando empresa:', error);
            return res.status(500).json({ error: 'Error al actualizar la empresa' });
        }

        if (!data) {
            return res.status(404).json({ error: 'Empresa no encontrada' });
        }

        res.json(data);
    } catch (error) {
        console.error('Error actualizando empresa:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

// Asignar empresa a un trabajador
async function assignEmpresaToTrabajador(req, res) {
    try {
        const { telefono_bot, empresa_id, nombre_trabajador } = req.body;

        if (!telefono_bot || !empresa_id) {
            return res.status(400).json({ error: 'telefono_bot y empresa_id son requeridos' });
        }

        const { data, error } = await supabase
            .from('trabajadores')
            .update({
                empresa_id,
                nombre: nombre_trabajador
            })
            .eq('telefono_bot', telefono_bot)
            .select()
            .single();

        if (error) {
            console.error('Error asignando empresa:', error);
            return res.status(500).json({ error: 'Error al asignar la empresa' });
        }

        if (!data) {
            return res.status(404).json({ error: 'Trabajador no encontrado' });
        }

        res.json(data);
    } catch (error) {
        console.error('Error asignando empresa:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

// ============================================
// ENDPOINTS PARA TRABAJADORES
// ============================================

// Listar todos los trabajadores (con info de empresa)
async function getTrabajadores(req, res) {
    try {
        const { data, error } = await supabase
            .from('trabajadores')
            .select(`
                *,
                empresas (id, nombre)
            `)
            .order('creado_en', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Error obteniendo trabajadores:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

// Crear/registrar trabajador (upsert por telefono_bot)
async function createTrabajador(req, res) {
    try {
        const { telefono_bot, nombre, empresa_id } = req.body;

        if (!telefono_bot) {
            return res.status(400).json({ error: 'telefono_bot es requerido' });
        }

        const payload = { telefono_bot, activo: true };
        if (nombre) payload.nombre = nombre;
        if (empresa_id) payload.empresa_id = empresa_id;

        const { data, error } = await supabase
            .from('trabajadores')
            .upsert(payload, { onConflict: 'telefono_bot' })
            .select()
            .single();

        if (error) {
            console.error('Error creando trabajador:', error);
            return res.status(500).json({ error: 'Error al crear el trabajador' });
        }

        res.status(201).json(data);
    } catch (error) {
        console.error('Error creando trabajador:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

// Actualizar nombre y/o empresa del trabajador
async function updateTrabajador(req, res) {
    try {
        const { id } = req.params;
        // Solo permitir actualizar campos seguros desde el admin
        const { nombre, empresa_id } = req.body;
        const updates = {};
        if (nombre !== undefined) updates.nombre = nombre;
        if (empresa_id !== undefined) updates.empresa_id = empresa_id || null;

        const { data, error } = await supabase
            .from('trabajadores')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Error actualizando trabajador:', error);
            return res.status(500).json({ error: 'Error al actualizar el trabajador' });
        }

        if (!data) {
            return res.status(404).json({ error: 'Trabajador no encontrado' });
        }

        res.json(data);
    } catch (error) {
        console.error('Error actualizando trabajador:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

// Desconectar Google Calendar de un trabajador
async function desconectarCalendar(req, res) {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('trabajadores')
            .update({ refresh_token: null, correo: null })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Trabajador no encontrado' });

        res.json({ ok: true });
    } catch (error) {
        console.error('Error desconectando calendar:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

// ============================================
// ENDPOINTS PARA SERVICIOS
// ============================================

// Obtener servicios de una empresa
async function getServiciosByEmpresa(req, res) {
    try {
        const { empresa_id } = req.params;

        const { data, error } = await supabase
            .from('servicios')
            .select('*')
            .eq('empresa_id', empresa_id)
            .eq('activo', true)
            .order('nombre');

        if (error) {
            console.error('Error obteniendo servicios:', error);
            return res.status(500).json({ error: 'Error al obtener servicios' });
        }

        res.json(data);
    } catch (error) {
        console.error('Error obteniendo servicios:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

// Crear nuevo servicio
async function createServicio(req, res) {
    try {
        const { empresa_id, nombre, descripcion, precio, duracion_minutos } = req.body;

        if (!empresa_id || !nombre || !precio) {
            return res.status(400).json({ error: 'empresa_id, nombre y precio son requeridos' });
        }

        const { data, error } = await supabase
            .from('servicios')
            .insert({
                empresa_id,
                nombre,
                descripcion,
                precio,
                duracion_minutos: duracion_minutos || 60
            })
            .select()
            .single();

        if (error) {
            console.error('Error creando servicio:', error);
            return res.status(500).json({ error: 'Error al crear el servicio' });
        }

        res.status(201).json(data);
    } catch (error) {
        console.error('Error creando servicio:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

// Actualizar servicio
async function updateServicio(req, res) {
    try {
        const { id } = req.params;
        const updates = req.body;

        const { data, error } = await supabase
            .from('servicios')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Error actualizando servicio:', error);
            return res.status(500).json({ error: 'Error al actualizar el servicio' });
        }

        if (!data) {
            return res.status(404).json({ error: 'Servicio no encontrado' });
        }

        res.json(data);
    } catch (error) {
        console.error('Error actualizando servicio:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

// Eliminar servicio (soft delete)
async function deleteServicio(req, res) {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('servicios')
            .update({ activo: false })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Error eliminando servicio:', error);
            return res.status(500).json({ error: 'Error al eliminar el servicio' });
        }

        if (!data) {
            return res.status(404).json({ error: 'Servicio no encontrado' });
        }

        res.json({ message: 'Servicio eliminado correctamente' });
    } catch (error) {
        console.error('Error eliminando servicio:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

// ============================================
// ENDPOINTS PARA CITAS
// ============================================

async function getCitasByEmpresa(req, res) {
    try {
        const { empresa_id } = req.params;
        const { estado, fecha_desde, fecha_hasta } = req.query;

        let query = supabase
            .from('citas')
            .select('*')
            .eq('empresa_id', empresa_id);

        if (estado) query = query.eq('estado', estado);
        if (fecha_desde) query = query.gte('fecha', fecha_desde);
        if (fecha_hasta) query = query.lte('fecha', fecha_hasta);

        const { data, error } = await query.order('creado_en', { ascending: false });

        if (error) {
            console.error('Error obteniendo citas:', error);
            return res.status(500).json({ error: 'Error al obtener citas' });
        }

        res.json(data);
    } catch (error) {
        console.error('Error obteniendo citas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

async function createCita(req, res) {
    try {
        const cita = req.body;

        const { data, error } = await supabase
            .from('citas')
            .insert(cita)
            .select()
            .single();

        if (error) {
            console.error('Error creando cita:', error);
            return res.status(500).json({ error: 'Error al crear la cita' });
        }

        res.status(201).json(data);
    } catch (error) {
        console.error('Error creando cita:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

async function updateCitaEstado(req, res) {
    try {
        const { id } = req.params;
        const { estado } = req.body;

        const { data, error } = await supabase
            .from('citas')
            .update({ estado })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Error actualizando cita:', error);
            return res.status(500).json({ error: 'Error al actualizar la cita' });
        }

        if (!data) {
            return res.status(404).json({ error: 'Cita no encontrada' });
        }

        res.json(data);
    } catch (error) {
        console.error('Error actualizando cita:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

// ============================================
// SETUP DE RUTAS
// ============================================

function setupAdminRoutes(app) {
    // ── Auth (sin protección) ──
    app.post('/api/admin/login', login);
    app.post('/api/admin/logout', requireAuth, logout);
    app.get('/api/admin/validate', requireAuth, validateSession);

    // ── Empresas ──
    app.get('/api/admin/empresas', requireAuth, getEmpresas);
    // IMPORTANTE: la ruta específica va ANTES que /:id para evitar conflictos
    app.get('/api/admin/empresas/telefono/:telefono_bot', requireAuth, getEmpresaByTelefonoBot);
    app.post('/api/admin/empresas', requireAuth, createEmpresa);
    app.put('/api/admin/empresas/:id', requireAuth, updateEmpresa);
    app.post('/api/admin/empresas/assign', requireAuth, assignEmpresaToTrabajador);

    // ── Trabajadores ──
    app.get('/api/admin/trabajadores', requireAuth, getTrabajadores);
    app.post('/api/admin/trabajadores', requireAuth, createTrabajador);
    app.put('/api/admin/trabajadores/:id', requireAuth, updateTrabajador);
    app.delete('/api/admin/trabajadores/:id/calendar', requireAuth, desconectarCalendar);

    // ── Servicios ──
    app.get('/api/admin/servicios/empresa/:empresa_id', requireAuth, getServiciosByEmpresa);
    app.post('/api/admin/servicios', requireAuth, createServicio);
    app.put('/api/admin/servicios/:id', requireAuth, updateServicio);
    app.delete('/api/admin/servicios/:id', requireAuth, deleteServicio);

    // ── Citas ──
    app.get('/api/admin/citas/empresa/:empresa_id', requireAuth, getCitasByEmpresa);
    app.post('/api/admin/citas', requireAuth, createCita);
    app.put('/api/admin/citas/:id/estado', requireAuth, updateCitaEstado);
}

module.exports = { setupAdminRoutes };
