# RADAR: contrato del servicio compartido de WhatsApp

Actualización de frecuencia 2026-11-01: `POST /alerts` devuelve HTTP 429 con
`{status:"deferred",retryAt:<epoch ms>}` cuando no corresponde otro aviso.
Una reserva nueva por destinatario cada 30 minutos, sólo de 08:00 a 20:00 Lima;
no modifica la ventana de 24 horas, deduplicación ni sincronización de selección.
El cliente conserva el candidato para un próximo intento. Los replays aceptados
no consumen otro turno. [Detalle y fuentes de resumen](radar-conversation.md).

Actualización 2026-11-01: [selección durable y sincronización](radar-selection-sync.md)
añade snapshots de candidatos, cambios y ACK por instalación, con cola PG 009.
El escritorio mantiene el descubrimiento local y el rol usa el mismo webhook.
El contrato inferior describe la base de notificaciones; los avisos aceptan
también evidencia pública acotada. No hay respaldo automático por plantillas.

Preparación 2026-10-31: [resumen con IA y seguimiento](radar-conversation.md),
pendiente de migración 0015 y publicación autorizadas. Mantiene las rutas y
credenciales existentes; añade contexto público acotado y formato conversacional.

Actualización 2026-10-31: `radar` es un rol de Manolo asignable desde la TUI.
La API inferior se conserva para los escritorios; no sustituye el registro de
roles ni autoriza notificaciones por asignar un rol. Publicación y alcance:
[operación](../operations/radar-role-2026-10-31.md).

Implementación local del 2026-10-18. Código en
`apps/manolo-whatsapp-worker/src/radar/`; migración D1 `0014_radar_notifications.sql`.
El servicio se compone en el Worker existente, no en el bridge del VPS. Reutiliza
sus secretos Meta; no cambia roles, tenants, dominios ni callback.

**Publicado y habilitado el 2026-10-18**, versión
`02e3ea4b-da57-47ba-b73d-4ecb4fe8f849`, con D1 0014 aplicada. Comprobaciones
HTTPS correctas; vínculo/envío real e instalador pendientes. Evidencia y
rollback: [activación](../operations/radar-activation-2026-10-18.md).

## API v1

Base: `/v1/projects/radar`. Respuestas JSON sin caché ni CORS abierto. Los clientes
de escritorio llaman desde Bun. Excepto el registro, todas las rutas requieren
`Authorization: Bearer <token-propio-de-instalacion>` sobre HTTPS.

| Método y ruta | Solicitud | Resultado |
| --- | --- | --- |
| `POST /installations` | Sin datos de negocio ni teléfono | `201`: installationId, token, message, whatsappUrl, expiresAt, notice |
| `POST /pairing` | Sin cuerpo | Código nuevo para una instalación aún sin vincular; `409` si ya está vinculada |
| `GET /status` | Sin cuerpo | linked, open, recipient enmascarado, expiresAt (ms Unix o null) |
| `POST /alerts` | ocid, code, description, buyer, amount, deadline, sourceUrl; todos strings | status: accepted, unknown, rejected o window_closed; replayed opcional |
| `POST /revoke` | Sin cuerpo | revoked: true; invalida el token y la autorización de esa instalación |

El token de registro se entrega una sola vez y sólo su SHA-256 queda en D1. El
código de vinculación es otro secreto aleatorio independiente de 256 bits, vence
en 10 minutos, se guarda como hash y se consume atómicamente una sola vez.

El usuario recibe la explicación de consentimiento en RADAR y envía
`RADAR ACTIVAR <codigo>` desde su WhatsApp. El destinatario se obtiene del
`messages[].from` auténtico y no de un parámetro del escritorio. `RADAR BAJA`
revoca todas sus instalaciones RADAR para ese número de negocio. La baja desde
el escritorio revoca sólo su instalación. Ninguna de esas acciones modifica
`active_role_key`, borradores, checkpoints o historial fiscal.

Los códigos y bajas se consumen antes de invocar `processIncomingMessages`.
Los mensajes habituales continúan hacia sus roles. El ingreso actual verifica
primero `X-Hub-Signature-256`. Los cambios RADAR se persisten antes del `200`;
un fallo devuelve `500` para que Meta pueda reintentar. Un token de procesamiento
en la misma transacción impide que reproducir una baja antigua revoque una
instalación vinculada después.

## Ventanas y envíos

