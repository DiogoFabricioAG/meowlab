# Plataforma Manolo

## Alcance

`apps/manolo-whatsapp-worker` contiene dos ejecutables relacionados:

1. Cloudflare Worker, único webhook de Meta y gateway de WhatsApp.
2. Bridge Node para el VPS, detrás de Caddy y conectado a PostgreSQL.

Comparten contratos TypeScript, pero tienen despliegues y secretos distintos.

La [agrupación durable de ráfagas](../decisions/0002-agrupar-rafagas-whatsapp.md)
está activa. [ADR-0004](../decisions/0004-rafagas-texto-imagen.md) añade imágenes
contiguas al texto: tres segundos de silencio por conversación, hasta tres fotos,
normalización de cada original y un turno consolidado. Botones, audio y documentos
son barreras FIFO. El Durable Object sólo es bandeja transitoria y no cambia D1/PG.

## Roles registrados

### Guías y ubicaciones — publicado 2026-11-06

Worker activo `b82f74d9`: GRE usa interpretación semántica con citas y preguntas
persistidas. Fechas relativas y peso normalizado se guardan sin exigir la forma
original del mensaje. Un catálogo oficial INEI 2026 resuelve nombres de lugares
en ubigeos y pide aclarar homónimos. Pendientes agrupados, bienes de factura
conservados y mismo botón fiscal.
[Procedencia, pruebas y límites](../operations/manolo-gre-locations-2026-11-06.md).

### Interpretación del modelo — publicado 2026-11-06

Worker `8fa4bcb6` usa el contrato semántico de [ADR-0005](../decisions/0005-modelo-interpreta-facturacion.md):
Luna interpreta texto/imagen e identifica campos, citas del usuario y aclaraciones.
El código valida y persiste esos valores sin imponer su escritura original.
Se mantienen validaciones de negocio, autorización y botón fiscal.
[Pruebas y límites](../operations/manolo-semantic-state-2026-11-06.md).

### Importes y confirmación de datos — publicado 2026-11-06

Worker `c4ffeab5` normaliza formatos de dinero del usuario, mantiene el contrato
fiscal canónico y guarda el resultado por campo de pago dentro del checkpoint.
Las respuestas de avance/conversación/sin cambios en facturación se generan desde
el estado persistido, sin usar afirmaciones libres del modelo sobre lo guardado.
[Comportamiento, pruebas y límites](../operations/manolo-money-state-2026-11-06.md).

### Conversación activa — publicado 2026-11-06

Publicado, con actualización Worker `b82f74d9`: Decisions API se usa al entrar a una gestión
o después de completarla. En facturas, boletas, anulaciones y guías activas, los
datos pasan directamente a Luna con el checkpoint e historial correspondientes.
Fotos y documentos continúan la gestión seleccionada; no se interpretan como
órdenes de navegación. Botones y órdenes explícitas de menú, revisión, cancelación
o cambio de gestión mantienen su manejo seguro. Las consultas de borradores y
sus botones de paginación conservan la autorización existente.

Las respuestas de avance piden sólo lo necesario, con lenguaje cotidiano y hasta
dos frases cortas en las instrucciones del modelo. El respaldo textual no repite
cliente, documento y productos guardados. Los resúmenes fiscales siguen completos
y únicamente el botón vigente autoriza emitir. La conversación dentro de una
factura ya no abre el menú por una clasificación ambigua del extractor.

