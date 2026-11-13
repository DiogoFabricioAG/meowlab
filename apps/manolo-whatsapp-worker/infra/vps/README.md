# Base de plataforma en el VPS

Este Compose prepara PostgreSQL y el puente Node privado que usa el Worker. Meta
continúa conectado únicamente al Worker. FacturaYa y Licitaciones permanecen
aislados en sus despliegues actuales.

La base contiene dos esquemas independientes:

- `whatsapp`: tenants, contactos, conversaciones, mensajes, roles y cotizaciones;
- `print_system`: ventas, pagos, clientes y demás datos del asesor del negocio.

`tienda-virtual` no forma parte de este despliegue. La tabla histórica de
notificaciones de tienda se conserva únicamente para que una restauración del
D1 principal no pierda información.

## Preparación

1. Copiar esta carpeta al directorio privado del despliegue en el VPS.
2. Copiar `.env.example` como `.env` y generar una contraseña aleatoria de al
   menos 32 caracteres. No reutilizar contraseñas de FacturaYa.
3. Mantener `.env` con permisos `600` y fuera del repositorio.
4. Validar con `docker compose --env-file .env config`.
5. Crear la base con `docker compose --env-file .env up -d postgres`.
6. Antes de iniciar el puente, crear `./secrets/groq_api_key`,
   `./secrets/vps_bridge_hmac_secret` y `./secrets/credentials_encryption_key`.
   La clave de `./secrets/print_advisor_db_password` la crea
   `apply-print-advisor-read-only-role.sh` (ver la sección del rol del asesor).
   El directorio `secrets` debe usar modo `700`
   y los archivos deben pertenecer al UID/GID `1000:1000` con modo `600`, para
   que solo el usuario no-root `node` pueda leer los montajes. El segundo
   secreto debe ser aleatorio y tener al menos 32 caracteres. En `.env` solo se
   configura, opcionalmente, `PRINT_ADVISOR_MODEL=openai/gpt-oss-120b`.
   La llave de credenciales debe contener exactamente 32 bytes en base64 o 64
   caracteres hexadecimales. Generarla con `openssl rand -base64 32` y no
   reutilizarla como HMAC ni contraseña.
7. Aplicar `../postgres/migrations/003-bridge-requests.sql`,
   `../postgres/migrations/004-contact-role-control.sql` y
   `../postgres/migrations/006-facturaya-multitenancy.sql` a una base existente;
   después levantar con `docker compose --env-file .env up -d --build bridge`.

En el VPS también puede ejecutarse `./bootstrap-postgres.sh`. El script solo
acepta un destino dentro de `/opt/manolo-platform`, crea `.env` si todavía no
existe, genera la contraseña con OpenSSL sin imprimirla, valida Compose, espera
el healthcheck y confirma los dos esquemas.

Los SQL de `../postgres/init` se ejecutan automáticamente solo cuando el volumen
está vacío. Para una base existente se usarán migraciones versionadas, no se
volverán a ejecutar estos archivos manualmente.

## Operación segura

- PostgreSQL solo es accesible desde la red Docker interna `manolo_internal`.
- El puente Node usa `postgres:5432`, tiene salida a Groq y expone el puerto
  `3000` únicamente dentro de la red Docker externa `manolo_ingress`.
- Caddy seguirá siendo la única entrada pública; PostgreSQL nunca se expondrá.
- `VPS_BRIDGE_HMAC_SECRET` también se guarda en el Worker mediante
  `wrangler secret put VPS_BRIDGE_HMAC_SECRET --env production`; su valor nunca va en
  `wrangler.jsonc`.
- El endpoint firmado `/v1/control/contacts/resolve-role` mantiene
  `last_seen_at` y resuelve el rol desde PostgreSQL. Si no está disponible, el
  Worker conserva temporalmente la asignación de D1 como fallback.
- El endpoint firmado `/v1/facturaya/execute` valida el contacto, la membresía,
  la empresa activa y el permiso antes de descifrar el token. Los tokens se
  administran con `npm run users:tui` y no se aceptan por WhatsApp.
- `./run-smoke-test-facturaya-multitenancy.sh` prueba HMAC, resolución de
  membresía y sesión sin emitir comprobantes. Para validar también Caddy, usar
  `FACTURAYA_SMOKE_URL=https://facturas.meowlab.tech/internal/manolo/v1/facturaya/execute
  ./run-smoke-test-facturaya-multitenancy.sh`.
