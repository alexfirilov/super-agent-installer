# super-agent-installer

One command that installs and updates Claude Code, Codex CLI, and the plugins, skills, MCP servers and settings you want on every host: Linux, Windows and macOS.

## Install

Linux / macOS / WSL:

    curl -fsSL https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.5.1/install.sh | bash

Windows (PowerShell 5.1 or 7):

    irm https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.5.1/install.ps1 | iex

Unattended:

    curl -fsSL .../install.sh | bash -s -- --yes
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.5.1/install.ps1))) --yes

## Commands

    super-agent-installer            interactive picker (starts from this host's saved choices, else the defaults)
    super-agent-installer update     update the installer, then everything selected on this host, in one run
    super-agent-installer check      drift report (exit 2 when something is outdated, missing or not as configured)
    super-agent-installer list       all components with verdicts and token costs
    super-agent-installer doctor     host diagnostics plus claude doctor / codex doctor
    super-agent-installer self-update   update the installer binary only
    super-agent-installer uninstall <id...>   remove named components (only ones it installed)
    super-agent-installer uninstall --all      remove every component it installed on this host

Flags: --only a,b, --skip c, --yes, --dry-run, --json, --no-audit, --channel latest|stable, --cooldown <days>, --manifest <path|url>, --offline, --from-state, --no-self-update, --no-login, --no-persist-secrets, --elevate, --all, --force.

Exit codes, every command: `0` done, `1` a step failed, `2` nothing failed but requested work could not be completed
(a component blocked on an agent that never signed in; drift for `check`; a dead proxy route for `doctor`),
`3` a terminal is needed, `4` unsupported host. Automation should treat anything but `0` as "not converged".

- `--no-login` skips the sign-in phase entirely (see below); use it on a host with no browser, or when you already manage auth yourself.
- `--no-persist-secrets` leaves pasted API keys in memory for this run only, instead of saving them to the user environment (see [SECURITY.md](SECURITY.md) for what persistence exposes).
- `--channel` is remembered: `install --channel stable` makes every later bare `update`/`check` use `stable` until
  you pass `--channel` again. Without a flag or a saved channel, `latest` applies.
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

`check` (and the table at the end of `update`) compares each selected component with the manifest. For tools
and agents that is presence plus version: installed vs the pinned or upstream version. For skills it is what
`skills check` reports upstream. Claude plugins mostly declare no comparable version, so they show `unknown`; `update`
refreshes them regardless. For settings, MCP
servers, hooks, the status line and the instructions block it is the configured value vs the wanted one, so an MCP
entry whose command, args (including the resolved package version) or env differ from the manifest shows as
`outdated` (`install`/`update` rewrites it).
It does not inspect anything outside those definitions (a plugin's own files, a skill's contents). A component dropped
from the catalog but still on this host shows as `outdated` until `update` removes it.

### Catalog and versions

The binary is the engine; *what* it installs comes from the catalog, `manifest.json` on this repository's default
branch. Every `install`, `update`, `check` and `list` fetches it, so adding, dropping or swapping a skill, plugin or
MCP server is a commit here, not a new release. The last fetched copy is cached (`catalog.json` in the state dir),
and the copy bundled into the binary is the final fallback. A catalog that declares a newer `minInstallerVersion`
than the running binary, or that this binary cannot parse, is skipped with a warning to run `self-update`.
`--manifest <path|url>` uses another catalog; `--offline` uses the cache (else the bundled copy) and does no lookups.

Every package installed or launched through a registry -- npm tools, the `npx`/`uvx` launch lines of MCP servers,
`gopls` -- is written in the catalog as `pkg@{{version}}` with a `versions` entry naming the registry, the package
and a known-good `pin`. The version is decided at run time and then written out exactly (`n8n-mcp@2.92.1`), so the
agents never launch a floating `@latest`, and `check` and uninstall can tell what is on the host:

| Channel | Version installed |
|---|---|
| `latest` (default) | the newest release on npm / PyPI / the Go proxy that is at least `--cooldown` days old, never below the pin |
| `stable` (`--channel stable`) | exactly the catalog pin |

The cooldown is asked once (3 days or 0) and saved per host, like the channel; `--cooldown <days>` overrides it,
and an unattended run without a saved choice uses 3. A delay of a few days skips most hijacked releases, which are
usually caught and pulled within hours. A `versions` entry can hold a component on one major version (`"major": 1`)
until the installer is verified against the next. If a registry cannot be reached, the pin is used and the run says
so. Agents (Claude Code, Codex) and OS packages follow their own channels and package managers.

Plugins and skills track upstream with no cooldown. Both `install` and `update` refresh them, so re-running either one
converges on the newest version. Skills update by name, so a skill you added yourself stays yours to update, and each
update passes the same skills.sh audit as a first install: a failed audit keeps the version you have.

### Components dropped from the catalog

The catalog's `retired` list names components it no longer ships. `install` and `update` remove one before anything else
when this host's saved selection has it. Agent configuration (plugins, skills, MCP servers, hooks, settings) goes even if
it was already on the host when the installer adopted it. Tools and agents go only if the installer's record proves it
installed them; otherwise they stay on the host and simply stop being managed. `replacedBy` moves the selection to the
successor, and a removal that fails is retried on the next run. `--dry-run` lists what would go.

## Sign-in

As soon as the agents themselves are installed (and before anything that needs them), the installer signs each selected agent in for you: it detects an existing session (`claude auth status` / `codex login status`), and if neither is signed in it opens the vendor's own interactive login and waits for it to finish. On a headless host (no display, SSH, or an LXC container) it falls back to `claude setup-token` / `codex login --device-auth` instead of trying to open a browser. A component that needs an agent that never signed in (for example, a remote Codex plugin catalog that needs a ChatGPT login) is skipped with a one-line reason rather than failing later; those skips are listed as `BLOCKED` in the summary and make the run exit `2`. Pass `--no-login` to skip this phase and sign in yourself afterwards.

## What it manages

Run `super-agent-installer list` for what this host can install, or read `manifest.json`. The installer prompts for API keys only when a selected component needs one, validates them against the provider's API (and reports GitHub PAT scopes) before continuing, then persists them to the OS user environment so every new shell and every agent can see them: on Windows via `[Environment]::SetEnvironmentVariable(name, value, 'User')`; on POSIX in a dedicated `0600` file (`${XDG_CONFIG_HOME:-~/.config}/super-agent-installer/secrets.env`) that `~/.profile`, `~/.bashrc` and `~/.zshrc` source with a guarded line (the latter two when they exist; `~/.zshrc` is created when zsh is your login shell) -- the key value itself is never written into either rc file. Pass `--no-persist-secrets` to keep a key in memory for this run only; the summary then lists the exact `export`/`setx` line for every key the run held, including one it captured itself (a `claude setup-token` token on a headless host), so nothing is silently discarded.

A persisted key is ambient: every process started from a later shell inherits it, including the agents, their MCP
servers, plugins and anything they run. That is what makes the components work (the MCP definitions reference
`${VAR}` and Codex whitelists the variable by name), and it is also the widest trust boundary this tool sets up.
Prefer tokens scoped to what the component needs (a read-only GitHub PAT, a Proxmox API token limited to the
guests it should see) and see [SECURITY.md](SECURITY.md).

## After install

Everything above -- sign-in, key validation and persistence -- happens inside the run. What's left is advisory only, and only when it applies: restart any Claude Code session that was already running when the plugin/settings changes landed.

## Development

    bun install && bunx vitest run && bunx tsc --noEmit
    bash scripts/build.sh          # binaries in release/
    scripts/release.sh 0.2.0       # bump, tag; push tags to publish
