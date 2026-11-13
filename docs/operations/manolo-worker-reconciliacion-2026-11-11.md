# Worker de Manolo: reconciliación con git y operación pendiente

Fecha: 11/11/2026. Worker `whatsapp-webhook-meta-production`.

## Resultado

- Versión activa `f679d352-88ff-46ab-80e1-edb6dbc61cc5` (100 %), desplegada desde el commit publicado `ba2ad51e899619814fd913a758c82f73ca43245e` (rama `fix/manolo-operacion-pendiente`). Reemplaza a `c1f9bc9e`, el último injerto.
- El código descargado de Cloudflare después del despliegue es idéntico byte a byte al build del commit. Desde aquí el Worker se despliega desde commits, sin injertos.

## Reconciliación previa

Producción (`c1f9bc9e`, 5,5 MB) era una cadena de injertos: cada release partía del bundle anterior ya compilado y esbuild descartaba los marcadores de módulo. Por eso la comparación se hizo por evidencia y no por módulos:

- **Bundle activo** = `backups/gre-address-20261106/release/worker-upload/index.js` (byte a byte).
- **Huella de literales** (texto, SQL, rutas, eventos, expresiones regulares) contra el build del commit. Lo que sólo estaba en git: el arreglo de operación pendiente, `ac564` (guías `send_failed`) y la presencia de RADAR. Lo que sólo estaba en producción: 2040 literales; tras normalizar los nombres apilados (`fn2222…`) quedaron 200. Todos existieron en git o en las fuentes TypeScript guardadas en los releases, como versiones anteriores ya superadas.
- **Manifiestos de los injertos**: las 13 fuentes del injerto vivo de facturas y guías (`gre-address`) son idénticas a `36b78`; contra el commit sólo cambian los tres archivos de `ac564` y del arreglo. Las fuentes del último RADAR desplegado (`radar-detail`, que reemplazó `radarHttp` y `RadarRoleHandler`) son idénticas a git en 21 de 22 archivos; el restante es el archivo de entrada del injerto. El SQL de previews (`radar_alert_previews`) que seguía en el bundle pertenecía a copias que ya no se ejecutaban.
- **Configuración**: bindings, secretos (nombres), D1, R2, Durable Object, Browser y compatibilidad coincidían. Se corrigieron `WHATSAPP_BURST_ENABLED` (`true` en producción, `false` en git) y el cron `*/5`, que git agregaba y producción no tiene.

## Cambios desplegados

- `48d82`: una operación sin confirmar ya no secuestra la sesión. `/reiniciar`, cancelar o pedirlo en lenguaje natural la estacionan sin reenviarla, y «retomar» la restaura. Ver `docs/apps/manolo-despatch.md`.
- `ac564`: guías `send_failed`/`preparation_failed` como finales, con el motivo de FacturaYa.
- `ba2ad51`: configuración igual a producción y `RADAR_PRESENCE_ENABLED=false`. La presencia de RADAR (ruta, cron `*/5` y recibos del webhook, que dependen de la migración D1 `0019`) queda apagada hasta que el operador la autorice.
- Sin migraciones D1 ni cambios de secretos, bindings o del bridge. El onboarding del rol `cat` que otro agente dejó sin commitear no forma parte del commit y no se desplegó.

## Verificación

- Build desde `git -c core.autocrlf=false archive` del commit; pruebas 587/587 y typecheck limpio.
- Después del despliegue: versión `f679d352` al 100 %; cron `*/15` sin cambios; único binding nuevo `RADAR_PRESENCE_ENABLED=false`; compatibilidad `2026-07-21` con `nodejs_compat`.
- Sondas idénticas antes y después: `/health` 200, verificación del webhook con token falso 404, POST a la ruta de presencia 401 (la atiende RADAR, que exige autenticación).
- `wrangler tail` durante 45 s: sin errores ni excepciones.

## Rollback

```bash
npx wrangler rollback c1f9bc9e-35d2-4a77-be9d-a1059cd83cbc --name whatsapp-webhook-meta-production
```

No hay datos ni esquema que revertir.

## Pendientes

- Prueba real por WhatsApp: `/reiniciar` con una guía pendiente.
- Activar la presencia de RADAR sólo con autorización: confirmar `0019` en la D1 de producción, `RADAR_PRESENCE_ENABLED=true` y cron `*/5`.
- El entorno de desarrollo de `wrangler.jsonc` sigue apuntando a la D1 y al R2 de producción.
