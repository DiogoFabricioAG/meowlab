# Despliegue: alta de empresa sin RUC (T2) y landing con Astro 7 (T4)

Fecha: 21/11/2026, 01:40 en Lima (06:40 UTC). Lo autorizó el operador («Sí, despliega ambos»).

- **Commit publicado:** `5b927b7798d23e3c7dd87f0e86a60eb3a5c61df7`, de `main`, con los PR #69 (T2) y #64 (T4).
- **Pruebas en `main`:**
  - Worker: 748 de 748.
  - Portal: 83 de 83, sin errores de tipos y con el build OK.
  - Landing: `check`, 6 pruebas y build, en Node 22.23 o superior.
- **Revisión visual previa** (coordinador, build de la rama con datos de ejemplo): la bienvenida en sus tres caminos y el formulario sin RUC a 1366 y 375 px, sin scroll horizontal.
- **Worker:** no cambia; sigue esperando T5.

## Qué cambia

- **Portal (T2, ADR-0019):**
  - La bienvenida ofrece tres caminos: «Tengo RUC» (búsqueda en SUNAT), «Todavía no tengo RUC o prefiero no darlo» (nombre, más rubro y ciudad opcionales) y «Me invitaron a una empresa».
  - Una empresa sin RUC puede usar todos los gatos menos Invoice Cat. Invoice Cat pide «Agregar RUC», y el formulario está en Configuración, solo para la titular.
  - El bridge acepta `create` sin RUC y la acción nueva `set_ruc`, que valida en SUNAT y no admite un RUC ya tomado.
  - Hay un límite de 3 empresas propias por cuenta.
- **Landing (T4):**
  - Pasa de Astro 5 a 7.4.13, con Tailwind 3 por PostCSS en lugar de `@astrojs/tailwind`.
  - `pnpm audit`: de 1 crítica, 19 altas, 23 moderadas y 9 bajas a 0, 8, 10 y 4.
  - El diseño no cambia: la comparación de 24 capturas difiere en menos del 0,09 % de los píxeles.

## 1. Migración del bridge

- **Respaldo previo:** `pg_dump -Fc -t whatsapp.tenants` en `/opt/manolo-platform/releases/migr-5b927b7798d2/tenants-before.dump`, con modo 600.
- **`024-company-without-ruc.sql`:** agrega a `whatsapp.tenants` las columnas opcionales `sector` y `city`. Se aplicó con `manolo_app`, en una transacción, y se verificaron las dos columnas.

## 2. Bridge

- **Release:** `main-20261121T063947Z`.
- **Resultado:** `compose.yml` sin cambios y `cutover_verified`.
- **Rollback:**

  ```sh
  bash /opt/manolo-platform/releases/main-20261121T063947Z/rollback.sh
  ```

## 3. Portal y servicio de Tender Cat

- **Cambio:** `MEOWLAB_APP_TAG` pasa de `9d64c7d6ae16` a `5b927b7798d2`.
- **Verificación:**
  - los dos contenedores quedan `healthy`;
  - `MERCADOPAGO_TEST_MODE=false`;
  - `/`, `/api/health`, `/inicio`, `/plan` y `/ajustes` responden 200.
- **Rollback:**

  ```sh
  bash /opt/manolo-platform/releases/portal-5b927b7798d2/rollback.sh
  ```

## 4. Landing

- **Imagen:** `meowlab-web:5b927b7798d2`, construida en el VPS con `Dockerfile.deploy` desde `git archive`. La base `node:22-alpine` cumple el mínimo de Astro 7.
- **Prueba de humo en un contenedor temporal:** `/`, `/precios/`, `/contacto/`, la fuente WOFF2 y la captura de Yape responden 200.
- **Cambio:** el contenedor anterior quedó como `meowlab-web-prev-4ddbb6052f72`, con `--restart=no`.
- **Producción:**
  - `/`, `/precios/`, `/contacto/`, `/privacidad/` y `/terminos/` responden 200;
  - `generator`: Astro v7.4.13;
  - sin scroll horizontal a 360, 390, 768, 1024 y 1440 px, y con las fuentes Blinker y Actor cargadas.
- **Rollback:**

  ```bash
  docker stop meowlab-web && docker rm meowlab-web
  docker rename meowlab-web-prev-4ddbb6052f72 meowlab-web
  docker update --restart=unless-stopped meowlab-web && docker start meowlab-web
  ```

## Nota para desarrollo local

Astro 7 exige Node 22.23.4 o superior. El equipo del operador tiene Node 22.17.1: para correr la landing en local hay que actualizar Node.
