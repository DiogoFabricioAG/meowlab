# 0017. Support Cat: la postventa 24/7 en el WhatsApp de la empresa

- Estado: aceptado (2026-11-15), respuestas del operador al cuestionario de Support Cat
- Responsable: MeowLab
- Relacionado: ADR-0007 (Support Cat es vendible, S/ 39), ADR-0008 (módulo `support`, clientes
  compartidos en `commerce.customers`), ADR-0009 (Kapso, números de empresa), ADR-0011 y ADR-0013
  (Sales Cat y el PDF de la cotización), ADR-0016 (avisos a la titular y proveedores en el mismo número)

## Contexto

Los clientes de una MYPE escriben por WhatsApp a cualquier hora para preguntar lo de siempre:
horarios, dirección, delivery, el estado de su pedido. Responder se come el tiempo del equipo.
Support Cat atiende esa postventa en el número de la empresa; la venta es de Sales Cat, que comparte
el mismo canal.

## Decisión

1. **Atiende en el número propio de cada empresa.** Cada número pertenece a una sola empresa, así
   que no hay que preguntar de qué negocio es el cliente. Para CREACIONES J&D ese número es el de
   Manolo (`support.settings.phone_number_id`).
2. **Quién es cliente:** quien escribe a ese número sin ser del equipo de ninguna empresa, sin rol
   propio en Manolo y sin ser un proveedor con pedido abierto de Reorder Cat. El equipo sigue
   hablando con Manolo y sus gatos como siempre.
3. **Responde** las preguntas frecuentes que carga la titular y el estado de las cotizaciones y
   ventas del cliente en Sales Cat. Precios, stock y deudas quedan en sus gatos.
4. **Cotiza con Sales Cat:** si el cliente quiere comprar productos del catálogo, arma la
   cotización con esos precios y le manda el PDF. Lo que no está en el catálogo pasa a la titular.
5. **Las preguntas frecuentes se cargan en el portal.**
6. **Lo que no sabe, lo consulta:** le dice al cliente que lo consulta, crea un ticket y le escribe
   a la titular. Lo que ella responda, el gato se lo transmite al cliente.
7. **Lo escalado lo atiende la titular.**
8. **Se avisa en el chat de Manolo** (con el botón «Responder») **y en el portal** (bandeja de
   tickets).
9. **Los reclamos** son tickets de prioridad alta y se avisan al momento.
10. **Responde 24/7.**
11. **Tono cercano, de tú.**
12. **No escribe por su cuenta** a los clientes en esta fase (fase 2, con plantillas).
13. **Entiende fotos, audios y documentos**, con la normalización multimodal del Worker.
14. **Ficha de cliente compartida** con Sales y Collections (`commerce.customers`, por teléfono).
15. **Resumen diario a la titular:** cuántos clientes escribieron, cuántos se resolvieron solos y
    qué quedó pendiente.
16. **Pregunta «¿te ayudé?»** con botones; un «no» pasa a la titular.
17. **El cliente puede pedir una persona** cuando quiera; pasa a la titular.
18. **CREACIONES J&D lo recibe como cortesía.**
19. **Precio:** S/ 39 al mes, por empresa.
20. **En palabras del operador:** ser el soporte 24/7 de la postventa con los clientes; la venta se
    encarga Sales Cat, pero son parecidos en funcionamiento.

## Fases

**Fase 1 (esta entrega).**

- Esquema `support`: reglas por empresa (con su número), preguntas frecuentes, tickets, eventos de
  conversación (para el resumen y la satisfacción) y auditoría.
- El Worker atiende a los clientes en el número de la empresa: responde, cotiza, escala, registra
  reclamos y pregunta «¿te ayudé?». La titular recibe los tickets en el chat de Manolo y responde con
  «Responder»; `/support` (también `/soporte`) le muestra lo pendiente.
- Resumen diario por el cron a las 20:00 de Lima.
- Página `/agentes/soporte` en el portal: preguntas frecuentes (editables por la titular), bandeja de
  tickets y números del día; línea en Inicio. Responder un ticket se hace en el chat, porque el envío
  sale del Worker.

**Fase 2.** Mensajes iniciados por el gato con plantillas (pedido listo, encuestas); responder tickets
desde el portal; asignar tickets a otras personas del equipo; libro de reclamaciones.

**Fase 3.** Aprender respuestas nuevas de lo que contesta el equipo.

## Consecuencias

- En el número de Manolo, mientras pertenezca a CREACIONES J&D, cualquier desconocido es tratado como
  cliente de J&D. La idea de que MeowLab atienda ahí a los negocios que quieren registrarse (tablero,
  `meowlab-mensajes-terceros-20261115`) necesitará otro número o una pregunta inicial.
- Los avisos a la titular salen como texto libre: si no escribió a Manolo en las últimas 24 horas,
  Meta no los entrega y el ticket queda en el portal y en `/support` hasta la plantilla para la
  titular (`reorder-owner-template-20261115`).
- El cliente recibe la respuesta de la titular solo si escribió en las últimas 24 horas; si no, el gato
  se lo dice a la titular para que lo llame.
