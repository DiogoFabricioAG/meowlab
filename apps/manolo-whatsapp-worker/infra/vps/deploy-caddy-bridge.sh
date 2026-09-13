#!/bin/sh
set -eu

source_directory="/opt/manolo-platform/infra/vps/facturaya-caddy"
facturaya_directory="/opt/facturaya-ai"
caddy_container="facturaya-ai-caddy-1"
backup_directory="$facturaya_directory/backups/manolo-bridge-$(date -u +%Y%m%dT%H%M%SZ)"

test -f "$source_directory/compose.vps.yaml"
test -f "$source_directory/Caddyfile"
test -f "$facturaya_directory/compose.yaml"
test -f "$facturaya_directory/compose.vps.yaml"
test -f "$facturaya_directory/docker/caddy/Caddyfile"
test -f "$facturaya_directory/.env.production"

install -d -m 700 "$backup_directory"
cp -p "$facturaya_directory/compose.vps.yaml" \
  "$backup_directory/compose.vps.yaml"
cp -p "$facturaya_directory/docker/caddy/Caddyfile" \
  "$backup_directory/Caddyfile"

completed=false
rollback() {
  if [ "$completed" = "false" ]; then
    cp "$backup_directory/compose.vps.yaml" \
      "$facturaya_directory/compose.vps.yaml"
    cp "$backup_directory/Caddyfile" \
      "$facturaya_directory/docker/caddy/Caddyfile"
    rm -f -- "$facturaya_directory/compose.vps.yaml.candidate"
    docker exec "$caddy_container" \
      caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
  fi
}
trap rollback EXIT HUP INT TERM

cp "$source_directory/compose.vps.yaml" \
  "$facturaya_directory/compose.vps.yaml.candidate"
cd "$facturaya_directory"
docker compose \
  -f compose.yaml \
  -f compose.vps.yaml.candidate \
  --env-file .env.production \
  config --quiet

if ! docker inspect "$caddy_container" \
  --format '{{json .NetworkSettings.Networks}}' | grep -q 'manolo_ingress'; then
  docker network connect manolo_ingress "$caddy_container"
fi

docker cp "$source_directory/Caddyfile" "$caddy_container:/tmp/Caddyfile.manolo"
docker exec "$caddy_container" \
  caddy validate --config /tmp/Caddyfile.manolo

cp "$source_directory/compose.vps.yaml" \
  "$facturaya_directory/compose.vps.yaml"
cp "$source_directory/Caddyfile" \
  "$facturaya_directory/docker/caddy/Caddyfile"
rm -f -- "$facturaya_directory/compose.vps.yaml.candidate"

docker exec "$caddy_container" \
  caddy reload --config /etc/caddy/Caddyfile

completed=true
trap - EXIT HUP INT TERM
printf '%s\n' "caddy_bridge=ok" "backup=$backup_directory"
