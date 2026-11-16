# Despliegue de la landing: rediseño con WhatsApp interactivo

- **Fecha:** 16/11/2026.
- **Autorización:** el operador lo pidió («Sí, despliégala») después de fusionar el PR #10.
- **Commit publicado:** `b2cb2a2967f0652015ec19b54e940b6e01d0a517` (`main`, «Landing: rediseño con WhatsApp interactivo y recorrido de los gatos (#10)»).
- **Imagen Docker:** `meowlab-web:b2cb2a2967f0`, construida en el VPS con `Dockerfile.deploy` desde el `git archive` del commit publicado, en `~/releases/meowlab-landing-b2cb2a2967f0`.

## Qué se publicó

- **Hero:** un celular con WhatsApp cuyos botones toca el visitante.
- **`#gatos`:** un recorrido con scroll, un paso por gato, con el celular fijo.
- **`#juntos`:** tarjetas animadas al ritmo del chat.
- **`#panel`:** el Inicio del portal.
- **Precios:** pasan a `/precios`.
- **Preguntas:** en acordeón.
- **Cierre:** en un bloque verde.

## Procedimiento en el VPS

1. **Prueba de humo en un contenedor temporal.** `/`, `/precios/` y `/contacto/` responden HTTP 200, y la portada trae `#gatos`, `#juntos` y `#panel`, sin «Próximamente».
2. **Respaldo del contenedor anterior.** `meowlab-web:7a058ca8a4c5` se detuvo y quedó como `meowlab-web-prev-7a058ca8a4c5`, con `--restart=no`.
3. **Nuevo contenedor.** `meowlab-web` arrancó con la imagen `meowlab-web:b2cb2a2967f0`, en la red `manolo_ingress` y con `--restart unless-stopped`.

## Verificación en producción

- **Rutas:** `https://meowlab.tech/`, `/precios/`, `/contacto/`, `/privacidad/`, `/terminos/`, `/assets/agents/tender-cat.webp` y el script de la página (`/_astro/…js`) responden HTTP 200.
- **Contenido:** el HTML público contiene `#gatos`, `#juntos` y `#panel`, y no contiene «Próximamente» ni «Manolo».
- **Chat del hero:** se probó con Chrome headless sobre `https://meowlab.tech/`. Tras tocar «Emitir», el chat muestra 4 mensajes y el PDF de la factura.

## Rollback

```bash
ssh meowlab
docker stop meowlab-web && docker rm meowlab-web
docker rename meowlab-web-prev-7a058ca8a4c5 meowlab-web
docker update --restart=unless-stopped meowlab-web && docker start meowlab-web
```
