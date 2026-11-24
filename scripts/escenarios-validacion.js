// Set de VALIDACION: escenarios NUEVOS. No calibrar reconocedores con estos.

function escenariosValidacion(ctx) {
  const { servicio, fecha1, fecha2, hora1, hora2, profesional } = ctx;
  const prof = profesional || 'el profesional';
  return [
    { nombre: 'Hora ambigua a las 3', tags: ['hora_ambigua'], pasos: [`Hola, quiero ${servicio} para el ${fecha1} a las 3`, 'sí esa'] },
    { nombre: 'Despues de las 5', tags: ['hora_ambigua'], pasos: [`Buenas, hay ${servicio} el ${fecha1} después de las 5?`, 'la primera que salga'] },
    { nombre: 'Jerga parce pa manana', tags: ['jerga'], pasos: [`parce me agenda ${servicio} pa mañana`, 'de una la primera'] },
    { nombre: 'Faltas de ortografia', tags: ['ortografia'], pasos: [`ola kiero una sita de ${servicio} para el ${fecha1}`, 'si la primera xfa'] },
    { nombre: 'Varias preguntas en un mensaje', tags: ['multi_pregunta'], pasos: [`Hola cuánto vale ${servicio} y qué horarios tienen el ${fecha1}?`, `ok la de ${hora1}`] },
    { nombre: 'Cambio de opinion a mitad', tags: ['cambio_opinion'], pasos: [`Quiero ${servicio} el ${fecha1}`, `mejor el ${fecha2} la primera`, 'listo'] },
    { nombre: 'Profesional concreto', tags: ['profesional'], pasos: [`Hola, quiero ${servicio} con ${prof} el ${fecha1}`, 'sí la primera'] },
    { nombre: 'Cliente recurrente saludo', tags: ['recurrente'], pasos: ['hola'], setup: 'recurrente' },
    { nombre: 'Audio transcrito con errores', tags: ['audio_ruidoso'], pasos: [`eh mm quiero este ${servicio} para el ${fecha1} este a las ${hora1} más o menos`, 'sí agéndala'] },
    { nombre: 'Eres un bot', tags: ['bot'], pasos: ['hola eres un bot?', `ok entonces agenda ${servicio} el ${fecha1} la primera`] },
    { nombre: 'Insiste en imposible', tags: ['imposible'], pasos: ['Necesito cita a las 3 de la mañana el domingo', 'pero tiene que ser a esa hora', 'bueno entonces mañana en la mañana lo que tengan'] },
    { nombre: 'Hablar con una persona', tags: ['humano'], pasos: ['quiero hablar con una persona por favor'] },
    { nombre: 'Ok si con varias horas', tags: ['ambiguo_multihora'], pasos: [`Horarios de ${servicio} el ${fecha1}?`, 'ok sí'] },
    { nombre: 'Solo gracias sin cita', tags: ['gracias'], pasos: ['hola', 'gracias'] },
    { nombre: 'Cancelar sin tener cita', tags: ['cancelar_vacio'], pasos: ['cancélame la cita porfa'] },
    { nombre: 'Mover sin tener cita', tags: ['mover_vacio'], pasos: [`pásame la cita para el ${fecha2}`] },
    { nombre: 'Precio inventable', tags: ['precio'], pasos: [`cuánto sale el ${servicio}?`] },
    { nombre: 'Dos servicios en uno', tags: ['multi_servicio'], pasos: [`quiero ${servicio} y también un masaje el ${fecha1}`, 'solo el primero entonces la primera hora'] },
    { nombre: 'Fecha con dia pasado', tags: ['fecha_pasada'], pasos: ['cita para ayer en la tarde', 'hoy entonces'] },
    { nombre: 'Confirmacion listo muchas gracias con oferta', tags: ['confirmacion'], pasos: [`Una ${servicio} el ${fecha1} porfa`, 'listo, muchas gracias'] },
    { nombre: 'Elige segunda hora explicita', tags: ['elige_hora'], pasos: [`Qué horas hay de ${servicio} el ${fecha1}?`, hora2 ? `la de ${hora2}` : 'la segunda'] },
    { nombre: 'Usted formal tono', tags: ['formal'], pasos: [`Buenos días, deseo agendar un ${servicio} para el ${fecha1}, por favor`, 'Sí, la primera opción, muchas gracias'] }
  ];
}

module.exports = { escenariosValidacion };
