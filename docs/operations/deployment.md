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

## Worker

Última entrega: [GRE, direcciones de referencia e imágenes, 2026-11-06](manolo-gre-address-2026-11-06.md).
Worker `c1f9bc9e` activo (sobre `c2070081` [PDF de la guía](manolo-gre-pdf-2026-11-06.md) y
`5a7c916e` [solicitud IA de GRE](manolo-gre-provider-2026-11-06.md));
namespace DO conservado y bridge `gre-fixes-20261106` saludable.

### Agrupación de ráfagas (local, sin activar)

La entrega 2026-10-22 incorpora `WHATSAPP_BURSTS` y migración Durable Object
`whatsapp-bursts-v1`; `WHATSAPP_BURST_ENABLED` permanece `false` en ambos
entornos. No aplica ninguna migración D1 ni requiere despliegue del bridge.
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

El callback de Meta debe permanecer en el Worker. Desplegar el bridge no cambia
la URL configurada en Meta.

## VPS

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

