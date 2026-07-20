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
rollback_block_marker="$test_root/rollback-blocked"
previous_image_reference='registry.example/gateway@sha256:0000000000000000000000000000000000000000000000000000000000000001'
broken_image_reference='registry.example/gateway@sha256:0000000000000000000000000000000000000000000000000000000000000003'
public_broken_image_reference='registry.example/gateway@sha256:0000000000000000000000000000000000000000000000000000000000000004'
same_rerun_image_reference='registry.example/gateway@sha256:0000000000000000000000000000000000000000000000000000000000000005'
healthy_image_reference='registry.example/gateway@sha256:0000000000000000000000000000000000000000000000000000000000000002'
release_state_file="$deployment_root/.deployed-release-state"
deployment_sequence_file="$deployment_root/.deployment-sequence"

assert_release_state() {
  local expected_image_reference="$1"
  local expected_release_id="$2"
  local expected_release="$3"
  local expected_sequence="$4"
  local -a actual_state
  local state_line
  actual_state=()
  while IFS= read -r state_line; do
    actual_state+=("$state_line")
  done <"$release_state_file"
  test "${#actual_state[@]}" = '4'
  test "${actual_state[0]}" = "$expected_image_reference"
  test "${actual_state[1]}" = "$expected_release_id"
  test "${actual_state[2]}" = "$expected_release"
  test "${actual_state[3]}" = "$expected_sequence"
}

assert_deployment_sequence() {
  local expected_sequence="$1"
  local expected_release_id="$2"
  local expected_image_reference="$3"
  local -a actual_sequence
  local sequence_line
  actual_sequence=()
  while IFS= read -r sequence_line; do
    actual_sequence+=("$sequence_line")
  done <"$deployment_sequence_file"
  test "${#actual_sequence[@]}" = '3'
  test "${actual_sequence[0]}" = "$expected_sequence"
  test "${actual_sequence[1]}" = "$expected_release_id"
  test "${actual_sequence[2]}" = "$expected_image_reference"
}

cleanup() {
  rm -rf "$test_root"
}
trap cleanup EXIT

mkdir -p "$release_dir" "$previous_release" "$fake_bin"
cp "$source_dir/deploy.sh" "$source_dir/compose.yaml" "$release_dir/"
cp "$source_dir/compose.yaml" "$previous_release/"
grep -Fq 'stop_grace_period: 120s' "$source_dir/compose.yaml"
touch "$deployment_root/.env"
touch "$deployment_root/.env.rollback.stale"
printf '%s\n' "$previous_image_reference" 'previous' "$previous_release" '1' >"$release_state_file"

# Dollar expressions below belong to the generated fake executable.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s|%s\n" "${RELEASE_ID:-}" "$*" >>"$FAKE_LOG"' \
  'if [[ "$1" == "compose" && "${BLOCK_ROLLBACK:-}" == "1" && "${RELEASE_ID:-}" != "broken" && "$*" == *" up -d --no-deps gateway"* ]]; then' \
  '  printf "%s\n" "$$" >"$ROLLBACK_BLOCK_MARKER"' \
  '  while :; do sleep 1; done' \
  'elif [[ "$1" == "compose" && "${FAIL_STOP:-}" == "1" && "$*" == *" stop gateway"* ]]; then' \
  '  exit 1' \
  'elif [[ "$1" == "compose" && "${FAIL_ROLLBACK:-}" == "1" && "$*" == *" up -d --no-deps gateway"* ]]; then' \
  '  exit 1' \
  'elif [[ "$1" == "inspect" ]]; then' \
  '  if [[ "$*" == *RestartCount* ]]; then' \
  '    printf "0\n"' \
  '  elif [[ "${RELEASE_ID:-}" == "broken" ]]; then' \
  '    printf "unhealthy\n"' \
  '  else' \
  '    printf "healthy\n"' \
  '  fi' \
  'elif [[ "$1" == "compose" && "$*" == *" ps --all -q gateway"* ]]; then' \
  '  printf "gateway-container\n"' \
  'elif [[ "$1" == "compose" && "$*" == *" up -d --no-deps gateway"* ]]; then' \
  '  if grep --fixed-strings --line-regexp --quiet "SMARTTHINGS_SCOPES=r:devices:$" "${GATEWAY_ENV_FILE:?}"; then' \
  '    printf "%s|rollback-scope=exact\n" "${RELEASE_ID:-}" >>"$FAKE_LOG"' \
  '  else' \
  '    printf "%s|rollback-scope=absent\n" "${RELEASE_ID:-}" >>"$FAKE_LOG"' \
  '  fi' \
  '  admin_token="$(sed -n "s/^OAUTH_ADMIN_TOKEN=//p" "${GATEWAY_ENV_FILE:?}")"' \
  '  gateway_token="$(sed -n "s/^GATEWAY_API_TOKEN=//p" "${GATEWAY_ENV_FILE:?}")"' \
  '  if ((${#admin_token} >= 32 && ${#gateway_token} >= 32)) && [[ "$admin_token" != "$gateway_token" ]]; then' \
  '    printf "%s|rollback-credentials=valid\n" "${RELEASE_ID:-}" >>"$FAKE_LOG"' \
  '  else' \
  '    printf "%s|rollback-credentials=invalid\n" "${RELEASE_ID:-}" >>"$FAKE_LOG"' \
  '  fi' \
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
  'if [[ ("${RELEASE_ID:-}" == "public-broken" || "${RELEASE_ID:-}" == "first-stop-failure") && "$*" == *smartthings.growful.click* ]]; then' \
  '  exit 22' \
  'fi' \
  'if [[ "${RELEASE_ID:-}" == "same-rerun" && "$*" == *smartthings.growful.click* && ! -f "$FAIL_ONCE_MARKER" ]]; then' \
  '  touch "$FAIL_ONCE_MARKER"' \
  '  exit 22' \
  'fi' \
  'printf "{\"status\":\"ok\"}\n"' >"$fake_bin/curl"

