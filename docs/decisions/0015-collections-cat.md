# 0015. Collections Cat: que la titular no pierda tiempo cobrando

- Estado: aceptado (2026-11-14), respuestas del operador al cuestionario de Collections Cat
- Responsable: MeowLab
- Relacionado: ADR-0007 (cobros; Collections Cat es vendible y MeowLab su primer cliente),
  ADR-0008 (módulo `receivables`, los agentes preparan y una persona confirma), ADR-0009 (Kapso,
  números de empresa), ADR-0011 (ventas al crédito de Sales Cat), ADR-0014 (Stock Cat, mismo
  patrón de activación)

## Contexto

En una MYPE, cobrar se come el tiempo de la titular: recordar quién debe, cuánto y desde
cuándo, escribirle a cada cliente y revisar capturas de Yape. Collections Cat lleva esas deudas
y las cobra. La titular solo interviene cuando el gato no puede resolver un caso, por ejemplo
cuando un cliente no responde.

## Decisión

1. **Primero cobra lo que los clientes le deben a la empresa.** Cobrar las suscripciones de
   MeowLab con el mismo gato viene después (ADR-0007).
2. **Las deudas salen de tres lugares:**
   - las ventas al crédito de Sales Cat;
   - las facturas a crédito o en cuotas emitidas en FacturaYa;
   - lo que se dice en el chat («Juan me debe 200 de los polos»).

   Una venta al crédito que además tiene factura cuenta una sola vez.
3. **Vencimiento:** el que trae el comprobante (la primera cuota pendiente). Si no trae
   ninguno, se usan los días que fija la titular; mientras no los fije, 30.
4. **El gato le escribe al cliente desde el número de la empresa.** Hasta que la empresa tenga
   su número conectado (Kapso o Meta, ADR-0009), el gato prepara el mensaje y un botón que lo
   abre en WhatsApp con el cliente, y la titular o su equipo lo envía con un toque.
5. **Ritmo:** un recordatorio antes del vencimiento, otro el día que vence y luego uno cada
   cierto tiempo. Por defecto: 2 días antes, el día del vencimiento y cada 7 días después.
6. **El tono se va poniendo más firme** con los días de atraso, en tres niveles: amable,
   firme y último aviso. Nunca amenaza ni cobra intereses.
7. **Formas de pago:** las que la empresa configure:
   - número de Yape o Plin (y su QR);
   - cuenta o CCI;
   - un enlace de pago.

   El mensaje ofrece todas, y si el cliente pide una en particular, le da esa. El enlace de
   pago lo genera la empresa en su proveedor; integrar un proveedor para crear enlaces por
   deuda es de una fase posterior.
8. **Límites de insistencia**, configurables desde el portal o desde el chat con /collections:
   - un máximo de recordatorios por deuda (3 por defecto);
   - un horario (9:00 a 19:00) y sin domingos;
   - no se le vuelve a escribir a un cliente que pidió que no le escriban.
9. **Las capturas** las envía el cliente al número de la empresa. Mientras ese número no
   exista, la titular o su equipo las reenvía a /collections.
10. **Una captura nunca se aplica sola.** El gato lee monto, fecha, número de operación y
    medio, la asocia a la deuda más probable y le escribe a la titular: «Me mandaron esta
    captura, ¿la validas?».
11. **Confirma cualquiera del equipo**, y queda registrado quién y cuándo.
12. **Pagos parciales:** se aceptan y el saldo baja.
13. **Sin intereses ni moras.**
14. **Consultas:**
    - cuánto me deben;
    - quién me debe más, con su antigüedad (al día, 1–30, 31–60 y más de 60 días);
    - qué me pagaron hoy, esta semana o este mes.
15. **No envía resúmenes por su cuenta.** Al abrir /collections dice qué toca hacer hoy.
16. **Las notas de crédito bajan la deuda de su factura solas.**
17. **En el portal**, una página con:
    - lo que le deben a la empresa, por antigüedad;
    - las deudas con los datos de cada cliente;
    - lo cobrado y las capturas por validar;
    - la lista «Intenta hablar con estos clientes».

    Inicio tiene además una línea para Collections Cat.
18. **Escalamiento:** una deuda vencida que agotó sus recordatorios sin recibir pagos, o cuyo
    cliente pidió que no le escriban, pasa a la titular. Aparece en el portal y al abrir el
    chat. El gato no hace nada más con ella hasta que la titular decida.
19. **Piloto:** CREACIONES J&D, la empresa de pruebas, que recibe como cortesía todos los
    agentes disponibles.
20. **Precio:** S/ 25 al mes por empresa, igual que en el ADR-0007, vendido en el Plan como
    Sales Cat cuando salga del piloto.

## Fases

1. **Núcleo**, este ADR. Incluye:
   - el esquema `receivables` (configuración, deudas, pagos, recordatorios);
   - la lectura de deudas desde Sales Cat y FacturaYa;
   - el chat /collections: deudas habladas, consultas, recordatorios preparados con enlace a
     WhatsApp, capturas reenviadas y validación;
   - la página en el portal y su línea en Inicio;
   - la activación de cortesía para CREACIONES J&D.
2. **Número de la empresa:**
   - plantillas de utilidad aprobadas por Meta;
   - recordatorios automáticos dentro del horario;
   - respuestas y capturas del cliente al número de la empresa;
   - el QR de Yape como imagen.
3. **A la venta en el Plan**, por empresa, y MeowLab como primer cliente para cobrar sus
   suscripciones.

## Consecuencias

- Mientras no haya número de empresa, cobrar sigue costando un toque por mensaje. Es la
  principal limitación de la fase 1 frente al punto 20 del cuestionario («que el dueño no
  pierda tiempo»), y por eso el número de la empresa es la fase 2.
- FacturaYa debe exponer el saldo y las cuotas de cada factura a crédito en
  `GET /api/issued-documents`. Es un cambio compatible: Stock Cat ignora los campos nuevos.
- FacturaYa no sabe qué se pagó. Collections Cat es la fuente de verdad de los saldos y
  mantiene al día el saldo de la venta de Sales Cat cuando se paga.
- Para no llenar la lista de deudas viejas ya cobradas, solo se leen las facturas a crédito
  desde la activación. Lo anterior se registra por chat.
- `commerce.customers` gana un teléfono, para escribirle al cliente.

## Proveedores de enlace de pago (respuesta al punto 7)

Para el enlace que la empresa genera hoy:

- **Mercado Pago** es lo más simple para una MYPE. Crea enlaces de pago desde la app, sin
  página web, y el portal ya lo integra para MeowLab. A cambio, sus comisiones son de las más
  altas y su liquidación de las más lentas.
- **Culqi** (del BCP) y **Izipay** ofrecen enlaces de pago y aceptan Yape; con volumen
  negocian mejores tarifas.
- **Niubiz** conviene a negocios con más ventas, porque su tarifa se negocia.

Las comisiones publicadas varían entre fuentes: hay que confirmarlas con cada proveedor antes
de recomendar uno a un cliente.
