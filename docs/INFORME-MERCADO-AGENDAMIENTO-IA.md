# Informe: Agendamiento de citas con IA — mercado vs SlotBrain

*Investi (Mi Negocio) · 16/11/2026 · precios verificados en webs oficiales y comparativas de oct-nov 2026*

---

## 1. Resumen ejecutivo

El mercado tiene dos familias: (a) plataformas de gestión de agenda para belleza/salud con IA añadida (AgendaPro, Fresha, Booksy) y (b) bots conversacionales por WhatsApp/voz que agendan dentro del chat (VozIA, NextReply, Booksolut, Cal AI). **SlotBrain ya pertenece a la familia (b) — la más nueva — pero le faltan 3 piezas que todos los líderes tienen:** recordatorios con ciclo de confirmación cerrado, cobro de seña/pago al reservar, y métricas de no-show.

Dato del sector: sin recordatorios, los no-shows en belleza/salud rondan 10-30% de la agenda. Cada cita evitada paga el sistema entero.

---

## 2. Comparativa del mercado (precios)

| Producto | Qué es | IA | Precio | WhatsApp |
|---|---|---|---|---|
| **Cal.com** | Plataforma de agendamiento + Cal AI (agente de llamadas/chat 24/7, routing, CRM, white-label) | Agent model: llama, reserva, recuerda, seguimiento no-shows | Gratis; Teams ~16 USD/mes | Chat en web; sin WhatsApp nativo |
| **Calendly** | Rey del link de reserva, IA en todo el flujo | Chat lenguaje natural + routing de leads | Gratis; IA desde ~24 USD/mes | No |
| **Fresha** | Plataforma global belleza + marketplace (120.000 negocios) | AI Concierge (adicional, por local): responde y agenda | 19,95 USD 1 prof; 14,95 USD/prof en Team | 20 avisos gratis/mes, luego por mensaje; Concierge ~29,95 USD/mes (mensajes) o ~99,95 USD (con llamadas) |
| **AgendaPro** | Software de gestión LATAM (+30.000 negocios) | Agentes de IA (Sofía/Julia) que recuerdan, confirman y reagendan | 9 / 29 / 59 / 199 USD según plan y país (México: 299-4.500 MXN + IVA) | Adicional desde 7 USD/mes por 50 mensajes — **ningún plan lo incluye** |
| **Booksy** | Marketplace + app para clientes | AI Receptionist (beta, solo llamadas) | 29,99 USD + 20 USD por profesional extra | Sin WhatsApp nativo |
| **VozIA** (Perú) | IA conversacional que agenda y cobra adelanto | Sí, dentro del chat | Desde S/99/mes, sin cobro por especialista | Sí |
| **NextReply** | Recepcionista IA: entiende audios y fotos, agenda en Google Calendar | Sí | 29 / 59 / 99 USD | Sí (recordatorios "en camino") |
| **Booksolut** (Argentina) | Bot WhatsApp con IA rioplatense + MercadoPago + seña obligatoria | Sí | Plan gratuito; desde ARS 15.000/mes | Sí |
| **SuperTurno** | Agenda con IA en todos los planes | Sí | 19 USD (1 prof), 49 USD (4) | Sí |
| **Bewe** (España) | Agenda + marketing | Linda, desde Growth (300 convers./mes) | 29 USD; Growth 59 USD | Sí |
| **Wati** | Plataforma WhatsApp API con chatbots | Flujos | 49 USD (5 agentes) | Sí, no agenda por sí solo |
| **Citalvo** (Colombia) | Agenda LATAM | No destacada | Gratis 15 citas/mes; 39k-129k COP | API en planes de pago |
| **OSBOOK** (Colombia) | Agenda barbería | No | 30k COP 1 prof; WhatsApp incluido | Sí |
| **Clara** | Asistente por email, negocia como humano | CC model | ~80-99 USD/mes | No (email) |
| **Kronologic** | IA de alto volumen para ventas | Agent model | Desde ~112 USD/mes | No (email) |

Fuentes: agendapro.com/es/planes · fresha.com · booksy.com · superturno.app/es/blog/mejores-herramientas-centros-estetica-2026 · nextreply.io/es-mx/blog/herramientas-agendar-citas-whatsapp · voziaperu.com/blog/agendapro-precios · booksolut.com · chatfuel.com/es/blog/best-salon-booking-app · osbook.org · citalvo.com · cal.com/blog/best-ai-scheduling-assistant · pabau.com/es/blog/agendapro-precios · barbea.app/blog/barbea-vs-agendapro

**Observación de mercado clave:** las plataformas de gestión cobran mensualidad + cobran los mensajes de WhatsApp APARTE y por paquete (AgendaPro: 7 USD/50 msgs; Fresha: por mensaje). Los bots conversacionales puros (VozIA, NextReply, Booksolut) cobran mensualidad plana con WhatsApp incluido. Ahí está la oportunidad de precio de SlotBrain.

---

## 3. SlotBrain vs los líderes

**Ya tiene (el núcleo duro, el difícil):**
- Conversación real con LLM (Groq) con herramientas: ver_slots, agendar, cancelar, modificar.
- Disponibilidad real: horario del profesional + duración del servicio + freebusy de Google Calendar + ausencias.
- Re-verificación del slot antes de escribir el evento (no pisa citas). Propuesta pendiente que caduca a los 30 min.
- Multi-empresa y multi-profesional con zona horaria IANA por empresa.
- OAuth de calendario por profesional con enlaces firmados.
- Scheduler de recordatorios ya implementado (Fase 4, `notificaciones.js`), con idempotencia y reintentos.

