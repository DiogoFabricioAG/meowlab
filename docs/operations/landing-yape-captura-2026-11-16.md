# Despliegue de la landing: captura real de Yape

Fecha: 16/11/2026. Lo pidió el operador («Sí, despliégala») después de fusionar los PR #16 y #17.

- **Commit publicado:** `130f6c1215c3fea8ccca9a383fd6b7a87b3d9f36`, de `main` («Landing: la captura real de Yape en los chats (#17)»).
- **Imagen Docker:** `meowlab-web:130f6c1215c3`. Se construyó en el VPS con `Dockerfile.deploy`, a partir del `git archive` del commit publicado, en `~/releases/meowlab-landing-130f6c1215c3`.

## Qué se publicó

Las burbujas de Yape de los chats de Sales y Collections ahora muestran la captura de la demo (`/assets/landing/yape-captura.webp`) en lugar de la burbuja dibujada. Los textos de esas conversaciones se cambiaron para que coincidan con la imagen: María Fernanda Castro, S/ 250, operación 41756321.

## Procedimiento en el VPS

1. **Prueba de humo en un contenedor temporal:** `/`, `/precios/` y `/assets/landing/yape-captura.webp` respondieron HTTP 200.
2. **Contenedor anterior:** `meowlab-web:0b66b18e71af` se detuvo y quedó como `meowlab-web-prev-0b66b18e71af`, con `--restart=no`.
3. **Contenedor nuevo:** `meowlab-web` arrancó con la imagen `meowlab-web:130f6c1215c3`, en la red `manolo_ingress` y con `--restart unless-stopped`.

## Verificación en producción

- **Rutas:** `https://meowlab.tech/`, `/precios/`, `/contacto/`, `/privacidad/`, `/terminos/` y `/assets/landing/yape-captura.webp` responden HTTP 200.
- **Captura en el chat:** se revisó con Chrome headless sobre `https://meowlab.tech/`. En el paso de Collections Cat («Con el dueño»), el chat muestra la captura cargada (420 px de ancho natural).

## Rollback

```bash
ssh meowlab
docker stop meowlab-web && docker rm meowlab-web
docker rename meowlab-web-prev-0b66b18e71af meowlab-web
docker update --restart=unless-stopped meowlab-web && docker start meowlab-web
```
