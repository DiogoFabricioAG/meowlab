# 0013. Plantilla única de documentos y cotización en PDF

- Estado: aceptado (2026-11-13), decidido por el operador. Reemplaza a ADR-0012.
- Responsable: MeowLab
- Relacionado: ADR-0011 (Sales Cat), ADR-0012 (reemplazado), QR de SUNAT en FacturaYa
  (`docs/representacion-impresa-qr.md` de facturaya-ai)

## Contexto

ADR-0012 proponía un kit de marca por empresa (logo, color, contacto, pagos) y varias
plantillas. Se desplegó la fase 1 (editor en el portal y cotización HTML con la marca),
pero no llegó a usarse: en producción no había ningún kit cargado.

Mientras tanto, un cliente pidió un formato concreto para sus facturas. Es el que FacturaYa
ya dibuja (`InvoicePdfService`), y desde el 13/11/2026 lleva el QR de SUNAT. El operador
decidió quedarse con ese formato como el único.

## Decisión

1. **Una sola plantilla** para todos los documentos: la de la factura de FacturaYa
   (datos del emisor y recuadro con el tipo y el número, secciones en barras grises, detalle,
   condiciones y resumen de importes, monto en letras). No hay kit de marca ni selector de
   plantillas. Si una MYPE pide otro formato, se evalúa como cambio de la plantilla única.
2. **Se retira el kit de marca:** el editor «Configuración → Documentos», sus rutas en el
   portal y el bridge, y sus tablas (migración `016-quote-pdf.sql`; la `015` no se reescribe).
3. **La cotización de Sales Cat es un PDF** con esa plantilla, marcado «NO ES UN COMPROBANTE
   DE PAGO», sin QR ni leyendas de SUNAT:
   - FacturaYa lo dibuja en `POST /api/internal/quotes/pdf` (bearer interno). No guarda nada.
   - El bridge lo pide la primera vez que alguien abre la cotización y lo guarda en
     `sales.quote_files`. Así el cliente recibe siempre el mismo archivo, aunque la
     plantilla cambie después.
   - `app.meowlab.tech/cotizacion/<código>` devuelve el PDF en línea, y el navegador o el
     celular lo abren con su propio visor. Si el enlace no existe, se muestra una página
     simple. No usa caché compartida y se marca `noindex`.
   - Sales Cat manda además el PDF como documento en el chat (operación `quote_pdf`), para
     que la titular lo reenvíe tal cual.

## Blob storage

**Por ahora no.** Los PDF de cotización se guardan en PostgreSQL (`bytea`).

Medido el 13/11/2026:

- una cotización de tres líneas pesa unos 9 KB, y una factura con QR unos 30 KB;
- la base de la plataforma ocupa 20 MB y hay una cotización en producción;
- el VPS tiene 57 GB libres de 96.

Estimación:

| Escenario | Cotizaciones al mes | Crecimiento |
| --- | --- | --- |
| Piloto (1–3 empresas) | ~100 | ~1 MB al mes |
| 50 empresas × 300 cotizaciones | 15 000 | ~150–200 MB al mes, ~2 GB al año |

Con estos volúmenes PostgreSQL basta:

- los archivos viajan con los respaldos de la base;
- no hay credenciales nuevas en el VPS;
- no hay otro servicio que vigilar;
- se leen dentro del mismo límite de confianza que el resto de Sales Cat.

**Cuándo pasar a almacenamiento de objetos** (R2 de Cloudflare, que ya está en el stack para
`ENTERPRISE_DOCUMENTS`). Basta cualquiera de estas condiciones:

1. `sales.quote_files` pasa de ~1 GB, o de un cuarto del tamaño de la base, y los respaldos
   o restauraciones se vuelven lentos.
2. Aparecen archivos que no son PDF pequeños: fotos de productos, catálogos, comprobantes
   escaneados, adjuntos de clientes.
3. Hace falta servir archivos sin pasar por el bridge (CDN, enlaces firmados de descarga
   directa) o guardarlos fuera del VPS por continuidad.

**Cómo se migraría sin cambiar enlaces:**

- `QuotePdfService` es el único que lee y escribe `sales.quote_files`. Se cambia su
  almacenamiento por un bucket privado (API S3 de R2) y se copian los archivos existentes.
- La URL pública sigue siendo `/cotizacion/<código>`, servida por el portal: el bucket nunca
  queda expuesto.
- Facturas y boletas siguen en el volumen de FacturaYa. Si se adopta R2, se evalúa en el mismo
  momento para esos archivos.

Para vigilarlo:
`SELECT pg_size_pretty(sum(octet_length(content))), count(*) FROM sales.quote_files;`

## Consecuencias

- Menos superficie: sin editor, sin logos subidos por usuarios, sin colores configurables.
- La cotización y la factura se ven iguales, lo que da coherencia a lo que recibe el cliente.
- Si FacturaYa no responde, la cotización se guarda igual y se envía el enlace. El PDF se
  genera al primer intento que funcione.
- El portal deja de tener una página HTML para la cotización: solo sirve el PDF o un aviso.
