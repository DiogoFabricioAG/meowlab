# Alertas y seguimiento conversacional RADAR

## Entidad y Ver detalle — 2026-11-04

El aviso inicial incluye Entidad desde el comprador publicado, sin delegar su
identidad a la IA. Los botones nuevos son Me interesa, Ver detalle y Descartar,
con acción `detail`. `summary` e `info` anteriores siguen admitidos y muestran
el detalle ampliado del delivery seleccionado. Las consultas no modifican interés.

El detalle presenta hechos del contexto público: productos y cantidades/unidades,
fechas por etapa en Perú, monto, documentos disponibles y ficha SEACE completa.
No solicita a la IA otro resumen del título. Los datos ausentes quedan por
confirmar; los requisitos y entrega se verifican en las bases. Hasta cinco ítems
y dos documentos, indicando más en la ficha. Se preservan descripciones completas
dentro de 3400 caracteres mediante reducción del número de ítems; si una partida
repite toda la nomenclatura, se conserva su cláusula literal de compra.

Se responde con un único texto, conservando URLs completas en vez de recortarlo
a 1024 caracteres. Los botones del mensaje original siguen disponibles; el
detalle invita a usarlos o preguntar por un ítem. Se conserva la memoria del
delivery para continuar. El aviso inicial sigue siendo interactivo y respeta
1024 caracteres: preserva entidad/hechos/objeto y omite finalidad opcional si
es necesario. Una cache rechazada del formato anterior se compone de nuevo;
no se reenvían aceptados/inciertos. Sin migraciones o cambios de permisos/cron.

Actualización publicada como corrección del formato aprobado: activo
`158b52bc-e20a-4a8f-ae31-92e64f3fdbef` al 100 % sobre `c47e5613`. 300 pruebas,
typecheck, 90 pruebas aisladas y dry-run correctos. Snapshot real conservado,
composición reversible y configuración/compatibilidad/salud/cron verificados.
Paquete privado en `backups/radar-detail-20261104/release`, generado por
`tools/prepare-radar-detail-release.mjs`. Sin migraciones ni envío manual adicional.

## Edición con IA antes del envío — activo 2026-11-04

Los avisos iniciales ahora requieren un resumen válido antes de Meta. La IA
devuelve JSON estructurado con qué necesitan, para qué y citas literales de
objeto/ítems que apoyen ambas frases. Se permiten paráfrasis, conservando anclaje
al producto y validación de citas, tipos, cifras y formato. Ocho segundos de
presupuesto; no se envía el título oficial recortado ante fallo. La ausencia de
finalidad explícita omite ese bloque.

`/alerts` conserva el pendiente con HTTP 503 `composition_pending`, sin consumo
de pacing por envío y con reserva rechazada reintentable. Una cache de título
legada en un intento rechazado se sustituye sólo mientras exista una reserva
actual `sending`; los aceptados/inciertos conservan su deduplicación. El preview
compone antes de reservar para no consumir su envío único por un fallo de IA.
«Ver resumen» no usa el título como respaldo si falla la explicación.

Fechas, montos, botones, fuente y evidencias permanecen bajo los contratos
existentes. La IA no recibe perfil privado, OCID, credenciales, montos o fechas
para redactar esos campos. La validación de citas y vocabulario no demuestra por
sí sola equivalencia semántica: no se acredita cumplimiento ni reemplaza bases.

Paquete preparado en `backups/radar-editorial-20261104/release`, sobre el bundle
real `d1ab0df4`, con dos sustituciones reversibles de composición. Conserva el
cron y recordatorio ya activos. Sin migración ni cambio de callback o credenciales.
Prueba pública con GPT-6 Luna real correcta, sin WhatsApp durante esa prueba.
Publicado con autorización como `c47e5613-493e-4b5b-ad62-cc0d3b250ec5` al 100 %,
con salud, bindings, compatibilidad y cron comprobados. 295 pruebas del Worker,
typecheck, 85 aisladas y deploy en seco correctos.

