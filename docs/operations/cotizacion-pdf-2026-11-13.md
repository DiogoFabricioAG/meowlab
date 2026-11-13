# Cotización en PDF con la plantilla única (ADR-0013)

Fecha: 13/11/2026 (20:47–21:00 UTC). Autorizado por el operador («Sí, despliégalo»).

## Qué se desplegó

| Parte | Commit publicado | Despliegue |
| --- | --- | --- |
| FacturaYa | `cd7fbe5ee9dbd053adb583451f1b633933965ca3` (facturaya-ai, `feat/cotizacion-pdf`) | release `cotizacion-pdf-20261113T204757Z`: `POST /api/internal/quotes/pdf` |
| Bridge | `5c92d8582d03df395e8adc4af6409bd3fa50a7ec` (`feat/cotizacion-pdf`) | release `/opt/manolo-platform/releases/cotizacion-pdf-20261113T204859Z` (antes `brand-kit-20261113T194050Z`) |
| PostgreSQL | `5c92d8582d03df395e8adc4af6409bd3fa50a7ec` | migración `016-quote-pdf.sql` como `manolo_app`: retira `commerce.brand_kits`, `commerce.brand_logos` y las condiciones de `sales.quotes`; crea `sales.quote_files` |
| Worker de Manolo | `5c92d8582d03df395e8adc4af6409bd3fa50a7ec` | versión `c7d865b2-19b4-4416-b899-4759c711c0d9` (antes `404f87d3-20b4-4cba-bca1-32ad225c7006`, de `beb37`, ancestro de este commit) |
| Portal | `4b5c5097a1cec2fe480390792d373d6f2dfc44e5` (`feat/cotizacion-pdf-app`) | imagen `meowlab-app:4b5c5097a1ce` (antes `meowlab-app:80e785ce03fe`) |

Orden real: FacturaYa, bridge, migración, Worker, portal. La migración se aplicó **después** del corte del bridge porque el
bridge anterior leía las tablas del kit; el nuevo funciona sin ellas. Antes de aplicarla: 0 kits, 0 logos y 0 cotizaciones
con condiciones (`pre-016.txt` en el release). Sin variables ni secretos nuevos: el bridge usa `FACTURAYA_INTERNAL_TOKEN`.

## Verificación

- FacturaYa: salud 200; API sin token 401; `/api/internal/quotes/pdf` sin token 401. Desde el bridge, con su token, una
  cotización ficticia devuelve un PDF válido (sin guardarlo).
- Bridge: `healthy` con la imagen nueva; `companies-check` igual que antes; conteos 1758 · 258 · 729.
- Migración: tablas del kit retiradas; `sales.quote_files` de `manolo_app`; sin columnas de condiciones.
- De punta a punta, por `/v1/sales/execute` firmado como el contacto 1 (…0280): `quote_pdf` de la cotización N.° 1 de
  CREACIONES J&D devuelve `Cotizacion-000001.pdf`, PDF válido de 6 KB; la segunda vez, el mismo archivo (misma huella) sin
  volver a dibujarlo. `sales.quote_files`: 1 archivo, 6621 bytes. Es la única escritura de la verificación y es la misma que
  habría hecho la primera apertura del enlace.
- Worker: salud 200; verificación con token falso 403; POST sin firma 401.
- Portal: `healthy`; `/`, `/inicio` y `/ajustes` 200; `/cotizacion/<código>` inexistente o mal formado 404 con la página
  de aviso; `/api/me` sin sesión 401.
- Pendiente: crear una cotización con `/sales` desde …0280 y comprobar que llega el enlace y el PDF adjunto.

## Rollback

```bash
cd /opt/meowlab-app/deploy && MEOWLAB_APP_TAG=80e785ce03fe docker compose up -d
npx wrangler rollback 404f87d3-20b4-4cba-bca1-32ad225c7006 --env production   # desde apps/manolo-whatsapp-worker
bash /opt/facturaya-ai/backups/releases/cotizacion-pdf-20261113T204757Z/rollback.sh
```

Para volver al bridge anterior hay que restaurar antes las tablas del kit: aplicar `015-brand-kit.sql` y luego
`bash /opt/manolo-platform/releases/cotizacion-pdf-20261113T204859Z/rollback.sh`. `sales.quote_files` puede quedarse.
