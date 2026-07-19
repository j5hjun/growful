#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deployment_root="${DEPLOYMENT_ROOT:-$deployment_dir}"
environment_file="$deployment_root/.env"
release_state_file="$deployment_root/.deployed-release-state"
deployment_sequence_file="$deployment_root/.deployment-sequence"
image_reference="${1:?image reference is required}"
new_release_id="${2:?release id is required}"
deployment_sequence="${3:?deployment sequence is required}"
if [[ ! "$image_reference" =~ ^[^[:space:]@]+@sha256:[0-9a-f]{64}$ ]]; then
  printf 'gateway image reference must use an immutable sha256 digest\n' >&2
  exit 1
fi
if [[ ! "$deployment_sequence" =~ ^[1-9][0-9]*$ ]]; then
  printf 'deployment sequence must be a positive integer\n' >&2
  exit 1
fi
if ! command -v flock >/dev/null 2>&1; then
  printf 'required command is missing: flock\n' >&2
  exit 1
fi
exec 9>"$deployment_root/.deploy.lock"
flock --exclusive 9
image_name="${image_reference%@sha256:*}"
image_digest="sha256:${image_reference##*@sha256:}"
healthcheck_attempts="${HEALTHCHECK_ATTEMPTS:-30}"
healthcheck_interval_seconds="${HEALTHCHECK_INTERVAL_SECONDS:-2}"
public_base_url="${PUBLIC_BASE_URL:-}"
public_healthcheck_attempts="${PUBLIC_HEALTHCHECK_ATTEMPTS:-10}"
public_healthcheck_interval_seconds="${PUBLIC_HEALTHCHECK_INTERVAL_SECONDS:-2}"
previous_image_reference=""
previous_release_id=""
previous_release=""
previous_deployment_sequence=0
highest_deployment_release_id=""
highest_deployment_sequence=0
state_temp=""
sequence_temp=""
trap 'rm -f "${state_temp:-}" "${sequence_temp:-}"' EXIT

