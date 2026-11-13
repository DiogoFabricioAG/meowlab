# Despliegues y operación

## Un repositorio, tres entregables

| Entregable | Origen | Destino |
| --- | --- | --- |
| Landing | raíz del repositorio | Hosting estático o contenedor web |
| WhatsApp Worker | `apps/manolo-whatsapp-worker` | Cloudflare Workers |
| Manolo bridge | mismo paquete, build Node | VPS mediante Docker Compose y Caddy |

No existe un comando raíz que despliegue los tres. Esto evita que un cambio
comercial reinicie el webhook o que una migración del bridge publique la
landing.

## Portal y landing

Última entrega: [portal app.meowlab.tech con imágenes WebP, 2026-11-12](portal-webp-despliegue-2026-11-12.md).
Contenedor `meowlab-app:fbfcf294de82` desplegado en el VPS desde `fbfcf29`. Reducción del 93.6% de payload de imágenes en el portal (de 1.26 MB a 80.9 KB).

Entrega anterior: [landing con imágenes WebP, 2026-11-12](landing-webp-despliegue-2026-11-12.md).
Contenedor `meowlab-web:d7cf736da0ea` desplegado en el VPS desde `d7cf736`. Reducción del 89.4% de payload de imágenes.

Entrega anterior: [portal app.meowlab.tech y páginas legales, 2026-11-11](portal-y-legales-2026-11-11.md).
Portal en el VPS (`meowlab-app`, PostgreSQL `meowlab_app`); procedimiento en `apps/meowlab-app/README.md`.

## Worker

Última entrega: [onboarding del rol cat y retiro de roles de finanzas, 2026-11-12](manolo-onboarding-y-roles-2026-11-12.md).
Worker `dd113051` desde `d3a845d`; rollback a `f679d352`.

Entrega anterior: [reconciliación con git y operación pendiente, 2026-11-11](manolo-worker-reconciliacion-2026-11-11.md).
Worker `f679d352` desplegado desde el commit `ba2ad51`, sin injertos; rollback a `c1f9bc9e`.

Entrega anterior: [GRE, direcciones de referencia e imágenes, 2026-11-06](manolo-gre-address-2026-11-06.md).
Worker `c1f9bc9e` activo (sobre `c2070081` [PDF de la guía](manolo-gre-pdf-2026-11-06.md) y
`5a7c916e` [solicitud IA de GRE](manolo-gre-provider-2026-11-06.md));
namespace DO conservado y bridge `gre-fixes-20261106` saludable.

### Agrupación de ráfagas (local, sin activar)

La entrega 2026-10-22 incorpora `WHATSAPP_BURSTS` y migración Durable Object
`whatsapp-bursts-v1`. Corrección 2026-11-11: en producción
`WHATSAPP_BURST_ENABLED` está en `true` (configuración desplegada verificada) y
`wrangler.jsonc` ya lo refleja; en desarrollo sigue en `false`. No aplica ninguna migración D1 ni requiere despliegue del bridge.
Antes de activarla, resolver recuperación administrativa de turnos inciertos,
preparar una entrega aislada que preserve RADAR y validar ráfagas sin emisión.
Nunca cambiar al camino inmediato con lotes admitidos aún pendientes: drenar
y reconciliar primero; no borrar el storage DO ni su migración en un rollback.
Procedimiento y límites completos en
[ADR-0002](../decisions/0002-agrupar-rafagas-whatsapp.md).

Desde `apps/manolo-whatsapp-worker`:

```powershell
npm ci
npm test -- --run
npm run typecheck
npx wrangler deploy --env production --dry-run
npm run deploy
```

`npm run deploy` es una acción externa y requiere autorización explícita. Antes
de ejecutarla, compara bindings y nombres de secretos sin intentar leer sus
valores.

Desde la reconciliación del 2026-11-11 el Worker se despliega desde un commit
publicado, sin injertos: se construye desde `git -c core.autocrlf=false archive`
del commit (no desde el working tree) y se comparan variables, bindings, crons
y compatibilidad con la configuración descargada de producción antes de subirlo.

