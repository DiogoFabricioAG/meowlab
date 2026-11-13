# Portal app.meowlab.tech y páginas legales

Fecha: 11/11/2026 (12/11 01:00–01:10 UTC). Autorizado por el operador: «publica ya el
portal y las páginas legales». Commit publicado `381c3b31bde565570cd14aa5d3b708ffb070698f`
(rama `feat/app-meowlab-portal`).

## Qué se publicó

- **Landing** con `/privacidad` y `/terminos` (titular «MeowLab», contacto
  `privacy@meowlab.tech`), enlazadas desde el pie. Imagen `meowlab-web:381c3b31bde5`,
  construida con `Dockerfile.deploy` desde `git archive` del commit.
- **Portal** `app.meowlab.tech` (ADR-0006, fases 1 y 2 de código): registro e inicio
  de sesión con correo. Google queda apagado hasta tener el cliente OAuth. La
  vinculación del WhatsApp muestra «todavía no está disponible»: el bridge, Manolo y
  la migración 011 no se desplegaron (esperan la aprobación de la plantilla).

## Cambios en el VPS

- **Drift resuelto antes de publicar:** la landing viva salía de `/opt/meowlab` con
  cambios sin commit. Todo estaba en git salvo `public/meowlab-bimi.svg` (referenciado
  por el registro DNS `default._bimi`) y `Dockerfile.deploy`; ambos se versionaron
  (`381c3b3`) con sus hashes idénticos a los del VPS.
- `meowlab-web` reemplazado; el anterior queda detenido como
  `meowlab-web-prev-taste-20261101` (imagen `meowlab-web:taste-20261101`).
- PostgreSQL de la plataforma: rol `meowlab_app` (sin superusuario, sin CREATEDB) y
  base `meowlab_app` de su propiedad; migración `migrations-postgres/0001_better_auth.sql`
  registrada en `portal_schema_migrations`.
- `/opt/meowlab-app/deploy`: `compose.yml`, `bootstrap-db.sh`, bloque de Caddy y
  `secrets/` (generados en el VPS, nunca salieron de él; Google vacíos). Imagen
  `meowlab-app:381c3b31bde5` construida desde `~/releases/meowlab-app-381c3b31bde5`.
- Caddy: el bloque `app.meowlab.tech` pasó de `meowlab-platform-dashboard-1:8082`
  (prototipo de meowlab-platform, que sigue corriendo sin ruta) a `meowlab-app:8080`.
  Validado dentro del contenedor y recargado sin reinicio. Respaldo:
  `~/releases/caddy-backup-20261112T010748Z/Caddyfile`. El Caddyfile vivo no está en
  git (tarea `vps-caddyfile-drift-20261111`); el bloque nuevo sí:
  `apps/meowlab-app/deploy/Caddyfile.app.meowlab.tech`.

## Verificación

- Imagen candidata de la landing: `/`, `/privacidad/`, `/terminos/`, `/contacto/`,
  `/meowlab-bimi.svg` 200; frente a la viva sólo suma las dos páginas.
- Público: `meowlab.tech`, `www`, `/privacidad`, `/terminos`, `/meowlab-bimi.svg`,
  `radar.meowlab.tech` y `facturas.meowlab.tech` 200.
- Portal: `healthz` ok dentro del contenedor (usuario `node`, sistema de archivos de
  sólo lectura); `https://app.meowlab.tech/` 200 con título «MeowLab | Mi panel»;
  `/api/config` 200; `/api/me` 401 sin sesión; CSP, HSTS y `X-Frame-Options: DENY`.
- No se crearon cuentas de prueba en producción.

## Rollback

```bash
# Portal: volver al prototipo
cat ~/releases/caddy-backup-20261112T010748Z/Caddyfile > /opt/facturaya-ai/docker/caddy/Caddyfile
docker exec facturaya-ai-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
# Landing: volver a la imagen anterior
docker rm -f meowlab-web && docker rename meowlab-web-prev-taste-20261101 meowlab-web \
  && docker update --restart=unless-stopped meowlab-web && docker start meowlab-web
```

## Pendientes

- Cliente OAuth de Google (pantalla de consentimiento con `meowlab.tech/privacidad` y
  `/terminos`), cargar `google_client_id` y `google_client_secret` y reiniciar el portal.
- Proveedor de correo para verificar correos y recuperar contraseñas.
- Fase 2 en producción tras la aprobación de `codigo_otp_meowlab`: migración 011,
  secretos en el bridge y Manolo, despliegue de ambos.
- Confirmar que el buzón `privacy@meowlab.tech` recibe correo.
- Versionar el Caddyfile vivo y decidir el destino del prototipo de meowlab-platform.