if [[ -f "$release_state_file" ]]; then
  deployed_state=()
  while IFS= read -r state_line; do
    deployed_state+=("$state_line")
  done <"$release_state_file"
  if ((${#deployed_state[@]} != 3 && ${#deployed_state[@]} != 4)); then
    printf 'deployed release state is malformed\n' >&2
    exit 1
  fi
  previous_image_reference="${deployed_state[0]}"
  previous_release_id="${deployed_state[1]}"
  previous_release="${deployed_state[2]}"
  if ((${#deployed_state[@]} == 4)); then
    previous_deployment_sequence="${deployed_state[3]}"
  fi
  if [[ ! "$previous_image_reference" =~ ^[^[:space:]@]+@sha256:[0-9a-f]{64}$ ]] ||
    [[ -z "$previous_release_id" || ! -f "$previous_release/compose.yaml" ]] ||
    [[ ! "$previous_deployment_sequence" =~ ^[0-9]+$ ]]; then
    printf 'deployed release state cannot provide an exact rollback target\n' >&2
    exit 1
  fi
fi

highest_deployment_sequence="$previous_deployment_sequence"
highest_deployment_release_id="$previous_release_id"
if [[ -f "$deployment_sequence_file" ]]; then
  sequence_state=()
  while IFS= read -r sequence_line; do
    sequence_state+=("$sequence_line")
  done <"$deployment_sequence_file"
  if ((${#sequence_state[@]} != 2)) || [[ ! "${sequence_state[0]}" =~ ^[1-9][0-9]*$ ]] ||
    [[ -z "${sequence_state[1]}" ]] ||
    ((10#${sequence_state[0]} < 10#$previous_deployment_sequence)); then
    printf 'deployment sequence state is malformed\n' >&2
    exit 1
  fi
  highest_deployment_sequence="${sequence_state[0]}"
  highest_deployment_release_id="${sequence_state[1]}"
fi

if ((10#$deployment_sequence < 10#$highest_deployment_sequence)); then
  printf 'skipping stale deployment sequence %s; current sequence is %s\n' \
    "$deployment_sequence" "$highest_deployment_sequence" >&2
  exit 0
fi
if ((10#$deployment_sequence == 10#$highest_deployment_sequence)) &&
  [[ -n "$highest_deployment_release_id" && "$highest_deployment_release_id" != "$new_release_id" ]]; then
  printf 'deployment sequence already belongs to another release\n' >&2
  exit 1
fi

commit_deployment_sequence() {
  sequence_temp="$(mktemp "${deployment_sequence_file}.XXXXXX")"
  printf '%s\n' "$deployment_sequence" "$new_release_id" >"$sequence_temp"
  mv "$sequence_temp" "$deployment_sequence_file"
  sequence_temp=""
}

export COMPOSE_PROJECT_NAME=smartthings-gateway
export GATEWAY_ENV_FILE="$environment_file"
export RELEASE_ID="$new_release_id"
export SMARTTHINGS_GATEWAY_IMAGE_DIGEST="$image_digest"
export SMARTTHINGS_GATEWAY_IMAGE_NAME="$image_name"

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
    return 0
  fi

  export RELEASE_ID="$previous_release_id"
  export SMARTTHINGS_GATEWAY_IMAGE_NAME="${previous_image_reference%@sha256:*}"
  export SMARTTHINGS_GATEWAY_IMAGE_DIGEST="sha256:${previous_image_reference##*@sha256:}"
  compose=(docker compose --env-file "$environment_file" -f "$previous_release/compose.yaml")

  if ! docker image inspect "$previous_image_reference" >/dev/null 2>&1; then
    "${compose[@]}" pull gateway || return 1
  fi
  "${compose[@]}" up -d --no-deps gateway || return 1
  wait_for_gateway || return 1
  verify_local_http || return 1
  verify_public_http || return 1
  printf 'rolled back to image digest %s\n' "$previous_image_reference" >&2
}

stop_gateway_fail_closed() {
  if ! "${compose[@]}" stop gateway >/dev/null 2>&1; then
    printf 'failed to stop the rejected gateway; manual intervention is required\n' >&2
    return 1
  fi
  printf 'stopped the rejected gateway after rollback failure\n' >&2
}

if [[ -n "$previous_release_id" && "$previous_release_id" == "$new_release_id" ]]; then
  if [[ "$previous_image_reference" != "$image_reference" ]]; then
    printf 'release ID already exists with a different image digest; existing gateway was left unchanged\n' >&2
    exit 1
  fi
  if wait_for_gateway && verify_local_http && verify_public_http; then
    if ((10#$deployment_sequence > 10#$highest_deployment_sequence)); then
      commit_deployment_sequence
      state_temp="$(mktemp "${release_state_file}.XXXXXX")"
      printf '%s\n' "$image_reference" "$new_release_id" "$previous_release" \
        "$deployment_sequence" >"$state_temp"
      mv "$state_temp" "$release_state_file"
      state_temp=""
    fi
    exit 0
  fi
  show_diagnostics
  printf 'already deployed release failed verification; existing gateway was left unchanged\n' >&2
  exit 1
fi

if ((10#$deployment_sequence > 10#$highest_deployment_sequence)); then
  commit_deployment_sequence
fi
state_temp="$(mktemp "${release_state_file}.XXXXXX")"
printf '%s\n' "$image_reference" "$new_release_id" "$deployment_dir" \
  "$deployment_sequence" >"$state_temp"

if deploy_release; then
  if mv "$state_temp" "$release_state_file"; then
    state_temp=""
    if ! ln -sfn "$deployment_dir" "$deployment_root/current"; then
      printf 'warning: release state committed but current convenience link was not updated\n' >&2
    fi
    exit 0
  fi
  printf 'could not commit deployed release state; rolling back candidate\n' >&2
  show_diagnostics
  if ! rollback_release; then
    printf 'automatic rollback failed\n' >&2
    stop_gateway_fail_closed || true
  fi
  exit 1
fi

show_diagnostics
if ! rollback_release; then
  printf 'automatic rollback failed\n' >&2
  stop_gateway_fail_closed || true
fi
exit 1
