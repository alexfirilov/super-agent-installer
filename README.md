# super-agent-installer

One command that installs and updates Claude Code, Codex CLI, and the plugins, skills, MCP servers and settings you want on every host: Linux, Windows and macOS.

## Install

Linux / macOS / WSL:

    curl -fsSL https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.1.0/install.sh | bash

Windows (PowerShell 5.1 or 7):

    irm https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.1.0/install.ps1 | iex

Unattended:

    curl -fsSL .../install.sh | bash -s -- --yes --profile homelab
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.1.0/install.ps1))) --yes --profile work

Proxmox host (root, no sudo):

    curl -fsSL .../install.sh | bash -s -- --yes --profile proxmox-host

## Commands

    super-agent-installer            interactive picker (default: everything)
    super-agent-installer update     update everything selected on this host, including the installer
    super-agent-installer check      drift report (exit 2 when something is outdated or missing)
    super-agent-installer list       all components with verdicts and token costs
    super-agent-installer doctor     host diagnostics plus claude doctor / codex doctor
    super-agent-installer self-update   update the installer binary only
    super-agent-installer uninstall [id...]

Flags: --profile all|minimal|claude-only|codex-only|work|homelab|proxmox-host, --only a,b, --skip c, --yes, --dry-run, --json, --no-audit, --channel latest|stable, --from-state, --no-self-update, --no-login, --no-persist-secrets, --elevate.

- `--no-login` skips the sign-in phase entirely (see below); use it on a host with no browser, or when you already manage auth yourself.
- `--no-persist-secrets` leaves pasted API keys in memory for this run only, instead of saving them to the user environment.
- `--elevate` (Windows only) allows a machine-scope winget install, which triggers one UAC prompt. Without it, installs stay per-user (scoop / `winget --scope user` / npm / a per-user script) and never prompt for admin.

## Sign-in

As soon as the agents themselves are installed (and before anything that needs them), the installer signs each selected agent in for you: it detects an existing session (`claude auth status` / `codex login status`), and if neither is signed in it opens the vendor's own interactive login and waits for it to finish. On a headless host (no display, SSH, or an LXC container) it falls back to `claude setup-token` / `codex login --device-auth` instead of trying to open a browser. A component that needs an agent that never signed in (for example, a remote Codex plugin catalog that needs a ChatGPT login) is skipped with a one-line reason rather than failing later; those skips are listed as `BLOCKED` in the summary and make the run exit `2`. Pass `--no-login` to skip this phase and sign in yourself afterwards.

## What it manages

See `docs/research/CATALOG.md` for the full ranked catalog and `manifest.json` for the exact components. The installer prompts for API keys only when a selected component needs one, validates them against the provider's API (and reports GitHub PAT scopes) before continuing, then persists them to the OS user environment so every new shell and every agent can see them: on Windows via `[Environment]::SetEnvironmentVariable(name, value, 'User')`; on POSIX in a dedicated `0600` file (`${XDG_CONFIG_HOME:-~/.config}/super-agent-installer/secrets.env`) that `~/.profile`, `~/.bashrc` and `~/.zshrc` source with a guarded line (the latter two when they exist; `~/.zshrc` is created when zsh is your login shell) -- the key value itself is never written into either rc file. Pass `--no-persist-secrets` to keep a key in memory for this run only; the summary then lists the exact `export`/`setx` line for every key the run held, including one it captured itself (a `claude setup-token` token on a headless host), so nothing is silently discarded.

## After install

Everything above -- sign-in, key validation and persistence, and installing agent-browser's own CLI -- happens inside the run. What's left is advisory only, and only when it applies: restart any Claude Code session that was already running when the plugin/settings changes landed, and if you enabled the caveman Codex hooks, run `/hooks` once inside Codex to trust them.

## Development

    bun install && bunx vitest run && bunx tsc --noEmit
    bash scripts/build.sh          # binaries in release/
    scripts/release.sh 0.2.0       # bump, tag; push tags to publish
