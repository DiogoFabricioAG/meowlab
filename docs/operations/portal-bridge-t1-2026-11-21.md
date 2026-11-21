# Despliegue de portal y bridge: actividad legible, correo de Mercado Pago y Configuración nueva

Fecha: 21/11/2026, a la 01:00 de Lima (06:00 UTC). Lo autorizó el operador («Sí, despliégalo»).

- **Commit publicado:** `9d64c7d6ae163d133c8aa6f419096d351e8d92e8`, de `main`.
- **Qué incluye:**
  - PR #65 (T1): la actividad del Inicio, el correo de Mercado Pago en Plan y Configuración rediseñada.
  - PR #66 (T3): solo pruebas; la suite del Worker pasa 746 de 746.
- **Sin migraciones nuevas.**
- **Worker:** no cambia; sigue esperando T5.

## Qué cambia

- **Actividad reciente:**
  - solo muestra emisiones, notas, anulaciones y guías enviadas a SUNAT, cada una una vez;
  - usa el número, el cliente y el total del comprobante, nunca un ID interno;
  - se agrupa por día («Hoy», «Ayer», «Jueves, 19 nov.»);
  - Collections ya no duplica el cobro registrado y el validado.
- **Plan:** el correo de Mercado Pago se usa sin mostrarse («Pagarás con la cuenta de Mercado Pago de… · Usar otro correo»). El campo se abre solo si Mercado Pago lo rechaza.
- **Configuración:** secciones Tu cuenta, WhatsApp y Tu empresa, con el estado de cada gato (Activo, Falta configurar, Disponible en Plan, Próximamente), y los botones «Ver plan» y «Equipo e invitaciones».
- **Revisión visual:** la hizo el coordinador antes de fusionar, con el build de la rama y datos de ejemplo, a 1366 px y 375 px. No hubo scroll horizontal.

## Procedimiento y verificación

1. **Bridge**
   - Release `main-20261121T055857Z`, con `compose.yml` sin cambios.
   - Resultado: `cutover_verified`, con las comprobaciones firmadas de `companies-check.mjs`.
   - Rollback:

     ```sh
     bash /opt/manolo-platform/releases/main-20261121T055857Z/rollback.sh
     ```

2. **Portal y servicio de Tender Cat**
   - `MEOWLAB_APP_TAG` pasa de `1fea259e81e7` a `9d64c7d6ae16`.
   - Los dos contenedores quedan `healthy` y Mercado Pago sigue en producción.
   - `/`, `/api/health`, `/inicio`, `/plan` y `/ajustes` responden 200.
   - El portal no registra errores.
   - Rollback (vuelve a `1fea259e81e7`):

     ```sh
     bash /opt/manolo-platform/releases/portal-9d64c7d6ae16/rollback.sh
     ```

## Hallazgo, anterior a este despliegue

- **Qué se vio:** a las 06:00 UTC el bridge registró `vps_support_processing_failed` en la operación `summaries`, que es el resumen diario de Support Cat.
- **Por qué no lo causó este despliegue:** `support-service.ts` no cambió desde Support Cat fase 1. Además, `support.settings.last_summary_on` de CREACIONES J&D sigue en `NULL`: el resumen nunca se ha enviado.
- **Seguimiento:** queda en el tablero la tarea `support-resumen-diario-falla-20261121`.
