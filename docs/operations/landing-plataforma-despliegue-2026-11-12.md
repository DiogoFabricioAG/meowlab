# Despliegue de la landing con conexión a la plataforma web (app.meowlab.tech)

Fecha: 12/11/2026 (16:25 UTC). Solicitado expresamente por el operador: «Algo que me falla creo es que no hay una conexión con la landing con la plataforma, lo podrias hacer porfa ... Sí, para que swse conecten por ahí, en vez de ese boton de conversar por whatsapp».
Commit publicado: `cf06e204412f8edac13305bc70c694a317c4cbf7` (rama `feat/landing-webp-images`).
Imagen Docker: `meowlab-web:cf06e204412f`, construida en el VPS con `Dockerfile.deploy` desde el `git archive` del commit publicado.

## Qué se publicó

- **Conexión integral Landing → Plataforma Web (`https://app.meowlab.tech`):**
  - **Navbar desktop:** Agregado enlace de texto «Iniciar sesión» y botón principal «Ingresar a la plataforma».
  - **Navbar & Drawer móvil:** Botón visible «Plataforma» en la barra compacta y botón de ancho completo «Ingresar a la plataforma» dentro del cajón móvil.
  - **Hero CTA:** Reemplazado el enlace de WhatsApp por el botón primario «Ingresar a la plataforma» hacia `https://app.meowlab.tech`.
  - **Supervisión (`DashboardSupervision.astro`):** CTA principal actualizado a «Ir a la plataforma» (`https://app.meowlab.tech`).
  - **Preguntas Frecuentes (`Faq.astro`):** CTA de soporte y prueba configurado hacia «Ingresar a la plataforma» (`https://app.meowlab.tech`).
  - **Modal de agentes (`AgentesDetalle.astro`):** Botón de activación actualizado a «Activar en la plataforma» (`https://app.meowlab.tech`).
  - **Footer (`Footer.astro`):** Agregados enlaces permanentes al portal web: «Portal web (app.meowlab.tech)» e «Iniciar sesión en la plataforma».
- **Tablero:** Tarea `landing-conectar-plataforma-web-20261112` cerrada en `docs/project/board.json` y `board.html` regenerado.

## Procedimiento de entrega en el VPS

1. Commit `cf06e204412f8edac13305bc70c694a317c4cbf7` publicado en `origin/feat/landing-webp-images`.
2. Archivo transferido a `~/releases/meowlab-landing-cf06e204412f`.
3. Construcción de imagen `meowlab-web:cf06e204412f` con `Dockerfile.deploy` (Astro 5 static build -> Nginx Alpine).
4. Reemplazo seguro de contenedor:
   - Contenedor activo anterior (`meowlab-web:d7cf736da0ea`) detenido y respaldado como `meowlab-web-prev-d7cf736da0ea`.
   - Nuevo contenedor `meowlab-web` iniciado con imagen `meowlab-web:cf06e204412f` en red `manolo_ingress` y `--restart unless-stopped`.

## Verificación en producción

- **Público principal (`https://meowlab.tech`):** HTTP/2 200.
- **Ruta de contacto (`https://meowlab.tech/contacto/`):** HTTP/2 200.
- **Enlaces a la plataforma verificados en HTML:** 12 referencias activas a `https://app.meowlab.tech` distribuidas en Navbar, Hero, Supervisión, Preguntas Frecuentes, Modales de agentes y Footer.
- **Recursos estáticos e imágenes:** WebP funcionando con HTTP 200 y headers correctos.

## Rollback

En caso de requerir volver a la versión previa:

```bash
ssh meowlab
docker stop meowlab-web && docker rm meowlab-web
docker rename meowlab-web-prev-d7cf736da0ea meowlab-web
docker update --restart=unless-stopped meowlab-web && docker start meowlab-web
```
