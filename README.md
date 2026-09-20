# super-agent-installer

One command that installs and updates Claude Code, Codex CLI, and the plugins, skills, MCP servers and settings you want on every host: Linux, Windows and macOS.

## Install

Linux / macOS / WSL:

    curl -fsSL https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.3.0/install.sh | bash

Windows (PowerShell 5.1 or 7):

    irm https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.3.0/install.ps1 | iex

Unattended:

    curl -fsSL .../install.sh | bash -s -- --yes --profile homelab
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.3.0/install.ps1))) --yes --profile work

Proxmox host (root, no sudo):

    curl -fsSL .../install.sh | bash -s -- --yes --profile proxmox-host

This puts Claude Code and Codex, running as root, on the hypervisor itself: they can then run commands against the
host, its storage and every guest. The installer says so at the start of every run there. For anything you would
mind losing, install into a dedicated management VM or container instead.

## Commands

    super-agent-installer            interactive picker (default: everything)
    super-agent-installer update     update the installer, then everything selected on this host, in one run
    super-agent-installer check      drift report (exit 2 when something is outdated, missing or not as configured)
    super-agent-installer list       all components with verdicts and token costs
    super-agent-installer doctor     host diagnostics plus claude doctor / codex doctor
    super-agent-installer self-update   update the installer binary only
    super-agent-installer uninstall <id...>   remove named components (only ones it installed)
    super-agent-installer uninstall --all      remove every component it installed on this host

Flags: --profile all|minimal|devops|claude-only|codex-only|work|homelab|proxmox-host, --only a,b, --skip c, --yes, --dry-run, --json, --no-audit, --channel latest|stable, --from-state, --no-self-update, --no-login, --no-persist-secrets, --elevate, --all, --force.

Exit codes, every command: `0` done, `1` a step failed, `2` nothing failed but requested work could not be completed
(a component blocked on an agent that never signed in; drift for `check`; a dead proxy route for `doctor`),
`3` a terminal is needed, `4` unsupported host. Automation should treat anything but `0` as "not converged".

- `--no-login` skips the sign-in phase entirely (see below); use it on a host with no browser, or when you already manage auth yourself.
- `--no-persist-secrets` leaves pasted API keys in memory for this run only, instead of saving them to the user environment (see [SECURITY.md](SECURITY.md) for what persistence exposes).
- `--channel` is remembered: `install --channel stable` makes every later bare `update`/`check` use `stable` until
  you pass `--channel` again. Without a flag or a saved channel, the profile's channel applies, then `latest`.
- `update` updates the installer first; when a new version was installed it re-runs itself (`--no-self-update`)
  so the components are updated by the new version with its manifest, in the same run.
- `uninstall` removes only what this installer created. Software that was already on the host when it first ran is
  adopted (managed, updated, checked) but never removed: removing a system package can take its reverse
  dependencies with it -- on one host `apt-get remove bubblewrap` pulled out 150 packages including the desktop.
  Anything the state file cannot prove we installed (no state file, a record from before v0.3.0, a component that
  was never selected) counts as not ours. Name ids explicitly, or pass `--all`; a bare `uninstall --yes` will not
  wipe everything. `--force` overrides the refusal for ids you name yourself.
  Where install replaced something of yours -- an MCP server of the same name you had configured, your own
  `statusLine` -- uninstall puts your earlier value back; an entry you edited after the installer wrote it is left
  as it is and reported. A `~/.claude/settings.json` or `config.toml` that does not parse is never rewritten:
  the step fails and names the file.
- `--elevate` (Windows only) allows a machine-scope winget install, which triggers one UAC prompt. Without it, installs stay per-user (scoop / `winget --scope user` / npm / a per-user script) and never prompt for admin.

### What `check` verifies

`check` (and the table at the end of `update`) compares each selected component with the manifest. For tools,
agents and plugins that is presence plus version: installed vs the pinned or upstream version. For settings, MCP
servers, hooks, the status line and the instructions block it is the configured value vs the wanted one, so an MCP
entry whose command, args or env differ from the manifest shows as `missing` (`install`/`update` rewrites it).
It does not inspect anything outside those definitions (a plugin's own files, a skill's contents).

