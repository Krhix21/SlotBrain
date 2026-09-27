require('dotenv').config();
const Groq = require('groq-sdk');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode'); // genera el QR como imagen para la web
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');

// Configurar cache de Puppeteer para Render
process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer';

const { verificarYAgendarCita, cancelarCita, modificarCita, trabajadorEstaConectado } = require('./calendar');
const { guardarCliente, registrarCitaAgendada, registrarCitaCancelada, registrarCitaModificada } = require('./clientes');
const botState = require('./botState');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ============================================================
// MVP de un solo trabajador por instancia del bot:
// Cada trabajador corre su propia instancia de este bot (su propio
// WhatsApp). Ya NO se pide el número por .env: se detecta solo
// apenas se escanea el QR y whatsapp-web.js se conecta
// (client.info.wid.user). Ese número es el que se usa como
// identificador (telefono_bot) en Supabase.
// ============================================================
let TELEFONO_BOT = null;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MAX_MENSAJES_HISTORIAL = 15;

// Cache para configuración de empresas y servicios
let configCache = {
    empresas: {},
    servicios: {}
};

// Función para cargar configuración de empresa y servicios desde Supabase
async function cargarConfiguracionEmpresa(telefono_bot) {
    try {
        // Si ya está en cache, retornar
        if (configCache.empresas[telefono_bot]) {
            return {
                empresa: configCache.empresas[telefono_bot],
                servicios: configCache.servicios[telefono_bot] || []
            };
        }

        // Obtener trabajador con su empresa
        const { data: trabajador, error: trabajadorError } = await supabase
            .from('trabajadores')
            .select('empresa_id')
            .eq('telefono_bot', telefono_bot)
            .single();

        if (trabajadorError || !trabajador || !trabajador.empresa_id) {
            console.log(`⚠️  No se encontró empresa para el trabajador ${telefono_bot}`);
            return null;
        }

        // Obtener empresa
        const { data: empresa, error: empresaError } = await supabase
            .from('empresas')
            .select('*')
            .eq('id', trabajador.empresa_id)
            .single();

        if (empresaError || !empresa) {
            console.log(`⚠️  No se encontró la empresa ${trabajador.empresa_id}`);
            return null;
        }

        // Obtener servicios de la empresa
        const { data: servicios, error: serviciosError } = await supabase
            .from('servicios')
            .select('*')
            .eq('empresa_id', trabajador.empresa_id)
            .eq('activo', true);

        if (serviciosError) {
            console.error('Error cargando servicios:', serviciosError);
            return null;
        }

        // Guardar en cache
        configCache.empresas[telefono_bot] = empresa;
        configCache.servicios[telefono_bot] = servicios || [];

        console.log(`✅ Configuración cargada para ${empresa.nombre}: ${servicios?.length || 0} servicios`);

        return {
            empresa,
            servicios: servicios || []
        };
    } catch (error) {
        console.error('Error cargando configuración de empresa:', error);
        return null;
    }
}

// Función para obtener lista de servicios formateada para el prompt del bot
function obtenerServiciosParaPrompt(servicios) {
    if (!servicios || servicios.length === 0) {
        return '- Servicio básico: $0 COP (60 min)';
    }

    return servicios.map(s => 
        `- ${s.nombre}: $${s.precio.toLocaleString()} COP (${s.duracion_minutos} min). ${s.descripcion || ''}`
    ).join('\n');
}

// Función para limpiar cache (útil cuando se actualiza la configuración)
function limpiarCacheConfiguracion(telefono_bot) {
    if (telefono_bot) {
        delete configCache.empresas[telefono_bot];
        delete configCache.servicios[telefono_bot];
    } else {
        configCache = { empresas: {}, servicios: {} };
    }
}

// ---------- Persistencia simple de conversaciones (igual que antes) ----------
const CONVERSATIONS_FILE = path.join(__dirname, 'conversaciones.json');

