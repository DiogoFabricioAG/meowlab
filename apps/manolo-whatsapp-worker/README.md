# Meta WhatsApp Cloud API webhook

Actualización activa `b82f74d9`: GRE interpreta fechas/peso con Luna, conserva
preguntas y campos entre mensajes y agrupa pendientes sin etiquetas duplicadas.
El catálogo oficial INEI resuelve ubigeos por nombre; se aclaran homónimos.
[Entrega, pruebas y catálogo](../../docs/operations/manolo-gre-locations-2026-11-06.md).

Actualización previa `8fa4bcb6`: Luna interpreta los campos con citas del usuario
y preguntas persistidas; el contrato semántico evita reinterpretar su escritura
mediante heurísticas. Conserva validación de negocio y emisión por botón.
[Entrega y límites](../../docs/operations/manolo-semantic-state-2026-11-06.md).

Actualización activa Worker `c4ffeab5`: importes con miles/decimales normalizados,
resultado por campo de pago y respuestas desde el checkpoint persistido. El
modelo extrae datos; las confirmaciones de guardado se construyen en código.
[Entrega y rollback](../../docs/operations/manolo-money-state-2026-11-06.md).

Actualización activa Worker `173dde02` y bridge `gre-fixes-20261106`: memoria GRE,
facturas sin NC aceptadas, bienes/cantidades precargados y páginas con botones.
[Entrega](../../docs/operations/manolo-gre-fixes-2026-11-06.md).

Actualización Worker `756ae5a6`: «este año» especifica el año del turno en Perú;
las continuaciones conservan el vencimiento, independiente de emisión.
[Corrección y recuperación](../../docs/operations/manolo-date-retention-2026-11-06.md).

Cloudflare Worker en TypeScript para recibir webhooks de Meta WhatsApp Cloud API y responder automáticamente a los mensajes entrantes.

## Agrupación de mensajes — activa, actualización 2026-11-06

**Kapso (ADR-0009).** `KAPSO_PHONE_NUMBER_IDS` lista los `phone_number_id` conectados por Kapso; esos números envían por `https://api.kapso.ai/meta/whatsapp/v24.0` con el secreto `KAPSO_API_KEY` y reciben en `POST /webhooks/kapso`, firmado con `KAPSO_WEBHOOK_SECRET` (webhook de Kapso tipo `meta`). Sin secreto la ruta responde 503.

`RADAR_PRESENCE_ENABLED` (por defecto `false`) mantiene apagada la presencia de RADAR: ruta, cron y recibos del webhook.

`WHATSAPP_BURST_ENABLED` habilita la bandeja `WHATSAPP_BURSTS` por
tenant/número/contacto. Espera 3 s desde el último texto (máximo 10 s desde el
primero, 20 mensajes y 8.000 caracteres originales); texto e imágenes contiguas
(hasta tres por turno) se consolidan antes de entrar al rol una sola vez. Cada
foto se analiza con Luna y sus datos legibles completan el borrador junto con
el texto. Botones, audio y documentos siguen siendo barreras FIFO independientes.
Se conservan originales/IDs/tipos y contenido normalizado en D1 y sombra VPS.
Los nuevos mensajes durante la inferencia quedan pendientes para otro turno.

La bandera está en `true` en producción; la migración DO `whatsapp-bursts-v1`
ya estaba aplicada. Esta actualización no agrega migraciones ni bindings. Ante
fallos inciertos no repite operaciones fiscales y bloquea Crear hasta revisión
administrativa; la recuperación operativa requiere reconciliar con FacturaYa.
Los payloads correctos se eliminan al terminar; inciertos se retienen hasta
24 h, sin registrar su contenido en logs. No corrige la configuración del
proveedor DNI. Diseño, límites y rollback en
[ADR-0002](../../docs/decisions/0002-agrupar-rafagas-whatsapp.md) y su ampliación
[ADR-0004](../../docs/decisions/0004-rafagas-texto-imagen.md).
Un error al leer una imagen conserva los datos textuales; ninguna imagen o frase
autoriza emisión. [Publicación y rollback](../../docs/operations/manolo-multimodal-2026-11-06.md).

## Rutas

- `GET /health`: health check sin información sensible.
- `GET /webhooks/whatsapp`: verificación `hub.mode`, `hub.verify_token` y `hub.challenge` solicitada por Meta.
- `POST /webhooks/whatsapp`: valida `X-Hub-Signature-256` sobre los bytes originales con HMAC-SHA256, acepta eventos de WhatsApp y responde a cada remitente encontrado en `messages`.

Cada mensaje de texto se enruta al rol activo del contacto. Las notas de voz se descargan desde Meta, se transcriben con el modelo `GROQ_TRANSCRIPTION_MODEL` y se entregan al mismo rol como texto; por eso funcionan para `cat`, `quotes`, `print-advisor`, `store-designer` y `enterprise-advisor` sin duplicar lógica. Si el proveedor falla o todavía no se configuró, se utiliza una respuesta corta de respaldo. El procesamiento se ejecuta en segundo plano con `ctx.waitUntil`, para que el webhook devuelva `200` rápidamente. Los eventos que solo contienen `statuses` no generan respuestas.

