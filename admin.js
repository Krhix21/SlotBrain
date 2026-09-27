const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Middleware para verificar autenticación básica (opcional - mejorar en producción)
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    // TODO: Implementar autenticación JWT o similar
    next();
}

// ============================================
// ENDPOINTS PARA EMPRESAS
// ============================================

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
            return res.status(404).json({ error: 'Barbero no encontrado' });
        }

        res.json(data);
    } catch (error) {
        console.error('Error asignando empresa:', error);
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

// Obtener citas de una empresa
async function getCitasByEmpresa(req, res) {
    try {
        const { empresa_id } = req.params;
        const { estado, fecha_desde, fecha_hasta } = req.query;

        let query = supabase
            .from('citas')
            .select('*')
            .eq('empresa_id', empresa_id);

        if (estado) {
            query = query.eq('estado', estado);
        }

        if (fecha_desde) {
            query = query.gte('fecha', fecha_desde);
        }

        if (fecha_hasta) {
            query = query.lte('fecha', fecha_hasta);
        }

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

// Crear registro de cita
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

// Actualizar estado de cita
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
    // Rutas de empresas
    app.get('/api/admin/empresas/telefono/:telefono_bot', getEmpresaByTelefonoBot);
    app.post('/api/admin/empresas', createEmpresa);
    app.put('/api/admin/empresas/:id', updateEmpresa);
    app.post('/api/admin/empresas/assign', assignEmpresaToTrabajador);

    // Rutas de servicios
    app.get('/api/admin/servicios/empresa/:empresa_id', getServiciosByEmpresa);
    app.post('/api/admin/servicios', createServicio);
    app.put('/api/admin/servicios/:id', updateServicio);
    app.delete('/api/admin/servicios/:id', deleteServicio);

    // Rutas de citas
    app.get('/api/admin/citas/empresa/:empresa_id', getCitasByEmpresa);
    app.post('/api/admin/citas', createCita);
    app.put('/api/admin/citas/:id/estado', updateCitaEstado);
}

module.exports = { setupAdminRoutes };
