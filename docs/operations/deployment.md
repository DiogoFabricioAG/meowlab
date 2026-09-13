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