El Worker está conectado a la base D1 `whatsapp-webhook-meta-db`. Cada webhook se enruta por el `phone_number_id` de Meta y carga desde D1 el cliente y la configuración de su bot. Cada tenant tiene un único `role_key`, que se aplica a todos sus contactos. El registro `manolo` usa el rol `cat` por defecto y el rol `quotes` usa la configuración de cotizaciones asociada al tenant.

Los logs posteriores a la respuesta contienen únicamente metadatos: tipo de evento, cantidad de `entry` y `changes`, campos de evento truncados, entorno y timestamp. No se registran payloads, mensajes, teléfonos, nombres ni secretos.

## Desarrollo local

Requisitos: Node.js 16.17 o posterior y una sesión autenticada de Wrangler.

```bash
npm install
copy .dev.vars.example .dev.vars
# Edita .dev.vars con valores exclusivamente locales.
npm run cf-typegen
npm run typecheck
npm test
npm run dev
```

En PowerShell, el comando de copia equivalente es `Copy-Item .dev.vars.example .dev.vars`.

## D1 y configuración multi-cliente

La migración inicial crea estas tablas: `tenants`, `whatsapp_numbers`, `bot_configs`, `contacts`, `conversations` y `messages`. El historial entrante y saliente se guarda por cliente y el `message_id` de Meta se usa para evitar procesar dos veces el mismo evento.

Para revisar o aplicar migraciones:

```bash
npx wrangler d1 migrations list whatsapp-webhook-meta-db --remote
npx wrangler d1 migrations apply whatsapp-webhook-meta-db --local
npx wrangler d1 migrations apply whatsapp-webhook-meta-db --remote
```

Para añadir un cliente nuevo se creará un registro en `tenants`, su número en `whatsapp_numbers` y su prompt en `bot_configs`. El código del Worker se mantiene compartido; la separación se realiza mediante `tenant_id`.

## Arquitectura de roles

El Worker usa `RoleHandler` + `RoleRegistry`. Cada rol implementa su propia configuración y procesamiento en `src/roles/`; actualmente están registrados `cat`, `quotes`, `print-advisor`, `store-designer` y `enterprise-advisor`. El flujo HTTP solo resuelve el rol efectivo del contacto y delega en el handler correspondiente.

Para agregar un rol nuevo:

1. Crea un handler que implemente `RoleHandler`.
2. Define su `key`, configuración y método `handle`.
3. Regístralo en `src/roles/registry.ts`.
4. Añade pruebas del handler y del enrutamiento.

Un `active_role_key` del contacto tiene prioridad sobre el rol predeterminado del tenant. Si no existe override, se hereda el rol del tenant; si el rol no está registrado, se usa el handler de respaldo `cat` sin alterar la configuración guardada del tenant.

## Límites de arquitectura

La configuración variable del negocio vive en D1 y PostgreSQL; las credenciales de infraestructura viven en Cloudflare Secrets o Docker Secrets según su consumidor; y cada proveedor externo se implementa detrás de un adaptador. Los roles reciben contratos (`AiProvider` y el contexto de WhatsApp) y no llaman directamente a Groq, FacturaYa o Meta Graph API.

La composición se concentra en `src/index.ts` y en las factorías de `src/adapters/`. Actualmente los adaptadores son:

- `src/adapters/ai/groq-adapter.ts`: chat y transcripción.
- `src/adapters/ai/openai-compatible-adapter.ts`: chat y razonamiento configurable para el rol empresarial.
- `src/adapters/facturaya/vps-client.ts`: cliente sin credenciales que firma las operaciones FacturaYa hacia el VPS.
- `src/node/facturaya/operation-service.ts`: autorización multiempresa, descifrado por operación, idempotencia y auditoría en el VPS.
- `src/adapters/documents/r2-store.ts`: retención temporal de documentos que llegan separados dentro de la sesión.
- `src/adapters/print-system/d1-repository.ts`: consultas SELECT protegidas sobre la base D1 del negocio de impresión.
- `src/adapters/whatsapp/meta-client.ts`: mensajes, documentos y media.

Para agregar otro proveedor de IA, implementa `AiProvider`, registra la selección en `src/adapters/ai/factory.ts` y conserva el modelo/credencial fuera del rol. La lógica de cotizaciones y de los demás dominios no necesita cambiar.

## Rol empresarial: `enterprise-advisor`

### Navegación por intención — 2026-11-06

**Publicado en Worker `79ffc31d`:** Decisions API enruta la entrada
y el inicio de una nueva gestión. Facturas, boletas, anulaciones y guías activas
continúan con Luna y el checkpoint, sin Decisions intermedio; imágenes y documentos
pertenecen al flujo elegido. Los controles explícitos y la paginación de consultas
mantienen autorización y confirmación. Las respuestas de avance usan lenguaje
cotidiano y hasta dos frases cortas en las instrucciones del modelo; el resumen
previo a emitir sigue completo. Validación: 488 pruebas de trabajo, 391 del paquete
aislado y typecheck correctos. [Entrega y rollback](../../docs/operations/manolo-entry-routing-2026-11-06.md).

