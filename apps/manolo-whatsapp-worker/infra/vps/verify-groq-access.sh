#!/bin/sh
set -eu

secret_file="/opt/manolo-platform/infra/vps/secrets/groq_api_key"
test -s "$secret_file"
first_bytes="$(head -c 3 "$secret_file" | od -An -t x1 | tr -d ' \n')"
if [ "$first_bytes" = "efbbbf" ]; then
  api_key="$(tail -c +4 "$secret_file" | tr -d '\r\n')"
else
  api_key="$(tr -d '\r\n' < "$secret_file")"
fi

http_status="$(curl --silent --show-error --output /dev/null \
  --write-out '%{http_code}' \
  --connect-timeout 10 \
  --max-time 20 \
  --header "Authorization: Bearer $api_key" \
  https://api.groq.com/openai/v1/models)"

if [ "$http_status" = "200" ]; then
  printf '%s\n' "groq_api=ok"
  exit 0
fi

printf '%s\n' "groq_api=http_$http_status"
exit 1
