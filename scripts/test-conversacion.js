// ============================================================
// Pruebas de conversación del bot (cerebro completo, sin Meta).
//
// Llama directo a `procesarMensajeWhatsapp` (la misma función que usa
// el webhook de Render) e intercepta el envío final a WhatsApp: nada
// sale al mundo, solo se captura lo que el bot respondería.
//
// Qué cubre: lectura de empresa/servicios de la base, tool calls reales
// (ver_slots consulta disponibilidad, agendar/cancelar/mover escriben
// citas de verdad) y el texto que el bot enviaría por WhatsApp.
// Qué NO cubre: la entrega por Meta y la síntesis de voz (no cambian
// el texto del bot).
//
// Uso:
//   node scripts/test-conversacion.js                     # corrida completa con juez de naturalidad
//   node scripts/test-conversacion.js --sin-juez          # sin evaluar naturalidad (más rápido)
//   node scripts/test-conversacion.js --reporte           # además escribe docs/INFORME-CONVERSACIONES.md
//   node scripts/test-conversacion.js --dejar             # NO borra citas/conversaciones de prueba
//   node scripts/test-conversacion.js --empresa "Otra"    # otra empresa (nunca una con calendario real)
//
// Seguridad:
//   - Fuerza GOOGLE_CALENDAR_ON=false: las citas de prueba quedan SOLO
//     en la base, jamás en un Google Calendar.
//   - Rechaza empresas con calendario real (Xheros) salvo --forzar.
//   - Clientes con teléfonos falsos únicos por corrida; al final borra
//     sus citas, sus conversaciones y el número de prueba.
// ============================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Seguridad: sin Google Calendar en esta corrida (aunque el .env diga otra cosa).
process.env.GOOGLE_CALENDAR_ON = 'false';

const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ── Intercepción del envío a WhatsApp ──────────────────────────
// Se parcha el módulo ANTES de cargar bot.js/notificaciones.js: ambos
// toman `enviarMensajeTexto` del caché de require, así que con parchar
// el objeto exportado alcanza y nadie toca la API de Meta.
const rutaWa = require.resolve(path.join(__dirname, '..', 'whatsappCloud.js'));
const wa = require(rutaWa);
const enviados = []; // { para, texto }
wa.enviarMensajeTexto = async (numeroDestino, texto) => {
    enviados.push({ para: numeroDestino, texto: String(texto || '') });
    return { capturado: true };
};
wa.marcarComoLeido = async () => null;

