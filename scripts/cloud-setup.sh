#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/cloud-runtime.sh"
npm ci --no-audit --no-fund
# Browser binaries are optional and intentionally separate from cached setup.
# Run `npm exec -- playwright install --with-deps chromium` before E2E.
