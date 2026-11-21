#!/usr/bin/env bash
set -euo pipefail

# Fuente del código: por defecto, el tar de `git archive` llega por stdin desde
# el equipo local, porque el VPS no tiene clon del repo (ver README):
#   git archive --format=tar <commit> apps/manolo-whatsapp-worker \
#     | ssh meowlab 'bash /tmp/stage-bridge-release.sh <commit> <release-id>'
# Con MEOWLAB_REPO_DIR=<clon> se usa ese clon en lugar de stdin.
DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
  shift
fi

if [[ $# -ne 2 ]]; then
  echo "Uso: git archive --format=tar <commit> apps/manolo-whatsapp-worker | $0 [--dry-run] <commit-publicado> <release-id>" >&2
  echo "     o MEOWLAB_REPO_DIR=<clon> $0 [--dry-run] <commit-publicado> <release-id>" >&2
  exit 2
fi

COMMIT="$1"
RELEASE_ID="$2"

if [[ ! "$COMMIT" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  echo "Error: commit inválido ($COMMIT). Usa un hash hexadecimal de 7 a 40 caracteres." >&2
  exit 2
fi

if [[ ! "$RELEASE_ID" =~ ^[a-zA-Z0-9._-]{3,80}$ ]]; then
  echo "Error: release-id inválido ($RELEASE_ID)." >&2
  exit 2
fi

PLATFORM_DIR="${MANOLO_PLATFORM_DIR:-/opt/manolo-platform}"
REPO_DIR="${MEOWLAB_REPO_DIR:-}"
RELEASE_DIR="$PLATFORM_DIR/releases/$RELEASE_ID"
CHECK_TENANT_ID="${CHECK_TENANT_ID:-01m048fqcze7628368f321xytj}"

run_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

if [[ "$DRY_RUN" -eq 0 && -e "$RELEASE_DIR" ]]; then
  echo "Error: la release $RELEASE_DIR ya existe." >&2
  exit 1
fi

if [[ -z "$REPO_DIR" && -t 0 && "$DRY_RUN" -eq 0 ]]; then
  echo "Error: no llegó el tar de git archive por stdin y MEOWLAB_REPO_DIR no está definido." >&2
  exit 2
fi

echo "==> 1/6 Extrayendo source/ ($COMMIT, fuente: ${REPO_DIR:-stdin})"
run_cmd mkdir -p "$RELEASE_DIR/source"
if [[ "$DRY_RUN" -eq 1 ]]; then
  if [[ -n "$REPO_DIR" ]]; then
    echo "[dry-run] git -C $REPO_DIR archive --format=tar $COMMIT apps/manolo-whatsapp-worker | tar -x --strip-components=2 -C $RELEASE_DIR/source"
  else
    echo "[dry-run] tar -x --strip-components=2 -C $RELEASE_DIR/source  (desde stdin)"
  fi
  echo "[dry-run] printf '%s\n' '$COMMIT' > $RELEASE_DIR/commit.txt"
elif [[ -z "$REPO_DIR" ]]; then
  tar -x --strip-components=2 -C "$RELEASE_DIR/source"
  test -f "$RELEASE_DIR/source/package.json" \
    || { echo "Error: el tar de stdin no contiene apps/manolo-whatsapp-worker." >&2; exit 1; }
  printf '%s\n' "$COMMIT" > "$RELEASE_DIR/commit.txt"
else
  git -C "$REPO_DIR" cat-file -e "${COMMIT}^{commit}"
  git -C "$REPO_DIR" archive --format=tar "$COMMIT" apps/manolo-whatsapp-worker \
    | tar -x --strip-components=2 -C "$RELEASE_DIR/source"
  printf '%s\n' "$COMMIT" > "$RELEASE_DIR/commit.txt"
fi

echo "==> 2/6 Preparando companies-check.mjs (comprobaciones firmadas esperando forbidden)"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] escribir $RELEASE_DIR/companies-check.mjs (billing, mine, lookup, team, preview, weekly, collections, reorder, support)"
else
  cat > "$RELEASE_DIR/companies-check.mjs" <<EOF
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
const secret = readFileSync("/run/secrets/portal_bridge_hmac_secret", "utf8").trim();
async function call(path, payload) {
  const requestId = "cutover-" + payload.action;
  const body = JSON.stringify({ version: 1, requestId, portalUserId: "cutover-check", ...payload });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = "sha256=" + createHmac("sha256", secret).update(ts + "." + body).digest("hex");
  const r = await fetch("http://127.0.0.1:3000" + path, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-manolo-timestamp": ts,
      "x-manolo-signature": sig,
      "x-manolo-request-id": requestId,
    },
  });
  const data = await r.json();
  return { http: r.status, status: data.status, count: data.companies?.length, legalName: data.taxpayer?.legalName };
}
console.log(JSON.stringify({
  billing: await call("/v1/portal/billing", { action: "companies" }),
  mine: await call("/v1/portal/companies", { action: "mine" }),
  lookup: await call("/v1/portal/companies", { action: "lookup", ruc: "20131312955" }),
  team: await call("/v1/portal/companies", { action: "team", tenantId: "cutover-none" }),
  preview: await call("/v1/portal/companies", { action: "preview", token: "Zzzzzzzzzzzzzzzzzzzzzz" }),
  weekly: await call("/v1/portal/companies", { action: "weekly", tenantId: "$CHECK_TENANT_ID" }),
  collections: await call("/v1/portal/companies", { action: "collections_view", tenantId: "$CHECK_TENANT_ID" }),
  reorder: await call("/v1/portal/companies", { action: "reorder_view", tenantId: "$CHECK_TENANT_ID" }),
  support: await call("/v1/portal/companies", { action: "support_view", tenantId: "$CHECK_TENANT_ID" }),
}));
EOF
fi

echo "==> 3/6 Creando cutover.sh y rollback.sh"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] escribir $RELEASE_DIR/cutover.sh y $RELEASE_DIR/rollback.sh (chmod +x)"
else
  cat > "$RELEASE_DIR/cutover.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
