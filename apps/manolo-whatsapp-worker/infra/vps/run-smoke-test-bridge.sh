#!/bin/sh
set -eu

if [ -n "${BRIDGE_SMOKE_URL:-}" ]; then
  docker exec -i \
    -e "BRIDGE_SMOKE_URL=$BRIDGE_SMOKE_URL" \
    manolo-platform-bridge-1 \
    node --input-type=module - \
    < /opt/manolo-platform/infra/vps/smoke-test-bridge.mjs
else
  docker exec -i manolo-platform-bridge-1 \
    node --input-type=module - \
    < /opt/manolo-platform/infra/vps/smoke-test-bridge.mjs
fi
