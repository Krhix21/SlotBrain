# Informe de conversaciones del bot (juez de naturalidad)

- Corrida: 23 de noviembre de 2026, 10:28 p. m. (hora Bogotá)
- Empresa: Clinica Sonrisa Dental (PRUEBA)
- Set: validacion | Corridas: 3 | Nichos: clinica-formal, barberia-casual, spa-neutro.
- Servicio: "Limpieza dental". Conversaciones en el informe: 198 (22 × 3 × 3).
- Días reales usados en los guiones: martes, 24 de noviembre y jueves, 26 de noviembre.
- Reloj simulado: lunes 2026-11-23 10:00 America/Bogota.
- Juez: agente (Composer/Auto), 4 criterios 1–10; corrida con `--sin-juez`.
- Respuestas con observaciones de reglas (automáticas): 0 (el chequeo aún no marcaba “problemas técnicos”).

## Veredicto del agente (post-corrida)

**La matriz 22×3×3 NO es evidencia válida de calidad conversacional.** Groq agotó el cupo diario (TPD 200k) a mitad de la primera corrida: ~290/369 respuestas del informe son el fallback “Tengo problemas técnicos…” (≈79%). El resumen automático dijo 0 fallos porque ese texto no estaba en las reglas; ya se añadió la regla y reintento 429 en `bot.js`.

Escenarios limpios (antes del rate limit, clínica-formal c1 ≈1–8): oferta con horas + nombre, jerga, ortografía, multi-pregunta y cambio de opinión se ven naturales; “después de las 5” ofreció mañana por la mañana (no filtró post-17:00) — mejora pendiente general.

### Notas 1–10 (muestra limpia, clínica-formal c1)

| Escenario | Logró | Correcto | Breve | Humano |
|---|---:|---:|---:|---:|
| Hora ambigua a las 3 | 7 | 6 | 9 | 8 |
| Después de las 5 | 6 | 5 | 9 | 8 |
| Jerga parce pa mañana | 9 | 9 | 9 | 9 |
| Faltas de ortografía | 9 | 9 | 9 | 9 |
| Varias preguntas | 8 | 8 | 8 | 8 |
| Cambio de opinión | 9 | 9 | 9 | 9 |
| Profesional concreto | 8 | 8 | 9 | 8 |
| Cliente recurrente saludo | 7 | 7 | 9 | 8 |

Medias muestra limpia: logró 7.9 · correcto 7.6 · breve 8.9 · humano 8.5.

### Qué falta para cerrar evidencia

1. Esperar reset del TPD de Groq (o subir tier).
2. Re-correr: `node scripts/test-conversacion.js --set validacion --corridas 3 --nichos --sin-juez --reporte`
3. Con la nueva regla, cualquier “problemas técnicos” cuenta como fallo.

## Respuestas a mirar primero

- **Rate limit / fallo técnico:** mayoría del informe tras el escenario ~8; no usar esas filas para juzgar tono.
- **Después de las 5:** ofreció 09:00–10:00 en lugar de slots ≥17:00 (si existían).

## 1. Hora ambigua a las 3 [clinica-formal · corrida 1]

**Cliente:** Hola, quiero Limpieza dental para el martes, 24 de noviembre a las 3

**Bot:**
> Mañana para Limpieza dental puedo ofrecerte:
> • 09:00
> • 09:30
> • 10:00
> 
> ¿Te aparto alguno? ¿A nombre de quién?


**Cliente:** sí esa

**Bot:**
> ¿Prefiere el horario de 09:00, 09:30 o 10:00?


## 2. Despues de las 5 [clinica-formal · corrida 1]

**Cliente:** Buenas, hay Limpieza dental el martes, 24 de noviembre después de las 5?

**Bot:**
> Te muestro lo disponible mañana para Limpieza dental:
> • 09:00
> • 09:30
> • 10:00
> 
> ¿Te aparto alguno? ¿A nombre de quién?


**Cliente:** la primera que salga

**Bot:**
> ¡Listo! Tu cita de Limpieza dental quedó agendada para mañana a las 09:00 con Dr. Molar Prueba. Te esperamos.


## 3. Jerga parce pa manana [clinica-formal · corrida 1]

**Cliente:** parce me agenda Limpieza dental pa mañana

**Bot:**
> Mira, mañana para Limpieza dental me cuadran:
> • 10:00
> • 10:30
> • 11:00
> 
> ¿Te aparto alguno? ¿A nombre de quién?


**Cliente:** de una la primera

**Bot:**
> ¡Listo! Tu cita de Limpieza dental quedó agendada para mañana a las 10:00 con Dr. Molar Prueba. Te esperamos.


## 4. Faltas de ortografia [clinica-formal · corrida 1]

**Cliente:** ola kiero una sita de Limpieza dental para el martes, 24 de noviembre

**Bot:**
> Mira, mañana para Limpieza dental me cuadran:
> • 11:00
> • 11:30
> • 12:00
> 
> ¿Te aparto alguno? ¿A nombre de quién?


**Cliente:** si la primera xfa

**Bot:**
> ¡Listo! Tu cita de Limpieza dental quedó agendada para mañana a las 11:00 con Dr. Molar Prueba. Te esperamos.


