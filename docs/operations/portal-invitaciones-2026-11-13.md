# Invitaciones del dueño en el portal (fase 2 del ADR-0010)

Fecha: 13/11/2026 (04:45–04:55 UTC). Autorizado por el operador («Sí, despliégala»).

## Qué se desplegó

| Parte | Commit publicado | Despliegue |
| --- | --- | --- |
| PostgreSQL | `88e17ca6abc8754b35ce057958f4ab00b92f397b` (`feat/portal-invitaciones`) | migración `013-portal-invitations.sql` aplicada como `manolo_app` |
| Bridge | `88e17ca6abc8754b35ce057958f4ab00b92f397b` (`feat/portal-invitaciones`) | release `/opt/manolo-platform/releases/portal-invitaciones-20261113T044525Z` |
| Portal | `9ad227bff39428b4787a024f042b0fe01f906b28` (`feat/portal-invitaciones-app`) | imagen `meowlab-app:9ad227bff394` (antes `meowlab-app:e22795828172`) |

FacturaYa no cambia. El compose del bridge no cambia.

- PostgreSQL: `portal_company_invitations` (hash SHA-256 del código, número opcional,
  acceso `view` | `full`, vencimiento, aceptación y anulación). Vacía al desplegar.
- Bridge: acciones `team`, `invite`, `revoke`, `remove`, `preview` y `accept` en
  `/v1/portal/companies`. Sólo el dueño gestiona; un enlace vale una vez y 7 días; al
  aceptar, el número vinculado entra a `tenant_members` con el acceso elegido; al quitar
  a alguien, su número queda `inactive` en esa empresa.
- Portal: «Equipo e invitaciones» del dueño (enlace por `wa.me` o copiado), página
  `/invitacion/<código>` y el campo para pegar el enlace en «Tu empresa».

## Verificación

- Bridge: `healthy` con la imagen nueva; consulta firmada de prueba: `mine` vacío,
  `lookup` de SUNAT ok, `team` de una empresa ajena `forbidden` y `preview` de un
  código inexistente `invalid`; conteos 1742 mensajes · 258 ventas · 725 solicitudes.
- Portal: `healthy`; `/` y `/invitacion/<código>` 200 (la aplicación); `/api/me`,
  `/api/invitations/<código>`, `/api/companies/<id>/team` y la aceptación sin sesión 401.
- No se crearon invitaciones en producción durante la verificación.

## Rollback

```bash
cd /opt/meowlab-app/deploy && MEOWLAB_APP_TAG=e22795828172 docker compose up -d
bash /opt/manolo-platform/releases/portal-invitaciones-20261113T044525Z/rollback.sh
```

La migración 013 es aditiva y puede quedarse. Para quitarla (borra las invitaciones, no
las membresías): `/opt/manolo-platform/releases/portal-invitaciones-20261113T044525Z/migration-013-rollback.sql`.
