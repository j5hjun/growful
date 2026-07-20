#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/smartthings-gateway-release-test.XXXXXX")"

cleanup() {
  rm -rf "$test_root"
}
trap cleanup EXIT

mkdir -p \
  "$test_root/deploy/smartthings-gateway" \
  "$test_root/packages/smartthings-gateway" \
  "$test_root/other-project"
cp "$source_dir/resolve-release.sh" "$test_root/deploy/smartthings-gateway/"
git -C "$test_root" init --quiet
git -C "$test_root" config user.email test@example.invalid
git -C "$test_root" config user.name "Gateway Test"

printf 'base\n' >"$test_root/packages/smartthings-gateway/source"
git -C "$test_root" add .
git -C "$test_root" commit --quiet -m base

printf 'gateway release\n' >>"$test_root/packages/smartthings-gateway/source"
git -C "$test_root" commit --quiet -am gateway
gateway_release="$(git -C "$test_root" rev-parse HEAD)"

printf 'unrelated\n' >"$test_root/other-project/source"
git -C "$test_root" add .
git -C "$test_root" commit --quiet -m unrelated

test "$(bash "$test_root/deploy/smartthings-gateway/resolve-release.sh" HEAD)" = "$gateway_release"
test "$(git -C "$test_root" rev-parse HEAD)" != "$gateway_release"

printf 'next gateway release\n' >>"$test_root/packages/smartthings-gateway/source"
git -C "$test_root" commit --quiet -am next-gateway
test "$(bash "$test_root/deploy/smartthings-gateway/resolve-release.sh" HEAD)" = \
  "$(git -C "$test_root" rev-parse HEAD)"