El rol empresarial tiene publicada una
[navegación por intención](../../apps/manolo-whatsapp-worker/README.md#navegación-por-intención--2026-11-06):
Decisions API antes de responder por estado, saludo con tres opciones, acceso
directo a pedidos claros, acciones secundarias y seguimiento Sí/No tras terminar.
La anulación requiere revisión y botón vigente. Conserva D1 como checkpoint,
PostgreSQL como autorización y los contratos privados existentes. Worker
`b82f74d9` activo, con bridge `gre-fixes-20261106`. Menú según permisos, tratamiento
de rechazos y resumen de anulación sin modificar campos corregidos;
[acta y diagnóstico](../operations/manolo-credit-summary-2026-11-06.md).
La última entrega incorpora [texto e imagen en un turno](../operations/manolo-multimodal-2026-11-06.md).

El rol empresarial tiene [GRE remitente privada publicada en Manolo](manolo-despatch.md):
no crea otro rol ni cambia el catálogo; configuración y habilitación fiscal real
siguen pendientes en FacturaYa. Incluye revisión/confirmación y consulta, sin QR ni
descargas de XML/CDR por WhatsApp. Un PDF en formato de trabajo (plantilla M1/L) está
publicado en el Worker `c2070081` (2026-11-06).

RADAR es un rol asignable desde la TUI desde el 2026-10-31. Su handler comparte
registro, resolución y transporte con Manolo. La API del escritorio conserva
consentimiento y alertas: vincular no cambia el rol ni asignarlo autoriza envíos.
Véanse [ADR-0003](../decisions/0003-radar-rol-licitaciones.md) y el
[contrato API](radar-whatsapp-api.md).

Hay una [ampliación conversacional preparada](radar-conversation.md), aún sin
publicar: redacción de avisos asistida por IA y contexto aislado del último aviso
para dar seguimiento. La respuesta del usuario en WhatsApp renueva la ventana;
los mensajes del bot nunca la renuevan.

| Rol | Responsabilidad principal | Dependencias relevantes |
| --- | --- | --- |
| `cat` | Onboarding interactivo de MeowLab y Gato Manolo conversacional | IA conversacional, `roleState` D1, botones interactivos Meta |
| `radar` | Orientación sobre licitaciones y estado de alertas | IA, adaptador de estado RADAR; búsquedas/evidencia en escritorio |
| `quotes` | Borrador, correlativo y PDF de cotización | D1, Groq, Browser Run, Meta |
| `print-advisor` | Consultas analíticas del negocio | Bridge VPS, Groq, PostgreSQL/D1 |
| `store-designer` | Diseño, configuración, pedido y pago de tienda | API privada de tienda |
| `enterprise-advisor` | Facturación empresarial multiempresa | OpenAI compatible, VPS, FacturaYa, R2 |

El rol efectivo del contacto puede sobrescribir el rol base del tenant. Un rol
desconocido cae en `cat`, pero no reescribe la configuración persistida.

## Sales Cat (`/sales`, ADR-0011 fase 1)

Sales Cat no es un rol del contacto: funciona encima del rol que tenga. `/sales` lo
abre, sus botones (`sales:*`) vuelven a él y, mientras la conversación siga abierta (30
minutos desde el último mensaje, estado `sales` en `contact_role_states`), los mensajes
se quedan con él; `/salir` lo cierra (`src/index.ts`, `src/roles/sales-role.ts`).

- **Empresa:** sólo las empresas donde el número es miembro activo y que tienen Sales Cat
  activo (`sales.settings.enabled`). Con varias, se elige de una lista.
- **IA:** `SALES_AI_MODEL` (Groq `openai/gpt-oss-120b`) con salida estructurada
  (`src/sales/extractor.ts`): venta, cotización, consulta, producto o anulación. Los
  precios salen del mensaje o del catálogo, nunca inventados; si falta uno, lo pregunta.
- **Datos:** PostgreSQL de la plataforma (migración `014-sales-cat.sql`):
  `commerce.customers` y `commerce.products` (creados al vuelo), `sales.quotes`,
  `sales.sales`, `sales.lines`, numeración por empresa y `sales.audit_log`. Ruta firmada
  `/v1/sales/execute` con idempotencia por id de solicitud (`src/node/sales/`).
- **Cotización:** se comparte con un botón de enlace (`cta_url`) a
  `PORTAL_PUBLIC_URL/cotizacion/<código>`; sólo se guarda el hash del código. El portal la
  lee por `/v1/portal/public-quote` con su propio secreto.
- **Comprobante:** tras guardar una venta ofrece factura o boleta con Invoice Cat de la
  misma empresa (FacturaYa) y enlaza el número a la venta. Al crédito, con descuento en
  varios productos o sin el documento del cliente, deriva a Invoice Cat.
- **Activar para una empresa:** `INSERT INTO sales.settings (tenant_id) VALUES ('<id>')`.
- **Pruebas:** `test/sales-role.test.ts` y `tools/sales-pg-check.ts` (PostgreSQL
  desechable).

## Regla para añadir un rol

1. Define contratos del dominio fuera del handler si hay un proveedor externo.
2. Implementa el adaptador detrás de ese contrato.
3. Crea un `RoleHandler` en `src/roles/`.
4. Regístralo en `src/roles/registry.ts`.
5. Añade el rol al catálogo PostgreSQL si debe asignarse desde la TUI.
6. Decide dónde vive su estado y documenta la fuente de verdad.
7. Añade pruebas unitarias del handler, errores, reintentos e interacciones.
8. Verifica que texto, audio, imagen y documento conserven la personalidad y el
   flujo del rol cuando sean entradas válidas.

Los modelos y credenciales pertenecen a configuración y factorías, no al
constructor del rol. Si varios roles requieren configuraciones diferentes, se
debe evolucionar hacia un catálogo de proveedor/modelo por tenant o rol sin
crear lógica condicional dispersa.

## Persistencia

### D1

Las migraciones contienen tenants, números, bot configs, contactos,
conversaciones, mensajes, cotizaciones, correlativos compartidos, estado de
roles y notificaciones de tienda. Las migraciones históricas de funcionalidades
retiradas se conservan sin reactivarlas ni usarlas desde el runtime.

### PostgreSQL VPS

Los scripts `init/` crean los esquemas `whatsapp` y `print_system`. Las
migraciones versionadas agregan solicitudes del bridge, control de roles,
runtime preparatorio y FacturaYa multiempresa.

No modifiques una migración desplegada. Crea la siguiente versión y proporciona
una ruta de rollback o una estrategia compatible.

## Seguridad

- Firma de Meta sobre bytes originales.
- HMAC y tolerancia temporal para Worker → VPS.
- Deduplicación por ID de Meta y claves de idempotencia por dominio.
- Tokens FacturaYa cifrados en el VPS y descifrados únicamente durante la
  operación autorizada.
- Consultas de Print Advisor en modo de solo lectura.
- Logs estructurados sin mensajes, teléfonos, documentos ni secretos.
- Límite de tamaño para cuerpo HTTP y documentos.

## Administración

La TUI principal se ejecuta con `npm run users:tui` y administra PostgreSQL por
SSH. La TUI D1 existe solo para compatibilidad de grupos de cotizaciones.

El README detallado de la aplicación es
[`apps/manolo-whatsapp-worker/README.md`](../../apps/manolo-whatsapp-worker/README.md).
Debe actualizarse cuando cambie un rol, variable o flujo operativo específico.
