#!/usr/bin/env bash
# Integration matrix: for every test/docker/Dockerfile.* build the image from the release binary and, inside one
# container with a throwaway HOME / CLAUDE_CONFIG_DIR / CODEX_HOME, run doctor, a dry-run, then a REAL
# `install --yes --profile minimal --no-login` (network required: npm, GitHub; --no-login because the container has
# no browser for the sign-in phase to open), `check` and `update --no-self-update`. The real install's summary is
# also checked for "Next steps" entries that should have run as actions instead of being left for the user (a
# leftover `npm `/`setx `/`run \`claude\``/`run \`codex\`` line). Any non-zero step, or any such entry, fails the
# matrix.
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
  echo; echo "--- $SAI_IMAGE: super-agent-installer install --yes --profile $SAI_PROFILE --no-login"
  out=$(super-agent-installer install --yes --profile "$SAI_PROFILE" --no-login) || { echo "$out"; echo "FAILED: $SAI_IMAGE install"; exit 1; }
  echo "$out"
  if printf "%s\n" "$out" | grep -E "^- (npm |setx |run \`claude\`|run \`codex\`)"; then
    echo "FAILED: $SAI_IMAGE: Next steps contained an entry that should have run automatically"; exit 1
  fi
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
