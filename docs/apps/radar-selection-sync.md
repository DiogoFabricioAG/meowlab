# RADAR: selección durable y sincronización del escritorio

Los avisos se distribuyen cada 30 minutos de 08:00 a 20:00 Lima, además de exigir
ventana de 24 horas. La reserva atómica D1 comparte límite entre instalaciones y
clientes antiguos; HTTP 429 `deferred/retryAt` deja el candidato pendiente. Esto
no demora el guardado o sincronización de decisiones, ni la publicación de todos
los candidatos. «Ver resumen» adjunta fuente SEACE verificable. Véase
[frecuencia y fuentes](radar-conversation.md).

Entrega 2026-11-01. El descubrimiento SEACE se mantiene en la laptop; MeowLab
conserva snapshots públicos y decisiones mientras el equipo está apagado. El rol
`radar` y el webhook existentes se reutilizan; no se crea una integración paralela.

## Operaciones

El escritorio usa su bearer revocable en `/v1/projects/radar`:

| Ruta | Contrato |
| --- | --- |
| POST /candidates | `{requestId,candidates:[{alert,evidence?}]}`, máximo 20; respuesta `version:1,status:ok,requestId,published` |
| GET /sync?after=0&limit=100 | `version:1,status:ok,requestId,changes,cursor`; hasta cien cambios ordenados |
| POST /sync/ack | `{requestId,cursor}`; respuesta `version:1,status:ok,requestId,ackedCursor` |

Un cambio contiene `seq,ocid,state,changedAt,candidate`, con estados `interesting`
o `dismissed`. El Worker obtiene tenant, teléfono, destinatario e instalación de
su vínculo autenticado. No acepta esos identificadores como autoridad del cliente.
Las operaciones de sincronización no requieren ventana de 24 horas; los mensajes
Meta conservan todas sus comprobaciones anteriores.

El Worker firma `/v1/roles/radar/sync` hacia el bridge con el protocolo HMAC
existente. El contrato discriminado admite publicación, selección, lectura y ACK.
PostgreSQL valida tenant y canal activos, contacto y rol efectivo RADAR; la primera
operación vincula la instalación y posteriores operaciones no pueden moverla a
otro contacto. El escritorio nunca recibe HMAC, Meta, credenciales PG ni SSH.

## Persistencia

PG 009 agrega siete tablas de dominio: `radar_sync_installations`,
`radar_candidate_snapshots`, `radar_selection_counters`, `radar_selection_changes`,
`radar_current_selections`, `radar_meta_selections`, `radar_sync_requests`.
Los cambios usan secuencias por cuenta asignadas bajo lock transaccional, evitando
saltos por commits concurrentes. Requests e IDs Meta deduplican efectos y rechazan
un ID repetido con contenido distinto. Una publicación antigua no sustituye
evidencia más reciente y un snapshot escaso conserva evidencia existente.

El cursor de entrega/confirmación pertenece a cada instalación. Descargar no
consume globalmente una cola: otro equipo recibe sus propios cambios. Un ACK
no supera lo entregado. Las decisiones no caducan con el contexto conversacional
de 48 horas ni con la ventana de mensajes. No se migran conversaciones fiscales,
roles administrativos o checkpoints de D1 a PostgreSQL.

## Rol y herramientas

Los nuevos botones son Me interesa, Ver resumen y Descartar; IDs informativos
anteriores siguen siendo válidos. La selección resuelve una entrega aceptada en
D1 para el mismo destinatario/canal e instalación no revocada, sin exigir que
todavía exista el contexto de 48 horas. Se confirma al usuario sólo tras commit
del servidor. Un fallo no se presenta como guardado o encolado.

El function calling ofrece `set_opportunity_interest` sólo con una oportunidad
actual identificada. El único argumento es el estado; identidad y OCID están
ligados al contexto autenticado. Sin herramientas o contexto no se escribe.
Un segundo paso recibe el resultado real, con fallback de confirmación acotado.

Compatibilidad: `/alerts` registra el candidato público antes de Meta incluso
si el cliente antiguo no llamó `/candidates`. Un fallo previo a Meta deja un
rechazo seguro para reintentar; un replay aceptado conserva su estado original
y puede completar el snapshot sin otro mensaje. No cambia la clave de dedup.

## Escritorio

La cola local persiste lote, cuerpo y requestId antes de publicar. Intenta importar
selecciones aunque falle publicar candidatos. Una página se aplica en transacción
SQLite junto al cursor; el ACK llega después. Un ACK perdido conserva su ID para
reintentar. Revisiones antiguas no reviven un descarte. Descartar no borra trabajo.

El coordinador sincroniza al iniciar y cada minuto; busca desde la conexión del
usuario al quedar pendiente, cada seis horas o al cambiar el día de Lima. Publica
aunque la ventana de WhatsApp esté cerrada y revisa avisos pendientes sin repetir
la búsqueda. El perfil permanece local. Inicio oculto Windows respeta opt-in,
bandeja y pipe de instancia única. La instalación pública se entrega por separado.

## Validación

Pruebas unitarias/HTTP: vínculo autenticado, firma HMAC, aislamiento, rechazo de
cursor arbitrario, sin ventana para sync, deduplicación y function calling.
PostgreSQL real validado en DB `radar_test` y contenedor dedicado: paging de más
de cien eventos, concurrencia, múltiples instalaciones y rollback. La base de
producción sólo recibió 009 tras respaldo privado; se verificaron staging y
producción antes de publicar el Worker. Evidencia operativa:
[radar-selection-2026-11-01.md](../operations/radar-selection-2026-11-01.md).

La simplificación visual del escritorio sigue pendiente. El trabajo sincronizado
se muestra en Guardadas con la interfaz existente; no se editaron los archivos
de entrada WebView que estaban en edición paralela. No se acredita todavía un
clic humano posterior al despliegue ni la publicación de un instalador nuevo.
