# Installer architecture options for the "ultimate AI coding agent installer" (as of 2026-09-16)

Scope: how to structure a cross-platform (Linux + Windows, macOS nice-to-have), interactive, self-updating
"install + update" script that (1) installs Claude Code and Codex CLI via their official native paths,
(2) installs plugins / skills / MCP servers / settings for both agents from a declarative manifest,
(3) offers an interactive picker (default = everything) plus non-interactive flags, and (4) updates itself.

All numbers below were observed on 2026-09-16 and re-verified on 2026-09-17 (see "## Verification" at the end; corrected values are marked [verified 2026-09-17]) (GitHub star counts scraped from repo pages; npm weekly
downloads from api.npmjs.org; versions from registry/PyPI/GitHub release feeds). Every install command is
copied from a fetched source (linked in the Sources section).

---

## 0. Ground truth that constrains the design

### 0.1 What the two official installers actually are

| | Claude Code | Codex CLI |
|---|---|---|
| Official one-liner (Linux/macOS/WSL) | `curl -fsSL https://claude.ai/install.sh \| bash` | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` |
| Official one-liner (Windows) | `irm https://claude.ai/install.ps1 \| iex` (PowerShell) / `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` (CMD) | `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 \| iex"` |
| Pin a version | `curl -fsSL https://claude.ai/install.sh \| bash -s 2.1.89` / `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) 2.1.89` ; channels `stable`/`latest` | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh -s -- --release VERSION` (`Usage: install.sh [--release VERSION]`) or env `CODEX_RELEASE` |
| Non-interactive | install.sh has no prompts (delegates to `claude install`); native install auto-updates in background | `CODEX_NON_INTERACTIVE=1` ("Set to 1, true, or yes to skip prompts") — otherwise the script asks "Start Codex now?" and "Uninstall the existing npm-managed Codex now?" |
| Mirror / air-gap knobs | none in install.sh (hard-coded `https://downloads.claude.ai/claude-code-releases`); apt/dnf/apk repos exist and can be mirrored | `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM=false` forces GitHub Releases; `CODEX_INSTALL_DIR`, `CODEX_HOME` |
| Integrity | `manifest.json` per version with SHA256 per platform (install.sh/ps1 only check SHA256; they do **not** run gpg — signature verification is a separate manual procedure; install.sh additionally prefers `manifest.zst.json` + `claude.zst` when `zstd` is present, falling back to the raw binary) [verified 2026-09-17], GPG-signed manifest from 2.1.89 (`gpg --verify manifest.json.sig manifest.json`, key fingerprint `31DD DE24 DDFA B679 F42D 7BD2 BAA9 29FF 1A7E CACE`) | `codex-package_SHA256SUMS` asset + GitHub release-asset `sha256:` digests; ps1 verifies with `Get-FileHash` |
| Script shape | **thin bootstrap**: 260-line bash / 110-line ps1 / 256-line cmd. They only detect platform, fetch version + manifest, verify SHA256, then run `"$binary_path" install [target]` — the binary itself does launcher/PATH/shell integration | **fat twin scripts**: 1209-line POSIX `sh` + 1089-line ps1 with duplicated logic (release resolution, checksum, staging dir + `current` link, PATH block with begin/end markers, install lock, conflict detection for npm/brew/bun installs) |
| Built-in updater | `claude update` (alias `upgrade`); `autoUpdatesChannel` `latest`/`stable`; `minimumVersion` floor; `DISABLE_AUTOUPDATER=1` (bg check only) vs `DISABLE_UPDATES` (blocks manual too) | `codex update` ("Update Codex to the latest version"); Codex `in_app_updates` feature flag |
| Other install paths | `brew install --cask claude-code` / `claude-code@latest`; `winget install Anthropic.ClaudeCode`; apt/dnf/apk signed repos; `npm install -g @anthropic-ai/claude-code` (Node 22+, downloads native binary) | `npm install -g @openai/codex`; `brew install --cask codex`; GitHub Releases tarballs (`codex-x86_64-unknown-linux-musl.tar.gz` etc.); DotSlash file; winget id `OpenAI.Codex` exists in winget-pkgs |
| Uninstall | `rm -f ~/.local/bin/claude` + `rm -rf ~/.local/share/claude` / `Remove-Item -Path "$env:USERPROFILE\.local\bin\claude.exe" -Force` + `Remove-Item -Path "$env:USERPROFILE\.local\share\claude" -Recurse -Force` [verified 2026-09-17] | not documented on the fetched page (binary in `~/.local/bin/codex`, packages in `~/.codex/packages/standalone`) |

Local check (read-only `--help`): `claude` exposes `install [target]`, `update|upgrade`, `doctor`, `plugin {install|uninstall|update|list --json|enable|disable|marketplace {add|remove|update|list}}`, `mcp {add|add-json|...}`; `codex` exposes `update`, `doctor`, `plugin {add|remove|list|marketplace}`, `mcp {add|remove|list|get|login}`, `-c key=value` config overrides.
`claude plugin install` has `-s/--scope user|project|local`, `--json`, `--config key=value`, and `--accept-command <sha256>` for non-interactive acceptance of marketplace-declared commands.

**Design consequence:** the installer never needs to reimplement agent installation. It shells out to the official
scripts (pinning the version/channel) and to `claude plugin/mcp` and `codex plugin/mcp` subcommands. What it must
own is: orchestration, the manifest, the picker, the host state file, settings merges (JSON for Claude, TOML for
Codex), secrets, logging and self-update.

### 0.2 Real state files you can crib the schema from (found on this machine)

- Claude plugins: `~/.claude/plugins/installed_plugins.json` → `{ "version": 2, "plugins": { "superpowers@claude-plugins-official": [ { "scope": "user", "installPath": "...", "version": "6.3.0", "installedAt": "...", "lastUpdated": "...", "gitCommitSha": "..." } ] } }` plus `known_marketplaces.json`, `plugin-catalog-cache.json`.
- skills CLI: `~/.agents/.skill-lock.json` → `{ "version": 3, "skills": { "<name>": { "source": "JuliusBrussee/caveman", "sourceType": "github", "sourceUrl": "...git", "skillPath": "skills/<name>/SKILL.md", "skillFolderHash": "<sha1>", "installedAt": "...", "updatedAt": "..." } } }`.

### 0.3 Bare-host bootstrap facts

- **Windows Server**: Windows PowerShell 5.1 is "installed by default on Windows"; PowerShell 7 installs side-by-side (`winget install --id Microsoft.PowerShell --source winget` or MSI `msiexec.exe /package PowerShell-7.6.6-win-x64.msi /quiet ADD_PATH=1 ...`). **"winget isn't available on Windows Server 2022 or earlier versions. Windows Server 2025 includes winget for Windows Server with Desktop Experience only."** → do not depend on winget for bootstrap. `curl.exe` and `tar.exe` ship with Windows 10 Insider build 17063+ (MS devblog "Tar and Curl Come to Windows!"); the devblog does not name Windows Server 2019 explicitly — Server 2019 is build 17763 and Microsoft Q&A pages discuss the built-in `%WinDir%\System32\curl.exe` on Server 2019, and Codex's install.ps1 relies on built-in `tar -xzf` [verified 2026-09-17, medium confidence for the Server statement]. Claude's install.ps1 and Codex's install.ps1 both run under 5.1 primitives (`Invoke-RestMethod`, `Invoke-WebRequest`, `Get-FileHash`, `Expand-Archive`).
- **Bare Debian container**: Claude docs note fresh Debian/Ubuntu may lack `curl` and `gnupg` (`sudo apt install curl gnupg`); Alpine needs `apk add bash curl libgcc libstdc++ ripgrep`. Codex install.sh is POSIX `sh` (dash-safe); Claude's is bash; rustup's is `#!/bin/sh` dash-compatible.
- **Node**: Claude Code and Codex native installs do **not** need Node. Node is only needed for `npx skills`, `npx @playwright/mcp`, `npx claude-code-templates`, and any npm-based MCP server. Official nodejs.org snippets: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash` then `nvm install 24`; `curl -o- https://fnm.vercel.app/install | bash` / `winget install Schniz.fnm` then `fnm install 24`; `brew install node@24`; `choco install nodejs --version=...`. LTS shown on nodejs.org/download: v24.21.0 (2026-09-16). winget id `OpenJS.NodeJS.LTS` exists.
- **Other winget ids verified present in microsoft/winget-pkgs**: `jqlang.jq`, `MikeFarah.yq`, `charmbracelet.gum`, `astral-sh.uv`, `Anthropic.ClaudeCode`, `OpenAI.Codex`, `Git.Git`, `Microsoft.PowerShell`, `jdx.mise`, `Schniz.fnm`, `twpayne.chezmoi`.

---

## 1. Option comparison

### Option A — twin scripts `install.sh` + `install.ps1` + shared `components.json`

**Precedents (fetched):**

