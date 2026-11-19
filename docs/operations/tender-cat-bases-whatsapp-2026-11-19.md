# Despliegue: Tender Cat recepción de bases PDF/DOCX por WhatsApp y resumen de preparación

- **Fecha:** 19/11/2026.
- **Autorización:** el operador autorizó publicar, aplicar la migración D1 `0020` y desplegar Worker y RADAR.

## Qué se publicó

1. **Migración D1** (`whatsapp-webhook-meta-db`, producción):
   - Aplicada `0020_radar_bases_uploads.sql` (`radar_bases_uploads` y `radar_preparation_notices`), junto con el registro pendiente de `0013_remove_legacy_finance_roles.sql` y `0019_radar_presence.sql`. Todas finalizadas con éxito.
2. **Worker** `whatsapp-webhook-meta-production`:
   - **Versión desplegada:** `509a3384-3b7d-4289-b0d2-e7e77b6dd833`.
   - **Versión anterior:** `7d33f0e0-c8be-46a5-8bd0-43397cbd5dd3`.
   - **Origen:** commit publicado `fcc737d32445951199fc5f1972b0ce257d9304c3` de `feat/tender-bases-whatsapp`, desplegado desde worktree limpio sin `.dev.vars`.
   - **Cambio:** intercepta adjuntos PDF/DOCX hasta 15 MB en `radar-dialogue.ts` antes del fallback, valida firma binaria y extensión, almacena temporalmente en R2 + D1, expone `/v1/projects/radar/bases/pending`, `/bases/:id/content`, `/bases/:id/ack` y `/preparation-notices` idempotente.
3. **RADAR backend** (`radar-web-api`, `radar-preparation`, `radar-discovery`):
   - **Origen:** commit publicado `cae75bd02c324ace359bc7c18985d1b8dce7950f` de `feat/tender-bases-whatsapp` en `radar-compras-publicas`.
   - **Release VPS:** `/opt/radar-web/current -> /opt/radar-web/releases/cae75bd02c32` (`RADAR_RELEASE=cae75bd02c32`).
   - **Cambio:** `PreparationWorker.cycle()` sondea cada 15 s `/bases/pending`, verifica SHA-256 y `validate_file`, guarda `UploadedBases` idempotentemente, encola `enqueue_selected`, acusa recibo y envía el resumen grounded de vuelta a WhatsApp únicamente para oportunidades con bases recibidas por WhatsApp y para el job vigente.

## Verificación

- **Worker:** `/health` → HTTP 200 (`{"status":"ok","service":"whatsapp-webhook"}`).
- **RADAR VPS:** `radar-web-pilot-radar-discovery-1` y `radar-web-pilot-radar-web-api-1` en estado `healthy`; `radar-web-pilot-radar-preparation-1` activo sondeando `/v1/projects/radar/sync` y `/v1/projects/radar/bases/pending?limit=10` con `HTTP/1.1 200 OK` y sin errores ni avisos históricos.
- **HTTPS público:** `https://radar.meowlab.tech/api/health` → 200, `https://radar.meowlab.tech/` → 200.

## Rollback

- **Worker:**

  ```sh
  npx wrangler rollback 7d33f0e0-c8be-46a5-8bd0-43397cbd5dd3 --env production
  ```

- **RADAR VPS:**

  ```sh
  bash /opt/manolo-platform/releases/radar-bases-cae75bd02c32/rollback.sh
  ```