Publicado inicialmente en Worker `a768ba36`; actualización activa `b5f73411`
con menú según permisos, recuperación de rechazos concluyentes y revisión de
anulación que conserva motivo/código/fecha sin extraer nuevos datos.
Bridge `fiscal-20261105` conservado;
[evidencia y rollback](../../docs/operations/manolo-credit-summary-2026-11-06.md).

Antes de responder según el comprobante anterior, el rol clasifica el texto
actual con `AiProvider.decide` (Decisions API, modelo del tenant). Los botones
son rutas deterministas. Un saludo o mensaje ambiguo presenta **Generar Factura**,
**Generar Boleta** y **Otras opciones**, incluso después de una emisión; conserva
el checkpoint. Un pedido claro como «Manolo hazme una factura» inicia directamente
el flujo elegido y procesa los datos explícitos del mismo mensaje. Si requiere
seleccionar empresa, guarda el pedido y lo reanuda tras autorizarla.

Otras opciones abre una lista de acciones reales: consultar borradores paginados,
anular factura mediante nota de crédito, guía de remisión cuando existe esa
capacidad y cambiar empresa. La anulación prepara un resumen y sólo llama a
FacturaYa desde **Confirmar anulación**, con identificador aleatorio vinculado
a revisión y comprobante; editar el motivo invalida el botón anterior.
La lista sólo muestra acciones autorizadas en la empresa elegida; anular exige
`create_credit_note`, revalidado antes de revisar y confirmar. Un rechazo
`forbidden` conserva datos e invalida el botón sin dejar una emisión incierta;
se requiere un nuevo resumen y clic después de resolver el permiso. Un error de
red mantiene el bloqueo y nunca se reenvía automáticamente.
Pedir el resumen de anulación sólo lee los campos guardados y renueva su botón;
una nota ya procesada se muestra sin habilitar otra confirmación.

Después de entregar el PDF del comprobante, muestra «¿Te ayudo con otra gestión?»
con **Sí / No**. Sí vuelve al menú principal; No cierra cordialmente y permite
iniciar otra gestión en el siguiente contacto. También hay seguimiento tras
consultar borradores, cancelar un borrador o finalizar una nota/GRE. Una guía
pendiente no se anuncia terminada. El seguimiento tiene identificador y revisión
propios; un botón antiguo o de otro contacto no reinicia otra operación.

El contrato HTTP de Decisions usa opciones `{value, description?}` y normaliza
las probabilidades de respuesta. Tiene un límite de ocho segundos y respaldo
conservador si falta configuración, hay error o respuesta inválida. Los logs
incluyen intención/origen, sin texto ni documentos del cliente. La clasificación
nunca autoriza una emisión. Los resultados inciertos bloquean reenvíos y cambios
de empresa, conservando su referencia. Sin variables, bindings ni migraciones
nuevas. La publicación conserva las ráfagas y el cron vigentes.

La [integración GRE privada](../../docs/apps/manolo-despatch.md) está publicada en
Manolo desde la [release fiscal del 2026-11-05](../../docs/operations/manolo-credit-gre-2026-11-05.md): categoría M1/L/otra preguntada primero según tarjeta, factura aceptada
elegida, datos de traslado explícitos, revisión,
botón con digest y consulta de ticket sin reenvío. Emisión GRE real aún deshabilitada en FacturaYa; sin QR ni
entrega de XML/CDR por WhatsApp; archivos sólo mediante integración autenticada. Desde el Worker `c2070081`
envía un PDF en formato de trabajo con la plantilla M1/L vía Browser Run; no es la representación impresa oficial.
M1/L omite placa y conductor del payload; otra categoría exige ambos. Cambiar
categoría limpia sus datos anteriores e invalida el botón; no se infiere por
auto/camioneta ni por nombres de productos. Precarga de bienes pendiente.

Este rol atiende facturación para varias empresas con el mismo número de Manolo. Usa el menú por intención descrito arriba y abre un checkpoint persistente en D1, aislado por tenant, contacto y rol. Guarda datos comerciales, etapa, revisión, borrador y confirmación vigente, y vence tras siete días de inactividad. Se reanuda entre mensajes y ejecuciones del Worker; los cambios se guardan antes de llamar a FacturaYa, incluso si la importación falla. Las escrituras condicionales impiden que dos mensajes simultáneos sobrescriban el checkpoint. PostgreSQL sigue autorizando la empresa y sus permisos: su selección activa vence a los 20 minutos y se vuelve a validar en cada turno. Reseleccionar la misma empresa conserva el checkpoint; elegir otra descarta sus datos y botones anteriores.

`Facturación` recibe texto, audio ya transcrito, imágenes y documentos de WhatsApp; puede conservar temporalmente un PDF en R2 mientras el usuario completa el RUC y nombre del cliente. El Worker envía al puente HMAC el `tenant_id`, `contact_id`, la operación y sus datos comerciales. El token de empresa nunca sale del VPS. El modelo distingue actualización comercial, conversación, consulta del resumen y cancelación; cambiar nombre, DNI, fecha o IGV conserva los productos, y los saludos no se importan. El checkpoint y los últimos 12 mensajes aportan contexto al modelo. También puede localizar una factura por su número y solicitar una nota de crédito. Greenter, cálculos, correlativos y respuestas de SUNAT permanecen bajo el control de `facturaya-ai`.

