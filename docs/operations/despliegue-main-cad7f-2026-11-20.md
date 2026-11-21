# Despliegue conjunto desde main: Worker, bridge, portal y servicio de Tender Cat

Fecha: 20/11/2026, cerca de las 23:00 en Lima (04:00 UTC del 21/11). Lo pidió el
operador («Sí, despliega todo»), después de que Tender Cat se reintegró en `main`
(PR #52, #53, #54 y #56).

- **Commit publicado:** `cad7f320a78147b339dfaac0649560c789ccac79`, de `main`.
- **Regla crítica de git:** queda cumplida otra vez.
  - Antes, el portal y el Worker de producción salían de ramas de Tender Cat sin
    fusionar (`887bba550816` y `fcc737`).
  - Ahora los cuatro componentes salen del mismo commit de `main`.
- **Migraciones:** no había ninguna pendiente.
  - En D1, `wrangler d1 migrations list` responde «No migrations to apply».
  - En PostgreSQL ya existían las tablas de los gatos (`support.settings`,
    `purchasing.settings`) y la columna del portal
    (`billing_subscriptions.entitlement_applied_until`).
- **Pruebas sobre `main`:**
  - Worker: 723 de 725. Las 2 que fallan son las conocidas de reloj,
    `radar.test.ts` y `radar-routing.test.ts`. `npx tsc --noEmit` pasa sin errores.
  - Portal y servicio de Tender: 75 y 14 pruebas, validadas por la sesión de Tender
    en el PR #56.

## Qué llega a producción

- **Portal:**
  - encabezado estándar en todas las páginas;
  - tendencia de 14 días y actividad reciente en el Inicio;
  - «MeowLab» en lugar de «Manolo»;
  - `apiFetch` y sesión con token, solo para la app, que no se publica todavía;
  - `/agentes/licitaciones` simplificada a «Destacadas de la semana».
- **Bridge:**
  - operación de actividad para el portal;
  - reloj inyectado en Collections;
  - activación por pago de Sales Cat.
- **Worker:**
  - mensajes de facturación sin «FacturaYa»;
  - error de extracción legible, a partir de `data.error`;
  - Tender Cat (bases por WhatsApp y «Me interesa»), ahora desde `main`.
- **Dependencias:** `@hono/node-server` 2 en el portal y las de desarrollo del
  Worker al día.

## 1. Bridge

- **Release:** `main-20261121T035915Z`, en `/opt/manolo-platform/releases/`.
  - Se armó con `infra/vps/stage-bridge-release.sh`, a partir del `git archive` del
    commit enviado por stdin.
  - Imagen nueva: `manolo-platform-bridge:main-20261121T035915Z`.
  - Imagen anterior, guardada como `manolo-platform-bridge:rollback-main-20261121T035915Z`.
- **Antes del cutover:** `infra/vps/compose.yml` coincidía con el del VPS. En
  `package.json` y `package-lock.json` solo cambiaban dependencias de desarrollo.
- **`cutover.sh`:**
  - `host_source_synced` y `bridge_running_new_image`;
  - comprobaciones firmadas de `companies-check.mjs`:
    - `billing`: not_linked;
    - `mine` y `lookup`: ok;
    - `team`, `weekly`, `collections`, `reorder` y `support`: forbidden para una
      cuenta ajena;
    - `preview`: invalid;
  - resultado: `cutover_verified`.
- **Logs del bridge:** sin errores después del cambio.
- **Rollback:**

  ```sh
  bash /opt/manolo-platform/releases/main-20261121T035915Z/rollback.sh
  ```

## 2. Portal y servicio de Tender Cat

- **Imágenes:**
  - `meowlab-app:cad7f320a781` y `meowlab-tender-service:cad7f320a781`;
  - construidas desde el `git archive` de `apps/meowlab-app` y `apps/tender-service`,
    en `/opt/manolo-platform/releases/portal-cad7f320a781/src`;
  - el `.env` anterior quedó como `previous.env` en el mismo directorio.
- **Cambio:**
  - en `/opt/meowlab-app/deploy/.env`, `MEOWLAB_APP_TAG` pasa de `887bba550816` a
    `cad7f320a781`;
  - `docker compose config --quiet` OK;
  - `docker compose up -d --no-deps tender-service app`.
- **Verificación:**
  - los dos contenedores quedan `healthy`;
  - `/`, `/api/health`, `/inicio`, `/agentes`, `/agentes/licitaciones` y
    `/agentes/facturacion` responden 200;
  - `/api/me` sin sesión responde 401;
  - Mercado Pago sigue en producción (`MERCADOPAGO_TEST_MODE=false`);
  - el webhook sin firma se rechaza: 400 con cuerpo vacío y 401
    `invalid_signature` con datos;
  - el bundle incluye «chat de MeowLab» y la pantalla de acceso muestra los textos
    nuevos (revisada en Chrome, sin sesión iniciada);
  - sin errores en los logs del portal ni del servicio.
- **Rollback:** devuelve los dos contenedores a `887bba550816`.

  ```sh
  bash /opt/manolo-platform/releases/portal-cad7f320a781/rollback.sh
  ```

## 3. Worker

- **Desde dónde:** worktree limpio en el commit publicado, con `npm ci` y `tsc`
  sin errores.
- **Antes de desplegar:** `--dry-run` con los mismos bindings que la versión viva
  `509a3384`:
  - Durable Object `WHATSAPP_BURSTS`;
  - D1 `DB` y `PRINT_DB`;
  - R2 `ENTERPRISE_DOCUMENTS`;
  - `BROWSER`.

  Las 23 variables de entorno coinciden con las de esa versión.
- **Despliegue:**

  ```sh
  wrangler deploy --env production --message "main cad7f320a781 (reintegración Tender Cat + marca única)"
  ```

  La versión `9c8dc2a1-d56f-47c7-9dc5-a812b9fcbb5a` queda al 100 %.
- **Verificación:**
  - `/health` responde 200;
  - la verificación del webhook con un token incorrecto responde 403;
  - `POST /webhooks/whatsapp` y `POST /webhooks/kapso` sin firma responden 401.
- **Rollback:**

  ```sh
  npx wrangler rollback 509a3384-3b7d-4289-b0d2-e7e77b6dd833 --env production
  ```

## Pendiente

- **Recorrido real por WhatsApp:** no se probó en este despliegue; no se usó el
  teléfono de prueba del operador.
- **Portal con sesión iniciada:** queda revisar el Inicio, la actividad y la lista de
  licitaciones.
- **Compra real con Mercado Pago en producción:** la hace el operador.
- **Trabajo en curso de AGY-1, AGY-2 y AGY-3:** todavía no está en `main` (Sales Cat
  fase 3, activación de todos los gatos por pago y Stock Cat fase 2).
