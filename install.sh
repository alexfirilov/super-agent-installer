#!/bin/sh
# super-agent-installer bootstrap for Linux, macOS and WSL.
# Usage: curl -fsSL https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.3.0/install.sh | bash -s -- [--profile all] [--yes]
set -eu
umask 077

SAI_DEFAULT_VERSION="0.3.0"
SAI_VERSION="${SAI_VERSION:-$SAI_DEFAULT_VERSION}"
SAI_REPO="${SAI_REPO:-alexfirilov/super-agent-installer}"
SAI_BASE_URL="${SAI_BASE_URL:-https://github.com/${SAI_REPO}/releases/download/v${SAI_VERSION}}"
SAI_INSTALL_DIR="${SAI_INSTALL_DIR:-$HOME/.local/bin}"

NO_RUN=0
for a in "$@"; do [ "$a" = "--no-run" ] && NO_RUN=1; done

say() { printf '%s\n' "super-agent-installer: $*" >&2; }
die() { say "$*"; exit 1; }

if [ -n "${SUDO_USER:-}" ] && [ "${SAI_ALLOW_SUDO:-0}" != "1" ]; then
  die "do not run with sudo (it would install into root's home). Run as your user, or as plain root on servers. Set SAI_ALLOW_SUDO=1 to override."
fi

# SAI_TEST_UNAME_S/SAI_TEST_UNAME_M let tests pin the detected platform without mocking uname(1).
os="${SAI_TEST_UNAME_S:-}"; [ -n "$os" ] || os="$(uname -s)"
arch="${SAI_TEST_UNAME_M:-}"; [ -n "$arch" ] || arch="$(uname -m)"

case "$os" in
  Linux) plat=linux ;;
  Darwin) plat=darwin ;;
  *) die "unsupported OS: $os (use install.ps1 on Windows)" ;;
esac

case "$arch" in
  x86_64|amd64) a=x64 ;;
  aarch64|arm64) a=arm64 ;;
  *) die "unsupported architecture: $arch" ;;
esac

target="${plat}-${a}"
if [ "$plat" = linux ] && [ -z "${SAI_TEST_UNAME_S:-}" ] && ldd --version 2>&1 | grep -qi musl; then
  target="${target}-musl"
fi

need() { command -v "$1" >/dev/null 2>&1; }

if ! need curl && ! need wget; then
  if [ "$(id -u)" = 0 ]; then
    if need apt-get; then apt-get update && apt-get install -y curl ca-certificates
    elif need apk; then apk add --no-cache curl ca-certificates
    elif need dnf; then dnf install -y curl ca-certificates
    fi
  fi
  need curl || need wget || die "curl or wget is required"
fi

fetch() {
  if need curl; then
    curl --proto '=https' --tlsv1.2 -fsSL --retry 3 -o "$2" "$1"
  else
    # match curl's --proto '=https': without it a redirect or a tampered SAI_BASE_URL can pull the binary
    # (and SHA256SUMS, which is our only integrity check) over plaintext http
    wget -q --https-only -O "$2" "$1"
  fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

asset="super-agent-installer-${target}"
say "downloading ${asset} v${SAI_VERSION}"

if ! fetch "${SAI_BASE_URL}/${asset}" "$tmp/$asset" || ! fetch "${SAI_BASE_URL}/SHA256SUMS" "$tmp/SHA256SUMS"; then
  die "download failed for ${SAI_BASE_URL}/${asset}. Retry, or download the binary and SHA256SUMS from https://github.com/${SAI_REPO}/releases/tag/v${SAI_VERSION} and put it at ${SAI_INSTALL_DIR}/super-agent-installer"
fi

# strip CR so SHA256SUMS files with CRLF line endings (e.g. produced on Windows) still match.
expected="$(tr -d '\r' < "$tmp/SHA256SUMS" | grep " ${asset}\$" | awk '{print $1}')"
[ -n "$expected" ] || die "no checksum for ${asset} in SHA256SUMS"

if need sha256sum; then
  actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
fi
[ "$actual" = "$expected" ] || die "checksum mismatch for ${asset}: expected ${expected}, got ${actual}"

mkdir -p "$SAI_INSTALL_DIR"
install -m 0755 "$tmp/$asset" "$SAI_INSTALL_DIR/super-agent-installer"

case ":$PATH:" in
  *":$SAI_INSTALL_DIR:"*) ;;
  *)
    for rc in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
      [ -f "$rc" ] || continue
      grep -q '# >>> super-agent-installer >>>' "$rc" && continue
      # shellcheck disable=SC2016 # $PATH here is meant to stay literal: it is expanded when the rc file is later sourced, not now.
      printf '\n# >>> super-agent-installer >>>\nexport PATH="%s:$PATH"\n# <<< super-agent-installer <<<\n' "$SAI_INSTALL_DIR" >> "$rc"
    done
    say "added ${SAI_INSTALL_DIR} to PATH in your shell rc (open a new shell to pick it up)"
    ;;
esac

say "installed to ${SAI_INSTALL_DIR}/super-agent-installer"
[ "$NO_RUN" = 1 ] && exit 0
rm -rf "$tmp"
# `curl ... | bash` makes this script's stdin the pipe from curl, and exec inherits it -- so the installer saw no
# terminal and refused to run interactively, meaning the README's headline one-liner could never show the picker.
# Hand the BINARY the real terminal when there is one. Two traps, both hit for real:
#  - `exec < /dev/tty` on its own line redirects the shell's stdin, and a shell fed by a pipe then reads the rest of
#    THIS SCRIPT from the terminal: the binary never starts. The redirection must belong to the exec'd command.
#  - /dev/tty exists as a device node inside containers but cannot be opened; a failed redirection on `exec` makes
#    dash abort the script. Probe it in a subshell first, so CI and Docker fall through to the plain exec
#    (where the existing --yes path applies).
if [ ! -t 0 ] && ( : < /dev/tty ) 2>/dev/null; then
  exec "$SAI_INSTALL_DIR/super-agent-installer" "$@" < /dev/tty
fi
exec "$SAI_INSTALL_DIR/super-agent-installer" "$@"