## 5. Varias preguntas en un mensaje [clinica-formal · corrida 1]

**Cliente:** Hola cuánto vale Limpieza dental y qué horarios tienen el martes, 24 de noviembre?

**Bot:**
> Mira, mañana para Limpieza dental me cuadran:
> • 12:00
> • 12:30
> • 13:00
> 
> ¿Te aparto alguno? ¿A nombre de quién?


**Cliente:** ok la de 09:00

**Bot:**
> No disponemos de las 09:00; los horarios libres son 12:00, 12:30 y 13:00. ¿Cuál prefiere?


## 6. Cambio de opinion a mitad [clinica-formal · corrida 1]

**Cliente:** Quiero Limpieza dental el martes, 24 de noviembre

**Bot:**
> Para Limpieza dental mañana tengo estos horarios:
> • 12:00
> • 12:30
> • 13:00
> 
> ¿Te aparto alguno? ¿A nombre de quién?


**Cliente:** mejor el jueves, 26 de noviembre la primera

**Bot:**
> Lo que tengo libre el jueves para Limpieza dental:
> • 09:00
> • 09:30
> • 10:00
> 
> ¿Te aparto alguno? ¿A nombre de quién?


**Cliente:** listo

**Bot:**
> ¿Con cuál: 09:00, 09:30, 10:00?


## 7. Profesional concreto [clinica-formal · corrida 1]

**Cliente:** Hola, quiero Limpieza dental con Dr. Molar Prueba el martes, 24 de noviembre

**Bot:**
> Lo que tengo libre mañana para Limpieza dental:
> • 12:00
> • 12:30
> • 13:00
> 
> ¿Te aparto alguno?


**Cliente:** sí la primera

**Bot:**
> ¡Listo Dr. Molar Prueba! Tu cita de Limpieza dental quedó agendada para mañana a las 12:00 con Dr. Molar Prueba. Te esperamos.


## 8. Cliente recurrente saludo [clinica-formal · corrida 1]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


## 9. Audio transcrito con errores [clinica-formal · corrida 1]

**Cliente:** eh mm quiero este Limpieza dental para el martes, 24 de noviembre este a las 09:00 más o menos

**Bot:**
> A las 09:00 ya está reservada; la más cercana libre es a las 13:00. ¿Te la aparto? ¿A nombre de quién?


**Cliente:** sí agéndala

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 10. Eres un bot [clinica-formal · corrida 1]

**Cliente:** hola eres un bot?

**Bot:**
> Sí, soy el asistente virtual de Clinica Sonrisa Dental (PRUEBA). Puedo ayudarle a agendar; si prefiere una persona, dígamelo y aviso al equipo.


**Cliente:** ok entonces agenda Limpieza dental el martes, 24 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 11. Insiste en imposible [clinica-formal · corrida 1]

**Cliente:** Necesito cita a las 3 de la mañana el domingo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** pero tiene que ser a esa hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** bueno entonces mañana en la mañana lo que tengan

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 12. Hablar con una persona [clinica-formal · corrida 1]

**Cliente:** quiero hablar con una persona por favor

**Bot:**
> Claro, ya avisé al equipo para que le escriban por aquí.


## 13. Ok si con varias horas [clinica-formal · corrida 1]

**Cliente:** Horarios de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok sí

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 14. Solo gracias sin cita [clinica-formal · corrida 1]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


**Cliente:** gracias

**Bot:**
> ¡Un placer!


## 15. Cancelar sin tener cita [clinica-formal · corrida 1]

**Cliente:** cancélame la cita porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 16. Mover sin tener cita [clinica-formal · corrida 1]

**Cliente:** pásame la cita para el jueves, 26 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 17. Precio inventable [clinica-formal · corrida 1]

**Cliente:** cuánto sale el Limpieza dental?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 18. Dos servicios en uno [clinica-formal · corrida 1]

**Cliente:** quiero Limpieza dental y también un masaje el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** solo el primero entonces la primera hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 19. Fecha con dia pasado [clinica-formal · corrida 1]

**Cliente:** cita para ayer en la tarde

**Bot:**
> Ese día ya pasó. ¿Le sirve hoy o mañana?


**Cliente:** hoy entonces

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 20. Confirmacion listo muchas gracias con oferta [clinica-formal · corrida 1]

**Cliente:** Una Limpieza dental el martes, 24 de noviembre porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo, muchas gracias

**Bot:**
> ¡Un placer!


## 21. Elige segunda hora explicita [clinica-formal · corrida 1]

**Cliente:** Qué horas hay de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la de 09:30

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 22. Usted formal tono [clinica-formal · corrida 1]

**Cliente:** Buenos días, deseo agendar un Limpieza dental para el martes, 24 de noviembre, por favor

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** Sí, la primera opción, muchas gracias

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 23. Hora ambigua a las 3 [clinica-formal · corrida 2]

**Cliente:** Hola, quiero Limpieza dental para el martes, 24 de noviembre a las 3

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí esa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 24. Despues de las 5 [clinica-formal · corrida 2]

**Cliente:** Buenas, hay Limpieza dental el martes, 24 de noviembre después de las 5?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la primera que salga

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 25. Jerga parce pa manana [clinica-formal · corrida 2]

