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

@test "piped stdin + a real terminal: the binary sees a tty (curl | bash with no --yes shows the picker)" {
  # The README's headline one-liner is `curl ... | bash`, which makes the script's stdin the pipe. `exec` inherits
  # it, so the CLI saw no tty and exited 3 with "Unable to run interactively" -- the advertised picker could never
  # appear. script(1) gives this test a controlling terminal, the pipe from cat plays curl's part.
  command -v script >/dev/null || skip "script(1) not available"
  printf '#!/bin/sh\nif [ -t 0 ]; then echo "stdin-is-a-tty"; else echo "stdin-is-not-a-tty"; fi\n' > "$TMP/release/super-agent-installer-linux-x64"
  (cd "$TMP/release" && sha256sum super-agent-installer-linux-x64 > SHA256SUMS)
  run script -qec "cat '$BATS_TEST_DIRNAME/../../install.sh' | bash" /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"stdin-is-a-tty"* ]]
}
@test "piped stdin + no controlling terminal (Docker, CI): still runs the binary under sh and under bash" {
  # /dev/tty exists as a device node inside containers but cannot be opened. `exec < /dev/tty` failing on that made
  # dash abort the whole script (exit 2) right after installing -- the binary never ran. setsid drops the terminal.
  command -v setsid >/dev/null || skip "setsid not available"
  run setsid -w sh -c "cat '$BATS_TEST_DIRNAME/../../install.sh' | sh -s -- --profile minimal --yes" < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"fake binary args: --profile minimal --yes"* ]]
  run setsid -w bash -c "cat '$BATS_TEST_DIRNAME/../../install.sh' | bash -s -- --yes" < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"fake binary args: --yes"* ]]
}
@test "does not require tar (the binary bootstrap never unpacks anything)" {
  printf '#!/bin/sh\nexit 127\n' > "$TMP/fakebin/tar"; chmod +x "$TMP/fakebin/tar"
  run env PATH="$TMP/fakebin:/usr/bin:/bin" bash "$BATS_TEST_DIRNAME/../../install.sh" --no-run
  [ "$status" -eq 0 ]
  [ -x "$SAI_INSTALL_DIR/super-agent-installer" ]
}
