# Despliegue de Reorder Cat fase 1

Fecha: 15/11/2026, 12:04–12:10 hora de Lima (17:04–17:10 UTC). Servidor: alias SSH `meowlab`. Autorizado por el operador
(«Sí, despliégalo»). Decisión: [ADR-0016](../decisions/0016-reorder-cat.md).

## Fuente

- MeowLab: commit publicado `489220796c850c204ebff16b7c06e6453d010102` en `origin/feat/reorder-cat`, sobre main `57e8a14`.
- FacturaYa: commit publicado `4377c8ebaabdeb28c9dcf62f92f9200f98fea48c` en `origin/feat/purchase-order-pdf` (repositorio
  facturaya-ai), sobre el release anterior `collections-terms-20261115T011242Z`.

## Pasos

1. **FacturaYa**, release `purchase-order-pdf-20261115T170430Z`: `POST /api/internal/purchase-orders/pdf` (orden de compra con la
   plantilla única). Archivos del host idénticos a la base antes del cambio. Corte: salud local y pública 200, rutas con token
   sin token 401 (incluida la nueva), inicio 200.
2. **Migración 020** (`infra/postgres/migrations/020-reorder-cat.sql`) como `manolo_app`: esquema `purchasing` con siete tablas.
3. **Bridge**, release `/opt/manolo-platform/releases/reorder-cat-20261115T170543Z`, imagen
   `manolo-platform-bridge:reorder-cat-20261115T170543Z`. La comprobación firmada agrega `reorder_view` sobre CREACIONES J&D con
   una cuenta ajena: `forbidden`. Contenedor `healthy` y sin errores en los registros.
4. **Worker** `whatsapp-webhook-meta-production`, versión `13055d67-6db0-4e33-8f43-7841721ee628` (antes `a825cfc8`), desde el
   worktree limpio en el commit publicado. Cron `*/15 * * * *` igual; `/health` 200.
5. **Portal** `meowlab-app:489220796c85` (antes `369472f15e95`). Sin migraciones nuevas del portal. `/` y `/agentes/reposicion` 200,
   `/api/companies/:id/reorder` sin sesión 401.
6. **Activación**: `purchasing.settings` para CREACIONES J&D (`01m048fqcze7628368f321xytj`), origen `courtesy`, sin presupuesto,
   insistencia a las 24 horas y escalado a las 48. Al cierre no había productos bajo su mínimo, así que no hay propuestas.

## Pendiente

- Confirmar el texto de la plantilla `pedido_reposicion_proveedor`. El código envía cuatro variables: proveedor, empresa,
  productos y código del pedido. Si no coincide, Meta rechaza el envío y el gato avisa a la titular que no pudo pedirlo.
- Prueba real del operador: poner mínimo y máximo a un producto, anotar un proveedor con su WhatsApp y aprobar desde `/reorder`.
- Plantilla para avisar a la titular fuera de su ventana de 24 horas (tablero).

## Rollback

```sh
bash /opt/manolo-platform/releases/reorder-cat-20261115T170543Z/rollback.sh
bash /opt/facturaya-ai/backups/releases/purchase-order-pdf-20261115T170430Z/rollback.sh
cd /opt/meowlab-app/deploy && MEOWLAB_APP_TAG=369472f15e95 docker compose up -d
```

Worker: `npx wrangler rollback a825cfc8 --env production`. La migración 020 puede quedarse; el código anterior no la usa.

## Nota del 15/11/2026, 17:58 UTC: variables de la plantilla

El operador pasó el texto de `pedido_reposicion_proveedor` (encabezado «Pedido de …», cuerpo con proveedor, empresa y productos).
Se ajustó el envío: encabezado con la empresa y tres variables en el cuerpo (proveedor, empresa, productos), sin el código del
pedido. Commit publicado `3b65f9ea5d06705e56fc53e5bfd2fdcadbfae481` en `origin/fix/reorder-template`; Worker versión
`dab69833-1e4f-4f97-af34-de44abff89a4` (antes `13055d67`), `/health` 200. Worker 696/696 y tsc limpio. Sin cambios en
bridge, portal, FacturaYa ni base de datos. Rollback: `npx wrangler rollback 13055d67 --env production`.

Si el encabezado fuera texto fijo y no una variable, Meta rechaza el envío y la titular ve «No pude enviarle el pedido»; en ese
caso se quita el parámetro del encabezado.
