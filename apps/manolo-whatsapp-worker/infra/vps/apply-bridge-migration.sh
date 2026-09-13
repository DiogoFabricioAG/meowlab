#!/bin/sh
set -eu

deployment_root="/opt/manolo-platform"
compose_directory="$deployment_root/infra/vps"
migration_file="$deployment_root/infra/postgres/migrations/003-bridge-requests.sql"

test -f "$compose_directory/compose.yml"
test -f "$compose_directory/.env"
test -f "$migration_file"

cd "$compose_directory"
docker compose --env-file .env exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$migration_file"

table_name="$(docker compose --env-file .env exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT to_regclass('"'"'whatsapp.bridge_requests'"'"');"')"

test "$table_name" = "whatsapp.bridge_requests"
printf '%s\n' "bridge_migration=ok"