function loadConversations() {
    try {
        if (fs.existsSync(CONVERSATIONS_FILE)) {
            return JSON.parse(fs.readFileSync(CONVERSATIONS_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Error cargando conversaciones:', error);
    }
    return {};
}

function saveConversations(conversations) {
    try {
        fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(conversations, null, 2));
    } catch (error) {
        console.error('Error guardando conversaciones:', error);
    }
}

function getConversationHistory(userId) {
    const conversations = loadConversations();
    return conversations[userId]?.mensajes || [];
}

function addMessageToHistory(userId, role, content) {
    const conversations = loadConversations();
    if (!conversations[userId]) conversations[userId] = { mensajes: [], userName: null };
    conversations[userId].mensajes.push({ role, content, timestamp: new Date().toISOString() });
    if (conversations[userId].mensajes.length > MAX_MENSAJES_HISTORIAL) {
        conversations[userId].mensajes = conversations[userId].mensajes.slice(-MAX_MENSAJES_HISTORIAL);
    }
    saveConversations(conversations);
}

function getUserName(userId) {
    const conversations = loadConversations();
    return conversations[userId]?.userName || null;
}

function setUserName(userId, name) {
    const conversations = loadConversations();
    if (!conversations[userId]) conversations[userId] = { mensajes: [], userName: null };
    conversations[userId].userName = name;
    saveConversations(conversations);
}

function isFirstConversation(userId) {
    const conversations = loadConversations();
    return !conversations[userId] || conversations[userId].mensajes.length === 0;
}

function getUltimaCita(userId) {
    const conversations = loadConversations();
    return conversations[userId]?.ultimaCita || null;
}

function setUltimaCita(userId, cita) {
    const conversations = loadConversations();
    if (!conversations[userId]) conversations[userId] = { mensajes: [], userName: null };
    if (cita) {
        conversations[userId].ultimaCita = cita;
    } else {
        delete conversations[userId].ultimaCita;
    }
    saveConversations(conversations);
}

function normalizarServicio(servicio) {
    if (!servicio) return null;
    return SERVICIOS_VALIDOS.find(s => s.toLowerCase() === servicio.toLowerCase()) || null;
}

function obtenerServicioDelMensaje(texto) {
    if (!texto || typeof texto !== 'string') return null;
    return SERVICIOS_VALIDOS.find(s => texto.toLowerCase().includes(s.toLowerCase())) || null;
}

function getConversationState(userId) {
    const conversations = loadConversations();
    if (!conversations[userId]) conversations[userId] = { mensajes: [], userName: null };
    return conversations[userId];
}

function setConversationState(userId, state) {
    const conversations = loadConversations();
    if (!conversations[userId]) conversations[userId] = { mensajes: [], userName: null };
    conversations[userId] = { ...conversations[userId], ...state };
    saveConversations(conversations);
}

function clearPendingBooking(userId) {
    const conversations = loadConversations();
    if (conversations[userId] && conversations[userId].pendingBooking) {
        delete conversations[userId].pendingBooking;
        saveConversations(conversations);
    }
}

function getPendingBooking(userId) {
    return getConversationState(userId).pendingBooking || null;
}

function esSolicitudDisponibilidad(msg) {
    return /disponib|espacio|hay lugar|tienes lugar|libre|ocupad|est[aá] disponible|se puede|puedo/i.test(msg)
        && !/agend|reserv|quiero una cita|quiero agendar|quiero reservar|quiero.*cita/i.test(msg);
}

function esSolicitudModificacion(msg) {
    return /modific|mover|cambiar|reprogram|reagend/i.test(msg);
}

function esSolicitudCancelacion(msg) {
    return /cancelar|anular|eliminar|ya no|no voy/i.test(msg);
}

function esConfirmacionAfirmativa(msg) {
    return /^(sí|si|claro|adelante|por supuesto|dale|ok|correcto|sí por favor|si por favor|sip|sipo)([.!?\s]*)$/i.test(msg.trim());
}

function corregirFuncionPorMensaje(functionName, functionArgs, lastUserMessage, userId) {
    const msg = (lastUserMessage || '').toLowerCase();
    const quiereModificar = esSolicitudModificacion(msg);
    const preguntaDisponibilidad = esSolicitudDisponibilidad(msg);
    const quiereCancelar = esSolicitudCancelacion(msg);

    if (preguntaDisponibilidad && functionName !== 'consultar_disponibilidad') {
        return {
            name: 'consultar_disponibilidad',
            args: {
                fecha: functionArgs.fecha || functionArgs.nueva_fecha,
                hora: functionArgs.hora || functionArgs.nueva_hora,
                nombre_cliente: functionArgs.nombre_cliente
            }
        };
    }

    if (quiereModificar && functionName === 'agendar_cita') {
        const ultima = getUltimaCita(userId);
        return {
            name: 'modificar_cita',
            args: {
                fecha_actual: ultima?.fecha || functionArgs.fecha,
                hora_actual: ultima?.hora || functionArgs.hora,
                nueva_fecha: functionArgs.fecha,
                nueva_hora: functionArgs.hora,
                nombre_cliente: functionArgs.nombre_cliente
            }
        };
    }

    if (quiereCancelar && functionName !== 'cancelar_cita') {
        return {
            name: 'cancelar_cita',
            args: {
                fecha: functionArgs.fecha || functionArgs.nueva_fecha,
                hora: functionArgs.hora || functionArgs.nueva_hora,
                nombre_cliente: functionArgs.nombre_cliente
            }
        };
    }

    return { name: functionName, args: functionArgs };
}

function validarArgsAntesDeEjecutar(functionName, functionArgs, userId, userName) {
    functionArgs.nombre_cliente = functionArgs.nombre_cliente || userName;

    if (functionName === 'agendar_cita') {
        const servicio = normalizarServicio(functionArgs.servicio);
        if (!servicio) {
            return {
                bloqueado: true,
                mensaje: `Con gusto te ayudo, ${userName}. ¿Qué servicio prefieres? Tenemos Combo Zafiro, Precisión Total y Combo Deluxe.`
            };
        }
        functionArgs.servicio = servicio;
    }

    if (functionName === 'modificar_cita') {
        const ultima = getUltimaCita(userId);
        if (!functionArgs.fecha_actual && ultima) functionArgs.fecha_actual = ultima.fecha;
        if (!functionArgs.hora_actual && ultima) functionArgs.hora_actual = ultima.hora;

        if (!functionArgs.fecha_actual || !functionArgs.hora_actual) {
            return {
                bloqueado: true,
                mensaje: `Para mover tu cita necesito saber cuál es la actual. ¿Me recuerdas la fecha y hora de la cita que quieres cambiar?`
            };
        }
        if (!functionArgs.nueva_fecha || !functionArgs.nueva_hora) {
            return {
                bloqueado: true,
                mensaje: `¿A qué fecha y hora te gustaría mover tu cita?`
            };
        }
    }

    if (functionName === 'consultar_disponibilidad') {
        if (!functionArgs.fecha || !functionArgs.hora) {
            return {
                bloqueado: true,
                mensaje: `¿Para qué día y hora quieres que revise la disponibilidad?`
            };
        }
    }

    return { bloqueado: false };
}

function formatDateSpanish(fechaISO) {
    try {
        // fechaISO es una fecha de calendario pura "AAAA-MM-DD" (sin hora),
        // así que NO debe pasar por new Date(fechaISO) + timeZone, porque
        // eso la interpreta como instante UTC y al convertir a Bogotá (UTC-5)
        // se corre un día hacia atrás (ej: "2026-07-09" mostraba "8 de julio").
        // Parseamos los componentes a mano y formateamos en UTC para que
        // no haya ningún corrimiento sin importar el huso horario del server.
        const [year, month, day] = fechaISO.split('-').map(Number);
        if (!year || !month || !day) return fechaISO;
        const date = new Date(Date.UTC(year, month - 1, day));
        if (isNaN(date.getTime())) return fechaISO;
        return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
    } catch {
        return fechaISO;
    }
}

function createHumanResponse(functionName, functionArgs, resultado, empresaConfig = null) {
    const nombre = functionArgs.nombre_cliente || 'amigo';
    const nombreEmpresa = empresaConfig?.nombre || 'Xheros Barber';
    
    if (!resultado || typeof resultado.mensaje !== 'string') {
        return 'Lo siento, no pude procesar esa acción correctamente. ¿Puedes intentarlo de nuevo?';
    }

    if (!resultado.exitoso) {
        if (functionName === 'agendar_cita') {
            return `No pude agendar tu cita porque ${resultado.mensaje.toLowerCase()}. ¿Te gustaría intentar con otro horario?`;
        }
        if (functionName === 'cancelar_cita') {
            return `No pude cancelar la cita: ${resultado.mensaje}. Si quieres, dime nuevamente la fecha y la hora de la cita que deseas cancelar.`;
        }
        if (functionName === 'modificar_cita') {
            return `No pude modificar la cita: ${resultado.mensaje}. ¿Quieres que busquemos otra hora disponible?`;
        }
        if (functionName === 'consultar_disponibilidad') {
            return `No pude consultar la disponibilidad: ${resultado.mensaje}`;
        }
        return resultado.mensaje;
    }

    if (functionName === 'consultar_disponibilidad') {
        if (resultado.disponible) {
            return `Sí ${nombre}, el horario de las ${functionArgs.hora} del ${formatDateSpanish(functionArgs.fecha)} está disponible. ¿Te lo agendo?`;
        }
        return `Lo siento ${nombre}, el horario de las ${functionArgs.hora} del ${formatDateSpanish(functionArgs.fecha)} ya está ocupado. ¿Quieres probar otra hora?`;
    }

    if (functionName === 'agendar_cita') {
        // Usar mensaje de confirmación personalizado si existe
        const mensajeConfirmacion = empresaConfig?.mensaje_confirmacion || 
            '¡Perfecto {nombre}! Ya quedó agendada tu cita de {servicio} para el {fecha} a las {hora}. Te esperamos en {nombre_negocio}.';
        
        return mensajeConfirmacion
            .replace('{nombre}', nombre)
            .replace('{servicio}', functionArgs.servicio)
            .replace('{fecha}', formatDateSpanish(functionArgs.fecha))
            .replace('{hora}', functionArgs.hora)
            .replace('{nombre_negocio}', nombreEmpresa);
    }
    
    if (functionName === 'cancelar_cita') {
        return `Listo ${nombre}, tu cita para el ${formatDateSpanish(functionArgs.fecha)} a las ${functionArgs.hora} ha sido cancelada. Si deseas agendar otra hora, con gusto te ayudo.`;
    }
    
    if (functionName === 'modificar_cita') {
        return `Perfecto ${nombre}, tu cita se movió al ${formatDateSpanish(functionArgs.nueva_fecha)} a las ${functionArgs.nueva_hora}. Gracias por avisar.`;
    }
    
    return resultado.mensaje;
}

function sanitizeResponseText(text) {
    if (!text || typeof text !== 'string') return '';
    const cleaned = text.replace(/<function=[^>]+>\s*([\s\S]*?)\s*<\/function>/gi, '$1');
    return cleaned.trim();
}

function parseJsonObject(text) {
    if (!text || typeof text !== 'string') return null;
    const cleaned = sanitizeResponseText(text);
    const candidates = [cleaned];
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) candidates.push(match[0]);

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {
            // seguir con el siguiente candidato
        }
    }
    return null;
}

