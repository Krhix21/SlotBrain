# Informe de conversaciones del bot (juez externo: GLM)

- Corrida: 23 de noviembre de 2026, 3:05 p. m. (hora Bogotá)
- Empresa: Clinica Sonrisa Dental (PRUEBA)
- Escenario: un día normal de agendamiento por WhatsApp (6 conversaciones, servicio "Limpieza dental").
- Días reales usados en los guiones: martes, 24 de noviembre y jueves, 26 de noviembre.
- Juez: GLM (modelo distinto al del bot, que es gpt-oss-120b de Groq). El juez ya no corre dentro del script: el script genera las conversaciones y el análisis se hace fuera, leyendo cada conversación completa con contexto.
- Resultado: **naturalidad media 8,1/10** sobre 22 respuestas, **cero fallos de reglas** (una pregunta por mensaje, sin asteriscos, sin repetir saludo, sin precios inventados, longitud).

Nota de comparación: el informe anterior (corrida del 23 en la mañana) lo calificaba el mismo modelo del bot y dio 7,7/10. Este usa un juez distinto y más estricto, así que las cifras no son comparables al pie de la letra; lo comparable es la lista de defectos: los 4 flojos de entonces estaban en respuestas de 3-6/10 y aquí ya no existen.

## Lo que se ajustó en el código a partir de este análisis

Todos en la rama feature/pruebas-conversacion:

1. **"¿Tiene a las 09:00?" ahora se contesta sí o no** (era lo más feo: repetía la lista). Si la hora está libre: "Sí, a las 09:00 hay espacio... ¿Te la aparto?"; si no: "A las 09:00 ya está reservada; la más cercana libre ese día es a las 10:00. ¿Te la aparto?". Y la reserva pendiente se alinea con la hora ofrecida, para que un "sí" posterior agende lo que el cliente cree que aceptó. (bot.js)
2. **Las fechas ya no dicen el año** ("24 de noviembre" y no "24 de noviembre de 2026"). El año solo aparece si la cita es de otro año. (tiempo.js)
3. **Las despedidas ya no re-confirman** la cita: "Perfecto, gracias. Hasta luego" → "¡Que tengas un buen día!". El prompt prohíbe llamar herramientas cuando el cliente solo da las gracias o se despide. (bot.js)
4. **Adiós al "¡Perfecto amigo!"**: el prompt ya no le dice al modelo que el cliente se llama "amigo" cuando no hay nombre; confirma sin vocativo ("¡Listo! Tu cita quedó agendada..."). Tampoco pregunta el nombre antes de agendar: el nombre se usa si el cliente lo dice. (bot.js)
5. **"Cita para ayer" se aclara de una**: "¡Uy, ese día ya pasó! ¿Te viene bien una cita para hoy o mañana?" — la regla lleva ejemplo concreto para que el modelo no vuelva a relistar horarios sin explicar. (bot.js)
6. **Cambios de cita por la vía correcta**: si el cliente ya tiene cita y acepta una hora nueva, el sistema la MUEVE (modificar_cita) en vez de agendar encima, que antes dejaba al cliente con dos citas. El prompt también orienta al modelo a usar modificar_cita y cancelar_cita sin pedirle fecha/hora al cliente (el sistema ya conoce la cita vigente). (bot.js)
7. **Saludo y confirmación naturales**: el saludo ya no dice "Soy tu asesor virtual" ni interroga el nombre ("¡Hola! 👋 Bienvenido a X. ¿En qué te puedo ayudar?"). Ojo: en la Clínica de Prueba estos textos vivían en la base (mensaje_bienvenida y mensaje_confirmacion) y pisan los default del código: se actualizaron allí también. (bot.js + datos de la empresa de prueba)
8. **Más frases de aceptación reconocidas**: "ok sí", "perfecto", "listo, muchas gracias", "sí, la más cercana" agendan directo sin volver a preguntar. (bot.js)

Se hicieron 3 corridas durante el ajuste; esta es la final y es la más limpia de las tres.

## Lo que queda por mirar (evaluación tuya)

- **El encabezado de ofertas se repite igual siempre**: "Estos son los horarios libres para Limpieza dental el 24 de noviembre:" (todas las notas de ofertas: 7/10). Es la parte más "de sistema" que queda. Es una plantilla deliberada (barata y predecible, y el guionizador de voz la lee bien); hacerla variable exige una segunda llamada al modelo por cada oferta, que duplica tokens y latencia. Si te molesta, es el siguiente frente.
- **"con Dr. Molar Prueba" y "(PRUEBA)"**: son datos de la empresa de prueba, no del código. En un negocio real esos campos dicen el nombre verdadero y desaparecen.
- **Variabilidad del modelo**: entre corridas hubo una en la que "cita para ayer" volvió a relistar sin aclarar (con temperatura 0.5 a veces ignora la regla). Con el ejemplo en la regla 6 esta corrida final lo hizo perfecto, pero si en producción lo ves fallar de nuevo, la alternativa es un candado determinista en código (responder directo cuando la fecha pedida ya pasó).

