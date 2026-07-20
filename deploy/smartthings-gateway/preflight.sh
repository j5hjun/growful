#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deployment_root="${DEPLOYMENT_ROOT:-$deployment_dir}"
environment_file="$deployment_root/.env"
image_reference="${1:?image reference is required}"
release_id="${2:?release id is required}"

if [[ ! "$image_reference" =~ ^[^[:space:]@]+@sha256:[0-9a-f]{64}$ ]]; then
  printf 'gateway image reference must use an immutable sha256 digest\n' >&2
  exit 1
fi
image_name="${image_reference%@sha256:*}"
image_digest="sha256:${image_reference##*@sha256:}"

for command_name in base64 curl docker flock stat; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'required command is missing: %s\n' "$command_name" >&2
    exit 1
  fi
done

docker info >/dev/null
docker compose version >/dev/null

architecture="$(docker info --format '{{.Architecture}}')"
case "$architecture" in
  amd64 | x86_64) ;;
  *)
    printf 'unsupported Docker architecture: %s (expected amd64)\n' "$architecture" >&2
    exit 1
    ;;
esac

if [[ ! -r "$environment_file" ]]; then
  printf 'deployment environment file is not readable: %s\n' "$environment_file" >&2
  exit 1
fi

if environment_permissions="$(stat -c '%a' "$environment_file" 2>/dev/null)"; then
  :
elif environment_permissions="$(stat -f '%Lp' "$environment_file" 2>/dev/null)"; then
  :
else
  printf 'could not inspect deployment environment file permissions\n' >&2
  exit 1
fi
if [[ ! "$environment_permissions" =~ ^[0-7]{3,4}$ ]] ||
  (((8#${environment_permissions} & 8#077) != 0)); then
  printf 'deployment environment file must not be readable by group or other users\n' >&2
  exit 1
fi

required_keys=(
  DATABASE_URL
  OAUTH_ADMIN_TOKEN
  OAUTH_CLIENT_ID
  OAUTH_CLIENT_SECRET
  OAUTH_REDIRECT_URI
  PORT
  POSTGRES_PASSWORD
  REFRESH_LEASE_SECONDS
  SMARTTHINGS_SCOPES
  TOKEN_ENCRYPTION_KEY
)
for key in "${required_keys[@]}"; do
  key_count="$(grep -Ec "^${key}=" "$environment_file" || true)"
  if [[ "$key_count" != '1' ]]; then
    printf 'environment value must occur exactly once: %s\n' "$key" >&2
    exit 1
  fi
  if ! grep -Eq "^${key}=.+$" "$environment_file"; then
    printf 'required environment value is empty: %s\n' "$key" >&2
    exit 1
  fi
done

if grep -Eq '^[A-Z0-9_]+=.*replace-with-' "$environment_file"; then
  printf 'deployment environment still contains a published placeholder\n' >&2
  exit 1
fi

port="$(sed -n 's/^PORT=//p' "$environment_file")"
if [[ "$port" != '8100' ]]; then
  printf 'PORT must be 8100 in %s\n' "$environment_file" >&2
  exit 1
fi

refresh_lease_seconds="$(sed -n 's/^REFRESH_LEASE_SECONDS=//p' "$environment_file")"
if [[ ! "$refresh_lease_seconds" =~ ^[0-9]+$ ]] || ((10#${refresh_lease_seconds} < 120)); then
  printf 'REFRESH_LEASE_SECONDS must be an integer of at least 120\n' >&2
  exit 1
fi

redirect_uri="$(sed -n 's/^OAUTH_REDIRECT_URI=//p' "$environment_file")"
if [[ "$redirect_uri" != 'https://smartthings.growful.click/oauth/callback' ]]; then
  printf 'OAUTH_REDIRECT_URI does not match the registered production callback\n' >&2
  exit 1
fi

admin_token="$(sed -n 's/^OAUTH_ADMIN_TOKEN=//p' "$environment_file")"
if ((${#admin_token} < 32)); then
  printf 'OAUTH_ADMIN_TOKEN must contain at least 32 characters\n' >&2
  exit 1
fi

encryption_key="$(sed -n 's/^TOKEN_ENCRYPTION_KEY=//p' "$environment_file" | tail -n 1)"
if ! decoded_key_size="$(printf '%s' "$encryption_key" | base64 --decode 2>/dev/null | wc -c | tr -d ' ')"; then
  printf 'TOKEN_ENCRYPTION_KEY is not valid base64\n' >&2
  exit 1
fi
if [[ "$decoded_key_size" != '32' ]]; then
  printf 'TOKEN_ENCRYPTION_KEY must decode to 32 bytes\n' >&2
  exit 1
fi

export GATEWAY_ENV_FILE="$environment_file"
export SMARTTHINGS_GATEWAY_IMAGE_DIGEST="$image_digest"
export SMARTTHINGS_GATEWAY_IMAGE_NAME="$image_name"
docker compose \
  --project-name smartthings-gateway \
  --env-file "$environment_file" \
  -f "$deployment_dir/compose.yaml" \
  config --quiet

printf 'preflight ok: architecture=%s, port=8100, release=%s, environment=valid\n' "$architecture" "$release_id"
