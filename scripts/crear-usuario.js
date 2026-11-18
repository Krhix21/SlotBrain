#!/usr/bin/env node
// ============================================================
// Crea usuarios del panel (tabla usuarios_admin).
//
// Uso:
//   npm run crear-usuario -- correo@dominio Contraseña123 [--propietario <empresa_id>]
//   npm run crear-usuario -- correo@dominio Contraseña123 --staff <empresa_id>
//   npm run crear-usuario -- correo@dominio Contraseña123 --superadmin
//
// Si la empresa se pasa por nombre en vez de id, se resuelve por nombre
// exacto en la tabla `empresas`.
// ============================================================

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--superadmin') args.rol = 'superadmin';
        else if (a === '--propietario') args.rol = 'propietario';
        else if (a === '--staff') args.rol = 'staff';
        else if (a === '--propietario-id' || a === '--staff-id' || a === '--empresa') {
            args.rol = a === '--propietario-id' ? 'propietario' : (a === '--staff-id' ? 'staff' : args.rol || 'propietario');
            args.empresa = argv[++i];
        } else args._.push(a);
    }
    return args;
}

function esUUID(v) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
}

async function resolverEmpresa(valor) {
    if (!valor) return null;
    if (esUUID(valor)) return valor;

    const { data, error } = await supabase
        .from('empresas')
        .select('id, nombre')
        .eq('nombre', valor)
        .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error(`No existe una empresa llamada "${valor}".`);
    console.log(`Empresa: ${data.nombre} (${data.id})`);
    return data.id;
}

async function main() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
        console.error('❌ Faltan SUPABASE_URL o SUPABASE_KEY en el entorno.');
        process.exit(1);
    }

    const args = parseArgs(process.argv.slice(2));
    const [emailRaw, password] = args._;

    if (!emailRaw || !password) {
        console.error(`Uso:
  npm run crear-usuario -- <correo> <contraseña> [--propietario <empresa_id|nombre>]
  npm run crear-usuario -- <correo> <contraseña> --staff <empresa_id|nombre>
  npm run crear-usuario -- <correo> <contraseña> --superadmin`);
        process.exit(1);
    }

    const rol = args.rol || 'propietario';
    const email = String(emailRaw).trim().toLowerCase();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        console.error('❌ Ese correo no parece válido.');
        process.exit(1);
    }
    if (password.length < 8) {
        console.error('❌ La contraseña debe tener al menos 8 caracteres.');
        process.exit(1);
    }

    const empresaId = rol === 'superadmin' ? null : await resolverEmpresa(args.empresa);

    if (rol !== 'superadmin' && !empresaId) {
        console.error('❌ Un usuario no superadmin necesita empresa: pasa --propietario <empresa> o --staff <empresa>.');
        process.exit(1);
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    const { data, error } = await supabase
        .from('usuarios_admin')
        .insert({ email, password_hash: passwordHash, rol, empresa_id: empresaId })
        .select('id, email, rol, empresa_id')
        .single();

    if (error) {
        if (error.code === '23505') {
            console.error(`❌ El correo ${email} ya tiene un usuario.`);
        } else {
            console.error('❌ Error creando el usuario:', error.message);
        }
        process.exit(1);
    }

    console.log(`✅ Usuario creado: ${data.email} (rol ${data.rol}${data.empresa_id ? `, empresa ${data.empresa_id}` : ' — superadmin'})`);
}

main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
});