---

## 1. Cliente agenda por primera vez

**Cliente:** Buenas, soy Laura, quería pedir una cita de Limpieza dental para el martes, 24 de noviembre, ¿me puede ayudar?

**Bot:**
> Estos son los horarios libres para Limpieza dental el 24 de noviembre:
> • 09:00
> • 09:30
> • 10:00
> • 10:30
> • 11:00
>
> ¿Te aparto alguno o prefieres otra hora?

_Naturalidad: 7/10 — Clara, con horas reales y una sola pregunta. El encabezado "Estos son los horarios libres para..." suena a sistema y se repite igual en cada oferta._

**Cliente:** Sí, la primera que tenga me sirve, gracias

**Bot:**
> ¡Listo Laura! Tu cita de Limpieza dental quedó agendada para el 24 de noviembre a las 09:00 con Dr. Molar Prueba. Te esperamos.

_Naturalidad: 9/10 — Agendó directo sin relistar, usa el nombre, fecha sin año. Casi lo que escribiría una recepcionista._

**Cliente:** Perfecto, gracias. Hasta luego

**Bot:**
> ¡Que tengas un buen día!

_Naturalidad: 9/10 — Despedida simple y correcta; antes aquí repetía la confirmación entera._

## 2. Cliente pregunta precio y elige hora concreta

**Cliente:** Hola, soy Marcela. ¿Me puede decir cuánto cuesta una Limpieza dental?

**Bot:**
> Una limpieza dental cuesta 600 COP y dura 45 min. ¿Te gustaría agendar una cita?

_Naturalidad: 8/10 — Respuesta directa con el precio correcto y una invitación a agendar. Natural._

**Cliente:** ¿Para el martes, 24 de noviembre qué horarios tienen?

**Bot:**
> Estos son los horarios libres para Limpieza dental el 24 de noviembre:
> • 10:00
> • 10:30
> • 11:00
> • 11:30
> • 12:00
>
> ¿Te aparto alguno o prefieres otra hora?

_Naturalidad: 7/10 — Correcta; mismo encabezado de plantilla (nota: las 09:00 ya no salen porque Laura se las llevó en la conversación 1: la disponibilidad es real)._

**Cliente:** ¿Tiene a las 09:00?

**Bot:**
> A las 09:00 ya está reservada; la más cercana libre ese día es a las 10:00. ¿Te la aparto?

_Naturalidad: 9/10 — Contesta la pregunta que hicieron, sí/no + alternativa. Antes aquí volvía a soltar la lista entera (3/10)._

**Cliente:** Sí, agéndemela por favor

**Bot:**
> ¡Listo Marcela! Tu cita de Limpieza dental quedó agendada para el 24 de noviembre a las 10:00 con Dr. Molar Prueba. Te esperamos.

_Naturalidad: 9/10 — Directa, con nombre y hora correcta (agendó la 10:00 que se le ofreció, no la ocupada)._

**Cliente:** Listo, muchas gracias

**Bot:**
> ¡Un placer! Que tengas un buen día.

_Naturalidad: 9/10 — Despedida con contexto, sin confirmaciones repetidas._

## 3. Cliente confuso que no da detalles

**Cliente:** hola?

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?

_Naturalidad: 8/10 — Simple y sin interrogatorio. El "(PRUEBA)" es dato de la empresa de prueba; en un negocio real no aparece._

**Cliente:** necesito una cita lo más pronto posible

**Bot:**
> Estos son los horarios libres para Limpieza dental el 23 de noviembre:
> • 15:30
> • 16:00
> • 16:30
> • 17:00
>
> ¿Te aparto alguno o prefieres otra hora?

_Naturalidad: 7/10 — Va directo con horas de hoy (quedan pocas porque el día avanzó: disponibilidad real). Encabezado de plantilla._

**Cliente:** ok sí

**Bot:**
> ¡Listo! Tu cita de Limpieza dental quedó agendada para el 23 de noviembre a las 15:30 con Dr. Molar Prueba. Te esperamos.

_Naturalidad: 8/10 — Interpretó "ok sí" como la primera ofrecida y agendó de una, sin nombre inventado. Antes aquí decía "¡Perfecto amigo!" (5/10)._

