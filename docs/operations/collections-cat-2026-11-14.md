# Despliegue de Collections Cat fase 1

Fecha: 14/11/2026, 20:12–20:20 hora de Lima (15/11, 01:12–01:20 UTC). Servidor: alias SSH `meowlab`. Autorizado por el
operador («Sí, despliégalo»). Decisión: [ADR-0015](../decisions/0015-collections-cat.md).

## Fuente

- MeowLab: commit publicado `369472f15e9598c513e4a942e8a1021b617e37a7` en `origin/feat/collections-cat`, sobre main `30bc26c`.
- FacturaYa: commit publicado `ed529d12d7307ca32c63b39bdbddea6b31d61dd8` en `origin/feat/collections-terms` (repositorio facturaya-ai).

## Pasos

1. **FacturaYa**, release `collections-terms-20261115T011242Z`: `issued-documents` agrega `outstanding_amount` e `installments`
   en las facturas a crédito. Archivo del host idéntico a la base antes del cambio. Verificación del corte: salud local y pública 200,
   rutas con token sin token 401, inicio 200.
2. **Migración 019** (`infra/postgres/migrations/019-collections-cat.sql`) como `manolo_app`: esquema `receivables` con seis tablas y
   columna `commerce.customers.phone`.
3. **Bridge**, release `/opt/manolo-platform/releases/collections-cat-20261115T011409Z`, imagen
   `manolo-platform-bridge:collections-cat-20261115T011409Z`. La comprobación firmada agrega `collections_view` sobre CREACIONES J&D
   con una cuenta ajena: `forbidden`. Resto igual que el release anterior; contenedor `healthy`.
4. **Worker** `whatsapp-webhook-meta-production`, versión `a825cfc8-d31c-46a5-8eb4-6978874e5c65` (antes `0e82850a`), desde el
   worktree limpio en el commit publicado.
5. **Portal** `meowlab-app:369472f15e95` (antes `fc1f59dd5f31`). Sin migraciones nuevas del portal. `/` y `/agentes/cobranza` 200,
   `/api/companies/:id/collections` sin sesión 401.
6. **Activación**: `receivables.settings` para CREACIONES J&D (`01m048fqcze7628368f321xytj`), origen `courtesy`, valores por omisión
   (30 días, recordar 2 días antes y cada 7, máximo 3). `documents_since` ajustado a 2026-11-14 (la base calcula la fecha en UTC):
   solo se toman facturas a crédito desde hoy. Sin deudas registradas al cierre.

Sin errores en los registros del bridge tras el corte.

## Pendiente

- Prueba real del operador: `/collections` en el chat y la página Cobranza del portal.
- Formas de pago (Yape, Plin, cuenta, enlace) vacías: las define la titular en Reglas.
- Fases 2 y 3 del ADR-0015 en el tablero.

## Rollback

```sh
bash /opt/manolo-platform/releases/collections-cat-20261115T011409Z/rollback.sh
bash /opt/facturaya-ai/backups/releases/collections-terms-20261115T011242Z/rollback.sh
cd /opt/meowlab-app/deploy && MEOWLAB_APP_TAG=fc1f59dd5f31 docker compose up -d
```

Worker: `npx wrangler rollback 0e82850a --env production`. La migración 019 puede quedarse; el código anterior no la usa.