FacturaYa puede preparar un borrador interno antes de confirmar, pero la creación/emisión fiscal solo se solicita al pulsar `Crear factura` o `Crear boleta` en el resumen vigente. El resumen muestra empresa, cliente, documento, fecha, moneda, todos los productos con cantidades/precios/importes, subtotal, IGV, total y advertencias; los resúmenes largos se envían completos antes de los botones. El botón tiene un identificador aleatorio vinculado al borrador y la revisión del checkpoint, y solo se habilita después de que Meta confirme el envío. Cambiar datos o volver a mostrar el resumen invalida el botón anterior. Escribir `emitir`, `confirmar` o `crear` no emite. Los botones heredados sin revisión y los clics repetidos se rechazan. Si no hay botones disponibles, no se permite confirmar por texto.

La etapa `issuing` se guarda antes de emitir y `issued` antes de responder al usuario. Si falla la red durante la emisión, el checkpoint queda pendiente de verificación y bloquea otro intento automático; el operador debe comprobar el comprobante en FacturaYa. El usuario puede apartarlo sin perderlo: `/reiniciar`, cancelar o «déjala para después» lo estacionan en la sesión y «retomar» lo restaura; iniciar otra gestión fiscal pide antes confirmar con «Dejarla y seguir». Nunca se reenvía. Una sesión emitida se conserva hasta iniciar otro comprobante, cancelar, reiniciar o vencer. Este checkpoint continúa usando D1: no cambia la autoridad del runtime hacia PostgreSQL ni requiere una nueva migración SQL.

### Condiciones de pago (actualizaci?n activa, 2026-11-06)

Publicadas posteriormente en la misma fecha con Worker `4ceeaa93` y bridge
`fiscal-20261105`; pruebas, respaldo y rollback en el acta de release enlazada.

Las facturas nuevas preguntan **contado o crédito** antes de importar. El crédito
sólo admite factura `01`: saldo pendiente explícito después de cualquier anticipo,
de una a doce cuotas con importes explícitos y fechas completas posteriores a la
emisión. No se infiere el año de «05 diciembre» ni se inventa un importe. La suma
en céntimos debe igualar el saldo y éste no puede superar el total del borrador.
Las boletas siguen al contado. Los checkpoints antiguos de facturas sin condición
requieren completarla antes de habilitar otro botón.

El checkpoint conserva estos datos y el contexto de pago incompleto entre turnos.
Cambiar condición, saldo, cuotas o vencimiento invalida la confirmación previa,
incluso si el cambio todavía está incompleto; conserva cliente y productos. El
resumen muestra condición, moneda, saldo y cada cuota antes del botón. Una
respuesta de FacturaYa que no refleje las condiciones de crédito bloquea la
creación. Se valida nuevamente al hacer clic.

El contrato interno añade `paymentMethod`, `outstandingAmount` e `installments`
(`due_date`, `amount`). El bridge los valida y el adaptador legacy envía
`payment_method=contado|credito`, `outstanding_amount` y
`installments[0][due_date]` / `installments[0][amount]` mediante FormData a
`POST /api/invoice-drafts/import`. Al contado omite saldo y cuotas en multipart;
el contrato JSON representa saldo nulo y cuotas vacías. La respuesta del borrador
usa los tres campos en snake_case al nivel superior y su moneda en `currency`.
Las correcciones continúan reimportando el borrador; no se añade una ruta de
edición ni se usa `fiscal-operations`. Backend compatible, bridge y Worker ya
publicados; no hay migraciones Manolo nuevas.

Las boletas pueden emitirse como `consumidor final` sin DNI: el Worker envía
`customer_document_type=0`, omite el documento y conserva opcionalmente un nombre
comercial explícito como referencia (por ejemplo, "a nombre de Patricia M"). Ese
nombre aparece en el borrador, el resumen de WhatsApp y el PDF, pero no se usa
como identificación fiscal; el XML mantiene la representación de consumidor
final. FacturaYa mantiene la validación tributaria y exige DNI o RUC si el importe
supera S/ 700.00 (o si la moneda no es PEN).

PostgreSQL contiene `tenant_members`, `tenant_integrations`, `facturaya_sessions` y `facturaya_audit_logs`. Los tokens se cifran con AES-256-GCM y `CREDENTIALS_ENCRYPTION_KEY`, montada únicamente como Docker Secret. Toda consulta de integración exige simultáneamente empresa activa, membresía activa, permiso requerido y sesión activa. Las emisiones, modificaciones y anulaciones quedan auditadas sin incluir el token ni el contenido del comprobante.

Al recibir un RUC sin razón social, el Worker consulta el endpoint autenticado de FacturaYa. FacturaYa busca primero entre los clientes guardados de la empresa, después en su caché global y finalmente usa ApiPeruDev con OpenRUC como respaldo; la razón social encontrada se conserva en el estado de la conversación y se muestra antes de solicitar los productos. Los tokens de esos proveedores permanecen en el VPS.

