# Estado del proyecto

## Landing: compresión de imágenes a WebP — publicado 2026-11-12

Landing desplegada en el VPS (`meowlab-web:d7cf736da0ea` desde `d7cf736`). 14 imágenes
rasterizadas convertidas a WebP (Q88) y 3 variantes para fondo claro en WebP transparente,
sustituyendo envoltorios SVG con base64 de 600 KB. Componentes actualizados con dimensiones
explícitas y decoding asíncrono. Reducción de carga de imágenes en la home de 3.79 MB a 0.40 MB
(89.4%). Dominio principal, rutas secundarias y servicios vecinos (portal, RADAR, FacturaYa)
verificados con HTTP/2 200.
[Acta de despliegue y rollback](../operations/landing-webp-despliegue-2026-11-12.md).


## Manolo: guía semántica y ubigeos por nombre — publicado 2026-11-06

Worker `b82f74d9` al 100%. Luna interpreta fechas, peso y ubicaciones de GRE;
las preguntas se agrupan por tema y se conservan entre turnos. Catálogo oficial
INEI 2026 de 1.893 distritos para resolver nombres, con aclaración de homónimos.
536 pruebas generales, 439 aisladas, typecheck y dry-run correctos. Runtime
activo idéntico al comprobado; bindings, agrupación, cron y bridge conservados.
Código replicado por SSH, sin migraciones ni emisión fiscal. La inferencia del
modelo se simula en tests; evaluación real pendiente independiente.
[Entrega, catálogo y rollback](../operations/manolo-gre-locations-2026-11-06.md).

## Manolo: interpretación semántica — publicado 2026-11-06

Worker `8fa4bcb6` al100%. Luna interpreta campos normalizados y su procedencia
en el contrato semántico; sin reinterpretación léxica posterior de ese contrato.
Preguntas específicas persistidas y recuperación desde mensajes del usuario.
526 pruebas generales, 429 aisladas y typecheck/dry-run correctos; runtime activo
idéntico, configuración conservada y bridge saludable sin cambios. La prueba de
inferencia con clave local respondió401; no sustituye evaluación real del modelo.
[Entrega y rollback](../operations/manolo-semantic-state-2026-11-06.md) y
[ADR-0005](../decisions/0005-modelo-interpreta-facturacion.md).

## Manolo: importes y respuestas persistidas — publicado 2026-11-06

Worker `c4ffeab5` al100%, bridge conservado saludable. Normaliza formatos monetarios
de usuario, conserva el saldo válido ante rechazos y registra resultados por campo
de pago. Las respuestas de facturación se construyen desde el checkpoint guardado;
no confirman propuestas del modelo como datos persistidos. 518 pruebas generales,
421 del paquete final, typecheck/dry-run correctos y runtime activo idéntico.
[Entrega y rollback](../operations/manolo-money-state-2026-11-06.md).

## Manolo: memoria y selección GRE — publicado 2026-11-06

Worker `173dde02` al100%, bridge `gre-fixes-20261106` saludable. Corrige fase
heredada de factura, conserva GRE entre turnos, excluye facturas con NC aceptadas
y precarga bienes/cantidades. Páginas con botones y pendientes formateados.
403 pruebas aisladas, typecheck/build/dry-run correctos; runtime idéntico y
configuración conservada. Respaldo PostgreSQL restaurado en aislamiento y smoke
HMAC/permisos/replay/RADAR correcto. Sin emisión fiscal, migración ni commit.
[Entrega y rollback](../operations/manolo-gre-fixes-2026-11-06.md).

## Manolo: vencimiento relativo conservado — publicado 2026-11-06

Worker `756ae5a6` al 100%. «Este año» admite el año del turno; emisión y
vencimiento son independientes. Recuperado el vencimiento del borrador reportado
desde evidencia original, sin emisión fiscal. 493 pruebas de trabajo y396
aisladas, typecheck/dry-run correctos; runtime activo idéntico y salud correcta.
[Diagnóstico y rollback](../operations/manolo-date-retention-2026-11-06.md).

## Manolo: Decisions sólo en la entrada — publicado 2026-11-06

Worker `79ffc31d` al 100%: gestiones activas de factura, boleta, anulación y guía pasan a Luna
sin Decisions API intermedio. Fotos/documentos pertenecen al flujo seleccionado;
los controles explícitos y la confirmación por botón se conservan. Respuestas
de avance más cortas y sencillas, sin repetir el inventario guardado. Resúmenes
de revisión completos. 488 pruebas de trabajo y 391 del paquete aislado correctas;
typecheck/dry-run y comparación de runtime activo correctos. Autenticación renovada,
configuración/agrupación conservadas y bridge saludable sin reinicio.
[Entrega y rollback](../operations/manolo-entry-routing-2026-11-06.md).

## Manolo: pago ?nico a cr?dito ? publicado 2026-11-06

Worker `8c75c490` al 100%, bridge fiscal conservado. Conserva vencimiento completo
sin importe y resuelve el pago ?nico desde el total can?nico del borrador; emisi?n
y vencimiento son independientes. 385 pruebas aisladas, typecheck y dry-run
correctos. Borrador reportado recuperado con emisi?n 05/11/2026 y vencimiento
06/12/2026, sin emisi?n fiscal. [Entrega y rollback](../operations/manolo-single-payment-2026-11-06.md).

## Manolo: texto e imágenes agrupados — publicado 2026-11-06

Worker `b5f73411` al100% sobre `85802e7f`; bridge fiscal conservado. Fotos y
textos contiguos comparten tres segundos de silencio y un turno, hasta tres
imágenes; cada foto se analiza antes del rol y conserva su original/ID. El pedido
de crear con RUC/pago/datos ya no se descarta como revisión; usa campos visuales
legibles para el borrador. Un error visual no elimina texto y sólo el botón vigente
autoriza emisión. 375 pruebas del paquete aislado, suite amplia471 y typecheck
correctos; sin migración, commit, emisión real ni cambios de permisos/secretos.
Configuración/namespace, ráfagas y cron preservados. [ADR-0004](../decisions/0004-rafagas-texto-imagen.md)
y [entrega/rollback](../operations/manolo-multimodal-2026-11-06.md).

## Manolo: revisión de anulación conserva motivo — publicado 2026-11-06

Worker `85802e7f` al100%, bridge fiscal conservado. Pedir el resumen no ejecuta
extracción ni reemplaza motivo/código/fecha; revisión renueva metadatos/botón.
Una nota ya procesada se consulta sin habilitar otra confirmación. 342 pruebas
aisladas, 114 focales, typecheck y dry-run correctos; sin migración, commit,
emisión ni reenvío fiscal. Se encontró una nota ya aceptada en FacturaYa y se
conservó su estado, sin restaurar sobre ella el borrador anterior.
[Causa, entrega y rollback](../operations/manolo-credit-summary-2026-11-06.md).

