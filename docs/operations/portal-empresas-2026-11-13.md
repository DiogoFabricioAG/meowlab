# Empresas en el portal (fase 1 del ADR-0010)

Fecha: 13/11/2026 (04:01–04:10 UTC). Autorizado por el operador («Sí, despliégala»).

## Qué se desplegó

| Parte | Commit publicado | Despliegue |
| --- | --- | --- |
| FacturaYa | `f33ef392ceffdd3bfbec061b9d6a921b1149cb1e` (`feat/portal-empresas`, repositorio facturaya-ai) | release `portal-empresas-20261113T040115Z`; acta en `docs/deployment-2026-11-13-portal-empresas.md` de ese repositorio |
| PostgreSQL | `ea742caf3682232057a41023524d6fb6009f1b1d` (`feat/portal-empresas`) | migración `012-portal-companies.sql` aplicada como `manolo_app` |
| Bridge | `ea742caf3682232057a41023524d6fb6009f1b1d` (`feat/portal-empresas`) | release `/opt/manolo-platform/releases/portal-empresas-20261113T040256Z` |
| Portal | `e22795828172affd13957da562686711b50e94d1` (`feat/portal-empresas-app`) | imagen `meowlab-app:e22795828172` (antes `meowlab-app:aa03d81e5572`) |

- FacturaYa: consulta interna de RUC, sólo lectura y sin crear clientes.
- PostgreSQL: `tenants.origin` (`operator` | `portal`; las 4 empresas existentes
  quedaron `operator`) y `portal_company_members` (dueño o miembro por cuenta del
  portal, un solo dueño por empresa). Vacía al desplegar.
- Bridge: `/v1/portal/companies` (`mine`, `lookup`, `create`), firmado con el secreto
  del portal. Nuevo Docker secret `facturaya_internal_token` (mismo valor que
  `FISCAL_PROFILE_BRIDGE_TOKEN` de FacturaYa; 600, `ubuntu`; nunca en git).
- Portal: paso «Tu empresa» en «Mi panel», `/api/companies/lookup`, `POST /api/companies`
  y `companies` en `/api/me`.

## Verificación

- FacturaYa: ver su acta.
- Bridge: `healthy` con la imagen nueva; consulta firmada de prueba: facturación
  `not_linked`, `mine` vacío y `lookup` de 20131312955 con la razón social de SUNAT
  leída desde FacturaYa; conteos 1742 mensajes · 258 ventas · 725 solicitudes.
- Portal: `healthz` ok y `healthy`; `/` y `/api/config` 200; `/api/me`,
  `/api/companies/lookup` y `POST /api/companies` sin sesión 401.
- No se creó ninguna empresa en producción durante la verificación.

## Rollback

```bash
cd /opt/meowlab-app/deploy && MEOWLAB_APP_TAG=aa03d81e5572 docker compose up -d
bash /opt/manolo-platform/releases/portal-empresas-20261113T040256Z/rollback.sh
bash /opt/facturaya-ai/backups/releases/portal-empresas-20261113T040115Z/rollback.sh
```

La migración 012 es aditiva y puede quedarse. Para quitarla (borra las membresías del
portal; revisar antes si ya hay empresas creadas desde el portal):
`/opt/manolo-platform/releases/portal-empresas-20261113T040256Z/migration-012-rollback.sql`.