Consulta DNI (bridge y Worker desplegados el 2026-10-11): en una boleta,
un DNI de ocho dígitos sin nombre ejecuta `lookupCustomerByDni`; una solicitud
explícita como «consulta el nombre por DNI» fuerza la herramienta aunque la IA
la clasifique como conversación. Si el mensaje no incluye DNI, usa el del
checkpoint; si falta o no es válido, lo solicita. No inventa nombres.
Cambiar el documento descarta el nombre anterior salvo que el usuario aporte
uno nuevo, conserva productos e invalida el resumen/botón anterior. Un nombre
ya aportado no se reemplaza automáticamente sin solicitud de consulta.

La operación privada HMAC `lookup_customer_dni` lleva `{ dni }` junto con
tenant/contacto. El bridge verifica empresa y sesión activas y permiso
`create_invoice`, pues FacturaYa puede crear/actualizar al cliente durante la
consulta. Usa `GET /api/customers/lookup-dni/{dni}` con el token de empresa solo
en el VPS. Exige `data.document_type="1"`, documento coincidente y nombre no
vacío; descarta códigos de verificación y metadatos personales adicionales.
Registra auditoría `customer_lookup` y conserva deduplicación por request ID.
No se reejecuta el turno tras intentar la consulta si aparece un conflicto CAS.
Los errores distinguen no encontrado de indisponibilidad sin perder productos
ni emitir comprobantes. La creación sigue requiriendo el nuevo botón entregado.

Desplegar primero el bridge compatible y después el Worker. No hay migraciones
ni secretos nuevos en Manolo; la configuración del proveedor DNI pertenece a
FacturaYa. El endpoint existe en producción y el contrato HMAC/replay se
verificó sin consultar identidades reales. La configuración efectiva de
`DNI_LOOKUP_API_TOKEN` está vacía: pueden resolverse clientes guardados, pero
falta habilitar el proveedor externo y probar el recorrido real por WhatsApp.

El proveedor empresarial se selecciona por configuración (`ENTERPRISE_AI_PROVIDER`, `ENTERPRISE_AI_BASE_URL`, `ENTERPRISE_AI_MODEL`, `ENTERPRISE_AI_REASONING_EFFORT`) y no está acoplado al rol. El modelo configurado es exactamente `gpt-6-luna` con esfuerzo `high`. El adaptador reconoce GPT-6 como modelo de razonamiento y omite `temperature` cuando se especifica dicho esfuerzo. La disponibilidad y credencial deben verificarse en la cuenta consumidora; no se sustituyen modelos automáticamente.

## Rol de cotizaciones: WhatsApp + PDF

El rol `quotes` mantiene el borrador y sus productos en D1. Recopila los datos con Groq, pide confirmación, asigna un consecutivo independiente por contacto dentro del tenant, genera un HTML seguro y lo convierte a PDF mediante el binding `BROWSER` de Cloudflare Browser Run. Después sube el PDF a Meta como media y lo envía como documento por WhatsApp. Cada contacto nuevo comienza en 100; las cotizaciones históricas conservan sus números.

Las migraciones `0005_quotes.sql` y `0006_quote_branding.sql` crean `quote_configs`, `quote_sequences`, `quote_drafts` y `quote_items`, y conectan el logo del cliente específico desde `public/logo.png`. La configuración inicial de `manolo` reutiliza los datos del proyecto `cotizaciones`; los datos sensibles o variables de otro cliente deben actualizarse en D1.

El binding `BROWSER` requiere acceso a Browser Run. Para probar la generación de PDF localmente usa `npx wrangler dev --remote`; el modo normal de `npm run dev` sirve para probar el webhook y los borradores, pero no ejecuta el navegador remoto. La confirmación del usuario se procesa en segundo plano junto al resto del webhook. El Worker sirve `public/logo.png` como asset estático para que Browser Run pueda cargarlo dentro del PDF.

## Rol asesor del negocio: `print-advisor`

Este rol adapta el asesor analítico del proyecto `print-system` a WhatsApp. Se asigna a contactos concretos desde la TUI y consulta en modo solo lectura la base D1 `gamarra_db` mediante el binding `PRINT_DB`. Puede responder preguntas como `¿cuánto vendimos este mes?`, `¿qué clientes tienen más compras?` o `muéstrame los gastos por categoría`. Los reportes de tabla o gráfico se convierten a un formato legible en WhatsApp.

El rol usa Groq con tool-calling. El modelo se configura con `PRINT_ADVISOR_MODEL` y reutiliza la credencial `GROQ_API_KEY`; el rol no accede directamente a ninguna API ni ejecuta SQL. El repositorio rechaza escrituras, múltiples sentencias, comentarios y comandos administrativos antes de consultar D1.

## TUI de usuarios

La conexión usa por defecto el alias **`meowlab`** de OpenSSH, igual que
`ssh meowlab`. Usuario, host, puerto y llave se resuelven desde la configuración
SSH del equipo; ya no se fuerza la IP ni la llave del VPS anterior. Si necesitas
otro destino, `MANOLO_VPS_HOST` acepta un alias o `usuario@host`, y
`MANOLO_VPS_SSH_KEY` permite indicar una llave explícita opcional. Esto aplica
tanto al panel de contactos/roles como a la administración de empresas.
Primero comprueba `ssh meowlab`; después ejecuta `npm run users:tui:check`
para una comprobación de solo lectura o `npm run users:tui` para abrir el panel.