### Presencia de RADAR (apagada)

El código de presencia (`src/radar/presence.ts`) está en git, pero
`RADAR_PRESENCE_ENABLED` es `false` en ambos entornos: no expone la ruta
`/v1/projects/radar/presence`, no corre el cron y no registra recibos en el
webhook. Para activarla hace falta autorización del operador, confirmar la
migración D1 `0019_radar_presence.sql` en producción, poner la variable en
`true` y agregar `*/5 * * * *` a los crons de `env.production`.

El callback de Meta debe permanecer en el Worker. Desplegar el bridge no cambia
la URL configurada en Meta.

## VPS

Último despliegue del bridge:
[2026-11-07, rol de solo lectura del asesor y reconciliación con git](manolo-bridge-advisor-ro-2026-11-07.md).
Imagen construida desde el commit `2dec84f`; ya no corre con extensiones injertadas.

Revisión de anulación sin modificar motivo:
[2026-11-06, Worker85802e7f y copia SSH](manolo-credit-summary-2026-11-06.md).
La nota ya procesada conserva su estado y no se reemite al pedir su resumen.

Actualización por rechazo de anulación:
[2026-11-06, permiso y recuperación puntual](manolo-credit-permission-2026-11-06.md).
Worker `0bedb1c8` activo; sin cambio de imagen ni reinicio del bridge.

Última publicación de navegación de Manolo:
[2026-11-06, Worker y copia por SSH](manolo-intent-2026-11-06.md).
Worker `a768ba36` activo; el bridge fiscal se conserva saludable sin reinicio.

Última entrega de crédito/GRE de Manolo:
[2026-11-05, paquete aislado y rollback](manolo-credit-gre-2026-11-05.md).
Preserva RADAR, bindings, cron y secretos; no habilita GRE real en FacturaYa.

El procedimiento canónico está en
[`infra/vps/README.md`](../../apps/manolo-whatsapp-worker/infra/vps/README.md).
Sus reglas esenciales son:

- PostgreSQL solo en la red Docker interna.
- Caddy como única entrada pública.
- secretos montados como Docker Secrets con permisos restrictivos;
- bridge ejecutado como usuario no root, filesystem de solo lectura y límites
  de recursos;
- migraciones versionadas para bases existentes;
- healthcheck y smoke tests antes de cambiar tráfico.
- el bridge se construye desde `git -c core.autocrlf=false archive` de un commit
  publicado (en Windows, sin esa opción los scripts salen con CRLF y fallan);
  se compara el sha256 de `dist/node/server.mjs` con el build local del commit.

Los scripts de `infra/vps/` son activos operativos. Deben revisarse antes de
ejecutarlos en producción; que estén versionados no equivale a autorización.

## Datos y migraciones

- D1 usa `migrations/` y Wrangler.
- PostgreSQL vacío usa `infra/postgres/init/` automáticamente.
- PostgreSQL existente usa `infra/postgres/migrations/` en orden.
- Antes de un corte: respaldo, restauración de prueba, conteos, claves únicas y
  reconciliación.
- Nunca se ejecutan scripts `init/` manualmente sobre una base existente.

## Rollback actual

El diseño híbrido permite mantener Meta en el Worker. Si el bridge falla:

1. confirmar que el Worker y Meta siguen saludables;
2. desactivar las rutas VPS mediante configuración controlada;
3. desplegar el Worker con fallback D1;
4. detener solamente el bridge si es necesario;
5. preservar PostgreSQL para diagnóstico.

El rollback no debe borrar datos ni rehacer migraciones. Consulta además los
reportes fechados en
[`docs/vps-migration/`](../../apps/manolo-whatsapp-worker/docs/vps-migration/).

## Observabilidad

Usa IDs de correlación y eventos estructurados. Los logs pueden incluir rol,
operación, estado HTTP y razón segura; no deben incluir contenido del mensaje,
teléfono, token, documento, cadena de conexión ni payload fiscal completo.

