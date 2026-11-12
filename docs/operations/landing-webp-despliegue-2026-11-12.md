# Despliegue de la landing con imágenes comprimidas en WebP

Fecha: 12/11/2026 (16:02 UTC). Autorizado expresamente por el operador: «Despliegadlo».
Commit publicado: `d7cf736da0ea221c99f58e1a6bf2078b83f2a702` (rama `feat/landing-webp-images`).
Imagen Docker: `meowlab-web:d7cf736da0ea`, construida en el VPS con `Dockerfile.deploy` desde el `git archive` del commit publicado.

## Qué se publicó

- **Imágenes WebP (Q88):** 14 recursos rasterizados convertidos a formato WebP con calidad 88 (PSNR visible >45 dB), logrando una reducción del 88.3% del peso total de imágenes.
- **Variantes de agentes para fondo claro:** Creación de `gato-facturas-light.webp`, `gato-licitaciones-light.webp` y `gato-ventas-light.webp` en WebP transparente nativo invertido (~60–70 KB c/u), reemplazando los envoltorios SVG de 540–670 KB que incrustaban PNGs en base64 y ejecutaban filtros en el navegador.
- **Componentes actualizados:** Se actualizaron `MeowLogo.astro`, `AgentesDetalle.astro`, `WhatsAppChatRuntime.astro`, `DashboardSupervision.astro`, `AgentFlowDemo.tsx`, `CatIllustration.astro`, `FinalCta.astro`, `WorkingAgents.astro` y `Header.astro` para referenciar los archivos `.webp` e incluir atributos explícitos `width`, `height` y `decoding="async"`.
- **PNG de respaldo:** Se optimizaron in situ los PNG originales con `optimize=True`.

## Procedimiento de entrega en el VPS

1. Archivo limpio generado con `git archive` del commit publicado `d7cf736da0ea221c99f58e1a6bf2078b83f2a702` y transferido a `~/releases/meowlab-landing-d7cf736da0ea`.
2. Construcción de imagen `meowlab-web:d7cf736da0ea` con `Dockerfile.deploy` (Node 22 / pnpm / Astro 5 -> Nginx Alpine).
3. Prueba aislada de contenedor temporal en puerto `18980`: rutas estáticas y cabeceras `image/webp` respondieron HTTP 200.
4. Reemplazo seguro de contenedor:
   - Contenedor activo anterior (`meowlab-web:381c3b31bde5`) detenido y renombrado a `meowlab-web-prev-381c3b31bde5`.
   - Nuevo contenedor `meowlab-web` iniciado con red `manolo_ingress` y política de reinicio `unless-stopped`.

## Verificación

- **Público principal (`https://meowlab.tech`):** HTTP/2 200, HTML servido consumiendo exclusivamente recursos `.webp`.
- **Rutas secundarias:** `/contacto/`, `/privacidad/`, `/terminos/` respondiendo HTTP/2 200.
- **Recursos estáticos verificados:**
  - `https://meowlab.tech/assets/meowlab-black.webp`: HTTP/2 200, `Content-Type: image/webp` (16.3 KB, antes 688.4 KB).
  - `https://meowlab.tech/assets/gato-facturas-light.webp`: HTTP/2 200, `Content-Type: image/webp` (62.7 KB, antes 543.9 KB).
  - `https://meowlab.tech/meowlab-bimi.svg`: HTTP/2 200, `Content-Type: image/svg+xml`.
- **Dominios y servicios adyacentes en el VPS (Caddy):**
  - `https://www.meowlab.tech/`: HTTP/2 200.
  - `https://app.meowlab.tech/`: HTTP/2 200 (portal de usuarios intacto).
  - `https://radar.meowlab.tech/`: HTTP/2 200.
  - `https://facturas.meowlab.tech/`: HTTP/2 200.

## Impacto de rendimiento

- Carga de imágenes en la página de inicio: reducida de **3.79 MB** a **0.40 MB** (**89.4% de reducción de payload**).
- Carga de imágenes en `/contacto`: reducida de **754 KB** a **31 KB** (**95.9% de reducción**).

## Rollback

En caso de requerir volver a la versión previa:

```bash
ssh meowlab
docker stop meowlab-web && docker rm meowlab-web
docker rename meowlab-web-prev-381c3b31bde5 meowlab-web
docker update --restart=unless-stopped meowlab-web && docker start meowlab-web
```