| Project | Shape | Notes |
|---|---|---|
| Claude Code (`claude.ai/install.sh` / `.ps1` / `.cmd`) | thin twin bootstrap → binary does the work | 260 / 110 / 256 lines; SHA256 from `manifest.json`; `bash -s stable|latest|X.Y.Z`; ps1 `param([ValidatePattern('^(stable|latest|\d+\.\d+\.\d+(-[^\s]+)?)$')] $Target)` |
| Codex CLI (`chatgpt.com/codex/install.sh` / `.ps1`) | fat twin scripts, logic duplicated | 1209 / 1089 lines; env-driven (`CODEX_RELEASE`, `CODEX_NON_INTERACTIVE`, `CODEX_INSTALL_DIR`); staging dir + `current` link; PATH block with begin/end markers; install lock; conflict detection |
| rustup (`sh.rustup.rs`, 930 lines) | thin bootstrap → `rustup-init` binary | `-y`, `--no-modify-path`, `--default-toolchain`, `--profile`; `RUSTUP_UPDATE_ROOT` mirror; errs "Unable to run interactively. Run with -y" when no TTY |
| uv (`astral.sh/uv/install.sh` 2191 lines, `install.ps1` 676 lines) | **generated by cargo-dist**, checksums baked in per target | `INSTALLER_DOWNLOAD_URL` mirror, `UV_NO_MODIFY_PATH`, `UV_UNMANAGED_INSTALL`, `INSTALLER_PRINT_VERBOSE/QUIET`; pin by URL `https://astral.sh/uv/0.12.15/install.sh` |
| deno (`deno.land/install.sh` 116 lines, `install.ps1` 52 lines) | minimal twin; "Keep this script simple and easily auditable" | ps1 sets user PATH via `[Environment]::SetEnvironmentVariable('Path', ..., 'User')`; version as positional arg |
| bun (`bun.sh/install` 326 lines, `install.ps1` 319 lines) | twin, hand-written | |
| chezmoi (`get.chezmoi.io` 375 lines, `get.chezmoi.io/ps1` 276 lines) | twin, generated by godownloader-style template | `sh -c "$(curl -fsLS get.chezmoi.io)" -- -b $HOME/.local/bin`, `-- init --apply $GITHUB_USERNAME`; cosign-signed checksums |
| starship (`starship.rs/install.sh` 554 lines) | sh only, no ps1 (Windows via winget/scoop) | |
| oh-my-zsh (`tools/install.sh` 604 lines) | sh only; `--unattended`, `--keep-zshrc`, env `CHSH/RUNZSH/KEEP_ZSHRC/REMOTE/BRANCH` | git-clone based; `omz update` = `git pull --rebase` with cooldown |
| Omakub (basecamp, 8,094 stars, last commit 2026-03-07) | bash + gum, Ubuntu only | `gum choose "${OPTIONAL_APPS[@]}" --no-limit --selected $DEFAULT_OPTIONAL_APPS --header "..."`; installs gum from a pinned `.deb` first |
| Omarchy (basecamp, 41,523 stars, last commit 2026-09-16, v4.0.4) | bash; `omarchy-update [-y]`, `omarchy-migrate --pending` | `-y` documented as "a promise not to ask anything"; logs via `script -qefc ... /tmp/omarchy-update.log`; update lock; snapshot before update |

**Pros**
- Zero runtime on both platforms: bash (Linux/macOS/WSL/Git-Bash) and Windows PowerShell 5.1 are present on every target, including Windows Server 2019/2022 where winget is absent.
- Exactly the pattern both vendors use for their own installers; auditable by `curl | less`.
- Trivial air-gap story: copy two files + manifest.

**Cons**
- Two implementations of every feature (JSON/TOML merge, picker, state file, logging, secrets, self-update). Codex's pair shows the cost: ~2,300 lines and every fix landed twice.
- Interactivity: bash has no multiselect without a helper (`gum`, `fzf`, `whiptail`/`dialog`); PowerShell has `Out-GridView`/`Read-Host`/`$host.UI.PromptForChoice` only. A consistent picker means bundling/downloading `gum` on both (gum ships Windows binaries and `winget install charmbracelet.gum` / `scoop install charm-gum`).
- TOML editing for Codex `~/.codex/config.toml` from bash needs `yq` (supports TOML in and out: `yq -o toml`), Python 3.11+ `tomllib` (read only) or careful sed; from PowerShell there is no built-in TOML parser.
- Testability is fair (bats-core 6,265 stars, v1.14.0; Pester 3,340 stars, v6.2.0; shellcheck 40,045 stars, v0.11.0) but you need both suites and a Windows CI runner.

**How to keep the two in sync**
1. Put all *data* in `components.json` (schema in §2). Scripts contain only a generic executor: for each selected component run `check`, then `install`/`update` command strings keyed by platform. Component-specific knowledge never lives in script code.
2. Generate both scripts from one source (cargo-dist does exactly this for uv: the 2,191-line sh and 676-line ps1 are emitted from Rust templates with checksums baked in). If you don't want Rust, a small Python/Node generator that renders `install.sh.j2` and `install.ps1.j2` from the manifest gives the same effect.
3. Shared golden tests: one JSON fixture set, run through bats and Pester, compare produced state files.
4. Keep the twin scripts *thin* (Claude Code style): resolve platform → download pinned artifact → verify SHA256 → exec the real tool. Then most logic lives once (Option B/C).

### Option B — thin bootstrap installs Node, then one TypeScript CLI (`npx <pkg>` or single-file binary)

**Precedents (fetched):**

| Project | Stars (2026-09-16) | Last release / commit | Runtime deps | Prompt lib | Notes |
|---|---|---|---|---|---|
| vercel-labs/skills (`npx skills`) | 31,818 | v1.6.0 / 2026-09-16 (npm `skills` 1.6.0) [verified 2026-09-17]; 4,621,540 npm dl/week | only `tar`, `yaml` (560 KB unpacked); Node `>=22.20.0` | custom | `npx skills add owner/repo --skill X -g -a claude-code -a codex -y`, `npx skills update -g -y`, `npx skills list`, `--copy` vs symlink; writes `~/.agents/.skill-lock.json` v3; Codex global dir `~/.codex/skills/`, Claude `~/.claude/skills/` |
| davila7/claude-code-templates (`npx claude-code-templates@latest`) | 30,762 | v1.29.6 / 2026-09-17 (npm 1.29.6) [verified 2026-09-17]; 1,736 npm dl/week | 18 deps incl. `@clack/prompts`, `inquirer`, `express`, `@supabase/supabase-js` (2.5 MB) | clack + inquirer | flags `--agent`, `--command`, `--mcp`, `--setting`, `--hook`, `--skill`, `--plugins`, `--yes`, `--health-check`; **has anonymous tracking to Supabase, opt-out via `CCT_NO_TRACKING=true` / `CCT_NO_ANALYTICS=true` / `CI=true`** (cli-tool/src/tracking-service.js) |
| smithery-ai/cli (`smithery`) | 834 | v1.2.0 / 2026-05-31; npm `smithery` 793 dl/week (the 4,707 dl/week figure belongs to the legacy package `@smithery/cli` 4.11.1) [verified 2026-09-17] | Node 20+ | — | pivoted to registry/auth/tool-calling (`smithery mcp add <url>`, `smithery tool call`); README points skill installs at the upstream `npx skills add <skill>` but its examples also show `smithery skill add anthropics/frontend-design --agent claude-code`. Not an MCP-into-client installer any more. |
| @clack/prompts | 8,054 (bombshell-dev/clack) | 1.8.1 / 2026-09-13; 18,255,406 dl/week | Node `>= 20.12.0` | — | `text`, `password`, `confirm`, `select`, `multiselect`, `autocomplete`, `autocompleteMultiselect`, `selectKey`, `path`, `spinner`, `group`, `tasks`, `intro`/`outro`, `isCancel` |
| @inquirer/prompts / inquirer | 21,623 (SBoudrias/Inquirer.js) | 8.7.2 / inquirer 14.2.2 (2026-09-07); 28.8M / 34.3M dl/week | Node `>=23.5.0 \|\| ^22.13.0 \|\| ^20.17.0` | — | |
| prompts / enquirer | — | 2.4.2 (44.5M dl/wk) / 2.4.1 (24.8M dl/wk) | Node >=6 / >=8.6 | — | older, lighter |
| Bun `bun build --compile` | 95,971 (oven-sh/bun) | v1.4.2 / 2026-09-05 | none at runtime | — | `bun build ./cli.ts --compile --outfile mycli`; `--target bun-linux-x64|bun-linux-arm64|bun-linux-x64-musl|bun-windows-x64|bun-windows-arm64|bun-darwin-arm64|...`; `--minify --sourcemap --bytecode`; `.exe` auto; embeds full Bun runtime |
| Deno `deno compile` | 108,463 (denoland/deno) | v2.9.7 / 2026-09-16 | none at runtime | — | cross-compiles to `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc` (2.9.3+), `x86_64/aarch64-apple-darwin`; `--icon` on Windows |
| Node SEA | — | "Stability: 1.1 - Active development" | none | — | CJS or ESM single script; still experimental |
| pkg / @yao-pkg/pkg | — | 5.8.1 / 6.22.0 (not marked deprecated in registry) | — | — | community fork is the maintained one |

**Bootstrap cost**
- Bare Debian: `apt install curl ca-certificates` → then either (a) install Node via nvm/fnm/NodeSource, or (b) download a `bun build --compile` binary (no Node needed).
- Bare Windows Server 2022: no winget, so `irm | iex` bootstrap must download Node MSI/zip or fnm from GitHub, or download the compiled `.exe`. A compiled single-file binary is the only way to avoid an extra runtime on Server.
- Note the user's `~/.claude.json` has `autoUpdates=false`, node v22.22.1 and bun 1.4.2 already present on the home PC, but Proxmox nodes/VMs will not.

