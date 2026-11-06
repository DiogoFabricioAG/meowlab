# GRE privada en Manolo — integración 2026-11-05

Publicada como parte de `enterprise-advisor` en Worker `4ceeaa93` y bridge
`fiscal-20261105`; no es un rol adicional. [Acta y rollback](../operations/manolo-credit-gre-2026-11-05.md).
GRE real sigue deshabilitada en FacturaYa. Contrato coordinado con su mantenedor, cuyo
`docs/despatches.md` es la autoridad de su API. Su entrega y migración se
completaron separadamente antes de Manolo. No se emitieron documentos reales.

## Flujo

La actualización semántica del 2026-11-06 hace que Luna interprete fechas,
peso y ubicaciones, con preguntas pendientes guardadas en el checkpoint. El
usuario indica nombres de lugares; un catálogo oficial del INEI resuelve el
ubigeo y se piden provincia/departamento si hay homónimos. Los pendientes se
agrupan por tema y no repiten datos ya guardados.
[Entrega y procedencia del catálogo](../operations/manolo-gre-locations-2026-11-06.md).

Actualización publicada 2026-11-06, Worker `173dde02` y bridge `gre-fixes-20261106`:
la guía ya no hereda la fase terminada de una factura. Conserva categoría y campos
entre turnos; las facturas con notas de crédito aceptadas se excluyen y revalidan.
Precarga bienes y cantidades desde la factura, permite corregir traslados parciales
y muestra pendientes con espacios, viñetas y negritas. Paginación con botones.
[Entrega, límites y rollback](../operations/manolo-gre-fixes-2026-11-06.md).

La entrada «Guía privada» aparece cuando el cliente inyectado ofrece la
capacidad `despatch`. También se puede escribir «Guía de remisión». La empresa
y autorización se resuelven con el mecanismo existente en cada turno.

1. Preguntar primero categoría M1, L u otra según la tarjeta del vehículo, antes
   de buscar facturas o solicitar otros datos. Se acepta el botón o una
   declaración explícita como «M1», «es M1» o «mi vehículo es M1». No se deduce
   por auto/camioneta ni por descripciones de bienes («Laptop M1»). «No sé»
   mantiene pendiente la clasificación y bloquea la preparación/confirmación.
2. Elegir explícitamente una factura `01` aceptada, del entorno de la empresa y
   cliente identificado con RUC. La lista tiene botones de página; el detalle
   autorizado precarga bienes y cantidades para la revisión.
3. Recoger fecha de emisión e inicio del traslado, partida y llegada con dirección
   y ubicación, y peso kg. Luna normaliza fechas relativas/abreviadas y unidades
   desde lo expresado por el usuario; el catálogo resuelve el ubigeo por nombre.
   Para categoría `other`, pedir placa principal y conductor
   con DNI, nombres, apellidos y licencia. Para `M1`/`L`, omitir ambos objetos
   del POST y declarar el indicador M1/L en el resumen. El usuario revisa los
   bienes y cantidades precargados y puede indicar un traslado parcial.
   No se inventan datos ausentes. “Almacén del proveedor” requiere dirección y
   distrito exactos; no se sustituye por un domicilio fiscal.
4. Guardar un checkpoint antes de crear el borrador. La clave de negocio
   `idempotency_key` permanece estable si una respuesta de creación se pierde;
   pedir el resumen recupera esa misma revisión. Cambiar datos crea otra revisión
   de borrador e invalida el botón previo.
5. Mostrar todos los datos, factura, destinatario, empresa, entorno y límites.
   Sólo tras confirmar la entrega del resumen completo y del botón se conserva
   autorización con ID aleatorio, revisión, guía y `confirmation_digest`.
6. Sólo el botón vigente llama al envío. Se guarda `issuing` antes de la llamada.
   «Crear», «emitir» y «confirmar» escritos no envían. Una respuesta perdida deja
   bloqueado el reenvío, incluso tras reiniciar el handler.