### Versions

Every component installed through a package registry -- npm tools, the `npx`/`uvx` launch lines of MCP servers,
`gopls` -- names an exact version in `manifest.json`, so a given installer release installs a known set. `update`
moves a component to that pin (never below a version you moved to yourself); a new installer release moves the
pins, and `update` upgrades the installer first. Agents (Claude Code, Codex) and OS packages follow their own
channels and package managers and are not pinned here.

### caveman runs with the proxy off

`caveman setup --agent-native claude` installs the hooks this installer wants **and** points Claude Code at
caveman's gateway, by writing `env.ANTHROPIC_BASE_URL = <gateway>/w/claude` into `~/.claude/settings.json`.
caveman offers no hooks-only mode. So the installer removes that route again after every setup, and heals it on
any later run: you keep caveman mode, the statusline and the hooks, and Claude Code keeps talking straight to
`api.anthropic.com`.

Why the route is not wanted by default: if the proxy is not running, every request goes to a dead port and Claude
Code cannot reach Anthropic at all; and Remote Control refuses any base URL that is not `api.anthropic.com`. A base
URL you set yourself is never touched — only caveman's own `/w/claude` route is. `doctor` reports an
`ANTHROPIC_BASE_URL` override, and exits 2 when it points at a local proxy with nothing listening.

## Sign-in

As soon as the agents themselves are installed (and before anything that needs them), the installer signs each selected agent in for you: it detects an existing session (`claude auth status` / `codex login status`), and if neither is signed in it opens the vendor's own interactive login and waits for it to finish. On a headless host (no display, SSH, or an LXC container) it falls back to `claude setup-token` / `codex login --device-auth` instead of trying to open a browser. A component that needs an agent that never signed in (for example, a remote Codex plugin catalog that needs a ChatGPT login) is skipped with a one-line reason rather than failing later; those skips are listed as `BLOCKED` in the summary and make the run exit `2`. Pass `--no-login` to skip this phase and sign in yourself afterwards.

## What it manages

See `docs/research/CATALOG.md` for the full ranked catalog and `manifest.json` for the exact components. The installer prompts for API keys only when a selected component needs one, validates them against the provider's API (and reports GitHub PAT scopes) before continuing, then persists them to the OS user environment so every new shell and every agent can see them: on Windows via `[Environment]::SetEnvironmentVariable(name, value, 'User')`; on POSIX in a dedicated `0600` file (`${XDG_CONFIG_HOME:-~/.config}/super-agent-installer/secrets.env`) that `~/.profile`, `~/.bashrc` and `~/.zshrc` source with a guarded line (the latter two when they exist; `~/.zshrc` is created when zsh is your login shell) -- the key value itself is never written into either rc file. Pass `--no-persist-secrets` to keep a key in memory for this run only; the summary then lists the exact `export`/`setx` line for every key the run held, including one it captured itself (a `claude setup-token` token on a headless host), so nothing is silently discarded.

A persisted key is ambient: every process started from a later shell inherits it, including the agents, their MCP
servers, plugins and anything they run. That is what makes the components work (the MCP definitions reference
`${VAR}` and Codex whitelists the variable by name), and it is also the widest trust boundary this tool sets up.
Prefer tokens scoped to what the component needs (a read-only GitHub PAT, a Proxmox API token limited to the
guests it should see) and see [SECURITY.md](SECURITY.md).

## After install

Everything above -- sign-in, key validation and persistence, and installing agent-browser's own CLI -- happens inside the run. What's left is advisory only, and only when it applies: restart any Claude Code session that was already running when the plugin/settings changes landed, and if you enabled the caveman Codex hooks, run `/hooks` once inside Codex to trust them.

## Development

    bun install && bunx vitest run && bunx tsc --noEmit
    bash scripts/build.sh          # binaries in release/
    scripts/release.sh 0.2.0       # bump, tag; push tags to publish