## Manolo: permiso de anulación y recuperación corregidos — 2026-11-06

Activo Worker `0bedb1c8` al100% sobre `a768ba36`; bridge fiscal saludable conservado.
Rechazo `forbidden` confirmado antes de llamar a FacturaYa: faltaba
`create_credit_note`, con empresa/integración/sesión activas. Permiso añadido
sólo a la membresía afectada con autorización expresa. Menú y confirmación
validan permisos; rechazo concluyente invalida botón y exige nueva revisión,
mientras una respuesta incierta sigue bloqueada. Checkpoint puntual recuperado
por CAS tras cotejar digest del payload rechazado y cero auditorías; sin reenvío
ni anulación fiscal. 334 pruebas aisladas, typecheck/dry-run y salud correctos;
código activo igual al probado, configuración/ráfagas/cron preservados.
[Diagnóstico, evidencia y rollback](../operations/manolo-credit-permission-2026-11-06.md).

## Manolo: intención primero y seguimiento publicados — 2026-11-06

Worker `a768ba36-12c1-4024-8b26-11d7bda4df45` al 100 %, sobre `4ceeaa93`.
Saludos con tres botones, pedidos claros directos, acciones secundarias,
anulación con revisión/botón y seguimiento Sí/No tras PDF/finalización activos.
330 pruebas aisladas/21 archivos, typecheck y dry-run correctos. Código activo
idéntico al artefacto probado; salud 200, bindings/secretos/variables,
compatibilidad, cron quince minutos y ráfagas preservados. Bridge fiscal
`84ee1c65` saludable y sin reinicio; smoke público HMAC/permisos/replay correcto,
cero llamadas de proveedor o emisiones reales. Copia privada verificada por
`ssh meowlab` en `/opt/manolo-platform/releases/intent-20261106`.
Sin migraciones ni commit. [Evidencia y rollback](../operations/manolo-intent-2026-11-06.md).

## Manolo: intención primero y seguimiento — preparado localmente 2026-11-06

