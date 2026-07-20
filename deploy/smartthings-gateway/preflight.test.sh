#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary_root="${TMPDIR:-/tmp}"
test_root="$(mktemp -d "${temporary_root%/}/smartthings-gateway-preflight-test.XXXXXX")"
deployment_root="$test_root/deployment"
release_dir="$deployment_root/releases/test"
fake_bin="$test_root/bin"
test_image_reference='registry.example/gateway@sha256:0000000000000000000000000000000000000000000000000000000000000001'

cleanup() {
  rm -rf "$test_root"
}
trap cleanup EXIT

mkdir -p "$release_dir" "$fake_bin"
cp "$source_dir/preflight.sh" "$source_dir/compose.yaml" "$release_dir/"

# Dollar expressions below belong to the generated fake executable.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ "$1" == "info" && "$*" == *Architecture* ]]; then' \
  '  printf "%s\n" "${FAKE_ARCHITECTURE:-x86_64}"' \
  'fi' >"$fake_bin/docker"

# Dollar expressions below belong to the generated fake executable.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'value="$(cat)"' \
  'if [[ "$value" != "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=" ]]; then' \
  '  exit 1' \
  'fi' \
  'printf "00000000000000000000000000000000"' >"$fake_bin/base64"

printf '%s\n' '#!/usr/bin/env bash' 'exit 0' >"$fake_bin/curl"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' >"$fake_bin/flock"
chmod +x "$fake_bin/base64" "$fake_bin/curl" "$fake_bin/docker" "$fake_bin/flock"
export PATH="$fake_bin:$PATH"

write_environment() {
  local encryption_key="$1"
  local port="$2"
  printf '%s\n' \
    'POSTGRES_PASSWORD=test-password' \
    'DATABASE_URL=postgresql://gateway:test-password@postgres:5432/smartthings_gateway' \
    "PORT=$port" \
    'OAUTH_CLIENT_ID=test-client' \
    'OAUTH_CLIENT_SECRET=test-secret' \
    'OAUTH_REDIRECT_URI=https://smartthings.growful.click/oauth/callback' \
    'REFRESH_LEASE_SECONDS=120' \
    'SMARTTHINGS_API_TIMEOUT_SECONDS=15' \
    'SMARTTHINGS_API_URL=https://api.smartthings.com' \
    "TOKEN_ENCRYPTION_KEY=$encryption_key" >"$deployment_root/.env"
  chmod 600 "$deployment_root/.env"
}

valid_key='MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA='
write_environment "$valid_key" 8100
DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test

write_environment "$valid_key" 8100
sed -i.bak 's#^SMARTTHINGS_API_URL=.*#SMARTTHINGS_API_URL=https://example.com#' "$deployment_root/.env"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'arbitrary SmartThings API host unexpectedly passed preflight\n' >&2
  exit 1
fi
rm -f "$deployment_root/.env.bak"

write_environment "$valid_key" 8100
sed -i.bak 's/^SMARTTHINGS_API_TIMEOUT_SECONDS=.*/SMARTTHINGS_API_TIMEOUT_SECONDS=0/' "$deployment_root/.env"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'invalid SmartThings API timeout unexpectedly passed preflight\n' >&2
  exit 1
fi
rm -f "$deployment_root/.env.bak"

if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" registry.example/gateway:mutable test; then
  printf 'mutable image reference unexpectedly passed preflight\n' >&2
  exit 1
fi

write_environment invalid-base64 8100
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'invalid encryption key unexpectedly passed preflight\n' >&2
  exit 1
fi

write_environment "$valid_key" 9999
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'invalid port unexpectedly passed preflight\n' >&2
  exit 1
fi

write_environment "$valid_key" 8100
printf '%s\n' 'PORT=9999' >>"$deployment_root/.env"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'duplicate environment key unexpectedly passed preflight\n' >&2
  exit 1
fi

write_environment "$valid_key" 8100
sed -i.bak 's/^REFRESH_LEASE_SECONDS=.*/REFRESH_LEASE_SECONDS=60/' "$deployment_root/.env"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'short refresh lease unexpectedly passed preflight\n' >&2
  exit 1
fi
rm -f "$deployment_root/.env.bak"

write_environment "$valid_key" 8100
chmod 644 "$deployment_root/.env"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'group-readable environment file unexpectedly passed preflight\n' >&2
  exit 1
fi

write_environment "$valid_key" 8100
if FAKE_ARCHITECTURE=aarch64 DEPLOYMENT_ROOT="$deployment_root" \
  bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'unsupported architecture unexpectedly passed preflight\n' >&2
  exit 1
fi