R="$RELEASE_DIR"
trap 'code=\$?; echo deployment_check_failed; bash "\$R/rollback.sh" </dev/null; exit "\$code"' ERR
rm -rf "$PLATFORM_DIR/src"
cp -r "\$R/source/src" "$PLATFORM_DIR/src"
for f in package.json package-lock.json tsconfig.json worker-configuration.d.ts infra/vps/compose.yml infra/vps/README.md; do
  cp "\$R/source/\$f" "$PLATFORM_DIR/\$f"
done
diff -r "\$R/source/src" "$PLATFORM_DIR/src" >/dev/null && echo host_source_synced
docker image tag "manolo-platform-bridge:$RELEASE_ID" manolo-platform-bridge:latest
cd "$PLATFORM_DIR/infra/vps" && docker compose --env-file .env up -d --no-deps --no-build bridge </dev/null
for i in \$(seq 1 30); do
  [ "\$(docker inspect -f '{{.State.Health.Status}}' manolo-platform-bridge-1)" = healthy ] && break
  sleep 2
done
test "\$(docker inspect -f '{{.State.Health.Status}}' manolo-platform-bridge-1)" = healthy
test "\$(docker inspect -f '{{.Image}}' manolo-platform-bridge-1)" = "\$(docker image inspect -f '{{.Id}}' "manolo-platform-bridge:$RELEASE_ID")"
echo bridge_running_new_image
result=\$(docker exec -i -w /app manolo-platform-bridge-1 node --input-type=module < "\$R/companies-check.mjs")
echo "\$result" | tee "\$R/companies-check.json"
echo "\$result" | grep -q '"billing":{"http":200,"status":"not_linked"'
echo "\$result" | grep -q '"mine":{"http":200,"status":"ok","count":0}'
echo "\$result" | grep -q '"lookup":{"http":200,"status":"ok"'
echo "\$result" | grep -q '"team":{"http":200,"status":"forbidden"}'
echo "\$result" | grep -q '"preview":{"http":200,"status":"invalid"}'
echo "\$result" | grep -q '"weekly":{"http":200,"status":"forbidden"}'
echo "\$result" | grep -q '"collections":{"http":200,"status":"forbidden"}'
echo "\$result" | grep -q '"reorder":{"http":200,"status":"forbidden"}'
echo "\$result" | grep -q '"support":{"http":200,"status":"forbidden"}'
echo cutover_verified
trap - ERR
EOF

  cat > "$RELEASE_DIR/rollback.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$PLATFORM_DIR"
rm -rf src
tar -xzf "$RELEASE_DIR/source-before.tar.gz" -C "$PLATFORM_DIR"
docker image tag "manolo-platform-bridge:rollback-$RELEASE_ID" manolo-platform-bridge:latest
cd "$PLATFORM_DIR/infra/vps" && docker compose --env-file .env up -d --no-deps --no-build bridge
EOF

  chmod +x "$RELEASE_DIR/cutover.sh" "$RELEASE_DIR/rollback.sh"
fi

echo "==> 4/6 Guardando respaldo source-before.tar.gz"
run_cmd tar -czf "$RELEASE_DIR/source-before.tar.gz" -C "$PLATFORM_DIR" src

echo "==> 5/6 Etiquetando imagen actual como rollback-$RELEASE_ID"
run_cmd docker image tag manolo-platform-bridge:latest "manolo-platform-bridge:rollback-$RELEASE_ID"

echo "==> 6/6 Construyendo imagen manolo-platform-bridge:$RELEASE_ID"
run_cmd docker build -f "$RELEASE_DIR/source/infra/vps/bridge.Dockerfile" -t "manolo-platform-bridge:$RELEASE_ID" "$RELEASE_DIR/source"

echo "Staging listo en $RELEASE_DIR"