# Dollar expressions below belong to the generated fake executable.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'destination="${!#}"' \
  'if [[ "${FAIL_SEQUENCE_MOVE:-}" == "1" && "$destination" == "$DEPLOYMENT_SEQUENCE_FILE" ]]; then' \
  '  exit 1' \
  'fi' \
  'if [[ "${FAIL_STATE_MOVE:-}" == "1" && "$destination" == "$RELEASE_STATE_FILE" ]]; then' \
  '  exit 1' \
  'fi' \
  'exec /bin/mv "$@"' >"$fake_bin/mv"

printf '%s\n' '#!/usr/bin/env bash' 'exit 0' >"$fake_bin/flock"
chmod +x "$fake_bin/docker" "$fake_bin/curl" "$fake_bin/flock" "$fake_bin/mv"
export FAKE_LOG="$fake_log"
export FAIL_ONCE_MARKER="$fail_once_marker"
export ROLLBACK_BLOCK_MARKER="$rollback_block_marker"
export RELEASE_STATE_FILE="$release_state_file"
export DEPLOYMENT_SEQUENCE_FILE="$deployment_sequence_file"
export HEALTHCHECK_ATTEMPTS=1
export HEALTHCHECK_INTERVAL_SECONDS=0
export PUBLIC_HEALTHCHECK_ATTEMPTS=1
export PUBLIC_HEALTHCHECK_INTERVAL_SECONDS=0
export PATH="$fake_bin:$PATH"

: >"$fake_log"
mv "$previous_release/compose.yaml" "$previous_release/compose.yaml.unavailable"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" "$broken_image_reference" broken 2; then
  printf 'deployment without an exact rollback Compose file unexpectedly started\n' >&2
  exit 1
fi
mv "$previous_release/compose.yaml.unavailable" "$previous_release/compose.yaml"
test ! -s "$fake_log"
test ! -e "$deployment_root/.env.rollback.stale"

: >"$fake_log"
mv "$release_state_file" "$release_state_file.saved"
if FAIL_STOP=1 DEPLOYMENT_ROOT="$deployment_root" \
  PUBLIC_BASE_URL="https://smartthings.growful.click" \
  bash "$release_dir/deploy.sh" "$public_broken_image_reference" first-stop-failure 2; then
  printf 'first deployment with a failed stop unexpectedly succeeded\n' >&2
  exit 1
fi
test ! -f "$release_state_file"
test "$(grep -Ec '^first-stop-failure\|compose .* stop gateway$' "$fake_log")" = '2'
rm -f "$deployment_sequence_file"
mv "$release_state_file.saved" "$release_state_file"

: >"$fake_log"
mv "$release_state_file" "$release_state_file.saved"
if FAIL_STATE_MOVE=1 DEPLOYMENT_ROOT="$deployment_root" \
  bash "$release_dir/deploy.sh" "$public_broken_image_reference" first-state-failure 2; then
  printf 'first deployment with a failed release-state commit unexpectedly succeeded\n' >&2
  exit 1
fi
test ! -f "$release_state_file"
grep -Eq '^first-state-failure\|compose .* up -d --no-deps gateway$' "$fake_log"
grep -Eq '^first-state-failure\|compose .* stop gateway$' "$fake_log"
assert_deployment_sequence 2 first-state-failure "$public_broken_image_reference"
mv "$release_state_file.saved" "$release_state_file"

