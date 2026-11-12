# Portal app.meowlab.tech

Panel web de MeowLab donde una persona ve los datos de sus agentes. Diseño y
fases en [ADR-0006](../../docs/decisions/0006-portal-app-meowlab.md).

Estado: fases 1 (cuentas) y 2 (vincular el WhatsApp con un código) hechas y
probadas en local. Los datos de facturación llegan en las fases 3 y 4. **No está
desplegado.**

## Estructura

| Ruta | Qué es |
| --- | --- |
| `server/app.ts` | API Hono (`/api/health`, `/api/config`, `/api/me`, `/api/auth/*`). No depende de Cloudflare. |
| `server/auth.ts` | Opciones de Better Auth. Recibe la base de datos desde afuera. |
| `server/bridge.ts` | Cliente firmado (HMAC) hacia el bridge del VPS. WebCrypto: corre en Cloudflare y en Node. |
| `server/worker.ts` | Única entrada de Cloudflare: arma la API con la D1 `DB`. |
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
- Límite de intentos guardado en la D1: 5 inicios de sesión por minuto y 5
  registros cada 10 minutos.
- Sin verificación de correo todavía, Google no se enlaza a una cuenta con
  contraseña existente.
- `web/public/_headers` fija CSP, `X-Frame-Options: DENY` y `nosniff`.
- Telemetría de Better Auth apagada.
- Ningún dato de facturación es accesible hasta vincular el WhatsApp (fase 2).

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

## Antes de desplegar (requiere autorización)

1. Crear la D1 `meowlab-app` y poner su `database_id` en `env.production`.
2. Secretos: `BETTER_AUTH_SECRET`, y `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` del
   cliente OAuth con redirección `https://app.meowlab.tech/api/auth/callback/google`.
3. `wrangler d1 migrations apply meowlab-app --env production --remote`.
4. `npm run deploy -- --env production` desde un commit publicado.

Para la fase 2, además:

5. Meta aprueba la plantilla `codigo_otp_meowlab` (Autenticación, Spanish (PER),
   «Copiar código», período de validez de 10 minutos).
6. Generar dos secretos de al menos 32 caracteres:
   - `PORTAL_BRIDGE_HMAC_SECRET`: en el portal y en el bridge;
   - `AUTH_CODE_HMAC_SECRET`: en el bridge y en el Worker de Manolo.
7. PostgreSQL: aplicar `infra/postgres/migrations/011-portal-whatsapp-links.sql`.
8. Bridge: `MANOLO_WORKER_URL` (HTTPS del Worker de producción) y los dos secretos
   como Docker secrets (`PORTAL_BRIDGE_HMAC_SECRET_FILE`, `AUTH_CODE_HMAC_SECRET_FILE`)
   en `infra/vps/compose.yml`. Sin ellos la ruta del portal responde 503 y el resto
   del bridge sigue igual.
9. Manolo: `wrangler secret put AUTH_CODE_HMAC_SECRET --env production` y desplegar
   desde un commit publicado.
10. Portal: `BRIDGE_URL=https://facturas.meowlab.tech/internal/manolo` (la ruta de
    Caddy hacia el bridge) y `PORTAL_BRIDGE_HMAC_SECRET` como secreto.

Prueba de PostgreSQL del almacén de vínculos (sólo contra una base desechable):
`apps/manolo-whatsapp-worker/tools/portal-link-pg-check.ts`.