function detectLeakedFunctionCall(text) {
    const parsed = parseJsonObject(text);
    if (!parsed) return null;

    if (parsed.nueva_fecha && parsed.nueva_hora && parsed.fecha_actual && parsed.hora_actual) {
        return { name: 'modificar_cita', args: parsed };
    }
    if (parsed.servicio && parsed.fecha && parsed.hora) {
        return { name: 'agendar_cita', args: parsed };
    }
    if (parsed.fecha && parsed.hora && !parsed.servicio) {
        return { name: 'consultar_disponibilidad', args: parsed };
    }
    if (parsed.fecha && parsed.hora && parsed.nombre_cliente) {
        return { name: 'cancelar_cita', args: parsed };
    }
    return null;
}

async function ejecutarFuncionCalendario(functionName, functionArgs, telefono_bot) {
    if (functionName === 'agendar_cita') {
        return verificarYAgendarCita(functionArgs, telefono_bot);
    }
    if (functionName === 'cancelar_cita') {
        return cancelarCita(functionArgs, telefono_bot);
    }
    if (functionName === 'modificar_cita') {
        return modificarCita(functionArgs, telefono_bot);
    }
    if (functionName === 'consultar_disponibilidad') {
        return consultarDisponibilidad(functionArgs, telefono_bot);
    }
    return { exitoso: false, mensaje: 'Función no reconocida' };
}

