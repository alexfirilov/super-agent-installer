#!/usr/bin/env bash
# Integration matrix: for every test/docker/Dockerfile.* build the image from the release binary and, inside one
# container with a throwaway HOME / CLAUDE_CONFIG_DIR / CODEX_HOME, run doctor, a dry-run, then a REAL
# `install --yes --profile minimal` (network required: claude.ai, chatgpt.com, npm, GitHub), `check` and
# `update --no-self-update`. Any non-zero step fails the matrix.
set -euo pipefail
cd "$(dirname "$0")/.."
DOCKER="${DOCKER:-docker}"
PROFILE="${SAI_MATRIX_PROFILE:-minimal}"
status=0
# shellcheck disable=SC2016 # runs inside the container; $HOME / $SAI_* expand there
INNER='
  mkdir -p "$HOME"; cd "$HOME"
  step() { echo; echo "--- $SAI_IMAGE: $*"; "$@"; }
  step super-agent-installer doctor
  step super-agent-installer install --yes --profile "$SAI_PROFILE" --dry-run
  step super-agent-installer install --yes --profile "$SAI_PROFILE"
  step super-agent-installer check
  step super-agent-installer update --no-self-update --yes
'
for df in test/docker/Dockerfile.*; do
  name="${df##*.}"; img="sai-test-$name"
  echo "=== $name: build"
  $DOCKER build -q -f "$df" -t "$img" . || { echo "build failed: $name"; status=1; continue; }
  echo "=== $name: doctor, dry-run, install --profile $PROFILE, check, update"
  $DOCKER run --rm -e HOME=/tmp/sai-home -e CLAUDE_CONFIG_DIR=/tmp/sai-home/.claude -e CODEX_HOME=/tmp/sai-home/.codex -e SAI_PROFILE="$PROFILE" -e SAI_IMAGE="$name" "$img" sh -ec "$INNER" || { echo "FAILED: $name"; status=1; continue; }
  echo "PASSED: $name"
done
exit $status
