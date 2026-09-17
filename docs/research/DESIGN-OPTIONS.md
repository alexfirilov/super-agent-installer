# Design options and decisions for the installer (2026-09-17)

Companion to `CATALOG.md`. Facts below are verified in `docs/research/reports/` (gap-2 idempotency matrix, gap-3 version probes, gap-4 Windows parity, gap-5 config writes, gap-6 Proxmox/LXC/fleet, gap-8 manifest and conflicts).

## 1. Facts that constrain the design

**The vendors already ship the hard parts.** Both official installers are self-contained (Claude: thin bootstrap that verifies SHA-256 from a signed manifest, then runs `claude install`; Codex: 1,209-line POSIX sh + 1,089-line PowerShell twin, verifies `codex-package_SHA256SUMS`). Neither agent needs Node at runtime. `claude update` and `codex update` exist. The installer should orchestrate, not reimplement.

**No update-all exists for Claude plugins**: `claude plugin update` takes one plugin; loop over `claude plugin list --json`. Third-party marketplaces (caveman) have auto-update off. Codex has no `plugin update` at all: `codex plugin marketplace upgrade` refreshes git snapshots, then `codex plugin add` again re-copies (verified: re-add always overwrites).

**Idempotency traps** (all verified on 2.1.273/2.1.274 and 0.154.0): `claude mcp add` with an existing name exits 1 (upsert = remove then add); `codex mcp add` silently replaces the whole TOML table and drops extra keys; `codex mcp add --url` can start a blocking OAuth browser flow unless `--bearer-token-env-var` is given; `claude plugin marketplace remove` uninstalls that marketplace's plugins; `claude update` under a lock held by another session silently no-ops with exit 0; a duplicate TOML table breaks every codex command.

**Declarative provisioning of plugins is unreliable.** Setting `enabledPlugins` + `extraKnownMarketplaces` in settings.json does not reliably install external plugins on a new machine (v2.1.195+ consent rules). Use the CLI explicitly.

**Config surfaces the installer touches:**

| File | Owner | Safe write path |
|---|---|---|
| `~/.claude/settings.json` | hooks, statusLine, enabledPlugins, env, model, autoUpdatesChannel | jq (POSIX) / PowerShell 5.1-safe script (Windows): backup, merge in memory, dedupe hooks, temp+rename, keep 0600 and LF |
| `~/.claude.json` | MCP servers (user/local), trust, onboarding | never hand-edit (rewritten every ~60 s); use `claude mcp add/add-json/remove -s user`; only seed `hasCompletedOnboarding` / `hasTrustDialogAccepted` when the file is absent (headless) |
| `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` | global instructions | marker-block managed section |
| `~/.codex/config.toml` | model, features, mcp_servers, marketplaces, plugins, projects trust | `codex mcp add`, `codex plugin ...`, `codex features enable` for their keys; other keys via `yq -p toml -o toml` or marker block; validate with `codex doctor --json` (`checks[].id == "config.load"`) |
| `~/.codex/hooks.json` | hooks | one writer (caveman or installer) |
| `~/.agents/skills` + `~/.agents/.skill-lock.json` | skills CLI | never touch directly |

**Windows specifics:** PowerShell 5.1 is the floor unless PS7 is installed first; `Invoke-WebRequest` without `-UseBasicParsing` prompts since CVE-2025-54100 (Claude's own bootstrap.ps1 lacks it; Codex's has it; mitigations: pwsh 7, winget, or the CMD installer); winget is absent on Server 2019/2022 (bootstrap via `Repair-WinGetPackageManager` or scoop); Codex on winget/scoop cannot `codex update` (exit 1); stdio MCP `npx` needs `cmd /c` written explicitly (or `node cli.js`); typescript-lsp hits a .cmd shim spawn bug on native Windows; skills CLI uses junctions with copy fallback (`--copy`); Codex hooks run via `cmd.exe /C` with `commandWindows`; caveman docs say caveman's Codex hooks are disabled on Windows.

**Proxmox / LXC / VMs / root:** Claude's install.sh refuses `sudo` from a user (needs `CLAUDE_INSTALL_ALLOW_SUDO=1`) but plain root is fine; the signed apt repo is the better fit for Debian-13 Proxmox nodes. Claude Code needs AVX: Proxmox `kvm64`, `x86-64-v2`, `x86-64-v2-AES` (UI default) crash with Illegal instruction; use `qm set <vmid> --cpu x86-64-v3` or `host`. Codex sandbox = bubblewrap + user namespaces: unprivileged LXC needs `pct set <id> --features nesting=1,keyctl=1`; Docker default fails; escape hatch `sandbox_mode = "danger-full-access"`. `codex doctor --json` reports sandbox ok even when bwrap cannot work: probe with `codex sandbox -- /bin/true`. Headless seeding that works: Codex `cli_auth_credentials_store = "file"` + copied `~/.codex/auth.json` (0600) or `codex login --device-auth`; Claude `claude setup-token` -> `CLAUDE_CODE_OAUTH_TOKEN` (1 year, subscription only) + `~/.claude.json` `{"hasCompletedOnboarding": true, "projects": {"/root": {"hasTrustDialogAccepted": true}}}`. Fleet: `pct exec <vmid> -- bash -lc '...'`, `pct push --perms 0600`, `qm guest exec`, cloud-init `runcmd`, Ansible `shell` with `creates:`.

