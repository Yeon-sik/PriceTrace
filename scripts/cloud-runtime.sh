#!/usr/bin/env bash
# Source from a cloud script. Keep the toolchain inside this checkout.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
task_node_version="$(tr -d '\r\n' < .nvmrc)"
if [[ "$(node --version 2>/dev/null || true)" != "v${task_node_version}" ]] || ! command -v corepack >/dev/null 2>&1; then
  case "$(uname -s):$(uname -m)" in
    Linux:x86_64) task_node_platform=linux-x64 ;;
    Linux:aarch64) task_node_platform=linux-arm64 ;;
    *) echo "Use Node ${task_node_version}; automatic setup supports Linux x64/arm64." >&2; exit 1 ;;
  esac
  task_node_archive="node-v${task_node_version}-${task_node_platform}.tar.xz"
  task_node_cache="$PWD/.cloud/runtime"
  mkdir -p "$task_node_cache"
  if [[ ! -x "$task_node_cache/node-v${task_node_version}-${task_node_platform}/bin/node" ]]; then
    task_node_url="https://nodejs.org/dist/v${task_node_version}"
    curl --fail --silent --show-error --location "$task_node_url/$task_node_archive" -o "$task_node_cache/$task_node_archive"
    curl --fail --silent --show-error --location "$task_node_url/SHASUMS256.txt" -o "$task_node_cache/SHASUMS256.txt"
    (cd "$task_node_cache"; grep " ${task_node_archive}$" SHASUMS256.txt | sha256sum --check -)
    tar -xJf "$task_node_cache/$task_node_archive" -C "$task_node_cache"
  fi
  export PATH="$task_node_cache/node-v${task_node_version}-${task_node_platform}/bin:$PATH"
fi
node --version
