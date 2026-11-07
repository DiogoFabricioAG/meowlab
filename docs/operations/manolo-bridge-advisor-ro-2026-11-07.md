# Puente del VPS: rol de solo lectura del asesor y reconciliación con git

Fecha: 07/11/2026, 05:59 UTC. Servidor: alias SSH `meowlab`, proyecto `/opt/manolo-platform`.

## Motivo

El SQL que genera el modelo del asesor de impresión se ejecutaba con `manolo_app`, el único rol propio de la base. Ese rol tiene `rolsuper`, `rolcreaterole`, `rolcreatedb` y `rolbypassrls`, y alcanzaba el esquema `whatsapp` (30 tablas) y funciones como `pg_read_file` y `pg_terminate_backend`. El filtro previo era una lista negra de palabras clave.

## Reconciliación previa

El puente activo no salía de git. Corría `dist/node/server.mjs` (06/11 04:32), que importaba dos módulos aparte: `fiscal-extension.mjs` (06/11 18:19) y `radar-selection-extension.mjs` (01/11). Comparación módulo por módulo, usando los marcadores de esbuild, contra el build del commit `aaf3c`:

- 20 módulos idénticos y 1 idéntico salvo renombres internos. Los módulos fiscales efectivos (`client.ts`, `operation-service.ts`) eran iguales a git.
- `bridge-contracts.ts`, `selection-service.ts`, `server.ts` y `http-handler.ts` solo diferían en el empaquetado del injerto. El envoltorio de RADAR de producción aplica los mismos controles, en el mismo orden, que el bloque de git: POST, firma, JSON, request-id, validación y 503.
- `openai-compatible-adapter.ts`: git agrega `decide()`, que el puente no usa, y cambia `temperature` solo para la API oficial de OpenAI. El puente usa Groq (`openai/gpt-oss-120b`), sin cambios.
- `facturaya-admin.mjs` de producción (11/10) era anterior a las condiciones de pago; el de git las incluye.
- Dependencias de runtime idénticas: 14 paquetes, mismas versiones.
- El `compose.yml` del host tenía `image: manolo-platform-bridge:latest`, que no estaba en git; se versionó en `2dec84f`.

Conclusión: el build de git equivale a producción, salvo el cambio buscado y la herramienta de administración actualizada.

## Cambio

- Rama `fix/asesor-rol-solo-lectura`, commit publicado `2dec84f7d73ee1b3c6edb1825d71e005b72721c9` (fix en `24504`).
- Migración `infra/postgres/migrations/010-print-advisor-read-only-role.sql`: crea `manolo_advisor_ro` sin privilegios de administración y con `CONNECTION LIMIT 4`, `default_transaction_read_only`, `statement_timeout` de 8 s, `USAGE` y `SELECT` solo en `print_system`, y sin acceso a `whatsapp`.
- El puente abre para el asesor un pool aparte con ese rol (`PRINT_ADVISOR_DB_PASSWORD_FILE`). Si falta la clave, no arranca. El pool principal se identifica como `manolo-platform-bridge`.

## Despliegue

- Release `/opt/manolo-platform/releases/advisor-ro-20261107T055457Z`, desde `git -c core.autocrlf=false archive` del commit. Un primer intento salió con CRLF por `core.autocrlf=true` en Windows. El script del rol falló en su primera línea, el rollback automático no tuvo nada que deshacer y producción siguió intacta (puente sin reiniciar). Se regeneró en LF.
- Imagen `manolo-platform-bridge:advisor-ro-20261107T055457Z` (también `latest`). Su `server.mjs` tiene el mismo sha256 que el build local del commit (`b5895b65…51dd`).
- `apply-print-advisor-read-only-role.sh` creó el secreto (`1000:1000`, `600`) y el rol, y verificó: `superuser=false createrole=false createdb=false bypassrls=false whatsapp_usage=false print_system_usage=true read_file=false unreadable_print_tables=0`.
- Fuente del host sincronizada con el commit: `src/`, `package*.json`, `tsconfig.json`, `worker-configuration.d.ts`, `compose.yml`, README y migración. Copia anterior en `source-before.tar.gz`.

## Verificación

- Puente `healthy` con la imagen nueva y sus 7 rutas, incluidas FacturaYa y RADAR. Conteos de `verify-bridge-runtime.sh`: 1699 mensajes, 258 ventas, 721 solicitudes del puente.
- Prueba desde el contenedor con el secreto montado: conecta como `manolo_advisor_ro`, lee `print_system.ventas`; `whatsapp.messages` denegado (42501), `pg_read_file` denegado (42501), escritura denegada (25006).
- Sin errores en logs. El pool principal conecta como `manolo_app`. El del asesor se abre con la primera consulta real; queda pendiente verlo con tráfico.
- Pruebas antes del despliegue: 555/557. Los 2 fallos son de RADAR y dependen del reloj real (`radar-tests-real-clock`). Typecheck y build sin errores.

## Rollback

```sh
bash /opt/manolo-platform/releases/advisor-ro-20261107T055457Z/rollback.sh
```

Restaura la fuente del host y la imagen `manolo-platform-bridge:rollback-advisor-ro-20261107T055457Z` (= `sha256:29c6582f…`). El rol y su secreto quedan, porque la imagen anterior no los usa. Para retirarlos: `DROP OWNED BY manolo_advisor_ro; DROP ROLE manolo_advisor_ro;`.

## Pendiente

`manolo_app` sigue siendo superusuario para las operaciones de la plataforma. Bajarlo requiere antes un rol administrador separado, para no quedar sin superusuario.
