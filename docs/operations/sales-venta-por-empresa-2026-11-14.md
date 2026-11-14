# Sales Cat a la venta, por empresa (ADR-0007, nota del 13/11/2026)

Fecha: 14/11/2026 (01:50–02:05 UTC). Autorizado por el operador («despliega la venta de Sales Cat por empresa»).

## Qué se desplegó

Todo sale de `fc1f59dd5f31c5d573c5db807bddb2c5d5437765` (`feat/sales-venta-integrada`): el merge de `feat/billing-por-empresa`
sobre `feat/stock-cat`, para no retirar Stock Cat de producción.

| Parte | Despliegue |
| --- | --- |
| PostgreSQL de la plataforma | migración `017-sales-subscriptions.sql` como `manolo_app`: `sales.settings.source` y `active_until` |
| Bridge | release `/opt/manolo-platform/releases/sales-venta-20261114T015537Z` (antes `stock-cat-20261113T222237Z`) |
| Base del portal | `0004_billing_por_empresa.sql` con `bootstrap-db.sh` (`MIGRATIONS_DIR` apuntando al código del commit) |
| Portal | imagen `meowlab-app:fc1f59dd5f31` (antes `meowlab-app:76719df88767`) |
| Worker de Manolo | sin cambios: el merge no toca código del Worker; sigue `0e82850a-0f04-4fd2-8cdd-4346397eec27` |

Sin variables ni secretos nuevos. Mercado Pago sigue en modo de prueba.

## Estado tras el despliegue

- CREACIONES J&D sigue como cortesía (`source = courtesy`, sin vencimiento): el cobro no la toca.
- `billing_agents`: Sales Cat disponible en el Plan junto con Invoice Cat.
- Las suscripciones anteriores (sin empresa) siguen siendo por cuenta.
- Respaldo previo de las tablas de cobro: `/opt/meowlab-app/backups/billing-before-0004-20261114T015814Z.sql.gz`.

## Verificación

- Pruebas sobre el merge: Worker 668/670 (las 2 de RADAR fallan igual en `feat/billing-por-empresa`: dependen de la hora del día
  y rechazan avisos de noche), typecheck sin errores; portal 40/40, typecheck y build; `entitlement-pg-check`, `stock-pg-check`,
  `sales-pg-check`, `billing-pg-check` y `billing-company-pg-check` en verde sobre bases desechables.
- Bridge: `healthy` con la imagen nueva; `companies-check` igual que antes; conteos 1762 · 258 · 729.
- `/v1/portal/entitlements` firmado con una empresa inexistente: `not_found`, sin escribir nada. Sin firma: 401.
- Portal: `healthy`; `/`, `/inicio`, `/agentes`, `/agentes/stock` y `/plan` 200; `/api/me`, `/api/billing`,
  `/api/billing/subscribe` y `/api/companies/x/stock` sin sesión 401. Sin errores en los registros.
- No se creó ninguna suscripción ni pago de prueba en producción.
- Pendiente: que el operador contrate Sales Cat en modo de prueba para una empresa que no sea CREACIONES J&D.

## Rollback

```bash
cd /opt/meowlab-app/deploy && MEOWLAB_APP_TAG=76719df88767 docker compose up -d
bash /opt/manolo-platform/releases/sales-venta-20261114T015537Z/rollback.sh
```

Las migraciones son aditivas y pueden quedarse con el código anterior. Para quitar la 017:
`/opt/manolo-platform/releases/sales-venta-20261114T015537Z/migration-017-rollback.sql`. La 0004 se revierte desde el respaldo.
