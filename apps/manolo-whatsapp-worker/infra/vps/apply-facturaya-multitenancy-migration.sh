#!/bin/sh
set -eu

deployment_root="${1:-/opt/manolo-platform}"
migration_file="$deployment_root/infra/postgres/migrations/006-facturaya-multitenancy.sql"

case "$deployment_root" in
  /opt/manolo-platform) ;;
  *)
    printf '%s\n' "El despliegue debe estar en /opt/manolo-platform" >&2
    exit 1
    ;;
esac

test -f "$migration_file"
cd "$deployment_root/infra/vps"
docker compose --env-file .env exec -T postgres sh -c \
  'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$migration_file"

result="$(docker compose --env-file .env exec -T postgres sh -c \
  'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
  "SELECT to_regclass('"'"'whatsapp.tenant_members'"'"') IS NOT NULL
       AND to_regclass('"'"'whatsapp.tenant_integrations'"'"') IS NOT NULL
       AND to_regclass('"'"'whatsapp.facturaya_audit_logs'"'"') IS NOT NULL"')"
test "$result" = "t"
printf '%s\n' "facturaya_multitenancy_migration=ok"