**Cliente:** parce me agenda Limpieza dental pa mañana

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** de una la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 26. Faltas de ortografia [clinica-formal · corrida 2]

**Cliente:** ola kiero una sita de Limpieza dental para el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** si la primera xfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 27. Varias preguntas en un mensaje [clinica-formal · corrida 2]

**Cliente:** Hola cuánto vale Limpieza dental y qué horarios tienen el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok la de 09:00

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 28. Cambio de opinion a mitad [clinica-formal · corrida 2]

**Cliente:** Quiero Limpieza dental el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** mejor el jueves, 26 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 29. Profesional concreto [clinica-formal · corrida 2]

**Cliente:** Hola, quiero Limpieza dental con Dr. Molar Prueba el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 30. Cliente recurrente saludo [clinica-formal · corrida 2]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


## 31. Audio transcrito con errores [clinica-formal · corrida 2]

**Cliente:** eh mm quiero este Limpieza dental para el martes, 24 de noviembre este a las 09:00 más o menos

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí agéndala

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 32. Eres un bot [clinica-formal · corrida 2]

**Cliente:** hola eres un bot?

**Bot:**
> Sí, soy el asistente virtual de Clinica Sonrisa Dental (PRUEBA). Puedo ayudarle a agendar; si prefiere una persona, dígamelo y aviso al equipo.


**Cliente:** ok entonces agenda Limpieza dental el martes, 24 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 33. Insiste en imposible [clinica-formal · corrida 2]

**Cliente:** Necesito cita a las 3 de la mañana el domingo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** pero tiene que ser a esa hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** bueno entonces mañana en la mañana lo que tengan

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 34. Hablar con una persona [clinica-formal · corrida 2]

**Cliente:** quiero hablar con una persona por favor

**Bot:**
> Claro, ya avisé al equipo para que le escriban por aquí.


## 35. Ok si con varias horas [clinica-formal · corrida 2]

**Cliente:** Horarios de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok sí

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 36. Solo gracias sin cita [clinica-formal · corrida 2]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


**Cliente:** gracias

**Bot:**
> ¡De nada!


## 37. Cancelar sin tener cita [clinica-formal · corrida 2]

**Cliente:** cancélame la cita porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 38. Mover sin tener cita [clinica-formal · corrida 2]

**Cliente:** pásame la cita para el jueves, 26 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 39. Precio inventable [clinica-formal · corrida 2]

**Cliente:** cuánto sale el Limpieza dental?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 40. Dos servicios en uno [clinica-formal · corrida 2]

**Cliente:** quiero Limpieza dental y también un masaje el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** solo el primero entonces la primera hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 41. Fecha con dia pasado [clinica-formal · corrida 2]

**Cliente:** cita para ayer en la tarde

**Bot:**
> Ese día ya pasó. ¿Le sirve hoy o mañana?


**Cliente:** hoy entonces

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 42. Confirmacion listo muchas gracias con oferta [clinica-formal · corrida 2]

**Cliente:** Una Limpieza dental el martes, 24 de noviembre porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo, muchas gracias

**Bot:**
> ¡Un placer!


## 43. Elige segunda hora explicita [clinica-formal · corrida 2]

**Cliente:** Qué horas hay de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la de 09:30

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 44. Usted formal tono [clinica-formal · corrida 2]

**Cliente:** Buenos días, deseo agendar un Limpieza dental para el martes, 24 de noviembre, por favor

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** Sí, la primera opción, muchas gracias

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 45. Hora ambigua a las 3 [clinica-formal · corrida 3]

**Cliente:** Hola, quiero Limpieza dental para el martes, 24 de noviembre a las 3

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí esa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 46. Despues de las 5 [clinica-formal · corrida 3]

**Cliente:** Buenas, hay Limpieza dental el martes, 24 de noviembre después de las 5?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la primera que salga

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 47. Jerga parce pa manana [clinica-formal · corrida 3]

**Cliente:** parce me agenda Limpieza dental pa mañana

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** de una la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 48. Faltas de ortografia [clinica-formal · corrida 3]

**Cliente:** ola kiero una sita de Limpieza dental para el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** si la primera xfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 49. Varias preguntas en un mensaje [clinica-formal · corrida 3]

**Cliente:** Hola cuánto vale Limpieza dental y qué horarios tienen el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok la de 09:00

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 50. Cambio de opinion a mitad [clinica-formal · corrida 3]

**Cliente:** Quiero Limpieza dental el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** mejor el jueves, 26 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 51. Profesional concreto [clinica-formal · corrida 3]

**Cliente:** Hola, quiero Limpieza dental con Dr. Molar Prueba el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 52. Cliente recurrente saludo [clinica-formal · corrida 3]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


## 53. Audio transcrito con errores [clinica-formal · corrida 3]

**Cliente:** eh mm quiero este Limpieza dental para el martes, 24 de noviembre este a las 09:00 más o menos

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí agéndala

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 54. Eres un bot [clinica-formal · corrida 3]

**Cliente:** hola eres un bot?

**Bot:**
> Sí, soy el asistente virtual de Clinica Sonrisa Dental (PRUEBA). Puedo ayudarle a agendar; si prefiere una persona, dígamelo y aviso al equipo.


