# 0012. Formato de los documentos: kit de marca y plantillas

- Estado: aceptado (2026-11-13), niveles 1 y 2 elegidos por el operador
- Responsable: MeowLab
- Relacionado: ADR-0010 (empresas), ADR-0011 (Sales Cat), formato de facturas y boletas
  de FacturaYa (`app/Services/InvoicePdfService.php`), PDF de la GRE en Manolo

## Contexto

Las MYPE quieren que sus documentos se vean como su negocio. Hoy:

- **Factura y boleta:** FacturaYa dibuja el PDF a mano (`InvoicePdfService`, Helvetica y
  colores fijos, sin logo de la empresa).
- **GRE:** Manolo arma el PDF desde HTML con Browser Run.
- **Cotización:** Sales Cat la muestra en `app.meowlab.tech/cotizacion/<código>` (HTML,
  imprimible); el rol de cotizaciones antiguo genera un PDF desde HTML.

Factura, boleta y GRE son la **representación impresa** de un comprobante electrónico: el
documento legal es el XML aceptado por SUNAT, y la impresión debe mostrar sus datos
obligatorios (RUC y razón social del emisor, tipo, serie y número, fecha, datos del
adquirente, detalle, IGV, total, monto en letras, código QR, valor resumen o hash y la
leyenda de representación impresa). La forma puede cambiar; esos datos no.

## Decisión

1. **Nivel 1, kit de marca por empresa.** Se configura una vez y se aplica a todos los
   documentos de la empresa:
   - logo (PNG o JPG, recortado y reducido al subirlo);
   - color principal (se valida contraste mínimo con el texto);
   - datos de contacto: dirección comercial, teléfono, correo y web;
   - formas de pago para mostrar: cuentas bancarias, CCI, Yape y Plin;
   - texto de pie libre y corto;
   - para cotizaciones: validez por defecto, condiciones de pago y plazo de entrega.
2. **Nivel 2, plantillas cerradas.** Cada tipo de documento ofrece unas pocas plantillas
   diseñadas por MeowLab que cumplen SUNAT por construcción: «Clásica», «Moderna» y, para
   boletas, «Ticket 80 mm». La empresa elige una por tipo; el kit de marca las rellena.
3. **Sin editor libre por ahora (nivel 3).** Mover o quitar campos queda fuera: el riesgo de
   un comprobante observable es alto. Se reconsidera más adelante sólo para cotizaciones.
4. **Los datos obligatorios no son configurables.** Ninguna opción del kit ni de la plantilla
   oculta, mueve fuera de la página o reduce bajo un tamaño legible los campos exigidos.
5. **Dónde se edita:**
   - en el portal, «Configuración → Documentos», con vista previa en vivo de cada tipo con
     datos de ejemplo de la empresa; sólo quien administra la empresa lo cambia;
   - por el chat de Manolo para lo simple («pon este logo en mis documentos», «agrega mi
     Yape al pie»), con confirmación antes de guardar.
6. **Dónde vive:** en la plataforma, por empresa (ADR-0008, módulo `commerce`): el kit y la
   plantilla elegida por tipo; el logo en almacenamiento propio de MeowLab. FacturaYa recibe
   el kit al emitir y lo usa para dibujar; Manolo lo usa para la GRE y el portal para la
   cotización. Un cambio afecta a los documentos nuevos; los ya emitidos no se regeneran.

## Consecuencias

- FacturaYa tiene que aprender a dibujar una imagen (el logo) y a recibir colores y textos,
  y a tener varias plantillas en lugar de una.
- La GRE y la cotización se unifican sobre el mismo kit, lo que las acerca visualmente a la
  factura.
- Hace falta validar el logo (tipo, tamaño, que no tenga fondo enorme) y el contraste del
  color elegido.

## Fases

1. **Kit de marca:** datos y logo por empresa, editor en el portal con vista previa, y su uso
   en la cotización pública de Sales Cat.
2. **Kit en facturas y boletas:** FacturaYa recibe y dibuja logo, color, contacto, formas de
   pago y pie.
3. **Kit en la GRE** y en el PDF de cotizaciones.
4. **Plantillas:** «Clásica», «Moderna» y «Ticket 80 mm», con selector por tipo y vista previa.
5. **Por chat:** cambiar logo, formas de pago y pie desde Manolo.

## Notas

- 2026-11-13, fase 1 implementada (sin desplegar). El kit vive en `commerce.brand_kits` y el
  logo en `commerce.brand_logos` (migración 015), dentro de PostgreSQL para que viaje con
  sus respaldos. Validez, condiciones de pago y plazo de entrega se **copian** a cada
  cotización al crearla; logo, color, contacto y formas de pago se muestran con los valores
  vigentes de la empresa. El logo de una cotización pública solo se sirve a través de su
  enlace (`/api/public/quotes/<código>/logo`), no por identificador de empresa.
