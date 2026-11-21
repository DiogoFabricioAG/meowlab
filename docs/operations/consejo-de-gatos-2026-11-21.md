# Despliegue: Tus agentes como mesa del consejo, con tendencias e informe de personas

Fecha: 21/11/2026, 15:20 en Lima (20:20 UTC). Lo autorizó el operador («Sí, despliégalo»).

- **Commit publicado:** `f77be1184b10b5e3b4b8a33d3ecc5b49bb664641`, de `main` (PR #91).
- **Quién lo construyó:** el coordinador, porque el operador lo pidió así.
- **Migraciones:** ninguna.
- **Worker:** no cambia; sigue en `535d842a`.
- **Pruebas:**
  - Portal: 99 de 99, con 12 nuevas de las reglas del consejo. Sin errores de tipos y con el build OK.
  - Worker: 757 de 757, con 2 nuevas del informe, y `tsc` OK.
- **Revisión visual previa:** con datos de ejemplo, a 1366 y 390 px, sin scroll horizontal.
- **Prueba de la consulta del informe:** se corrió en producción en solo lectura (`BEGIN READ ONLY … ROLLBACK`) con CREACIONES J&D. Respondió sin errores.

## Qué cambia

- **Inicio:** queda con Para atender, Tus gatos hoy y Actividad reciente. Tendencia sale de Inicio.
- **Tus agentes, la mesa del consejo:**
  - Cada gato da **un** consejo de tendencia con datos reales, nunca pendientes ni lo de hoy. Las reglas están en `web/src/council.ts`.
  - Un gato a la venta aparece como silla libre con un enlace a Plan.
  - Stock Cat todavía dice que junta datos. Le falta el dato de productos sin movimiento: tarea `bridge-productos-sin-movimiento-20261121`.
- **«Lo que revisa el consejo»:** es Tendencia rediseñada. Muestra barras de 14 días y compara los últimos 7 días con los 7 anteriores.
- **«Quién habla con tus gatos»:**
  - el resumen semanal del bridge (`weekly`) agrega `people`;
  - cuenta, por gato y en 30 días, las personas del equipo (por WhatsApp) y sus pedidos, tomados de la bitácora de cada gato;
  - para Support Cat cuenta además los clientes;
  - si la consulta falla, el informe se omite y el resumen sigue funcionando.

## Procedimiento y verificación

**Bridge**

- Release `main-20261121T202124Z`, con `compose.yml` sin cambios.
- Resultado: `cutover_verified`.
- Rollback:

  ```sh
  bash /opt/manolo-platform/releases/main-20261121T202124Z/rollback.sh
  ```

**Portal y servicio de Tender Cat**

- `MEOWLAB_APP_TAG` pasa de `e8facb05a217` a `f77be1184b10`.
- Los dos contenedores quedan `healthy` y `MERCADOPAGO_TEST_MODE=false`.
- `/`, `/api/health`, `/agentes` e `/inicio` responden 200.
- El bundle en ejecución incluye «Quién habla con tus gatos».
- No hay errores en los logs del portal ni del bridge.
- Rollback:

  ```sh
  bash /opt/manolo-platform/releases/portal-f77be1184b10/rollback.sh
  ```

## Pendiente

- El operador debe revisar la página con su sesión real.
- Stock Cat necesita el dato de productos sin movimiento para poder dar consejo.