**Pros**: one codebase, best-in-class picker (clack), first-class JSON; TOML via `smol-toml`/`@iarna/toml`; easy unit tests (vitest); same language as the plugin ecosystem (skills CLI, cct, MCP servers). With `bun build --compile` you get Option C's distribution (GitHub Releases + bootstrap) without Go/Rust.
**Cons**: `npx` path means Node must be present before the picker runs (and `npx` pulls from the network each time unless installed globally); compiled binaries are large (embed the runtime) and need a release pipeline; two-stage bootstrap still needs a thin sh/ps1 pair.

### Option C — single Go (bubbletea/huh) or Rust (ratatui/dialoguer/inquire) binary via GitHub Releases + goreleaser/cargo-dist + bootstrap script

**Precedents (fetched):**

| Project | Lang | Stars | Latest / last commit | Distribution | Self-update |
|---|---|---|---|---|---|
| chezmoi | Go | 21,626 | v2.72.2 / 2026-09-12 | goreleaser; `sh -c "$(curl -fsLS get.chezmoi.io)"`, `iex "&{$(irm 'https://get.chezmoi.io/ps1')}"`, winget/scoop/choco, deb/rpm/apk | `chezmoi upgrade` auto-detects method: `brew-upgrade`, `replace-executable`, `snap-refresh`, `upgrade-package`, `sudo-upgrade-package`; `--method` override; uses `$GITHUB_TOKEN` if present |
| gh (cli/cli) | Go | 46,297 | 2.101.0 / 2026-09-15 | package managers + GitHub Releases | none built in (package manager) — `gh attestation verify` for provenance |
| gum | Go | 24,385 | v2.0.1 / 2026-09-11 | `brew install gum`, `winget install charmbracelet.gum`, `scoop install charm-gum`, apt repo `repo.charm.sh`, `go install charm.land/gum/v2@latest`, Releases for Linux/macOS/Windows/BSD | none |
| mise | Rust | 33,997 | v2026.9.10 / 2026-09-16 | `curl -fsSL https://mise.run \| sh` [verified 2026-09-17], `winget install jdx.mise`, scoop, choco; `MISE_INSTALL_PATH`, `MISE_VERSION`; GPG-signed install script | `mise self-update` (official standalone installs; "a build or package may disable it"); `mise settings auto_update=true`; `self_update.repository` setting points self-update at a curated GitHub release mirror [verified 2026-09-17] |
| uv | Rust | 89,882 | 0.12.15 / 2026-09-15 | cargo-dist sh/ps1 + winget/scoop/brew/pipx | `uv self update`, `uv self version` |
| rustup | Rust | 7,044 | 1.29.1 / 2026-09-16 | `sh.rustup.rs` → `rustup-init` | `rustup self update`; `auto-self-update = enable|disable|check-only`; `--no-self-update` |
| huh (charmbracelet) | Go lib | 7,166 | v2.0.3 (2026-03-10) / commit 2026-08-12 | Go module path is `charm.land/huh/v2` (v2), not `github.com/charmbracelet/huh` [verified 2026-09-17] | `huh.NewForm(huh.NewGroup(huh.NewSelect[string](), huh.NewMultiSelect[string](), huh.NewInput(), huh.NewConfirm()))`; accessible mode |
| bubbletea | Go lib | 44,986 | 2026-08-19 | — | |
| ratatui | Rust lib | 22,623 | 2026-09-15 | — | full TUI |
| dialoguer / inquire | Rust libs | 1,614 / 2,626 | 2026-09-16 / 2026-02-24 | — | prompt-style |
| goreleaser | Go tool | 16,052 | v2.18.2 / 2026-09-17 [verified] | checksums default `{{ .ProjectName }}_{{ .Version }}_checksums.txt` (sha256), cosign signing, Homebrew/winget/scoop/nfpm outputs | |
| cargo-dist (dist) | Rust tool | 2,115 | 0.33.0 / 2026-09-10 | installers: `shell`, `powershell`, `npm`, `homebrew`, `msi`; `install-updater = true` ships `<app>-update`; `axoupdater` crate for in-app self-update (31 stars, 0.10.2 / 2026-08-11) | |
| go-selfupdate (creativeprojects) / self_update (jaemk) | libs | 148 / 961 | 2026-08-05 / 2026-09-02 | GitHub-Releases-based self-update for Go / Rust | |

**Bootstrap cost**: lowest possible. Bare Windows Server: `irm | iex` downloads one `.exe` from Releases, verifies `checksums.txt`, done — no Node/Python/winget. Bare Debian: `curl | sh` same. Both vendors ultimately ship a native binary themselves.
**Interactivity**: best (huh/bubbletea or ratatui); consistent on Windows terminals.
**Maintenance/testability**: one codebase, strong typing, `go test`/`cargo test`, trivial cross-compile in Go (goreleaser matrix); Rust cross-compile needs CI matrix/`cargo-zigbuild`. Cost: a compiled-language toolchain and a release pipeline, and shelling out to `claude`/`codex`/`npx` is the same as in bash.
**Self-update**: `chezmoi upgrade` (method detection) or cargo-dist `axoupdater` are the reference implementations; go-selfupdate/self_update crates do the GitHub-Releases dance.
**Air-gap**: copy one binary + manifest; chezmoi/goreleaser also emit `.deb/.rpm/.apk` for internal repos.

### Option D — Python + uv (`uv run --script` with PEP 723 inline deps; questionary/textual)

- `uv` installer: `curl -LsSf https://astral.sh/uv/install.sh | sh` / `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`; pin by URL (`https://astral.sh/uv/0.12.15/install.sh`); `UV_NO_MODIFY_PATH=1`, `UV_INSTALL_DIR`, `UV_UNMANAGED_INSTALL`, `INSTALLER_DOWNLOAD_URL`; `uv self update`; `winget install --id=astral-sh.uv -e`.
- Script header (uv docs): `# /// script` / `# requires-python = ">=3.12"` / `# dependencies = ["requests<3", "rich"]` / `# ///`; run `uv run example.py`; lock with `uv lock --script example.py`; shebang `#!/usr/bin/env -S uv run --script`.
- Libs: questionary 2.1.1 (2,179 stars, last commit 2026-06-02, last release 2025-08-28), textual 8.2.8 (37,249 stars, 2026-07-11), rich 15.0.0, typer 0.27.2, keyring 25.7.0 (CLI `keyring set system username` / `keyring get system username`; backends: macOS Keychain, Freedesktop Secret Service, KWallet, Windows Credential Locker).
- **Bootstrap cost on Windows Server**: uv's ps1 (no winget needed) then uv downloads a managed CPython on first `uv run` (network + ~tens of MB); on Debian container: curl → uv → managed Python. Two runtime downloads before the picker appears; Python 3.14.4 exists on the home PC only.
- Pros: `tomllib` (read) in stdlib, `tomli-w` for writes; excellent JSON; questionary checkbox prompts; keyring gives one cross-platform secret API.
- Cons: heaviest bootstrap of all options; two-runtime supply chain (uv + CPython + PyPI); `uv run --script` re-resolves unless locked.

### Option E — pure gum-driven bash/pwsh

- gum v2.0.1 (24,385 stars, 2026-09-11). Primitives: `choose` (`--no-limit`, `--limit N`, `--selected a,b`, `--header`), `filter`, `confirm`, `input --password`, `write`, `spin`, `table`, `style`, `format`, `pager`, `file`.
- Install: `brew install gum`; `winget install charmbracelet.gum`; `scoop install charm-gum`; apt repo (`curl -fsSL https://repo.charm.sh/apt/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/charm.gpg` + `deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *`); `dnf install gum`; `pacman -S gum`; `go install charm.land/gum/v2@latest`; Releases binaries for Linux/macOS/Windows/FreeBSD/OpenBSD/NetBSD. Omakub pins gum from a `.deb` URL before its first prompt.
- Pros: picker quality close to Option C for ~1 dependency; keeps Option A's zero-runtime story on Linux.
- Cons: on Windows you'd drive gum from PowerShell (works, gum is a normal exe) but you still have two script bodies; gum becomes the first thing to bootstrap (download + sha256 from GitHub Releases on Server 2022 because no winget); non-interactive mode must bypass gum entirely (gum needs a TTY). Same TOML problem as Option A.

### Side-by-side

| Criterion | A twin sh/ps1 | B TS CLI (npx) | B' TS compiled (bun/deno) | C Go/Rust binary | D Python+uv | E gum+bash/pwsh |
|---|---|---|---|---|---|---|
| Bare Win Server 2022 prereqs | none (PS 5.1) | Node MSI/zip via script (no winget) | none (download .exe) | none (download .exe) | uv.ps1 + managed Python | gum.exe download |
| Bare Debian prereqs | curl (+ca-certs) | curl + Node (nvm/NodeSource) | curl | curl | curl + uv + Python | curl + gum |
| Picker quality | poor (select/Read-Host) | excellent (clack multiselect) | excellent | excellent (huh) | good (questionary) | very good |
| Logic duplication | 2x | 1x (+thin bootstrap) | 1x (+thin bootstrap) | 1x (+thin bootstrap) | 1x (+thin bootstrap) | 2x |
| JSON / TOML editing | jq + yq / PS ConvertFrom-Json, no TOML | native / smol-toml | same | encoding/json + BurntSushi/toml (Go), serde (Rust) | json + tomllib/tomli-w | jq + yq |
| Unit testability | bats + Pester | vitest/bun test | same | go test / cargo test | pytest | bats + Pester |
| Self-update | re-run bootstrap (pin tag + sha256) | `npm i -g pkg@latest` / npx always-latest | replace-executable from Releases (chezmoi pattern) | `chezmoi upgrade`/axoupdater pattern | `uv tool upgrade` or re-fetch script | re-run bootstrap |
| Air-gapped | copy 2 files + manifest | private npm registry or tarball | copy binary | copy binary (+deb/rpm) | wheels + Python | copy scripts + gum |
| Release pipeline | none | npm publish | GitHub Actions + Releases | goreleaser/cargo-dist | none | none |
| Telemetry risk | none | none if you write it (cct has opt-out tracking) | none | none | none | none |

