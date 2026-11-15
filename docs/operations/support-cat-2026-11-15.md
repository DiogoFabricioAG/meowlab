# Despliegue de Support Cat fase 1

Fecha: 15/11/2026, 15:14–15:20 hora de Lima (20:14–20:20 UTC). Servidor: alias SSH `meowlab`. Autorizado por el operador
(«Sí, despliégalo»). Decisión: [ADR-0017](../decisions/0017-support-cat.md).

## Fuente

Commit publicado `d932a980e1dc90d72803dfa6750df627f1200e3f` en `origin/feat/support-cat`, sobre main `cd2da`. Sin cambios en FacturaYa.

## Pasos

1. **Migración 021** (`infra/postgres/migrations/021-support-cat.sql`) como `manolo_app`: esquema `support` con cinco tablas.
2. **Bridge**, release `/opt/manolo-platform/releases/support-cat-20261115T201344Z`, imagen
   `manolo-platform-bridge:support-cat-20261115T201344Z`. La comprobación firmada agrega `support_view` sobre CREACIONES J&D con
   una cuenta ajena: `forbidden`. Contenedor `healthy` y sin errores en los registros.
3. **Worker** `whatsapp-webhook-meta-production`, versión `432dddd4-7fa3-4623-95b9-4d6270673eae` (antes `dab69833`), desde el
   worktree limpio en el commit publicado; `/health` 200. El cron de 15 minutos suma el resumen diario.
4. **Portal** `meowlab-app:d932a980e1dc` (antes `489220796c85`). Sin migraciones nuevas del portal. `/` y `/agentes/soporte` 200,
   `/api/companies/:id/support` sin sesión 401.
5. **Activación**: `support.settings` para CREACIONES J&D (`01m048fqcze7628368f321xytj`) con el número de Manolo
   (`phone_number_id` 1266091906580349), origen `courtesy`, resumen a las 20:00. Sales Cat activo con 1 producto en el catálogo y
   sin preguntas frecuentes cargadas.

Desde este despliegue, quien escribe al número de Manolo sin ser del equipo de ninguna empresa, sin rol propio y sin ser
proveedor con pedido abierto es atendido como cliente de CREACIONES J&D (ADR-0017, Consecuencias).

## Pendiente

- Cargar las preguntas frecuentes en `/agentes/soporte`: sin ellas el gato pasa casi todo a la titular.
- Prueba real del operador: escribir a Manolo desde un número que no sea del equipo.
- Plantilla para avisar a la titular fuera de su ventana de 24 horas (tablero).

## Rollback

```sh
bash /opt/manolo-platform/releases/support-cat-20261115T201344Z/rollback.sh
cd /opt/meowlab-app/deploy && MEOWLAB_APP_TAG=489220796c85 docker compose up -d
```

Worker: `npx wrangler rollback dab69833 --env production`. Para apagar solo Support Cat sin rollback:
`UPDATE support.settings SET enabled = FALSE WHERE tenant_id = '01m048fqcze7628368f321xytj'`. La migración 021 puede quedarse.
