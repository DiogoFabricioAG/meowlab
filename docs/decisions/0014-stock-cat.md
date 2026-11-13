# 0014. Stock Cat: que no se acabe nada

- Estado: aceptado (2026-11-13), respuestas del operador al cuestionario de Stock Cat
- Responsable: MeowLab
- Relacionado: ADR-0008 (plataforma por módulos), ADR-0011 (Sales Cat; este ADR reemplaza su
  punto 12), ADR-0007 (cobros; venta por empresa), FacturaYa (comprobantes emitidos)

## Contexto

Las MYPE llevan el inventario en un cuaderno o en Excel, si lo llevan. Lo que más les duele
es quedarse sin algo que venden o que necesitan para producir. Stock Cat vive en el mismo chat
de Manolo que los demás agentes. Su trabajo principal es avisar antes de que algo se acabe.

## Decisión

1. **Le habla el equipo** (2–3 personas). Los costos, el valor del inventario y los ajustes
   de reglas solo los ve y cambia la titular.
2. **Lo principal son las alertas**, para que nada se acabe. Saber cuánto hay y cuánto vale es
   el soporte de eso.
3. **Maneja productos terminados e insumos** (materia prima de imprenta, taller). Cualquier
   cosa que se cuente puede ser un ítem.
4. **El stock baja con los comprobantes de Invoice Cat.** Cada factura o boleta aceptada por
   SUNAT descuenta sus productos, y cada nota de crédito los devuelve. Cada comprobante se cuenta
   una sola vez. Si la empresa solo tiene Stock Cat, las salidas se le dicen al gato («salieron
   5 polos»).
5. **Las entradas** se registran por chat («me llegaron 50 polos») o mandando la **foto de la
   factura del proveedor**. El gato la lee y pide confirmar antes de guardar.
6. **Cada entrada guarda su costo**, para conocer la ganancia y el valor del inventario. El
   valor se calcula con costo promedio ponderado.
7. **Sin ajustes con motivo:** las correcciones se hacen por chat («ajusta los polos a 40») y
   quedan registradas con quién y cuándo, sin clasificar mermas.
8. **Catálogo:** los productos que se venden usan el mismo catálogo que Sales Cat
   (`commerce.products`). Los insumos van en un catálogo propio de Stock Cat. Un ítem puede ser
   de cualquier tipo.
9. **Variantes como productos separados** («Polo blanco M», «Polo blanco L»).
10. **Solo unidades** por ahora, sin kg, metros ni conversión de cajas.
11. **Un solo almacén** por empresa.
12. **Carga inicial por chat, Excel o imagen.** Excel e imagen son clave: el producto existe para
    digitalizar el negocio. El gato interpreta el archivo o la foto (lista, cuaderno, factura),
    muestra lo que entendió y pide confirmar.
13. **El stock mínimo lo pone la titular**, por producto.
14. **Avisa al momento** en que un producto baja de su mínimo, en el mismo chat.
15. **Solo avisa:** pedir al proveedor será trabajo de Reorder Cat.
16. **Responde:** cuánto queda de X; qué se está acabando; qué no se vende; cuánto vale el
    inventario; qué entró y salió en un periodo.
17. **Vender sin stock lo decide la titular**, como ajuste de la empresa: permitir quedar en
    negativo y avisar, o no permitirlo. Reemplaza el punto 12 de ADR-0011, que fijaba «sin stock
    no se vende». Como el stock baja con comprobantes ya aceptados por SUNAT, «no permitir» no
    anula la venta: el gato avisa y marca el producto para un conteo.
18. **Conteo físico por chat**, producto por producto. El conteo deja el stock en lo contado y
    registra la diferencia.
19. **En el portal:** su sección en «Tus agentes» con la tabla de stock, las alertas y los
    movimientos (entradas, salidas, ajustes, conteos). En «Inicio», su línea del día.
20. **Precio:** S/ 29 al mes. Se vende por empresa igual que Sales Cat (ADR-0007, nota del
    13/11/2026). Piloto: CREACIONES J&D, como cortesía.

## Consecuencias

- **FacturaYa debe exponer los productos de cada comprobante emitido** (descripción, cantidad,
  código si lo hay). Hoy su listado no los trae. El bridge los lee con la credencial de la
  empresa y guarda qué comprobantes ya procesó, para no descontarlos dos veces.
- **Conectar un comprobante con un producto** se hace por nombre (sin distinguir mayúsculas,
  como en Sales Cat). Lo que no coincide queda como «sin asociar» para que el gato pregunte una
  vez y recuerde el alias.
- **Lectura de Excel e imágenes en el bridge:** el Excel se lee con una librería y las imágenes
  con el modelo multimodal ya usado por Manolo. Nada se guarda sin confirmación.
- **Los movimientos son la fuente de verdad:** el stock es la suma de entradas, salidas,
  ajustes y conteos. Así se puede explicar cualquier número.
- **Un número solo con Stock Cat** funciona sin Invoice Cat ni Sales Cat.

## Fases

1. **Núcleo por chat:**
   - catálogo e insumos;
   - entradas con costo, salidas manuales, ajustes y conteo;
   - mínimos y alerta inmediata;
   - las cinco consultas;
   - regla de negativos;
   - descuento por comprobantes de Invoice Cat;
   - sección en el portal con stock, alertas y movimientos.
2. **Digitalizar:** carga desde Excel e imagen (lista o cuaderno) y entradas desde la foto de la
   factura del proveedor.
3. **A la venta:** Stock Cat en el Plan a S/ 29, por empresa, con la misma activación que
   Sales Cat.

## Preguntas abiertas

- **Ventas de Sales Cat sin comprobante:** si se emite factura o boleta, el comprobante ya
  descuenta. Una venta registrada sin comprobante no descuenta en la fase 1. Se decidirá si debe
  descontar, cuidando no contar dos veces la que luego se factura.
- Comprobantes emitidos desde la web de FacturaYa, sin pasar por Manolo, también descuentan,
  porque se leen de FacturaYa y no del chat.
