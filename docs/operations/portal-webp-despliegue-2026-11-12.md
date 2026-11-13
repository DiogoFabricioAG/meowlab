# Despliegue del portal app.meowlab.tech con imágenes comprimidas en WebP

Fecha: 12/11/2026 (16:15 UTC). Solicitado por el operador: «mejora la de app.meowlab.tech, ya la plataforma» — «La reduccion de imagenes que tengas».
Commit publicado: `fbfcf294de82a48ee3f126d2f2e117b9837ce697` (rama `feat/landing-webp-images`).
Imagen Docker: `meowlab-app:fbfcf294de82`, construida en el VPS desde el `git archive` del commit publicado.

## Qué se publicó

- **Imágenes WebP (Q88):** Recursos rasterizados convertidos a formato WebP ligero:
  - `meowlab-black.webp` (16.7 KB, antes PNG de 705 KB, reducción del **97.6%**).
  - `meowlab-white.webp` (16.7 KB) para fondos oscuros sin depender de filtros CSS `invert`.
  - `gato-facturas-light.webp` (64.2 KB) reemplazando el SVG con PNG base64 incrustado de 557 KB (reducción del **88.5%**).
  - Disponibles además `gato-licitaciones-light.webp` (72.6 KB) y `gato-ventas-light.webp` (59.8 KB).
- **Componentes actualizados (`App.tsx`, `Panel.tsx`):**
  - Pantalla de carga y `Logo` consumen `meowlab-black.webp` y `meowlab-white.webp` con dimensiones explícitas (`width={36} height={36}` / `width={48} height={48}`) y `decoding="async"`.
  - Tarjeta de agente FacturaYa consume `gato-facturas-light.webp` (`width={48} height={48}` y `decoding="async"`).
- **Eliminación de peso muerto:** Se eliminó `gato-facturas-light.svg` (557 KB) y se optimizó el PNG de respaldo `meowlab-black.png`.
- **Impacto:** Carga combinada de imágenes al abrir el portal reducida de **1,262 KB** a **80.9 KB** (**93.6% de ahorro de transferencia**).

## Procedimiento de entrega en el VPS

1. Archivo limpio generado con `git archive` de `apps/meowlab-app` del commit publicado `fbfcf294de82a48ee3f126d2f2e117b9837ce697` y transferido a `~/releases/meowlab-app-fbfcf294de82`.
2. Construcción de la imagen Docker en el VPS:
   `docker build -t meowlab-app:fbfcf294de82 ~/releases/meowlab-app-fbfcf294de82`
3. Despliegue con Compose en `/opt/meowlab-app/deploy`:
   `MEOWLAB_APP_TAG=fbfcf294de82 docker compose up -d --no-deps app`
4. Comprobación de salud:
   `docker exec meowlab-app wget -qO- http://127.0.0.1:8080/healthz` -> `{"status":"ok"}`.

## Verificación

- **Público (`https://app.meowlab.tech`):** HTTP/2 200, CSP, HSTS, X-Frame-Options DENY.
- **Recursos WebP verificados:**
  - `https://app.meowlab.tech/meowlab-black.webp`: HTTP/2 200, `Content-Type: image/webp` (16.7 KB).
  - `https://app.meowlab.tech/meowlab-white.webp`: HTTP/2 200, `Content-Type: image/webp` (16.7 KB).
  - `https://app.meowlab.tech/gato-facturas-light.webp`: HTTP/2 200, `Content-Type: image/webp` (64.2 KB).
- **APIs:**
  - `/api/health`: 200 `{"status":"ok","service":"meowlab-app"}`.
  - `/api/config`: 200 `{"google":true,"passwordReset":false,"whatsappLinking":true}`.
- **Servicios vecinos intactos en Caddy:**
  - `https://meowlab.tech/` (200).
  - `https://radar.meowlab.tech/` (200).
  - `https://facturas.meowlab.tech/` (200).

## Rollback

```bash
ssh meowlab
cd /opt/meowlab-app/deploy
MEOWLAB_APP_TAG=13530a9c25c7 docker compose up -d --no-deps app
```
