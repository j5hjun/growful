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

for command_name in base64 curl docker flock head stat tr; do
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
  OAUTH_CLIENT_ID
  OAUTH_CLIENT_SECRET
  OAUTH_REDIRECT_URI
  PORT
  POSTGRES_PASSWORD
  REFRESH_CHECK_INTERVAL_SECONDS
  REFRESH_LEASE_SECONDS
  SERVICE_ACCESS_MODE
  SMARTTHINGS_API_TIMEOUT_SECONDS
  SMARTTHINGS_API_URL
  SMARTTHINGS_APP_ID
  SMARTTHINGS_AUTHORIZE_URL
  SMARTTHINGS_TOKEN_URL
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

service_access_mode="$(sed -n 's/^SERVICE_ACCESS_MODE=//p' "$environment_file")"
access_keys=(
  PUBLIC_OPERATOR_NAME
  PUBLIC_PRIVACY_POLICY_URL
  PUBLIC_SUPPORT_EMAIL
  PUBLIC_TERMS_URL
)
case "$service_access_mode" in
  private_beta)
    access_keys+=(PRIVATE_BETA_INVITES_JSON)
    ;;
  public)
    access_keys+=(
      SMARTTHINGS_PUBLIC_USE_APPROVAL_REFERENCE
      SMARTTHINGS_PUBLIC_USE_APPROVED_AT
    )
    ;;
  *)
    printf 'SERVICE_ACCESS_MODE must be private_beta or public\n' >&2
    exit 1
    ;;
esac
for key in "${access_keys[@]}"; do
  key_count="$(grep -Ec "^${key}=" "$environment_file" || true)"
  if [[ "$key_count" != '1' ]] || ! grep -Eq "^${key}=.+$" "$environment_file"; then
    printf 'service access value must occur once and be non-empty: %s\n' "$key" >&2
    exit 1
  fi
done

privacy_policy_url="$(sed -n 's/^PUBLIC_PRIVACY_POLICY_URL=//p' "$environment_file")"
terms_url="$(sed -n 's/^PUBLIC_TERMS_URL=//p' "$environment_file")"
support_email="$(sed -n 's/^PUBLIC_SUPPORT_EMAIL=//p' "$environment_file")"
if [[ ! "$privacy_policy_url" =~ ^https:// ]] || [[ ! "$terms_url" =~ ^https:// ]]; then
  printf 'service policy URLs must use HTTPS\n' >&2
  exit 1
fi
if [[ ! "$support_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  printf 'PUBLIC_SUPPORT_EMAIL must be an email address\n' >&2
  exit 1
fi
if [[ "$service_access_mode" == 'public' ]]; then
  approved_at="$(sed -n 's/^SMARTTHINGS_PUBLIC_USE_APPROVED_AT=//p' "$environment_file")"
  if [[ ! "$approved_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    printf 'SMARTTHINGS_PUBLIC_USE_APPROVED_AT must use YYYY-MM-DD\n' >&2
    exit 1
  fi
fi

if grep -Eq '^[A-Z0-9_]+=.*replace-with-' "$environment_file"; then
  printf 'deployment environment still contains a published placeholder\n' >&2
  exit 1
fi

port="$(sed -n 's/^PORT=//p' "$environment_file")"
if [[ "$port" != '8100' ]]; then
  printf 'PORT must be 8100 in %s\n' "$environment_file" >&2
  exit 1
fi

refresh_check_interval_seconds="$(sed -n 's/^REFRESH_CHECK_INTERVAL_SECONDS=//p' "$environment_file")"
if [[ ! "$refresh_check_interval_seconds" =~ ^[0-9]+$ ]] ||
  ((10#${refresh_check_interval_seconds} < 1 || 10#${refresh_check_interval_seconds} > 300)); then
  printf 'REFRESH_CHECK_INTERVAL_SECONDS must be an integer from 1 to 300\n' >&2
  exit 1
fi

refresh_lease_seconds="$(sed -n 's/^REFRESH_LEASE_SECONDS=//p' "$environment_file")"
if [[ ! "$refresh_lease_seconds" =~ ^[0-9]+$ ]] || ((10#${refresh_lease_seconds} < 120)); then
  printf 'REFRESH_LEASE_SECONDS must be an integer of at least 120\n' >&2
  exit 1
fi

smartthings_api_timeout_seconds="$(sed -n 's/^SMARTTHINGS_API_TIMEOUT_SECONDS=//p' "$environment_file")"
if [[ ! "$smartthings_api_timeout_seconds" =~ ^[0-9]+$ ]] ||
  ((10#${smartthings_api_timeout_seconds} < 1 || 10#${smartthings_api_timeout_seconds} > 60)); then
  printf 'SMARTTHINGS_API_TIMEOUT_SECONDS must be an integer from 1 to 60\n' >&2
  exit 1
fi

smartthings_api_url="$(sed -n 's/^SMARTTHINGS_API_URL=//p' "$environment_file")"
if [[ "$smartthings_api_url" != 'https://api.smartthings.com' ]]; then
  printf 'SMARTTHINGS_API_URL must be the fixed production SmartThings API origin\n' >&2
  exit 1
fi

smartthings_authorize_url="$(sed -n 's/^SMARTTHINGS_AUTHORIZE_URL=//p' "$environment_file")"
case "$smartthings_authorize_url" in
  https://api.smartthings.com/oauth/authorize | https://api.smartthings.com/v1/oauth/authorize) ;;
  *)
    printf 'SMARTTHINGS_AUTHORIZE_URL must use a supported production SmartThings endpoint\n' >&2
    exit 1
    ;;
esac

smartthings_token_url="$(sed -n 's/^SMARTTHINGS_TOKEN_URL=//p' "$environment_file")"
case "$smartthings_token_url" in
  https://api.smartthings.com/oauth/token | https://api.smartthings.com/v1/oauth/token) ;;
  *)
    printf 'SMARTTHINGS_TOKEN_URL must use a supported production SmartThings endpoint\n' >&2
    exit 1
    ;;
esac

redirect_uri="$(sed -n 's/^OAUTH_REDIRECT_URI=//p' "$environment_file")"
if [[ "$redirect_uri" != 'https://smartthings.growful.click/oauth/callback' ]]; then
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
export SMARTTHINGS_GATEWAY_IMAGE_DIGEST="$image_digest"
export SMARTTHINGS_GATEWAY_IMAGE_NAME="$image_name"
docker compose \
  --project-name smartthings-gateway \
  --env-file "$environment_file" \
  -f "$deployment_dir/compose.yaml" \
  config --quiet

printf 'preflight ok: architecture=%s, port=8100, release=%s, environment=valid\n' "$architecture" "$release_id"
