#!/usr/bin/env bash
set -euo pipefail

previous_image="${1:?previous image is required}"
candidate_image="${2:?candidate image is required}"
run_id="${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="smartthings-gateway-version-skew-${run_id}"
postgres="smartthings-gateway-version-skew-postgres-${run_id}"
previous="smartthings-gateway-version-skew-previous-${run_id}"
candidate="smartthings-gateway-version-skew-candidate-${run_id}"
environment_file="$(mktemp "${TMPDIR:-/tmp}/smartthings-gateway-version-skew.XXXXXX")"
candidate_environment_file="$(mktemp "${TMPDIR:-/tmp}/smartthings-gateway-version-skew-candidate.XXXXXX")"
rollback_environment_file="$(mktemp "${TMPDIR:-/tmp}/smartthings-gateway-version-skew-rollback.XXXXXX")"
postgres_image="postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193"

cleanup() {
  local status=$?
  docker rm --force "$previous" "$candidate" "$postgres" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -f "$environment_file" "$candidate_environment_file" "$rollback_environment_file"
  exit "$status"
}
trap cleanup EXIT

# The rollback image still requires its legacy policy URL inputs. The candidate
# environment below removes them before the new image starts.
printf '%s\n' \
  'DATABASE_URL=postgresql://gateway:gateway-version-skew-password@postgres:5432/smartthings_gateway' \
  'GATEWAY_API_TOKEN=gateway-version-skew-api-token-32-characters' \
  'PORT=8100' \
  'HOST=0.0.0.0' \
  'LOG_LEVEL=info' \
  'OAUTH_ADMIN_TOKEN=gateway-version-skew-admin-token-32-characters' \
  'OAUTH_CLIENT_ID=gateway-version-skew-client' \
  'OAUTH_CLIENT_SECRET=gateway-version-skew-secret' \
  'OAUTH_REDIRECT_URI=https://smartthings.growful.click/oauth/callback' \
  'SERVICE_ACCESS_MODE=private_beta' \
  'PRIVATE_BETA_INVITES_JSON=[{"username":"gateway-version-skew-beta","passwordHash":"5ddf8b91211dce99eacd9d5923f5a6fa47c4943630855c921a50c47f111aa2ee"}]' \
  'PUBLIC_OPERATOR_NAME=Growful version skew' \
  'PUBLIC_SUPPORT_EMAIL=support@growful.click' \
  'PUBLIC_PRIVACY_POLICY_URL=https://smartthings.growful.click/privacy' \
  'PUBLIC_TERMS_URL=https://smartthings.growful.click/terms' \
  'SMARTTHINGS_API_URL=https://api.smartthings.com' \
  'SMARTTHINGS_API_TIMEOUT_SECONDS=15' \
  'SMARTTHINGS_APP_ID=gateway-version-skew-app' \
  'SMARTTHINGS_AUTHORIZE_URL=https://api.smartthings.com/oauth/authorize' \
  'SMARTTHINGS_TOKEN_URL=https://api.smartthings.com/oauth/token' \
  'SMARTTHINGS_SCOPES=r:locations:* r:devices:$ r:devices:*' \
  'TOKEN_ENCRYPTION_KEY=MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=' \
  'REFRESH_BEFORE_EXPIRY_SECONDS=3600' \
  'REFRESH_CHECK_INTERVAL_SECONDS=300' \
  'REFRESH_LEASE_SECONDS=120' >"$environment_file"

docker network create "$network" >/dev/null
docker run --detach --name "$postgres" --network "$network" --network-alias postgres \
  --env POSTGRES_DB=smartthings_gateway \
  --env POSTGRES_PASSWORD=gateway-version-skew-password \
  --env POSTGRES_USER=gateway \
  "$postgres_image" >/dev/null

for attempt in {1..30}; do
  if docker exec "$postgres" pg_isready --username gateway --dbname smartthings_gateway >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    docker logs "$postgres"
    exit 1
  fi
  sleep 1
done

run_migrations() {
  local image="$1"
  local runtime_environment_file="${2:-$environment_file}"
  docker run --rm --network "$network" --env-file "$runtime_environment_file" \
    "$image" node dist/migrate.js
}

start_and_verify() {
  local container="$1"
  local image="$2"
  local runtime_environment_file="${3:-$environment_file}"
  docker run --detach --name "$container" --network "$network" \
    --env-file "$runtime_environment_file" \
    "$image" >/dev/null
  for attempt in {1..30}; do
    if docker exec "$container" node -e \
      "fetch('http://127.0.0.1:8100/healthz').then(async response=>{if(!response.ok||await response.text()!=='{\"status\":\"ok\"}')process.exit(1)}).catch(()=>process.exit(1))"; then
      return 0
    fi
    if ! docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null | grep --quiet '^true$'; then
      docker logs "$container"
      return 1
    fi
    sleep 1
  done
  docker logs "$container"
  return 1
}

run_migrations "$previous_image"
start_and_verify "$previous" "$previous_image"
docker rm --force "$previous" >/dev/null
docker exec "$postgres" psql --username gateway --dbname smartthings_gateway \
  --command "insert into oauth_states (state_hash, expires_at) values ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', now() + interval '10 minutes')" \
  >/dev/null
docker exec "$postgres" psql --username gateway --dbname smartthings_gateway \
  --command "insert into oauth_tokens (installed_app_id, access_token_ciphertext, refresh_token_ciphertext, expires_at, scope, token_type, updated_at) values ('legacy-installed-app', 'legacy-access', 'legacy-refresh', now() + interval '1 day', 'r:devices:*', 'bearer', now())" \
  >/dev/null
