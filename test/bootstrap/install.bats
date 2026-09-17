#!/usr/bin/env bats
setup() {
  export TMP="$(mktemp -d)"; export HOME="$TMP/home"; mkdir -p "$HOME"
  export SAI_INSTALL_DIR="$TMP/bin"; export SAI_VERSION="0.1.0"; export SAI_BASE_URL="file://$TMP/release"
  mkdir -p "$TMP/release" "$TMP/fakebin"
  printf '#!/bin/sh\necho "fake binary args: $*"\n' > "$TMP/release/super-agent-installer-linux-x64"; chmod +x "$TMP/release/super-agent-installer-linux-x64"
  (cd "$TMP/release" && sha256sum super-agent-installer-linux-x64 > SHA256SUMS)
  # fake curl that copies from file:// URLs
  cat > "$TMP/fakebin/curl" <<'EOF'
#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift;; -*) ;; *) url="$1";; esac; shift; done
src="${url#file://}"; [ -f "$src" ] || exit 22; cp "$src" "$out"
EOF
  chmod +x "$TMP/fakebin/curl"; export PATH="$TMP/fakebin:$PATH"
  export SAI_TEST_UNAME_S=Linux SAI_TEST_UNAME_M=x86_64
}
@test "downloads, verifies, installs and execs the binary" {
  run bash "$BATS_TEST_DIRNAME/../../install.sh" --profile minimal --yes
  [ "$status" -eq 0 ]; [[ "$output" == *"fake binary args: --profile minimal --yes"* ]]
  [ -x "$SAI_INSTALL_DIR/super-agent-installer" ]
}
@test "refuses sudo from a user" {
  SUDO_USER=alex run bash "$BATS_TEST_DIRNAME/../../install.sh" --no-run
  [ "$status" -eq 1 ]; [[ "$output" == *"sudo"* ]]
}
@test "fails on checksum mismatch" {
  echo "0000000000000000000000000000000000000000000000000000000000000000  super-agent-installer-linux-x64" > "$TMP/release/SHA256SUMS"
  run bash "$BATS_TEST_DIRNAME/../../install.sh" --no-run
  [ "$status" -ne 0 ]; [[ "$output" == *"checksum"* ]]; [ ! -e "$SAI_INSTALL_DIR/super-agent-installer" ]
}
@test "adds PATH block to profile files once" {
  touch "$HOME/.bashrc"
  bash "$BATS_TEST_DIRNAME/../../install.sh" --no-run >/dev/null; bash "$BATS_TEST_DIRNAME/../../install.sh" --no-run >/dev/null
  [ "$(grep -c 'super-agent-installer' "$HOME/.bashrc")" -eq 2 ]
}
@test "does not leak the temp download dir on a normal run" {
  export TMPDIR="$TMP/tmpdir"; mkdir -p "$TMPDIR"
  run bash "$BATS_TEST_DIRNAME/../../install.sh" --profile minimal --yes
  [ "$status" -eq 0 ]
  [ -z "$(ls -A "$TMPDIR")" ]
}
@test "handles CRLF line endings in SHA256SUMS" {
  sha_line="$(cat "$TMP/release/SHA256SUMS")"
  printf '%s\r\n' "$sha_line" > "$TMP/release/SHA256SUMS"
  run bash "$BATS_TEST_DIRNAME/../../install.sh" --no-run
  [ "$status" -eq 0 ]
  [ -x "$SAI_INSTALL_DIR/super-agent-installer" ]
}
@test "download failure dies with a retry / releases-page hint and never falls back to npx" {
  rm "$TMP/release/super-agent-installer-linux-x64"
  printf '#!/bin/sh\necho "npx must not run"; exit 99\n' > "$TMP/fakebin/npx"; chmod +x "$TMP/fakebin/npx"
  printf '#!/bin/sh\necho v24.0.0\n' > "$TMP/fakebin/node"; chmod +x "$TMP/fakebin/node"
  run bash "$BATS_TEST_DIRNAME/../../install.sh" --no-run
  [ "$status" -eq 1 ]
  [[ "$output" == *"download failed"* ]]; [[ "$output" == *"releases/tag/v0.1.0"* ]]; [[ "$output" != *"npx"* ]]
  [ ! -e "$SAI_INSTALL_DIR/super-agent-installer" ]
}
@test "sets umask 077 before touching the filesystem" {
  grep -n '^umask 077$' "$BATS_TEST_DIRNAME/../../install.sh"
  [ "$(grep -n '^umask 077$' "$BATS_TEST_DIRNAME/../../install.sh" | cut -d: -f1)" -lt "$(grep -n 'mktemp' "$BATS_TEST_DIRNAME/../../install.sh" | head -1 | cut -d: -f1)" ]
}
