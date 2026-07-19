#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
image_name="${1:?image name is required}"
image_tag="${2:?image tag is required}"
project_name="smartthings-gateway-ci-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
environment_file="$(mktemp "${TMPDIR:-/tmp}/smartthings-gateway-ci.XXXXXX")"

export COMPOSE_PROJECT_NAME="$project_name"
export GATEWAY_ENV_FILE="$environment_file"
export IMAGE_TAG="$image_tag"
export SMARTTHINGS_GATEWAY_IMAGE="$image_name"

compose=(docker compose --env-file "$environment_file" -f "$deployment_dir/compose.yaml")

cleanup() {
  local status=$?
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -f "$environment_file"
  exit "$status"
}
trap cleanup EXIT

printf '%s\n' \
  'POSTGRES_PASSWORD=gateway-ci-password' \
  'DATABASE_URL=postgresql://gateway:gateway-ci-password@postgres:5432/smartthings_gateway' \
  'PORT=8100' \
  'HOST=0.0.0.0' \
  'LOG_LEVEL=info' \
  'OAUTH_ADMIN_TOKEN=gateway-ci-admin-token-with-32-characters' \
  'OAUTH_CLIENT_ID=gateway-ci-client' \
  'OAUTH_CLIENT_SECRET=gateway-ci-secret' \
  'OAUTH_REDIRECT_URI=https://smartthings.growful.click/oauth/callback' \
  'SMARTTHINGS_SCOPES=r:locations:* r:devices:$ r:devices:*' \
  'SMARTTHINGS_AUTHORIZE_URL=https://api.smartthings.com/oauth/authorize' \
  'SMARTTHINGS_TOKEN_URL=https://api.smartthings.com/oauth/token' \
  'TOKEN_ENCRYPTION_KEY=MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=' \
  'REFRESH_BEFORE_EXPIRY_SECONDS=3600' \
  'REFRESH_CHECK_INTERVAL_SECONDS=300' \
  'REFRESH_LEASE_SECONDS=60' >"$environment_file"

"${compose[@]}" up -d postgres
"${compose[@]}" run --rm gateway node dist/migrate.js
"${compose[@]}" run --rm gateway node dist/migrate.js
"${compose[@]}" up -d --no-deps gateway

for attempt in {1..30}; do
  container_id="$("${compose[@]}" ps --all -q gateway 2>/dev/null || true)"
  health=""
  if [[ -n "$container_id" ]]; then
    health="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  fi
  if [[ "$health" == "healthy" ]]; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    "${compose[@]}" ps
    "${compose[@]}" logs --tail=100 gateway
    exit 1
  fi
  sleep 2
done

test "$(curl --fail --silent --show-error http://127.0.0.1:8100/healthz)" = '{"status":"ok"}'
test "$(curl --fail --silent --show-error http://127.0.0.1:8100/connection)" = '{"connected":false}'
test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8100/oauth/start)" = '401'
test "$(curl --silent --show-error --user operator:gateway-ci-admin-token-with-32-characters --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8100/oauth/start)" = '302'

restart_count="$(docker inspect --format='{{.RestartCount}}' "$container_id")"
test "$restart_count" = '0'
