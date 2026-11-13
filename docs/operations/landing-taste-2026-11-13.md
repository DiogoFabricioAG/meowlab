# Landing rediseñada con taste-skill

Fecha: 13/11/2026. Pedido y autorizado por el operador («Sí, despliégala»).

## Qué se desplegó

- Commit publicado `d08578ba8df8e628c6c0b1a95080d8872d1ac912` (`feat/landing-taste-live`): el
  rediseño de `feat/landing-taste` unido sobre la landing en producción (`74d1b`), que
  conserva la conexión con app.meowlab.tech, las imágenes WebP, el logo BIMI y
  `Dockerfile.deploy`. Las páginas legales quedan idénticas a las de producción.
- Imagen `meowlab-web:d08578ba8df8`, construida con `Dockerfile.deploy` desde `git archive`
  del commit (sin `apps/` ni `docs/`). Antes: `meowlab-web:cf06e204412f`, que queda detenido
  como `meowlab-web-prev-cf06e204412f`.
- Método: taste-skill (tipo software, colores y fuentes de la marca, momentos iris-opens y
  word-highlight). `GATE: PASS` sobre la versión unida, con una excepción documentada en
  `.taste-skill/waivers.json` (el escenario que inserta el propio kit en `#portal`).

## Verificación

- Candidata en `manolo_ingress`: `/`, `/privacidad/`, `/terminos/`, `/contacto/`,
  `/meowlab-bimi.svg`, `/taste/system.css` y `/share.jpg` 200.
- Público: `meowlab.tech`, `www.meowlab.tech`, `/privacidad/`, `/terminos/`, `/contacto/`,
  `/meowlab-bimi.svg`, `/share.jpg`, `app.meowlab.tech` y `facturas.meowlab.tech/api/health`
  200; el inicio muestra el nuevo titular.

## Pendientes

- Revisar a mano los anchos de tablet (768–1024 px), que el gate no mide.
- Fuentes en TTF (284 KB): pasarlas a WOFF2.
- Definir el destino real del «Libro de Reclamaciones» (se quitó el enlace que iba a
  `/contacto`).

## Rollback

```bash
docker rm -f meowlab-web && docker rename meowlab-web-prev-cf06e204412f meowlab-web \
  && docker update --restart=unless-stopped meowlab-web && docker start meowlab-web
```

## Títulos en Blinker negrita (13/11/2026, autorizado: «Sí, despliégala»)

- Commit publicado `ff6a51284b91801b89bbe660d5c2abdd47ffbdaf` (`feat/landing-taste-live`):
  `--display-weight` 700 y tracking ajustado, como en app.meowlab.tech; el logo de la barra
  con el mismo peso que el del portal. Gate de taste-skill en PASS.
- Imagen `meowlab-web:ff6a51284b91` (antes `meowlab-web:d08578ba8df8`, detenido como
  `meowlab-web-prev-d08578ba8df8`).
- Verificación: candidata y público con `/`, `www`, `/privacidad/`, `/terminos/`,
  `/contacto/`, `/meowlab-bimi.svg` y `app.meowlab.tech` 200; el HTML servido trae el peso 700.
- Rollback: `docker rm -f meowlab-web && docker rename meowlab-web-prev-d08578ba8df8 meowlab-web && docker update --restart=unless-stopped meowlab-web && docker start meowlab-web`.

## Logos de los agentes en la landing y el portal (13/11/2026, autorizado: «Sí, despliega ambos»)

Los 7 logos de `feat/agent-logos-webp` (`27940`), sin cambios.

- **Landing:** commit publicado `18a507764f75ad1b73d0fd577db28e39b3626fb8` (`feat/landing-logos`), imagen
  `meowlab-web:18a507764f75` (antes `meowlab-web:ff6a51284b91`, detenido como
  `meowlab-web-prev-ff6a51284b91`). Logos en «un solo chat», la lista de precios (sin logos
  bajo 480 px para que no invada la sección siguiente) y la tarjeta del plan. Gate de
  taste-skill en PASS. Candidata y público: inicio, www, legales, contacto, BIMI y logos 200.
  Rollback: `docker rm -f meowlab-web && docker rename meowlab-web-prev-ff6a51284b91 meowlab-web && docker update --restart=unless-stopped meowlab-web && docker start meowlab-web`.
- **Portal:** commit publicado `05019f9bc85422fcfcbe24482e617c77573d52da` (`feat/agent-logos-app`), imagen
  `meowlab-app:05019f9bc854` (antes `meowlab-app:395204fb1cc5`). Logos en las fichas, el Hoy de
  Inicio y los encabezados de Invoice Cat y Tender Cat. `healthy`; `/`, `/inicio`, `/agentes` y
  `/agents/*.webp` 200; `/api/me` sin sesión 401. Vitest 31/31.
  Rollback: `cd /opt/meowlab-app/deploy && MEOWLAB_APP_TAG=395204fb1cc5 docker compose up -d`.

