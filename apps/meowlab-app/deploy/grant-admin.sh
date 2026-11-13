#!/bin/sh
# Otorga o quita el rol de administrador del portal. Ejecutar en el VPS:
#   sh grant-admin.sh grant correo@dominio
#   sh grant-admin.sh revoke correo@dominio
#   sh grant-admin.sh list
# Sólo otorga a cuentas que entraron con Google y tienen el correo verificado: hoy el
# registro con contraseña no verifica correos y cualquiera podría usar uno ajeno.
set -eu

container="${POSTGRES_CONTAINER:-manolo-platform-postgres-1}"
action="${1:-}"
email="${2:-}"

psql_portal() {
  docker exec -i "$container" sh -c 'psql -v ON_ERROR_STOP=1 -q -At -U "$POSTGRES_USER" -d meowlab_app "$@"' -- "$@"
}

case "$action" in
  grant)
    [ -n "$email" ] || { echo "Uso: sh grant-admin.sh grant correo" >&2; exit 2; }
    result="$(psql_portal -v email="$email" <<'SQL'
UPDATE "user" u SET role = 'admin', "updatedAt" = now()
 WHERE lower(u.email) = lower(:'email')
   AND u."emailVerified"
   AND EXISTS (SELECT 1 FROM account a WHERE a."userId" = u.id AND a."providerId" = 'google')
RETURNING u.email;
SQL
)"
    if [ -z "$result" ]; then
      echo "No se otorgó: la cuenta no existe, no entró con Google o su correo no está verificado." >&2
      exit 1
    fi
    echo "Administrador: $result"
    ;;
  revoke)
    [ -n "$email" ] || { echo "Uso: sh grant-admin.sh revoke correo" >&2; exit 2; }
    result="$(psql_portal -v email="$email" <<'SQL'
UPDATE "user" SET role = 'user', "updatedAt" = now() WHERE lower(email) = lower(:'email') AND role = 'admin' RETURNING email;
SQL
)"
    [ -n "$result" ] && echo "Ya no es administrador: $result" || echo "Esa cuenta no era administradora."
    ;;
  list)
    echo 'SELECT email FROM "user" WHERE role = '"'admin'"' ORDER BY email;' | psql_portal
    ;;
  *)
    echo "Uso: sh grant-admin.sh grant|revoke correo  |  sh grant-admin.sh list" >&2
    exit 2
    ;;
esac