**Cliente:** ok entonces agenda Limpieza dental el martes, 24 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 55. Insiste en imposible [clinica-formal · corrida 3]

**Cliente:** Necesito cita a las 3 de la mañana el domingo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** pero tiene que ser a esa hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** bueno entonces mañana en la mañana lo que tengan

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 56. Hablar con una persona [clinica-formal · corrida 3]

**Cliente:** quiero hablar con una persona por favor

**Bot:**
> Claro, ya avisé al equipo para que le escriban por aquí.


## 57. Ok si con varias horas [clinica-formal · corrida 3]

**Cliente:** Horarios de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok sí

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 58. Solo gracias sin cita [clinica-formal · corrida 3]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


**Cliente:** gracias

**Bot:**
> ¡De nada!


## 59. Cancelar sin tener cita [clinica-formal · corrida 3]

**Cliente:** cancélame la cita porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 60. Mover sin tener cita [clinica-formal · corrida 3]

**Cliente:** pásame la cita para el jueves, 26 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 61. Precio inventable [clinica-formal · corrida 3]

**Cliente:** cuánto sale el Limpieza dental?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 62. Dos servicios en uno [clinica-formal · corrida 3]

**Cliente:** quiero Limpieza dental y también un masaje el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** solo el primero entonces la primera hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 63. Fecha con dia pasado [clinica-formal · corrida 3]

**Cliente:** cita para ayer en la tarde

**Bot:**
> Ese día ya pasó. ¿Le sirve hoy o mañana?


**Cliente:** hoy entonces

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 64. Confirmacion listo muchas gracias con oferta [clinica-formal · corrida 3]

**Cliente:** Una Limpieza dental el martes, 24 de noviembre porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo, muchas gracias

**Bot:**
> ¡Un placer!


## 65. Elige segunda hora explicita [clinica-formal · corrida 3]

**Cliente:** Qué horas hay de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la de 09:30

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 66. Usted formal tono [clinica-formal · corrida 3]

**Cliente:** Buenos días, deseo agendar un Limpieza dental para el martes, 24 de noviembre, por favor

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** Sí, la primera opción, muchas gracias

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 67. Hora ambigua a las 3 [barberia-casual · corrida 1]

**Cliente:** Hola, quiero Limpieza dental para el martes, 24 de noviembre a las 3

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí esa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 68. Despues de las 5 [barberia-casual · corrida 1]

**Cliente:** Buenas, hay Limpieza dental el martes, 24 de noviembre después de las 5?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la primera que salga

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 69. Jerga parce pa manana [barberia-casual · corrida 1]

**Cliente:** parce me agenda Limpieza dental pa mañana

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** de una la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 70. Faltas de ortografia [barberia-casual · corrida 1]

**Cliente:** ola kiero una sita de Limpieza dental para el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** si la primera xfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 71. Varias preguntas en un mensaje [barberia-casual · corrida 1]

**Cliente:** Hola cuánto vale Limpieza dental y qué horarios tienen el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok la de 09:00

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 72. Cambio de opinion a mitad [barberia-casual · corrida 1]

**Cliente:** Quiero Limpieza dental el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** mejor el jueves, 26 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 73. Profesional concreto [barberia-casual · corrida 1]

**Cliente:** Hola, quiero Limpieza dental con Dr. Molar Prueba el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 74. Cliente recurrente saludo [barberia-casual · corrida 1]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


## 75. Audio transcrito con errores [barberia-casual · corrida 1]

**Cliente:** eh mm quiero este Limpieza dental para el martes, 24 de noviembre este a las 09:00 más o menos

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí agéndala

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 76. Eres un bot [barberia-casual · corrida 1]

**Cliente:** hola eres un bot?

**Bot:**
> Sí, soy el asistente virtual de Clinica Sonrisa Dental (PRUEBA). Te ayudo a agendar; si quieres hablar con alguien del equipo, dímelo y les aviso.


**Cliente:** ok entonces agenda Limpieza dental el martes, 24 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 77. Insiste en imposible [barberia-casual · corrida 1]

**Cliente:** Necesito cita a las 3 de la mañana el domingo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** pero tiene que ser a esa hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** bueno entonces mañana en la mañana lo que tengan

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 78. Hablar con una persona [barberia-casual · corrida 1]

**Cliente:** quiero hablar con una persona por favor

**Bot:**
> Claro, ya avisé al equipo para que te escriban por aquí.


## 79. Ok si con varias horas [barberia-casual · corrida 1]

**Cliente:** Horarios de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok sí

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 80. Solo gracias sin cita [barberia-casual · corrida 1]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


**Cliente:** gracias

**Bot:**
> ¡De nada!


## 81. Cancelar sin tener cita [barberia-casual · corrida 1]

**Cliente:** cancélame la cita porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 82. Mover sin tener cita [barberia-casual · corrida 1]

**Cliente:** pásame la cita para el jueves, 26 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 83. Precio inventable [barberia-casual · corrida 1]

**Cliente:** cuánto sale el Limpieza dental?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 84. Dos servicios en uno [barberia-casual · corrida 1]

**Cliente:** quiero Limpieza dental y también un masaje el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** solo el primero entonces la primera hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 85. Fecha con dia pasado [barberia-casual · corrida 1]

