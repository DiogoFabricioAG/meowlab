# Despliegue base en VPS - 2026-08-24

## Resultado

Se desplegó el PostgreSQL aislado de Manolo en
`/opt/manolo-platform/infra`, sin cambiar Caddy, Meta, el Worker ni D1.

- Compose: `manolo-platform`.
- Servicio: `manolo-platform-postgres-1`.
- PostgreSQL: `16.15`.
- Imagen fijada por digest:
  `sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685`.
- Estado final: `healthy`.
- Puerto publicado al host: ninguno.
- Red: `manolo_internal`, marcada como interna.
- Volumen persistente: `manolo_postgres_data`.
- Archivo de secretos: `/opt/manolo-platform/infra/vps/.env`, permisos `600`.

## Datos de ensayo

Se cargó el snapshot D1 del 24 de agosto para validar el proceso completo. La
reconciliación terminó con `snapshot_reconciliation=ok`:

- 14 tablas y 607 filas de negocio en el esquema `whatsapp`;
- 7 tablas y 469 filas en el esquema `print_system`;
- restricciones PostgreSQL validadas;
- índices únicos críticos presentes;
- paridad local previa de conteos y agregados de ventas, pagos y compras.

Los dos SQL temporales con datos sensibles se eliminaron del VPS después de la
importación. Los respaldos originales verificados permanecen en la estación de
trabajo y están ignorados por Git.

## Estado operativo

D1 continúa siendo la fuente activa. La base del VPS es una copia de ensayo y
no recibe escrituras del bot. No se cambió el callback de Meta ni se publicó un
endpoint nuevo.

Al finalizar, el VPS tenía aproximadamente 2.8 GiB de RAM disponible y 42 GiB
de disco libre. Sigue sin swap; Chromium permanece fuera de este despliegue.

## Rollback

No se requiere rollback de tráfico porque nada fue cortado. Si fuera necesario
retirar solo esta base de ensayo, primero se debe crear un `pg_dump` y luego
detener el Compose. No se debe eliminar el volumen hasta verificar ese respaldo.

## Actualización: puente Worker a VPS - 2026-08-25

El canario de `print-advisor` quedó desplegado sin cambiar el callback de Meta:

- Flujo: Meta → Worker existente → API HMAC → Node → PostgreSQL → Worker → Meta.
- Contenedor: `manolo-platform-bridge-1`, estado `healthy`, usuario no-root.
- Puerto `3000/tcp`: solo expuesto dentro de Docker, sin publicación al host.
- Redes separadas: `manolo_internal`, `manolo_egress` y `manolo_ingress`.
- Endpoint HTTPS: `https://facturas.meowlab.tech/internal/manolo`.
- Idempotencia: tabla `whatsapp.bridge_requests`.
- Caddy conservó FacturaYa y Radar con HTTP 200.
- Respaldo previo de Caddy:
  `/opt/facturaya-ai/backups/manolo-bridge-20260826T000823Z`.
- Smoke test interno y público: correcto; la segunda solicitud idéntica fue
  respondida desde idempotencia.
- Worker desplegado: versión
  `a9a68046-551e-480f-9d52-194056aba287`.
- Versión anterior para rollback:
  `a4d029b2-966a-4e78-901f-2c7dcd3612ca`.

Solo `print-advisor` usa el puente. Si el VPS no responde, el Worker conserva
el fallback al repositorio D1. Los demás roles continúan ejecutándose por la
ruta anterior.

## Actualización: control de roles en PostgreSQL - 2026-08-25

El control de nombres y roles por contacto se trasladó al PostgreSQL del VPS sin
cambiar el webhook registrado en Meta:

- endpoint HMAC: `/internal/manolo/v1/control/contacts/resolve-role`;
- tablas nuevas: `whatsapp.role_catalog` y
  `whatsapp.contact_role_audit`;
- actividad por contacto: `whatsapp.contacts.last_seen_at`;
- TUI local: `npm run users:tui`, conectado por SSH sin exponer PostgreSQL;
- comprobación no interactiva: `npm run users:tui:check`;
- contactos detectados al desplegar: 7;
- roles asignables: 8;
- pruebas HMAC interna y pública: correctas;
- Worker desplegado: versión
  `6f2d4612-6da8-4a3b-9e97-c7bc4cec7bab`;
- versión anterior para rollback:
  `a9a68046-551e-480f-9d52-194056aba287`;
- respaldo previo:
  `/opt/manolo-platform/backups/contact-role-control-20260826T012500Z`.

PostgreSQL es ahora la fuente principal para resolver el rol. D1 continúa como
fallback de disponibilidad y sigue almacenando conversaciones, estados de rol
y cotizaciones mientras esas áreas completan su propia migración.