La TUI administra nombres y roles desde PostgreSQL en el VPS. Se conecta por la
llave SSH local y ejecuta `psql` dentro del contenedor; PostgreSQL no publica
ningún puerto ni guarda credenciales en el equipo:

```bash
npm run users:tui
```

El panel permite buscar contactos, asignar nombres, cambiar el rol activo,
heredar el rol base de la empresa y consultar el historial de cambios. La opción
`Empresas FacturaYa` crea y edita empresas fiscales, autoriza teléfonos, asigna
permisos, registra el token con entrada oculta, prueba la conexión y activa o
desactiva la integración. El token viaja por SSH mediante stdin al contenedor,
se cifra allí y nunca aparece en SQL, argumentos o logs. Los roles
se leen desde `whatsapp.role_catalog`, por lo que el menú no mantiene una lista
duplicada. Puede comprobarse la conexión sin abrir la interfaz con
`npm run users:tui:check`.

El Worker consulta el rol por la API privada HMAC del VPS y utiliza D1 como
respaldo si el servicio no responde. Mientras ese fallback exista, el TUI refleja
cada cambio de rol en D1 después de confirmar la escritura principal en
PostgreSQL; `MANOLO_D1_ROLE_MIRROR=false` desactiva esa compatibilidad cuando D1
sea retirado. Durante la migración, la gestión antigua de
grupos de cotizaciones continúa disponible con `npm run users:tui:d1`; esos
grupos todavía pertenecen a D1 y no se muestran en el nuevo panel.

## Variables y secretos

`ENVIRONMENT` es una variable no secreta y vale `development` localmente y `production` en el entorno desplegado.

Los secretos obligatorios son:

- `WHATSAPP_VERIFY_TOKEN`: valor que también se configura en Meta Developers.
- `META_APP_SECRET`: App Secret de la aplicación de Meta; nunca se guarda en este repositorio.
- `META_ACCESS_TOKEN`: token con permisos de WhatsApp para llamar a Graph API; nunca se guarda en este repositorio.
- `GROQ_API_KEY`: clave de Groq para generar la respuesta del gato; nunca se guarda en este repositorio.
- `OPENAI_API_KEY`: credencial del endpoint compatible con OpenAI para el rol empresarial y el análisis de imágenes de todos los roles; nunca se guarda en este repositorio.
- `STORE_DESIGN_API_SECRET`: secreto compartido para autenticar exclusivamente las peticiones del Worker a la tienda; también se configura como variable sensible en Vercel.
- `VPS_BRIDGE_HMAC_SECRET`: secreto compartido Worker → VPS para firmar el cuerpo exacto, la marca de tiempo y el request ID.

Las variables no secretas necesarias para responder son:

- `WHATSAPP_PHONE_NUMBER_ID`: Phone Number ID de Meta WhatsApp > API Setup.
- `META_GRAPH_API_VERSION`: versión que muestra el panel de Meta en API Setup, por ejemplo `vXX.X`. Usa la versión indicada por tu cuenta y no una versión antigua copiada de un tutorial.
- `GROQ_MODEL`: modelo de Groq; por defecto es `llama-3.1-8b-instant`.
- `GROQ_QUOTES_MODEL`: modelo de Groq usado exclusivamente para extraer cotizaciones; se recomienda `openai/gpt-oss-20b` porque permite Structured Outputs estrictos.
- `GROQ_TRANSCRIPTION_MODEL`: modelo de Groq usado para convertir notas de voz a texto; por defecto es `whisper-large-v3-turbo`.
- `PRINT_ADVISOR_MODEL`: modelo de Groq usado por `print-advisor`; por defecto es `openai/gpt-oss-120b`.
- `ENTERPRISE_AI_PROVIDER`: proveedor compatible con OpenAI del rol empresarial.
- `ENTERPRISE_AI_BASE_URL`: base URL del proveedor, por ejemplo `https://api.openai.com/v1`.
- `ENTERPRISE_AI_MODEL`: identificador exacto del modelo empresarial y visual, `gpt-6-luna`.
- `ENTERPRISE_AI_REASONING_EFFORT`: esfuerzo del modelo empresarial; inicialmente `high`.

### Conflictos del checkpoint empresarial

Los cambios concurrentes se reconcilian mediante CAS en D1: si otro turno
actualizó la sesión, el handler vuelve a cargar el checkpoint y reclasifica
el mensaje original contra los datos actuales (hasta seis intentos en total).
Esto opera entre requests e instancias, sin un bloqueo local en memoria.
No impone un orden FIFO global; dos cambios incompatibles al mismo campo
pueden necesitar revisión del resumen.

El reintento se permite únicamente antes de intentar envíos WhatsApp,
mutaciones de documentos, selección de empresa o mutaciones FacturaYa.
Tras una importación/emisión o un envío, un conflicto no repite la operación:
se pide verificar el resumen. Un resultado incierto nunca autoriza otra emisión.
La escritura condicional conserva el aislamiento tenant/contacto/rol y el
botón sigue asociado a la revisión vigente. Los eventos de checkpoint incluyen
un ID de turno aleatorio, intento y razón `conflict` o `storage_error`; no
incluyen mensajes, teléfonos, documentos ni errores SQL sin filtrar.

