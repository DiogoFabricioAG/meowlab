# 0016. Reorder Cat: que nada se acabe sin que la titular tenga que perseguir proveedores

- Estado: aceptado (2026-11-15), respuestas del operador al cuestionario de Reorder Cat
- Responsable: MeowLab
- Relacionado: ADR-0007 (Reorder Cat es vendible, S/ 25), ADR-0008 (módulo `purchasing`, los
  agentes preparan y una persona confirma, órdenes de producción sin recetas), ADR-0013 (plantilla
  única de documentos), ADR-0014 (Stock Cat: mínimos y alertas; «pedir al proveedor será trabajo de
  Reorder Cat»), ADR-0015 (Collections Cat, mismo patrón de activación)

## Contexto

Stock Cat avisa cuando un producto baja de su mínimo, pero alguien todavía tiene que escribirle al
proveedor, insistir si no contesta, anotar el precio y la fecha y revisar que llegue lo pedido.
Reorder Cat hace ese trabajo. La titular decide qué y cuánto se pide; el gato hace el resto y solo
la busca cuando no logra cerrar con un proveedor.

## Decisión

1. **Actúa cuando un producto baja de su mínimo** (el mínimo de Stock Cat, ADR-0014).
2. **Cada producto se compra o se produce**, según lo diga la titular. Por omisión se compra.
3. **Los proveedores salen de dos lados:** de las facturas de compra que se registran en Stock Cat
   con foto (nombre y RUC del emisor) y del chat («los polos me los vende Textiles Lima,
   987654321»). La carga por Excel queda para después.
4. **Un proveedor preferido por producto.**
5. **Pide hasta llenar un máximo** que la titular pone por producto. Si un producto no tiene
   máximo, el gato lo pregunta antes de proponer.
6. **Siempre aprueba la titular.** El gato propone; nada se pide sin su aprobación.
7. **Escribe al proveedor desde el número de MeowLab** con la plantilla
   `pedido_reposicion_proveedor`, a nombre de la empresa. Las respuestas del proveedor llegan a ese
   número y el gato sabe de qué empresa y de qué pedido son.
8. **Hace el pedido directo** (no pide cotización antes).
9. **Lee la respuesta del proveedor** (si acepta, precio y fecha de entrega) y se la resume a la
   titular.
10. **Si el proveedor no responde,** el gato insiste una vez a las 24 horas y, si a las 48 sigue sin
    respuesta, se lo pasa a la titular (punto 21).
11. **Orden de compra en PDF** con la plantilla única de documentos (ADR-0013), numerada `OC-` por
    empresa. Los productos sin precio conocido van «por confirmar».
12. **La recepción se registra en Stock Cat** («me llegaron 50 polos»). El gato la compara con lo
    pedido: avisa si completa el pedido o cuánto falta (entregas parciales).
13. **No lleva cuentas por pagar.** Lo que la empresa debe a sus proveedores queda fuera.
14. **Los productos propios se producen:** al aprobar se crea una orden de producción. Cuando el
    equipo avisa que están listos, entran al stock y la orden se cierra. Sin recetas ni descuento de
    insumos (ADR-0008).
15. **Presupuesto mensual de compras** que pone la titular. Si aprobar un pedido lo pasa, el gato
    pregunta antes («¿lo apruebo igual?»).
16. **Consultas:** qué está pedido y por llegar, y cuánto se compró este mes y a quién.
17. **Avisa en el mismo aviso de Stock Cat:** «Se acaban los polos… ¿Pido la reposición?».
18. **En el portal:** sección con los pedidos por aprobar y en curso, los proveedores y las compras
    del mes, y una línea en Inicio.
19. **CREACIONES J&D lo recibe como cortesía**, igual que los demás gatos.
20. **Precio:** S/ 25 al mes, por empresa como Sales Cat.
21. **Escala a la titular solo lo que no puede cerrar:** el proveedor rechaza el pedido o no responde
    después de la insistencia. Todo lo demás (enviar, insistir, anotar precio y fecha, recibir) lo
    hace solo.

## Fases

**Fase 1 (esta entrega).**

- Esquema `purchasing` en PostgreSQL: reglas por producto (compra o producción, máximo, proveedor),
  proveedores, pedidos con sus líneas (compra y producción), avisos a la titular y auditoría.
- Rol `/reorder` (también `/reposicion` y `/pedidos`) y botón «Pedir reposición» en las alertas de
  Stock Cat.
- Envío de la plantilla al proveedor, lectura de su respuesta, insistencia a las 24 horas y escalado
  a las 48 con el cron del Worker (cada 15 minutos, de 8:00 a 20:00 de Lima).
- PDF de la orden de compra por FacturaYa (`POST /api/internal/purchase-orders/pdf`). Se manda a la
  titular al aprobar y al proveedor en cuanto responde (la plantilla sola no lleva adjunto).
- Recepción y órdenes de producción a través de las entradas de Stock Cat.
- Página `/agentes/reposicion` en el portal y línea semanal en Inicio.

**Fase 2.** Carga de proveedores por Excel; varios proveedores por producto con pedido de precios;
número propio de la empresa (Kapso) para escribir desde ahí.

**Fase 3.** Cuentas por pagar y pago a proveedores; recetas de producción con descuento de insumos.

## Consecuencias

- Los avisos a la titular (respuesta del proveedor, escalado) se intentan enviar en el momento por
  WhatsApp. Si su ventana de 24 horas está cerrada, Meta no deja mandar texto libre: el aviso queda
  guardado y aparece al abrir `/reorder` y en el portal. Una plantilla para avisos a la titular
  queda pendiente.
- El proveedor conversa con el número de MeowLab. Si un mismo teléfono es proveedor de dos empresas
  de MeowLab, la respuesta se asocia al pedido enviado más reciente.
- El precio de un pedido se estima con el último precio del proveedor o el costo promedio de Stock
  Cat; el presupuesto usa esa estimación hasta que el proveedor confirme.
- Collections Cat se mantiene en su fase 1 (recordatorios con botón). El operador decidió el
  2026-11-15 no enviarlos desde el número de MeowLab; el envío automático espera a los números de
  las empresas.