async function persistirResultadoCita(functionName, functionArgs, resultado, telefono_bot, telefono_cliente) {
    if (!resultado?.exitoso || !telefono_bot || !telefono_cliente) return;

    try {
        if (functionName === 'agendar_cita') {
            await registrarCitaAgendada(telefono_bot, telefono_cliente, functionArgs);
        } else if (functionName === 'cancelar_cita') {
            await registrarCitaCancelada(telefono_bot, telefono_cliente, functionArgs);
        } else if (functionName === 'modificar_cita') {
            await registrarCitaModificada(telefono_bot, telefono_cliente, functionArgs);
        }
    } catch (error) {
        console.error('Error guardando historial en Supabase:', error);
    }
}

async function procesarLlamadaFuncion(functionName, functionArgs, telefono_bot, telefono_cliente, userName, lastUserMessage) {
    const corregida = corregirFuncionPorMensaje(functionName, functionArgs, lastUserMessage, telefono_cliente);
    functionName = corregida.name;
    functionArgs = corregida.args;

    const pending = getPendingBooking(telefono_cliente);
    if (functionName === 'agendar_cita' && pending && esConfirmacionAfirmativa(lastUserMessage)) {
        functionArgs = {
            nombre_cliente: functionArgs.nombre_cliente || pending.nombre_cliente,
            servicio: functionArgs.servicio || pending.servicio,
            fecha: functionArgs.fecha || pending.fecha,
            hora: functionArgs.hora || pending.hora
        };
    }

    const validacion = validarArgsAntesDeEjecutar(functionName, functionArgs, telefono_cliente, userName);
    if (validacion.bloqueado) {
        return validacion.mensaje;
    }

    console.log(`🔧 Ejecutando función: ${functionName}`, functionArgs);

    const resultado = await ejecutarFuncionCalendario(functionName, functionArgs, telefono_bot);
    console.log('📋 Resultado de la función:', resultado);

    if (functionName === 'consultar_disponibilidad') {
        if (resultado?.exitoso && resultado.disponible) {
            setConversationState(telefono_cliente, {
                pendingBooking: {
                    nombre_cliente: functionArgs.nombre_cliente,
                    servicio: obtenerServicioDelMensaje(lastUserMessage),
                    fecha: functionArgs.fecha,
                    hora: functionArgs.hora
                }
            });
        } else {
            clearPendingBooking(telefono_cliente);
        }
    } else {
        clearPendingBooking(telefono_cliente);
    }

    if (resultado?.exitoso) {
        if (functionName === 'agendar_cita') {
            setUltimaCita(telefono_cliente, {
                servicio: functionArgs.servicio,
                fecha: functionArgs.fecha,
                hora: functionArgs.hora
            });
            await persistirResultadoCita(functionName, functionArgs, resultado, telefono_bot, telefono_cliente);
        } else if (functionName === 'modificar_cita') {
            const ultima = getUltimaCita(telefono_cliente);
            setUltimaCita(telefono_cliente, {
                servicio: ultima?.servicio || 'Cita',
                fecha: functionArgs.nueva_fecha,
                hora: functionArgs.nueva_hora
            });
            await persistirResultadoCita(functionName, functionArgs, resultado, telefono_bot, telefono_cliente);
        } else if (functionName === 'cancelar_cita') {
            setUltimaCita(telefono_cliente, null);
            await persistirResultadoCita(functionName, functionArgs, resultado, telefono_bot, telefono_cliente);
        }
    }

    // Cargar configuración de empresa para respuesta personalizada
    const config = await cargarConfiguracionEmpresa(telefono_bot);
    let assistantResponse = createHumanResponse(functionName, functionArgs, resultado, config?.empresa);
    assistantResponse = sanitizeResponseText(assistantResponse) || resultado.mensaje;
    return assistantResponse;
}

