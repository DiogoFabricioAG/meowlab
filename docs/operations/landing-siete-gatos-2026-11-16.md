# Despliegue de la landing: los siete gatos y qué es MeowLab

- **Fecha:** 16/11/2026.
- **Autorización:** el operador lo pidió expresamente («Sí, despliégala») tras fusionar el PR #8.
- **Commit publicado:** `7a058ca8a4c5894d9234223319640a2af19cf32b` (`main`, «Landing: los siete gatos disponibles y qué es MeowLab (#8)»).
- **Imagen Docker:** `meowlab-web:7a058ca8a4c5`, construida en el VPS con `Dockerfile.deploy` desde el `git archive` del commit publicado, en `~/releases/meowlab-landing-7a058ca8a4c5`.

## Qué se publicó

- **Los siete gatos aparecen como «Disponible»** en `#agentes`. La nueva sección `#gatos` explica lo que hace cada uno hoy.
- **`#un-chat` explica qué es MeowLab.**
- **Nueva sección `#juntos`:** Support Cat, Sales Cat y Stock Cat atienden juntos a una clienta.
- **El chat se llama MeowLab** en la landing, en privacidad y en términos.

## Procedimiento en el VPS

1. Prueba de humo con un contenedor temporal: la página trae `id="juntos"` y «Qué es MeowLab», y ningún «Próximamente».
2. El contenedor anterior (`meowlab-web:18a507764f75`) se detuvo y quedó como `meowlab-web-prev-18a507764f75`, con `--restart=no`.
3. Se inició el nuevo `meowlab-web` con la imagen `meowlab-web:7a058ca8a4c5`, en la red `manolo_ingress`, con `--restart unless-stopped`.

## Verificación en producción

- Responden HTTP 200: `https://meowlab.tech/`, `/contacto/`, `/privacidad/`, `/terminos/` y `/assets/agents/support-cat.webp`.
- El HTML público contiene `id="juntos"` y «Qué es MeowLab», y no contiene «Próximamente» ni «Manolo».

## Rollback

```bash
ssh meowlab
docker stop meowlab-web && docker rm meowlab-web
docker rename meowlab-web-prev-18a507764f75 meowlab-web
docker update --restart=unless-stopped meowlab-web && docker start meowlab-web
```
