# apps/tender-service

Servicio nativo de Tender Cat en MeowLab (red interna). Expone las rutas `/api/workspace/*` para el proxy autenticado de `apps/meowlab-app` (Hono) y comparte el esquema PostgreSQL existente de oportunidades, bases, preparación y avisos WhatsApp.

## Seguridad y contrato de acceso

- **Solo servidor MeowLab (fail-closed):** toda petición a `/api/workspace/*` exige:
  - `Authorization: Bearer <TENDER_SERVICE_TOKEN>` (validado en tiempo constante con `hmac.compare_digest`; admite `TENDER_SERVICE_TOKEN_FILE`).
  - `X-MeowLab-Company: <RADAR_PORTAL_COMPANY_ID>`.
- Si falta `TENDER_SERVICE_TOKEN`, `RADAR_PORTAL_COMPANY_ID` o `RADAR_WEB_ACCOUNT`, el servicio responde `503` (falla cerrado).
- Si el token Bearer es inválido o falta, responde `401`; si `X-MeowLab-Company` no coincide con `RADAR_PORTAL_COMPANY_ID`, responde `403`.
- Resuelve al propietario `RADAR_WEB_ACCOUNT` y aplica aislamiento por `account` y `key` (`404` ante acceso cruzado).

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Cadena PostgreSQL (o SQLite en pruebas locales). |
| `TENDER_SERVICE_TOKEN` / `TENDER_SERVICE_TOKEN_FILE` | Secreto Bearer compartido con el servidor `meowlab-app`. |
| `RADAR_PORTAL_COMPANY_ID` | ID de empresa del portal vinculado a este servicio. |
| `RADAR_WEB_ACCOUNT` | Cuenta propietaria en las tablas `radar_*`. |
| `RADAR_MEOWLAB_TOKEN` / `RADAR_MEOWLAB_TOKEN_FILE` | Token Bearer hacia el Worker WhatsApp (`MEOWLAB`). |
| `RADAR_OPENAI_API_KEY` / `RADAR_OPENAI_API_KEY_FILE` | Clave OpenAI para análisis de bases, referencias de precio y edición AI. |
| `RADAR_OPENAI_MODEL` | Modelo OpenAI (por defecto `gpt-6-luna`). |
| `RADAR_PREPARATION_ENABLED` | `1` para iniciar `PreparationWorker` en el lifespan de la API. |
| `RADAR_PREPARATION_POLL_SECONDS` | Intervalo de sondeo del worker de preparación (por defecto `15`). |
| `RADAR_DISCOVERY_ENABLED` | `1` para habilitar el worker de descubrimiento (`python -m app.discovery_worker`). |

## Arranque local y Docker

```bash
pip install -r requirements-dev.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Con Docker:

```bash
docker build -t meowlab-tender-service .
docker run --rm -p 8000:8000 \
  -e DATABASE_URL=postgresql+psycopg://... \
  -e TENDER_SERVICE_TOKEN=... \
  -e RADAR_PORTAL_COMPANY_ID=... \
  -e RADAR_WEB_ACCOUNT=... \
  meowlab-tender-service
```

Pruebas aisladas:

```bash
pytest tests -v
```
