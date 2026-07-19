#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deployment_root="${DEPLOYMENT_ROOT:-$deployment_dir}"
environment_file="$deployment_root/.env"
image_reference="${1:?image reference is required}"
new_release_id="${2:?release id is required}"
if [[ ! "$image_reference" =~ ^[^[:space:]@]+@sha256:[0-9a-f]{64}$ ]]; then
  printf 'gateway image reference must use an immutable sha256 digest\n' >&2
  exit 1
fi
healthcheck_attempts="${HEALTHCHECK_ATTEMPTS:-30}"
healthcheck_interval_seconds="${HEALTHCHECK_INTERVAL_SECONDS:-2}"
public_base_url="${PUBLIC_BASE_URL:-}"
public_healthcheck_attempts="${PUBLIC_HEALTHCHECK_ATTEMPTS:-10}"
public_healthcheck_interval_seconds="${PUBLIC_HEALTHCHECK_INTERVAL_SECONDS:-2}"
previous_image_reference=""
previous_release_id=""
previous_release=""

if [[ -f "$deployment_root/.deployed-image-reference" ]]; then
  previous_image_reference="$(<"$deployment_root/.deployed-image-reference")"
fi
if [[ -f "$deployment_root/.deployed-release-id" ]]; then
  previous_release_id="$(<"$deployment_root/.deployed-release-id")"
fi
if [[ -f "$deployment_root/.deployed-release" ]]; then
  previous_release="$(<"$deployment_root/.deployed-release")"
fi

export COMPOSE_PROJECT_NAME=smartthings-gateway
export GATEWAY_ENV_FILE="$environment_file"
export RELEASE_ID="$new_release_id"
export SMARTTHINGS_GATEWAY_IMAGE_REFERENCE="$image_reference"

compose=(docker compose --env-file "$environment_file" -f "$deployment_dir/compose.yaml")

wait_for_gateway() {
  local attempt container_id health restart_count
  for ((attempt = 1; attempt <= healthcheck_attempts; attempt += 1)); do
    container_id="$("${compose[@]}" ps --all -q gateway 2>/dev/null || true)"
    health=""
    if [[ -n "$container_id" ]]; then
      health="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    fi
    if [[ "$health" == 'healthy' ]]; then
      restart_count="$(docker inspect --format='{{.RestartCount}}' "$container_id")" || return 1
      [[ "$restart_count" == '0' ]] || return 1
      return 0
    fi
    if ((attempt < healthcheck_attempts)); then
      sleep "$healthcheck_interval_seconds"
    fi
  done
  return 1
}

verify_local_http() {
  local response
  response="$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8100/healthz)" || return 1
  [[ "$response" == '{"status":"ok"}' ]]
}

verify_public_http() {
  local attempt response
  [[ -n "$public_base_url" ]] || return 0
  for ((attempt = 1; attempt <= public_healthcheck_attempts; attempt += 1)); do
    response="$(curl --fail --silent --show-error --max-time 10 "$public_base_url/healthz" 2>/dev/null || true)"
    if [[ "$response" == '{"status":"ok"}' ]]; then
      return 0
    fi
    if ((attempt < public_healthcheck_attempts)); then
      sleep "$public_healthcheck_interval_seconds"
    fi
  done
  return 1
}

show_diagnostics() {
  "${compose[@]}" ps >&2 || true
  "${compose[@]}" logs --tail=100 gateway >&2 || true
}

deploy_release() {
  "${compose[@]}" pull gateway || return 1
  "${compose[@]}" up -d postgres || return 1
  "${compose[@]}" run --rm gateway node dist/migrate.js || return 1
  "${compose[@]}" up -d --no-deps gateway || return 1
  wait_for_gateway || return 1
  verify_local_http || return 1
  verify_public_http || return 1
}

rollback_release() {
  if [[ -z "$previous_image_reference" || -z "$previous_release_id" ]]; then
    "${compose[@]}" stop gateway >/dev/null 2>&1 || true
    printf 'deployment failed and no previous release is available\n' >&2
    return 1
  fi

  export RELEASE_ID="$previous_release_id"
  export SMARTTHINGS_GATEWAY_IMAGE_REFERENCE="$previous_image_reference"
  if [[ -n "$previous_release" && -f "$previous_release/compose.yaml" ]]; then
    compose=(docker compose --env-file "$environment_file" -f "$previous_release/compose.yaml")
  fi

  if ! docker image inspect "$previous_image_reference" >/dev/null 2>&1; then
    "${compose[@]}" pull gateway || return 1
  fi
  "${compose[@]}" up -d --no-deps gateway || return 1
  wait_for_gateway || return 1
  verify_local_http || return 1
  verify_public_http || return 1
  printf 'rolled back to image digest %s\n' "$previous_image_reference" >&2
}

if [[ -n "$previous_release_id" && "$previous_release_id" == "$new_release_id" ]]; then
  if wait_for_gateway && verify_local_http && verify_public_http; then
    exit 0
  fi
  show_diagnostics
  printf 'already deployed release failed verification; existing gateway was left unchanged\n' >&2
  exit 1
fi

if deploy_release; then
  printf '%s\n' "$image_reference" >"$deployment_root/.deployed-image-reference"
  printf '%s\n' "$new_release_id" >"$deployment_root/.deployed-release-id"
  printf '%s\n' "$deployment_dir" >"$deployment_root/.deployed-release"
  ln -sfn "$deployment_dir" "$deployment_root/current"
  exit 0
fi

show_diagnostics
if ! rollback_release; then
  printf 'automatic rollback failed\n' >&2
fi
exit 1