- Antes de cualquier corte se requiere un `pg_dump`, una restauración de prueba
  y reconciliación contra los conteos D1 inventariados.
- No se desplegará Chromium en este VPS mientras conserve 3.8 GiB de RAM sin la
  ampliación o separación indicada en el plan de migración.

## Rollback

### Release fiscal — 2026-11-05

Bridge actual `manolo-platform-bridge:fiscal-20261105` (también `latest`), con
crédito y GRE/categoría. Entrega aislada sobre la imagen RADAR activa, sin cambio
de Compose, secretos ni redes. Release privada:
`/opt/manolo-platform/releases/fiscal-20261105`. Antes de reconstruir o revertir,
consultar [acta, evidencia y rollback coordinado con Worker](../../../../docs/operations/manolo-credit-gre-2026-11-05.md).
No reconstruir la entrega DNI histórica para actualizar este servicio.

### Release DNI — 2026-10-11

La fuente activa de esta entrega está aislada en
`/opt/manolo-platform/releases/dni-20261011`, con `source.tar` SHA-256
`5c507cb4fa223ba23175a2ea0d9e8bbd8cca3ff4afe8ad200aee4f25487ce972`.
Se construyó con `infra/vps/bridge.Dockerfile` de esa release y se etiquetó
`manolo-platform-bridge:dni-20261011` y `manolo-platform-bridge:latest`.
Compose/secrets originales permanecen en `/opt/manolo-platform/infra/vps`.
No reconstruir con `up --build` desde el árbol anterior: volvería al código
antiguo. Para reconstruir esta entrega, ejecutar desde la carpeta de release:

```sh
docker build -f infra/vps/bridge.Dockerfile -t manolo-platform-bridge:dni-20261011 .
docker image tag manolo-platform-bridge:dni-20261011 manolo-platform-bridge:latest
cd /opt/manolo-platform/infra/vps
docker compose --env-file .env up -d --no-deps --no-build bridge
```

Rollback sin modificar PostgreSQL ni otros servicios:

```sh
docker image tag manolo-platform-bridge:rollback-dni-20261011 manolo-platform-bridge:latest
cd /opt/manolo-platform/infra/vps
docker compose --env-file .env up -d --no-deps --no-build bridge
```

Después verificar health y smoke multiempresa. Para verificar la nueva operación
DNI en la release actual sin consultar identidades ni emitir comprobantes:

```sh
docker exec -i \
  -e FACTURAYA_SMOKE_URL=https://facturas.meowlab.tech/internal/manolo/v1/facturaya/execute \
  manolo-platform-bridge-1 node --input-type=module - \
  < /opt/manolo-platform/releases/dni-20261011/smoke-test-dni-contract.mjs
```

El smoke necesita una sesión activa con permiso `create_invoice` y comprueba
firmas, rechazo de DNI inválido y replay. Solo registra resultados seguros.
FacturaYa ya publica la ruta DNI, pero su token efectivo de proveedor estaba
vacío al verificar esta entrega. Configurarlo en FacturaYa (no en el bridge ni
el Worker) antes de validar búsquedas externas; no reutilizar tokens de otro
proveedor sin comprobar compatibilidad. No se cambiaron credenciales.

El webhook de Meta no cambia. Si el puente falla, `print-advisor` vuelve al
repositorio D1 actual. El rollback operativo consiste en poner
`VPS_BRIDGE_ENABLED=false`, desplegar el Worker y detener solo el servicio
`bridge`; los demás roles siguen en Cloudflare.

## Rol de solo lectura del asesor de impresión

El SQL que genera el modelo del asesor no usa el usuario de la plataforma (`POSTGRES_USER`, superusuario en la imagen oficial). El puente abre un pool aparte con `manolo_advisor_ro`, que solo puede leer el esquema `print_system`: no es superusuario, no ve `whatsapp`, no ejecuta `pg_read_file`, queda en solo lectura con `statement_timeout` de 8 s y como máximo 4 conexiones. Si falta su clave, el puente no arranca en vez de volver al superusuario.

Antes de desplegar un puente con este cambio, aplicar en el VPS:

```bash
sh /opt/manolo-platform/infra/vps/apply-print-advisor-read-only-role.sh
```

El script crea `secrets/print_advisor_db_password` si no existe (hex aleatorio, `1000:1000`, modo `600`), aplica `infra/postgres/migrations/010-print-advisor-read-only-role.sql`, fija la clave sin mostrarla y termina con `print_advisor_read_only_role=ok` solo si los privilegios son exactamente los esperados. Es idempotente.
