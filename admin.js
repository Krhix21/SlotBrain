const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const numeros = require('./numeros');
const bot = require('./bot');
const { firmarLink } = require('./auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ============================================================
// Usuarios y sesiones del panel (multitenant)
//
// Cada usuario pertenece a una empresa (`usuarios_admin`). Las sesiones
// viven en la tabla `sesiones_admin` (antes estaban en memoria del
// proceso y se perdían en cada deploy de Render).
//
// Superadmin: empresa_id NULL, ve todas las empresas (para operar la
// plataforma). Sin superadmin definido todavía, el primer arranque crea
// uno desde ADMIN_USER/ADMIN_PASSWORD del entorno.
// ============================================================
const bcrypt = require('bcryptjs');

const SESSION_TTL = 8 * 60 * 60 * 1000;

/**
 * El ADMIN_USER original no era un correo ("admin"): para que el usuario
 * inicial y su login hablem del MISMO registro, ambos normalizan igual.
 */
function normalizarCorreoAdmin(texto) {
    let email = String(texto || '').trim().toLowerCase();
    if (!correoValido(email)) {
        email = `${email.replace(/[^a-z0-9._-]/g, '')}@slotbrain.local`;
    }
    return email;
}

function generarToken() {
    return crypto.randomBytes(32).toString('hex');
}

/** Crea el superadmin inicial desde ADMIN_USER/ADMIN_PASSWORD si la tabla está vacía. */
async function prepararUsuarioInicial() {
    if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) return;

    const { count, error } = await supabase
        .from('usuarios_admin')
        .select('id', { count: 'exact', head: true });

    if (error) {
        console.error('❌ No se pudo contar usuarios_admin (¿ejecutaste la migración v4?):', error.message);
        return;
    }
    if (count > 0) return;

    const email = normalizarCorreoAdmin(process.env.ADMIN_USER);

    const { error: errIns } = await supabase.from('usuarios_admin').insert({
        email,
        password_hash: bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10),
        rol: 'superadmin',
        empresa_id: null
    });

    if (errIns && errIns.code !== '23505') {
        console.error('❌ No se pudo crear el superadmin inicial:', errIns.message);
        return;
    }
    console.log(`✅ Superadmin inicial creado desde ADMIN_USER: ${email}`);
}

async function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    const token = auth.slice('Bearer '.length);
    if (!/^[a-f0-9]{64}$/i.test(token)) {
        return res.status(401).json({ error: 'Sesión inválida' });
    }

    const { data: sesion, error } = await supabase
        .from('sesiones_admin')
        .select('token, expira, usuarios_admin (id, email, empresa_id, rol, activo)')
        .eq('token', token)
        .maybeSingle();

    if (error) {
        console.error('❌ Error consultando la sesión:', error.message);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }

    if (sesion && new Date(sesion.expira).getTime() <= Date.now()) {
        await supabase.from('sesiones_admin').delete().eq('token', token);
        return res.status(401).json({ error: 'Sesión expirada' });
    }

    const usuario = Array.isArray(sesion?.usuarios_admin) ? sesion.usuarios_admin[0] : sesion?.usuarios_admin;
    if (!sesion || !usuario || !usuario.activo) {
        return res.status(401).json({ error: 'Sesión expirada' });
    }

    req.token = token;
    req.usuario = {
        id: usuario.id,
        email: usuario.email,
        empresa_id: usuario.empresa_id,
        rol: usuario.rol
    };
    next();
}