**Cliente:** cita para ayer en la tarde

**Bot:**
> ¡Uy, ese día ya pasó! ¿Para hoy o mañana te viene mejor?


**Cliente:** hoy entonces

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 86. Confirmacion listo muchas gracias con oferta [barberia-casual · corrida 1]

**Cliente:** Una Limpieza dental el martes, 24 de noviembre porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo, muchas gracias

**Bot:**
> ¡Un placer!


## 87. Elige segunda hora explicita [barberia-casual · corrida 1]

**Cliente:** Qué horas hay de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la de 09:30

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 88. Usted formal tono [barberia-casual · corrida 1]

**Cliente:** Buenos días, deseo agendar un Limpieza dental para el martes, 24 de noviembre, por favor

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** Sí, la primera opción, muchas gracias

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 89. Hora ambigua a las 3 [barberia-casual · corrida 2]

**Cliente:** Hola, quiero Limpieza dental para el martes, 24 de noviembre a las 3

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí esa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 90. Despues de las 5 [barberia-casual · corrida 2]

**Cliente:** Buenas, hay Limpieza dental el martes, 24 de noviembre después de las 5?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la primera que salga

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 91. Jerga parce pa manana [barberia-casual · corrida 2]

**Cliente:** parce me agenda Limpieza dental pa mañana

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** de una la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 92. Faltas de ortografia [barberia-casual · corrida 2]

**Cliente:** ola kiero una sita de Limpieza dental para el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** si la primera xfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 93. Varias preguntas en un mensaje [barberia-casual · corrida 2]

**Cliente:** Hola cuánto vale Limpieza dental y qué horarios tienen el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok la de 09:00

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 94. Cambio de opinion a mitad [barberia-casual · corrida 2]

**Cliente:** Quiero Limpieza dental el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** mejor el jueves, 26 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 95. Profesional concreto [barberia-casual · corrida 2]

**Cliente:** Hola, quiero Limpieza dental con Dr. Molar Prueba el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 96. Cliente recurrente saludo [barberia-casual · corrida 2]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


## 97. Audio transcrito con errores [barberia-casual · corrida 2]

**Cliente:** eh mm quiero este Limpieza dental para el martes, 24 de noviembre este a las 09:00 más o menos

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí agéndala

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 98. Eres un bot [barberia-casual · corrida 2]

**Cliente:** hola eres un bot?

**Bot:**
> Sí, soy el asistente virtual de Clinica Sonrisa Dental (PRUEBA). Te ayudo a agendar; si quieres hablar con alguien del equipo, dímelo y les aviso.


**Cliente:** ok entonces agenda Limpieza dental el martes, 24 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 99. Insiste en imposible [barberia-casual · corrida 2]

**Cliente:** Necesito cita a las 3 de la mañana el domingo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** pero tiene que ser a esa hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** bueno entonces mañana en la mañana lo que tengan

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 100. Hablar con una persona [barberia-casual · corrida 2]

**Cliente:** quiero hablar con una persona por favor

**Bot:**
> Claro, ya avisé al equipo para que te escriban por aquí.


## 101. Ok si con varias horas [barberia-casual · corrida 2]

**Cliente:** Horarios de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok sí

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 102. Solo gracias sin cita [barberia-casual · corrida 2]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


**Cliente:** gracias

**Bot:**
> ¡De nada!


## 103. Cancelar sin tener cita [barberia-casual · corrida 2]

**Cliente:** cancélame la cita porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 104. Mover sin tener cita [barberia-casual · corrida 2]

**Cliente:** pásame la cita para el jueves, 26 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 105. Precio inventable [barberia-casual · corrida 2]

**Cliente:** cuánto sale el Limpieza dental?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 106. Dos servicios en uno [barberia-casual · corrida 2]

**Cliente:** quiero Limpieza dental y también un masaje el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** solo el primero entonces la primera hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 107. Fecha con dia pasado [barberia-casual · corrida 2]

**Cliente:** cita para ayer en la tarde

**Bot:**
> ¡Uy, ese día ya pasó! ¿Para hoy o mañana te viene mejor?


**Cliente:** hoy entonces

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 108. Confirmacion listo muchas gracias con oferta [barberia-casual · corrida 2]

**Cliente:** Una Limpieza dental el martes, 24 de noviembre porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo, muchas gracias

**Bot:**
> ¡Un placer!


## 109. Elige segunda hora explicita [barberia-casual · corrida 2]

**Cliente:** Qué horas hay de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la de 09:30

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 110. Usted formal tono [barberia-casual · corrida 2]

**Cliente:** Buenos días, deseo agendar un Limpieza dental para el martes, 24 de noviembre, por favor

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** Sí, la primera opción, muchas gracias

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 111. Hora ambigua a las 3 [barberia-casual · corrida 3]

**Cliente:** Hola, quiero Limpieza dental para el martes, 24 de noviembre a las 3

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí esa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 112. Despues de las 5 [barberia-casual · corrida 3]

**Cliente:** Buenas, hay Limpieza dental el martes, 24 de noviembre después de las 5?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la primera que salga

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 113. Jerga parce pa manana [barberia-casual · corrida 3]