---

## 2. Design patterns (cross-cutting)

### 2.1 Declarative component manifest (`components.json`)

Cribbed from devcontainer-feature.json (required `id`, `version`, `name`; `options` map with `type`, `enum`, `proposals`, `default`, `description`; `installsAfter` soft deps, `dependsOn` hard deps; `deprecated`, `legacyIds`; options passed to `install.sh` as env vars, sanitized to upper-case, defaults implicitly exported), winget `export/import` and `winget configure` DSC, and the two state files in §0.2.

```jsonc
{
  "$schema": "./components.schema.json",
  "manifestVersion": 1,
  "profiles": {
    "all":         { "include": ["*"] },
    "minimal":     { "include": ["agent:claude", "agent:codex", "tool:node", "skill:find-skills"] },
    "claude-only": { "include": ["agent:claude", "plugin:*", "mcp:*", "setting:claude.*"], "exclude": ["target:codex"] },
    "codex-only":  { "include": ["agent:codex", "target:codex"] },
    "work":        { "extends": "all", "exclude": ["mcp:fli", "mcp:gmail", "skill:job-*"] },
    "homelab":     { "extends": "minimal", "include": ["plugin:caveman", "tool:gum"] }
  },
  "components": [
    {
      "id": "agent:claude",
      "kind": "agent",                       // agent|plugin|skill|mcp|setting|tool|marketplace
      "name": "Claude Code (native installer)",
      "targets": ["claude"],
      "platforms": ["linux", "windows", "darwin"],
      "deps": [],
      "version": { "channel": "stable", "pin": null, "min": "2.1.207" },
      "check":   { "sh": "claude --version", "ps1": "claude --version" },
      "install": { "sh": "curl -fsSL https://claude.ai/install.sh | bash -s ${CHANNEL_OR_VERSION}",
                   "ps1": "& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) ${CHANNEL_OR_VERSION}" },
      "update":  { "sh": "claude update", "ps1": "claude update" },
      "uninstall": { "sh": "rm -f ~/.local/bin/claude && rm -rf ~/.local/share/claude",
                     "ps1": "Remove-Item \"$env:USERPROFILE\\.local\\bin\\claude.exe\" -Force; Remove-Item \"$env:USERPROFILE\\.local\\share\\claude\" -Recurse -Force" },
      "env": [], "secrets": [],
      "postInstallHint": "Run `claude` once to log in; or export ANTHROPIC_API_KEY."
    },
    {
      "id": "plugin:superpowers", "kind": "plugin", "targets": ["claude"], "platforms": ["*"],
      "deps": ["agent:claude", "marketplace:claude-plugins-official"],
      "install": { "*": "claude plugin install superpowers@claude-plugins-official -s user --json" },
      "update":  { "*": "claude plugin update superpowers@claude-plugins-official" },
      "uninstall": { "*": "claude plugin uninstall superpowers@claude-plugins-official" }
    },
    {
      "id": "skill:find-skills", "kind": "skill", "targets": ["claude", "codex"], "platforms": ["*"],
      "deps": ["tool:node"],
      "install": { "*": "npx skills add vercel-labs/skills --skill find-skills -g -a claude-code -a codex -y" },
      "update":  { "*": "npx skills update -g -y" }
    },
    {
      "id": "mcp:context7", "kind": "mcp", "targets": ["claude", "codex"], "platforms": ["*"],
      "transport": "http", "url": "https://mcp.context7.com/mcp",
      "secrets": [{ "name": "CONTEXT7_API_KEY", "prompt": "Context7 API key (optional)", "required": false, "store": "keychain" }],
      "install": { "claude": "claude mcp add --transport http context7 https://mcp.context7.com/mcp --header \"CONTEXT7_API_KEY: ${CONTEXT7_API_KEY}\"",
                   "codex":  "codex mcp add context7 --url https://mcp.context7.com/mcp" }
    },
    {
      "id": "setting:codex.model", "kind": "setting", "targets": ["codex"],
      "file": "~/.codex/config.toml", "format": "toml",
      "merge": { "model": "gpt-6-astra", "model_reasoning_effort": "xhigh" }
    },
    {
      "id": "setting:claude.autoupdate", "kind": "setting", "targets": ["claude"],
      "file": "~/.claude/settings.json", "format": "json",
      "merge": { "autoUpdatesChannel": "stable", "env": { "DISABLE_AUTOUPDATER": "1" } }
    },
    {
      "id": "tool:node", "kind": "tool", "platforms": ["*"], "targets": [],
      "check": { "*": "node -v" },
      "install": { "linux": "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash && . \"$HOME/.nvm/nvm.sh\" && nvm install 24",
                   "darwin": "brew install node@24",
                   "windows": "winget install OpenJS.NodeJS.LTS   # fallback: msiexec /i node-v24.x-x64.msi /qn on Server 2022" }
    }
  ]
}
```

Rules: `id` namespaced by kind; `targets` decides which agent(s) a component configures; `platforms` gates it; `deps` is a DAG resolved topologically (devcontainer `dependsOn`/`installsAfter` semantics); each lifecycle verb (`check`/`install`/`update`/`uninstall`) is a map keyed by `*`, `sh`, `ps1`, `linux`, `darwin`, `windows` (most specific wins); `secrets[]` declares inputs by name with a prompt and a preferred store; `postInstallHint` is printed at the end summary.

### 2.2 Profiles / presets
`profiles` in the manifest with `include`/`exclude` glob lists and `extends`. The picker pre-selects the chosen profile (default `all`) and lets the user toggle (gum: `--selected`; clack: `initialValues`; huh: `.Selected(true)`). Omakub shows the exact pattern (`DEFAULT_OPTIONAL_APPS='1password,Spotify,Zoom'` → `gum choose --no-limit --selected`).

### 2.3 Persisted host state file (`~/.config/agent-installer/state.json`; Windows `%LOCALAPPDATA%\agent-installer\state.json`)
Mirror the real ones: `{"version":1,"installerVersion":"0.4.2","installerSha256":"…","profile":"work","selected":["agent:claude","plugin:superpowers",…],"host":{"os":"linux","arch":"x64","hostname":"pve1"},"components":{"plugin:superpowers":{"version":"6.3.0","installedAt":"…","updatedAt":"…","source":"claude-plugins-official","gitCommitSha":"…"},…},"secrets":{"CONTEXT7_API_KEY":{"store":"secret-tool","ref":"agent-installer/CONTEXT7_API_KEY"}}}`.
`update` re-reads `selected` and replays `update` verbs; `install --profile X` writes it; `status` diffs manifest vs state vs `check` output. cargo-dist's `install-receipt.json` and Claude's `installed_plugins.json` are the same idea.

### 2.4 Non-interactive, dry-run, logging, idempotency, backup
- Flags copied from precedents: `-y/--yes` (rustup `-y`, Omarchy `-y` = "a promise not to ask anything", `npx skills … -y`, `claude plugin install … -y/--accept-command`), `--unattended` (oh-my-zsh), env `CODEX_NON_INTERACTIVE=1`, `winget --disable-interactivity`, `--no-modify-path` (rustup/uv), `--quiet/--verbose` (uv `INSTALLER_PRINT_QUIET/VERBOSE`). Detect no-TTY like rustup ("Unable to run interactively. Run with -y").
- cloud-init: `runcmd: [ "curl -fsSL https://…/install.sh | bash -s -- --profile homelab -y" ]`; Ansible: `ansible.builtin.shell` with `creates:` guard on the state file, or `command` with `environment: {INSTALLER_NON_INTERACTIVE: "1"}`.
- Dry-run: print the resolved plan (ordered component list + exact commands) and exit; `omarchy-migrate --pending` and `winget list --upgrade-available` are the "show what would change" precedents.
- Logging: Omarchy wraps itself in `script -qefc "$cmd" /tmp/omarchy-update.log`; simpler: `exec > >(tee -a "$LOG") 2>&1` in bash, `Start-Transcript -Path` in PowerShell; keep per-run logs under the state dir.
- Idempotency: every component has a `check`; chezmoi `run_onchange_` (re-run only when content hash changes) and `run_once_` (per unique content SHA256, tracked in a DB) are the model for settings merges.
- Backup-before-modify: copy `settings.json`/`config.toml` to `<file>.bak.<timestamp>` before merging; Omarchy takes a filesystem snapshot before update. Claude Code has no built-in settings backup; Codex none documented.
- Locks: Codex installer and Omarchy both take an install/update lock; do the same (`flock` / `New-Item -ItemType File` lock).