**Security floor:** download to file, verify, then execute; pin the installer to a tag + sha256; `set -euo pipefail`, `umask 077`; allowlist plugin/skill sources; audit-gate skills through `https://skills.sh/api/v1/skills/audit/{owner}/{repo}/{skill}`; npm >= 12 with `min-release-age`; never write API keys into `~/.claude.json`; secrets via env file 0600 or OS keychain (Linux `secret-tool` if Secret Service exists, Windows DPAPI `ConvertFrom-SecureString`, macOS `security add-generic-password`); 1Password `op run` / Bitwarden `bws run` as optional injectors.

## 2. Architecture options

| Option | Bootstrap on bare Windows Server 2022 | Bootstrap on bare Debian container | Picker quality | Logic duplication | Self-update | Testability | Verdict |
|---|---|---|---|---|---|---|---|
| A. Twin scripts `install.sh` + `install.ps1` sharing `manifest.json` | PS 5.1 only (no deps) | bash + curl + jq | plain menus (or gum if fetched) | 2x (Codex's 2,300-line pair is the cautionary tale) | curl new version + sha256 + replace | bats + Pester + shellcheck + PSScriptAnalyzer | good if kept thin and data-driven |
| B. Thin twin bootstrap + one TypeScript core (`@clack/prompts`), shipped as bun-compiled binaries on GitHub Releases plus npm (`npx` fallback) | bootstrap downloads one .exe | bootstrap downloads one binary | best (multiselect with initialValues, spinners) | 1x | replace-executable (chezmoi style) | vitest + the same shell tests for bootstrap | recommended |
| C. Go binary (`huh` + goreleaser) or Rust (`dialoguer`/`ratatui`) | one .exe | one binary | excellent | 1x | replace-executable | Go/Rust tests | equal to B but a new toolchain; B fits since Node is needed anyway for skills CLI and npm MCPs |
| D. Python + uv (`uv run --script`, questionary/textual) | must install uv first (`irm https://astral.sh/uv/install.ps1 \| iex`) | must install uv first | good | 1x | `uv tool upgrade` | pytest | heavier bootstrap |
| E. gum-driven bash/pwsh | must fetch gum.exe first | must fetch gum | good (`gum choose --no-limit --selected '*'`) | 2x | curl + replace | bats/Pester | fastest to ship; still 2x logic |

Precedents worth cribbing: Claude Code's own thin bootstrap scripts (SHA-256 from a signed manifest, then delegate to the binary); rustup/uv/mise `self update` semantics; chezmoi's `upgrade` method detection (brew vs replace-executable vs package); kasetto's `kasetto.yaml` + lock + `extends:` remote config; devcontainer-feature.json's option schema (id, options, dependsOn, installsAfter, deprecated, legacyIds); `~/.claude/plugins/installed_plugins.json` (v2) and `~/.agents/.skill-lock.json` (v3) as state-file shapes; Omakub's gum picker; narze/aiupdate's concurrent update loop; skills CLI's `--json` outputs.

**Recommendation:** Option B, with Option A's twin bootstrap kept intentionally thin (~150 lines each): detect OS/arch, ensure curl/tar, download the pinned core binary (or fall back to `npx <pkg>@<version>` when Node exists), verify sha256, exec it with the user's flags. The core owns the manifest, picker, idempotent provisioning, state file, drift report, self-update and uninstall. If you prefer zero toolchain and accept a plainer picker, Option A alone is viable because every heavy action is a vendor CLI call anyway.

## 3. Proposed shape (for approval)

**Manifest** (`manifest.json`, one entry per component; gap-8 already drafted 95 entries): `id`, `kind` (agent | plugin | skill | mcp | tool | setting | proxy | statusline | hook), `agents` (claude | codex | both), `platforms`, `prerequisites`, `dependsOn`, `conflictsWith`, `slot`, `defaultSelected`, `forceOffInAll`, `contextCostTokens`, `install` (per platform, per agent), `update`, `versionProbe` (installed + latest), `uninstall`, `secrets` (env var names to prompt for), `audit` (skills.sh owner/repo/skill), `postInstallHint`.

**Profiles:** `all` (everything defaultSelected, forceOff respected), `minimal` (agents + superpowers + caveman + context7 + find-skills), `claude-only`, `codex-only`, `work` (no personal MCPs/skills, no proxies, no pentest packs), `homelab` (adds proxmox-admin, HA, docker gateway, k8s, portainer, truenas), `proxmox-host` (root, apt repo, no browser MCPs, headless auth). Profiles are named selections over the manifest; a saved selection per host is another profile.

**Flow (interactive):** detect (OS, arch, root/sudo, package manager, Node/uv/git, existing agents and versions, existing plugins/skills/MCPs, AVX, bwrap) -> choose profile -> per-category multiselect pre-filled from the profile (agents, plugins, skills, MCP, tools, settings) with live token-cost total and conflict resolution prompts -> secrets prompts (skippable, env-file or keychain) -> plan preview (what changes, versions) -> execute with per-step results -> post-install (login prompts, `/hooks` trust reminder for Codex, restart note) -> write host state file.

**Flow (non-interactive):** `--yes --profile homelab`, `--only id,id`, `--skip id`, `--update`, `--check` (drift report only), `--dry-run`, `--uninstall [id]`, `--from-state` (replay saved selection), `--secrets-file`, `--no-self-update`, `--json`.

**Update sequence (verified order):** self-update -> `claude plugin marketplace update` + `codex plugin marketplace upgrade` -> per-plugin `claude plugin update` loop and Codex `plugin add` loop -> MCP upsert (remove+add on Claude; add with bearer var on Codex) -> `npx skills update -g -y` -> `claude update` / `codex update` (winget/brew/apt fallbacks, report when the package manager owns the agent) -> caveman CLI update + `caveman setup --agent-native claude|codex` -> language servers and tools -> drift report. Refuse to run while a `claude` session holds the update lock.

**State:** `~/.config/<name>/state.json` (Windows `%APPDATA%\<name>\state.json`): selection, profile, per-component installed version + timestamp, secrets location, last update. Never stores secrets.

**Testing:** shellcheck + bats for the sh bootstrap; PSScriptAnalyzer + Pester for the ps1 bootstrap (run under both `powershell` 5.1 and `pwsh`); vitest for the core; Docker matrix (debian:13, ubuntu:24.04, alpine:3.21, fedora:42, arch, arm64 variants) running the full non-interactive install with throwaway `CLAUDE_CONFIG_DIR`/`CODEX_HOME`; GitHub Actions `windows-latest` (Server 2025) and `windows-2022` (no winget); optional Windows Sandbox script.

## 4. Decisions needed (with recommended defaults)

| # | Question | Options | Recommended |
|---|---|---|---|
| Q1 | Architecture | A twin scripts / B thin bootstrap + TS core binary / C Go / D Python+uv / E gum scripts | B |
| Q2 | Distribution | public GitHub repo (one-liners `curl ... \| bash`, `irm ... \| iex`, releases with sha256) vs private repo with token | public repo, no secrets inside; private overlay file for personal selections |
| Q3 | Windows floor | PowerShell 5.1 compatible bootstrap vs require PS7 (install it first) | 5.1-safe bootstrap that offers to install PS7 |
| Q4 | Default install channel for Claude Code | latest vs stable; auto-update on or off | latest on desktops, stable on servers/Proxmox; auto-update on (Claude) and `codex update` via the installer's update flow |
| Q5 | statusLine owner | caveman statusline (current) / claude-hud / ccusage / none | keep caveman on hosts with the proxy; claude-hud elsewhere |
| Q6 | caveman depth | plugin + skills only / plus CLI hooks (current) / plus agent-native Codex proxy | plugin + CLI hooks on Claude; skills only on Codex; proxy opt-in |
| Q7 | Prune installed plugins | remove code-review duplicate, code-simplifier, ralph-loop, claude-code-setup (built-ins cover them); disable plugin-dev and pr-review-toolkit globally; LSP plugins: install binaries or drop | prune as listed; keep typescript-lsp + pyright-lsp with binaries, drop gopls unless you write Go |
| Q8 | Memory | built-in auto memory only / add remember (78 tokens) / claude-mem | built-in only; Codex `memories = true` |
| Q9 | Codex MCP set | context7 + playwright MCP / context7 + Playwright CLI skills / add exa, github readonly | context7 + Playwright CLI skills + exa; cap 5 |
| Q10 | Secrets | env file 0600 / OS keychain / prompt every time / 1Password `op run` | env file by default, keychain where available, `op run` optional |
| Q11 | Other agents as optional components | none / OpenCode only / OpenCode + Pi + Copilot CLI + Antigravity | OpenCode only, off by default |
| Q12 | Homelab set default | off / on for `homelab` profile only | on in `homelab` and `proxmox-host` profiles only |
| Q13 | Language servers | which languages: TypeScript, Python, Go, Rust, others | TypeScript + Python default; Go/Rust selectable |
| Q14 | Global instructions | installer manages a marker block in `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` (shared content) | yes, opt-in section |
| Q15 | Node strategy | fnm (desktops) / NodeSource (root servers) / distro packages / winget LTS | fnm on desktops, NodeSource on root servers, winget LTS on Windows |
| Q16 | Name of the project | your call | |
| Q17 | macOS support now | yes (brew casks) / later | later, but keep the manifest platform-aware |
| Q18 | Telemetry / audits | skills.sh audit gate: block on `fail` or warn only | block on `fail`, warn on `warn`, `--no-audit` override |