async function login(req, res) {
    const body = req.body || {};
    const password = typeof body.password === 'string' ? body.password : '';

    // Frena la fuerza bruta a costa de 500 ms por intento.
    await new Promise(r => setTimeout(r, 500));

    await prepararUsuarioInicial();

    const email = normalizarCorreoAdmin(body.email || body.usuario);
    if (!body.email && !body.usuario) {
        return res.status(400).json({ error: 'Envía tu correo y contraseña' });
    }

    const { data: usuario, error } = await supabase
        .from('usuarios_admin')
        .select('id, email, password_hash, rol, empresa_id, activo, debe_cambiar_clave')
        .eq('email', email)
        .maybeSingle();

    if (error) {
        console.error('❌ Error buscando el usuario:', error.message);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }

    const credencialesOk = usuario && usuario.activo
        && bcrypt.compareSync(password, usuario.password_hash);

    if (!credencialesOk) {
        console.warn(`⚠️  Intento de login fallido para "${email}".`);
        return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = generarToken();
    const expira = new Date(Date.now() + SESSION_TTL).toISOString();

    const { error: errSesion } = await supabase.from('sesiones_admin').insert({
        token,
        usuario_id: usuario.id,
        empresa_id: usuario.empresa_id,
        expira
    });

    if (errSesion) {
        console.error('❌ Error creando la sesión:', errSesion.message);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }

    res.json({
        token,
        usuario: usuario.email,
        rol: usuario.rol,
        empresa_id: usuario.empresa_id,
        debe_cambiar_clave: usuario.debe_cambiar_clave === true
    });
}

async function logout(req, res) {
    if (req.token) {
        await supabase.from('sesiones_admin').delete().eq('token', req.token);
    }
    res.json({ ok: true });
}

function validateSession(req, res) {
    res.json({ valid: true, usuario: req.usuario.email, rol: req.usuario.rol, empresa_id: req.usuario.empresa_id });
}

// ============================================================
// Scoping multi-tenant
//
// Regla: las peticiones de un usuario de empresa solo tocan SU empresa.
// El superadmin (rol 'superadmin') puede operar cualquiera.
// ============================================================

function esSuperadmin(req) {
    return req.usuario.rol === 'superadmin';
}

function empresaPropia(req) {
    return req.usuario.empresa_id;
}

/** middleware por-empresa: permite params de superadmin, fuerza los demás */
function conEmpresaPropia(req) {
    return esSuperadmin(req) ? null : empresaPropia(req);
}

function sinPermiso(res) {
    return res.status(403).json({ error: 'No tienes acceso a esta empresa' });
}

/** ¿El usuario puede operar esta empresa? false ⇒ ya respondió 403 o 404. */
async function puedeOperarEmpresa(req, res, empresaId) {
    if (!empresaId) {
        res.status(400).json({ error: 'Falta la empresa' });
        return false;
    }
    if (esSuperadmin(req)) return true;
    if (empresaId === empresaPropia(req)) return true;
    sinPermiso(res);
    return false;
}

/** Fila de trabajador con su empresa (para validar permisos). */
async function trabajadorSeguro(trabajadorId, columnas = 'id, empresa_id, nombre') {
    const { data } = await supabase
        .from('trabajadores')
        .select(columnas)
        .eq('id', trabajadorId)
        .maybeSingle();
    return data || null;
}

/** Ids de trabajadores de una empresa (para filtrar tablas sin empresa_id). */
async function idsTrabajadoresDe(empresaId) {
    const { data } = await supabase
        .from('trabajadores')
        .select('id')
        .eq('empresa_id', empresaId);
    return (data || []).map(t => t.id);
}

/** ¿El usuario puede operar este trabajador? false ⇒ ya respondió. */
async function puedeOperarTrabajador(req, res, trabajadorId) {
    const trabajador = await trabajadorSeguro(trabajadorId);
    if (!trabajador) {
        res.status(404).json({ error: 'Trabajador no encontrado' });
        return false;
    }
    if (esSuperadmin(req) || trabajador.empresa_id === empresaPropia(req)) {
        return true;
    }
    sinPermiso(res);
    return false;
}

// ============================================================
// Gestión de usuarios (propietario o superadmin)
// ============================================================

const ROLES_DE_EMPRESA = ['propietario', 'staff'];

function correoValido(email) {
    return typeof email === 'string'
        && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim().toLowerCase());
}

async function getUsuarios(req, res) {
    try {
        let consulta = supabase
            .from('usuarios_admin')
            .select('id, email, rol, empresa_id, activo, creado_en')
            .order('creado_en');

        if (esSuperadmin(req)) {
            if (req.query.empresa_id) consulta = consulta.eq('empresa_id', req.query.empresa_id);
        } else {
            consulta = consulta.eq('empresa_id', empresaPropia(req));
        }

        const { data, error } = await consulta;
        if (error) throw error;

        res.json(data);
    } catch (error) {
        servidorError(res, 'Error obteniendo usuarios', error);
    }
}