async function obtenerRespuestaDirecta(messages, userName) {
    const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
            ...messages,
            {
                role: 'system',
                content: `Responde SIEMPRE en español natural y breve. Si ${userName} quiere agendar pero no dijo qué servicio, pregúntale entre Combo Zafiro, Precisión Total y Combo Deluxe. No uses JSON ni código.`
            }
        ],
        temperature: 0.6
    });
    return sanitizeResponseText(response.choices[0].message.content);
}

// ---------- Tools para Groq (function calling) ----------
const agendarCitaTool = {
    type: 'function',
    function: {
        name: 'agendar_cita',
        description: 'Crea una cita NUEVA. Usar SOLO cuando el cliente ya eligió explícitamente un servicio (Combo Zafiro, Precisión Total o Combo Deluxe), fecha y hora. NO inventar el servicio. NO usar para modificar ni para consultar disponibilidad.',
        parameters: {
            type: 'object',
            properties: {
                fecha: { type: 'string', description: 'Fecha de la cita en formato AAAA-MM-DD' },
                hora: { type: 'string', description: 'Hora de la cita en formato HH:MM de 24 horas' },
                servicio: { type: 'string', description: 'El nombre del servicio o combo seleccionado por el cliente.' },
                nombre_cliente: { type: 'string', description: 'El nombre del cliente que solicita la cita.' }
            },
            required: ['fecha', 'hora', 'servicio', 'nombre_cliente']
        }
    }
};

