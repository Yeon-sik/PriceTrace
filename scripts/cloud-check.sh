#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/cloud-runtime.sh"
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:purchase-sql