async function createUsuario(req, res) {
    try {
        const { email, password, rol = 'staff', empresa_id } = req.body || {};

        if (!correoValido(email)) return fallo(res, 'Envía un correo válido');

        // Sin password explícita se genera una temporal que el usuario DEBE cambiar.
        let passwordFinal = password;
        let usaClaveTemporal = false;

        if (typeof password !== 'string' || password === '') {
            passwordFinal = claveTemporal();
            usaClaveTemporal = true;
        } else if (password.length < 8) {
            return fallo(res, 'La contraseña debe tener al menos 8 caracteres');
        }

        let empresaId = null;

        if (rol === 'superadmin') {
            if (!esSuperadmin(req)) return fallo(res, 'Solo un superadmin puede crear superadmins', 403);
        } else {
            if (!ROLES_DE_EMPRESA.includes(rol)) {
                return fallo(res, `Rol inválido. Valores permitidos: ${ROLES_DE_EMPRESA.join(', ')}`);
            }
            empresaId = esSuperadmin(req) ? (empresa_id || null) : empresaPropia(req);
            if (!empresaId) return fallo(res, 'empresa_id es requerido');
        }

        const { data, error } = await supabase
            .from('usuarios_admin')
            .insert({
                email: String(email).trim().toLowerCase(),
                password_hash: bcrypt.hashSync(passwordFinal, 10),
                rol,
                empresa_id: empresaId,
                debe_cambiar_clave: usaClaveTemporal
            })
            .select('id, email, rol, empresa_id, activo, creado_en, debe_cambiar_clave')
            .single();

        if (error) {
            if (error.code === '23505') return fallo(res, 'Ese correo ya tiene un usuario', 409);
            throw error;
        }

        // La clave temporal se muestra UNA vez, aquí; luego vive hasheada.
        if (usaClaveTemporal) {
            data.clave_temporal = passwordFinal;
        }

        res.status(201).json(data);
    } catch (error) {
        servidorError(res, 'Error creando usuario', error);
    }
}

/** Acepta: password (nueva), password_actual (solo cambio propio), rol, activo, debe_cambiar_clave. */
async function updateUsuario(req, res) {
    try {
        const updates = soloCampos(req.body, ['password', 'rol', 'activo', 'debe_cambiar_clave']);
        if (Object.keys(updates).length === 0) {
            return fallo(res, 'No enviaste ningún campo editable');
        }

        const { data: usuario } = await supabase
            .from('usuarios_admin')
            .select('id, email, rol, empresa_id, password_hash')
            .eq('id', req.params.id)
            .maybeSingle();

        if (!usuario) return fallo(res, 'Usuario no encontrado', 404);

        const esUnoMismo = req.usuario.id === usuario.id;
        const esStaffDeLaMismaEmpresa = !esSuperadmin(req)
            && usuario.empresa_id
            && usuario.empresa_id === empresaPropia(req)
            && !esUnoMismo;

        if (usuario.rol === 'superadmin' && !esSuperadmin(req)) {
            return sinPermiso(res);
        }
        if (!esSuperadmin(req) && !esStaffDeLaMismaEmpresa && !esUnoMismo) {
            return sinPermiso(res);
        }

        if (updates.password !== undefined) {
            // Cambiar la PROPIA contraseña exige confirmar la actual:
            // evita que una sesión ajena la rote con la sesión abierta.
            if (esUnoMismo) {
                const { password_actual } = req.body || {};
                const correcta = typeof password_actual === 'string'
                    && bcrypt.compareSync(password_actual, usuario.password_hash);
                if (!correcta) {
                    return fallo(res, 'Para cambiar tu contraseña debes confirmar la actual', 403);
                }
                // Ya dejaron de ser una clave temporal: se desmarca.
                updates.debe_cambiar_clave = false;
            }
            if (typeof updates.password !== 'string' || updates.password.length < 8) {
                return fallo(res, 'La contraseña nueva debe tener al menos 8 caracteres');
            }
            updates.password_hash = bcrypt.hashSync(updates.password, 10);
            delete updates.password;
        }

        if (updates.rol !== undefined) {
            const rolesPermitidos = esSuperadmin(req)
                ? [...ROLES_DE_EMPRESA, 'superadmin']
                : ROLES_DE_EMPRESA;
            if (!rolesPermitidos.includes(updates.rol)) {
                return fallo(res, `Rol inválido. Valores permitidos: ${rolesPermitidos.join(', ')}`);
            }
        }

        if (updates.activo === false && req.usuario.id === usuario.id) {
            return fallo(res, 'No puedes desactivar tu propio usuario');
        }

        const { data, error } = await supabase
            .from('usuarios_admin')
            .update(updates)
            .eq('id', usuario.id)
            .select('id, email, rol, empresa_id, activo, debe_cambiar_clave')
            .single();

        if (error) throw error;

        // Al desactivar o bajar de rol, se cierran sus sesiones vivas.
        if (updates.activo === false) {
            await supabase.from('sesiones_admin').delete().eq('usuario_id', usuario.id);
        }

        res.json(data);
    } catch (error) {
        servidorError(res, 'Error actualizando usuario', error);
    }
}