La ventana se guarda por número de negocio/usuario, usando el timestamp del
mensaje entrante. Mensajes duplicados, atrasados, futuros, estados de entrega,
envíos y consultas de rol no la amplían. Las lecturas usan sesiones D1 con
`first-primary` para evitar autorizaciones basadas en réplicas atrasadas.

Antes de enviar se comprueban vinculación, consentimiento, revocación y menos
de 24 horas transcurridas. La reserva SQL revalida autorización y ventana de
forma atómica; después se consulta de nuevo la elegibilidad y se comprueba el
reloj inmediatamente antes de Meta. No hay plantillas ni respaldo automático.

La alerta sólo acepta campos acotados y URLs oficiales SEACE/Contrataciones
Abiertas, nunca un destino arbitrario para descargas. El escritorio es
responsable de su evidencia SQLite y sólo incluye ficha `/proceso/` verificada.
El servicio no vuelve a investigar ni verifica la existencia de la convocatoria.

La unicidad por número/usuario/OCID evita duplicar alertas incluso entre dos
instalaciones. Otro contenido para una clave existente da `409 idempotency_conflict`.
`sending` se persiste antes de llamar a Meta. Un timeout/5xx/resultado sin ID
queda `unknown`, sin nuevo envío automático; un rechazo explícito puede
reintentarse con el mismo payload. `accepted` significa aceptación API, no
entrega. Los callbacks firmados correlacionan el ID de Meta con `sent`,
`delivered`, `read` o `failed`, sin alterar la ventana.

## Límites y datos almacenados

- Registro: 5 solicitudes por hora por identificador de red salado con el App
  Secret; no se conserva la IP en claro. El servidor limita códigos nuevos a
  5 por hora/instalación y envíos a 120 por hora/número-destinatario.
- `429` deja las alertas pendientes en RADAR para el siguiente horario; no
  trunca candidatos ni elimina oportunidades de SQLite.
- Solicitud de alerta: 8 KiB; respuesta Meta: 16 KiB. Timeout Meta 15 segundos,
  sin redirecciones ni reintento del transporte.
- D1 conserva hashes de token/código, vinculación y consentimiento, timestamps,
  IDs de mensajes, OCID, hash del payload, aceptación y estados de entrega.
  No conserva el cuerpo de la alerta, perfil, precios ni conversación RADAR.
- Los registros de idempotencia no se podan automáticamente; esto evita perder
  la garantía de no duplicar. Los límites vencidos se limpian al registrar otra
  instalación. Una política de retención/borrado administrativo sigue pendiente.
- Estado `unknown` sin ID Meta puede requerir conciliación de soporte; no hay
  panel para resolverlo ni reenvío ciego. Si falla el guardado tras aceptación,
  queda `sending` y la API lo devuelve como `unknown` en consultas repetidas.

## Activación y rollback (requieren operación separada)

La migración crea `radar_settings` **desactivado**. Sin la tabla o con enabled=0,
la entrada normal de Manolo sigue intacta y la API RADAR devuelve `503`.

1. Respaldar D1 según el runbook y revisar migraciones pendientes. Aplicar sólo
   la migración nueva aprobada; no ejecutar a ciegas todas las pendientes.
2. Publicar la versión revisada del Worker, manteniendo el callback actual.
3. Obtener del canal existente el ID y número público correctos. Activar:

```sql
UPDATE radar_settings SET enabled=1,
  phone_number_id='<ID_DEL_NUMERO_EXISTENTE>',
  public_number='<NUMERO_INTERNACIONAL_SIN_PLUS>' WHERE id=1;
```

4. Probar con una instalación y un celular autorizado: vínculo, ventana,
   alerta, duplicado, baja y atención fiscal habitual.
5. Publicar el instalador RADAR por su procedimiento independiente.

Rollback: `UPDATE radar_settings SET enabled=0 WHERE id=1;` detiene nuevas
operaciones RADAR sin alterar roles ni callback. Las peticiones ya en curso
pueden terminar. Conservar las tablas de deduplicación y revocar instalaciones
cuando corresponda; no borrar estado para forzar reenvíos. El rollback del
Worker sigue su procedimiento existente.

La migración remota y el despliegue ya se ejecutaron con autorización; el nuevo
instalador no está publicado. Las pruebas de envío usan D1 local y Meta simulado;
las comprobaciones de producción verificaron autenticación, bloqueo sin
vinculación y revocación, sin enviar mensajes reales.