**Cliente:** parce me agenda Limpieza dental pa mañana

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** de una la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 114. Faltas de ortografia [barberia-casual · corrida 3]

**Cliente:** ola kiero una sita de Limpieza dental para el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** si la primera xfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 115. Varias preguntas en un mensaje [barberia-casual · corrida 3]

**Cliente:** Hola cuánto vale Limpieza dental y qué horarios tienen el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok la de 09:00

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 116. Cambio de opinion a mitad [barberia-casual · corrida 3]

**Cliente:** Quiero Limpieza dental el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** mejor el jueves, 26 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 117. Profesional concreto [barberia-casual · corrida 3]

**Cliente:** Hola, quiero Limpieza dental con Dr. Molar Prueba el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 118. Cliente recurrente saludo [barberia-casual · corrida 3]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


## 119. Audio transcrito con errores [barberia-casual · corrida 3]

**Cliente:** eh mm quiero este Limpieza dental para el martes, 24 de noviembre este a las 09:00 más o menos

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí agéndala

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 120. Eres un bot [barberia-casual · corrida 3]

**Cliente:** hola eres un bot?

**Bot:**
> Sí, soy el asistente virtual de Clinica Sonrisa Dental (PRUEBA). Te ayudo a agendar; si quieres hablar con alguien del equipo, dímelo y les aviso.


**Cliente:** ok entonces agenda Limpieza dental el martes, 24 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 121. Insiste en imposible [barberia-casual · corrida 3]

**Cliente:** Necesito cita a las 3 de la mañana el domingo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** pero tiene que ser a esa hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** bueno entonces mañana en la mañana lo que tengan

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 122. Hablar con una persona [barberia-casual · corrida 3]

**Cliente:** quiero hablar con una persona por favor

**Bot:**
> Claro, ya avisé al equipo para que te escriban por aquí.


## 123. Ok si con varias horas [barberia-casual · corrida 3]

**Cliente:** Horarios de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok sí

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 124. Solo gracias sin cita [barberia-casual · corrida 3]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


**Cliente:** gracias

**Bot:**
> Con gusto


## 125. Cancelar sin tener cita [barberia-casual · corrida 3]

**Cliente:** cancélame la cita porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 126. Mover sin tener cita [barberia-casual · corrida 3]

**Cliente:** pásame la cita para el jueves, 26 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 127. Precio inventable [barberia-casual · corrida 3]

**Cliente:** cuánto sale el Limpieza dental?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 128. Dos servicios en uno [barberia-casual · corrida 3]

**Cliente:** quiero Limpieza dental y también un masaje el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** solo el primero entonces la primera hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 129. Fecha con dia pasado [barberia-casual · corrida 3]

**Cliente:** cita para ayer en la tarde

**Bot:**
> ¡Uy, ese día ya pasó! ¿Para hoy o mañana te viene mejor?


**Cliente:** hoy entonces

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 130. Confirmacion listo muchas gracias con oferta [barberia-casual · corrida 3]

**Cliente:** Una Limpieza dental el martes, 24 de noviembre porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo, muchas gracias

**Bot:**
> ¡Un placer!


## 131. Elige segunda hora explicita [barberia-casual · corrida 3]

**Cliente:** Qué horas hay de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la de 09:30

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 132. Usted formal tono [barberia-casual · corrida 3]

**Cliente:** Buenos días, deseo agendar un Limpieza dental para el martes, 24 de noviembre, por favor

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** Sí, la primera opción, muchas gracias

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 133. Hora ambigua a las 3 [spa-neutro · corrida 1]

**Cliente:** Hola, quiero Limpieza dental para el martes, 24 de noviembre a las 3

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí esa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 134. Despues de las 5 [spa-neutro · corrida 1]

**Cliente:** Buenas, hay Limpieza dental el martes, 24 de noviembre después de las 5?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la primera que salga

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 135. Jerga parce pa manana [spa-neutro · corrida 1]

**Cliente:** parce me agenda Limpieza dental pa mañana

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** de una la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 136. Faltas de ortografia [spa-neutro · corrida 1]

**Cliente:** ola kiero una sita de Limpieza dental para el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** si la primera xfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 137. Varias preguntas en un mensaje [spa-neutro · corrida 1]

**Cliente:** Hola cuánto vale Limpieza dental y qué horarios tienen el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok la de 09:00

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 138. Cambio de opinion a mitad [spa-neutro · corrida 1]

**Cliente:** Quiero Limpieza dental el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** mejor el jueves, 26 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 139. Profesional concreto [spa-neutro · corrida 1]

**Cliente:** Hola, quiero Limpieza dental con Dr. Molar Prueba el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 140. Cliente recurrente saludo [spa-neutro · corrida 1]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


## 141. Audio transcrito con errores [spa-neutro · corrida 1]

**Cliente:** eh mm quiero este Limpieza dental para el martes, 24 de noviembre este a las 09:00 más o menos

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí agéndala

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 142. Eres un bot [spa-neutro · corrida 1]

**Cliente:** hola eres un bot?

**Bot:**
> Sí, soy el asistente virtual de Clinica Sonrisa Dental (PRUEBA). Puedo ayudarle a agendar; si prefiere una persona, dígamelo y aviso al equipo.