const cancelarCitaTool = {
    type: 'function',
    function: {
        name: 'cancelar_cita',
        description: 'Cancela una cita existente en la agenda de Xheros Barber.',
        parameters: {
            type: 'object',
            properties: {
                fecha: { type: 'string', description: 'Fecha de la cita a cancelar en formato AAAA-MM-DD' },
                hora: { type: 'string', description: 'Hora de la cita a cancelar en formato HH:MM de 24 horas' },
                nombre_cliente: { type: 'string', description: 'El nombre del cliente que tiene la cita.' }
            },
            required: ['fecha', 'hora', 'nombre_cliente']
        }
    }
};

const modificarCitaTool = {
    type: 'function',
    function: {
        name: 'modificar_cita',
        description: 'Cambia el horario de una cita que el cliente YA tiene. Usar cuando diga modificar, mover, cambiar o reprogramar. NO usar para agendar citas nuevas ni para preguntas de disponibilidad.',
        parameters: {
            type: 'object',
            properties: {
                fecha_actual: { type: 'string', description: 'Fecha actual de la cita en formato AAAA-MM-DD' },
                hora_actual: { type: 'string', description: 'Hora actual de la cita en formato HH:MM de 24 horas' },
                nombre_cliente: { type: 'string', description: 'El nombre del cliente que tiene la cita.' },
                nueva_fecha: { type: 'string', description: 'Nueva fecha para la cita en formato AAAA-MM-DD' },
                nueva_hora: { type: 'string', description: 'Nueva hora para la cita en formato HH:MM de 24 horas' }
            },
            required: ['fecha_actual', 'hora_actual', 'nombre_cliente', 'nueva_fecha', 'nueva_hora']
        }
    }
};

const consultarDisponibilidadTool = {
    type: 'function',
    function: {
        name: 'consultar_disponibilidad',
        description: 'Consulta si un horario está libre SIN agendar. Usar cuando el cliente pregunte si hay espacio, disponibilidad o si está libre/ocupado un horario.',
        parameters: {
            type: 'object',
            properties: {
                fecha: { type: 'string', description: 'Fecha a consultar en formato AAAA-MM-DD' },
                hora: { type: 'string', description: 'Hora a consultar en formato HH:MM de 24 horas' },
                nombre_cliente: { type: 'string', description: 'El nombre del cliente.' }
            },
            required: ['fecha', 'hora', 'nombre_cliente']
        }
    }
};

// ---------- Cliente de WhatsApp ----------
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--single-process'
        ]
    }
});

client.on('qr', async (qr) => {
    // Log en consola (por si lo corres directo en terminal)
    qrcodeTerminal.generate(qr, { small: true });
    console.log('📸 Escanea el código QR de arriba, o entra a /vincular.html para escanearlo desde el navegador.');

    // Imagen para mostrar en la página web
    try {
        const dataUrl = await qrcode.toDataURL(qr);
        botState.setQr(dataUrl);
    } catch (err) {
        console.error('❌ Error generando imagen QR:', err);
    }
});

