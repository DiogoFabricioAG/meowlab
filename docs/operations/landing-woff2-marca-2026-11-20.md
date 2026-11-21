# Despliegue de la landing: marca única, fuentes WOFF2 y tablet

Fecha: 20/11/2026. Lo pidió el operador («Sí, la landing») después de fusionar los PR #32 y #33.

- **Commit publicado:** `4ddbb6052f723adf6f5cd8889947e484921a4e30`, de `main` («perf(landing): fuentes WOFF2 y revisión responsive tablet (768–1024 px) (#33)»).
- **Imagen Docker:** `meowlab-web:4ddbb6052f72`. Se construyó en el VPS con `Dockerfile.deploy`, a partir del `git archive` del commit publicado, en `~/releases/meowlab-landing-4ddbb6052f72`.

## Qué se publicó

- **Marca única (PR #32):** la landing ya no menciona «FacturaYa».
  - FAQ: «Invoice Cat los emite ante SUNAT después de que confirmas el borrador en el chat».
  - Sello de Invoice Cat: «Emite ante SUNAT a través de sistemas autorizados, sin salir de WhatsApp».
- **Fuentes (PR #33):** Blinker y Actor pasan de TTF (284 KiB) a WOFF2 en subconjunto latino con los signos del español (79 KiB). Los `preload` apuntan a WOFF2. Los TTF siguen en `public/fonts/` sin referencias.
- **Tablet (PR #33):** entre 768 y 1024 px el teléfono del hero ya no se monta sobre la sección siguiente. Bajo 860 px el recorrido de los gatos se apila con el teléfono a 340 px. Las pantallas de 760 px de alto o menos, como 1280 px al 90 %, también quedan cubiertas.

## Procedimiento en el VPS

1. **Prueba de humo en un contenedor temporal** (`meowlab-web-smoke`, ya borrado):
   - `/`, `/precios/`, `/contacto/`, las dos fuentes precargadas y `/assets/landing/yape-captura.webp` respondieron HTTP 200;
   - el HTML precarga `Blinker-Regular.woff2`;
   - «FacturaYa» aparece 0 veces.
2. **Contenedor anterior:** `meowlab-web:130f6c1215c3` se detuvo y quedó como `meowlab-web-prev-130f6c1215c3`, con `--restart=no`.
3. **Contenedor nuevo:** `meowlab-web` arrancó con la imagen `meowlab-web:4ddbb6052f72`, en la red `manolo_ingress` y con `--restart unless-stopped`.

## Verificación en producción

- **Rutas:** `https://meowlab.tech/`, `/precios/`, `/contacto/`, `/privacidad/`, `/terminos/` y las fuentes `Blinker-Regular.woff2`, `Blinker-Bold.woff2` y `Actor-Regular.woff2` responden HTTP 200.
- **Navegador:** Chrome headless con emulación de dispositivo en 360, 390, 768, 1024 y 1440 px.
  - `scrollWidth` nunca supera el ancho de la ventana: no hay scroll horizontal.
  - Las fuentes cargadas son Blinker y Actor.

## Rollback

```bash
ssh meowlab
docker stop meowlab-web && docker rm meowlab-web
docker rename meowlab-web-prev-130f6c1215c3 meowlab-web
docker update --restart=unless-stopped meowlab-web && docker start meowlab-web
```
