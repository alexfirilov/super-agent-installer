#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DOCKER="${DOCKER:-docker}"
status=0
for df in test/docker/Dockerfile.*; do
  name="${df##*.}"; img="sai-test-$name"
  $DOCKER build -q -f "$df" -t "$img" . || { echo "build failed: $name"; status=1; continue; }
  $DOCKER run --rm "$img" super-agent-installer doctor || { echo "doctor failed: $name"; status=1; }
  $DOCKER run --rm "$img" super-agent-installer install --yes --profile minimal --dry-run || { echo "dry-run failed: $name"; status=1; }
done
exit $status
