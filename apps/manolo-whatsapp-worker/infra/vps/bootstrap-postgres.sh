#!/bin/sh
set -eu

deployment_dir="${1:-/opt/manolo-platform/infra/vps}"
case "$deployment_dir" in
  /opt/manolo-platform/*) ;;
  *)
    echo "El directorio debe estar dentro de /opt/manolo-platform" >&2
    exit 1
    ;;
esac

cd "$deployment_dir"
umask 077

# The postgres image runs as an unprivileged user and must be able to read the
# bind-mounted initialization scripts. This path contains no secrets.
chmod 755 ../postgres ../postgres/init
chmod 644 ../postgres/init/*.sql

if [ ! -f .env ]; then
  postgres_password="$(openssl rand -hex 32)"
  {
    printf '%s\n' 'POSTGRES_DB=manolo_platform'
    printf '%s\n' 'POSTGRES_USER=manolo_app'
    printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
  } > .env
  unset postgres_password
fi
chmod 600 .env

docker compose --env-file .env config --quiet
docker compose --env-file .env up -d postgres

attempt=0
until docker compose --env-file .env exec -T postgres \
  sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "PostgreSQL no quedó saludable dentro del tiempo esperado" >&2
    docker compose --env-file .env ps
    exit 1
  fi
  sleep 2
done

docker compose --env-file .env exec -T postgres sh -c \
  'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
  "SELECT table_schema || chr(58) || COUNT(*)
   FROM information_schema.tables
   WHERE table_schema IN (chr(119)||chr(104)||chr(97)||chr(116)||chr(115)||chr(97)||chr(112)||chr(112), chr(112)||chr(114)||chr(105)||chr(110)||chr(116)||chr(95)||chr(115)||chr(121)||chr(115)||chr(116)||chr(101)||chr(109))
   GROUP BY table_schema
   ORDER BY table_schema"'