El usuario autorizó un mensaje nuevo con el formato. Se seleccionó una oportunidad
vigente en SQLite que no tenía un delivery previo aceptado/incierto:
`ocds-dgv273-seacev3-1259952`, `LP-ABR-298-2026-GR PUNO/OC-1`, tabiquería de
fibrocemento y lana de vidrio con instalación. La ficha específica y la fecha de
registro estaban en la evidencia local. `/alerts` produjo el resumen IA, publicó
el snapshot bajo la autorización RADAR existente y Meta aceptó el primer intento;
el webhook confirmó `delivered`. No se modificaron destinatarios ni se usaron
previews, excepciones de pacing o reenvíos de avisos anteriores. Evidencia privada
en `backups/radar-editorial-20261104/manual-send-receipt.json`.

## Resumen legible por bloques — 2026-11-01

Activo `35d4c8bb-27a6-4cb7-a704-f5092f0a3834`. «Ver resumen» y el botón
antiguo «Saber más» separan Qué compran, Cantidad, Entidad, Fechas clave y Monto.
La IA redacta sólo el objeto/finalidad en un máximo de 240 caracteres; el
renderizador compone cantidades, unidades, fechas y monto desde hechos validados.
Sin unidad conocida lo indica, sin inferirla. Se conservan etapas separadas,
espacio entre bloques y fuente completa dentro de 1024 caracteres. Se retiran
marcadores de la prosa IA y las negritas usan `*texto*` de WhatsApp. El respaldo
sin IA usa el mismo formato. Sin cambios al intervalo de envío o selección.

271 pruebas/33 archivos, typecheck; 61/6 del paquete aislado y dry-run. Publicado
sustituyendo sólo la composición del handler RADAR sobre el bundle real
`10a50d2f`, con configuración preservada y sin mensajes reales de prueba.

## Alertas distribuidas y fuente SEACE — 2026-11-01

Activo Worker `10a50d2f-48c1-4718-9574-ca307b90d904`. Los avisos automáticos
se reservan atómicamente en el historial D1 por número de negocio y destinatario:
uno cada 30 minutos, entre 08:00 y 20:00 de Perú. Incluye reservas inciertas,
no replays. La restricción abarca instalaciones distintas y clientes antiguos.
Fuera de turno, `/alerts` devuelve HTTP 429 con `{status:"deferred",retryAt}`;
no reserva ni llama IA/Meta. El cliente conserva el pendiente, revalida vigencia
y espera, sin recuperar horarios perdidos de golpe. No requiere migración.
Consentimiento y ventana de 24 horas siguen siendo requisitos independientes.

«Ver resumen» y el botón antiguo «Saber más» adjuntan siempre la ficha SEACE
verificada del aviso seleccionado, con presupuesto reservado en los 1024
caracteres. Si falta ficha, se indica que está pendiente y se ofrece el buscador
oficial con la nomenclatura. La URL no depende de generación IA. Las respuestas
solicitadas y la selección durable no están sujetas al intervalo automático.

Validación: 268 pruebas del Worker, typecheck, 58 del paquete aislado, dry-run
y salud remota. No se enviaron mensajes de prueba al contacto.

Estado previo 2026-11-01: publicado con autorización del usuario. Worker
`45b386f5-2a61-43c5-9c00-f44264bf9548`, con selección durable, contexto documental y proveedor IA
propio de RADAR. Mantiene botones contextuales y pruebas por
formato. La activación inicial fue `6034ee6c`; D1 0015, 0016 y 0017 aplicadas
tras respaldo. La prueba explícita del formato con botones fue aceptada por
Meta para el contacto vinculado; se conservó la prueba de texto anterior.
Prueba real Warmi Ñan aceptada por Meta, con resumen IA validado. El callback
de lectura anterior pertenece al aviso original, no acredita lectura del preview.

## Comportamiento

### Corrección del seguimiento y contexto público — 2026-10-31

