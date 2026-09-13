# Migración al VPS

## Alcance aprobado

La migración cubre:

- webhook y roles de WhatsApp;
- base conversacional, contactos, tenants, estados y cotizaciones;
- asesor de Print System y su base `gamarra_db`;
- Finanzas Player;
- integración con FacturaYa, que ya está desplegado en el VPS;
- generación de PDF de cotizaciones mediante Chromium en el VPS.

`tienda-virtual` queda fuera de alcance hasta revisar nuevamente su arquitectura. Sus endpoints, secretos, estados y flujos de pago no se modifican durante esta migración.

## Principios de la migración

1. Meta conserva un solo webhook activo.
2. No se elimina ningún recurso de Cloudflare durante la transición.
3. Toda migración de datos se valida por conteos, restricciones e idempotencia.
4. El corte se realiza primero mediante un puente Worker a VPS firmado con HMAC.
5. Cloudflare puede permanecer como DNS, proxy y WAF aunque la ejecución viva en el VPS.
6. Los proveedores externos, como Meta, Groq, OpenAI, SUNAT y Neon, se tratan como integraciones y no como procesos que puedan instalarse en el VPS.

## Orden actualizado

### Fase 0 - inventario y respaldos

- [x] Inventariar bindings y secretos por nombre, sin leer valores.
- [x] Exportar `whatsapp-webhook-meta-db`.
- [x] Exportar `gamarra_db`.
- [x] Reconstruir ambos respaldos en SQLite y ejecutar `integrity_check`.
- [x] Registrar versiones actuales para rollback.
- [ ] Respaldar Neon de Finanzas Player con una credencial de solo lectura o de backup.
- [ ] Ejecutar el respaldo cifrado de FacturaYa con una contraseña elegida por el propietario.

### Fase 1 - base de plataforma en el VPS

- [x] preparar y desplegar la red Docker interna y el Compose de PostgreSQL;
- convertir Caddy en la puerta de entrada común sin interrumpir FacturaYa ni Licitaciones;
- añadir healthchecks, límites de recursos y rotación de logs;
- [x] crear y validar los esquemas PostgreSQL para WhatsApp y Print System, separados de FacturaYa;
- configurar respaldos externos y prueba de restauración;
- agregar swap de emergencia y revisar ampliación de RAM antes de ejecutar Chromium.

El despliegue base y la carga de ensayo están registrados en
`deployment-2026-08-24.md`. D1 continúa activo y no se modificó tráfico.

Los archivos de infraestructura están en `infra/vps` y `infra/postgres/init`.
Los esquemas fueron aplicados en una instancia PostgreSQL 16 temporal: se
crearon 14 tablas en `whatsapp` y 7 en `print_system`.

Los SQL de importación con datos se generan dentro de `backups/`, que está
ignorado por Git:

```powershell
npm run migration:prepare:postgres -- --profile whatsapp --source backups/d1/FECHA/whatsapp-webhook-meta-db.sql --target backups/postgres/FECHA/whatsapp-data.sql
npm run migration:prepare:postgres -- --profile print-system --source backups/d1/FECHA/gamarra_db.sql --target backups/postgres/FECHA/print-system-data.sql
```

El conversor valida primero las relaciones del respaldo D1, normaliza los
booleanos de SQLite y conserva los identificadores para no romper claves
foráneas ni referencias externas.

Después de importar Print System se verifica paridad sin mostrar datos de
clientes. El proceso compara las siete tablas y los agregados de ventas, pagos
y compras:

```powershell
$env:PRINT_POSTGRES_URL = "postgresql://USUARIO:CLAVE@HOST:5432/BASE"
npm run migration:verify:print-parity -- --source backups/d1/FECHA/gamarra_db.sql
Remove-Item Env:PRINT_POSTGRES_URL
```

### Fase 2 - Print System

- [x] transformar el esquema SQLite/D1 a PostgreSQL;
- [x] importar y reconciliar las siete tablas de `gamarra_db` en PostgreSQL;
- [x] implementar un repositorio PostgreSQL con consultas de solo lectura;
- [x] mantener el contrato actual de `BusinessDataRepository`;
- [x] validar conteos y agregados contra D1 antes de cambiar el origen del asesor;
- [x] ejecutar `print-advisor` detrás del bridge HMAC en el VPS;
- [x] fijar `search_path=print_system,public` en cada conexión y transacción.

El repositorio del VPS ejecuta cada consulta con un cliente del pool dentro de
`BEGIN READ ONLY`, fija `search_path=print_system,public`, aplica un timeout de
8 segundos y siempre libera la conexión. D1 continúa siendo el origen activo
hasta que el servicio Node se ejecute en paralelo.

### Actualización 2026-08-26 - runtime de plataforma

Se aplicó la migración `005-platform-runtime.sql` al PostgreSQL del VPS. La
base ya contiene `conversation_sessions` e `idempotency_keys`, que serán la
base del siguiente contrato firmado de plataforma. La última exportación de
D1 se reconcilió de forma idempotente contra PostgreSQL.

La reconciliación del 2026-08-27 actualizó el espejo a 566 mensajes, 57
clientes, 258 ventas, 168 pagos y 10 compras. El respaldo ahora recibe el
entorno explícitamente y por defecto usa `production`.

El Worker aún no usa esas tablas como runtime primario. Esta decisión mantiene
el rollback inmediato y evita activar PostgreSQL antes de migrar las
dependencias de `contact_id` que todavía utilizan los estados de roles y
cotizaciones en D1. El detalle está en `deployment-2026-08-26.md`.

### Fase 3 - Finanzas Player

- separar las Pages Functions del runtime de Cloudflare;
- servir frontend y API desde Node.js en Docker;
- reemplazar Hyperdrive por conexión PostgreSQL con pool;
- reemplazar KV de rate limiting por Redis o un limitador local persistente;
- conservar `WHATSAPP_API_TOKEN`, sesiones, aislamiento de cuentas y contratos HTTP;
- dejar Pages disponible para rollback hasta completar la observación.

### Fase 4 - servicio de WhatsApp en paralelo

- extraer el handler HTTP a un servidor Node.js;
- implementar repositorios PostgreSQL equivalentes a D1;
- reemplazar R2 temporal por un adaptador S3 compatible cuando existan objetos;
- reemplazar Browser Run por Chromium/Playwright en un contenedor dedicado;
- reemplazar `ctx.waitUntil` por una cola persistente;
- mantener firmas de Meta, deduplicación, memoria y multi-tenant.

El primer modo activo será:

```text
Meta -> Worker actual -> HMAC interno -> WhatsApp VPS
```

Después de validar el procesamiento completo:

```text
Meta -> Caddy -> WhatsApp VPS
```

### Fase 5 - corte y observación

- realizar una exportación D1 final;
- pausar escrituras durante la importación delta;
- reconciliar conteos y claves únicas;
- cambiar el callback de Meta una sola vez;
- observar errores, latencia y duplicados;
- mantener Worker, Pages y D1 durante al menos siete días para rollback.

## Condiciones para iniciar infraestructura

El VPS tiene actualmente 3.8 GiB de RAM, no tiene swap y ya ejecuta FacturaYa, Licitaciones y dos instancias PostgreSQL. Antes de agregar el servicio de WhatsApp con Chromium se debe cumplir al menos una de estas condiciones:

- ampliar el VPS a 8 GiB de RAM o más; o
- separar Chromium y las nuevas bases en otro servidor.

El swap puede proteger frente a un pico puntual, pero no sustituye la ampliación de memoria.
