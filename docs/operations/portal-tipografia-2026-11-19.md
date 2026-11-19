# Despliegue del portal: títulos en Crete Round, textos y montos en Figtree

- **Fecha:** 19/11/2026.
- **Autorización:** el operador lo pidió («Sí, despliégalo») después de fusionar meowlab#22.
- **Commit publicado:** `8a6aee5f008faf001e32c7f25324b40cd693404b` (`main`, «Portal: títulos en Crete Round y textos y montos en Figtree (#22)»).
- **Imagen:** `meowlab-app:8a6aee5f008f`. La anterior era `meowlab-app:d932a980e1dc`. Se construyó en el VPS a partir del `git archive` de `apps/meowlab-app` en ese commit (`/tmp/meowlab-app-8a6aee5f008f`).

## Qué cambia

El cambio es solo visual. No hay migraciones, ni cambios de API, ni de datos.

- **Títulos:** Crete Round. Lleva `font-synthesis: none` para que no se dibuje una negrita falsa.
- **Textos, botones y montos:** Figtree.
- **Logotipo:** sigue en Blinker.
- **Actor:** ya no se carga.

## Verificación

- **Antes del cambio:** en la imagen nueva, `dist/index.html` carga Blinker, Crete Round y Figtree, ya no Actor, y el CSS compilado contiene Crete Round.
- **Contenedor:** `MEOWLAB_APP_TAG=8a6aee5f008f docker compose up -d` en `/opt/meowlab-app/deploy`. El contenedor quedó `healthy`.
- **Rutas:** `https://app.meowlab.tech/`, `/inicio` y `/agentes` responden 200. `/api/companies` sin sesión responde 401.
- **Navegador:** con Chrome headless sobre producción, los títulos usan Crete Round con `font-synthesis: none` y el cuerpo usa Figtree.

## Rollback

```sh
cd /opt/meowlab-app/deploy && MEOWLAB_APP_TAG=d932a980e1dc docker compose up -d
```