El rol heredaba el proveedor/modelo por defecto del tenant, distinto al de los
avisos. Ahora la composición aplica a RADAR el proveedor/modelo configurado para
los resúmenes, esfuerzo bajo y presupuesto de 1600 tokens. La causa exacta del
fallo anterior del proveedor no quedó en los logs: el callback ocultaba sus
metadatos; se conservan ahora razón, estado y código seguros, nunca contenido.

`POST /alerts` admite `evidence` opcional: ficha SEACE exacta, instante de
observación, hasta 20 ítems públicos, seis documentos oficiales y fechas de
registro/ofertas etiquetadas. Se valida dominio, ruta, identidad del proceso,
cantidades y límites. El escritorio lo construye desde SQLite; el Worker no
consulta OECE ni recibe el perfil privado. El contexto es una observación del
registro, no prueba de lectura de las bases ni de una búsqueda en tiempo real.

La evidencia se conserva dentro de `radar_alert_context.facts_json`, con el TTL
existente. Su hash se mantiene separado de los siete campos originales del aviso.
Un replay exacto aceptado puede completar la evidencia sólo para su instalación,
sin reenviar, prolongar retención o ventana; una observación vieja no sustituye
una más reciente. No requiere migración. Contextos vencidos no se reabren.

Si falla IA, cada acción tiene su propia respuesta factual: resumen y etapas,
productos/cantidades o orientación de capacidad. Fuente usa la ficha y bases
integradas de la evidencia, sin IA. Sin evidencia específica se explica la falta
de ficha; el buscador nunca se presenta como enlace al proceso. Los enlaces a
documentos no se tratan como contenido leído, ni se inventan tallas/materiales.

La ficha Warmi Ñan se consultó desde la conexión del usuario con respuesta 200,
identidad/nomenclatura coincidentes, un ítem de 5856 unidades y tres documentos.
Registro hasta 3/11/2026 23:59; ofertas hasta 4/11/2026 23:59, hora Perú. Se
completó el contexto mediante replay `accepted`, sin nuevo mensaje.
244 pruebas del Worker, 41 aisladas, typecheck y dry-run correctos. Desktop:
32 pruebas, typecheck y build local. Publicación verificada con bindings intactos;
el siguiente clic humano deberá comprobar la respuesta real. Generador:
`tools/prepare-radar-followup-fix-release.mjs`. Sin cambios a cron o asignaciones.

### Botones de seguimiento

Los avisos nuevos se envían como mensajes interactivos, con tres respuestas:
**Me interesa**, **Ver resumen** y **Descartar**. La selección se conserva en PG
para sincronizar con Guardadas; [contrato](radar-selection-sync.md). Los IDs
anteriores de información/productos/evaluación/fuente siguen siendo válidos.
Se respeta el formato de
[reply buttons de Meta](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/interactive/).

Cada ID contiene la entrega, nunca el teléfono ni secretos. Al pulsar, el rol
resuelve esa entrega aceptada con los límites de tenant, contacto, canal,
consentimiento y TTL existentes. No usa simplemente el aviso más reciente.
El proceso elegido se conserva en la memoria RADAR para las respuestas escritas
posteriores. Cambiar de aviso mediante otro botón descarta el historial del
proceso anterior. Un botón inválido, ajeno o vencido no llama IA ni abre otra
convocatoria. Los duplicados entrantes siguen sin generar respuestas.

Productos distingue el objeto conocido de cantidades y especificaciones todavía
no disponibles; evaluación pide capacidad de abastecimiento sin acreditar
requisitos ni márgenes. La fuente se devuelve directamente desde los datos
validados, sin generación IA. No se crean cotizaciones ni seguimientos automáticos
al pulsar un botón. La respuesta interactiva real entra por el webhook firmado
y renueva la ventana igual que un mensaje del usuario. Un fallo al enviar botones
no dispara otro mensaje de confirmación fiscal ni un reintento incierto.

Los avisos ya enviados permanecen como llegaron. Los botones aparecerán en las
próximas alertas y respuestas de seguimiento que tengan contexto vigente.

