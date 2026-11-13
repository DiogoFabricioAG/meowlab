# Despliegue del portal app.meowlab.tech: transición suave en auth

Fecha: 12/11/2026 (21:37 UTC-5 / 02:37 UTC del 13/11). Autorizado por el operador («Sí»).
Commit publicado: `04f107c72db854fba31eb5c8cbca8c3228a478b2` (rama `feat/app-login-transition`).
Imagen Docker: `meowlab-app:04f107c72db8`, construida en el VPS con `Dockerfile` desde el `git archive` del commit publicado.

## Qué se publicó

- **Píldora deslizante fluida en el selector de autenticación:**
  - Indicador flotante acelerado por hardware (`transform: translate3d` / `translate-x-0` a `translate-x-full`) con curva de aceleración natural `cubic-bezier(0.16, 1, 0.3, 1)`.
  - Transición fluida de color de texto entre las pestañas "Iniciar sesión" y "Crear cuenta".
  - Accesibilidad preservada (`role="tab"`, `aria-selected`, navegación por teclado y `motion-reduce:transition-none`).
- **Expansión y colapso suave de campos del formulario:**
  - Animación fluida de altura intrínseca mediante CSS Grid (`grid-template-rows: 0fr` a `1fr`) y opacidad para el campo `Nombre`.
  - En modo *Iniciar sesión*, el campo se desactiva con `tabIndex={-1}` y `required={false}` para evitar bloqueos de validación o foco invisible.
- **Transiciones de textos de soporte:**
  - Transición de opacidad en la ayuda de contraseña (`Mínimo 10 caracteres`), botón de acción (`Entrar` ↔ `Crear cuenta`) y textos de pie de página (`Términos y condiciones` ↔ `¿Olvidaste tu contraseña?`).

## Procedimiento de entrega en el VPS

1. Commit `04f107c72db854fba31eb5c8cbca8c3228a478b2` publicado en `origin/feat/app-login-transition`.
2. Archivo del código transferido a `~/releases/meowlab-app-04f107c72db8`.
3. Construcción de la imagen Docker en el VPS:
   `docker build -t meowlab-app:04f107c72db8 ~/releases/meowlab-app-04f107c72db8`
4. Despliegue con Compose en `/opt/meowlab-app/deploy`:
   `MEOWLAB_APP_TAG=04f107c72db8 docker compose up -d --no-deps app`
5. Comprobación de salud:
   `docker exec meowlab-app wget -qO- http://127.0.0.1:8080/healthz` -> `{"status":"ok"}`.

## Verificación en producción

- **Público (`https://app.meowlab.tech`):** HTTP/2 200, bundle `index-Dhgs6wmB.js` y `index-cX4DWWlQ.css` en vivo.
- **Salud del contenedor:** `meowlab-app` en estado `Up (healthy)`.
- **API Health:** `https://app.meowlab.tech/api/health` -> `{"status":"ok","service":"meowlab-app"}`.
- **Servicios adyacentes:** `meowlab.tech`, `radar.meowlab.tech` y `facturas.meowlab.tech` respondiendo HTTP/2 200.

## Rollback

En caso de requerir volver a la versión previa:

```bash
ssh meowlab
cd /opt/meowlab-app/deploy
MEOWLAB_APP_TAG=fbfcf294de82 docker compose up -d --no-deps app
```
