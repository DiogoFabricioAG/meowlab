# Despliegue de portal y bridge: gatos a la venta, Stock Cat fase 2 y Sales Cat fase 3

Fecha: 21/11/2026, 00:25 en Lima (05:25 UTC). Lo pidió el operador («Sí, portal y bridge»).
El Worker no se desplegó; espera la tarea T5 de la tanda 5
(`sales-alias-sin-consulta-por-mensaje-20261121`).

- **Commit publicado:** `1fea259e81e7d37c147702a0d4a2f8011c37e49f`, de `main`. Incluye:
  - PR #49: todos los gatos a la venta, con activación por pago;
  - PR #51: Stock Cat fase 2;
  - PR #58: Sales Cat fase 3, del lado del bridge y del portal.
- **Pruebas en `main`:**
  - Worker: 741 de 743. Fallan solo las 2 de reloj de Tender Cat, que corrige T3. `tsc` sin
    errores.
  - Portal: 79 de 79, sin errores de tipos y con el build OK.

## Compatibilidad con el Worker en producción

El Worker vivo (`9c8dc2a1`, commit `cad7f320a781`) no llama a las operaciones nuevas del
bridge: alias de Sales Cat y digitalización de Stock Cat. Las anteriores no cambian, y las
columnas nuevas son opcionales.

Hasta que se despliegue el Worker:

- el nombre propio de Sales Cat no funciona por chat;
- tampoco la carga de Stock Cat por Excel o foto;
- el portal ya muestra y guarda la meta y el nombre del gato.

## 1. Respaldos

En `/opt/manolo-platform/releases/migr-1fea259e81e7/`, con modo 600:

- `bridge-before.dump`: `pg_dump -Fc` de los esquemas `sales`, `stock` y `receivables`;
- `portal-before.dump`: `pg_dump -Fc` de la base `meowlab_app`.

## 2. Migraciones

**Bridge**, en la base `manolo_platform`, con el rol `manolo_app`:

- `022-stock-supplier-invoices.sql`:
  - columnas `supplier_name` y `supplier_ruc` en `stock.moves`;
  - tabla nueva `stock.supplier_invoices`.
- `023-sales-goals-alias-collections.sql`:
  - columna `sales.settings.cat_name`;
  - tabla nueva `sales.monthly_goals`;
  - columna `receivables.debts.sale_id`, con índice único por venta.
- Verificado después: las dos tablas existen y las dos columnas están.

**Portal**, en la base `meowlab_app`, con `bootstrap-db.sh` y `MIGRATIONS_DIR` apuntando al
commit:

- `0005_billing_todos_los_gatos.sql`, registrada en `portal_schema_migrations`.
- Catálogo resultante:

| Gato | Precio (S/) | A la venta |
| --- | --- | --- |
| invoice | 39 | sí |
| sales | 59 | sí |
| stock | 29 | sí |
| reorder | 25 | sí |
| support | 39 | sí |
| collections | 25 | sí |
| tender | 35 | **no** |

Tender Cat queda fuera de venta hasta que el pago lo active (tarea
`tender-activacion-suscripcion-20261120`).

## 3. Bridge

- Release `main-20261121T052505Z`.
- `compose.yml` sin cambios.
- `cutover_verified`: las comprobaciones firmadas de `companies-check.mjs` pasan.
- Sin errores en los logs.
- Rollback:

  ```sh
  bash /opt/manolo-platform/releases/main-20261121T052505Z/rollback.sh
  ```

## 4. Portal y servicio de Tender Cat

- `MEOWLAB_APP_TAG` pasa de `37194119efc1` a `1fea259e81e7`.
- Los dos contenedores quedan `healthy`.
- `MERCADOPAGO_TEST_MODE=false`.
- `/`, `/api/health`, `/inicio`, `/plan` y `/agentes/ventas` responden HTTP 200.
- Sin errores en los logs.
- Rollback:

  ```sh
  bash /opt/manolo-platform/releases/portal-1fea259e81e7/rollback.sh
  ```

## Revertir las migraciones

Solo si hiciera falta. Las columnas y tablas nuevas no estorban al código anterior.

- **Catálogo:** devolver `available = false` a `stock`, `reorder`, `support` y
  `collections`.
- **Datos completos:** restaurar con `pg_restore` desde los respaldos de arriba. Con
  cuidado: se pierde lo que se haya escrito después.

## Pendiente

- **Worker con Sales Cat fase 3 y Stock Cat fase 2:** después de T5.
- **Primera compra real de un gato nuevo**, para confirmar en producción la activación por
  pago.
- **Revisión visual con sesión iniciada:** Plan con los seis gatos y la ficha de Sales Cat
  con la meta.
