# SlotBrain — Plan de voz: audios por WhatsApp primero, llamadas después

Documento de trabajo del área de investigación (Investi). Última actualización: 18 de noviembre de 2026.

## Objetivo

Usar la voz clonada del negocio (Qwen3-TTS, licencia Apache 2.0) en dos etapas:

1. Mensajes de audio por WhatsApp (costo bajo, cero infraestructura nueva).
2. Llamadas de voz por WhatsApp (la misma voz y el mismo cerebro LLM, cambiando solo la capa de entrega).

Ambas etapas comparten activos: el sample de voz (15-30 s + transcripción exacta), la voz clonada de referencia, y el LLM con el prompt/rol del asistente de la barbería.

---

## Parte 1. Qué hace LiveKit (explicación clara)

LiveKit es una empresa de infraestructura de voz y video en tiempo real. Tiene tres piezas:

### 1. LiveKit Server (el motor, open source)
Un servidor WebRTC open source (SFU). Su trabajo de fondo: recibir audio de un participante y repartirlo a los demás en tiempo real, con baja latencia. Es lo que sostiene la conversación. Se puede auto-hospedar, pero para el conector de WhatsApp eso no alcanza (ver abajo).

### 2. LiveKit Agents (el framework de agentes de voz)
Un framework (Python/Node) para construir el "cerebro" conversacional: define un agente que escucha (STT), piensa (LLM) y habla (TTS). Tiene plugins oficiales para Deepgram, OpenAI, ElevenLabs, Cartesia, etc., y permite enchufar un TTS propio (ahí entra Qwen3-TTS: se implementa la interfaz de TTS y se conecta al motor self-hosted con la voz clonada).

### 3. LiveKit Cloud (la plataforma administrada)
El servicio pago que corre el motor por ti, con dashboard, sesiones y analítica. Y acá está la pieza clave para nosotros:

### El WhatsApp Connector (disponible generalmente desde 2026)
Un conector oficial que hace de puente entre una llamada de WhatsApp Business Calling y una sala de LiveKit:

- Cuando el cliente llama al número de WhatsApp Cloud API del negocio, Meta envía un webhook `call connect` con una oferta SDP.
- Tu app pasa esos datos a la API `AcceptWhatsAppCall` de LiveKit y la llamada entra a una sala como un participante más (con el número del cliente como identidad).
- El agente (tu cerebro con la voz clonada) se despacha a esa sala y conversa. El audio fluye bidireccional en streaming.
- Para llamadas salientes es igual con `DialWhatsAppCall` (requiere permiso previo del cliente y solo regiones soportadas).
- WhatsApp Calling es WebRTC de punta a punta (Opus), así que no hay transcodificación: el audio entra a la sala sin conversión.
- El conector no graba ni almacena audio; solo lo puentea.

**Requisitos y letra pequeña del conector:**

- Solo funciona en LiveKit Cloud (no con servidor LiveKit auto-hospedado). Los agentes en sí pueden correr donde sea, incluida tu propia infraestructura.
- Necesitas: número en WhatsApp Cloud API, app en Meta Developers con webhook de `calls` activo, permisos de llamadas habilitados (horarios para entrantes; permiso del cliente para salientes).
- Precio: minutos de conector al precio de SIP — 0,004 USD/min en plan Ship, 0,003 en Scale. Llamadas simultáneas: 5 en Build, 20 en Ship, 100 en Scale.
- Alternativas al conector: Twilio (WhatsApp Business Calling), o plataformas de agentes de voz como Retell o Vapi que ya soportan WhatsApp Calling. Si LiveKit Cloud no convence, la comparación es contra estas.

---

## Parte 2. El plan por fases

### Fase 0 — Voz clonada lista (prerrequisito, ya en marcha)
- Sample del dueño/negocio: 15-30 s, habitación silenciosa, transcripción exacta palabra por palabra (el error de transcripción es el que más degrada la clonación).
- Guardar sample + transcripción + textos de prueba en español colombiano (frases reales del bot) como "voz oficial" versionada.
- Validación ya hecha por el dueño en el demo de Hugging Face (aprobada: "quedé impresionado").

Entregable: carpeta de assets de voz + frases de prueba documentadas.

### Fase 1 — Audios por WhatsApp (la que ya está en el plan del producto)
- Backend en Render recibe mensajes (texto o pedido de confirmación/cita) y pide audio a la API de voz.
- API de voz: servicio con Qwen3-TTS self-hosted (Apache 2.0) expuesto como endpoint chico que recibe texto + id de voz y devuelve el audio.
- Hosting de la GPU: NO el PC del dueño (GTX 1050 insuficiente para producción) y NO Colab (viola términos y muere). Opciones: serverless GPU por hora (Modal, RunPod, Replicate) — una prueba completa sale en menos de 1 USD — o GPU pequeña dedicada (20-40 USD/mes) cuando el volumen lo justifique.
- Formato: WhatsApp acepta audio en ogg/opus; convertir la salida del TTS a opus con ffmpeg antes de enviar.
- Regla de producto: la voz del negocio solo para mensajes que agregan valor (confirmaciones, recordatorios, respuestas del asistente). No para todo: un chat lleno de audios cansa.

