# Portal app.meowlab.tech

Panel web de MeowLab donde una persona ve los datos de sus agentes. Diseño y
fases en [ADR-0006](../../docs/decisions/0006-portal-app-meowlab.md).

Estado: fases 1 (cuentas) y 2 (vincular el WhatsApp con un código) hechas y
probadas en local. Los datos de facturación llegan en las fases 3 y 4. **No está
desplegado.**

**Dónde corre:** en el VPS, detrás del Caddy compartido. El DNS de meowlab.tech
está en Hostinger, no en Cloudflare, así que un Worker no puede tomar
`app.meowlab.tech` sin mudar la zona. La entrada de Cloudflare (`server/worker.ts`,
D1) se conserva para desarrollo local con `wrangler dev`.

## Estructura

| Ruta | Qué es |
| --- | --- |
| `server/app.ts` | API Hono (`/api/health`, `/api/config`, `/api/me`, `/api/auth/*`). No depende de Cloudflare. |
| `server/auth.ts` | Opciones de Better Auth. Recibe la base de datos desde afuera. |
| `server/bridge.ts` | Cliente firmado (HMAC) hacia el bridge del VPS. WebCrypto: corre en Cloudflare y en Node. |
| `server/node.ts` | Entrada del VPS: PostgreSQL, secretos en archivos, sirve `dist/` y aplica `_headers`. |
| `server/worker.ts` | Entrada de Cloudflare con D1 (desarrollo local). |
| `migrations-postgres/` | Esquema de Better Auth para PostgreSQL (VPS). |
| `Dockerfile`, `deploy/` | Imagen, compose, creación de la base y bloque de Caddy. |
| `web/src/WhatsAppLink.tsx` | Pedir el código, verificarlo, reenviar y desvincular. |
| `web/` | Interfaz React + Vite con los tokens de meowlab.tech. Se compila a `dist/`. |
| `migrations/` | Migraciones D1. `0001` es el esquema de Better Auth (`scripts/auth-schema.mjs`). |

Mover al VPS: escribir una entrada Node que construya `createAuth` con un pool
de PostgreSQL y sirva `createApp` con `@hono/node-server`, regenerar el esquema
para PostgreSQL y servir `dist/` con Caddy.

## Desarrollo local

```bash
npm ci
npm run db:migrate:local
npm run dev
```

`npm run dev` compila la interfaz y levanta `wrangler dev` en
`http://localhost:8787`. Para recarga en caliente de la interfaz: `npm run dev:web`
(puerto 5173, que envía `/api` al 8787).

