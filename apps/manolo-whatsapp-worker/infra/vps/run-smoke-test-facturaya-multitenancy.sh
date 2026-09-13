#!/bin/sh
set -eu

if [ -n "${FACTURAYA_SMOKE_URL:-}" ]; then
  docker exec -i \
    -e "FACTURAYA_SMOKE_URL=$FACTURAYA_SMOKE_URL" \
    manolo-platform-bridge-1 \
    node --input-type=module - \
    < /opt/manolo-platform/infra/vps/smoke-test-facturaya-multitenancy.mjs
else
  docker exec -i manolo-platform-bridge-1 \
    node --input-type=module - \
    < /opt/manolo-platform/infra/vps/smoke-test-facturaya-multitenancy.mjs
fi
