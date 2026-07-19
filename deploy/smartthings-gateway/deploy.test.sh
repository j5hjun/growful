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

cleanup() {
  rm -rf "$test_root"
}
trap cleanup EXIT

mkdir -p "$release_dir" "$previous_release" "$fake_bin"
cp "$source_dir/deploy.sh" "$source_dir/compose.yaml" "$release_dir/"
cp "$source_dir/compose.yaml" "$previous_release/"
grep -Fq 'stop_grace_period: 30s' "$source_dir/compose.yaml"
touch "$deployment_root/.env"
printf '%s\n' 'previous' >"$deployment_root/.deployed-image-tag"
printf '%s\n' "$previous_release" >"$deployment_root/.deployed-release"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s|%s\n" "${IMAGE_TAG:-}" "$*" >>"$FAKE_LOG"' \
  'if [[ "$1" == "inspect" ]]; then' \
  '  if [[ "$*" == *RestartCount* ]]; then' \
  '    printf "0\n"' \
  '  elif [[ "${IMAGE_TAG:-}" == "broken" ]]; then' \
  '    printf "unhealthy\n"' \
  '  else' \
  '    printf "healthy\n"' \
  '  fi' \
  'elif [[ "$1" == "compose" && "$*" == *" ps --all -q gateway"* ]]; then' \
  '  printf "gateway-container\n"' \
  'fi' >"$fake_bin/docker"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s|curl %s\n" "${IMAGE_TAG:-}" "$*" >>"$FAKE_LOG"' \
  'if [[ "${IMAGE_TAG:-}" == "broken" ]]; then' \
  '  exit 22' \
  'fi' \
  'if [[ "${IMAGE_TAG:-}" == "public-broken" && "$*" == *smartthings.growful.click* ]]; then' \
  '  exit 22' \
  'fi' \
  'if [[ "${IMAGE_TAG:-}" == "same-rerun" && "$*" == *smartthings.growful.click* && ! -f "$FAIL_ONCE_MARKER" ]]; then' \
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

if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" registry.example/gateway broken; then
  printf 'broken deployment unexpectedly succeeded\n' >&2
  exit 1
fi

grep -Eq '^broken\|compose .* up -d --no-deps gateway$' "$fake_log"
grep -Eq '^previous\|compose .* up -d --no-deps gateway$' "$fake_log"
grep -Eq '^previous\|curl .*127\.0\.0\.1:8100/healthz$' "$fake_log"
test "$(<"$deployment_root/.deployed-image-tag")" = 'previous'
test "$(<"$deployment_root/.deployed-release")" = "$previous_release"

: >"$fake_log"
if DEPLOYMENT_ROOT="$deployment_root" PUBLIC_BASE_URL="https://smartthings.growful.click" \
  bash "$release_dir/deploy.sh" registry.example/gateway public-broken; then
  printf 'deployment with a broken public route unexpectedly succeeded\n' >&2
  exit 1
fi

grep -Eq '^public-broken\|curl .*smartthings\.growful\.click/healthz$' "$fake_log"
grep -Eq '^previous\|compose .* up -d --no-deps gateway$' "$fake_log"
test "$(<"$deployment_root/.deployed-image-tag")" = 'previous'

: >"$fake_log"
printf '%s\n' 'same-rerun' >"$deployment_root/.deployed-image-tag"
if DEPLOYMENT_ROOT="$deployment_root" PUBLIC_BASE_URL="https://smartthings.growful.click" \
  bash "$release_dir/deploy.sh" registry.example/gateway same-rerun; then
  printf 'same-tag rerun with a transient public failure unexpectedly succeeded\n' >&2
  exit 1
fi

test "$(grep -Ec '^same-rerun\|compose .* up -d --no-deps gateway$' "$fake_log")" = '2'
if grep -Eq '^same-rerun\|compose .* stop gateway$' "$fake_log"; then
  printf 'same-tag rollback stopped the previously healthy gateway\n' >&2
  exit 1
fi
test "$(<"$deployment_root/.deployed-image-tag")" = 'same-rerun'

: >"$fake_log"
DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" registry.example/gateway healthy

grep -Eq '^healthy\|compose .* up -d --no-deps gateway$' "$fake_log"
grep -Eq '^healthy\|curl .*127\.0\.0\.1:8100/healthz$' "$fake_log"
test "$(<"$deployment_root/.deployed-image-tag")" = 'healthy'
test "$(<"$deployment_root/.deployed-release")" = "$release_dir"
test "$(readlink "$deployment_root/current")" = "$release_dir"