Entregable: bot que confirma citas con la voz del negocio.

### Fase 2 — Llamadas entrantes por WhatsApp
- Activar WhatsApp Business Calling en el número Cloud API: webhook de `calls`, horarios de atención configurados, término de mensajería ≥ 2.000 clientes/día (los números de prueba están exentos).
- Entrantes son gratis para el negocio.
- Camino corto: LiveKit Cloud + WhatsApp Connector + agente en LiveKit Agents con TTS propio (Qwen3-TTS vía GPU en nube) y el mismo LLM del chat.
- Camino alternativo si LiveKit no convence: Twilio WhatsApp Calling, Retell o Vapi.
- Presupuesto de latencia para que la llamada suene natural: STT 60-100 ms + LLM 100-200 ms + TTS streaming 100-300 ms (< ~1 s total). Qwen3-TTS en modo streaming da primera respuesta en ~97 ms, dentro del presupuesto.
- Diseño de producto: el bot atiende, agenda o responde, y si el pedido es complejo ofrece "te paso con [persona] por WhatsApp" (handoff a humano por chat, no transferencia de llamada).

Entregable: cliente llama al número del negocio y el bot con la voz del negocio agenda y cuelga.

### Fase 3 — Llamadas salientes (recordatorios con la voz del negocio)
- Requiere: permiso previo del cliente (autorización en el chat, dura 7 días, o permanente), máximo 1 solicitud/día y 2/semana, cobro por minuto en pulsos de 6 s. Colombia no está en la lista de países bloqueados.
- Casos de uso: recordatorio de cita ("señor, le recuerdo su corte mañana a las 3") y relleno de huecos de agenda (ofrecer el hueco liberado a clientes de la lista de espera — función inspirada en la waitlist de Squire).
- Cuidado: es el caso más sensible de spam. Regla interna: solo con opt-in explícito y solo para mensajes con valor (cambios, recordatorios, huecos a nombre del cliente).

Entregable: recordatorios automáticos con voz del negocio para clientes con opt-in.

---

## Parte 3. Costos nuevos al pasar a llamadas (resumen)

- Minutos de conector/telefonía: ~0,004 USD/min (LiveKit Ship) para llamadas gestionadas por el conector; salientes por WhatsApp se cobran aparte por Meta por minuto (pulsos de 6 s).
- GPU de nube permanente o serverless para TTS en vivo: 20-40 USD/mes dedicada, o centavos por uso en serverless (con el riesgo de arranque en frío, mitigable con warm pool cuando haya volumen).
- Plataforma de agentes de voz (LiveKit Cloud u otra): plan base + minutos.
- API de Meta: entrantes gratis; salientes con cobro por minuto.

---

## Parte 4. Decisiones abiertas para el dueño

1. Proveedor de llamadas: LiveKit Cloud (conector oficial, GA) vs Twilio vs Retell/Vapi. Recomendación inicial: LiveKit Cloud por el conector nativo y el framework open source de agentes, evaluando costos reales en Fase 2.
2. GPU de voz: serverless por hora (empezar) vs GPU dedicada (cuando haya volumen). Empezar serverless.
3. Quién presta la voz: la voz del dueño ya validada. Confirmar consentimiento por escrito para su uso comercial (la licencia del software no cubre el derecho sobre la voz de una persona).

## Fuentes

- docs.livekit.io/telephony/connectors/whatsapp/ — conector de WhatsApp: webhooks, SDP, APIs Accept/Dial/Connect/Disconnect, requisitos.
- docs.livekit.io/telephony/connectors/ y livekit.com/blog/introducing-livekit-connectors — qué es un conector, precio de minutos (0,004/0,003 USD), concurrencia, GA y fin de beta, WebRTC de punta a punta sin transcodificación, "el conector nunca graba".
- docs.livekit.io/reference/telephony/connectors-api/ y SDK de servidor (Node 2.20) — parámetros de las APIs.
- community.livekit.io — anuncios de GA del conector de WhatsApp (septiembre-noviembre 2026).
- developers.facebook.com / whatsappbusiness.com — WhatsApp Business Calling API: entrantes gratis, salientes con permiso y cobro por minuto, webhook de calls, requisitos de término de mensajería.
- televox.ai, docs.livekit.io/agents, deepgram.com — pipeline STT-LLM-TTS y presupuestos de latencia.
- github.com/QwenLM/Qwen3-TTS — streaming ~97 ms, licencia Apache 2.0, requisitos de GPU.