// Recién ahora cargamos el bot (con el envío ya interceptado).
const bot = require(path.join(__dirname, '..', 'bot'));
const disponibilidad = require(path.join(__dirname, '..', 'disponibilidad'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ── Argumentos ─────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (nombre) => args.includes(nombre);
const valorDe = (nombre) => {
    const i = args.indexOf(nombre);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
};

const EMPRESA_DEFAULT = 'Clinica Sonrisa Dental (PRUEBA)';
const NOMBRE_EMPRESA = valorDe('--empresa') || EMPRESA_DEFAULT;
const CON_JUEZ = !opt('--sin-juez');
const DEJAR_DATOS = opt('--dejar'); // para depurar: no borra nada al final
const CON_REPORTE = opt('--reporte'); // además escribe docs/INFORME-CONVERSACIONES.md
const FORZAR = opt('--forzar');

// Número de bot de prueba: una fila inerte en numeros_bot (Meta jamás
// manda webhooks con este id, es solo para rutear la empresa en local).
const BOT_PRUEBA = {
    telefono: '573000000000',
    phone_number_id: 'sbx-test-conversaciones',
    etiqueta: 'pruebas automatizadas (test-conversacion)'
};

// ── Utilidades ─────────────────────────────────────────────────
const MODELO = 'openai/gpt-oss-120b'; // el mismo del bot, para el juez

function fechaLarga(iso) {
    const [a, m, d] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
        .format(new Date(Date.UTC(a, m - 1, d)));
}

function telefonoFalso() {
    // No es un celular válido en ningún país real: imposible chocar con un cliente.
    return '5799' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
}

function fechaISO(d) {
    return d.toISOString().slice(0, 10);
}

async function buscarDiaConSlots({ empresa, servicios, servicio, desde, saltar = null, maxDias = 10 }) {
    for (let i = 1; i <= maxDias; i++) {
        const d = new Date(desde.getTime() + i * 24 * 60 * 60 * 1000);
        const iso = fechaISO(d);
        if (saltar && iso === saltar) continue;
        const r = await disponibilidad.obtenerSlots({
            empresa, servicios, fecha: iso,
            duracionMinutos: servicio.duracion_minutos || 60,
            servicioId: servicio.id
        });
        if (r.slots && r.slots.length > 0) {
            return { fecha: iso, horas: r.slots.map(s => s.hora) };
        }
    }
    return null;
}

// ── Chequeos deterministas de "no robotizado" ──────────────────
// Ojo: las listas de horas ("• 09:00", "• 09:00 con Dra. X") SÍ son diseño
// del producto (el guionizador de voz las lee con pausas), así que no se
// marcan como falla; se excluyen antes de revisar otras listas.
const LISTA_DE_HORAS = /^\s*•\s*\d{1,2}:\d{2}( con .+)?\s*$/;

function chequearRespuesta(texto, memoria) {
    const fallos = [];

    if (!texto || !texto.trim()) return ['respuesta vacía'];
    if (texto.length > 400) fallos.push(`demasiado larga (${texto.length} caracteres)`);

    // Una sola pregunta por mensaje.
    const preguntas = (texto.match(/\?/g) || []).length;
    if (preguntas > 1) fallos.push(`${preguntas} preguntas en un solo mensaje`);

    // Sin asteriscos ni listas que no sean de horas.
    if (texto.includes('*')) fallos.push('usa asteriscos');
    const lineas = texto.split('\n').filter(l => l.trim() && !LISTA_DE_HORAS.test(l));
    if (lineas.some(l => /^\s*([-•]|\d+[.)])\s+/.test(l))) fallos.push('usa listas');

    // No repetir el saludo si ya lo dijo en esta conversación.
    if (/\b(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches)\b/i.test(texto)) {
        if (memoria.salgo) fallos.push('repite el saludo ya dado');
        memoria.salgo = true;
    }

    // No inventar precios: todo monto ($600 o "600 COP") debe existir
    // en los servicios reales de la empresa.
    const montos = [
        ...(texto.match(/\$\s?([\d.,]+)/g) || []),
        ...(texto.match(/(\d[\d.,]*)\s*(?:COP|USD|MXN|EUR|pesos)/gi) || [])
    ].map(m => parseInt(m.replace(/[^\d]/g, ''), 10)).filter(n => n > 0);
    const preciosValidos = memoria.precios;
    for (const m of montos) {
        if (!preciosValidos.has(m)) {
            fallos.push(`menciona ${m}, que no corresponde a ningún servicio`);
            break;
        }
    }

    return fallos;
}

// ── Juez de naturalidad (mismo modelo que el bot) ──────────────
async function juzgar({ empresaNombre, mensajeCliente, respuestaBot, respuestaAnterior }) {
    const Groq = require('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    try {
        const r = await groq.chat.completions.create({
            model: MODELO,
            temperature: 0,
            messages: [
                {
                    role: 'system',
                    content:
                        'Eres un cliente real de WhatsApp. Califica de 1 a 10 qué tan natural suena la respuesta ' +
                        'de un bot de agendamiento, como si fuera un humano atendiendo un negocio pequeño. ' +
                        '10 = perfecto, lo escribiría una persona. Baja nota si suena robótico, recargado, ' +
                        'con frases de manual, más de una idea por mensaje o poco clara. ' +
                        'Responde SOLO un JSON: {"nota": <1-10>, "motivo": "<motivo corto>"}.'
                },
                {
                    role: 'user',
                    content:
                        `Negocio: ${empresaNombre} (si el nombre incluye "(PRUEBA)", ignora ese sufijo; es de entorno de pruebas).\n` +
                        `Última respuesta previa del bot: "${respuestaAnterior || '(es el primer mensaje del bot)'}"\n` +
                        `Cliente escribió: "${mensajeCliente}"\n` +
                        `El bot respondió: "${respuestaBot}"`
                }
            ]
        });
        const crudo = r.choices[0].message.content || '';
        const m = crudo.match(/\{[\s\S]*\}/);
        if (!m) return { nota: null, motivo: 'el juez no devolvió JSON' };
        const j = JSON.parse(m[0]);
        return { nota: Number(j.nota) || null, motivo: String(j.motivo || '') };
    } catch (e) {
        return { nota: null, motivo: 'fallo el juez: ' + e.message };
    }
}

// ── Guiones: un día normal para la clínica ─────────────────────
function guiones({ servicio, dia1, dia2 }) {
    const p = {
        servicio: servicio.nombre,
        fecha1: fechaLarga(dia1.fecha),
        fecha2: fechaLarga(dia2.fecha),
        hora1: dia1.horas[0],
        hora2: dia2.horas[0]
    };

    return [
        {
            nombre: 'Cliente agenda por primera vez',
            pasos: [
                `Buenas, soy Laura, quería pedir una cita de ${p.servicio} para el ${p.fecha1}, ¿me puede ayudar?`,
                'Sí, la primera que tenga me sirve, gracias',
                'Perfecto, gracias. Hasta luego'
            ]
        },
        {
            nombre: 'Cliente pregunta precio y elige hora concreta',
            pasos: [
                `Hola, soy Marcela. ¿Me puede decir cuánto cuesta una ${p.servicio}?`,
                `¿Para el ${p.fecha1} qué horarios tienen?`,
                `¿Tiene a las ${p.hora1}?`,
                'Sí, agéndemela por favor',
                'Listo, muchas gracias'
            ]
        },
        {
            nombre: 'Cliente confuso que no da detalles',
            pasos: [
                'hola?',
                'necesito una cita lo más pronto posible',
                'ok sí'
            ]
        },
        {
            nombre: 'Cliente pide un servicio que no existe',
            pasos: [
                'Hola, ¿hacen blanqueamiento con láser?',
                `Ah ok, entonces mejor una ${p.servicio} para el ${p.fecha1}, lo que tengan`,
                'Perfecto, sí'
            ]
        },
        {
            nombre: 'Cliente pide fecha pasada y luego cancela',
            pasos: [
                'Buenas, soy Jorge. Necesito una cita para el día de ayer',
                'Sí, la más cercana que tenga',
                'Espere... se me complicó. ¿Me la puede cancelar?',
                'Gracias, quedo pendiente'
            ]
        },
        {
            nombre: 'Cliente que reprograma su cita',
            pasos: [
                `Hola, soy Camila, ¿me puede dar una cita de ${p.servicio} para el ${p.fecha1}?`,
                'Sí, la primera',
                `¿Me la puede cambiar para el ${p.fecha2}? A las ${p.hora2} si puede ser`,
                'Listo, muchas gracias'
            ]
        }
    ];
}

// ── Reporte para revisión humana ───────────────────────────────
// Escribe docs/INFORME-CONVERSACIONES.md con las conversaciones completas
// (texto tal cual, sin aplanar saltos de línea) y el veredicto del juez
// por respuesta, para que el dueño evalúe y decida qué pulir.
function escribirReporte({ empresa, servicio, dia1, dia2, resultados, media, conNota, totalFallos }) {
    const fs = require('fs');
    const fecha = new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date());

    const lineas = [];
    lineas.push(`# Informe de conversaciones del bot (juez de naturalidad)`);
    lineas.push('');
    lineas.push(`- Corrida: ${fecha} (hora Bogotá)`);
    lineas.push(`- Empresa: ${empresa.nombre}`);
    lineas.push(`- Escenario: un día normal de agendamiento por WhatsApp (6 conversaciones, servicio "${servicio.nombre}").`);
    lineas.push(`- Días reales usados en los guiones: ${fechaLarga(dia1.fecha)} y ${fechaLarga(dia2.fecha)}.`);
    if (media) lineas.push(`- Naturalidad media del juez: ${media}/10 sobre ${conNota} respuestas.`);
    else if (!CON_JUEZ) lineas.push('- Juez: externo al proceso (modelo distinto al del bot); las notas se asignan después de la corrida.');
    lineas.push(`- Respuestas con observaciones de reglas: ${totalFallos}.`);
    lineas.push('');
    lineas.push(`Cómo leerlo: en cada respuesta, "REGLAS" son chequeos automáticos (una pregunta por mensaje, sin asteriscos, sin repetir saludo, sin precios inventados) y "Naturalidad" es ${CON_JUEZ ? 'la nota del juez (el mismo modelo que usa el bot, calificando como si fuera un cliente humano de un negocio pequeño)' : 'la nota del juez externo (GLM, un modelo distinto al del bot), calificando con la conversación completa como contexto'}.`);
    lineas.push('');

    // Lo que más vale la pena mirar primero: respuestas flojas del juez.
    const flojas = [];
    for (const r of resultados) {
        for (const l of r.lineas) {
            if ((l.nota != null && l.nota <= 6) || l.fallos.length) {
                flojas.push({ conv: r.nombre, ...l });
            }
        }
    }
    lineas.push(`## Respuestas a mirar primero (${flojas.length})`);
    lineas.push('');
    if (!flojas.length) {
        lineas.push(CON_JUEZ
            ? 'Ninguna: el juez dio 7 o más a todo y ningún chequeo de reglas falló.'
            : 'Ningún fallo de reglas. Las notas del juez externo van en cada respuesta más abajo.');
    } else {
        for (const f of flojas) {
            lineas.push(`- **${f.conv}** — Cliente: "${f.paso}" — Bot: "${f.respuesta.replace(/\n/g, ' / ')}" — ${f.fallos.length ? `REGLAS: ${f.fallos.join('; ')}. ` : ''}${f.nota != null ? `Nota: ${f.nota}/10 (${f.motivo})` : 'Nota: ?'}`);
        }
    }
    lineas.push('');

    resultados.forEach((r, i) => {
        lineas.push(`## ${i + 1}. ${r.nombre}`);
        lineas.push('');
        for (const l of r.lineas) {
            lineas.push(`**Cliente:** ${l.paso}`);
            lineas.push('');
            lineas.push(`**Bot:**`);
            for (const linea of l.respuesta.split('\n')) {
                lineas.push(`> ${linea}`);
            }
            lineas.push('');
            if (l.fallos.length) lineas.push(`_REGLAS: ${l.fallos.join('; ')}._`);
            if (CON_JUEZ) {
                if (l.nota != null) lineas.push(`_Naturalidad: ${l.nota}/10 — ${l.motivo}._`);
                else lineas.push(`_Naturalidad: ? — ${l.motivo}._`);
            }
            lineas.push('');
        }
    });

    const destino = path.join(__dirname, '..', 'docs', 'INFORME-CONVERSACIONES.md');
    fs.writeFileSync(destino, lineas.join('\n'), 'utf8');
    console.log(`\nReporte escrito: docs/INFORME-CONVERSACIONES.md`);
}

