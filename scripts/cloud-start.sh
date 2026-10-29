#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/cloud-runtime.sh"
exec npm run dev -- --hostname 0.0.0.0 --port 3000