if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" registry.example/gateway:mutable invalid 2; then
  printf 'mutable image reference unexpectedly reached deployment\n' >&2
  exit 1
fi

: >"$fake_log"
if FAIL_SEQUENCE_MOVE=1 DEPLOYMENT_ROOT="$deployment_root" \
  bash "$release_dir/deploy.sh" "$healthy_image_reference" sequence-state-failure 3; then
  printf 'deployment with a failed high-water commit unexpectedly succeeded\n' >&2
  exit 1
fi
test ! -s "$fake_log"
assert_deployment_sequence 2 first-state-failure "$public_broken_image_reference"
assert_release_state "$previous_image_reference" previous "$previous_release" 1

if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" "$broken_image_reference" broken 3; then
  printf 'broken deployment unexpectedly succeeded\n' >&2
  exit 1
fi

grep -Eq '^broken\|compose .* up -d --no-deps gateway$' "$fake_log"
grep -Fq "previous|image inspect $previous_image_reference" "$fake_log"
grep -Eq '^previous\|compose .* up -d --no-deps gateway$' "$fake_log"
grep -Fq 'previous|rollback-scope=exact' "$fake_log"
grep -Fq 'previous|rollback-credentials=valid' "$fake_log"
test ! -s "$deployment_root/.env"
grep -Eq '^previous\|curl .*127\.0\.0\.1:8100/healthz$' "$fake_log"
assert_release_state "$previous_image_reference" previous "$previous_release" 1
assert_deployment_sequence 3 broken "$broken_image_reference"

: >"$fake_log"
if DEPLOYMENT_ROOT="$deployment_root" PUBLIC_BASE_URL="https://smartthings.growful.click" \
  bash "$release_dir/deploy.sh" "$public_broken_image_reference" public-broken 4; then
  printf 'deployment with a broken public route unexpectedly succeeded\n' >&2
  exit 1
fi

grep -Eq '^public-broken\|curl .*smartthings\.growful\.click/healthz$' "$fake_log"
grep -Eq '^previous\|compose .* up -d --no-deps gateway$' "$fake_log"
assert_release_state "$previous_image_reference" previous "$previous_release" 1
assert_deployment_sequence 4 public-broken "$public_broken_image_reference"

: >"$fake_log"
printf '%s\n' "$previous_image_reference" 'same-rerun' "$previous_release" '4' >"$release_state_file"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" "$same_rerun_image_reference" same-rerun 5; then
  printf 'same release with a different digest unexpectedly succeeded\n' >&2
  exit 1
fi

if grep -Eq '^same-rerun\|compose .* (pull gateway|run --rm gateway|up -d|stop gateway)' "$fake_log"; then
  printf 'digest mismatch mutated the previously healthy gateway\n' >&2
  exit 1
fi
assert_release_state "$previous_image_reference" same-rerun "$previous_release" 4
assert_deployment_sequence 4 public-broken "$public_broken_image_reference"

: >"$fake_log"
if DEPLOYMENT_ROOT="$deployment_root" PUBLIC_BASE_URL="https://smartthings.growful.click" \
  bash "$release_dir/deploy.sh" "$previous_image_reference" same-rerun 5; then
  printf 'same-release rerun with a transient public failure unexpectedly succeeded\n' >&2
  exit 1
fi

if grep -Eq '^same-rerun\|compose .* (pull gateway|run --rm gateway|up -d|stop gateway)' "$fake_log"; then
  printf 'same-release verification mutated the previously healthy gateway\n' >&2
  exit 1
fi
assert_release_state "$previous_image_reference" same-rerun "$previous_release" 4
assert_deployment_sequence 4 public-broken "$public_broken_image_reference"

: >"$fake_log"
if FAIL_STATE_MOVE=1 DEPLOYMENT_ROOT="$deployment_root" \
  bash "$release_dir/deploy.sh" "$healthy_image_reference" state-failure 6; then
  printf 'deployment with a failed release-state commit unexpectedly succeeded\n' >&2
  exit 1
fi
grep -Eq '^state-failure\|compose .* up -d --no-deps gateway$' "$fake_log"
grep -Eq '^same-rerun\|compose .* up -d --no-deps gateway$' "$fake_log"
assert_release_state "$previous_image_reference" same-rerun "$previous_release" 4
assert_deployment_sequence 6 state-failure "$healthy_image_reference"

: >"$fake_log"
if DEPLOYMENT_ROOT="$deployment_root" \
  bash "$release_dir/deploy.sh" "$broken_image_reference" state-failure 6; then
  printf 'equal deployment sequence accepted a different image digest\n' >&2
  exit 1
