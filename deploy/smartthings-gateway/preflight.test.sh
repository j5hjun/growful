#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary_root="${TMPDIR:-/tmp}"
test_root="$(mktemp -d "${temporary_root%/}/smartthings-gateway-preflight-test.XXXXXX")"
deployment_root="$test_root/deployment"
release_dir="$deployment_root/releases/test"
fake_bin="$test_root/bin"

cleanup() {
  rm -rf "$test_root"
}
trap cleanup EXIT

mkdir -p "$release_dir" "$fake_bin"
cp "$source_dir/preflight.sh" "$source_dir/compose.yaml" "$release_dir/"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ "$1" == "info" && "$*" == *Architecture* ]]; then' \
  '  printf "%s\n" "${FAKE_ARCHITECTURE:-x86_64}"' \
  'fi' >"$fake_bin/docker"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'value="$(cat)"' \
  'if [[ "$value" != "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=" ]]; then' \
  '  exit 1' \
  'fi' \
  'printf "00000000000000000000000000000000"' >"$fake_bin/base64"

printf '%s\n' '#!/usr/bin/env bash' 'exit 0' >"$fake_bin/curl"
chmod +x "$fake_bin/base64" "$fake_bin/curl" "$fake_bin/docker"
export PATH="$fake_bin:$PATH"

write_environment() {
  local encryption_key="$1"
  local port="$2"
  printf '%s\n' \
    'POSTGRES_PASSWORD=test-password' \
    'DATABASE_URL=postgresql://gateway:test-password@postgres:5432/smartthings_gateway' \
    "PORT=$port" \
    'OAUTH_ADMIN_TOKEN=test-admin-token-with-32-characters' \
    'OAUTH_CLIENT_ID=test-client' \
    'OAUTH_CLIENT_SECRET=test-secret' \
    'OAUTH_REDIRECT_URI=https://smartthings.growful.click/oauth/callback' \
    'SMARTTHINGS_SCOPES=r:devices:*' \
    "TOKEN_ENCRYPTION_KEY=$encryption_key" >"$deployment_root/.env"
}

valid_key='MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA='
write_environment "$valid_key" 8100
DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" registry.example/gateway test

write_environment invalid-base64 8100
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" registry.example/gateway test; then
  printf 'invalid encryption key unexpectedly passed preflight\n' >&2
  exit 1
fi

write_environment "$valid_key" 9999
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" registry.example/gateway test; then
  printf 'invalid port unexpectedly passed preflight\n' >&2
  exit 1
fi

write_environment "$valid_key" 8100
printf '%s\n' 'PORT=9999' >>"$deployment_root/.env"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" registry.example/gateway test; then
  printf 'duplicate environment key unexpectedly passed preflight\n' >&2
  exit 1
fi

write_environment "$valid_key" 8100
if FAKE_ARCHITECTURE=aarch64 DEPLOYMENT_ROOT="$deployment_root" \
  bash "$release_dir/preflight.sh" registry.example/gateway test; then
  printf 'unsupported architecture unexpectedly passed preflight\n' >&2
  exit 1
fi
