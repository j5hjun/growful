#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
image_reference="${1:?image reference is required}"
release_id="${2:?release id is required}"
gateway_host_port="${CI_GATEWAY_HOST_PORT:-8100}"
if [[ ! "$image_reference" =~ ^[^[:space:]@]+@sha256:[0-9a-f]{64}$ ]]; then
  printf 'gateway image reference must use an immutable sha256 digest\n' >&2
  exit 1
fi
if [[ ! "$gateway_host_port" =~ ^[0-9]+$ ]] || ((gateway_host_port < 1 || gateway_host_port > 65535)); then
  printf 'CI_GATEWAY_HOST_PORT must be an integer from 1 to 65535\n' >&2
  exit 1
fi
image_name="${image_reference%@sha256:*}"
image_digest="sha256:${image_reference##*@sha256:}"
project_name="smartthings-gateway-ci-${release_id}-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
environment_file="$(mktemp "${TMPDIR:-/tmp}/smartthings-gateway-ci.XXXXXX")"
invalid_selection_response="$(mktemp "${TMPDIR:-/tmp}/smartthings-gateway-invalid-selection.XXXXXX")"

export COMPOSE_PROJECT_NAME="$project_name"
export GATEWAY_ENV_FILE="$environment_file"
export SMARTTHINGS_GATEWAY_IMAGE_DIGEST="$image_digest"
export SMARTTHINGS_GATEWAY_IMAGE_NAME="$image_name"
export SMARTTHINGS_GATEWAY_HOST_PORT="$gateway_host_port"

compose=(docker compose --env-file "$environment_file" -f "$deployment_dir/compose.yaml")
gateway_origin="http://127.0.0.1:$gateway_host_port"

cleanup() {
  local status=$?
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -f "$environment_file" "$invalid_selection_response"
  exit "$status"
}
trap cleanup EXIT

printf '%s\n' \
  'POSTGRES_PASSWORD=gateway-ci-password' \
  'DATABASE_URL=postgresql://gateway:gateway-ci-password@postgres:5432/smartthings_gateway' \
  'PORT=8100' \
  'HOST=0.0.0.0' \
  'LOG_LEVEL=info' \
  'OAUTH_CLIENT_ID=gateway-ci-client' \
  'OAUTH_CLIENT_SECRET=gateway-ci-secret' \
  'OAUTH_REDIRECT_URI=https://smartthings.growful.click/oauth/callback' \
  'PRIVATE_BETA_INVITES_JSON=[{"username":"gateway-ci-beta","passwordHash":"1176116bf496de8e723bf66b3c09dd7534b9898bcdc91450e074513014df81a1"}]' \
  'PUBLIC_OPERATOR_NAME=Growful CI' \
  'PUBLIC_PRIVACY_POLICY_URL=https://smartthings.growful.click/privacy' \
  'PUBLIC_SUPPORT_EMAIL=support@growful.click' \
  'PUBLIC_TERMS_URL=https://smartthings.growful.click/terms' \
  'SERVICE_ACCESS_MODE=private_beta' \
  'SMARTTHINGS_API_URL=https://api.smartthings.com' \
  'SMARTTHINGS_API_TIMEOUT_SECONDS=15' \
  'SMARTTHINGS_APP_ID=gateway-ci-smartthings-app' \
  'SMARTTHINGS_AUTHORIZE_URL=https://api.smartthings.com/oauth/authorize' \
  'SMARTTHINGS_TOKEN_URL=https://api.smartthings.com/oauth/token' \
  'TOKEN_ENCRYPTION_KEY=MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=' \
  'REFRESH_BEFORE_EXPIRY_SECONDS=3600' \
  'REFRESH_CHECK_INTERVAL_SECONDS=300' \
  'REFRESH_LEASE_SECONDS=120' >"$environment_file"

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

test "$(curl --fail --silent --show-error "$gateway_origin/healthz")" = '{"status":"ok"}'
test "$(curl --fail --silent --show-error "$gateway_origin/readyz")" = '{"status":"ready"}'
test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$gateway_origin/")" = '200'
test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$gateway_origin/manage")" = '200'
test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$gateway_origin/robots.txt")" = '200'
test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$gateway_origin/connection")" = '401'
test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$gateway_origin/oauth/start")" = '401'
test "$(curl --silent --show-error --user 'gateway-ci-beta:gateway-ci-beta-password' --output /dev/null --write-out '%{http_code}' "$gateway_origin/oauth/start")" = '200'
test "$(curl --silent --show-error --header 'Content-Type: application/json' --data '{"messageType":"EVENT"}' --output /dev/null --write-out '%{http_code}' "$gateway_origin/smartthings/webhook")" = '401'