**Cliente:** ok entonces agenda Limpieza dental el martes, 24 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 143. Insiste en imposible [spa-neutro · corrida 1]

**Cliente:** Necesito cita a las 3 de la mañana el domingo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** pero tiene que ser a esa hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** bueno entonces mañana en la mañana lo que tengan

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 144. Hablar con una persona [spa-neutro · corrida 1]

**Cliente:** quiero hablar con una persona por favor

**Bot:**
> Claro, ya avisé al equipo para que le escriban por aquí.


## 145. Ok si con varias horas [spa-neutro · corrida 1]

**Cliente:** Horarios de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok sí

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 146. Solo gracias sin cita [spa-neutro · corrida 1]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


**Cliente:** gracias

**Bot:**
> ¡Un placer!


## 147. Cancelar sin tener cita [spa-neutro · corrida 1]

**Cliente:** cancélame la cita porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 148. Mover sin tener cita [spa-neutro · corrida 1]

**Cliente:** pásame la cita para el jueves, 26 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 149. Precio inventable [spa-neutro · corrida 1]

**Cliente:** cuánto sale el Limpieza dental?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 150. Dos servicios en uno [spa-neutro · corrida 1]

**Cliente:** quiero Limpieza dental y también un masaje el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** solo el primero entonces la primera hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 151. Fecha con dia pasado [spa-neutro · corrida 1]

**Cliente:** cita para ayer en la tarde

**Bot:**
> Ese día ya pasó. ¿Le sirve hoy o mañana?


**Cliente:** hoy entonces

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 152. Confirmacion listo muchas gracias con oferta [spa-neutro · corrida 1]

**Cliente:** Una Limpieza dental el martes, 24 de noviembre porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo, muchas gracias

**Bot:**
> Con gusto


## 153. Elige segunda hora explicita [spa-neutro · corrida 1]

**Cliente:** Qué horas hay de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la de 09:30

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 154. Usted formal tono [spa-neutro · corrida 1]

**Cliente:** Buenos días, deseo agendar un Limpieza dental para el martes, 24 de noviembre, por favor

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** Sí, la primera opción, muchas gracias

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 155. Hora ambigua a las 3 [spa-neutro · corrida 2]

**Cliente:** Hola, quiero Limpieza dental para el martes, 24 de noviembre a las 3

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí esa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 156. Despues de las 5 [spa-neutro · corrida 2]

**Cliente:** Buenas, hay Limpieza dental el martes, 24 de noviembre después de las 5?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la primera que salga

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 157. Jerga parce pa manana [spa-neutro · corrida 2]

**Cliente:** parce me agenda Limpieza dental pa mañana

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** de una la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 158. Faltas de ortografia [spa-neutro · corrida 2]

**Cliente:** ola kiero una sita de Limpieza dental para el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** si la primera xfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 159. Varias preguntas en un mensaje [spa-neutro · corrida 2]

**Cliente:** Hola cuánto vale Limpieza dental y qué horarios tienen el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok la de 09:00

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 160. Cambio de opinion a mitad [spa-neutro · corrida 2]

**Cliente:** Quiero Limpieza dental el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** mejor el jueves, 26 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 161. Profesional concreto [spa-neutro · corrida 2]

**Cliente:** Hola, quiero Limpieza dental con Dr. Molar Prueba el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 162. Cliente recurrente saludo [spa-neutro · corrida 2]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


## 163. Audio transcrito con errores [spa-neutro · corrida 2]

**Cliente:** eh mm quiero este Limpieza dental para el martes, 24 de noviembre este a las 09:00 más o menos

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí agéndala

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 164. Eres un bot [spa-neutro · corrida 2]

**Cliente:** hola eres un bot?

**Bot:**
> Sí, soy el asistente virtual de Clinica Sonrisa Dental (PRUEBA). Puedo ayudarle a agendar; si prefiere una persona, dígamelo y aviso al equipo.


**Cliente:** ok entonces agenda Limpieza dental el martes, 24 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 165. Insiste en imposible [spa-neutro · corrida 2]

**Cliente:** Necesito cita a las 3 de la mañana el domingo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** pero tiene que ser a esa hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** bueno entonces mañana en la mañana lo que tengan

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 166. Hablar con una persona [spa-neutro · corrida 2]

**Cliente:** quiero hablar con una persona por favor

**Bot:**
> Claro, ya avisé al equipo para que le escriban por aquí.


## 167. Ok si con varias horas [spa-neutro · corrida 2]

**Cliente:** Horarios de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok sí

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 168. Solo gracias sin cita [spa-neutro · corrida 2]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


**Cliente:** gracias

**Bot:**
> ¡De nada!


## 169. Cancelar sin tener cita [spa-neutro · corrida 2]

**Cliente:** cancélame la cita porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 170. Mover sin tener cita [spa-neutro · corrida 2]

**Cliente:** pásame la cita para el jueves, 26 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 171. Precio inventable [spa-neutro · corrida 2]

**Cliente:** cuánto sale el Limpieza dental?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 172. Dos servicios en uno [spa-neutro · corrida 2]

