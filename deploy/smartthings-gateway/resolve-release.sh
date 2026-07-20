#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$deployment_dir/../.." && pwd)"
tip="${1:?git revision is required}"

git -C "$repository_root" rev-list -1 "$tip" -- \
  packages/smartthings-gateway \
  deploy/smartthings-gateway \
  .github/workflows/smartthings-gateway.yaml