fi
test ! -s "$fake_log"
assert_deployment_sequence 6 state-failure "$healthy_image_reference"

: >"$fake_log"
if DEPLOYMENT_ROOT="$deployment_root" \
  bash "$release_dir/deploy.sh" "$broken_image_reference" oversized 18446744073709551617; then
  printf 'oversized deployment sequence unexpectedly succeeded\n' >&2
  exit 1
fi
test ! -s "$fake_log"
assert_deployment_sequence 6 state-failure "$healthy_image_reference"

: >"$fake_log"
DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" "$broken_image_reference" delayed 5
test ! -s "$fake_log"
assert_release_state "$previous_image_reference" same-rerun "$previous_release" 4
assert_deployment_sequence 6 state-failure "$healthy_image_reference"

: >"$fake_log"
if FAIL_ROLLBACK=1 DEPLOYMENT_ROOT="$deployment_root" \
  bash "$release_dir/deploy.sh" "$broken_image_reference" broken 7; then
  printf 'deployment with a failed rollback unexpectedly succeeded\n' >&2
  exit 1
fi
grep -Eq '^same-rerun\|compose .* up -d --no-deps gateway$' "$fake_log"
grep -Eq '^same-rerun\|compose .* stop gateway$' "$fake_log"
assert_release_state "$previous_image_reference" same-rerun "$previous_release" 4
assert_deployment_sequence 7 broken "$broken_image_reference"

: >"$fake_log"
DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" "$healthy_image_reference" healthy 8

grep -Eq '^healthy\|compose .* up -d --no-deps gateway$' "$fake_log"
grep -Eq '^healthy\|curl .*127\.0\.0\.1:8100/healthz$' "$fake_log"
assert_release_state "$healthy_image_reference" healthy "$release_dir" 8
assert_deployment_sequence 8 healthy "$healthy_image_reference"
test "$(readlink "$deployment_root/current")" = "$release_dir"

: >"$fake_log"
mv "$deployment_sequence_file" "$deployment_sequence_file.saved"
printf '%s\n' '18446744073709551617' malformed "$broken_image_reference" >"$deployment_sequence_file"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" "$broken_image_reference" malformed 9; then
  printf 'overflowing stored deployment sequence unexpectedly succeeded\n' >&2
  exit 1
fi
test ! -s "$fake_log"
mv "$deployment_sequence_file.saved" "$deployment_sequence_file"
assert_deployment_sequence 8 healthy "$healthy_image_reference"

: >"$fake_log"
DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" "$broken_image_reference" stale 7
test ! -s "$fake_log"
assert_release_state "$healthy_image_reference" healthy "$release_dir" 8
assert_deployment_sequence 8 healthy "$healthy_image_reference"

: >"$fake_log"
if DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" "$broken_image_reference" conflict 8; then
  printf 'deployment sequence collision unexpectedly succeeded\n' >&2
  exit 1
fi
test ! -s "$fake_log"
assert_release_state "$healthy_image_reference" healthy "$release_dir" 8
assert_deployment_sequence 8 healthy "$healthy_image_reference"

: >"$fake_log"
DEPLOYMENT_ROOT="$deployment_root" bash "$release_dir/deploy.sh" "$healthy_image_reference" healthy 9
if grep -Eq '^healthy\|compose .* (pull gateway|run --rm gateway|up -d|stop gateway)' "$fake_log"; then
  printf 'same-release sequence update mutated the healthy gateway\n' >&2
  exit 1
fi
assert_release_state "$healthy_image_reference" healthy "$release_dir" 9
assert_deployment_sequence 9 healthy "$healthy_image_reference"

rm -f "$rollback_block_marker"
BLOCK_ROLLBACK=1 DEPLOYMENT_ROOT="$deployment_root" \
  bash "$release_dir/deploy.sh" "$broken_image_reference" interrupted 10 &
interrupted_deploy_pid=$!
for attempt in {1..50}; do
  if [[ -s "$rollback_block_marker" ]]; then
    break
  fi
  if [[ "$attempt" == 50 ]]; then
    printf 'interrupted rollback did not reach the blocking command\n' >&2
    exit 1
  fi
  sleep 0.1
done
kill -TERM "$interrupted_deploy_pid"
kill -TERM "$(<"$rollback_block_marker")"
if wait "$interrupted_deploy_pid"; then
  printf 'interrupted deployment unexpectedly succeeded\n' >&2
  exit 1
fi
test -z "$(find "$deployment_root" -maxdepth 1 -type f -name '.env.rollback.*' -print -quit)"
