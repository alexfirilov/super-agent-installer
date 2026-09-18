#!/usr/bin/env bash
# Integration matrix: for every test/docker/Dockerfile.* build the image from the release binary and, inside one
# container with a throwaway HOME / CLAUDE_CONFIG_DIR / CODEX_HOME, run doctor, a dry-run, then a REAL
# `install --yes --profile minimal --no-login` (network required: npm, GitHub; --no-login because the container has
# no browser for the sign-in phase to open), `check` and `update --no-self-update`. The real install's summary is
# also checked for "Next steps" entries that should have run as actions instead of being left for the user: any line
# whose first token is a known executable, rather than a fixed list of the few strings we happened to remove. The two
# legitimate exceptions are the `export VAR=<value>` placeholders (only the user has the key) and the sign-in notice,
# which MUST be there: with --no-login the summary has to name each agent that was left signed out. Any non-zero
# step, any leftover entry, or a missing sign-in notice fails the matrix.
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
  leftover=$(printf "%s\n" "$out" \
    | grep "^- " \
    | grep -v "sign-in was skipped with --no-login" \
    | grep -v "sign-in did not complete" \
    | grep -Ev "^- [A-Za-z0-9_-]+=<value>|<value>" \
    | grep -E "^- ([a-z0-9-]+: )?(advisory: )?(npm|npx|node|curl|wget|sh|bash|pwsh|powershell|setx|export|claude|codex|scoop|winget|choco|brew|apt-get|gh|go|uv|uvx|pip|pipx|fnm|git|run)[ \`]" || true)
  if [ -n "$leftover" ]; then
    printf "%s\n" "$leftover"
    echo "FAILED: $SAI_IMAGE: Next steps contained an entry that should have run automatically"; exit 1
  fi
  if ! printf "%s\n" "$out" | grep -q "sign-in was skipped with --no-login"; then
    echo "FAILED: $SAI_IMAGE: a --no-login run must still tell the user each agent is not signed in"; exit 1
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