client.on('ready', async () => {
    console.log('🚀 ¡Bot de citas está en línea y escuchando mensajes!');

    // El número propio del WhatsApp que se acaba de conectar (el del barbero)
    TELEFONO_BOT = client.info.wid.user;
    botState.setWhatsappListo(TELEFONO_BOT);
    console.log(`📱 WhatsApp conectado con el número: ${TELEFONO_BOT}`);

    // Cargar configuración de la empresa y servicios
    const config = await cargarConfiguracionEmpresa(TELEFONO_BOT);
    if (config) {
        console.log(`✅ Empresa configurada: ${config.empresa.nombre}`);
    } else {
        console.warn(`⚠️  No se encontró configuración de empresa para ${TELEFONO_BOT}`);
        console.warn(`   Ve a /admin.html para configurar tu negocio.`);
    }

    const conectado = await trabajadorEstaConectado(TELEFONO_BOT);
    if (!conectado) {
        botState.setCalendarConectado(false);
        console.warn(`⚠️  ATENCIÓN: este número (${TELEFONO_BOT}) todavía NO ha conectado su Google Calendar.`);
        console.warn(`   Ve a /vincular.html para conectarlo.`);
    } else {
        botState.setCalendarConectado(true, conectado.correo);
        console.log(`✅ Calendario ya conectado: ${conectado.correo}`);
    }
});

client.on('disconnected', () => {
    console.warn('⚠️  WhatsApp se desconectó.');
});

