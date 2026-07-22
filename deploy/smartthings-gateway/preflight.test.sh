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

printf '%s\n' '#!/usr/bin/env bash' 'exit 0' >"$fake_bin/flock"
chmod +x "$fake_bin/base64" "$fake_bin/docker" "$fake_bin/flock"
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
    'PRIVATE_BETA_INVITES_JSON=[{"username":"test-beta-user","passwordHash":"dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42"}]' \
    'PUBLIC_OPERATOR_NAME=Growful' \
    'PUBLIC_SUPPORT_EMAIL=support@growful.click' \
    'REFRESH_CHECK_INTERVAL_SECONDS=300' \
    'REFRESH_LEASE_SECONDS=120' \
    'SERVICE_ACCESS_MODE=private_beta' \
    'SMARTTHINGS_API_TIMEOUT_SECONDS=15' \
    'SMARTTHINGS_API_URL=https://api.smartthings.com' \
    'SMARTTHINGS_APP_ID=test-smartthings-app' \
    'SMARTTHINGS_AUTHORIZE_URL=https://api.smartthings.com/oauth/authorize' \
    'SMARTTHINGS_TOKEN_URL=https://api.smartthings.com/oauth/token' \
    "TOKEN_ENCRYPTION_KEY=$encryption_key" >"$deployment_root/.env"
  chmod 600 "$deployment_root/.env"
}

valid_key='MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA='
write_environment "$valid_key" 8100
DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test

prerequisite_commands=(base64 cp curl dirname docker flock head rm sleep stat tr)
for missing_command in cp curl rm sleep; do
  prerequisite_bin="$test_root/bin-without-$missing_command"
  mkdir -p "$prerequisite_bin"
  for command_name in "${prerequisite_commands[@]}"; do
    if [[ "$command_name" != "$missing_command" ]]; then
      ln -s "$(command -v "$command_name")" "$prerequisite_bin/$command_name"
    fi
  done
  if PATH="$prerequisite_bin" DEPLOYMENT_ROOT="$deployment_root" \
    /bin/bash "$release_dir/preflight.sh" "$test_image_reference" test \
    >"$test_root/missing-command.out" 2>"$test_root/missing-command.err"; then
    printf 'preflight without %s unexpectedly passed\n' "$missing_command" >&2
    exit 1
  fi
  if ! grep -Fq "required command is missing: $missing_command" \
    "$test_root/missing-command.err"; then
    printf 'preflight did not report missing %s before deployment validation\n' \
      "$missing_command" >&2
    exit 1
  fi
done

write_environment "$valid_key" 8100
sed -i.bak '/^PUBLIC_SUPPORT_EMAIL=/d' "$deployment_root/.env"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'private beta without support disclosure unexpectedly passed preflight\n' >&2
  exit 1
fi
rm -f "$deployment_root/.env.bak"

write_environment "$valid_key" 8100
sed -i.bak '/^PRIVATE_BETA_INVITES_JSON=/d' "$deployment_root/.env"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'private beta without an invitation list unexpectedly passed preflight\n' >&2
  exit 1
fi
rm -f "$deployment_root/.env.bak"

write_environment "$valid_key" 8100
sed -i.bak 's/^REFRESH_CHECK_INTERVAL_SECONDS=.*/REFRESH_CHECK_INTERVAL_SECONDS=301/' "$deployment_root/.env"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'unbounded OAuth state cleanup interval unexpectedly passed preflight\n' >&2
  exit 1
fi
rm -f "$deployment_root/.env.bak"

write_environment "$valid_key" 8100
sed -i.bak \
  -e 's/^SERVICE_ACCESS_MODE=.*/SERVICE_ACCESS_MODE=public/' \
  -e '/^PRIVATE_BETA_/d' \
  "$deployment_root/.env"
printf '%s\n' \
  'SMARTTHINGS_PUBLIC_USE_APPROVAL_REFERENCE=smartthings-case-123' \
  'SMARTTHINGS_PUBLIC_USE_APPROVED_AT=2026-07-22' >>"$deployment_root/.env"
DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test
rm -f "$deployment_root/.env.bak"

sed -i.bak '/^SMARTTHINGS_PUBLIC_USE_APPROVAL_REFERENCE=/d' "$deployment_root/.env"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'public mode without SmartThings approval unexpectedly passed preflight\n' >&2
  exit 1
fi
rm -f "$deployment_root/.env.bak"

write_environment "$valid_key" 8100
sed -i.bak 's#^SMARTTHINGS_API_URL=.*#SMARTTHINGS_API_URL=https://example.com#' "$deployment_root/.env"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'arbitrary SmartThings API host unexpectedly passed preflight\n' >&2
  exit 1
fi
rm -f "$deployment_root/.env.bak"

write_environment "$valid_key" 8100
sed -i.bak 's#^SMARTTHINGS_AUTHORIZE_URL=.*#SMARTTHINGS_AUTHORIZE_URL=https://example.com/oauth/authorize#' "$deployment_root/.env"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'arbitrary SmartThings authorization host unexpectedly passed preflight\n' >&2
  exit 1
fi
rm -f "$deployment_root/.env.bak"

write_environment "$valid_key" 8100
sed -i.bak 's#^SMARTTHINGS_TOKEN_URL=.*#SMARTTHINGS_TOKEN_URL=https://example.com/oauth/token#' "$deployment_root/.env"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/preflight.sh" "$test_image_reference" test; then
  printf 'arbitrary SmartThings token host unexpectedly passed preflight\n' >&2
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
