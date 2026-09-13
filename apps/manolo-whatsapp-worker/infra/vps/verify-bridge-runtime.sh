#!/bin/sh
set -eu

bridge_container="manolo-platform-bridge-1"
postgres_container="manolo-platform-postgres-1"

attempt=1
while [ "$attempt" -le 6 ]; do
  health="$(docker inspect "$bridge_container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
  [ "$health" = "healthy" ] && break
  sleep 5
  attempt=$((attempt + 1))
done

test "$health" = "healthy"
docker ps --filter name=manolo-platform \
  --format '{{.Names}}|{{.Status}}|{{.Ports}}'
docker inspect "$bridge_container" \
  --format 'ports={{json .NetworkSettings.Ports}} networks={{json .NetworkSettings.Networks}}'
docker logs --tail 20 "$bridge_container"
docker exec "$postgres_container" sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT (SELECT count(*) FROM whatsapp.messages),(SELECT count(*) FROM print_system.ventas),(SELECT count(*) FROM whatsapp.bridge_requests);"'
