# Portal app.meowlab.tech

Panel web de MeowLab donde una persona ve los datos de sus agentes. Diseño y
fases en [ADR-0006](../../docs/decisions/0006-portal-app-meowlab.md).

Estado: fase 1 (cuentas). Registro e inicio de sesión con correo, Google
opcional y panel inicial. La vinculación del WhatsApp y los datos de facturación
llegan en las fases 2 a 4. **No está desplegado.**

## Estructura

| Ruta | Qué es |
| --- | --- |
| `server/app.ts` | API Hono (`/api/health`, `/api/config`, `/api/me`, `/api/auth/*`). No depende de Cloudflare. |
| `server/auth.ts` | Opciones de Better Auth. Recibe la base de datos desde afuera. |
| `server/worker.ts` | Única entrada de Cloudflare: arma la API con la D1 `DB`. |
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

## Antes de desplegar (requiere autorización)

1. Crear la D1 `meowlab-app` y poner su `database_id` en `env.production`.
2. Secretos: `BETTER_AUTH_SECRET`, y `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` del
   cliente OAuth con redirección `https://app.meowlab.tech/api/auth/callback/google`.
3. `wrangler d1 migrations apply meowlab-app --env production --remote`.
4. `npm run deploy -- --env production` desde un commit publicado.