### 2.5 Secrets
| Store | Linux | Windows | macOS |
|---|---|---|---|
| Prompt only (never persisted) | `gum input --password` / `read -rs` / clack `password` | `Read-Host -AsSecureString` | same as Linux |
| Env / `.env` file | `~/.config/agent-installer/.env` chmod 600 | same, no ACL by default | same |
| OS keychain | `secret-tool store --label='Label' key1 value1` / `secret-tool lookup key1 value1` / `secret-tool clear …` (package `libsecret-tools`; needs a running Secret Service, i.e. a desktop session — usually absent on Proxmox/VMs) | `cmdkey /generic:<target> /user:<u> /pass:<p>` is **write-only** ("Passwords are not displayed after they're stored"); reading needs Win32 CredRead (PowerShell P/Invoke or the `SecretManagement.JustinGrote.CredMan` vault). Built-in per-user encryption without modules: `ConvertFrom-SecureString` uses DPAPI when no key is given (Windows only; "The contents of a SecureString aren't encrypted on non-Windows systems"). | `security add-generic-password -a <account> -s <service> -w <password> -U`; `security find-generic-password -a <account> -s <service> -w`; `security delete-generic-password -a … -s …` |
| Cross-platform CLI | `keyring set <service> <user>` / `keyring get <service> <user>` (python keyring 25.7.0; backends macOS Keychain, Secret Service, KWallet, Windows Credential Locker) | same | same |
| PowerShell SecretManagement | **archived**: "The PowerShell team has decided that Secret modules are feature complete and will no longer be actively developed… The code repository has been archived." (SecretManagement 1.1.2, SecretStore 1.0.6). Still installable, but do not build on it. |

Recommendation: prompt → write to agent config where the agent itself stores it (Claude `claude mcp add … --header`/`-e`, Codex `codex mcp add` env), never to the state file; offer `--secrets-from env|file|keychain`; on headless Linux fall back to a 0600 `.env`.

### 2.6 Self-update mechanics (compared)

| Mechanism | How | Pinning / integrity | Notes |
|---|---|---|---|
| `rustup self update` | downloads new `rustup-init`, replaces itself; `auto-self-update = enable/disable/check-only`; `--no-self-update` | mirror via `RUSTUP_UPDATE_ROOT` | disabled in distro builds (`--no-default-features`) |
| `chezmoi upgrade` | GitHub API → detect install method → `brew upgrade` / replace executable / `snap refresh` / install `.deb/.rpm/.apk` / `pacman` | cosign: `cosign verify-blob --key=chezmoi_cosign.pub --bundle=chezmoi_2.72.2_checksums.txt.sigstore.json chezmoi_2.72.2_checksums.txt`; `sha256sum --check … --ignore-missing` | "If you installed chezmoi using a package manager, the upgrade command might have been removed by the package maintainer" |
| `omz update` | `git fetch` + `git pull --quiet --rebase` of the clone; `zstyle ':omz:update' mode prompt|auto|reminder|disabled`, `frequency` days | git ref = whatever is on `master` | good model for a git-clone-based installer repo (`~/.local/share/agent-installer` clone; `git -C … fetch && git checkout <tag>`) |
| `gh` via package manager | `brew upgrade gh`, `apt upgrade gh`, `winget upgrade GitHub.cli` | distro signing | no self-update in binary |
| `claude update` / `codex update` / `uv self update` / `mise self-update` | in-app | Claude: signed manifest.json + `minimumVersion`/`requiredMaximumVersion`; channel `stable|latest` | delegate agent updates to these |
| cargo-dist `install-updater = true` → `<app>-update`; axoupdater crate | GitHub Releases + install receipt | checksums in installer | for Option C/Rust |
| Script pinned to git tag + sha256 | bootstrap fetches `https://github.com/<o>/<r>/releases/download/v1.2.3/install.sh` + `SHA256SUMS`, verifies, execs; `update` compares the state file's `installerVersion` to `releases/latest` | `sha256sum -c` / `Get-FileHash`; optional GPG (Claude manifest, mise `install.sh.sig`) | works for Options A/B/E with no binary pipeline |
| GitHub artifact attestations | CI: `permissions: {id-token: write, contents: read, attestations: write}` + `uses: actions/attest@v4` with `subject-path`; client: `gh attestation verify <file> -R <owner>/<repo>` (also `--owner`, `--bundle` for offline, `--signer-repo`, `--format json`, `--deny-self-hosted-runners`) | SLSA provenance v1 + Sigstore | requires `gh` on the host; treat as optional strong mode |

### 2.7 Uninstall, version pinning, telemetry
- `uninstall` replays `uninstall` verbs in reverse dependency order and removes the state dir; the agents' own docs give exact removal commands (see §0.1).
- Version pinning: manifest `version.pin` → passes `bash -s 2.1.89` / `--release 0.154.0` / `npm i -g pkg@x.y.z`; Claude `minimumVersion`/`requiredMaximumVersion` in settings; the installer pins its own version with `installerVersion` in state and an explicit `update --to vX`.
- Telemetry-free: write none; document that Claude Code (`DISABLE_TELEMETRY`/`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` — out of scope here), claude-code-templates (`CCT_NO_TRACKING=true`) and PowerShell MSI (`DISABLE_TELEMETRY` property) have their own opt-outs the installer can set.

### 2.8 Offline / air-gapped
- Option A/E: vendor `install.sh`/`install.ps1`/`components.json` + `gum` binaries into a tarball; the agents themselves: Claude apt/dnf/apk repos are mirrorable and GPG-signed; Codex GitHub Release tarballs (`codex-x86_64-unknown-linux-musl.tar.gz`) can be pre-fetched; npm packages via `npm pack` + private registry; skills CLI accepts local paths (`npx skills add ./my-local-skills`) and `claude plugin marketplace add <path>` accepts a local path.
- Option C: one static binary + manifest; goreleaser/cargo-dist also emit `.deb/.rpm/.msi` for internal repos.
- Mirror env vars exist for uv (`INSTALLER_DOWNLOAD_URL`), rustup (`RUSTUP_UPDATE_ROOT`), codex (only GitHub fallback toggle), none for Claude's install.sh.

---

## 3. Recommendation (ranked)

1. **Option B' hybrid — thin twin bootstrap (`install.sh` ≈ Claude Code's 260 lines, `install.ps1` ≈ 110 lines, PS 5.1-compatible) + one TypeScript core, shipped as `bun build --compile` binaries on GitHub Releases *and* as an npm package, driven by `components.json`.**
   Why: it is literally the shape Anthropic chose (thin script → checksummed binary → `claude install`), it gives one codebase for the manifest/picker/state/TOML/JSON logic, the picker (@clack/prompts 1.8.1, 18.3M dl/week) is the same one the ecosystem's CLIs use, and the bootstrap needs nothing on a bare Windows Server 2022 (no winget, no Node) or a bare Debian container (curl only). Self-update = chezmoi's `replace-executable` pattern (compare `installerVersion` in state with `releases/latest`, download `+SHA256SUMS`, swap). npm publish gives `npx <pkg>` for hosts that already have Node. Tests: `bun test`/vitest for logic, bats + Pester only for the two thin bootstraps. Optional hardening: `actions/attest@v4` + `gh attestation verify`.
   Caveats: compiled binaries embed the Bun runtime (large); you own a release pipeline; Bun on Windows ARM64 exists but is less battle-tested — fall back to `npx` there.