`.dev.vars` (ignorado por git) necesita `BETTER_AUTH_SECRET` y, para el puerto
5173, `TRUSTED_ORIGINS=http://localhost:5173`. Google se activa sólo si existen
`GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.

## Seguridad

- Cookies de sesión `HttpOnly`; `Secure` en producción.
- Better Auth rechaza peticiones de otros orígenes (403).
- Límite de intentos guardado en la base (D1 en local, PostgreSQL en el VPS): 5 inicios de sesión por minuto y 5
  registros cada 10 minutos.
- Sin verificación de correo todavía, Google no se enlaza a una cuenta con
  contraseña existente.
- `web/public/_headers` fija CSP, `X-Frame-Options: DENY` y `nosniff`.
- Telemetría de Better Auth apagada.
- Ningún dato de facturación es accesible hasta vincular el WhatsApp (fase 2).

## Administradores

`user.role` vale `user` o `admin`. Better Auth lo declara `input:false`: nadie puede
dárselo al registrarse ni al editar su perfil. El operador lo otorga en el VPS desde
`/opt/meowlab-app/deploy`:

```bash
sh grant-admin.sh grant correo@dominio   # sólo cuentas que entraron con Google y tienen el correo verificado
sh grant-admin.sh revoke correo@dominio
sh grant-admin.sh list
```

Un administrador ve la pestaña **Negocio** (`GET /api/admin/metrics`): cuentas,
registros por día de los últimos 30 días (hora de Lima), activas en 7 días y cómo
entran. Sólo totales, sin datos personales. El rol se lee de la base en cada
petición, así que revocarlo tiene efecto inmediato.

## Vincular el WhatsApp (fase 2)

1. El usuario escribe su número; `POST /api/whatsapp/start` lo pasa al bridge
   (`/v1/portal/whatsapp-link`, firmado con `PORTAL_BRIDGE_HMAC_SECRET`).
2. El bridge limita (60 s entre códigos, 3 por número y 5 por cuenta cada hora),
   guarda el hash del código en PostgreSQL y pide a Manolo enviarlo con la
   plantilla `codigo_otp_meowlab` (`es_PE`, «Copiar código»). A números que nunca
   hablaron con Manolo no se envía nada, con la misma respuesta.
3. `POST /api/whatsapp/verify` confirma el código (10 minutos, 5 intentos) y crea
   el vínculo. `POST /api/whatsapp/unlink` lo quita.

Las rutas propias que escriben exigen sesión y un `Origin` permitido.

## Despliegue en el VPS (requiere autorización)

Desde un commit publicado, en `ssh meowlab`:

1. **Código:** `git archive` del commit a `/opt/meowlab-app` y
   `docker build -t meowlab-app:<commit> /opt/meowlab-app`.
2. **Secretos** en `/opt/meowlab-app/deploy/secrets/` (permisos 600, nunca en git):
   `better_auth_secret`, `meowlab_app_db_password`, `portal_bridge_hmac_secret`,
   `google_client_id` y `google_client_secret` (vacíos si todavía no hay Google).
3. **Base:** `sh bootstrap-db.sh` crea el rol `meowlab_app` (sin superusuario) y su
   base `meowlab_app` en el PostgreSQL de la plataforma, y aplica `migrations-postgres/`.
4. **Arranque:** `MEOWLAB_APP_TAG=<commit> docker compose up -d` y
   `docker exec meowlab-app wget -qO- http://127.0.0.1:8080/healthz`.
5. **Caddy:** reemplazar el bloque `app.meowlab.tech` (hoy el prototipo de
   meowlab-platform) por `deploy/Caddyfile.app.meowlab.tech`, validar y recargar.
   `app.meowlab.tech` ya resuelve al VPS: no hace falta tocar el DNS.
6. **Google:** cliente OAuth con origen `https://app.meowlab.tech`, redirección
   `https://app.meowlab.tech/api/auth/callback/google`, y pantalla de consentimiento
   con `https://meowlab.tech/privacidad` y `https://meowlab.tech/terminos`.

Para la fase 2, además:

7. Meta aprueba la plantilla `codigo_otp_meowlab` (Autenticación, Spanish (PER),
   «Copiar código», período de validez de 10 minutos).
8. Generar `AUTH_CODE_HMAC_SECRET` (bridge y Worker de Manolo). El
   `portal_bridge_hmac_secret` del paso 2 también va al bridge.
9. PostgreSQL de Manolo: aplicar
   `apps/manolo-whatsapp-worker/infra/postgres/migrations/011-portal-whatsapp-links.sql`.
10. Bridge: `MANOLO_WORKER_URL` (HTTPS del Worker de producción) y los secretos
    `PORTAL_BRIDGE_HMAC_SECRET_FILE` y `AUTH_CODE_HMAC_SECRET_FILE` en su compose. Sin
    ellos la ruta del portal responde 503 y el resto del bridge sigue igual.
11. Manolo: `wrangler secret put AUTH_CODE_HMAC_SECRET --env production` y desplegar
    desde un commit publicado.

Prueba de PostgreSQL del almacén de vínculos (sólo contra una base desechable):
`apps/manolo-whatsapp-worker/tools/portal-link-pg-check.ts`.
