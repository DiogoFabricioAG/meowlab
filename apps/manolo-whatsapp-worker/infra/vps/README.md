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

El webhook de Meta no cambia. Si el puente falla, `print-advisor` vuelve al
repositorio D1 actual. El rollback operativo consiste en poner
`VPS_BRIDGE_ENABLED=false`, desplegar el Worker y detener solo el servicio
`bridge`; los demás roles siguen en Cloudflare.
