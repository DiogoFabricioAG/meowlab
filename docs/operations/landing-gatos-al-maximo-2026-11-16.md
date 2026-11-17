# Despliegue de la landing: cada gato a su máxima capacidad

- **Fecha:** 16/11/2026.
- **Autorización:** el operador lo pidió con «Sí, despliégala», después de fusionar el PR #12.
- **Commit publicado:** `98dff71bf3571df51d3d2c8dd393859a86784372` (`main`, «Landing: cada gato a su máxima capacidad; Sales Cat como cara del negocio (#12)»).
- **Imagen Docker:** `meowlab-web:98dff71bf357`. Se construyó en el VPS con `Dockerfile.deploy`, a partir del `git archive` del commit publicado, en `~/releases/meowlab-landing-98dff71bf357`.

## Qué se publicó

Las conversaciones del recorrido `#gatos` muestran cadenas completas que ya funcionan:

- **Invoice:** boleta emitida con solo el DNI del cliente, que luego avisa a Stock Cat.
- **Stock:** lee la foto de la factura del proveedor.
- **Collections:** valida la captura de Yape del cliente.
- **Support:** recibe un reclamo y entrega la respuesta del equipo.
- **Tender:** evalúa una licitación.

El paso de Sales Cat muestra su fase 2, que todavía no está en producción. Por decisión del operador lleva la etiqueta «Próximamente» y una línea con lo que Sales hace hoy.

## Procedimiento en el VPS

1. **Prueba de humo en un contenedor temporal:** `/`, `/precios/` y `/contacto/` respondieron HTTP 200, y la portada ya traía el recorrido nuevo con la etiqueta de Sales.
2. **Respaldo del contenedor anterior:** `meowlab-web:b2cb2a2967f0` se detuvo y quedó como `meowlab-web-prev-b2cb2a2967f0`, con `--restart=no`.
3. **Contenedor nuevo:** `meowlab-web` arrancó con la imagen `meowlab-web:98dff71bf357`, en la red `manolo_ingress` y con `--restart unless-stopped`.

## Verificación en producción

- `https://meowlab.tech/`, `/precios/`, `/contacto/`, `/privacidad/` y `/terminos/` responden HTTP 200.
- El HTML público contiene «Próximamente» una sola vez (en el paso de Sales) y no contiene «Manolo».
- Prueba con Chrome headless sobre `https://meowlab.tech/` en el paso de Sales: la conversación llega a 10 mensajes, con la captura de Yape dibujada, la cotización `Cotizacion-000057.pdf` y la boleta `B001-1033.pdf`.

## Rollback

```bash
ssh meowlab
docker stop meowlab-web && docker rm meowlab-web
docker rename meowlab-web-prev-b2cb2a2967f0 meowlab-web
docker update --restart=unless-stopped meowlab-web && docker start meowlab-web
```