// ── Main ───────────────────────────────────────────────────────
(async () => {
    const telefonosFalsos = [];
    const datos = { telefonoBot: BOT_PRUEBA.telefono, phoneNumberId: BOT_PRUEBA.phone_number_id };

    try {
        // 1) Empresa destino (nunca una con calendario real).
        const { data: empresa, error: eEmpresa } = await supabase
            .from('empresas').select('*').ilike('nombre', NOMBRE_EMPRESA).maybeSingle();
        if (eEmpresa) throw new Error('No pude leer la empresa: ' + eEmpresa.message);
        if (!empresa) throw new Error(`No existe la empresa "${NOMBRE_EMPRESA}".`);
        if (!FORZAR && /xheros/i.test(empresa.nombre)) {
            throw new Error('Xheros tiene calendario real: no se usa para pruebas. Usa la clínica de prueba.');
        }
        console.log(`Empresa: ${empresa.nombre}`);
        console.log(`Seguridad: GOOGLE_CALENDAR_ON forzado a false para esta corrida.\n`);

        // 2) Servicios reales (para los precios válidos y los guiones).
        const { data: servicios, error: eServ } = await supabase
            .from('servicios').select('*').eq('empresa_id', empresa.id).eq('activo', true).order('nombre');
        if (eServ) throw new Error('No pude leer servicios: ' + eServ.message);
        if (!servicios.length) throw new Error('La empresa no tiene servicios activos.');
        const servicio = servicios[0]; // día normal: el cliente pide el servicio principal
        const preciosValidos = new Set(servicios.map(s => parseInt(s.precio, 10)).filter(n => n > 0));

        // 3) Número de bot de prueba (fila inerte; se borra al final).
        let { data: filaBot } = await supabase
            .from('numeros_bot').select('*').eq('phone_number_id', BOT_PRUEBA.phone_number_id).maybeSingle();
        if (!filaBot) {
            const { error: eBot } = await supabase.from('numeros_bot').insert({
                telefono: BOT_PRUEBA.telefono,
                phone_number_id: BOT_PRUEBA.phone_number_id,
                empresa_id: empresa.id,
                etiqueta: BOT_PRUEBA.etiqueta,
                activo: true,
                modo: 'prueba'
            });
            if (eBot) throw new Error('No pude crear el número de prueba: ' + eBot.message);
        }

        // 4) Días y horas reales para que los guiones pidan cosas posibles.
        const desde = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
        const dia1 = await buscarDiaConSlots({ empresa, servicios, servicio, desde });
        if (!dia1) throw new Error('No hay ningún día con slots en los próximos 10 días: ajusta el horario de la empresa de prueba.');
        const dia2 = (await buscarDiaConSlots({ empresa, servicios, servicio, desde, saltar: dia1.fecha }))
            || dia1; // si solo hay un día con horas, se reprograma a otra hora del mismo día
        console.log(`Disponibilidad real usada en los guiones: ${fechaLarga(dia1.fecha)} (${dia1.horas.join(', ')})\n`);

        // 5) Corrida de las conversaciones.
        const guion = guiones({ servicio, dia1, dia2 });
        const resultados = [];
        let totalFallos = 0;
        let sumaNotas = 0;
        let conNota = 0;

        for (const conv of guion) {
            const telefono = telefonoFalso();
            telefonosFalsos.push(telefono);
            const memoria = { precios: preciosValidos, salgo: false };
            const lineas = [];
            let fallosConv = 0;

            console.log('─'.repeat(70));
            console.log(`CONVERSACIÓN: ${conv.nombre}  (cliente de prueba ${telefono})`);
            console.log('─'.repeat(70));

            for (const paso of conv.pasos) {
                const antes = enviados.length;
                await bot.procesarMensajeWhatsapp({
                    telefonoBot: datos.telefonoBot,
                    phoneNumberId: datos.phoneNumberId,
                    telefonoCliente: telefono,
                    texto: paso,
                    porVoz: false,
                    messageId: null
                });

                const respuestas = enviados.slice(antes).map(e => e.texto);
                if (!respuestas.length) respuestas.push('(sin respuesta del bot)');

                for (const respuesta of respuestas) {
                    const fallos = chequearRespuesta(respuesta, memoria);
                    let juez = { nota: null, motivo: '' };
                    if (CON_JUEZ) {
                        const respuestaAnterior = lineas.length ? lineas[lineas.length - 1].respuesta : null;
                        juez = await juzgar({ empresaNombre: empresa.nombre, mensajeCliente: paso, respuestaBot: respuesta, respuestaAnterior });
                    }

                    if (fallos.length) fallosConv++;
                    if (juez.nota != null) { sumaNotas += juez.nota; conNota++; }
                    else if (CON_JUEZ) fallosConv++;

                    lineas.push({ paso, respuesta, fallos, nota: juez.nota, motivo: juez.motivo });

                    console.log(`  cliente : ${paso}`);
                    console.log(`  bot     : ${respuesta.replace(/\n/g, ' | ')}`);
                    if (fallos.length) console.log(`  REGLAS  : ${fallos.join('; ')}`);
                    if (juez.nota != null) console.log(`  natural : ${juez.nota}/10 — ${juez.motivo}`);
                    else if (CON_JUEZ) console.log(`  natural : ? — ${juez.motivo}`);
                    console.log('');
                }
            }

            if (fallosConv) totalFallos += fallosConv;
            resultados.push({ nombre: conv.nombre, telefono, lineas, fallos: fallosConv });
        }

        // 6) Resumen final.
        console.log('='.repeat(70));
        console.log('RESUMEN');
        console.log('='.repeat(70));
        for (const r of resultados) {
            console.log(`  ${r.fallos ? '[OJO]' : '[OK ]'} ${r.nombre}: ${r.lineas.length} respuestas${r.fallos ? `, ${r.fallos} con observaciones` : ''}`);
        }
        const media = conNota ? (sumaNotas / conNota).toFixed(1) : null;
        if (media) console.log(`\n  Naturalidad media (juez): ${media}/10 sobre ${conNota} respuestas.`);
        console.log(`  Total respuestas con observaciones: ${totalFallos}.`);
        if (DEJAR_DATOS) console.log('  (--dejar: NO se borraron los datos de prueba.)');

        if (CON_REPORTE) {
            escribirReporte({ empresa, servicio, dia1, dia2, resultados, media, conNota, totalFallos });
        }

        if (totalFallos > 0) process.exitCode = 1;
    } catch (e) {
        console.error('\nERROR: ' + e.message);
        process.exitCode = 1;
    } finally {
        if (!DEJAR_DATOS) {
            // Limpieza: citas, conversaciones y el número de prueba.
            if (telefonosFalsos.length) {
                await supabase.from('citas').delete().in('telefono_cliente', telefonosFalsos);
                await supabase.from('conversaciones').delete().in('telefono_cliente', telefonosFalsos);
            }
            await supabase.from('numeros_bot').delete().eq('phone_number_id', BOT_PRUEBA.phone_number_id);
            console.log(`\nLimpieza: datos de prueba borrados (citas y conversaciones de los teléfonos falsos, y el número ${BOT_PRUEBA.phone_number_id}).`);
        }
    }
})();
