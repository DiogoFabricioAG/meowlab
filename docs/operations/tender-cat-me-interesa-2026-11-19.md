# Despliegue: Tender Cat «Me interesa» con enlace oficial a bases

- **Fecha:** 19/11/2026.
- **Autorización:** el operador autorizó publicar y desplegar para probar la funcionalidad en WhatsApp.

## Qué se publicó

1. **Worker** `whatsapp-webhook-meta-production`
   - **Versión desplegada:** `7d33f0e0-c8be-46a5-8bd0-43397cbd5dd3`.
   - **Versión anterior:** `34da882d-d230-4ec1-a7f0-81ab30d1d5c0`.
   - **Origen:** commit publicado `2c670f883577c075044e8d4f03b6badb9b61588c` de `feat/tender-respuesta-interes`, desplegado desde un worktree limpio y sin `.dev.vars`.
   - **Cambio:** al pulsar «Me interesa» o confirmar por herramienta conversacional, confirma solo tras persistir la selección, incluye el código de convocatoria, resuelve el `deliveryId` exacto con vigencia, enlaza las bases oficiales (o cae a la ficha oficial ante ausencia/ambigüedad) y pide compartir el archivo en ese chat.
2. **RADAR backend** (`radar-web-api`, `radar-preparation`, `radar-discovery`)
   - **Origen:** commit publicado `2d814a166d5c393b32416f15d386e322bed13e57` de `feat/tender-enlace-bases` en `radar-compras-publicas`.
   - **Release VPS:** `/opt/radar-web/current -> /opt/radar-web/releases/2d814a166d5c` (`RADAR_RELEASE=2d814a166d5c`).
   - **Cambio:** enriquece `evidence.documents` al despachar alertas consultando solo JSON de `fichaProceso`, priorizando `Bases Integradas` y demás bases antes del tope de 6 documentos del contrato del Worker.

## Verificación

- **Worker:** `GET https://whatsapp-webhook-meta-production.diogofabricio17.workers.dev/health` → HTTP 200 (`{"status":"ok","service":"whatsapp-webhook"}`).
- **RADAR VPS:** `radar-web-pilot-radar-discovery-1` (`radar-pilot-discovery:2d814a166d5c`) healthy, `radar-web-pilot-radar-web-api-1` (`radar-pilot-api:2d814a166d5c`) healthy y `radar-web-pilot-radar-preparation-1` (`radar-pilot-worker:2d814a166d5c`) activo.
- **HTTPS público:** `https://radar.meowlab.tech/api/health` → HTTP 200, `https://radar.meowlab.tech/` → HTTP 200, `https://app.meowlab.tech/health` → HTTP 200.
- No se enviaron mensajes de WhatsApp automáticos como prueba.

## Nota operativa

Las alertas ya enviadas antes de este despliegue conservan `evidence.documents = []`, por lo que al pulsar «Me interesa» responderán con la **Ficha oficial** de SEACE. Las alertas nuevas despachadas desde `2d814a166d5c` ya incluyen los enlaces directos a las bases oficiales.

## Rollback

- **Worker:**

  ```sh
  npx wrangler rollback 34da882d-d230-4ec1-a7f0-81ab30d1d5c0 --env production
  ```

- **RADAR VPS:**

  ```sh
  bash /opt/manolo-platform/releases/radar-discovery-2d814a166d5c/rollback.sh
  ```