### Imágenes de WhatsApp

El análisis visual usa exclusivamente OpenAI `gpt-6-luna`; se retiró
`GROQ_VISION_MODEL` y no hay fallback a Qwen. El Worker descarga la imagen de
Meta y envía a Luna los bytes como data URL junto con el texto adjunto,
con detalle `high`, razonamiento `low` y un presupuesto de 4.000 tokens.
Admite JPEG, PNG y WebP de hasta 8 MB. La extracción conserva nombres,
documentos, cantidades y precios legibles, distinguiendo cliente y emisor.

Para conservar la compatibilidad con los otros roles, Luna produce un contexto
visual textual limitado a 6.000 caracteres que se entrega al handler activo.
En facturación, Luna interpreta ese contexto junto con el checkpoint; siguen
siendo dos llamadas a Luna, no una sola llamada multimodal del rol. La imagen
base64 no se guarda en el historial ni en el checkpoint. Si el análisis falla,
no se invoca Qwen: se usa únicamente el texto adjunto si existe, o se pide
reenviar la imagen con una explicación. Groq se mantiene para audio y los
roles de texto que ya lo usaban. La imagen nunca autoriza la emisión fiscal:
esta sigue requiriendo el botón `Crear` del resumen vigente.
- `VPS_BRIDGE_API_URL`: URL HTTPS privada publicada por Caddy para el puente de Manolo.
- `STORE_DESIGN_API_URL`: URL de la API privada de la tienda, normalmente `https://tienda-virtual-swart.vercel.app/api/internal/store-design`.

El rol `store-designer` mantiene el diseño activo de cada contacto en D1. Envía la idea actual (texto o audio ya transcrito) a la API privada de la tienda para crear o revisar una propuesta. Las revisiones reutilizan el `designId` y el `accessToken` guardados en el estado del contacto; una frase como `nueva propuesta` inicia otro diseño. Después de enviar la imagen, muestra botones interactivos para modificar, iniciar otra propuesta o recuperar el enlace. Las respuestas `button_reply` se procesan en el mismo webhook y no requieren una ruta adicional.

El secreto `STORE_DESIGN_API_SECRET` debe ser exactamente el mismo en Cloudflare y Vercel. La petición Worker → Vercel se firma con HMAC-SHA256 y una marca de tiempo; la API rechaza firmas inválidas o con más de cinco minutos de diferencia. El secreto nunca se envía al navegador ni se registra.

Para producción se cargan de manera interactiva, sin pasarlos como argumentos ni imprimirlos:

```bash
npx wrangler secret list --env production
npx wrangler secret put WHATSAPP_VERIFY_TOKEN --env production
npx wrangler secret put META_APP_SECRET --env production
npx wrangler secret put META_ACCESS_TOKEN --env production
npx wrangler secret put GROQ_API_KEY --env production
npx wrangler secret put OPENAI_API_KEY --env production
npx wrangler secret put VPS_BRIDGE_HMAC_SECRET --env production
```

El VPS usa tres valores adicionales que no se cargan en Cloudflare:

- `CREDENTIALS_ENCRYPTION_KEY`: 32 bytes aleatorios en base64 o 64 caracteres hexadecimales; solo existe como `infra/vps/secrets/credentials_encryption_key`.
- `FACTURAYA_BASE_URL`: URL HTTPS no secreta de FacturaYa, configurada en `infra/vps/.env`.
- `PRINT_ADVISOR_DB_PASSWORD`: clave del rol de solo lectura `manolo_advisor_ro` con el que el puente ejecuta el SQL generado por el asesor; solo existe como `infra/vps/secrets/print_advisor_db_password` y la crea `infra/vps/apply-print-advisor-read-only-role.sh`. Sin ella el puente no arranca.

Para generar la llave maestra en el VPS sin imprimirla:

```bash
umask 077
openssl rand -base64 32 > /opt/manolo-platform/infra/vps/secrets/credentials_encryption_key
chown 1000:1000 /opt/manolo-platform/infra/vps/secrets/credentials_encryption_key
chmod 600 /opt/manolo-platform/infra/vps/secrets/credentials_encryption_key
```

Después edita `wrangler.jsonc` y reemplaza los valores vacíos de `WHATSAPP_PHONE_NUMBER_ID` y `META_GRAPH_API_VERSION` dentro de `env.production.vars`. No pongas el token de acceso en ese archivo: debe permanecer como secreto.

## Uso real: escribir “hola” y recibir respuesta