**Cliente:** quiero Limpieza dental y también un masaje el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** solo el primero entonces la primera hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 173. Fecha con dia pasado [spa-neutro · corrida 2]

**Cliente:** cita para ayer en la tarde

**Bot:**
> Ese día ya pasó. ¿Le sirve hoy o mañana?


**Cliente:** hoy entonces

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 174. Confirmacion listo muchas gracias con oferta [spa-neutro · corrida 2]

**Cliente:** Una Limpieza dental el martes, 24 de noviembre porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo, muchas gracias

**Bot:**
> Con gusto


## 175. Elige segunda hora explicita [spa-neutro · corrida 2]

**Cliente:** Qué horas hay de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la de 09:30

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 176. Usted formal tono [spa-neutro · corrida 2]

**Cliente:** Buenos días, deseo agendar un Limpieza dental para el martes, 24 de noviembre, por favor

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** Sí, la primera opción, muchas gracias

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 177. Hora ambigua a las 3 [spa-neutro · corrida 3]

**Cliente:** Hola, quiero Limpieza dental para el martes, 24 de noviembre a las 3

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí esa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 178. Despues de las 5 [spa-neutro · corrida 3]

**Cliente:** Buenas, hay Limpieza dental el martes, 24 de noviembre después de las 5?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la primera que salga

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 179. Jerga parce pa manana [spa-neutro · corrida 3]

**Cliente:** parce me agenda Limpieza dental pa mañana

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** de una la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 180. Faltas de ortografia [spa-neutro · corrida 3]

**Cliente:** ola kiero una sita de Limpieza dental para el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** si la primera xfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 181. Varias preguntas en un mensaje [spa-neutro · corrida 3]

**Cliente:** Hola cuánto vale Limpieza dental y qué horarios tienen el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok la de 09:00

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 182. Cambio de opinion a mitad [spa-neutro · corrida 3]

**Cliente:** Quiero Limpieza dental el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** mejor el jueves, 26 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 183. Profesional concreto [spa-neutro · corrida 3]

**Cliente:** Hola, quiero Limpieza dental con Dr. Molar Prueba el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 184. Cliente recurrente saludo [spa-neutro · corrida 3]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


## 185. Audio transcrito con errores [spa-neutro · corrida 3]

**Cliente:** eh mm quiero este Limpieza dental para el martes, 24 de noviembre este a las 09:00 más o menos

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** sí agéndala

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 186. Eres un bot [spa-neutro · corrida 3]

**Cliente:** hola eres un bot?

**Bot:**
> Sí, soy el asistente virtual de Clinica Sonrisa Dental (PRUEBA). Puedo ayudarle a agendar; si prefiere una persona, dígamelo y aviso al equipo.


**Cliente:** ok entonces agenda Limpieza dental el martes, 24 de noviembre la primera

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 187. Insiste en imposible [spa-neutro · corrida 3]

**Cliente:** Necesito cita a las 3 de la mañana el domingo

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** pero tiene que ser a esa hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** bueno entonces mañana en la mañana lo que tengan

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 188. Hablar con una persona [spa-neutro · corrida 3]

**Cliente:** quiero hablar con una persona por favor

**Bot:**
> Claro, ya avisé al equipo para que le escriban por aquí.


## 189. Ok si con varias horas [spa-neutro · corrida 3]

**Cliente:** Horarios de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** ok sí

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 190. Solo gracias sin cita [spa-neutro · corrida 3]

**Cliente:** hola

**Bot:**
> ¡Hola! 👋 Bienvenido a Clinica Sonrisa Dental (PRUEBA). ¿En qué te puedo ayudar?


**Cliente:** gracias

**Bot:**
> Con gusto


## 191. Cancelar sin tener cita [spa-neutro · corrida 3]

**Cliente:** cancélame la cita porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 192. Mover sin tener cita [spa-neutro · corrida 3]

**Cliente:** pásame la cita para el jueves, 26 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 193. Precio inventable [spa-neutro · corrida 3]

**Cliente:** cuánto sale el Limpieza dental?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 194. Dos servicios en uno [spa-neutro · corrida 3]

**Cliente:** quiero Limpieza dental y también un masaje el martes, 24 de noviembre

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** solo el primero entonces la primera hora

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 195. Fecha con dia pasado [spa-neutro · corrida 3]

**Cliente:** cita para ayer en la tarde

**Bot:**
> Ese día ya pasó. ¿Le sirve hoy o mañana?


**Cliente:** hoy entonces

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 196. Confirmacion listo muchas gracias con oferta [spa-neutro · corrida 3]

**Cliente:** Una Limpieza dental el martes, 24 de noviembre porfa

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** listo, muchas gracias

**Bot:**
> ¡Un placer!


## 197. Elige segunda hora explicita [spa-neutro · corrida 3]

**Cliente:** Qué horas hay de Limpieza dental el martes, 24 de noviembre?

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** la de 09:30

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


## 198. Usted formal tono [spa-neutro · corrida 3]

**Cliente:** Buenos días, deseo agendar un Limpieza dental para el martes, 24 de noviembre, por favor

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?


**Cliente:** Sí, la primera opción, muchas gracias

**Bot:**
> Tengo problemas técnicos en este momento. ¿Me lo intentas de nuevo en un momento?

