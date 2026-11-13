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
