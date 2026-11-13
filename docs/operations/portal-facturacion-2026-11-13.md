# Facturación en el portal (fase 3 del ADR-0006)

Fecha: 13/11/2026 (03:00–03:15 UTC). Autorizado por el operador («Sí, despliégala»).

## Qué se desplegó

| Parte | Commit publicado | Despliegue |
| --- | --- | --- |
| FacturaYa | `ba3b46d237d41eca41a0569878008f7c58bfcf73` (`feat/portal-lectura`, repositorio facturaya-ai) | release `portal-lectura-20261113T030254Z`; acta en `docs/deployment-2026-11-13-portal-lectura.md` de ese repositorio |
| Bridge | `aa97a81b530de95767f026c1805897e4a3f82d1c` (`feat/portal-facturacion`) | release `/opt/manolo-platform/releases/portal-billing-20261113T030517Z` |
| Portal | `aa03d81e5572adf7108d3ed10f5e46d40f9707d7` (`feat/portal-facturacion-app`) | imagen `meowlab-app:aa03d81e5572` (antes `meowlab-app:04f107c72db8`) |

- FacturaYa: `/api/issued-documents` y `/api/reports/monthly`, sólo lectura.
- Bridge: `/v1/portal/billing`, firmado con el secreto del portal. Empresas visibles =
  número vinculado → contactos con ese número → membresía activa con `view_invoice` →
  integración FacturaYa activa. Una empresa ajena devuelve `forbidden` sin llamar a
  FacturaYa; los tokens no salen del bridge; las guías se devuelven sin su payload.
- Portal: pestaña **Facturación** (comprobantes con descargas, resumen anual y guías). El
  portal parte del commit `74d1b` de `feat/app-login-transition`, que era el desplegado.

## Verificación

- FacturaYa: salud 200, endpoints nuevos sin token 401, `/` y `/guias` 200.
- Bridge: `healthy` con la imagen nueva; consultas firmadas de vínculo y facturación
  responden 200; conteos 1742 mensajes · 258 ventas · 725 solicitudes.
- Portal: `healthz` ok; `/` y `/api/config` 200; `/api/invoicing/companies` y
  `/api/me` sin sesión 401.
- Datos reales, sólo lectura, desde el bridge con el token de la empresa activa: 46
  comprobantes de producción y resumen de 12 meses.

## Roles y membresías (decisión del operador, 13/11/2026)

- …0280 (administrador): miembro activo de CREACIONES J&D con todos los permisos;
  conserva el rol RADAR. Su cuenta del portal ya ve la empresa (verificado por el bridge).
- …2447: sólo Tender Cat (RADAR). Rol `enterprise-advisor` → `radar` en PostgreSQL (con
  auditoría `operador-asistente`) y en la D1 de Manolo; membresía de la empresa
  `inactive`; su sesión de empresa activa borrada.
- Corrección del operador (13/11, 03:30 UTC): Invoice Cat va al último número vinculado
  en app.meowlab.tech, que es …2447. Se le devolvió `enterprise-advisor` (auditado y en
  D1) y su membresía volvió a `active`. Estado final: …0280 RADAR + miembro con todos los
  permisos (administrador); …2447 Invoice Cat + miembro. Números vinculados en el portal:
  …2447, …5481 y …0280.

## Rollback

```bash
bash /opt/manolo-platform/releases/portal-billing-20261113T030517Z/rollback.sh
bash /opt/facturaya-ai/backups/releases/portal-lectura-20261113T030254Z/rollback.sh
cd /opt/meowlab-app/deploy && MEOWLAB_APP_TAG=04f107c72db8 docker compose up -d
```
