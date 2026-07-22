#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
environment_file="$(mktemp "${TMPDIR:-/tmp}/growful-compose-environment.XXXXXX")"
rendered_config="$(mktemp "${TMPDIR:-/tmp}/growful-compose-config.XXXXXX")"

cleanup() {
  rm -f "$environment_file" "$rendered_config"
}
trap cleanup EXIT

printf '%s\n' \
  'POSTGRES_PASSWORD=compose-test-password' \
  'DATABASE_URL=postgresql://gateway:compose-test-password@postgres:5432/smartthings_gateway' \
  'PORT=8100' \
  'HOST=0.0.0.0' \
  'LOG_LEVEL=info' \
  'OAUTH_CLIENT_ID=compose-test-client' \
  'OAUTH_CLIENT_SECRET=compose-test-secret' \
  'OAUTH_REDIRECT_URI=https://smartthings.growful.click/oauth/callback' \
  'PRIVATE_BETA_INVITES_JSON=[{"username":"compose-test","passwordHash":"dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42"}]' \
  'PUBLIC_OPERATOR_NAME=Growful' \
  'PUBLIC_SUPPORT_EMAIL=support@growful.click' \
  'SERVICE_ACCESS_MODE=private_beta' \
  'SMARTTHINGS_API_URL=https://api.smartthings.com' \
  'SMARTTHINGS_API_TIMEOUT_SECONDS=15' \
  'SMARTTHINGS_APP_ID=compose-test-app' \
  'SMARTTHINGS_AUTHORIZE_URL=https://api.smartthings.com/oauth/authorize' \
  'SMARTTHINGS_TOKEN_URL=https://api.smartthings.com/oauth/token' \
  'TOKEN_ENCRYPTION_KEY=MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=' \
  'REFRESH_BEFORE_EXPIRY_SECONDS=3600' \
  'REFRESH_CHECK_INTERVAL_SECONDS=300' \
  'REFRESH_LEASE_SECONDS=120' >"$environment_file"

SMARTTHINGS_GATEWAY_IMAGE_NAME='registry.example/gateway' \
SMARTTHINGS_GATEWAY_IMAGE_DIGEST='sha256:0000000000000000000000000000000000000000000000000000000000000001' \
GATEWAY_ENV_FILE="$environment_file" \
docker compose --env-file "$environment_file" -f "$deployment_dir/compose.yaml" \
  config --format json >"$rendered_config"

node --input-type=module - "$rendered_config" <<'NODE'
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const configPath = process.argv[2]
assert.ok(configPath)
const config = JSON.parse(readFileSync(configPath, "utf8"))
const gateway = config.services.gateway
const postgres = config.services.postgres

assert.equal(gateway.read_only, true)
assert.deepEqual(gateway.cap_drop, ["ALL"])
assert.ok(gateway.security_opt.includes("no-new-privileges:true"))
assert.equal(
  gateway.environment.DATABASE_URL,
  "postgresql://gateway:compose-test-password@postgres:5432/smartthings_gateway",
)
assert.equal(gateway.environment.OAUTH_CLIENT_SECRET, "compose-test-secret")
assert.equal(
  gateway.environment.TOKEN_ENCRYPTION_KEY,
  "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
)
assert.equal(gateway.environment.DATABASE_URL_FILE, undefined)
assert.equal(gateway.environment.OAUTH_CLIENT_SECRET_FILE, undefined)
assert.equal(gateway.environment.TOKEN_ENCRYPTION_KEY_FILE, undefined)

assert.notEqual(postgres.read_only, true)
assert.equal(postgres.cap_drop, undefined)
assert.equal(postgres.security_opt, undefined)
NODE
