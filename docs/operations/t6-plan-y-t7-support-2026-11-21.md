# Despliegue: Plan como página de venta (T6) y resumen diario de Support Cat (T7)

Fecha: 21/11/2026, 02:25 en Lima (07:25 UTC). Lo autorizó el operador («ve desplegando las tareas»).

- **Commit publicado:** `e8facb05a2176bcdaaf62689b48a14cd12566a55`, de `main`, con los PR #81 (T6) y #80 (T7).
- **Migraciones:** ninguna.
- **Worker:** no cambia; sigue en `535d842a`.
- **Pruebas:**
  - Worker: 755 de 755, sin errores de tipos.
  - Portal: 87 de 87, sin errores de tipos y con el build OK.
- **Revisión visual de Plan** antes de fusionar (coordinador, build de la rama con datos de ejemplo): a 1366 y 375 px, sin scroll horizontal, con la barra inferior fija en el celular.

## Qué cambia

- **Plan (T6):**
  - Encabezado «Arma el equipo de gatos de tu negocio».
  - Tres paquetes sugeridos: «Empieza a vender», «Tienda al día» con el sello «Más elegido» y «Todo el equipo». Cada uno muestra el ahorro en soles.
  - Tarjetas con beneficios y una línea «Ideal si…».
  - Resumen con el total y el incentivo de descuento: fijo a la derecha en escritorio y como barra inferior en el celular.
  - El cálculo del total no cambió: el servidor sigue siendo la fuente.
- **Resumen diario de Support Cat (T7):**
  - `summaries` ya no pasa por `bridge_requests`. Esa tabla exige una empresa real, y el cron usa `channel_tenant_id: "cron"`: por eso la operación fallaba siempre.
  - La idempotencia queda en el `UPDATE … last_summary_on` atómico por empresa.
  - Los `vps_*_processing_failed` del bridge ahora registran un `errorCode` seguro.
  - Se revisó que el cron de Reorder Cat solo lee (`followups`) y no tiene este problema.

## Procedimiento y verificación

- **Bridge:**
  - release `main-20261121T072425Z`, con `compose.yml` sin cambios;
  - resultado `cutover_verified`;
  - rollback: `bash /opt/manolo-platform/releases/main-20261121T072425Z/rollback.sh`.
- **Portal y servicio de Tender Cat:**
  - `MEOWLAB_APP_TAG` pasa de `d2eedd05321d` a `e8facb05a217`;
  - los dos contenedores quedan `healthy` y Mercado Pago sigue en producción;
  - `/`, `/api/health`, `/plan` e `/inicio` responden 200;
  - no hay errores en los logs;
  - rollback: `bash /opt/manolo-platform/releases/portal-e8facb05a217/rollback.sh`.

## Pendiente

- **Primer resumen de Support Cat:** debería salir hoy a las 20:00 de Lima (`summary_hour` de CREACIONES J&D), si ese día hubo clientes o casos abiertos. Para confirmarlo, revisar `support.settings.last_summary_on` y los logs del bridge.
- **T8, consejo de gatos:** el paso 1 está en el PR #79, en borrador, con las propuestas «Mesa redonda» y «Acta de la sesión». Espera la elección del operador.
- **T9, pagar meses por adelantado con Yape:** está en la cola.
