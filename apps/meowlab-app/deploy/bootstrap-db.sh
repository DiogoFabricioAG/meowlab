#!/bin/sh
# Crea la base y el rol propios del portal en el PostgreSQL de la plataforma y aplica
# las migraciones de Better Auth. Idempotente. Ejecutar en el VPS desde /opt/meowlab-app/deploy:
#   sh bootstrap-db.sh
# El rol meowlab_app sólo es dueño de la base meowlab_app: no ve los datos de Manolo.
set -eu

container="${POSTGRES_CONTAINER:-manolo-platform-postgres-1}"
password_file="./secrets/meowlab_app_db_password"
migrations_dir="${MIGRATIONS_DIR:-../migrations-postgres}"

[ -s "$password_file" ] || { echo "Falta $password_file" >&2; exit 1; }
password="$(cat "$password_file")"
case "$password" in *"'"*) echo "La contraseña no puede contener comillas simples" >&2; exit 1 ;; esac

admin_psql() {
  docker exec -i "$container" sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

# La contraseña viaja por stdin, no por argumentos visibles en `ps`.
admin_psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meowlab_app') THEN
    CREATE ROLE meowlab_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '$password';
  ELSE
    ALTER ROLE meowlab_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '$password';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE meowlab_app OWNER meowlab_app'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'meowlab_app')\gexec
REVOKE ALL ON DATABASE meowlab_app FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE meowlab_app TO meowlab_app;
SQL

# Migraciones como el propio rol, registradas para no repetirlas. `-e PGPASSWORD` sin
# valor toma la variable del entorno: la contraseña no aparece en los argumentos.
export PGPASSWORD="$password"
app_psql() {
  docker exec -i -e PGPASSWORD "$container" psql -v ON_ERROR_STOP=1 -q -h 127.0.0.1 -U meowlab_app -d meowlab_app "$@"
}
echo "CREATE TABLE IF NOT EXISTS portal_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());" | app_psql
for file in "$migrations_dir"/*.sql; do
  name="$(basename "$file")"
  applied="$(echo "SELECT 1 FROM portal_schema_migrations WHERE name = '$name';" | app_psql -At)"
  if [ "$applied" = "1" ]; then
    echo "ya aplicada: $name"
    continue
  fi
  { cat "$file"; echo; echo "INSERT INTO portal_schema_migrations (name) VALUES ('$name');"; } | app_psql
  echo "aplicada: $name"
done
