#!/bin/sh
set -eu

deployment_root="/opt/manolo-platform"
compose_directory="$deployment_root/infra/vps"
migration_file="$deployment_root/infra/postgres/migrations/004-contact-role-control.sql"

test -f "$compose_directory/compose.yml"
test -f "$compose_directory/.env"
test -f "$migration_file"

cd "$compose_directory"
docker compose --env-file .env exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$migration_file"

role_count="$(docker compose --env-file .env exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM whatsapp.role_catalog WHERE active AND assignable;"')"

test "$role_count" -ge 8
printf '%s\n' "contact_role_control_migration=ok roles=$role_count"
