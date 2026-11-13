# Contratos y fronteras de MeowLab

Evidencia del repositorio al 2026-10-31; no es inventario de producción en vivo.
Rutas `src/`, `test/`, `tools/`, `infra/` y `migrations/` son relativas a
`apps/manolo-whatsapp-worker/`. Las rutas `docs/` son relativas al monorepo.

## Superficie mínima para integrar

| Necesidad | Fuente que se consulta |
| --- | --- |
| Handler y contexto de un rol | `src/roles/contracts.ts` |
| Registro efectivo del Worker | `src/roles/registry.ts` |
| Resolución de rol por contacto | `src/contact-control/resolver.ts` |
| Memoria de un rol | `src/roles/state.ts` y su adaptador D1 |
| Inyección de una capacidad nueva | Bloque de composición de `src/index.ts` |
| Transporte Worker → VPS | `src/bridge/contracts.ts`, `src/bridge/signature.ts`, `src/adapters/bridge/signed-vps-client.ts` |
| Rutas/validación del bridge | `src/node/server.ts` y servicio concreto bajo `src/node/` |
| Catálogo/roles de la TUI | `tools/users-tui/contact-admin-repository.mjs`, migraciones bajo `infra/postgres/migrations/` |
| Notificaciones distribuidas RADAR | `docs/apps/radar-whatsapp-api.md`, `src/radar/` |
| Publicación | `docs/project/status.md`, `docs/operations/deployment.md` y acta de la release relevante |

No hace falta leer todos los roles, la landing ni todas las migraciones. Consultar
una implementación semejante sólo para un detalle que el contrato no resuelva.
No copiar roles retirados de migraciones históricas como catálogo actual.

## Contrato del rol (resumen, no reemplazo de los tipos vivos)

```ts
interface RoleHandler {
  readonly key: string;
  configure(tenant: TenantContext): TenantContext;
  handle(context: RoleHandlerContext): Promise<void>;
}
```

`configure` fija personalidad y límites del rol sin credenciales. `handle`
recibe mensaje normalizado, tenant, persistencia, historial, proveedor de IA
y capacidades inyectadas. No necesita implementar webhook ni transporte Meta.

Los identificadores relevantes:

- `message.id`: ID Meta o null; comprobar idempotencia, no generar otro para
  volver a ejecutar el mismo efecto.
- `message.interactionId`: ID del botón/lista; no convertirlo en una instrucción
  textual de emisión o mutación.
- `message.inputType`: text/audio/image/document. Audio e imagen pueden aportar
  texto normalizado; el documento puede estar en `context.document`.
- `tenant.tenantId`, `persisted.contactId`, `persisted.conversationId`: contexto
  de aislamiento. Un ID ausente no autoriza persistencia global.
- `persisted.duplicate`: no volver a ejecutar el turno.

Capacidades existentes: `reply`, `sendText`, `sendButtons`, `sendList`,
`sendImage`, `sendDocument`, `ai`, `roleState` y capacidades de dominios concretos.
Algunas son opcionales. `reply` devuelve void y **no** acredita entrega;
`sendText`/botones devuelven `SendResult`. Una confirmación sensible se vincula
al estado/revisión y sólo se habilita tras entrega confirmada. No usar las
capacidades de FacturaYa como atajo para un servicio de otro dominio.

Para conversaciones IA, `generateAiReply()` usa el mensaje actual y prompt;
`generateAiReplyWithHistory()` incluye historial. No pasar historial fiscal de
otro rol al agente nuevo sin una política explícita de separación de contexto.
Proveedor/modelo se resuelven por configuración y factorías: registrar un rol
no implica que pueda escoger un modelo adicional sin conectar esa configuración.

## Estado, autenticación y runtime

- D1: conversaciones, deduplicación, checkpoints, cotizaciones. Usar la interfaz
  `RoleStateRepository` con tenant/contacto/roleKey. Para concurrencia sensible,
  lecturas estrictas/CAS y revisión; nunca un estado global en memoria.
- PostgreSQL VPS: autoridad administrativa de roles, miembros y permisos;
  copia de mensajes en sombra, no sustituto automático del runtime D1.
- Durable Object: agrupación/serialización por conversación. El dominio no
  añade otra espera ni reinterpreta ráfagas, botones o reintentos por su cuenta.
- R2: documentos temporales donde corresponda; no guardar bytes grandes en
  checkpoints/historial ni usar nombres públicos para archivos privados.

Worker → VPS usa `X-Manolo-Request-Id`, `X-Manolo-Timestamp` y
`X-Manolo-Signature`. La firma es `sha256=` + HMAC-SHA256 del texto exacto
`${timestamp}.${body}`. Reutilizar helpers/verificador/almacén de requests vivos,
incluidos límites y comprobación de hash/replay. El timestamp por sí solo no
evita repetir una acción dentro de su ventana. No inventar un protocolo paralelo
ni copiar el secreto compartido fuera del servidor confiable.

La existencia de `PRINT_ADVISOR_BRIDGE_PATH` o una operación FacturaYa no hace
genérica esa ruta. Una capacidad nueva necesita contrato, validador, despacho,
permisos y pruebas explícitos; o un adaptador al servicio existente revisado.

## Registro no equivale a autorización o despliegue

El mapa `RoleRegistry` admite handlers con clave única y fallback `cat`.
Un rol desconocido puede caer al fallback; un catálogo SQL sin handler publicado
no demuestra que ese agente vaya a responder.
El catálogo de la TUI es `whatsapp.role_catalog` con `role_key`, `label`,
`description`, `sort_order`, `assignable`, `active`. Insertarlo es una migración
nueva, no reescribir `004-contact-role-control.sql` ni sus roles históricos.
Asignar un rol a un contacto es una operación distinta de registrar el catálogo.

Un registro en `docs/project/projects.json` sólo es documentación. No crea
credenciales, endpoints, tenants, membresías o roles. No hay un servicio genérico
de provisión de agentes confirmado por estos contratos.

El canal actual conserva un único webhook Meta en Cloudflare. La landing, el
Worker y el bridge son entregables distintos. Copiar código a la VPS no activa
un rol del Worker. `ssh meowlab` es el alias operativo usado por la TUI; no
incluir IPs, llaves privadas ni credenciales en el paquete de incorporación.
