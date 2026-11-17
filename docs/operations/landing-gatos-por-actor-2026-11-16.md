# Despliegue de la landing: cada gato con una pestaña por actor

- **Fecha:** 16/11/2026.
- **Autorización:** el operador lo pidió con «Sí, despliégala», después de fusionar el PR #15.
- **Commit publicado:** `0b66b18e71afe93ae45285e5a5d3d061000c4bc5`, de `main` («Landing: cada gato con una pestaña por actor según la matriz (#15)»).
- **Imagen Docker:** `meowlab-web:0b66b18e71af`. Se construyó en el VPS con `Dockerfile.deploy` a partir del `git archive` del commit publicado, en `~/releases/meowlab-landing-0b66b18e71af`.

## Qué se publicó

- **Pestañas por actor.** Cada paso del recorrido `#gatos` tiene una pestaña por cada actor con el que trabaja el gato: cliente, dueño o proveedor. Cada pestaña indica el tipo de participación según `docs/project/matriz-participacion.md`.
- **Conversaciones.** Son 14 pestañas, cada una con su propia conversación.
- **Pestañas marcadas «Próximamente».** Las que muestran algo que aún no está construido llevan esa etiqueta y una línea con lo que el gato hace hoy.
- **Lo que pasa entre gatos.** Aparece en tarjetas debajo de las pestañas.

(El PR #15 y el tablero hablaban de «quince conversaciones»; son 14.)

## Procedimiento en el VPS

1. **Prueba de humo** en un contenedor temporal: `/`, `/precios/` y `/contacto/` respondieron HTTP 200, y la portada traía las 14 pestañas.
2. **Respaldo del contenedor anterior:** `meowlab-web:98dff71bf357` se detuvo y quedó como `meowlab-web-prev-98dff71bf357`, con `--restart=no`.
3. **Contenedor nuevo:** `meowlab-web` con la imagen `meowlab-web:0b66b18e71af`, en la red `manolo_ingress` y con `--restart unless-stopped`.

## Verificación en producción

- `https://meowlab.tech/`, `/precios/`, `/contacto/`, `/privacidad/` y `/terminos/` responden HTTP 200.
- El HTML público no contiene «Manolo».
- Con Chrome headless sobre `https://meowlab.tech/`, un clic en «Con el proveedor» de Reorder Cat abre el chat «MeowLab». Su conversación mostró 3 mensajes y la tarjeta «Reorder Cat → Tú».

## Rollback

```bash
ssh meowlab
docker stop meowlab-web && docker rm meowlab-web
docker rename meowlab-web-prev-98dff71bf357 meowlab-web
docker update --restart=unless-stopped meowlab-web && docker start meowlab-web
```