Validación de botones: 241 pruebas locales/28 archivos, typecheck, 38 pruebas
del paquete aislado y dry-run Wrangler 4.156.0. Webhook firmado y normalización
de `button_reply` probados con el Worker real; selección de alerta anterior,
continuación escrita, fuente, TTL y aislamiento probados. Versión publicada y
salud verificadas, bindings/variables sin diferencias. No requiere migraciones
ni modifica horarios, contactos o el preview ya consumido. No se envió otra
demostración ni se afirma haber probado un clic humano en WhatsApp.
Generador: `tools/prepare-radar-buttons-release.mjs`, patch reversible sobre
`6034ee6c`. Rollback de esta extensión a esa versión conserva contexto y memoria.

El escritorio selecciona las convocatorias compatibles y envía el mismo contrato
autenticado de alertas. El Worker utiliza `AiRadarAlertWriter` con el proveedor,
modelo y credenciales ya configurados en MeowLab para resumir objeto y comprador.
No transmite el perfil del negocio, SQLite, precios privados ni historial fiscal
al redactor. Sin esos datos no afirma una afinidad personal ni rentabilidad.

La frase generada es breve y se valida: no añade cifras, enlaces, productos,
entidades o promesas de cumplimiento/adjudicación. Usa vocabulario del objeto y
comprador y conectores limitados. Fechas, zona America/Lima y montos conocidos
se presentan de forma determinista, no se calculan mediante IA. Los montos sin
confirmar se omiten del aviso. No aparecen OCID, ISO ni enlaces extensos en el
aviso; la fuente y nomenclatura siguen disponibles para una pregunta posterior.

Con proveedor ausente, error, demora superior a cuatro segundos o texto inválido,
se envía un resumen corto derivado del objeto oficial. Es una degradación
explícita, no se acredita que todos los avisos hayan sido redactados con IA.

El cierre invita a una conversación útil: «¿Te interesa? Cuéntame qué quieres
revisar de esta oportunidad». El rol recibe el último aviso aceptado para
entender respuestas como «me interesa». Puede orientar sobre los datos conocidos;
no afirma leer bases o buscar precios que no tiene. La verificación de nuevos
documentos, búsqueda y precios continúa en el escritorio.

## Estado y límites

- D1 `radar_alert_context`: datos públicos de la convocatoria y texto preparado
  por entrega; acceso hasta 48 horas desde su preparación/envío. Se ignoran los
  contextos vencidos y se purgan en posteriores escrituras. No se agregan datos
  del negocio privado del escritorio.
- `contact_role_states`, clave `radar`: últimos ocho mensajes acotados, TTL lógico
  de 24 horas y canal, aislados por tenant/contacto/rol. Usa CAS si el repositorio
  lo ofrece; el runtime desplegado antiguo conserva el guardado básico bajo la
  serialización del DO. Un conflicto no sobrescribe memoria concurrente.
- Ningún historial de FacturaYa se entrega al modelo. Duplicados persistidos o
  el mismo ID ya atendido no generan una nueva respuesta.
- El contexto nuevo no se ofrece a otro tenant/contacto ni tras revocación.
  Sólo refleja una alerta `accepted`, no una preparación fallida o incierta.
- La ventana de WhatsApp sigue bajo la autoridad del webhook firmado: la renueva
  únicamente un mensaje real del usuario. Generación, memoria, replays, mensajes
  salientes y callbacks no la extienden. No se añaden pings ni cambios de horario.

## Idempotencia y compatibilidad

El hash de idempotencia conserva los datos originales de la alerta. El texto se
prepara una vez y se reutiliza tras rechazo definitivo; una incertidumbre no
habilita otra entrega. Se revalidan consentimiento y reloj después de generar
el texto, justo antes de Meta.