for attempt in {1..5}; do
  test "$(curl --silent --show-error --user 'gateway-ci-beta:wrong-password' --header 'X-Forwarded-For: 192.0.2.10' --output /dev/null --write-out '%{http_code}' "$gateway_origin/oauth/start")" = '401'
done
test "$(curl --silent --show-error --user 'gateway-ci-beta:wrong-password' --header 'X-Forwarded-For: 192.0.2.10' --output /dev/null --write-out '%{http_code}' "$gateway_origin/oauth/start")" = '429'
test "$(curl --silent --show-error --user 'gateway-ci-beta:wrong-password' --header 'X-Forwarded-For: 192.0.2.11' --output /dev/null --write-out '%{http_code}' "$gateway_origin/oauth/start")" = '401'

permission_selections=(
  'read'
  'control'
  'write'
  'read control'
  'read write'
  'control write'
  'read control write'
)
valid_selection_count=0
for device_range in selected all; do
  for permission_selection in "${permission_selections[@]}"; do
    payload="deviceRange=$device_range"
    for permission in $permission_selection; do
      payload+="&devicePermissions=$permission"
    done
    test "$(curl --silent --show-error --user 'gateway-ci-beta:gateway-ci-beta-password' --header 'Origin: https://smartthings.growful.click' --data "$payload&policyConsent=accepted" --output /dev/null --write-out '%{http_code}' "$gateway_origin/oauth/start")" = '302'
    ((valid_selection_count += 1))
  done
done

resource_selections=(
  'hubPermissions=read'
  'locationPermissions=read'
  'locationPermissions=write'
  'locationPermissions=execute'
  'locationPermissions=read&locationPermissions=write'
  'locationPermissions=read&locationPermissions=execute'
  'locationPermissions=write&locationPermissions=execute'
  'locationPermissions=read&locationPermissions=write&locationPermissions=execute'
  'scenePermissions=read'
  'scenePermissions=execute'
  'scenePermissions=read&scenePermissions=execute'
  'rulePermissions=read'
  'rulePermissions=write'
  'rulePermissions=read&rulePermissions=write'
)
for resource_selection in "${resource_selections[@]}"; do
  test "$(curl --silent --show-error --user 'gateway-ci-beta:gateway-ci-beta-password' --header 'Origin: https://smartthings.growful.click' --data "deviceRange=selected&$resource_selection&policyConsent=accepted" --output /dev/null --write-out '%{http_code}' "$gateway_origin/oauth/start")" = '302'
  ((valid_selection_count += 1))
done

every_resource_permissions='devicePermissions=read&devicePermissions=control&devicePermissions=write&hubPermissions=read&locationPermissions=read&locationPermissions=write&locationPermissions=execute&scenePermissions=read&scenePermissions=execute&rulePermissions=read&rulePermissions=write'
for device_range in selected all; do
  test "$(curl --silent --show-error --user 'gateway-ci-beta:gateway-ci-beta-password' --header 'Origin: https://smartthings.growful.click' --data "deviceRange=$device_range&$every_resource_permissions&policyConsent=accepted" --output /dev/null --write-out '%{http_code}' "$gateway_origin/oauth/start")" = '302'
  ((valid_selection_count += 1))
done
test "$valid_selection_count" = '30'

invalid_selection_count=0
for device_range in selected all; do
  test "$(curl --silent --show-error --user 'gateway-ci-beta:gateway-ci-beta-password' --header 'Origin: https://smartthings.growful.click' --data "deviceRange=$device_range" --output "$invalid_selection_response" --write-out '%{http_code}' "$gateway_origin/oauth/start")" = '400'
  grep --quiet 'role="alert"' "$invalid_selection_response"
  ((invalid_selection_count += 1))
done
test "$invalid_selection_count" = '2'
test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$gateway_origin/v1/devices")" = '401'

restart_count="$(docker inspect --format='{{.RestartCount}}' "$container_id")"
test "$restart_count" = '0'
