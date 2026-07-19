#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deployment_root="${DEPLOYMENT_ROOT:-$deployment_dir}"
environment_file="$deployment_root/.env"
image_name="${1:?image name is required}"
image_tag="${2:?image tag is required}"

for command_name in base64 curl docker; do
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

required_keys=(
  DATABASE_URL
  OAUTH_CLIENT_ID
  OAUTH_CLIENT_SECRET
  OAUTH_REDIRECT_URI
  POSTGRES_PASSWORD
  SMARTTHINGS_SCOPES
  TOKEN_ENCRYPTION_KEY
)
for key in "${required_keys[@]}"; do
  if ! grep -Eq "^${key}=.+$" "$environment_file"; then
    printf 'required environment value is missing: %s\n' "$key" >&2
    exit 1
  fi
done

if ! grep -Eq '^PORT=8100[[:space:]]*$' "$environment_file"; then
  printf 'PORT must be 8100 in %s\n' "$environment_file" >&2
  exit 1
fi

if ! grep -Eq '^OAUTH_REDIRECT_URI=https://smartthings\.growful\.click/oauth/callback[[:space:]]*$' "$environment_file"; then
  printf 'OAUTH_REDIRECT_URI does not match the registered production callback\n' >&2
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
export IMAGE_TAG="$image_tag"
export SMARTTHINGS_GATEWAY_IMAGE="$image_name"
docker compose \
  --project-name smartthings-gateway \
  --env-file "$environment_file" \
  -f "$deployment_dir/compose.yaml" \
  config --quiet

printf 'preflight ok: architecture=%s, port=8100, environment=valid\n' "$architecture"