async function deleteUsuario(req, res) {
    try {
        const { data: usuario } = await supabase
            .from('usuarios_admin')
            .select('id, email, rol, empresa_id')
            .eq('id', req.params.id)
            .maybeSingle();

        if (!usuario) return fallo(res, 'Usuario no encontrado', 404);
        if (usuario.rol === 'superadmin' && !esSuperadmin(req)) return sinPermiso(res);
        if (!esSuperadmin(req) && usuario.empresa_id !== empresaPropia(req)) return sinPermiso(res);

        if (usuario.id === req.usuario.id) {
            return fallo(res, 'No puedes eliminar tu propio usuario');
        }

        // No dejar a la empresa sin usuarios activos.
        if (usuario.empresa_id) {
            const { data: activos } = await supabase
                .from('usuarios_admin')
                .select('id, activo')
                .eq('empresa_id', usuario.empresa_id);

            const activosVivos = (activos || []).filter(u => u.activo && u.id !== usuario.id);
            if (activosVivos.length === 0) {
                return fallo(res, 'No puedes dejar la empresa sin usuarios: crea otro o reactiva uno antes.');
            }
        }

        await supabase.from('sesiones_admin').delete().eq('usuario_id', usuario.id);

        const { error } = await supabase.from('usuarios_admin').delete().eq('id', usuario.id);
        if (error) throw error;

        res.json({ ok: true });
    } catch (error) {
        servidorError(res, 'Error eliminando usuario', error);
    }
}

// ============================================================
// Utilidades
// ============================================================

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
    'mensaje_bienvenida', 'mensaje_confirmacion',
    'logo_url', 'color_primario', 'moneda',
    'terminologia', 'prompt_base', 'politicas'
];

/** Clave temporal para el usuario de una empresa nueva. */
function claveTemporal() {
    return crypto.randomBytes(6).toString('base64url'); // 8 caracteres
}

async function getEmpresas(req, res) {
    try {
        let consulta = supabase.from('empresas').select('*').order('nombre');
        // Un usuario de empresa solo ve la suya; el superadmin ve todas.
        if (!esSuperadmin(req)) consulta = consulta.eq('id', empresaPropia(req));

        const { data, error } = await consulta;
        if (error) throw error;
        res.json(data);
    } catch (error) {
        servidorError(res, 'Error obteniendo empresas', error);
    }
}

async function createEmpresa(req, res) {
    try {
        if (!esSuperadmin(req)) {
            return res.status(403).json({ error: 'Solo un superadmin puede crear empresas' });
        }

        const updates = soloCampos(req.body, CAMPOS_EMPRESA);

        if (!updates.nombre) return fallo(res, 'El nombre de la empresa es requerido');

        // El usuario propietario se crea junto con la empresa: si manda
        // admin_email, y no manda admin_password, se genera una clave
        // temporal que el propietario DEBE cambiar en su primer login.
        const admin_email = req.body?.admin_email;
        const admin_password = req.body?.admin_password;
        let claveTemporalPropietario = null;

        if (admin_email !== undefined && admin_email !== null && String(admin_email).trim() !== '') {
            if (!correoValido(admin_email)) {
                return fallo(res, 'admin_email no es un correo válido');
            }
            if (admin_password !== undefined && admin_password !== null) {
                if (typeof admin_password !== 'string' || admin_password.length < 8) {
                    return fallo(res, 'admin_password debe tener al menos 8 caracteres');
                }
            }
            claveTemporalPropietario = admin_password || claveTemporal();
        }

        updates.zona_horaria = updates.zona_horaria || 'America/Bogota';
        updates.slot_minutos = updates.slot_minutos || 30;
        updates.moneda = updates.moneda || 'COP';

        const { data: empresa, error } = await supabase.from('empresas').insert(updates).select().single();
        if (error) throw error;

        if (claveTemporalPropietario) {
            const { data: usuario, error: errU } = await supabase
                .from('usuarios_admin')
                .insert({
                    email: String(admin_email).trim().toLowerCase(),
                    password_hash: bcrypt.hashSync(claveTemporalPropietario, 10),
                    rol: 'propietario',
                    empresa_id: empresa.id,
                    debe_cambiar_clave: true
                })
                .select('id, email, rol, empresa_id, activo, creado_en')
                .single();

            if (errU) {
                // La empresa ya existe: no se pierde, se informa el fallo del usuariot.
                return res.status(201).json({ ...empresa, usuario_error: errU.message });
            }

            return res.status(201).json({
                ...empresa,
                usuario_creado: { ...usuario, clave_temporal: claveTemporalPropietario }
            });
        }

        res.status(201).json(empresa);
    } catch (error) {
        servidorError(res, 'Error creando empresa', error);
    }
}