**Brechas frente al mercado (ordenadas por retorno):**
1. **Recordatorios con ciclo cerrado de confirmación** — hoy se avisa pero no se actúa con la respuesta (ver sección 4). Es lo más barato de construir y lo que más dinero recupera.
2. **Plantillas WABA UTILITY** — requisito de producción: mensajes que el bot inicia fuera de la ventana de 24 h exigen plantilla aprobada por Meta. Hoy se envía texto libre (el propio código lo documenta); en producción los recordatorios serían rechazados.
3. **Pago/seña al reservar** — Booksolut la cobró como seña obligatoria vía MercadoPago y Fresha/AgendaPro cobran online. Es el freno de no-shows más fuerte y el diferenciador n.º 1 en LATAM.
4. **Routing de profesional** — asignar según especialidad, carga o zona (Cal.com y AgendaPro Pro lo hacen).
5. **Métricas** — tasa de confirmación, no-shows, hora pico, ocupación por profesional. Sin datos no se puede vender mejora.
6. **Canal de voz** — Fresha (Concierge con llamadas), Booksy y Cal.com ya lo tienen. Bonito, pero no es lo urgente.

**Qué valdría la pena construir primero:** la pieza 1+2 juntas (recordatorio → respuesta SÍ/NO → confirmar/reagendar, con plantillas UTILITY). Con eso SlotBrain queda a la par del mercado en el flujo crítico. La pieza 3 (seña con MercadoPago) es la que lo pondría por delante de Fresha y AgendaPro en el mercado hispano.

---

## 4. Recordatorios automáticos vs las notificaciones actuales

Lo que ya existe hoy (`notificaciones.js`, Fase 4): un scheduler corre cada minuto, mira las citas vigentes de las próximas 24 h y envía UN mensaje por cita: al profesional 24 h antes y al cliente 2 h antes (horas configurables por empresa). Registra en `citas.notificaciones` si salió o falló, y reintenta los fallidos.

Eso ES un recordatorio, pero es un **aviso de un solo toque, sin ciclo**. Lo que el mercado llama "recordatorios automáticos" es otra cosa, con 4 diferencias:

1. **No escucha la respuesta.** El mensaje al cliente dice "Responde SÍ para confirmar o NO si necesitas cambiarla", pero ese SÍ no llega a ningún flujo: la detección de "SÍ" del bot (`esConfirmacionAfirmativa`) solo actúa si hay una propuesta de reserva pendiente en esa conversación. Un "SÍ" respondiendo al recordatorio no marca la cita como confirmada, y un "NO" no la reagenda ni libera el hueco. El mercado: confirma de verdad (pasa a estado confirmada), y si el cliente dice NO ofrece horarios alternativos al instante y libera el slot.

2. **Es un solo toque.** Mercado: secuencia multi-touch (ej. 24 h → 2 h → si no respondió, recordatorio extra 30-60 min antes). Hoy si la ventana de 2 h falla, no hay segunda oportunidad.

3. **No escala el no-show.** Mercado: si el cliente no responde, avisa al profesional con tiempo, puede activar lista de espera y rellenar el hueco; después de la cita registra si asistió. SlotBrain ya tiene el estado `no_asistio` en el panel, pero nada lo alimenta automáticamente.

4. **No mide.** Mercado: tasa de confirmación y no-show por empresa/profesional/servicio. SlotBrain no registra la respuesta al recordatorio, así que no puede medir.

**En una frase:** hoy SlotBrain AVISA; el mercado CONFIRMA, REACCIONA y MIDE.

**Riesgo técnico a resolver:** los recordatorios se envían como texto libre de WhatsApp. Meta exige plantillas UTILITY aprobadas para mensajes que el negocio inicia fuera de la ventana de 24 h (el propio `notificaciones.js` lo documenta). Con el número de prueba solo llegan a destinatarios verificados; en producción los recordatorios serían rechazados sin plantilla.

**Costo de no hacerlo:** en belleza/salud un 10-30% de la agenda se pierde por no-shows. Si el sistema evita 2-3 citas perdidas al mes, ya se pagó solo (referencia de osbook.org).

---

## 5. Fuentes

- cal.com/blog/best-ai-scheduling-assistant (comparativa 2026)
- zapier.com/blog/best-ai-scheduling
- claralabs.com/blog/ai-scheduling-assistant-guide
- agendapro.com/es/planes · agendapro.com/mx/planes · pabau.com/es/blog/agendapro-precios · voziaperu.com/blog/agendapro-precios
- superturno.app/es/blog/mejores-herramientas-centros-estetica-2026
- nextreply.io/es-mx/blog/herramientas-agendar-citas-whatsapp
- chatfuel.com/es/blog/best-salon-booking-app
- booksolut.com · booksolut.com/blog/mejor-app-turnos-peluqueria-argentina-2026 · booksolut.com/vs/fresha
- barbea.app/blog/barbea-vs-agendapro · mexsaas.com/precio/agendapro
- osbook.org/guias/cuanto-cuesta-software-agenda-barberia
- citalvo.com/es-CO/recursos/citalvo-vs-booksy-fresha-agendapro
- bossbot.uk/blog/automatizacion-whatsapp-salon-ar
- Código propio: `notificaciones.js`, `bot.js` (fast-path de confirmación), `docs/ROADMAP-MULTITENANT.md` Fase 3.3D y 4
