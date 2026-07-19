#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary_root="${TMPDIR:-/tmp}"
test_root="$(mktemp -d "${temporary_root%/}/smartthings-gateway-deploy-test.XXXXXX")"
deployment_root="$test_root/deployment"
release_dir="$deployment_root/releases/new"
previous_release="$deployment_root/releases/previous"
fake_bin="$test_root/bin"
fake_log="$test_root/docker.log"
fail_once_marker="$test_root/public-health-failed-once"
previous_image_reference='registry.example/gateway@sha256:0000000000000000000000000000000000000000000000000000000000000001'
broken_image_reference='registry.example/gateway@sha256:0000000000000000000000000000000000000000000000000000000000000003'
public_broken_image_reference='registry.example/gateway@sha256:0000000000000000000000000000000000000000000000000000000000000004'
same_rerun_image_reference='registry.example/gateway@sha256:0000000000000000000000000000000000000000000000000000000000000005'

cleanup() {
  rm -rf "$test_root"
}
trap cleanup EXIT

mkdir -p "$release_dir" "$previous_release" "$fake_bin"
cp "$source_dir/deploy.sh" "$source_dir/compose.yaml" "$release_dir/"
cp "$source_dir/compose.yaml" "$previous_release/"
grep -Fq 'stop_grace_period: 120s' "$source_dir/compose.yaml"
touch "$deployment_root/.env"
printf '%s\n' "$previous_image_reference" >"$deployment_root/.deployed-image-reference"
printf '%s\n' 'previous' >"$deployment_root/.deployed-release-id"
printf '%s\n' "$previous_release" >"$deployment_root/.deployed-release"

# Dollar expressions below belong to the generated fake executable.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s|%s\n" "${RELEASE_ID:-}" "$*" >>"$FAKE_LOG"' \
  'if [[ "$1" == "inspect" ]]; then' \
  '  if [[ "$*" == *RestartCount* ]]; then' \
  '    printf "0\n"' \
  '  elif [[ "${RELEASE_ID:-}" == "broken" ]]; then' \
  '    printf "unhealthy\n"' \
  '  else' \
  '    printf "healthy\n"' \
  '  fi' \
  'elif [[ "$1" == "compose" && "$*" == *" ps --all -q gateway"* ]]; then' \
  '  printf "gateway-container\n"' \
  'fi' >"$fake_bin/docker"

# Dollar expressions below belong to the generated fake executable.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s|curl %s\n" "${RELEASE_ID:-}" "$*" >>"$FAKE_LOG"' \
  'if [[ "${RELEASE_ID:-}" == "broken" ]]; then' \
  '  exit 22' \
  'fi' \
  'if [[ "${RELEASE_ID:-}" == "public-broken" && "$*" == *smartthings.growful.click* ]]; then' \
  '  exit 22' \
  'fi' \
  'if [[ "${RELEASE_ID:-}" == "same-rerun" && "$*" == *smartthings.growful.click* && ! -f "$FAIL_ONCE_MARKER" ]]; then' \
  '  touch "$FAIL_ONCE_MARKER"' \
  '  exit 22' \
  'fi' \
  'printf "{\"status\":\"ok\"}\n"' >"$fake_bin/curl"

chmod +x "$fake_bin/docker" "$fake_bin/curl"
export FAKE_LOG="$fake_log"
export FAIL_ONCE_MARKER="$fail_once_marker"
export HEALTHCHECK_ATTEMPTS=1
export HEALTHCHECK_INTERVAL_SECONDS=0
export PUBLIC_HEALTHCHECK_ATTEMPTS=1
export PUBLIC_HEALTHCHECK_INTERVAL_SECONDS=0
export PATH="$fake_bin:$PATH"

if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" registry.example/gateway:mutable invalid; then
  printf 'mutable image reference unexpectedly reached deployment\n' >&2
  exit 1
fi

if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" "$broken_image_reference" broken; then
  printf 'broken deployment unexpectedly succeeded\n' >&2
  exit 1
fi

grep -Eq '^broken\|compose .* up -d --no-deps gateway$' "$fake_log"
grep -Fq "previous|image inspect $previous_image_reference" "$fake_log"
grep -Eq '^previous\|compose .* up -d --no-deps gateway$' "$fake_log"
grep -Eq '^previous\|curl .*127\.0\.0\.1:8100/healthz$' "$fake_log"
test "$(<"$deployment_root/.deployed-image-reference")" = "$previous_image_reference"
test "$(<"$deployment_root/.deployed-release-id")" = 'previous'
test "$(<"$deployment_root/.deployed-release")" = "$previous_release"

: >"$fake_log"
if DEPLOYMENT_ROOT="$deployment_root" PUBLIC_BASE_URL="https://smartthings.growful.click" \
  bash "$release_dir/deploy.sh" "$public_broken_image_reference" public-broken; then
  printf 'deployment with a broken public route unexpectedly succeeded\n' >&2
  exit 1
fi

grep -Eq '^public-broken\|curl .*smartthings\.growful\.click/healthz$' "$fake_log"
grep -Eq '^previous\|compose .* up -d --no-deps gateway$' "$fake_log"
test "$(<"$deployment_root/.deployed-image-reference")" = "$previous_image_reference"

: >"$fake_log"
printf '%s\n' 'same-rerun' >"$deployment_root/.deployed-release-id"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" "$same_rerun_image_reference" same-rerun; then
  printf 'same release with a different digest unexpectedly succeeded\n' >&2
  exit 1
fi

if grep -Eq '^same-rerun\|compose .* (pull gateway|run --rm gateway|up -d|stop gateway)' "$fake_log"; then
  printf 'digest mismatch mutated the previously healthy gateway\n' >&2
  exit 1
fi
test "$(<"$deployment_root/.deployed-image-reference")" = "$previous_image_reference"

: >"$fake_log"
if DEPLOYMENT_ROOT="$deployment_root" PUBLIC_BASE_URL="https://smartthings.growful.click" \
  bash "$release_dir/deploy.sh" "$previous_image_reference" same-rerun; then
  printf 'same-release rerun with a transient public failure unexpectedly succeeded\n' >&2
  exit 1
fi

if grep -Eq '^same-rerun\|compose .* (pull gateway|run --rm gateway|up -d|stop gateway)' "$fake_log"; then
  printf 'same-release verification mutated the previously healthy gateway\n' >&2
  exit 1
fi
test "$(<"$deployment_root/.deployed-image-reference")" = "$previous_image_reference"
test "$(<"$deployment_root/.deployed-release-id")" = 'same-rerun'

: >"$fake_log"
healthy_image_reference='registry.example/gateway@sha256:0000000000000000000000000000000000000000000000000000000000000002'
DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" "$healthy_image_reference" healthy

grep -Eq '^healthy\|compose .* up -d --no-deps gateway$' "$fake_log"
grep -Eq '^healthy\|curl .*127\.0\.0\.1:8100/healthz$' "$fake_log"
test "$(<"$deployment_root/.deployed-image-reference")" = "$healthy_image_reference"
test "$(<"$deployment_root/.deployed-release-id")" = 'healthy'
test "$(<"$deployment_root/.deployed-release")" = "$release_dir"
test "$(readlink "$deployment_root/current")" = "$release_dir"