async function updateEmpresa(req, res) {
    try {
        if (!(await puedeOperarEmpresa(req, res, req.params.id))) return;

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
        if (!(await puedeOperarEmpresa(req, res, req.params.empresa_id))) return;
        const lista = await numeros.listarPorEmpresa(req.params.empresa_id);
        res.json(lista);
    } catch (error) {
        servidorError(res, 'Error listando números', error);
    }
}

async function createNumero(req, res) {
    try {
        if (!(await puedeOperarEmpresa(req, res, req.params.empresa_id))) return;

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
        // El número identifica a qué empresa pertenece: permiso por ahí.
        const { data: numero } = await supabase
            .from('numeros_bot')
            .select('id, empresa_id')
            .eq('id', req.params.id)
            .maybeSingle();

        if (!numero) return fallo(res, 'Número no encontrado', 404);
        if (!(await puedeOperarEmpresa(req, res, numero.empresa_id))) return;

        const updates = soloCampos(req.body, ['phone_number_id', 'etiqueta', 'activo']);

        const { data, error } = await supabase
            .from('numeros_bot')
            .update(updates)
            .eq('id', numero.id)
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
        const { data: numero } = await supabase
            .from('numeros_bot')
            .select('id, empresa_id')
            .eq('id', req.params.id)
            .maybeSingle();

        if (!numero) return fallo(res, 'Número no encontrado', 404);
        if (!(await puedeOperarEmpresa(req, res, numero.empresa_id))) return;

        const { error } = await supabase
            .from('numeros_bot')
            .delete()
            .eq('id', numero.id);

        if (error) throw error;

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

        // El superadmin filtra por query; un usuario de empresa siempre ve la suya.
        const filtroEmpresa = conEmpresaPropia(req) || req.query.empresa_id;
        if (filtroEmpresa) consulta = consulta.eq('empresa_id', filtroEmpresa);

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

        // Un usuario de empresa solo crea trabajadores en SU empresa, pase
        // lo que pase en el body (el cliente puede mentir: se sobreescribe).
        if (!esSuperadmin(req)) updates.empresa_id = empresaPropia(req);

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
        if (!(await puedeOperarTrabajador(req, res, req.params.id))) return;

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
        if (!(await puedeOperarTrabajador(req, res, req.params.id))) return;

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
        if (!(await puedeOperarTrabajador(req, res, req.params.id))) return;

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
        if (!(await puedeOperarTrabajador(req, res, req.params.id))) return;

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

        if (!(await puedeOperarTrabajador(req, res, trabajadorId))) return;

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

        if (esSuperadmin(req)) {
            if (req.query.trabajador_id) consulta = consulta.eq('trabajador_id', req.query.trabajador_id);
        } else {
            // La tabla bloqueos no tiene empresa_id: se filtra por los
            // trabajadores de la empresa del usuario.
            const ids = await idsTrabajadoresDe(empresaPropia(req));
            if (ids.length === 0) return res.json([]);

            consulta = consulta.in('trabajador_id', ids);
            if (req.query.trabajador_id) {
                if (!ids.includes(req.query.trabajador_id)) {
                    return sinPermiso(res);
                }
                consulta = consulta.eq('trabajador_id', req.query.trabajador_id);
            }
        }
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

        if (!(await puedeOperarTrabajador(req, res, trabajador_id))) return;

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
        // El bloqueo no sabe de empresas: se valida por su trabajador.
        const { data: bloqueo } = await supabase
            .from('bloqueos')
            .select('id, trabajador_id')
            .eq('id', req.params.id)
            .maybeSingle();

        if (!bloqueo) return fallo(res, 'Bloqueo no encontrado', 404);
        if (!(await puedeOperarTrabajador(req, res, bloqueo.trabajador_id))) return;

        const { error } = await supabase.from('bloqueos').delete().eq('id', bloqueo.id);
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
        if (!(await puedeOperarEmpresa(req, res, req.params.empresa_id))) return;

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

        // Un usuario de empresa crea servicios solo en la suya.
        if (!esSuperadmin(req)) updates.empresa_id = empresaPropia(req);

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
        const { data: servicio } = await supabase
            .from('servicios')
            .select('id, empresa_id')
            .eq('id', req.params.id)
            .maybeSingle();

        if (!servicio) return fallo(res, 'Servicio no encontrado', 404);
        if (!(await puedeOperarEmpresa(req, res, servicio.empresa_id))) return;

        // La empresa de un servicio no se mueve desde el panel.
        const updates = soloCampos(req.body, CAMPOS_SERVICIO);

        if (Object.keys(updates).length === 0) {
            return fallo(res, 'No enviaste ningún campo editable');
        }

        const { data, error } = await supabase
            .from('servicios')
            .update(updates)
            .eq('id', servicio.id)
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
        const { data: servicio } = await supabase
            .from('servicios')
            .select('id, empresa_id')
            .eq('id', req.params.id)
            .maybeSingle();

        if (!servicio) return fallo(res, 'Servicio no encontrado', 404);
        if (!(await puedeOperarEmpresa(req, res, servicio.empresa_id))) return;

        const { error } = await supabase
            .from('servicios')
            .update({ activo: false })
            .eq('id', servicio.id);

        if (error) throw error;

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
        if (!(await puedeOperarEmpresa(req, res, req.params.empresa_id))) return;

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

        // Un usuario de empresa crea citas solo en la suya, y el
        // profesional tiene que ser de esa misma empresa.
        if (!esSuperadmin(req)) updates.empresa_id = empresaPropia(req);

        if (!(await puedeOperarEmpresa(req, res, updates.empresa_id))) return;
        if (updates.trabajador_id
            && !(await puedeOperarTrabajador(req, res, updates.trabajador_id))) return;

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

        const { data: cita } = await supabase
            .from('citas')
            .select('id, empresa_id, estado')
            .eq('id', req.params.id)
            .maybeSingle();

        if (!cita) return fallo(res, 'Cita no encontrada', 404);
        if (!(await puedeOperarEmpresa(req, res, cita.empresa_id))) return;

        const { data, error } = await supabase
            .from('citas')
            .update({ estado })
            .eq('id', cita.id)
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
    // Sesión
    app.post('/api/admin/login', login);
    app.post('/api/admin/logout', requireAuth, logout);
    app.get('/api/admin/validate', requireAuth, validateSession);

    // Usuarios del panel (propietario gestiona su gente; superadmin a todos)
    app.get('/api/admin/usuarios', requireAuth, getUsuarios);
    app.post('/api/admin/usuarios', requireAuth, createUsuario);
    app.put('/api/admin/usuarios/:id', requireAuth, updateUsuario);
    app.delete('/api/admin/usuarios/:id', requireAuth, deleteUsuario);

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

// Limpieza de sesiones vencidas en la base. La preparación del primer
// superadmin corre no bloqueante al arrancar el servidor.
setInterval(() => {
    supabase
        .from('sesiones_admin')
        .delete()
        .lt('expira', new Date().toISOString())
        .then(({ error }) => {
            if (error) console.warn('Error limpiando sesiones vencidas:', error.message);
        })
        .catch(() => {});
}, 60 * 60 * 1000).unref();

prepararUsuarioInicial().catch(err => {
    console.error('❌ Error preparando el superadmin inicial:', err.message);
});

module.exports = { setupAdminRoutes };
