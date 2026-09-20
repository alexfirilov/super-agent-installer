# Security

super-agent-installer downloads third-party executables, edits the configuration of coding agents, handles API
credentials and installs plugins and MCP servers that can reach infrastructure. This page says what it does with
that trust and how to report a problem.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). Please
do not open a public issue for something exploitable. Include the installer version (`super-agent-installer
--version`), the platform, and the exact command. Reports are acknowledged within a few days; fixes ship as a
release with the finding described in the notes once a fix is available.

## Supported versions

Only the latest release on the `0.x` line receives fixes. `super-agent-installer update` upgrades the installer
itself first, then the components, so staying current is one command.

## What the installer trusts

- **Vendor installers.** Claude Code and Codex are installed with the vendors' own installers (`claude.ai/install.sh`,
  `chatgpt.com/codex/install.sh`, the Windows equivalents, Homebrew casks, Anthropic's signed apt repository on
  root Debian hosts). Node comes from NodeSource (root apt hosts), `fnm`, or the nodejs.org tarball whose SHA-256
  is checked against `SHASUMS256.txt`. Direct-download tool routes (ripgrep, gh on hosts whose repository lacks
  them) verify a checksum before installing; a manifest test enforces that.
- **Package registries.** Tools, MCP servers and CLIs from npm, PyPI (via `uvx`) and the Go module proxy are
  installed at the exact versions named in `manifest.json` (see Versions below). Registry integrity is the
  registry's own; the installer adds no signature checks of its own for these.
- **Plugins and skills.** Claude Code plugins come from the marketplaces the manifest names (the official one plus
  named community marketplaces); Codex plugins from Codex's catalogs. Skills are installed with the `skills` CLI
  after a skills.sh audit; a `fail` verdict blocks the install unless `--no-audit` is passed.
- **The installer itself.** `install.sh` / `install.ps1` download the release binary and `SHA256SUMS` over HTTPS
  only and refuse a checksum mismatch. `self-update` does the same. Binaries are not code-signed or attested yet;
  the checksum protects against corruption and a tampered mirror, not against a compromised GitHub account.

## Secrets

- Keys are asked for interactively, validated against the provider, and never appear in a command line, a log
  line or a process listing (Windows writes go through the child's environment, not argv).
- By default they are persisted to the user environment: on Windows the per-user registry environment, on POSIX a
  `0600` file under `${XDG_CONFIG_HOME:-~/.config}/super-agent-installer/` sourced by the shell rc files. The rc
  files receive only a guarded `source` line, never a value.
- **This is ambient authority.** Every process started from a later shell -- the agents, their MCP servers,
  plugins, and whatever they execute -- can read those variables. The components need it (MCP definitions carry
  `${VAR}` references; Codex whitelists variables by name), so persistence stays the default, with two mitigations:
  `--no-persist-secrets` keeps a key in memory for the run only and prints the export line instead, and
  `uninstall --all` removes the secrets file and the rc lines. Use scoped tokens (read-only GitHub PAT, a Proxmox
  API token limited to the guests it needs, a Home Assistant long-lived token for one user).
- Agent sign-in tokens minted by `claude setup-token` on headless hosts are captured through a private pty log in
  a `0700` temporary directory that is removed afterwards.

## Configuration ownership

- The installer edits only what it owns: marked blocks in `config.toml`, rc files and `CLAUDE.md`/`AGENTS.md`;
  named keys in `settings.json`; MCP entries and the status line by name. Files are written atomically and backed
  up under the state directory first.
- A file that does not parse (`settings.json`, `config.toml`, the state file) is never rewritten: the step fails and
  names the file.
- Software that existed before the first run is adopted, never removed. `uninstall` removes only components the
  state file proves the installer created; unknown provenance is refused unless `--force` names the id. A user's
  own MCP entry or status line that install replaced is restored on uninstall; one edited afterwards is left alone.

## Versions

Every registry-installed component is pinned in `manifest.json` to a version that was current when the release
was cut. `update` moves a component to that pin, never below a version you moved to yourself. Pins move with
installer releases, so upgrading the installer is how the component set advances. Agents and OS packages follow
their own channels and package managers.

## Blast radius

On a Proxmox host, or as root anywhere, the agents can do whatever that account can. The installer warns at the
start of every run there and does not block; the recommendation is a dedicated management VM or container.
