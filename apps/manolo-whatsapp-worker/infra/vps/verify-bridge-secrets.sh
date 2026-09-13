#!/bin/sh
set -u

secrets_directory="/opt/manolo-platform/infra/vps/secrets"
groq_secret="$secrets_directory/groq_api_key"
bridge_secret="$secrets_directory/vps_bridge_hmac_secret"
credentials_key="$secrets_directory/credentials_encryption_key"

status=0
if [ ! -s "$groq_secret" ]; then
  printf '%s\n' "groq_secret=missing"
  status=1
elif [ "$(wc -c < "$groq_secret")" -lt 20 ]; then
  printf '%s\n' "groq_secret=too_short"
  status=1
else
  printf '%s\n' "groq_secret=ok"
fi

if [ ! -s "$credentials_key" ]; then
  printf '%s\n' "credentials_encryption_key=missing"
  status=1
else
  key_value="$(tr -d '\r\n' < "$credentials_key")"
  if printf '%s' "$key_value" | grep -Eq '^[0-9A-Fa-f]{64}$'; then
    printf '%s\n' "credentials_encryption_key=ok"
  elif [ "$(printf '%s' "$key_value" | base64 -d 2>/dev/null | wc -c)" -eq 32 ]; then
    printf '%s\n' "credentials_encryption_key=ok"
  else
    printf '%s\n' "credentials_encryption_key=invalid_length"
    status=1
  fi
  unset key_value
fi

if [ ! -s "$bridge_secret" ]; then
  printf '%s\n' "bridge_secret=missing"
  status=1
elif [ "$(wc -c < "$bridge_secret")" -lt 32 ]; then
  printf '%s\n' "bridge_secret=too_short"
  status=1
else
  printf '%s\n' "bridge_secret=ok"
fi

exit "$status"