grep --extended-regexp --invert-match \
  '^(SMARTTHINGS_SCOPES|GATEWAY_API_TOKEN|OAUTH_ADMIN_TOKEN|PUBLIC_PRIVACY_POLICY_URL|PUBLIC_TERMS_URL)=' \
  "$environment_file" >"$candidate_environment_file"
grep --extended-regexp --invert-match '^SMARTTHINGS_SCOPES=' \
  "$environment_file" >"$rollback_environment_file"
printf '\n%s\n' 'SMARTTHINGS_SCOPES=r:devices:$' \
  >>"$rollback_environment_file"
test "$(grep --count '^SMARTTHINGS_SCOPES=' "$candidate_environment_file" || true)" = "0"
test "$(grep --count '^GATEWAY_API_TOKEN=' "$candidate_environment_file" || true)" = "0"
test "$(grep --count '^OAUTH_ADMIN_TOKEN=' "$candidate_environment_file" || true)" = "0"
test "$(grep --count '^PUBLIC_PRIVACY_POLICY_URL=' "$candidate_environment_file" || true)" = "0"
test "$(grep --count '^PUBLIC_TERMS_URL=' "$candidate_environment_file" || true)" = "0"
test "$(grep --count '^PRIVATE_BETA_INVITES_JSON=' "$candidate_environment_file" || true)" = "1"
test "$(grep --count '^PRIVATE_BETA_INVITES_JSON=' "$rollback_environment_file" || true)" = "1"
test "$(grep --count '^PUBLIC_PRIVACY_POLICY_URL=' "$rollback_environment_file" || true)" = "1"
test "$(grep --count '^PUBLIC_TERMS_URL=' "$rollback_environment_file" || true)" = "1"
test "$(grep --fixed-strings --line-regexp --count 'SMARTTHINGS_SCOPES=r:devices:$' "$rollback_environment_file")" = "1"

run_migrations "$candidate_image" "$candidate_environment_file"
test "$(docker exec "$postgres" psql --username gateway --dbname smartthings_gateway \
  --tuples-only --no-align \
  --command "select count(*) from oauth_states where state_hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' and requested_scopes = ''")" = "1"
test "$(docker exec "$postgres" psql --username gateway --dbname smartthings_gateway \
  --tuples-only --no-align --command "select count(*) from oauth_tokens")" = "0"
start_and_verify "$candidate" "$candidate_image" "$candidate_environment_file"
rollback_state="$(docker exec "$candidate" node -e '
fetch("http://127.0.0.1:8100/oauth/start", {
  body: "deviceRange=selected&scenePermissions=read&policyConsent=accepted",
  headers: {
    authorization: `Basic ${Buffer.from("gateway-version-skew-beta:gateway-version-skew-beta-password").toString("base64")}`,
    "content-type": "application/x-www-form-urlencoded",
    origin: "https://smartthings.growful.click",
  },
  method: "POST",
  redirect: "manual",
}).then((response) => {
  const location = response.headers.get("location")
  if (response.status !== 302 || location === null) process.exit(1)
  const state = new URL(location).searchParams.get("state")
  if (state === null) process.exit(1)
  process.stdout.write(state)
}).catch(() => process.exit(1))
')"
test -n "$rollback_state"
test "$(docker exec "$postgres" psql --username gateway --dbname smartthings_gateway \
  --tuples-only --no-align \
  --command "select count(*) from oauth_states where requested_scopes = 'r:scenes:*'")" = "1"
rollback_token="grw_st_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
rollback_token_hash="$(printf '%s' "$rollback_token" | openssl dgst -sha256 -r | cut -d' ' -f1)"
docker exec "$postgres" psql --username gateway --dbname smartthings_gateway \
  --command "insert into smart_things_connections (installed_app_id, growful_token_hash, growful_token_created_at, consented_at, policy_version, private_beta_username, access_token_ciphertext, refresh_token_ciphertext, expires_at, scope, token_type, updated_at) values ('candidate-installed-app', '$rollback_token_hash', now(), now(), repeat('b', 64), 'gateway-version-skew-beta', 'candidate-access', 'candidate-refresh', now() + interval '1 day', 'r:devices:*', 'bearer', now())" \
  >/dev/null
docker rm --force "$candidate" >/dev/null
docker run --rm --network "$network" --env-file "$candidate_environment_file" \
  "$candidate_image" node dist/prepare-rollback.js
test "$(docker exec "$postgres" psql --username gateway --dbname smartthings_gateway \
  --tuples-only --no-align --command "select count(*) from oauth_states")" = "0"
test "$(docker exec "$postgres" psql --username gateway --dbname smartthings_gateway \
  --tuples-only --no-align --command "select count(*) from smart_things_connections")" = "0"

start_and_verify "$previous" "$previous_image" "$rollback_environment_file"
test "$(docker exec "$previous" node -e '
fetch("http://127.0.0.1:8100/connection", {
  headers: { authorization: `Bearer ${process.argv[1]}` },
}).then((response) => process.stdout.write(String(response.status))).catch(() => process.exit(1))
' -- "$rollback_token")" = "401"
docker exec "$previous" node -e '
const state = process.argv[1]
fetch(`http://127.0.0.1:8100/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`)
  .then(async (response) => {
    const body = await response.json().catch(() => null)
    if (response.status !== 400 || body?.error !== "invalid_oauth_state") process.exit(1)
  })
  .catch(() => process.exit(1))
' -- "$rollback_state"
test "$(docker exec "$postgres" psql --username gateway --dbname smartthings_gateway \
  --tuples-only --no-align \
  --command "select count(*) from oauth_states where requested_scopes = 'r:scenes:*'")" = "0"