## 4. Cliente pide un servicio que no existe

**Cliente:** Hola, ¿hacen blanqueamiento con láser?

**Bot:**
> No contamos con blanqueamiento láser. Lo más parecido que ofrecemos es la limpieza dental (incluye valoración), a 600 COP y dura 45 min. ¿Te interesa agendar una?

_Naturalidad: 8/10 — No honesta y con alternativa concreta. "a 600 COP y dura 45 min" es levemente torpe; "cuesta 600 COP y dura 45 min" fluiría mejor._

**Cliente:** Ah ok, entonces mejor una Limpieza dental para el martes, 24 de noviembre, lo que tengan

**Bot:**
> Estos son los horarios libres para Limpieza dental el 24 de noviembre:
> • 11:00
> • 11:30
> • 12:00
> • 12:30
> • 13:00
>
> ¿Te aparto alguno o prefieres otra hora?

_Naturalidad: 7/10 — Correcta; encabezado de plantilla._

**Cliente:** Perfecto, sí

**Bot:**
> ¡Listo! Tu cita de Limpieza dental quedó agendada para el 24 de noviembre a las 11:00 con Dr. Molar Prueba. Te esperamos.

_Naturalidad: 8/10 — Agendó directo sin pedir el nombre (antes preguntaba el nombre antes de confirmar). Sin vocativo queda un pelín frío pero es humano._

## 5. Cliente pide fecha pasada y luego cancela

**Cliente:** Buenas, soy Jorge. Necesita una cita para el día de ayer

**Bot:**
> ¡Uy, ese día ya pasó! ¿Te viene bien una cita para hoy o mañana?

_Naturalidad: 9/10 — Exactamente lo que diría una persona. Antes relistaba horarios de hoy sin explicar nada (4/10)._

**Cliente:** Sí, la más cercana que tenga

**Bot:**
> Estos son los horarios libres para Limpieza dental el 23 de noviembre:
> • 16:30
> • 17:00
>
> ¿Te aparto alguno o prefieres otra hora?

_Naturalidad: 7/10 — Coherente: no había lista previa que aceptar, así que ofrecer horas es correcto. Mismo encabezado de plantilla._

**Cliente:** Espere... se me complicó. ¿Me la puede cancelar?

**Bot:**
> No tienes ninguna cita confirmada para cancelar. Si cambias de idea y quieres agendar, avísame.

_Naturalidad: 8/10 — Correcto: no llegó a agendarse (el cliente se arrepintió a mitad del flujo), y lo dice con claridad y sin tecnicismos._

**Cliente:** Gracias, quedo pendiente

**Bot:**
> ¡Perfecto! Cuando quieras agendar, avísame. ¡Que tengas buen día!

_Naturalidad: 8/10 — Cálida y con puerta abierta. "¡Perfecto!" reaccionando a un "gracias" queda un pelín desalineado; "¡De nada!" habría encajado mejor._

## 6. Cliente que reprograma su cita

**Cliente:** Hola, soy Camila, ¿me puede dar una cita de Limpieza dental para el martes, 24 de noviembre?

**Bot:**
> Estos son los horarios libres para Limpieza dental el 24 de noviembre:
> • 12:00
> • 12:30
> • 13:00
> • 13:30
> • 14:00
>
> ¿Te aparto alguno o prefieres otra hora?

_Naturalidad: 7/10 — Correcta; encabezado de plantilla._

**Cliente:** Sí, la primera

**Bot:**
> ¡Listo Camila! Tu cita de Limpieza dental quedó agendada para el 24 de noviembre a las 12:00 con Dr. Molar Prueba. Te esperamos.

_Naturalidad: 9/10 — Directa, con nombre, sin relistar._

**Cliente:** ¿Me la puede cambiar para el jueves, 26 de noviembre? A las 09:00 si puede ser

**Bot:**
> Perfecto Camila, tu cita se movió al 26 de noviembre a las 09:00.

_Naturalidad: 9/10 — Validó la hora nueva y la movió de una (no canceló la vieja y dejó al cliente sin cita, como pasaba antes; quedó una sola cita: 26/11 09:00)._

**Cliente:** Listo, muchas gracias

**Bot:**
> ¡Un placer! Que tengas un buen día.

_Naturalidad: 9/10 — Despedida limpia._

---

## Cómo reproducirlo

```
node scripts/test-conversacion.js --sin-juez --reporte
```

El script genera las conversaciones contra la Clínica de Prueba (sin Meta, sin Calendar, teléfonos falsos, borra sus datos al final) y escribe este documento con el texto tal cual; la calificación del juez externo (GLM) se agrega después de la corrida, fuera del proceso.
