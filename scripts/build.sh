#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
run() { if [ "${SAI_BUILD_DRY:-0}" = 1 ]; then echo "$*"; else "$@"; fi; }
run mkdir -p dist release
run bun build ./src/cli.ts --target=node --outfile=dist/cli.js
targets="bun-linux-x64:linux-x64 bun-linux-arm64:linux-arm64 bun-linux-x64-musl:linux-x64-musl bun-linux-arm64-musl:linux-arm64-musl bun-darwin-x64:darwin-x64 bun-darwin-arm64:darwin-arm64 bun-windows-x64:windows-x64"
for pair in $targets; do
  t="${pair%%:*}"; name="${pair##*:}"; out="release/super-agent-installer-${name}"; [ "$name" = windows-x64 ] && out="${out}.exe"
  run bun build ./src/cli.ts --compile --minify --target="$t" --outfile="$out"
done
if [ "${SAI_BUILD_DRY:-0}" = 1 ]; then echo "(cd release && sha256sum super-agent-installer-* > SHA256SUMS)"; else (cd release && sha256sum super-agent-installer-* > SHA256SUMS && cat SHA256SUMS); fi