7. «Consultar estado» hace GET de la guía y, únicamente si está `pending`, consulta
   el ticket. Nunca llama otra vez a emisión. `pending` no equivale a aceptación;
   `unknown`, `processing`, `preparation_failed` y otros estados no confirmados
   requieren revisión manual. Un resultado simulado siempre se anuncia como tal.

El checkpoint GRE está anidado en la sesión D1 existente y conserva su TTL de
siete días y CAS. Cambiar de empresa descarta la selección y confirmación
anteriores. Las conversaciones y autorizaciones de otros contactos permanecen
aisladas. El backend vuelve a comprobar factura, empresa, entorno, configuración,
fechas y digest antes de emitir.

Cambiar la categoría invalida guía/revisión/botón anteriores. Al pasar a M1/L
elimina placa/conductor y la evidencia textual previa que podría reintroducirlos;
conserva los demás datos. Al elegir `other` de nuevo exige registrar placa y
conductor nuevamente. La categoría viaja dentro del payload y su digest; cada
revisión usa una nueva clave de negocio. El botón «Cambiar categoría» también
retira la confirmación antes de volver a preguntar. Las guías ya enviadas siguen
en modo consulta, sin cambios ni reenvíos.

## Contrato y transporte

No se crean rutas públicas nuevas en Manolo. Las operaciones recorren el bridge
HMAC existente, con request ID, timestamp, hash y almacenamiento de replay.

| Operación bridge | API FacturaYa | Permiso existente |
| --- | --- | --- |
| `create_despatch` | `POST /api/despatches` | `create_invoice` |
| `get_despatch` | `GET /api/despatches/{id}` | `view_invoice` |
| `issue_despatch` | `POST /api/despatches/{id}/issue` | `issue_invoice` |
| `refresh_despatch` | `POST /api/despatches/{id}/status` | `view_invoice` |

El cuerpo de creación usa `idempotency_key`, `invoice_id`, `issue_date`,
`transfer_date`, `origin`, `destination`, `weight_kg`, `vehicle_category`,
`vehicle`/`driver` sólo para `other`, e
`items`. La emisión usa `confirmed: true` y `confirmation_digest`. IDs ULID
aceptan mayúsculas o minúsculas; el ID devuelto debe corresponder al solicitado.
Se valida la forma del payload y se bloquean campos que intenten fijar empresa,
entorno, modalidad o motivo. Las mutaciones se auditan como recurso `despatch`,
sin datos del conductor, direcciones, contenido de guía ni credenciales.

Por compatibilidad, el cliente API/bridge admite payload legacy sin categoría
si tiene vehículo y conductor completos; nunca infiere M1/L por su ausencia.
Los nuevos flujos conversacionales sí exigen categoría explícita. FacturaYa
normaliza M1/L omitiendo vehículo/conductor en respuesta; Manolo siempre envía
ambos ausentes. El backend declara el indicador UBL, sin implementación XML en
Manolo. Esta ampliación no requiere una migración adicional.

La factura se elige desde `listInvoiceDrafts(page?)`; el backend actual pagina a
diez aunque el cliente histórico envíe `per_page=100`. No se promete una búsqueda
global por número: se ofrecen páginas y selección explícita.

## Límites y activación pendiente

Primer alcance: remitente `09`, venta `01`, transporte privado `02`, serie T001,
con categoría declarada M1/L u otra; vehículo y conductor con DNI obligatorios
para `other`. No comprende GRE transportista, transporte
público, eventos especiales, remolques, inventario ni cantidades acumuladas de
otras guías. La búsqueda automática de ubigeos utiliza un snapshot versionado
del INEI; no consulta un servicio de geocodificación durante la conversación.

