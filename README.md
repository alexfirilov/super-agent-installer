# super-agent-installer

One command that installs and updates Claude Code, Codex CLI, and the plugins, skills, MCP servers and settings you want on every host: Linux, Windows and macOS.

## Install

Linux / macOS / WSL:

    curl -fsSL https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.1.0/install.sh | bash

Windows (PowerShell 5.1 or 7):

    irm https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.1.0/install.ps1 | iex

Unattended:

    curl -fsSL .../install.sh | bash -s -- --yes --profile homelab
    irm .../install.ps1 | iex; super-agent-installer --yes --profile work

Proxmox host (root, no sudo):

    curl -fsSL .../install.sh | bash -s -- --yes --profile proxmox-host

## Commands

    super-agent-installer            interactive picker (default: everything)
    super-agent-installer update     update everything selected on this host, including the installer
    super-agent-installer check      drift report (exit 2 when something is outdated or missing)
    super-agent-installer list       all components with verdicts and token costs
    super-agent-installer doctor     host diagnostics plus claude doctor / codex doctor
    super-agent-installer uninstall [id...]

Flags: --profile all|minimal|claude-only|codex-only|work|homelab|proxmox-host, --only a,b, --skip c, --yes, --dry-run, --json, --no-audit, --channel latest|stable, --from-state.

## What it manages

See `docs/research/CATALOG.md` for the full ranked catalog and `manifest.json` for the exact components. Secrets are never written to disk: the installer prompts for API keys only when a command needs them and otherwise prints the `export`/`setx` lines to run.

## After install

- `claude` once to log in (headless: `claude setup-token` then export `CLAUDE_CODE_OAUTH_TOKEN`)
- `codex login` (headless: `codex login --device-auth`)
- Codex: run `/hooks` once to trust caveman hooks if you enabled them

## Development

    bun install && bunx vitest run && bunx tsc --noEmit
    bash scripts/build.sh          # binaries in release/
    scripts/release.sh 0.2.0       # bump, tag; push tags to publish