2. **Option C (Go + huh, goreleaser)** — equal bootstrap and better binary size/startup, richest TUI, mature self-update libs (go-selfupdate, chezmoi's implementation to copy). Ranked second only because the user's ecosystem (skills CLI, MCP servers, cct) is TypeScript and shelling out to `npx` remains necessary anyway; pick this if you prefer a single static ~10-20 MB binary and Go tooling over Bun.
3. **Option E (gum + bash/pwsh)** — fastest to first working version and no release pipeline (Omakub/Omarchy prove the UX). Take it if you want to ship this week; but you will write every feature twice (Codex's 2,300-line pair is the warning), Windows needs gum.exe fetched first, and TOML edits from PowerShell are painful.
4. **Option A (twin scripts, no helper)** — acceptable only as the *bootstrap layer* of 1–3; as the whole product the picker is too weak and the duplication too high.
5. **Option D (Python + uv)** — best secret handling (`keyring`) and TOML support, but the heaviest bootstrap (uv + managed CPython before the first prompt) and a second package ecosystem; only choose if the team is Python-first.

Whatever the choice: keep agent install/update delegated to the vendors' own `install.sh/.ps1`, `claude update`/`codex update`, `claude plugin`/`codex plugin`, `claude mcp`/`codex mcp`, and `npx skills`; the installer is an orchestrator with a manifest and a state file, not a package manager.

---

## 4. OSS repos to crib from (stars/last activity observed 2026-09-16)

| Repo | Stars | Last commit | Latest release | Crib what |
|---|---|---|---|---|
| anthropics/claude-code (+ claude.ai/install.sh/.ps1/.cmd) | 145,589 | 2026-09-17 | v2.1.274 (npm 2.1.274) [verified 2026-09-17] | thin bootstrap shape; manifest.json + SHA256; `install [stable|latest|X]`; `.cmd` shim |
| openai/codex (+ chatgpt.com/codex/install.sh/.ps1) | 124,785 | 2026-09-17 | rust-v0.154.0 stable (0.155.0-alpha.15 pre-release) [verified 2026-09-17] | env-driven flags, staging dir + `current` link, PATH markers, install lock, conflict detection, SHA256SUMS |
| twpayne/chezmoi | 21,626 | 2026-09-12 | v2.72.2 | `upgrade` method detection; `run_once_/run_onchange_` idempotency; cosign; sh+ps1 pair; `.ps1` interpreter table |
| rust-lang/rustup | 7,044 | 2026-09-16 | 1.29.1 | dash-compatible bootstrap; `-y`, `--no-modify-path`; `self update` + `auto-self-update` modes; no-TTY error |
| astral-sh/uv + axodotdev/cargo-dist | 89,882 / 2,115 | 2026-09-16 / 2026-09-13 | 0.12.15 / 0.33.0 | generated sh/ps1 with baked checksums; `INSTALLER_*` env; `self update`; updater/receipt |
| jdx/mise | 33,997 | 2026-09-16 | v2026.9.10 [verified 2026-09-17] | `mise.run` installer, GPG-signed script, `self-update`, winget/scoop/choco, cross-platform tool install |
| charmbracelet/gum, huh, bubbletea | 24,385 / 7,166 / 44,986 | 2026-09-11 / 08-12 / 08-19 | v2.0.1 / v2.0.3 / — | picker for E; forms for C |
| basecamp/omakub, omarchy | 8,094 / 41,523 | 2026-03-07 / 2026-09-16 | — / v4.0.4 | gum picker with defaults; `update -y`, migrations, logging via `script`, update lock, snapshot |
| ohmyzsh/ohmyzsh | 189,755 | 2026-09-16 | — | `--unattended`, git-based `omz update` with mode/frequency |
| vercel-labs/skills | 31,818 | 2026-09-16 | v1.6.0 [verified 2026-09-17] | tiny-deps TS CLI; `.skill-lock.json`; `-g -a <agent> -y`; symlink vs copy |
| davila7/claude-code-templates | 30,762 | 2026-09-17 | v1.29.6 [verified 2026-09-17] | flag design (`--agent/--mcp/--setting/--hook/--skill --yes`, `--health-check`); anti-pattern: opt-out tracking |
| bombshell-dev/clack | 8,054 | 2026-09-13 | @clack/prompts@1.8.1 | picker |
| devcontainers/spec + features | 5,715 / 1,535 | 2026-03-20 / 2026-09-16 | — | manifest schema (`options`, `dependsOn`, `installsAfter`, env passing) |
| cli/cli (gh) | 46,297 | 2026-09-15 | 2.101.0 | `gh attestation verify` |
| goreleaser/goreleaser | 16,052 | 2026-09-17 | v2.18.2 [verified 2026-09-17] | checksums/cosign/nfpm/winget/scoop outputs |
| creativeprojects/go-selfupdate / jaemk/self_update / axodotdev/axoupdater | 148 / 961 / 31 | releases: v1.6.0 2026-07-08 / v1.3.0 2026-09-02 / 0.10.2 2026-08-12 [verified 2026-09-17] | v1.6.0 / v1.3.0 / 0.10.2 | self-update libs |
| bats-core/bats-core, pester/Pester, koalaman/shellcheck | 6,265 / 3,340 / 40,045 | release feed: v1.14.0 2026-07-21 / 6.2.0 2026-09-09 / v0.11.0 (feed date unreliable) [verified 2026-09-17] | v1.14.0 / 6.2.0 / v0.11.0 | tests/lint |
| jaraco/keyring | 1,512 | 2026-04-13 | 25.7.0 | cross-platform secret CLI |
| microsoft/winget-cli | 26,429 | 2026-09-14 | v1.29.290 (latest non-prerelease tag) [verified 2026-09-17] | `export/import`, `configure`, `--disable-interactivity` |
| aquaproj/aqua, houseabsolute/ubi, pkgxdev/pkgx | 1,843 / 595 / 9,920 | 2026-09-16 / 09-07 / 08-26 | v2.63.0 / v0.12.0 / v2.11.0 | declarative tool-version manifests; GitHub-release binary fetcher |

---

## 5. Open questions
- Codex's own uninstall procedure for the standalone layout (`~/.codex/packages/standalone`, `~/.local/bin/codex`, `codex-code-mode-host`) is not documented on the fetched pages; verify before writing `uninstall`.
- ~~Whether `codex update` handles standalone-installer installs vs npm installs identically~~ **Resolved 2026-09-17**: `codex-rs/tui/src/update_action.rs` detects the install method and runs `npm install -g @openai/codex`, `bun install -g @openai/codex`, `pnpm add -g @openai/codex`, `vp install -g @openai/codex`, `brew upgrade --cask codex`, or re-runs the standalone installer with `CODEX_NON_INTERACTIVE=1` (`curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh` / `$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 | iex`); for an unknown method it errors "Could not detect the Codex installation method. Please update manually" (`codex-rs/cli/src/main.rs`, `run_update_command`). Not available in debug builds.
- ~~Whether `codex mcp add` supports HTTP transports with headers~~ **Resolved 2026-09-17** (local `codex mcp add --help`, read-only): `codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)` with `--env <KEY=VALUE>` (stdio only), `--url <URL>` (streamable HTTP), `--bearer-token-env-var <ENV_VAR>` (HTTP only; secret stays in an env var, not in config.toml), `--oauth-client-id`, `--oauth-client-registration <auto|cimd|dcr>`, `--oauth-resource`, plus `-c key=value` overrides. No arbitrary `--header` flag (Claude has `-H/--header`; Codex only has the bearer-token env var).
- Bun `--compile` binary sizes are not stated in the docs (the docs only say "Bun's binary is still way too big and we need to make it smaller"); `bun-windows-arm64` is a listed target [verified 2026-09-17].
- Node MSI silent-install flags for Windows Server 2022 (no winget) were not fetched; nodejs.org snippets only cover nvm/fnm/brew/choco.
- GitHub artifact attestations for **private** repositories: **Resolved 2026-09-17** — docs.github.com: "If you are on a GitHub Free, GitHub Pro, or GitHub Team plan, artifact attestations are only available for public repositories. To use artifact attestations in private or internal repositories, you must be on a GitHub Enterprise Cloud plan." Keep the installer repo public or treat attestation as optional.

---

## Sources (fetched 2026-09-16)
- Claude Code setup: https://code.claude.com/docs/en/setup ; scripts https://claude.ai/install.sh , https://claude.ai/install.ps1 , https://claude.ai/install.cmd
- Codex: https://raw.githubusercontent.com/openai/codex/main/README.md ; https://raw.githubusercontent.com/openai/codex/main/docs/install.md ; https://chatgpt.com/codex/install.sh ; https://chatgpt.com/codex/install.ps1 ; https://learn.chatgpt.com/docs/codex/cli
- rustup: https://sh.rustup.rs ; https://rust-lang.github.io/rustup/basics.html
- chezmoi: https://www.chezmoi.io/install/ ; https://www.chezmoi.io/reference/commands/upgrade/ ; https://www.chezmoi.io/user-guide/use-scripts-to-perform-actions/ ; https://www.chezmoi.io/reference/configuration-file/interpreters/ ; https://get.chezmoi.io ; https://get.chezmoi.io/ps1
- uv: https://docs.astral.sh/uv/getting-started/installation/ ; https://docs.astral.sh/uv/guides/scripts/ ; https://astral.sh/uv/install.sh ; https://astral.sh/uv/install.ps1
- cargo-dist: https://axodotdev.github.io/cargo-dist/book/installers/index.html ; https://axodotdev.github.io/cargo-dist/book/installers/updater.html
- deno: https://deno.land/install.sh ; https://deno.land/install.ps1 ; https://docs.deno.com/runtime/reference/cli/compile/
- bun: https://bun.sh/install ; https://bun.sh/install.ps1 ; https://bun.com/docs/bundler/executables
- Node SEA: https://nodejs.org/api/single-executable-applications.html ; nodejs.org snippets https://raw.githubusercontent.com/nodejs/nodejs.org/main/apps/site/snippets/en/download/{nvm,fnm,brew,choco}.bash ; https://nodejs.org/en/download
- gum: https://raw.githubusercontent.com/charmbracelet/gum/main/README.md ; huh: https://raw.githubusercontent.com/charmbracelet/huh/main/README.md
- goreleaser: https://goreleaser.com/customization/checksum/
- GitHub attestations: https://cli.github.com/manual/gh_attestation_verify ; https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
- skills CLI: https://raw.githubusercontent.com/vercel-labs/skills/main/README.md ; npm https://registry.npmjs.org/skills/latest
- claude-code-templates: https://raw.githubusercontent.com/davila7/claude-code-templates/main/README.md ; https://raw.githubusercontent.com/davila7/claude-code-templates/main/cli-tool/src/tracking-service.js
- Smithery: https://raw.githubusercontent.com/smithery-ai/cli/main/README.md
- clack: https://raw.githubusercontent.com/bombshell-dev/clack/main/packages/prompts/README.md ; npm registry JSON for @clack/prompts, @inquirer/prompts, inquirer, prompts, enquirer; https://api.npmjs.org/downloads/point/last-week/<pkg>
- Omakub/Omarchy: https://raw.githubusercontent.com/basecamp/omakub/master/install.sh , .../install/first-run-choices.sh , .../install/terminal/required/app-gum.sh , .../bin/omakub-sub/update.sh ; https://raw.githubusercontent.com/basecamp/omarchy/master/bin/omarchy-update , .../bin/omarchy-migrate
- oh-my-zsh: https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/{install.sh,upgrade.sh,check_for_upgrade.sh}
- mise: https://mise.jdx.dev/installing-mise.html
- devcontainer features: https://containers.dev/implementors/features/
- Secrets: https://learn.microsoft.com/en-us/powershell/utility-modules/secretmanagement/overview ; https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmdkey ; https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/convertfrom-securestring ; https://manpages.debian.org/testing/libsecret-tools/secret-tool.1.en.html ; https://ss64.com/mac/security-password.html ; https://pypi.org/pypi/keyring/json
- Windows platform: https://learn.microsoft.com/en-us/windows/package-manager/winget/ ; https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows ; https://devblogs.microsoft.com/commandline/tar-and-curl-come-to-windows/ ; winget-pkgs manifests https://github.com/microsoft/winget-pkgs/tree/master/manifests/...
- yq TOML: https://mikefarah.gitbook.io/yq/usage/toml
- PyPI JSON for questionary, textual, rich, typer, InquirerPy
- Star counts: scraped from https://github.com/<owner>/<repo> pages; dates from `/releases.atom` and `/commits.atom` feeds (GitHub REST API was rate-limited from this host)
- Local read-only: `claude --help`, `claude plugin --help`, `claude plugin install --help`, `claude mcp --help`, `codex --help`, `codex update --help`, `codex plugin --help`, `codex mcp --help`; `~/.claude/plugins/installed_plugins.json`; `~/.agents/.skill-lock.json`

---

## Verification (skeptical re-check, 2026-09-17)

Method: every install/update command above was re-fetched character-by-character from its primary source (raw scripts via `curl`, raw GitHub READMEs/docs, npm registry JSON, PyPI JSON, learn.microsoft.com, GitHub repo pages + `releases.atom` + `releases/latest` redirects; the GitHub REST API was rate-limited from this host, and `gh` had a bad credential, so star counts were scraped from each repo page's `stargazerCount`). Local `codex`/`claude` `--help` output was read without mutating anything. No item was removed: every repo, package and docs URL in the research resolved (HTTP 200) and matched.

### Corrections applied to the body

| # | What was wrong / stale | Corrected value | Deciding source |
|---|---|---|---|
| 1 | Claude Code latest v2.1.273 | **v2.1.274** (GitHub release 2026-09-17; npm `@anthropic-ai/claude-code` 2.1.274, engines `>=22.0.0`) | github.com/anthropics/claude-code/releases/latest; registry.npmjs.org |
| 2 | skills CLI v1.5.26 | **v1.6.0** (GitHub 2026-09-16; npm `skills` 1.6.0, engines `>=22.20.0`, deps `tar`,`yaml`, 4,621,540 dl/wk) | github.com/vercel-labs/skills/releases/latest; registry.npmjs.org/skills/latest |
| 3 | claude-code-templates v1.29.5 | **v1.29.6** (2026-09-17; npm 1.29.6, 18 deps incl. `@clack/prompts`, `inquirer`, `express`, `@supabase/supabase-js`; 1,736 dl/wk) | releases.atom; registry.npmjs.org |
| 4 | Smithery "4,707 downloads/week" | npm `smithery` 1.2.0 = **793 dl/wk**; 4,707 dl/wk is the legacy `@smithery/cli` 4.11.1 (not marked deprecated). README also shows `smithery skill add … --agent claude-code`, so "skills delegated to npx skills" is only what the Skills section says; the CLI still has a skill subcommand | api.npmjs.org; raw README |
| 5 | goreleaser "v2.19.x" | **v2.18.2** (releases/latest, 2026-09-17) | github.com/goreleaser/goreleaser/releases/latest |
| 6 | winget-cli "1.30.x" | latest non-prerelease tag **v1.29.290** | github.com/microsoft/winget-cli/releases/latest |
| 7 | mise one-liner `curl https://mise.run \| sh` | docs page shows **`curl -fsSL https://mise.run \| sh`**; latest v2026.9.10; new: `self_update.repository` setting for a curated release mirror | mise.jdx.dev/installing-mise.html |
| 8 | huh install `go get github.com/charmbracelet/huh` | v2 module path is **`charm.land/huh/v2`** (README `import "charm.land/huh/v2"`); the github.com path is v1 | raw README |
| 9 | Release dates: yq v4.53.6 "2026-09-15", bats v1.14.0 "2026-09-15" | releases.atom: yq v4.53.6 **2026-08-20**; bats v1.14.0 **2026-07-21**; go-selfupdate v1.6.0 **2026-07-08**; shellcheck feed date unreliable (kept version only) | releases.atom feeds |
| 10 | Claude Windows uninstall shown without `-Path`/`-Force` | docs: `Remove-Item -Path "$env:USERPROFILE\.local\bin\claude.exe" -Force` and `Remove-Item -Path "$env:USERPROFILE\.local\share\claude" -Recurse -Force` | code.claude.com/docs/en/setup |
| 11 | "tar/curl ship in Windows Server 2019" attributed to the devblog | the devblog only says Windows 10 Insider build 17063+; Server 2019 (build 17763) is corroborated by MS Q&A threads about the built-in `System32\curl.exe`, not by the devblog — confidence stays **medium** | devblogs.microsoft.com; learn.microsoft.com/answers |
| 12 | Integrity row implied the installers verify GPG | install.sh/ps1 verify **SHA256 only** (`sha256sum` / `Get-FileHash`) against `manifest.json`; GPG verification of `manifest.json.sig` is a documented manual procedure. install.sh also prefers `manifest.zst.json` + `claude.zst` when `zstd` exists, then falls back | claude.ai/install.sh lines 159-216; install.ps1 lines 44-71 |
| 13 | Star counts (2026-09-16) | re-scraped 2026-09-17, drift ≤0.1%: claude-code 145,589; codex 124,785; chezmoi 21,629; uv 89,887; gum 24,383; bubbletea 44,990; skills 31,818; cct 30,762; bun 95,973; deno 108,495; mise 33,997; omarchy 41,565; ohmyzsh 189,761; cli/cli 46,300; textual 37,253; yq 15,969; ratatui 22,625; all others unchanged | github.com/<owner>/<repo> `stargazerCount` |

### Confirmed unchanged (character-by-character)

- Claude Code: all three one-liners, `bash -s stable` / `bash -s 2.1.89`, `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) 2.1.89`, `install.cmd 2.1.89`, `claude update`, `autoUpdatesChannel` latest|stable, `minimumVersion`, `requiredMinimumVersion`/`requiredMaximumVersion`, `DISABLE_AUTOUPDATER` vs `DISABLE_UPDATES`, GPG fingerprint `31DD DE24 DDFA B679 F42D 7BD2 BAA9 29FF 1A7E CACE`, "Manifest signatures are available for releases from 2.1.89 onward", `brew install --cask claude-code`, `winget install Anthropic.ClaudeCode`, `npm install -g @anthropic-ai/claude-code` (Node 22+ as of v2.1.198), Alpine `apk add bash curl libgcc libstdc++ ripgrep`, Debian `sudo apt install curl gnupg`, OS list (macOS 13+, Win10 1809+/Server 2019+, Ubuntu 20.04+, Debian 10+, Alpine 3.19+). Script sizes 260/110/256 lines. install.ps1 is `param([ValidatePattern('^(stable|latest|\d+\.\d+\.\d+(-[^\s]+)?)$')] [string]$Target = "latest")`, uses only 5.1-era primitives, no `#Requires`.
- Codex: `curl -fsSL https://chatgpt.com/codex/install.sh | sh`, `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`, `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM=false` (also `0`/`no`), `npm install -g @openai/codex`, `brew install --cask codex`, release tarball names; install.sh is `#!/bin/sh` + `set -eu`, 1209 lines; `Usage: install.sh [--release VERSION]`, env `CODEX_RELEASE`, `CODEX_NON_INTERACTIVE` ("Set to 1, true, or yes to skip prompts"), `CODEX_INSTALL_DIR` (default `$HOME/.local/bin`), `CODEX_HOME` (default `~/.codex`), `codex-package_SHA256SUMS`, `$CODEX_HOME/packages/standalone/current` link, `install.lock` (lockf/flock/mkdir fallback), PATH block with begin/end markers, prompts "Start Codex now?" and "Uninstall the existing <npm|brew|bun>-managed Codex now?"; install.ps1 1089 lines, `param([string]$Release = $env:CODEX_RELEASE)`, `Get-FileHash … SHA256`, extracts with built-in `tar -xzf`. docs/install.md still lists "Windows 11 via WSL2" while the README ships the native ps1 installer. npm `@openai/codex` 0.154.0 (17.1M dl/wk); GitHub releases/latest = `rust-v0.154.0`.
- Local CLIs: `codex update` ("Update Codex to the latest version"), `codex plugin {add,list,marketplace{add,list,upgrade,remove},remove}`, `codex mcp {list,get,add,remove,login,logout}`, `claude plugin install` `-s/--scope user|project|local` (default user), `--json`, `--config <key=value>`, `-y/--yes`, `--accept-command <sha256>`; `claude mcp add` `-t/--transport stdio|sse|http`, `-H/--header`, `-e/--env`, `-s/--scope`.
- chezmoi: `sh -c "$(curl -fsLS https://get.chezmoi.io)"`, `-- -b $HOME/.local/bin`, `-- init --apply $GITHUB_USERNAME`, `iex "&{$(irm 'https://get.chezmoi.io/ps1')}"`, `winget install twpayne.chezmoi`, `scoop install chezmoi`, `choco install chezmoi`, `cosign verify-blob --key=chezmoi_cosign.pub …`, `sha256sum --check chezmoi_2.72.2_checksums.txt --ignore-missing`; upgrade methods `brew-upgrade`, `replace-executable`, `snap-refresh`, `sudo-upgrade-package`, `upgrade-package`; `--method`; honours `$CHEZMOI_GITHUB_ACCESS_TOKEN`/`$CHEZMOI_GITHUB_TOKEN`/`$GITHUB_ACCESS_TOKEN`/`$GITHUB_TOKEN`; "might have been removed by the package maintainer". Installer sizes 375/276 lines.
- rustup: `#!/bin/sh`, 930 lines, `-y, --yes`, `--no-modify-path`, `RUSTUP_UPDATE_ROOT` default `https://static.rust-lang.org/rustup`, exact error "Unable to run interactively. Run with -y to accept defaults, --help for additional options"; `rustup self update`, `auto-self-update` = `enable|disable|check-only`, `--no-self-update`, `--no-default-features` builds cannot self-update.
- uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`, `curl -LsSf https://astral.sh/uv/0.12.15/install.sh | sh`, `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"` (+ pinned `/0.12.15/install.ps1`), `winget install --id=astral-sh.uv  -e`, `uv self update`, `UV_NO_MODIFY_PATH=1`; sh installer 2191 lines / ps1 676 lines with `INSTALLER_DOWNLOAD_URL`, `INSTALLER_PRINT_VERBOSE/QUIET`, `UV_UNMANAGED_INSTALL`; receipt shows `"provider":{"source":"cargo-dist","version":"0.32.0"}` (uv 0.12.15 was built with dist 0.32.0; dist latest is 0.33.0). PEP 723: `# /// script`, `uv add --script`, `uv lock --script example.py`, `#!/usr/bin/env -S uv run --script`.
- cargo-dist: installers `shell`, `powershell`, `npm`, `homebrew`, `msi`; `install-updater = true` → `yourpackage-update`; axoupdater crate; `AXOUPDATER_GITHUB_TOKEN` for CI.
- gum: `brew install gum`, `winget install charmbracelet.gum`, `scoop install charm-gum`, `pacman -S gum`, `dnf install gum`, apt lines (README also has `sudo mkdir -p /etc/apt/keyrings` first), `go install charm.land/gum/v2@latest`; `--no-limit`, `--limit`, `--header`, `input --password`; `--selected` is not in the README but is in `choose/options.go` (`Selected []string`, "selects all if given *", env `GUM_CHOOSE_SELECTED`).
- Omakub `first-run-choices.sh` line 7 exactly as quoted; `app-gum.sh` pins `GUM_VERSION="0.17.0"` .deb. Omarchy `omarchy-update`: `# -y is a promise not to ask anything`, `script -qefc "$script_command" "/tmp/omarchy-update.log"`, `omarchy-update-lock`, `omarchy-snapshot create`.
- oh-my-zsh: `sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended`, `--keep-zshrc`, `--skip-chsh`, env `CHSH`/`RUNZSH`/`KEEP_ZSHRC`; update modes prompt|auto|reminder|disabled; `git fetch --quiet` + `git pull --quiet --rebase`.
- bun: `bun build ./cli.ts --compile --outfile mycli`; targets `bun-linux-x64`, `bun-linux-arm64`, `bun-windows-x64`, `bun-windows-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`, `bun-linux-x64-musl`, `bun-linux-arm64-musl`; `--minify --sourcemap --bytecode`; `.exe` auto-added; `--windows-icon=`, `--windows-hide-console`. deno: targets incl. `aarch64-pc-windows-msvc` "starting in Deno 2.9.3", `--icon`; installers 116/52 lines; bun installers 326/319 lines. Node SEA: "Stability: 1.1 - Active development". nodejs.org snippets (nvm v0.40.7, fnm, `winget install Schniz.fnm`, brew, choco) verbatim; LTS v24.21.0 (Krypton, 2026-09-07).
- npm/PyPI: `@clack/prompts` 1.8.1 (engines `>= 20.12.0`, 18,255,406 dl/wk; README documents `autocompleteMultiselect`, types expose `initialValues?: Value[]`), `@inquirer/prompts` 8.7.2 / `inquirer` 14.2.2 (engines `>=23.5.0 || ^22.13.0 || ^20.17.0`; 28.8M / 34.3M dl/wk), `prompts` 2.4.2 (44.5M), `enquirer` 2.4.1 (24.8M); questionary 2.1.1 (2025-08-28), textual 8.2.8 (2026-06-30), rich 15.0.0, typer 0.27.2, keyring 25.7.0 (description contains `keyring set system username`, Windows Credential Locker, Freedesktop Secret Service, KWallet).
- Microsoft docs: "`winget` isn't available on Windows Server 2022 or earlier versions. Windows Server 2025 includes `winget` for **Windows Server with Desktop Experience** only."; winget supported on "Windows 10 version 1809 (build 17763) or later"; `--disable-interactivity`, `export`, `import`, `configure`; `winget install --id Microsoft.PowerShell --source winget` (new: since the 7.6.0 winget package this installs MSIX by default; `--installer-type wix` for MSI; 7.7.0+ has no MSI); silent MSI example `msiexec.exe /package PowerShell-7.6.6-win-x64.msi /quiet … ADD_PATH=1`; "MSI package - Best choice for Windows Servers". SecretManagement: "The PowerShell team has decided that Secret modules are feature complete and will no longer be actively developed. … The code repository has been archived." (SecretManagement v1.1.2, SecretStore v1.0.6). cmdkey `/generic /user /pass /list /delete`, "Passwords are not displayed after they're stored." ConvertFrom-SecureString: "If no key is specified, the Windows Data Protection API (DPAPI) is used", "The contents of a SecureString aren't encrypted on non-Windows systems".
- secret-tool manpage: `secret-tool store --label='My password' key1 value1 key2 value2`, `secret-tool lookup key1 value1 …`, `secret-tool clear key1 value1 …`. ss64 `security`: `add-generic-password -a $USER -s 'PASS64' -w this_is_the_secret`, `-U` "Update item if it already exists", `find-generic-password -a "$USER" -w -s 'PASS64'`, `delete-generic-password -a "$USER" -s 'PASS64'`.
- gh: `gh attestation verify [<file-path> | oci://<image-uri>] [--owner | --repo] [flags]`, `--bundle`, `--signer-repo`, `--format`, `--deny-self-hosted-runners`, `slsa.dev/provenance/v1`; docs.github.com uses `actions/attest@v4`, `subject-path`, permissions `id-token: write` + `attestations: write`.
- devcontainer features page: `installsAfter`, `dependsOn`, `legacyIds`, `deprecated`, `proposals`, `enum`, `boolean`; options are exported via `toUpperCase()` as env vars for `install.sh`.
- yq TOML page: `yq -oy '.' sample.toml` (decode) and `yq -o toml '.' sample.yml` (encode). goreleaser: default `{{ .ProjectName }}_{{ .Version }}_checksums.txt`, `algorithm: sha256`, split `{{ .ArtifactName }}.{{ .Algorithm }}`.
- winget-pkgs manifest dirs (HTTP 200): `j/jqlang/jq`, `m/MikeFarah/yq` (note lowercase `m/` directory, `M/` 404s), `c/charmbracelet/gum`, `o/OpenJS/NodeJS/LTS`, `a/astral-sh/uv`, `a/Anthropic/ClaudeCode`, `o/OpenAI/Codex`, `g/Git/Git`, `m/Microsoft/PowerShell`, `j/jdx/mise`, `s/Schniz/fnm`, `t/twpayne/chezmoi`.

### New facts found while verifying

- `codex update` behaviour (open question closed): see §5 — method-detecting updater in `codex-rs/tui/src/update_action.rs`.
- `codex mcp add` flags (open question closed): `--url`, `--bearer-token-env-var`, `--env`, OAuth options; no generic header flag.
- GitHub attestations need GitHub Enterprise Cloud for private/internal repos (open question closed).
- Claude Code: `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1` makes Claude run `brew upgrade`/`winget upgrade` itself; Homebrew has two casks (`claude-code` = stable, `claude-code@latest` = latest); `claude doctor` reports last update attempt; custom launchers at `~/.local/bin/claude` are preserved since v2.1.207.
- Claude install.sh: zstd fast path (`manifest.zst.json`, `claude.zst`) with fallback; rejects non-version content from `/latest`; jq used when available, otherwise a built-in parser.
- Codex install.sh detects the conflicting manager by path (`/opt/homebrew/*|/usr/local/*` → brew, `*".bun"*` → bun, else npm) and offers `brew uninstall --cask codex` / `bun remove -g @openai/codex` / `npm uninstall -g @openai/codex`.
- Codex installer sets `RELEASES_BASE_URL="https://releases.openai.com/codex"` and warns "releases.openai.com is unavailable; falling back to GitHub Releases."
- PowerShell 7.6.6 is current LTS; `winget install --id Microsoft.PowerShell --source winget --installer-type wix` forces the MSI.
- gum `--selected '*'` selects everything (useful for "default = everything").

### Still open (could not be sourced)

- Codex standalone uninstall procedure (no `uninstall` verb in install.sh/ps1; docs page is JS-rendered and shows no uninstall section).
- Bun `--compile` output size (docs give no number).
- Node MSI silent-install flags for Windows Server 2022 without winget.