El adaptador autenticado permite descargar XML/CDR desde
`GET /api/despatches/{id}/files/xml|cdr`, con el mismo límite de origen y tamaño
que las descargas existentes. **Entrega de XML/CDR por WhatsApp pendiente**:
no se anuncian botones de descarga ni se publica un enlace con tokens. Tampoco
existe un portal web de guías en FacturaYa. El mensaje informa que los archivos
requieren la integración autenticada. No se intenta subir XML/ZIP como si fueran
PDF: la [referencia de documentos de Meta](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/document/)
no acredita estos formatos para el transporte de documentos.

El PDF descrito abajo es un formato de trabajo sin QR ni hash: no es la
representación impresa oficial de la GRE y no se anuncia como lista para operar
un traslado o disponible en producción. Las credenciales GRE y el próximo correlativo de T001
se configuran y confirman por administración en FacturaYa, nunca por WhatsApp.
No se solicitan ni transportan `gre_client_id`/`gre_client_secret` en Manolo.

Backend compatible, bridge y Worker ya publicados desde una entrega aislada.
Habilitar GRE real requiere configuración administrativa y validaciones restantes;
no se habilitó por publicar este flujo. Bindings, webhook, catálogo de roles y
migraciones Manolo se conservan. La actualización `173dde02` precarga los bienes
para traslado completo y admite correcciones explícitas para un traslado parcial.

## PDF de la guía (formato de trabajo) — local 2026-11-06, sin desplegar

Manolo genera un PDF A4 que replica
[`templates/Guia_Remision_Plantilla_M1_L_2026.docx`](templates/Guia_Remision_Plantilla_M1_L_2026.docx):
remitente y recuadro de número, datos de la operación, partida y llegada
(dirección · distrito · provincia · departamento desde el catálogo INEI),
destinatario y factura asociada, 17 filas de bienes (crece si hay más), peso en
KGM e información del transporte. Para M1/L omite conductor; para `other` añade
una fila de conductor. Conserva el encabezado «FORMATO DE TRABAJO · NO ES UNA GRE
EMITIDA POR SUNAT» y el pie de la plantilla en cada página.

- **Cuándo se envía:** con la revisión, antes del botón «Confirmar guía» (número
  `T001 - BORRADOR`); tras emitir, con serie y correlativo cuando FacturaYa los
  devuelve; y a pedido con el botón «PDF de la guía» o escribiendo «PDF».
  «Consultar estado» solo reenvía el PDF si cambió el estado o el correlativo.
- **Cuándo no:** guía rechazada, envío incierto (`issuing`) o datos incompletos.
- **Fuente de datos:** el `payload` que devolvió FacturaYa, no el texto del chat.
- **Fallos:** si Browser Run o la subida a Meta fallan, se avisa al usuario y el
  botón de confirmación sigue disponible; el PDF nunca bloquea ni dispara la emisión.
- **Implementación:** `src/facturaya/despatch-template.ts` (HTML autocontenido con
  CSP `default-src 'none'`, sin recursos de red) y
  `src/adapters/documents/browser-pdf.ts` (binding `BROWSER`), inyectado como
  `renderPdf` en `RoleHandlerContext`. No requiere migraciones ni secretos nuevos.
- **Estado:** probado localmente; no desplegado. La fuente Aptos de la plantilla
  no existe en Browser Run: se usa la pila Segoe UI/Arial/Liberation Sans.

## Verificación local

Pruebas de contrato y límites, API simulada, transporte HMAC/replay/permisos,
selección de factura, resumen completo, botón vigente, edición incompleta,
reinicio tras pérdida de respuesta y aislamiento de empresa. Todas usan datos y
transporte simulados. Ejecutar desde `apps/manolo-whatsapp-worker`:

```sh
npm test -- --run test/despatch-contracts.test.ts test/despatch-client.test.ts test/enterprise-despatch.test.ts test/despatch-template.test.ts test/ubigeo.test.ts test/facturaya-multitenancy.test.ts
npm run typecheck
npm run build:node
```

La suite completa conserva dos fallos RADAR por uso de reloj real fuera del
horario de alertas. Pendiente independiente `radar-tests-real-clock` en tablero.