client.on('message', async (msg) => {
    if (msg.from.includes('@g.us') || msg.isStatus || !msg.body || msg.body.trim() === '') return;

    try {
        console.log(`💬 Mensaje recibido de ${msg.from}: ${msg.body}`);

        const contact = await msg.getContact();
        const phoneNumber = contact.number;
        const userId = phoneNumber || msg.from;

        const userName = getUserName(userId);

        if (!userName && isFirstConversation(userId)) {
            // Cargar configuración para obtener mensaje de bienvenida personalizado
            const config = await cargarConfiguracionEmpresa(TELEFONO_BOT);
            const nombreEmpresa = config?.empresa?.nombre || 'Xheros Barber';
            const mensajeBienvenida = config?.empresa?.mensaje_bienvenida || 
                '¡Hola! Bienvenido a {nombre_negocio}. 👋 Soy tu asesor virtual. ¿Podrías decirme tu nombre para atenderte de manera más personal?';
            
            const saludo = mensajeBienvenida.replace('{nombre_negocio}', nombreEmpresa);
            await client.sendMessage(msg.from, saludo);
            addMessageToHistory(userId, 'assistant', saludo);
            return;
        }

        if (!userName) {
            const nameResponse = await groq.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: 'Extrae SOLO el nombre propio de este mensaje. Si no hay un nombre, responde "null".' },
                    { role: 'user', content: msg.body }
                ]
            });

            const extractedName = nameResponse.choices[0].message.content.trim();
            if (extractedName !== 'null' && extractedName.length > 0) {
                setUserName(userId, extractedName);
                if (TELEFONO_BOT) {
                    await guardarCliente(TELEFONO_BOT, userId, extractedName);
                }
                const bienvenida = `¡Excelente, ${extractedName}! Gracias por compartir tu nombre. ¿En qué puedo ayudarte hoy?`;
                await client.sendMessage(msg.from, bienvenida);
                addMessageToHistory(userId, 'assistant', bienvenida);
                return;
            }
        }

        const conversationHistory = getConversationHistory(userId);
        addMessageToHistory(userId, 'user', msg.body);

        const currentUserName = getUserName(userId) || 'amigo';

        // OJO: nunca uses new Date().toISOString() para "hoy" — eso da la fecha en UTC,
        // y en Colombia (UTC-5) de noche ya sería "mañana" en UTC, corriendo todas las citas un día.
        const ahoraBogota = new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' });
        const fechaBogota = new Date(ahoraBogota);
        const hoy = fechaBogota.toLocaleDateString('sv-SE'); // formato AAAA-MM-DD
        const diaSemana = fechaBogota.toLocaleDateString('es-CO', { weekday: 'long' });

        const ultimaCita = getUltimaCita(userId);
        const contextoCita = ultimaCita
            ? `CITA ACTIVA DEL CLIENTE: ${ultimaCita.servicio} el ${ultimaCita.fecha} a las ${ultimaCita.hora}. Si quiere modificar o cancelar sin especificar cuál, usa estos datos.`
            : 'El cliente no tiene cita activa registrada en esta conversación.';

        // Cargar configuración de empresa y servicios
        const config = await cargarConfiguracionEmpresa(TELEFONO_BOT);
        const nombreEmpresa = config?.empresa?.nombre || 'Xheros Barber';
        const serviciosTexto = config ? obtenerServiciosParaPrompt(config.servicios) : 
            '- Servicio básico: $0 COP (60 min)';
        const mensajeBienvenida = config?.empresa?.mensaje_bienvenida || 
            '¡Hola! Bienvenido a {nombre_negocio}. 👋 Soy tu asesor virtual. ¿Podrías decirme tu nombre para atenderte de manera más personal?';

        const systemInstruction = `
        Eres "XheroBot", el asesor virtual de "${nombreEmpresa}". Tu objetivo es atender de manera premium y fluida.
        El nombre del cliente es "${currentUserName}". Úsalo para personalizar la conversación.

        ${contextoCita}

        NUESTROS SERVICIOS:
        ${serviciosTexto}

        REGLAS:
        1. Sé amigable, sofisticado y habla de forma totalmente natural (NUNCA uses menús numerados ni respuestas tipo robot).
        2. Hoy es ${diaSemana}, ${hoy} (hora de Colombia). "Mañana" es el día siguiente a hoy.
        3. Si solo PREGUNTA disponibilidad ("¿hay espacio?", "¿está libre?") → usa 'consultar_disponibilidad'. NO agendes ni modifiques.
        4. Si quiere CAMBIAR/MOVER una cita existente → usa 'modificar_cita'. NO uses 'agendar_cita'.
        5. Si quiere una cita NUEVA → usa 'agendar_cita' SOLO cuando ya tengas servicio, fecha y hora confirmados. Si falta alguno de esos datos, pregunta primero.
        6. Si falta el SERVICIO → pregunta cuál prefiere. NUNCA inventes un servicio.
        7. Si falta la FECHA o la HORA → pregunta antes de agendar.
        8. Para CANCELAR → usa 'cancelar_cita'.
        9. Nunca muestres JSON, código ni etiquetas técnicas al cliente.
        9. Si el cliente saluda o pregunta por servicios → responde en texto normal sin llamar funciones.
        `;

        const messages = [
            { role: 'system', content: systemInstruction },
            ...conversationHistory.map(m => ({ role: m.role, content: m.content }))
        ];

        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages,
            tools: [agendarCitaTool, cancelarCitaTool, modificarCitaTool, consultarDisponibilidadTool],
            tool_choice: 'auto'
        });

        const toolCall = response.choices[0].message.tool_calls;

        if (toolCall && toolCall.length > 0) {
            const call = toolCall[0];
            const functionName = call.function.name;
            const functionArgs = JSON.parse(call.function.arguments);

            const assistantResponse = await procesarLlamadaFuncion(
                functionName,
                functionArgs,
                TELEFONO_BOT,
                userId,
                currentUserName,
                msg.body
            );

            await client.sendMessage(msg.from, assistantResponse);
            addMessageToHistory(userId, 'assistant', assistantResponse);
        } else {
            const rawContent = response.choices[0].message.content;
            const leakedCall = detectLeakedFunctionCall(rawContent);

            if (leakedCall) {
                console.log('⚠️ El modelo devolvió JSON en lugar de usar tool_calls. Reintentando como función:', leakedCall.name);
                if (!leakedCall.args.nombre_cliente) {
                    leakedCall.args.nombre_cliente = currentUserName;
                }
                const assistantResponse = await procesarLlamadaFuncion(
                    leakedCall.name,
                    leakedCall.args,
                    TELEFONO_BOT,
                    userId,
                    currentUserName,
                    msg.body
                );
                await client.sendMessage(msg.from, assistantResponse);
                addMessageToHistory(userId, 'assistant', assistantResponse);
            } else {
                console.log('💭 El modelo respondió sin llamar ninguna función (respuesta directa).');
                let assistantResponse = sanitizeResponseText(rawContent);
                if (!assistantResponse) {
                    assistantResponse = await obtenerRespuestaDirecta(messages, currentUserName);
                }
                if (!assistantResponse) assistantResponse = 'Lo siento, no pude procesar tu respuesta. ¿Puedes intentar de nuevo?';
                await client.sendMessage(msg.from, assistantResponse);
                addMessageToHistory(userId, 'assistant', assistantResponse);
            }
        }
    } catch (error) {
        console.error('❌ Error procesando el mensaje:', error);
    }
});

client.initialize();