#!/bin/sh
set -eu

if [ -n "${CONTACT_ROLE_SMOKE_URL:-}" ]; then
  docker exec -i \
    -e "CONTACT_ROLE_SMOKE_URL=$CONTACT_ROLE_SMOKE_URL" \
    manolo-platform-bridge-1 \
    node --input-type=module - \
    < /opt/manolo-platform/infra/vps/smoke-test-contact-role.mjs
else
  docker exec -i manolo-platform-bridge-1 \
    node --input-type=module - \
    < /opt/manolo-platform/infra/vps/smoke-test-contact-role.mjs
fi