Un replay autenticado del mismo payload de una alerta aceptada anterior al
upgrade puede incorporar sus datos públicos al contexto sin enviar nada. Conserva
la fecha original, no renueva retención ni ventana y no reconstruye falsamente el
texto legado. Tras 48 horas no reabre ese contexto. Un hash distinto se rechaza.

Se admiten las fichas oficiales SEACE usadas por el escritorio, con dominio,
ruta y procedimiento numérico coincidentes con el OCID. El servidor no afirma
haber consultado ni verificado el expediente; esa evidencia corresponde al
escritorio. Continúan válidos los buscadores oficiales y fichas OCDS permitidos.

## Envío de prueba explícito

`POST /v1/projects/radar/alerts/preview` usa el mismo bearer y payload de una
alerta ya aceptada de esa instalación. Requiere hash exacto, consentimiento y
ventana abierta, revalidada tras IA. D1 `radar_alert_preview_versions` reserva una
sola prueba por entrega original y formato fijado por servidor (`buttons-v1`),
y conserva texto, origen IA/fallback y resultado. El cliente no elige el formato
ni puede crear claves arbitrarias para repetir. D1 0017 copia el historial de
texto con formato `text-v1`; `radar_alert_previews` queda intacto para rollback.
No reintenta rechazos ni incertidumbres; no modifica la deduplicación original.
Límite adicional: tres pruebas por instalación/hora. El cron no usa esta ruta.
Los callbacks actuales sólo reconcilian entregas automáticas: el preview registra
aceptación Meta, sin atribuirse confirmación de entrega o lectura.

Prueba explícita con botones 2026-10-31: 38 pruebas específicas y 38 del paquete
aislado, typecheck, dry-run y migración sobre respaldo poblado correctos.
Versión `5379829d` publicada; salud y bindings preservados. Una solicitud real
de preview fue `accepted`, `replayed:false`; no se borraron registros ni se
alteraron cron, roles o ventanas. Generador:
`tools/prepare-radar-preview-versions-release.mjs`. La migración es aditiva y
preserva el ledger anterior; rollback de código a `31f4d3ad` lo sigue usando.

## Entrega activada

- Migración: `migrations/0015_radar_alert_context.sql`, sólo tabla e índice nuevos.
  Probada desde esquema vacío y esquema previo poblado, con integridad y claves
  foráneas correctas y entregas anteriores conservadas.
- Generador: `tools/prepare-radar-dialogue-release.mjs`, sobre el bundle real de
  producción. Patch reversible en tres puntos de composición; conserva roles
  ajenos, ráfagas, variables y bindings. Paquete privado bajo
  `backups/radar-dialogue-20261031/`.
- Migración adicional: `0016_radar_alert_previews.sql`, registro separado de pruebas.
- Validación: 237 pruebas locales, typecheck, 34 del paquete aislado y dry-run
  Wrangler 4.156.0. Incluye IA simulada, Worker real, respuesta «me interesa»,
  expiración, revocación durante generación, aislamiento, replays y ausencia de
  renovación de ventana por mensajes salientes.
- Publicadas D1 0015/0016 y versión indicada; bindings y variables comparados
  con snapshot de producción, sin diferencias. D1 0013 sigue sin aplicarse.
- La prueba autorizada de chalecos fue `accepted`, composición `ai`, con ID Meta.
  El replay exacto previo sólo incorporó contexto público del aviso legado,
  conservando su fecha, estado `accepted` y lectura original. No cambió el cron.

## Operación y rollback

Activación realizada: baseline verificado, respaldo privado D1, aplicación
exclusiva de 0015/0016 con registro de migración y publicación aislada. Salud y
estado autenticado correctos; ventana abierta comprobada antes de la prueba.
El seguimiento con una respuesta real del usuario queda por comprobar.

El Worker anterior ignora la tabla nueva: rollback de código a `ddb238b3` conserva
las autorizaciones y entregas. No borrar la deduplicación, contactos, tabla de
ventanas o memoria fiscal. La memoria `radar` y el contexto tienen TTL independiente
del permiso de envío; no utilizar esos TTL como autorización WhatsApp.
