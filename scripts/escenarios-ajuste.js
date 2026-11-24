// Set de AJUSTE: los 6 guiones. No memorizar reconocedores a estos textos.

function escenariosAjuste({ servicio, fecha1, fecha2, hora1, hora2 }) {
    return [
        {
            nombre: 'Cliente agenda por primera vez',
            tags: ['agendar', 'despedida', 'espera_cita'],
            pasos: [
                `Buenas, soy Laura, quería pedir una cita de ${servicio} para el ${fecha1}, ¿me puede ayudar?`,
                'Sí, la primera que tenga me sirve, gracias',
                'Perfecto, gracias. Hasta luego'
            ]
        },
        {
            nombre: 'Cliente pregunta precio y elige hora concreta',
            tags: ['precio', 'hora_concreta', 'espera_cita'],
            pasos: [
                `Hola, soy Marcela. ¿Me puede decir cuánto cuesta una ${servicio}?`,
                `¿Para el ${fecha1} qué horarios tienen?`,
                `¿Tiene a las ${hora1}?`,
                'Sí, agéndemela por favor',
                'Listo, muchas gracias'
            ]
        },
        {
            nombre: 'Cliente confuso que no da detalles',
            tags: ['vago', 'pronto', 'espera_cita'],
            pasos: [
                'hola?',
                'necesito una cita lo más pronto posible',
                'la primera'
            ]
        },
        {
            nombre: 'Cliente pide un servicio que no existe',
            tags: ['servicio_inexistente', 'espera_cita'],
            pasos: [
                'Hola, ¿hacen blanqueamiento con láser?',
                `Ah ok, entonces mejor una ${servicio} para el ${fecha1}, lo que tengan`,
                'la primera'
            ]
        },
        {
            nombre: 'Cliente pide fecha pasada y luego cancela',
            tags: ['fecha_pasada', 'cancelar', 'espera_cita'],
            pasos: [
                'Buenas, soy Jorge. Necesito una cita para el día de ayer',
                'Sí, la más cercana que tenga',
                'la primera',
                'Espere... se me complicó. ¿Me la puede cancelar?',
                'Gracias, quedo pendiente'
            ]
        },
        {
            nombre: 'Cliente que reprograma su cita',
            tags: ['reprogramar', 'espera_cita'],
            pasos: [
                `Hola, soy Camila, ¿me puede dar una cita de ${servicio} para el ${fecha1}?`,
                'Sí, la primera',
                `¿Me la puede cambiar para el ${fecha2}? A las ${hora2} si puede ser`,
                'Listo, muchas gracias'
            ]
        }
    ];
}

module.exports = { escenariosAjuste };
