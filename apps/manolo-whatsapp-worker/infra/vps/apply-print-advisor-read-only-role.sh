#!/bin/sh
# Creates or updates the print advisor's read-only PostgreSQL role and checks its privileges.
# The password lives only in infra/vps/secrets/print_advisor_db_password (created here if missing,
# owned by 1000:1000 with mode 600 like the other bridge secrets).
set -eu

deployment_root="/opt/manolo-platform"
compose_directory="$deployment_root/infra/vps"
migration_file="$deployment_root/infra/postgres/migrations/010-print-advisor-read-only-role.sql"
secrets_directory="$compose_directory/secrets"

test -f "$compose_directory/compose.yml"
test -f "$compose_directory/.env"
test -f "$migration_file"

cd "$compose_directory"
postgres_image="$(docker inspect -f '{{.Config.Image}}' "$(docker compose --env-file .env ps -q postgres)")"
psql_admin() {
  docker compose --env-file .env exec -T postgres sh -c \
    'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'
}
# The secrets directory is only readable by UID 1000, so a short-lived offline container handles the file.
secret_shell() {
  docker run --rm -i --network none -u 0 -v "$secrets_directory:/secrets" --entrypoint sh "$postgres_image" -c "$1"
}

secret_shell 'set -e; f=/secrets/print_advisor_db_password
  if [ ! -s "$f" ]; then umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d " \n" > "$f"; fi
  chown 1000:1000 "$f"; chmod 600 "$f"'

psql_admin < "$migration_file"
# The password goes through stdin so it never appears in process arguments or output.
secret_shell 'p="$(cat /secrets/print_advisor_db_password)"
  case "$p" in *[!0-9a-f]* | "") echo "print_advisor_db_password must be hex" >&2; exit 1 ;; esac
  printf "ALTER ROLE manolo_advisor_ro WITH PASSWORD '"'"'%s'"'"';\n" "$p"' | psql_admin > /dev/null

checks="$(psql_admin <<'SQL'
SELECT concat_ws(' ',
  'superuser=' || rolsuper, 'createrole=' || rolcreaterole, 'createdb=' || rolcreatedb, 'bypassrls=' || rolbypassrls,
  'whatsapp_usage=' || has_schema_privilege('manolo_advisor_ro', 'whatsapp', 'USAGE'),
  'print_system_usage=' || has_schema_privilege('manolo_advisor_ro', 'print_system', 'USAGE'),
  'read_file=' || has_function_privilege('manolo_advisor_ro', 'pg_read_file(text)', 'EXECUTE'),
  'unreadable_print_tables=' || (SELECT count(*) FROM pg_tables WHERE schemaname = 'print_system'
    AND NOT has_table_privilege('manolo_advisor_ro', format('%I.%I', schemaname, tablename), 'SELECT')))
FROM pg_roles WHERE rolname = 'manolo_advisor_ro';
SQL
)"
printf '%s\n' "$checks"
test "$checks" = "superuser=false createrole=false createdb=false bypassrls=false whatsapp_usage=false print_system_usage=true read_file=false unreadable_print_tables=0"
printf '%s\n' "print_advisor_read_only_role=ok"
