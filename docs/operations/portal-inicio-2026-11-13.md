# Nueva estructura del portal e Inicio semanal

Fecha: 13/11/2026 (15:19–15:30 UTC). Pedido y autorizado por el operador («Sí, despliégala»).

## Qué se desplegó

| Parte | Commit publicado | Despliegue |
| --- | --- | --- |
| Bridge | `73222bfdb4470a39569f56ef3e1f4c0101c7e6ca` (`feat/portal-inicio`) | release `/opt/manolo-platform/releases/portal-inicio-20261113T151931Z` |
| Portal | `57263d3b6e9363bececc71934b6a189d1b7fd766` (`feat/portal-inicio-app`) | imagen `meowlab-app:57263d3b6e93` (antes `meowlab-app:9ad227bff394`) |

Sin migraciones, sin cambios en FacturaYa ni en el compose del bridge.

- Bridge: acción `weekly` en `/v1/portal/companies`, sólo para miembros de la empresa en
  el portal. Semana de lunes a domingo en Lima: ventas aceptadas en soles menos notas de
  crédito, comprobantes y rechazados (FacturaYa, con la semana anterior), mensajes del
  equipo a sus agentes y licitaciones que Tender Cat le envió. Sólo salen enlaces del SEACE.
- Portal: onboarding de pantalla completa sin empresa; menú lateral fijo (barra inferior
  en el celular) con Inicio, un apartado por agente activo, Sumar agente, Plan,
  Configuración y Negocio; Inicio con la semana; Configuración con WhatsApp, empresa y
  equipo.

## Verificación

- Bridge: `healthy`; consulta firmada de prueba con una cuenta ajena: `weekly`
  `forbidden` y el resto de acciones como antes; conteos 1750 mensajes · 258 ventas · 728
  solicitudes.
- Semana real de CREACIONES J&D desde la cuenta administradora (sólo conteos, 0,6 s):
  2 personas, 13 mensajes (305 la semana anterior), 43 licitaciones (6 interesantes),
  FacturaYa respondió con 0 comprobantes en la semana.
- Portal: `healthy`; `/` y `/api/config` 200; `/api/me` y `/api/companies/<id>/weekly`
  sin sesión 401.

## Rollback

```bash
cd /opt/meowlab-app/deploy && MEOWLAB_APP_TAG=9ad227bff394 docker compose up -d
bash /opt/manolo-platform/releases/portal-inicio-20261113T151931Z/rollback.sh
```