1. En Meta WhatsApp > API Setup copia el `Phone Number ID` y la versión de Graph API.
2. Coloca ambos valores en `env.production.vars` de `wrangler.jsonc`.
3. Carga `META_ACCESS_TOKEN` con el comando anterior. Para producción conviene usar un system user token con los permisos `whatsapp_business_management` y `whatsapp_business_messaging`.
4. Crea una clave en [Groq Console](https://console.groq.com/keys) y cárgala con `npx wrangler secret put GROQ_API_KEY --env production`.
5. Despliega con `npm run deploy`.
6. En Meta Developers > WhatsApp > Configuration confirma el callback y suscribe `messages`.
7. Desde un teléfono autorizado, escribe `hola` al número de WhatsApp configurado. Meta enviará el evento al Worker, el rol activo generará la respuesta y el Worker la enviará de vuelta.

Para habilitar el diseñador de la tienda, asigna `store-designer` al contacto desde `npm run users:tui` → `[A]signar rol`. El primer mensaje con una idea crea una propuesta y devuelve un enlace. Los mensajes siguientes modifican esa propuesta mientras el contacto conserve el rol y su estado; `nueva propuesta` o `otro diseño` empieza una propuesta independiente.

Meta debe tener registrado únicamente `https://<worker>.workers.dev/webhooks/whatsapp`. La ruta antigua de Vercel `/api/whatsapp/webhook` está desactivada y responde `410 Gone`; Vercel solo expone la API privada firmada para que la invoque el Worker.

El historial se guarda en D1 y los roles conversacionales pueden usar una ventana de mensajes anteriores. `print-advisor` utiliza esa ventana para dar contexto a preguntas de seguimiento. Las claves de los proveedores se envían desde el Worker directamente a sus APIs; no se incluyen en el repositorio ni en los logs.

Para observar el flujo sin mostrar secretos ni contenido de mensajes:

```bash
npx wrangler tail --env production
```

Deberías ver los eventos `whatsapp_webhook_received` y, si Graph API aceptó el envío, `whatsapp_reply_sent`.

## Pruebas y despliegue

```bash
npm test
npm run test:watch
npm run typecheck
npm run cf-typegen
npx wrangler deploy --dry-run --env production
npm run deploy
```

El Worker se despliega como `whatsapp-webhook-meta-production` en `workers.dev` cuando la cuenta tiene habilitado un subdominio workers.dev.

## Ejemplos curl

Health check:

```bash
curl https://<worker>.workers.dev/health
```

Verificación de Meta:

```bash
curl "https://<worker>.workers.dev/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<WHATSAPP_VERIFY_TOKEN>&hub.challenge=challenge-123"
```

POST firmado local. El valor de `META_APP_SECRET` debe mantenerse en una variable local segura; la firma debe calcularse sobre el cuerpo exacto que se envía:

```bash
BODY='{"object":"whatsapp_business_account","entry":[]}'
SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$META_APP_SECRET" -hex | sed 's/^.* //')
curl -X POST http://localhost:8787/webhooks/whatsapp \
  -H 'Content-Type: application/json' \
  -H "X-Hub-Signature-256: sha256=$SIGNATURE" \
  --data-binary "$BODY"
```

En Windows se puede usar `curl.exe`; para probar producción sustituye la URL local por la URL pública.

## Configuración en Meta Developers

1. Abre tu aplicación en Meta Developers y entra en WhatsApp > Configuration.
2. Usa como Callback URL: `https://<worker>.workers.dev/webhooks/whatsapp`.
3. Usa como Verify Token exactamente el valor de `WHATSAPP_VERIFY_TOKEN` cargado en producción.
4. Guarda y verifica el webhook; Meta debe recibir el `hub.challenge` como texto plano.
5. Suscribe el campo `messages` para recibir mensajes entrantes y actualizaciones de estado relacionadas con mensajes. Los cambios adicionales disponibles para tu cuenta pueden suscribirse cuando agregues procesamiento específico.
6. Confirma que la aplicación esté suscrita a tu WABA. En Meta suele aparecer como `Subscribe` o `Manage` dentro de la configuración de WhatsApp. La API oficial usa `POST /<WABA-ID>/subscribed_apps`; sin esa suscripción, los eventos de los teléfonos de la cuenta no llegan al callback.

## Si el tail está vacío

Usa el nombre explícito del Worker para no observar otro entorno:

```bash
npx wrangler tail whatsapp-webhook-meta-production --format pretty
```

Con el tail abierto, vuelve a guardar/verificar el webhook en Meta y después envía `hola` desde el teléfono autorizado al número de prueba. Esta versión registra eventos seguros como `whatsapp_verification_succeeded`, `whatsapp_webhook_received`, `whatsapp_webhook_rejected` y `whatsapp_reply_sent`; nunca registra el token, el teléfono ni el contenido del mensaje.

No configures un dominio personalizado en este proyecto: el despliegue inicial usa `workers.dev`.

## Integración RADAR (implementación local 2026-10-18)

`src/radar/` añade la API autenticada `/v1/projects/radar/*` y procesa comandos
de vinculación/baja en el webhook existente, después de verificar Meta y antes
del despacho por rol. No cambia roles ni crea otro webhook. La migración D1
`0014_radar_notifications.sql` queda desactivada por defecto; fue aplicada y
habilitada en producción con autorización el 2026-10-18, versión
`02e3ea4b-da57-47ba-b73d-4ecb4fe8f849`. El envío real sigue pendiente de vínculo.
Secretos: los mismos `META_APP_SECRET` y
`META_ACCESS_TOKEN` del Worker, nunca distribuidos al escritorio.

Contrato, límites, consentimiento, activación y rollback:
[RADAR WhatsApp API](../../docs/apps/radar-whatsapp-api.md).