Decisions API enruta el texto actual antes de responder desde el comprobante
anterior. Saludos/ambigüedad muestran Generar Factura, Generar Boleta y Otras
opciones; pedidos claros van directo al flujo conservando los datos aportados.
La lista secundaria consulta borradores, prepara anulación con resumen/botón,
abre GRE o cambia empresa. Tras entregar PDF o terminar otra gestión, Sí/No
permite volver al menú o cerrar cordialmente. Botones ligados a revisión/contacto,
aislamiento entre empresas y protección de operaciones inciertas conservados.
Contrato Decisions corregido a opciones objeto; respaldo conservador y logs
sin texto del usuario. Sin migraciones, commit, despliegue ni emisión real.
Typecheck y 147 pruebas focales correctos; suite completa 451/453: sólo dos
fallos RADAR por reloj real ya registrados. Verificación final detallada en la
tarea `manolo-intent-first-navigation` del tablero.
La versión publicada sigue siendo `4ceeaa93` y bridge `fiscal-20261105`.
[Flujo](../../apps/manolo-whatsapp-worker/README.md#navegación-por-intención--2026-11-06).

## Manolo: crédito y flujo GRE publicados — 2026-11-05 Lima / 2026-11-06 UTC

Worker `4ceeaa93-b19e-41b5-b864-bdeb046a2f42` al 100 %, sobre `158b52bc`.
Bridge `fiscal-20261105`, imagen `84ee1c65`, saludable. Publicados tras señal de
backend FacturaYa listo, con paquete aislado de tres anchors Worker y dos bridge;
no se reconstruyó el entrypoint sucio. 282 pruebas aisladas, typecheck y dry-run
correctos. Contenido activo idéntico al dry-run; bindings, secretos, variables,
compatibilidad, cron quince minutos y ráfagas activas preservados.
Respaldo PostgreSQL restaurado en contenedor aislado (37 tablas); export D1
restaurado en SQLite (26 tablas, integridad correcta). Imagen y versión previas
conservadas. Smoke público del bridge: salud, RADAR, HMAC, permisos y replay;
cinco operaciones con actor sintético, cero consultas de proveedor ni emisiones.
La protección de turnos inciertos también bloquea confirmar GRE. No se emitieron
documentos reales ni se modificaron credenciales/correlativos. **GRE real sigue
deshabilitada en FacturaYa**; configuración fiscal, precarga de bienes, PDF/QR y
entrega XML/CDR por WhatsApp pendientes. Sin nueva migración Manolo ni commit.
[Acta y rollback](../operations/manolo-credit-gre-2026-11-05.md).

## Manolo: categoría GRE preguntada primero — 2026-11-05

Preparado localmente, sin activación: M1/L/otra explícita según tarjeta antes
de factura y demás datos; «no sé» bloquea. M1/L omite vehículo y conductor del
payload y declara el indicador en resumen. `other` exige ambos. Cambiar categoría
limpia sus datos/evidencia anteriores e invalida clave, borrador y botón,
conservando el resto de campos. Sólo botones o declaraciones explícitas cambian
categoría: «Laptop M1» y una inicial L del conductor no la modifican. Categoría
incluida en el contrato HMAC/digest; API legacy sin categoría conserva sus
exigencias ordinarias. Sin nueva migración ni cambios al backend por este agente.
Regresión amplia **410/412**, sólo dos fallos RADAR por reloj real; revalidación
focal final, typecheck y build Node correctos. Precarga de bienes total/parcial
queda pendiente de contrato; tampoco se emitió ni desplegó. [Detalle](../apps/manolo-despatch.md).

## Manolo: GRE remitente privada preparada — 2026-11-05

Nuevo flujo dentro de `enterprise-advisor`, sin nuevo rol ni migración Manolo:
factura aceptada elegida por página, datos de traslado explícitos, checkpoint,
borrador inmutable con clave estable y botón vinculado a revisión/digest tras
entregar el resumen completo. Consulta recupera ticket por GET/status sin
reenviar, incluso tras respuesta de emisión perdida; simulación identificada.
Operaciones nuevas recorren el HMAC, permisos y replay existentes. Compatible
con ULID minúsculas de Laravel. Sin emisión real, commit ni despliegue.
157 pruebas focales y typecheck/build Node correctos; suite completa **397/399**,
sólo los dos fallos RADAR por reloj real ya registrados. XML/CDR comprobados por
cliente autenticado, **entrega WhatsApp pendiente**; no hay portal de guías ni
PDF/QR. Backend, migración y configuración administrativa GRE/T001 deben estar
validados antes de una publicación coordinada autorizada. No se anuncia lista
para operar traslados. [Contrato y límites](../apps/manolo-despatch.md).

## Manolo: condiciones de crédito preparadas — 2026-11-05

Facturas preguntan contado/crédito y conservan saldo/cuotas en checkpoint.
Validación decimal exacta, máximo doce cuotas, vencimientos completos posteriores
a emisión y saldo no superior al total. Cambios incompletos también invalidan el
botón; resumen y clic verifican los términos devueltos por FacturaYa. El bridge
valida DTO y el adaptador legacy conserva el contrato multipart acordado.
Sin nueva migración, emisión real, commit ni despliegue. Necesita backend
compatible y publicación posterior de bridge/Worker; no utiliza fiscal-operations.
Regresión local: **358/360** pruebas pasan; las dos restantes son integraciones
RADAR que usan reloj real fuera del horario 08:00–20:00 y reciben `deferred`.
Tarea separada `radar-tests-real-clock`; RADAR no modificado. Las 118 pruebas
de rol/pagos/cliente/multiempresa pasan, typecheck y build Node correctos.
Detalle: [README Manolo](../../apps/manolo-whatsapp-worker/README.md#condiciones-de-pago-preparadas-localmente-2026-11-05).

## RADAR: presencia del equipo preparada — 2026-11-05

Heartbeat Bun independiente de búsquedas SEACE, secuencia persistida y aviso de
cierre; servidor con estado agregado por destinatario, detección de cinco minutos
y cron de cinco minutos. Avisos operativos condicionados a pausa, consentimiento,
rol, ventana y horario, sin afirmar apagado físico ni garantizar oportunidades.
316 pruebas, typecheck, tipos Env del proyecto, 106 pruebas aisladas y dry-run
correctos. Escritorio: 231 pruebas del árbol preparado, typecheck y build.
**No activado**: pendientes respaldo/migración D1 `0019`, publicación aislada y
ejecución del escritorio actualizado. Producción continúa `158b52bc`; no se
reinició la aplicación ni se emitieron señales o mensajes de prueba reales.
[Contrato, activación y rollback](../operations/radar-presence-2026-11-05.md).

## RADAR: entidad y detalle ampliado activos — 2026-11-04

Activo `158b52bc` al 100 % sobre `c47e5613`. El aviso incluye la entidad publicada
y ofrece Ver detalle. Su seguimiento muestra productos, cantidades/unidades,
etapas, monto, documentos y fuente del delivery elegido, en un texto acotado
sin recortar URLs al límite interactivo. Compatible con los botones antiguos
Ver resumen/Saber más; leer no guarda interés. 300 pruebas, typecheck, 90 aisladas,
dry-run y salud correctos; bindings, compatibilidad y cron preservados. Sin
migraciones, cambios de escritorio ni envío manual adicional. Corrección del
formato previamente aprobado.
[Contrato](../apps/radar-conversation.md#entidad-y-ver-detalle--2026-11-04).

## RADAR: avisos editoriales activos — 2026-11-04

La IA debe preparar una explicación breve antes de enviar: qué necesitan y para
qué, con citas de apoyo del objeto/ítems públicos. Se admite paráfrasis y se
retira el respaldo de título recortado. Un fallo deja el aviso pendiente, sin
Meta ni bloqueo de su reintento seguro. Pruebas y prueba de IA real correctas,
sin envío al cliente durante las pruebas. Activo con autorización `c47e5613`
sobre `d1ab0df4`, preservando recordatorios, bindings y compatibilidad; sin
migraciones ni cambios de escritorio. 295 pruebas, typecheck, 85 aisladas y
dry-run correctos. La nueva oportunidad de Puno enviada a petición del usuario
fue aceptada en primer intento y confirmada `delivered` por Meta.
[Contrato](../apps/radar-conversation.md#edición-con-ia-antes-del-envío--activo-2026-11-04).

## RADAR: recordatorio de ventana activo — 2026-11-04

Implementados cron de quince minutos, preferencia autenticada por instalación y
botón «Seguir recibiendo». Un intento por ventana/día, horario Perú, separación
compartida de treinta minutos, consentimiento/pausa/baja y autorización del rol
RADAR contra el VPS existente. Sólo el mensaje entrante renueva las 24 horas.
286 pruebas del Worker, typecheck, tipos Env, 76 pruebas del paquete aislado y
dry-run con Wrangler 4.157.0 correctos. La migración aditiva `0018` conserva
instalaciones previas sin habilitarlas por defecto. Activo `d1ab0df4` al 100 %,
sobre `35d4c8bb`: respaldo privado restaurado, `0018` aplicada, salud y cron
verificados; bindings/secretos preservados. Se confirmó la preferencia de la
instalación local ya habilitada, sin inscripción masiva ni envío manual. Abrir
el escritorio actualizado para sincronizar continuamente la pausa desde Ajustes;
no se reinició la aplicación ni se publicó instalador.
[Entrega y rollback](../operations/radar-window-reminder-2026-11-04.md).

## RADAR: resumen WhatsApp por bloques — 2026-11-01

Activo `35d4c8bb-27a6-4cb7-a704-f5092f0a3834`, sobre `10a50d2f`. Resumen
por bloques: objeto, cantidad, entidad, fechas por etapa, monto y fuente. La IA
aporta sólo prosa breve; datos y formato los compone el renderizador desde hechos
validados, sin negritas rotas ni enlaces cortados. Respaldo factual equivalente.
271 pruebas, typecheck, 61 aisladas, dry-run y salud; configuración preservada.
Sin migración, cambios de destinatarios, intervalo, WebView o instalador.

## RADAR: alertas espaciadas y resumen con fuente — 2026-11-01

Worker activo `10a50d2f-48c1-4718-9574-ca307b90d904`. Publicado desde paquete
aislado sobre `45b386f5`, con dos puntos de composición reversibles: HTTP RADAR
y handler del rol. Una oportunidad cada 30 minutos de 08:00 a 20:00 Perú;
las reservas D1 impiden ráfagas entre instalaciones y tras reinicios. El escritorio
conserva próximo intento en SQLite. «Ver resumen» agrega la ficha SEACE verificada
o buscador y nomenclatura cuando falta. Sin migraciones, cambios de secretos,
asignaciones o callback; no se enviaron pruebas al WhatsApp del usuario.
268 pruebas, typecheck, 58 aisladas y dry-run; salud y bindings verificados.
Escritorio: 60 pruebas, typecheck y build de árbol preparado en copia aislada
(el directorio normal estaba bloqueado por la aplicación abierta). El instalador
público no fue actualizado. [Contrato](../apps/radar-conversation.md).

## RADAR: selección durable con laptop apagada — 2026-11-01

Activo Worker `45b386f5-2a61-43c5-9c00-f44264bf9548` y bridge de selección
`manolo-platform-bridge:radar-selection-20261101`. PG 009 aplicada tras respaldo
privado; el nuevo handler se probó en staging antes de recrear el bridge.
Patch reversible sobre bundle real, con otros handlers/secretos/redes preservados.
Botones Me interesa, Ver resumen y Descartar; function calling acotado para
selección explícita. El Worker registra también snapshots de clientes antiguos
antes de Meta. Sin cambios a asignaciones, callback Meta o plantillas.

263 pruebas/32 archivos, 53 del paquete aislado, typecheck y dry-run correctos.
PostgreSQL real en contenedor de prueba: concurrencia, paging, dos instalaciones,
idempotencia, autorización y rollback. API de instalación real verificada: un
snapshot público publicado y lectura de sync correcta, cero mensajes o selecciones
de prueba sobre el usuario. El escritorio suma 58 pruebas, typecheck y build local.
Instalador y simplificación visual pendientes; no se tocaron entradas WebView.
Contrato: [radar-selection-sync.md](../apps/radar-selection-sync.md).
Acta y rollback: [radar-selection-2026-11-01.md](../operations/radar-selection-2026-11-01.md).

## Seguimiento RADAR con evidencia y proveedor IA corregidos — 2026-10-31

Worker `8f97ac89-92af-445c-be19-fb1c6f37484b` activo. RADAR deja de heredar el
proveedor por defecto del tenant y usa la configuración IA de sus avisos. Cada
acción tiene respaldo factual distinto; ficha y bases se devuelven desde
evidencia pública validada, sin presentar el buscador general como ficha.
El escritorio adjunta el resumen público de SQLite, sin perfil ni volcado JSON.
La ficha Warmi Ñan respondió 200 desde la red del usuario; contexto completado
por replay sin reenvío: 5856 unidades, tres documentos y fechas separadas de
registro (3/11) y ofertas (4/11), ambas 23:59 Perú. Sin migración ni renovación
de retención/ventana. 244 pruebas, 41 aisladas, typecheck, dry-run y salud correctos;
desktop: 32 pruebas, typecheck y build. Clic humano posterior aún por verificar.
Contrato y límites en [radar-conversation.md](../apps/radar-conversation.md).

## Prueba real del aviso RADAR con botones — 2026-10-31

Por petición explícita del usuario se envió una prueba nueva de chalecos Warmi Ñan
con tres botones. Meta respondió `accepted`, sin replay. Worker activo
`5379829d-61a3-4fb7-a2d0-75146cbd100f`; D1 0017 aplicada tras respaldo y
validación sobre esquema poblado. La prueba anterior de texto y la entrega
automática permanecen intactas. La deduplicación de pruebas ahora distingue
formatos fijos de servidor, sin aceptar claves arbitrarias del cliente.
38 pruebas específicas, 38 del paquete aislado, typecheck y dry-run correctos;
salud y bindings verificados. No se acredita lectura ni clic humano del preview.

## Botones contextuales RADAR — 2026-10-31

Worker `31f4d3ad-6958-43a0-8df7-8c8aa171745d` publicado: nuevas alertas con
Saber más, Ver productos y Evaluar si participo; seguimientos con fuente oficial.
El clic selecciona la entrega aceptada por contacto/tenant/canal y conserva ese
proceso en mensajes posteriores. Botones ajenos o vencidos no abren otra alerta.
Productos y evaluación distinguen datos públicos de detalles pendientes de bases.
Sin migraciones, reasignaciones, horarios, secretos o reenvíos adicionales.
241 pruebas, typecheck, 38 del paquete aislado y dry-run correctos; salud y
bindings verificados. Clic humano real pendiente; la prueba anterior sigue intacta.
Contrato y límites en [radar-conversation.md](../apps/radar-conversation.md).

## Alertas RADAR con IA y seguimiento — activación 2026-10-31

Publicado el resumen comercial con proveedor IA inyectado, fecha
legible y pregunta de seguimiento. El rol utiliza contexto público de la última
alerta y memoria acotada propia, sin historial fiscal. La ventana de 24 horas sólo
se renueva por entrantes reales; se revalida después de generar y antes de enviar.

237 pruebas locales, typecheck, 34 en paquete aislado y dry-run correctos.
Con autorización del usuario se respaldó D1 y se aplicaron sólo 0015/0016;
Worker `6034ee6c-ad53-4443-85a2-55f6a3b2179e` activo con bindings preservados.
Prueba explícita Warmi Ñan aceptada por Meta con composición IA verificada.
La ruta autenticada de preview reserva una sola prueba por alerta aceptada y
conserva la deduplicación automática. No se cambiaron horarios ni contactos.
El seguimiento real espera respuesta del usuario; no se afirma lectura del preview.
Detalles y límites:
[radar-conversation.md](../apps/radar-conversation.md).

## Primera alerta RADAR real verificada y transporte corregido — 2026-10-31

El usuario autorizó publicar la corrección y reintentar una sola alerta real de
chalecos Warmi Ñan. Worker `ddb238b3-6d07-47f5-920c-c4a5be3c04c0` publicado;
se sustituyó `redirect:error`, no soportado por Workers antes de red, por
`manual` en alertas y acuse de vinculación. Sin cambios a roles, bindings o ráfagas.
Regresión nativa reproducida antes del fix; 26 pruebas específicas, typecheck,
19 del paquete aislado y dry-run correctos.

La API confirmó `accepted` con ID Meta y el callback marcó `read`. Se conservó
la idempotencia servidor/cliente y se reconcilió sólo el intento bloqueado,
comprobando hash/instalación/OCID/fecha y ausencia de ID. No se habilitó reenvío
ciego de incertidumbres. Véase [operación](../operations/radar-transport-2026-10-31.md).

## Skill de incorporación de agentes — 2026-10-31

Creada `meowlab-agent-onboarding`, instalada en la carpeta global de skills del
usuario y con copia portable en `skills/meowlab-agent-onboarding/`. Permite
trabajar desde el repositorio de otro servicio con contratos acotados y handoff,
o integrar un rol desde MeowLab siguiendo sus lecturas obligatorias. Distingue
rol conversacional, capacidad/notificaciones, catálogo, autorización y despliegue.
No inventa una API genérica de alta: el runtime mantiene registro por código y
catálogo PostgreSQL. Evita exigir una exploración completa del monorepo.

Validación: `quick_validate.py` en ambas copias, hashes de sus seis archivos y
enlaces internos correctos. Incluye metadatos de invocación, tres referencias y
plantilla de entrega. Sin cambios de runtime, asignación de roles, migraciones,
acceso remoto, commit o despliegue; no modifica la tarea RADAR en curso.

## RADAR como rol de Manolo — 2026-10-31

Publicado el handler `radar` y registrado en PostgreSQL como «RADAR · Licitaciones»
para la TUI. Worker `b406aab4-86cc-4dfd-a8cd-4d0a5edb9fe6`, parche aislado sobre
`bf74500a-59ea-4820-be93-aa3c89adb780`: conserva otros handlers, bindings y ráfagas.
La huella de asignaciones de contactos no cambió; el fundador las gestionará
desde su TUI. El rol ofrece orientación y estado real por contacto, sin historia
fiscal ni operaciones FacturaYa. Búsqueda y evidencia siguen en el escritorio.

Migración PG 008 probada con rollback y aplicada. Suite local: 220 pruebas en
27 archivos con `--maxWorkers=1`; paquete aislado: 17 pruebas;
typecheck y dry-run correctos. Salud 200, rutas protegidas 401, bundle remoto y
bindings verificados. Pendiente respuesta real tras asignar rol; no se enviaron
mensajes ni webhooks sintéticos a producción. Véanse
[ADR-0003](../decisions/0003-radar-rol-licitaciones.md) y
[operación](../operations/radar-role-2026-10-31.md).

## Conexión SSH de la TUI corregida — 2026-10-29

Los conectores de PostgreSQL y administración de empresas usaban por defecto
el VPS retirado y su archivo de llave. Ahora comparten configuración y usan
el alias `meowlab`, respetando usuario/puerto/identidades de OpenSSH. Los
overrides `MANOLO_VPS_HOST` y `MANOLO_VPS_SSH_KEY` siguen disponibles; no se
exige una llave local explícita cuando se usa el alias/agente SSH.
Validación: 18 pruebas TUI y `npm.cmd run users:tui:check` con `connection=ok`
contra el VPS actual. Sin cambios a usuarios, roles, secretos o servicios,
sin despliegue ni commit.

## Ráfagas activadas, GitHub y VPS sincronizados — 2026-10-22

Por autorización explícita se publicó la release autocontenida
`apps/manolo-whatsapp-worker/releases/bursts-20261022` en GitHub (código:
`da37ff053164401339e3b475762126e034d71991`) y se clonó por `ssh meowlab` a
`/opt/manolo-platform/releases/bursts-git-20261022`, verificando commit y hash.
Cloudflare activo: `bf74500a-59ea-4820-be93-aa3c89adb780`, bandera de ráfagas
en `true` y nuevo namespace SQLite. Se conservó la fuente activa de Manolo y
RADAR; no se desplegaron otros cambios del árbol local. No se aplicó D1/PG ni
se reconstruyeron bridge/landing/FacturaYa. Sus archivos locales se preservaron.

La recuperación ya está implementada: endpoint HMAC con timestamp/request ID,
huella de revisión, CAS del checkpoint y auditoría/replay; la CLI opera desde
Docker Secrets por SSH. No libera una emisión pendiente ni repite operaciones.
210 pruebas locales y 36 del paquete aislado, typecheck/build y dry-run.
Health de tres servicios 200; webhook/admin sin firma 401; RADAR conserva
autenticación. CLI firmada desde VPS sobre contacto inexistente devuelve 404
esperado, sin consultar una identidad real. Falta probar una ráfaga desde un
WhatsApp autorizado; no se enviaron comprobantes ni se verificó proveedor DNI.
Acta: [activación de ráfagas](../operations/bursts-activation-2026-10-22.md).

## Agrupación de ráfagas — implementación local 2026-10-22

Implementado [ADR-0002](../decisions/0002-agrupar-rafagas-whatsapp.md): bandeja
Durable Object SQLite por tenant/número/contacto; tres segundos desde el último
texto, máximo diez segundos por ráfaga, veinte fragmentos y 8.000 caracteres.
Cada lote entra una sola vez al rol, conservando originales en D1 y sombra VPS.
Botones y media son barreras FIFO; la creación fiscal sigue requiriendo el botón
vigente. No se mezclan comandos RADAR con facturación.

Validación: **206 pruebas en 24 archivos**, typecheck, build Node, tipos Wrangler
regenerados y `types --check`, despliegue en seco correctos. Pruebas de admisión
firmada antes del ACK, alarma durable, duplicados, aislamiento, llegada durante
inferencia, límites, originales y bloqueo tras incertidumbre. Caso equivalente
a cinco textos de una boleta con producto/cantidad/DNI/importe/fecha: una sola
interpretación y una sola consulta DNI con respuestas sintéticas; sin emisión.

Sin despliegue, migraciones remotas, cambios de secretos o mensajes reales.
`WHATSAPP_BURST_ENABLED=false` en ambos entornos. Antes de activar: completar
recuperación administrativa de turnos inciertos y desplegar preservando la
configuración activa RADAR. Una interrupción no se reejecuta automáticamente
y bloquea creación fiscal hasta reconciliación; no promete exactly-once externo.
La configuración/disponibilidad del proveedor DNI no se verificó en esta tarea;
el fallo mostrado en la captura no se resuelve sólo agrupando mensajes.

## RADAR publicado y activado — 2026-10-18

Con autorización explícita se publicó la versión
`02e3ea4b-da57-47ba-b73d-4ecb4fe8f849`, preservando la fuente y configuración
del Worker activo; rollback `c8ac096f-87a1-4c53-a875-719feeabd76d`. Respaldo D1
restaurado y verificado; sólo 0014 aplicada y habilitada en el canal existente
confirmado por el fundador. 0013 sigue intacta/sin aplicar.

Comprobaciones HTTPS: salud 200, webhook sin firma 401, autenticación, registro
201, bloqueo de alerta sin vínculo 403, baja y rechazo del token revocado 401.
Las huellas de roles/números y los bindings del Worker coinciden con el estado
anterior. Cero entregas RADAR; ningún mensaje real enviado. Falta vincular un
celular para validar entrega real y publicar el instalador actualizado.
[Acta de operación y rollback](../operations/radar-activation-2026-10-18.md).

## RADAR: integración compartida implementada localmente — 2026-10-18

El Worker incorpora API de instalaciones/vinculación/estado/envío/baja, ingreso
Meta compartido con ventanas de 24h, reserva atómica e idempotencia, límites y
correlación de entrega. D1 0014 es nueva y queda desactivada por defecto; no
modifica tenants ni roles. Los comandos RADAR no llegan al historial fiscal.
El escritorio integra el programador al arranque y herramientas del chat, con
búsqueda local de temas aprendidos y transporte autenticado sin secretos Meta.
Contrato, rutas y rollback: [radar-whatsapp-api.md](../apps/radar-whatsapp-api.md).

Validación local del Worker: suite completa, typecheck, build Node y deploy en
seco; pruebas D1 de vínculo firmado→alerta→baja, concurrencia, replay, roles,
revocación y ventana. RADAR: 100 pruebas Bun, typecheck y build. Sin migración
remota, despliegue, envío real ni instalador publicado. La operación se habilita
por un paso separado del tablero; el registro anterior es antecedente de diseño.

## RADAR registrado como proyecto de MeowLab — 2026-10-18

Se añade el registro `radar` al catálogo documental
[`projects.json`](projects.json), con [ficha técnica](../apps/radar.md) y
[ADR-0001](../decisions/0001-radar-canal-whatsapp-compartido.md). RADAR conserva
su repositorio y SQLite local; participará como consumidor de notificaciones
del ingreso WhatsApp existente, sin modificar el rol activo de los contactos.
Las credenciales Meta y la comprobación definitiva de la ventana de 24 horas
quedarán en el servicio MeowLab; el escritorio enviará sólo la alerta mínima.

Este registro no conecta el módulo local, habilita endpoints, crea roles o
tenants, cambia el webhook ni despliega servicios. Vinculación, autorización,
ventanas, API de envío y cliente centralizado están pendientes en el tablero.

## Clasificación de inicio con Decisions API (gpt-6-luna) implementada — 2026-10-14

Se implementó el cliente para el endpoint `POST /v1/decisions` de OpenAI
(impulsado por `gpt-6-luna`) en `OpenAiCompatibleAdapter` y se creó el helper
`isElaborateUserRequest` (con fallback heurístico resiliente).
Se integró en `EnterpriseAdvisorRoleHandler` para resolver la variabilidad de
Luna 6.0:
- Saludos, inicios de conversación y mensajes breves o ambiguos ahora muestran
  de forma predecible los botones interactivos de WhatsApp (`Factura` y `Boleta`)
  tanto al inicio de sesión como durante una sesión activa cuando la intención es
  conversacional.
- Mensajes elaborados (como "Me puedes mostrar las facturas que hice esta ultima semana"
  o solicitudes detalladas de emisión) son clasificados como `elaborate_request`
  y se atienden conversacionalmente de forma directa con el modelo sin forzar
  botones de inicio.
Validación: 173 pruebas en 22 archivos pasadas con éxito (`npm test -- --run`),
`tsc --noEmit` limpio, compilación de paquetes Node correcta y dry-run de
Wrangler validado.

## Migración a nuevo VPS (meowlab / 169.58.135.234) y corte DNS completados — 2026-10-13

Se completó con éxito la migración de los servicios de producción al nuevo VPS
`meowlab` (`169.58.135.234`), conservando URLs y subdominios idénticos:
- `meowlab-web` (Astro landing) en `https://meowlab.tech` y `https://www.meowlab.tech`.
- `facturaya-ai` (PHP 8.4, Nginx, PostgreSQL 17) en `https://facturas.meowlab.tech`.
  Se replicó la base de datos `facturaya` byte a byte con paridad de conteos y
  secuencias en todas las tablas, más volumen `app_storage` (373 MB) con
  certificados de empresas y padrón SUNAT con permisos `www-data:www-data` (33:33).
  Se aplicaron las 3 migraciones locales pendientes (total 14 migraciones).
- `manolo-platform` (Node.js 22 bridge, PostgreSQL 16) con ingress en
  `https://facturas.meowlab.tech/internal/manolo/*`.
  Base de datos `manolo_platform` replicada byte a byte (30 tablas en esquemas
  `whatsapp` y `print_system`). Secretos preservados con permisos `0600` y
  propiedad `node:node` (UID 1000).
- Caddy reverse proxy aprovisionó certificados TLS válidos de Let's Encrypt para
  ambos dominios.
- DNS actualizado en Hostinger (`meowlab.tech` y `facturas.meowlab.tech` hacia
  `169.58.135.234`; registro `AAAA` eliminado).
- Se ejecutaron los 4 smoke tests sobre HTTPS público con 100% de éxito:
  `run-smoke-test-bridge.sh`, `run-smoke-test-contact-role.sh`,
  `run-smoke-test-facturaya-multitenancy.sh` y `smoke-test-dni-contract.mjs`.
- El Cloudflare Worker `whatsapp-webhook-meta-production` opera hacia el nuevo
  VPS.
- Todos los contenedores del servidor de origen (`2.24.64.161`) fueron
  detenidos (`docker stop`) para evitar escrituras residuales y garantizar
  que todo el tráfico se canalice exclusivamente al nuevo VPS, previo a su
  baja definitiva por parte del usuario antes del ciclo de facturación del 15
  de octubre.

## Consulta DNI desplegada — 2026-10-11

Se desplegó primero el bridge (imagen `manolo-platform-bridge:dni-20261011`,
ID `sha256:93b3d7d27ddc0148e0e77f63980b4227f2cf83aa6ffb9341c69cd48de7f72dd3`)
y después el Worker `c8ac096f-87a1-4c53-a875-719feeabd76d`, por autorización
explícita. Fuente del bridge conservada en
`/opt/manolo-platform/releases/dni-20261011`; no se sobreescribió el árbol
anterior del VPS. La imagen anterior quedó etiquetada para rollback.
163 pruebas, typecheck, build Node, types Wrangler y dry-run correctos.
Bridge saludable; Worker, FacturaYa y bridge HTTP 200; webhook sin firma HTTP 401.
Smoke firmado vía Caddy: empresa autorizada, DNI inválido rechazado, firma
inválida rechazada y replay verificado. Sin consulta de identidad real, emisión,
migraciones, cambios de credenciales o reinicios de otros servicios.

Limitación confirmada: FacturaYa publica `api/customers/lookup-dni/{dni}` con
`company.auth`, pero la configuración efectiva del token del proveedor DNI
está vacía. La búsqueda de clientes guardados no depende de ese proveedor;
consultar un DNI nuevo requiere configurar `DNI_LOOKUP_API_TOKEN` en FacturaYa.
La búsqueda externa y el recorrido WhatsApp real no quedan validados por los
healthchecks ni por el smoke de contrato. Pendiente registrado en el tablero.
Rollback Worker: `ac69c47b-9e58-47e3-b126-caccec043b00`; bridge:
`manolo-platform-bridge:rollback-dni-20261011`. Procedimiento en el runbook VPS.

## Consulta DNI conectada — implementación local 2026-10-11

El contrato, adaptadores y bridge incorporan `lookup_customer_dni` y
`lookupCustomerByDni`. En boletas se consulta un DNI sin nombre o una solicitud
explícita de búsqueda; se guardan nombre/documento y se conservan productos.
Cambiar documento descarta el nombre antiguo e invalida la confirmación. Una
negativa generada por el clasificador no bloquea una solicitud soportada.
El bridge mantiene HMAC, autorización por empresa/sesión, permiso
`create_invoice`, auditoría y deduplicación. La consulta puede guardar clientes
en FacturaYa, por lo que no se reintenta el turno después de intentarla.
Validación: 163 pruebas en 21 archivos, typecheck y build Node correctos.
Incluye consulta pese a negativa IA, cambio de DNI, conservación de productos,
fallos del proveedor, resultados inválidos, replay, permisos y conflicto CAS.
Se corrigió una prueba de cifrado intermitente para alterar un byte real en
lugar de un carácter de padding base64. No cambió el algoritmo de cifrado.
Sin despliegue, migraciones ni consulta de identidad real. Pendiente publicar
primero bridge y después Worker, verificar proveedor DNI y probar WhatsApp.

## Recuperación del checkpoint desplegada — 2026-10-11

Con acceso completo recuperado y OAuth Cloudflare verificado se publicó el
Worker `ac69c47b-9e58-47e3-b126-caccec043b00`, por autorización del usuario.
Validación repetida: 149 pruebas en 21 archivos, typecheck, tipos Wrangler
actualizados y despliegue en seco correcto. Worker, FacturaYa y bridge
responden HTTP 200; el webhook sin firma responde HTTP 401.
Rollback: `8acec590-8277-48f4-a18e-29790fee45b5`.
Sin migraciones, cambios del VPS, rotación de secretos ni emisión real.
El tablero y esta nota son los únicos archivos modificados en este despliegue.
Pendientes: recorrido real por WhatsApp y acceso efectivo al modelo; los
healthchecks no validan esos puntos. No se recuperaron manualmente productos
que no llegaron al checkpoint anterior: deben reenviarse.

## Recuperación de conflictos del checkpoint — implementación local 2026-10-10

El rol empresarial reintenta conflictos CAS hasta seis veces, recargando el
checkpoint y reclasificando el mensaje contra los cambios ya guardados. No
se reintenta después de intentar efectos externos (envíos, mutaciones
FacturaYa/documentos o cambios de selección). No es una cola FIFO global.
El adaptador distingue fallos de almacenamiento de conflictos y ofrece
lecturas estrictas para el rol empresarial; los otros roles conservan su
contrato de lectura tolerante. Logs seguros incluyen ID aleatorio de turno,
intento, razón y operación de almacenamiento cuando corresponde.
Sin migraciones ni despliegue en esta tarea; tampoco se reparó manualmente
ninguna conversación de producción.
El intento de despliegue posterior autorizado por el usuario no pudo avanzar
en el entorno restringido: Wrangler indicó falta de autenticación y permisos
insuficientes para su directorio de logs en AppData. No se publicó una nueva
versión. Esto no demuestra que la sesión o los secretos de producción sean
inválidos; el acceso disponible en este entorno es distinto del anterior.
Validación: 149 pruebas en 21 archivos, typecheck y build Node correctos.
Incluye turnos independientes concurrentes, clasificación lenta con checkpoint
actualizado, errores D1 separados y prohibición de repetir importaciones o
emisiones después de un efecto externo.

## Cambio visual desplegado — 2026-10-10

El Worker sustituye Qwen por GPT-6 Luna para analizar imágenes de todos
los roles. Luna recibe la imagen original y el caption; su extracción textual
se entrega al rol activo para conservar los contratos existentes. Se retiró
`GROQ_VISION_MODEL`, sin fallback a Qwen. Groq sigue atendiendo audio y los
roles de texto existentes. No cambia la confirmación de facturación por botón.
Por autorización del usuario se desplegó la versión
`8acec590-8277-48f4-a18e-29790fee45b5`. Worker, FacturaYa y bridge responden
HTTP 200; el webhook sin firma responde HTTP 401. Rollback previo:
`5fd5ded3-7314-458e-8f9e-3e1bcfdbcfbe`. No hubo migraciones, cambios del VPS
ni emisión de comprobantes. La validación del modelo con imágenes reales
sigue pendiente; los healthchecks no comprueban su acceso o precisión visual.
Validación local: 142 pruebas en 21 archivos, typecheck, tipos Wrangler
regenerados y verificados, y despliegue en seco correcto. Las pruebas usan
respuestas simuladas y no acreditan precisión visual con fotografías reales.

## Implementación y despliegue del Worker — 2026-10-10

El rol empresarial incorpora un checkpoint D1 de siete días de inactividad,
con etapa, revisión, datos y resumen del borrador. Guarda cambios antes de
llamar a FacturaYa y utiliza escrituras condicionales para evitar sobrescrituras
concurrentes. La clasificación de intención separa conversación de cambios
comerciales; las correcciones de cliente conservan los productos.

La emisión de factura/boleta exige el botón `Crear` vinculado al último resumen
enviado y su revisión; texto, botones antiguos y clics repetidos no la autorizan.
Una respuesta de red incierta deja la emisión pendiente de verificación.
La configuración empresarial cambia a `gpt-6-luna`, manteniendo el proveedor
configurable. La prueba API local recibió `401 invalid_api_key`, por lo que no
verifica disponibilidad con las credenciales de producción.

Validación local: 21 archivos y 140 pruebas correctas (`npm test -- --run`),
`npm run typecheck`, `npm run build:node`, `wrangler types --check` y
`wrangler deploy --env production --dry-run`. Incluye concurrencia CAS,
recuperación del checkpoint, clasificación, entrega completa del resumen y
rechazo de emisión por texto, botones antiguos o clics repetidos. No se emitió
ningún comprobante real durante estas pruebas. La mejora de registro y
propagación segura de errores de FacturaYa sigue pendiente en el tablero.

Por autorización explícita del usuario se desplegó el Worker a las 22:08 Lima
con `npm run deploy`: versión `5fd5ded3-7314-458e-8f9e-3e1bcfdbcfbe`.
Las comprobaciones posteriores de Worker, FacturaYa y bridge dieron HTTP 200;
el webhook sin firma dio HTTP 401. Se verificó la existencia de
`contact_role_states` mediante una consulta D1 de solo lectura. La versión
anterior para rollback es `f74eefa9-ff69-4355-85a3-914e696bce2e`.
No se desplegaron la landing ni el bridge. El secreto `OPENAI_API_KEY` existe
en producción, pero sigue pendiente comprobar acceso efectivo al modelo y el
recorrido WhatsApp real; el healthcheck no verifica ninguno de esos puntos.
Los secretos financieros residuales se registraron como tarea pendiente.

El detalle operativo del rol está en el
[README del Worker](../../apps/manolo-whatsapp-worker/README.md). La fuente de
verdad de sesiones conversacionales sigue siendo D1; no se ejecutaron
migraciones ni se cambió el runtime a PostgreSQL.

---

Fecha de corte: **2026-09-13**.

Este documento resume lo comprobado en el repositorio. No sustituye una consulta
al estado vivo de Cloudflare o del VPS cuando una operación dependa de ellos.

## Repositorio

- Repositorio: `meowlab`.
- Rama local: `main`; el remoto `origin/main` no se consultó en esta revisión.
- Commit observado en esta revisión: `9b0cc` (HEAD).
- `apps/manolo-whatsapp-worker` está versionado en el repositorio (163 archivos
  rastreados) y no presenta cambios pendientes en el árbol de trabajo.
- La landing Astro tiene cambios locales sin commitear (componentes, páginas y
  recursos de marca). Deben revisarse antes de cualquier entrega.
- En la raíz existen archivos temporales sin seguir (`extract_preview.cjs`,
  `render_original.cjs`, `scratch-verify-detail.cjs`, `preview_clean.html`,
  `original_*.png`, `detail-*.png`, `detail-section.png`) que no pertenecen a
  ninguna aplicación y deben eliminarse o ignorarse.
- El proyecto original en `D:\Proyectos2026\webhook meta` continúa, según la
  evidencia previa, como copia temporal. No se re-verificó ni se ha autorizado
  su eliminación.

## Aplicaciones presentes

### Landing MeowLab

- Astro 5 con salida estática y Tailwind CSS.
- Integración React (`@astrojs/react`) con `@xyflow/react`, `canvas-confetti`,
  `react` y `react-dom` para componentes interactivos.
- Rutas actuales: `/`, `/agentes`, `/contacto`, `/dedicado` y `/servicios`.
- No tiene backend propio en este repositorio.
- La validación disponible es `pnpm build`; aún no existen pruebas automatizadas
  ni lint configurado para la landing.

### Manolo WhatsApp Worker

- Cloudflare Worker TypeScript y bridge Node comparten paquete dentro de
  `apps/manolo-whatsapp-worker`.
- El Worker sigue siendo el único webhook registrado en Meta.
- Roles registrados: `cat`, `quotes`, `print-advisor`, `store-designer` y
  `enterprise-advisor`.
- Entradas transversales: texto, audio, imagen, documento e interacciones.
- Recursos Cloudflare configurados: D1 principal, D1 de Print System, R2 y
  Browser Run.
- Integraciones declaradas: Meta Graph API, Groq, endpoint compatible con
  OpenAI, FacturaYa, tienda virtual y bridge VPS.
- Las funcionalidades financieras personales retiradas ya no forman parte del
  código. El 2026-09-13 se eliminaron el rol `finance`, su adaptador Neon, el
  contrato `FinanceRepository`, la composición en `src/index.ts`, el secreto
  `NEON_DATABASE_URL`, la dependencia `@neondatabase/serverless` y el modo
  `finance` de `enterprise-advisor`. Las migraciones históricas relacionadas se
  conservan por compatibilidad de despliegue.
- `enterprise-advisor` conserva únicamente el flujo de facturación electrónica
  (FacturaYa).

## Estado del runtime

El runtime todavía es híbrido:

| Responsabilidad | Estado actual |
| --- | --- |
| Webhook, firma Meta, normalización de media y respuesta | Worker |
| Lookup inicial de tenant | D1 |
| Conversaciones, historial y deduplicación principal | D1 |
| Estados de roles y cotizaciones | D1 |
| Resolución administrativa de roles | PostgreSQL VPS, con fallback D1 |
| Espejo de mensajes | PostgreSQL VPS cuando `VPS_PLATFORM_SHADOW_ENABLED=true` |
| Print Advisor | Bridge VPS + PostgreSQL `print_system`; fallback D1 |
| Membresías, permisos y tokens FacturaYa | PostgreSQL VPS |
| Documentos temporales empresariales | R2 |
| PDF de cotizaciones | Browser Run |

En producción, la configuración versionada activa el bridge y la escritura en
sombra. Esto no significa que PostgreSQL ya sea la autoridad de conversaciones.

## VPS y migración

El último reporte versionado indica:

- PostgreSQL y el bridge Node estaban saludables.
- Se aplicó `005-platform-runtime.sql`.
- Se reconciliaron 566 mensajes entre D1 y PostgreSQL sin IDs de Meta
  duplicados.
- PostgreSQL contiene estructuras de sesión e idempotencia preparadas, pero el
  Worker todavía no lee desde ellas como runtime principal.
- FacturaYa multiempresa ya resuelve membresía, empresa activa, permisos,
  credenciales cifradas, idempotencia y auditoría en el VPS.
- Tienda virtual queda fuera de la migración actual, aunque su rol y adaptadores
  continúan en el Worker.

Consulta el reporte fechado en
[`deployment-2026-08-26.md`](../../apps/manolo-whatsapp-worker/docs/vps-migration/deployment-2026-08-26.md)
y el plan en
[`architecture-foundation.md`](../../apps/manolo-whatsapp-worker/docs/architecture-foundation.md).

## Validación conocida

La copia ubicada en `D:\meowlab` fue validada antes de crear estos documentos:

- landing: compilación Astro correcta;
- Worker: 22 archivos de prueba y 114 pruebas correctas;
- TypeScript: `npm run typecheck` correcto;
- bridge Node: `npm run build:node` correcto;
- bindings: `wrangler types --check` correcto;
- despliegue Worker en seco correcto;
- auditoría de dependencias de producción sin vulnerabilidades reportadas.

Validación del recorte financiero (2026-09-13), desde
`apps/manolo-whatsapp-worker`:

- `npm test`: 20 archivos de prueba y 113 pruebas correctas;
- `npm run typecheck`: correcto;
- `wrangler types --check`: correcto, con `NEON_DATABASE_URL` ya ausente de
  `worker-configuration.d.ts`.

`npm audit` reporta 9 vulnerabilidades (3 moderadas, 6 altas) en dependencias;
no se corrigieron en esta entrega.

Según la evidencia previa, la última versión de Worker desplegada desde esta
ruta fue `226ad034-dc7e-43a4-9e05-c2e0dda93c91`. El recorte financiero está
validado localmente pero **no desplegado**. Una comprobación operativa futura
debe consultar Cloudflare en vez de asumir qué versión permanece activa.

## Deuda y siguientes decisiones

1. Completar el contrato de runtime para leer sesiones y conversaciones desde
   PostgreSQL.
2. Ejecutar escritura en sombra con observabilidad y reconciliación continua.
3. Hacer el corte por tenant antes de retirar el fallback D1.
4. Definir CI por rutas para que landing y Worker se validen y desplieguen por
   separado.
5. Añadir lint y pruebas de interfaz a la landing.
6. Revisar la integración de tienda antes de incluirla nuevamente en la
   migración.
7. Commitear el trabajo pendiente de la landing y eliminar o ignorar los
   archivos temporales de la raíz antes de la siguiente entrega.
