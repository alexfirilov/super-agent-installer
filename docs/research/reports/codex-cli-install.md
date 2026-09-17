# OpenAI Codex CLI: install, update and configuration mechanics (as of 2026-09-16)

Researcher note: all commands below were copied from fetched primary sources (official docs at
learn.chatgpt.com — every `developers.openai.com/codex/*` URL now 308-redirects there — the openai/codex
repo README/docs/source on `main`, the release `install.sh`/`install.ps1` assets, the npm registry, the
Homebrew API, and the local `codex 0.154.0 --help` output). Where a claim is inferred or comes from a
secondary source it is labelled as such. Items marked **[verified 2026-09-16]** were re-fetched in this pass.

Local baseline on this Ubuntu 26.04 host: `codex-cli 0.154.0`, installed by the **standalone
installer** (`~/.local/bin/codex -> ~/.codex/packages/standalone/current/bin/codex`, release dir
`~/.codex/packages/standalone/releases/0.154.0-x86_64-unknown-linux-musl/`, `codex-package.json`
`{"layoutVersion":1,"version":"0.154.0","target":"x86_64-unknown-linux-musl","variant":"codex",
"entrypoint":"bin/codex","resourcesDir":"codex-resources","pathDir":"codex-path"}`). The bundle
ships `bin/codex`, `bin/codex-code-mode-host`, `codex-path/rg`, `codex-resources/{bwrap,zsh}`.
`~/.codex/version.json` = `{"latest_version":"0.154.0","last_checked_at":"2026-09-16T12:14:01Z"}`.
`~/.codex/config.toml` and `~/.codex/auth.json` are mode 0600; config currently has
`[projects."/home/alexf/code/ai-job-search"]`, `[projects."/home/alexf"]`, `[tui.model_availability_nux]`, `[notice]`.

---

## 0. TL;DR for the installer script

| Decision | Recommendation | Why |
|---|---|---|
| Install path (Linux/macOS) | `curl -fsSL https://chatgpt.com/codex/install.sh \| CODEX_NON_INTERACTIVE=1 sh` | Official, no Node dependency, SHA-256 verified, idempotent, `codex update` self-updates it |
| Install path (Windows native) | `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 \| iex"` (with `$env:CODEX_NON_INTERACTIVE=1`) | Official; puts `codex.exe` in `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`, updates user PATH |
| Update | `codex update` (built in since rust-v0.128.0); fallback = re-run installer with `CODEX_NON_INTERACTIVE=1` | Detects npm/bun/pnpm/vp/brew/standalone and runs the matching command |
| Pin a version | `CODEX_RELEASE=0.154.0` env or `install.sh --release 0.154.0` | Supported by both scripts |
| Auth (headless) | `codex login --device-auth` (beta), or `printenv OPENAI_API_KEY \| codex login --with-api-key`, or copy `~/.codex/auth.json` | Documented headless paths |
| Config | Write TOML into `~/.codex/config.toml`; **no `codex config set` exists** | Only `codex features enable|disable`, `codex mcp add|remove`, `codex plugin marketplace add|remove`, `codex plugin add|remove` write config for you |
| Trust dirs | `[projects."/abs/path"]\ntrust_level = "trusted"` in `~/.codex/config.toml` | Same key the TUI "Trust this folder?" prompt persists |
| MCP | `codex mcp add <name> [--env K=V] -- <cmd...>` / `codex mcp add <name> --url <url> [--bearer-token-env-var VAR]` | Writes `[mcp_servers.<name>]` |
| Plugins | `codex plugin add <plugin>@<marketplace> --json`; implicit marketplaces `openai-curated` (git openai/plugins) and `openai-curated-remote` (remote catalog) | superpowers is `superpowers@openai-curated` / `@openai-curated-remote` v6.3.0 |
| Skills | canonical user dir `~/.agents/skills`; `~/.codex/skills` still read (deprecated); repo `.agents/skills` and `.codex/skills`; `npx skills add <repo> -a codex -g` writes `~/.codex/skills` | All Agent-Skills-standard `SKILL.md` |
| Linux prereq | `sudo apt install bubblewrap` (+ AppArmor profile on Ubuntu 24.04) | Sandbox is bubblewrap since 0.115; bundled bwrap needs unprivileged userns |
| Claude→Codex | TUI `/import` (Claude Code: settings.json→config.toml, skills, plugins, MCP, hooks, slash commands, subagents, memories) | Interactive only |

---

## 1. Source snapshot (observed 2026-09-16)

| Item | Value | Source |
|---|---|---|
| Latest GitHub release | `rust-v0.154.0`, published 2026-09-09T22:35:38Z **[verified]** | https://api.github.com/repos/openai/codex/releases/latest |
| openai/codex repo | 124,735 stars, 19,285 forks, pushed 2026-09-16T22:33Z, Apache-2.0 **[verified]** | https://api.github.com/repos/openai/codex |
| npm `@openai/codex` | `latest` `0.154.0` (published 2026-09-09T22:40Z), `alpha` `0.155.0-alpha.14` (was alpha.13 on 2026-09-16; re-checked 2026-09-17); per-platform dist-tags `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64` (+ `alpha-*` variants); `engines.node >=16`; `bin: {codex: bin/codex.js}` **[verified]** | https://registry.npmjs.org/@openai/codex |
| Homebrew cask `codex` | 0.154.0; installs 30d 104,767 / 90d 288,901 / 365d 792,840 **[verified]** | https://formulae.brew.sh/api/cask/codex.json |
| Homebrew formula `codex` | does not exist (404) **[verified]** | https://formulae.brew.sh/api/formula/codex.json |
| PyPI `openai-codex-cli-bin` | 0.154.0 "Pinned Codex CLI runtime for the Python SDK" | https://pypi.org/pypi/openai-codex-cli-bin/json |
| npm `@openai/codex-sdk` | 0.154.0 | https://registry.npmjs.org/@openai/codex-sdk/latest |
| Docs domain | `developers.openai.com/codex/*` → 308 → `learn.chatgpt.com/docs/*` (e.g. `/codex/cli`→`/docs/codex/cli`, `/codex/config`→`/docs/config`, `/codex/plugins`→`/docs/plugins`, `/codex/skills`→`/docs/build-skills`, `/codex/mcp`→`/docs/extend/mcp?surface=cli`, `/codex/hooks`→`/docs/hooks`, `/codex/cli/reference`→`/docs/developer-commands?surface=cli`); append `.md` for Markdown; index https://learn.chatgpt.com/llms.txt **[verified]** | curl -I |
| openai/plugins (curated marketplace) | 6,855 stars **[verified]**; catalog name `openai-curated`, 65 plugins | https://github.com/openai/plugins |
| vercel-labs/skills (`npx skills`) | 31,800 stars; npm `skills` 1.5.26 **[verified]** | https://github.com/vercel-labs/skills |
| obra/superpowers | 287,602 stars; ships `.codex-plugin/plugin.json` **[verified]** | https://github.com/obra/superpowers |
| JuliusBrussee/caveman | 106,031 stars; npm `@caveman-ai/cli` 1.3.4 (local 1.3.3) **[verified]** | https://github.com/JuliusBrussee/caveman |
| winget `OpenAI.Codex` | manifests in microsoft/winget-pkgs are opened by **OpenAI's own release workflow** (`rust-release.yml` job `winget`, `vedantmgoyal9/winget-releaser`, fork-user `openai-oss-forks`, installers `codex-{x86_64,aarch64}-pc-windows-msvc.exe.zip`), 124 version dirs, latest merged **0.152.0** (lags 0.154.0); still not on the Getting Started page and not detected by `codex update` **[verified 2026-09-17]** | https://github.com/microsoft/winget-pkgs/tree/master/manifests/o/OpenAI/Codex |

Changelog (https://learn.chatgpt.com/docs/changelog): 0.154.0 (2026-09-09) GPT-6-Astra in picker, experimental
`--worktree`, "Windows sessions can now share a background Codex server, with daemon lifecycle commands and
managed updates", "Report managed filesystem policy in `codex doctor`"; 0.153.0 (2026-09-03) "The plugin CLI
can list, install, and remove plugins from remote marketplaces", "Existing sessions pick up newly installed
plugin tools and refresh skills and hooks after external plugin upgrades or rollbacks"; 2026-09-05 "`codex
mcp-server` command and standalone `codex-mcp-server` binary have been removed" (use the app server).
`codex update` first shipped in **rust-v0.128.0** ("Added `codex update`, configurable TUI keymaps, …", PR #19933;
release page dated 30 Apr 2026; PR #19933 "Add `codex update` command" merged 2026-04-28) **[verified via https://github.com/openai/codex/releases/tag/rust-v0.128.0 and https://github.com/openai/codex/pull/19933]**.

---

## 2. Official install methods

The official Getting-started page (https://learn.chatgpt.com/docs/codex/cli) lists exactly four methods, each
with the same command for install and update **[verified]**:

| Method | Install | Update (per docs) |
|---|---|---|
| macOS/Linux standalone | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` | same command |
| Windows standalone | `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 \| iex"` | same command |
| npm | `npm install -g @openai/codex` | `npm install -g @openai/codex` |
| Homebrew | `brew install --cask codex` | `brew upgrade --cask codex` |

### 2.1 Standalone installer, macOS/Linux (`install.sh`) — RECOMMENDED

From README (https://github.com/openai/codex/blob/main/README.md):

```shell
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

Unattended (https://learn.chatgpt.com/docs/config-file/environment-variables) **[verified]**:

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh
```

Force GitHub Releases instead of `https://releases.openai.com/codex` (README):

```shell
curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_INSTALLER_USE_RELEASES_OPENAI_COM=false sh
```

Script facts (read from the `install.sh` asset of rust-v0.154.0, 1209 lines, POSIX `sh`):

| Knob | Default | Notes |
|---|---|---|
| `CODEX_RELEASE` / `--release VERSION` | `latest` | accepts `x.y.z`, `x.y.z-alpha.N`, `x.y.z-beta.N`, `rust-v` prefix stripped |
| `CODEX_NON_INTERACTIVE` | `false` | `1|true|yes` makes every prompt take its default (No): does not uninstall conflicting installs, does not launch codex. Docs: "use this for scripted installs and updates, not first-run setup" |
| `CODEX_INSTALL_DIR` | `$HOME/.local/bin` | visible `codex` symlink location |
| `CODEX_HOME` | `$HOME/.codex` | package cache root `$CODEX_HOME/packages/standalone/{releases,current,install.lock}` |
| `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM` | `true` | primary CDN `https://releases.openai.com/codex`, falls back to GitHub |
| Requirements | `curl` or `wget`, `tar`, `mktemp`, `sha256sum`/`shasum`/`openssl` | |
| Platforms | Darwin x86_64 (Rosetta → aarch64), Darwin aarch64, Linux x86_64, Linux aarch64; anything else exits with "install.sh supports macOS and Linux. Use install.ps1 on Windows." | |
| Asset | `codex-package-<target>.tar.gz` verified against `codex-package_SHA256SUMS` (falls back to legacy `codex-npm-<tag>-<ver>.tgz`) | targets `x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`, `x86_64-apple-darwin`, `aarch64-apple-darwin` |
| Layout | `$CODEX_HOME/packages/standalone/releases/<ver>-<target>/` then `current -> releases/...` symlink, `$BIN_DIR/codex -> $CURRENT_LINK/bin/codex` (macOS also `codex-code-mode-host`) | previous releases are kept (this host has 0.153.4 and 0.154.0) |
| PATH | appends a block `# >>> Codex installer >>>` … `export PATH="$BIN_DIR:$PATH"` … `# <<< Codex installer <<<` to `~/.zprofile` (zsh), `~/.bash_profile` (bash) or `~/.profile` | idempotent (markers) |
| Conflicts | detects existing `codex` on PATH that is brew (`/opt/homebrew/*`, `/usr/local/*` on macOS), npm (`#!/usr/bin/env node` shebang) or bun (`.bun` in path); offers `brew uninstall --cask codex`, `npm uninstall -g @openai/codex`, `bun remove -g @openai/codex`; otherwise warns "PATH order will determine which codex runs" | |
| Locking | `flock`/`lockf`/mkdir lock, stale after 600 s | safe to run concurrently |
| Linux extra | `codex-resources/bwrap` must be executable for the release to count as complete | bundled bubblewrap fallback |

### 2.2 Standalone installer, Windows (`install.ps1`) — RECOMMENDED for native Windows

README:

```shell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
```

Unattended (exact string `codex update` itself runs, from codex-rs/tui/src/update_action.rs **[verified]**):

```powershell
powershell -ExecutionPolicy Bypass -c "$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 | iex"
```

Force GitHub:

```powershell
$env:CODEX_INSTALLER_USE_RELEASES_OPENAI_COM='false'; irm https://chatgpt.com/codex/install.ps1 | iex
```

Script facts (from the `install.ps1` asset, 1089 lines, `Set-StrictMode -Version Latest`, uses `Add-Type`
C# for NTFS junctions, so Windows PowerShell 5.1 or pwsh both work):

- Targets: `x86_64-pc-windows-msvc` (`win32-x64`) and `aarch64-pc-windows-msvc` (`win32-arm64`).
- Package root: `%USERPROFILE%\.codex\packages\standalone\{releases,current}` (`CODEX_HOME` honoured);
  `current` is a junction.
- Visible command: `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe` (override `CODEX_INSTALL_DIR`),
  alongside `rg.exe` and `codex-resources\codex-windows-sandbox-setup.exe`.
- PATH: prepends the bin dir to the **user** PATH via
  `[Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")` and the current session `$env:Path`.
- Conflict detection for npm (`node_modules`/`\npm\`) and bun installs, same prompt semantics.
- Same `CODEX_RELEASE`, `-Release`, `CODEX_NON_INTERACTIVE`, `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM`
  knobs; SHA-256 verification with `Get-FileHash`.

### 2.3 npm

README / docs:

```shell
npm install -g @openai/codex
```

Registry facts **[verified]**: `bin: {codex: bin/codex.js}`, `engines.node >=16`, no `os`/`cpu` restriction, platform
binaries pulled through `optionalDependencies` (`@openai/codex-linux-x64: npm:@openai/codex@0.154.0-linux-x64`,
`…-win32-x64`, `…-darwin-x64`, `…-linux-arm64`, `…-win32-arm64`, `…-darwin-arm64`). Update:
`npm install -g @openai/codex` (this is exactly what `codex update` runs for npm installs). Pre-release:
`npm install -g @openai/codex@alpha` (dist-tag `alpha` = 0.155.0-alpha.14 on 2026-09-17). The installer scripts treat an
npm-managed `codex` as a conflict, so pick one method per host. Binary lives under the npm global prefix
(`$(npm prefix -g)/lib/node_modules/@openai/codex` + `bin/codex` shim).

### 2.4 Homebrew (macOS; cask also declares Linux variations)

README / docs:

```shell
brew install --cask codex
brew upgrade --cask codex
```

Cask `codex` 0.154.0 downloads `codex-package-aarch64-apple-darwin.tar.gz`, installs `bin/codex` to
`$HOMEBREW_PREFIX/bin/codex`, generates bash/zsh/fish completions, and `zap` removes `~/.codex` **[verified]**.
`codex update` runs `brew upgrade --cask codex`. There is **no formula**, only a cask (formula API → 404). **[verification 2026-09-17]** the cask JSON has `variations` for `x86_64_linux` and `arm64_linux` (pointing at `codex-package-*-unknown-linux-musl.tar.gz`) and an Intel macOS variation (`codex-package-x86_64-apple-darwin.tar.gz`), `autobump: true`, `depends_on: {}`. However `codex update`'s install-context only classifies a brew install when `is_macos && exe under /opt/homebrew|/usr/local`, so a Linuxbrew-installed codex would be mis-detected as npm-managed — use the standalone installer on Linux.

### 2.5 GitHub Releases binaries (manual)

README "latest GitHub Release" list: macOS arm64 `codex-aarch64-apple-darwin.tar.gz`, macOS x86_64
`codex-x86_64-apple-darwin.tar.gz`, Linux x86_64 `codex-x86_64-unknown-linux-musl.tar.gz`, Linux arm64
`codex-aarch64-unknown-linux-musl.tar.gz`; "Each archive contains a single entry with the platform baked
into the name … so you likely want to rename it to `codex` after extracting it."

Full asset naming in rust-v0.154.0 (from the releases API, 2026-09-16 **[verified]**):

| Family | Assets |
|---|---|
| Single binary | `codex-{aarch64,x86_64}-apple-darwin.{tar.gz,zst,dmg}`, `codex-{aarch64,x86_64}-unknown-linux-musl.{tar.gz,zst}` (+ `.sigstore` bundles), `codex-{aarch64,x86_64}-pc-windows-msvc.exe{,.zip,.tar.gz,.zst}` |
| Package bundles (what the installers use) | `codex-package-<target>.tar.{gz,zst}` for all 6 targets + `codex-package_SHA256SUMS` |
| Windows sandbox | `codex-windows-sandbox-setup-{aarch64,x86_64}-pc-windows-msvc.exe`, `codex-command-runner-*-pc-windows-msvc.exe` |
| Linux sandbox helper | `bwrap-{aarch64,x86_64}-unknown-linux-musl.{tar.gz,zst,sigstore}` |
| npm tarballs | `codex-npm-0.154.0.tgz`, `codex-npm-{darwin,linux,win32}-{x64,arm64}-0.154.0.tgz`, `codex-sdk-npm-0.154.0.tgz` |
| Python wheels | `openai_codex_cli_bin-0.154.0-py3-none-{manylinux_2_17_x86_64,manylinux_2_17_aarch64,macosx_11_0_arm64,macosx_10_9_x86_64,win_amd64,win_arm64}.whl` |
| Other | `codex` (DotSlash file), `config-schema.json`, `install.sh`, `install.ps1`, `codex-app-server-*` (+ `codex-app-server-package-*`), `codex-code-mode-host-*`, `codex-responses-api-proxy-*`, `codex-symbols-*` |

Note: there are **no glibc (`-gnu`) Linux builds of the CLI**; Linux is musl-static only (the only `-gnu`
assets are for the unrelated `argument-comment-lint` tool). docs/install.md also documents a DotSlash file.

Manual download pattern (constructed from the verified asset names — the only non-copied command in this report):
`https://github.com/openai/codex/releases/download/rust-v0.154.0/codex-x86_64-unknown-linux-musl.tar.gz`
(or `/latest/download/<asset>`).

### 2.6 winget / scoop / choco

- No official winget package for the **CLI** is documented by OpenAI. The only official `winget` line is for the
  ChatGPT desktop app: `winget install --id 9PLM9XGG6VKS -s msstore` (https://learn.chatgpt.com/docs/windows/windows-app).
  The Windows-sandbox doc only says "`winget` should be available" as an environment assumption.
- Community manifest `OpenAI.Codex` exists in microsoft/winget-pkgs (124 versions, latest 0.152.0 on 2026-09-16)
  **[verified]**; it lags releases and `codex update` does not know about it → treat as unofficial; do not use.
- No scoop/choco mention anywhere official.

### 2.7 Other package managers recognised by `codex update` (not documented as install paths)

`install-context` crate **[verified]** recognises env overrides `CODEX_MANAGED_BY_VITE_PLUS`, `CODEX_MANAGED_BY_PNPM`,
`CODEX_MANAGED_BY_NPM`, `CODEX_MANAGED_BY_BUN`; `codex update` will run `bun install -g @openai/codex`,
`pnpm add -g @openai/codex`, `vp install -g @openai/codex` respectively.

### 2.8 Build from source

docs/install.md: `git clone https://github.com/openai/codex.git && cd codex/codex-rs && cargo build`
(Rust toolchain, `just`, `dotslash`, `cargo-nextest`).

---

## 3. `codex update` mechanics

Docs (https://learn.chatgpt.com/docs/developer-commands): "Check for and apply a Codex CLI update when the
installed release supports self-update. Debug builds print a message telling you to install a release build
instead." Local help **[verified]**: `codex update [-c key=value] [--enable F] [--disable F]` — there is **no**
`--check` flag in 0.154.0 (a secondary blog claims one; the binary does not expose it).

Detection order (codex-rs/install-context/src/lib.rs, main **[verified]**):
1. env override `CODEX_MANAGED_BY_VITE_PLUS` > `CODEX_MANAGED_BY_PNPM` > `CODEX_MANAGED_BY_NPM` > `CODEX_MANAGED_BY_BUN`;
2. if `current_exe` resolves under `$CODEX_HOME/packages/standalone` → `Standalone{Unix|Windows}`;
3. macOS and exe under `/opt/homebrew` or `/usr/local` → `Brew`;
4. otherwise npm (fallback).

Commands executed (codex-rs/tui/src/update_action.rs **[verified]**):

| Method | Command |
|---|---|
| npm | `npm install -g @openai/codex` |
| bun | `bun install -g @openai/codex` |
| pnpm | `pnpm add -g @openai/codex` |
| Vite+ | `vp install -g @openai/codex` |
| Homebrew | `brew upgrade --cask codex` |
| Standalone Unix | `sh -c 'curl -fsSL https://chatgpt.com/codex/install.sh \| CODEX_NON_INTERACTIVE=1 sh'` |
| Standalone Windows | `powershell -ExecutionPolicy Bypass -c "$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 \| iex"` |
| Background daemon (Windows shared server, 0.154.0) | `codex app-server daemon update [--from-cli --yes]` |

Update-availability check (codex-rs/tui/src/updates.rs): brew → `https://formulae.brew.sh/api/cask/codex.json`
(because "homebrew … can lag behind"); npm family → npm registry; standalone → latest GitHub release.
Config: `check_for_update_on_startup = true` (set false "only when updates are centrally managed");
requirements.toml `features.in_app_updates = false` disables in-app updates. Known issue #24035
(0.132/0.133, open): mixed npm+standalone installs were mis-detected; avoid mixed installs.

---

## 4. Windows support status

- Native Windows is supported in PowerShell with a **native Windows sandbox**; "The app can run natively in
  PowerShell with a Windows sandbox instead of requiring WSL or a virtual machine"
  (https://learn.chatgpt.com/docs/windows/windows-sandbox **[verified]**). Version matrix: Windows 11 "Recommended";
  "Recent, fully updated Windows 10" "Best effort" (needs ConPTY; 1809+); older Win10 "Not recommended".
  Environment assumptions: "`winget` should be available", "The recommended native sandbox depends on
  administrator-approved setup", some enterprise-managed devices block setup.
- Sandbox modes in `config.toml`:

```toml
[windows]
sandbox = "elevated" # or "unelevated"
```

  `elevated` (preferred) uses dedicated lower-privilege sandbox users, firewall rules and local policy (admin prompt);
  `unelevated` (fallback) uses a restricted token + ACLs and "the dedicated offline-user firewall rule".
  `windows.sandbox_private_desktop` (default true). TUI `/setup-default-sandbox` runs the elevated setup;
  `/sandbox-add-read-dir C:\absolute\directory\path` grants reads. Diagnostics: `CODEX_HOME/.sandbox/sandbox.log`;
  error 1385 = logon-right policy. Admin constraint: `[windows] allowed_sandbox_implementations = ["elevated"]` in requirements.toml.
- Docs guidance: "Use the native Windows sandbox by default. Choose WSL when you need Linux-native tooling, your
  workflow already lives in WSL2, or …".
- `features.unified_exec` defaults to true "except Windows". Hooks support a `commandWindows` override
  and managed `hooks.windows_managed_dir`. Config key `windows_wsl_setup_acknowledged` tracks onboarding.
- 0.154.0: "Windows sessions can now share a background Codex server, with daemon lifecycle commands and managed updates."
- WSL2 (https://learn.chatgpt.com/docs/windows/wsl): run the Linux installer inside WSL
  (`curl -fsSL https://chatgpt.com/codex/install.sh | sh`); keep repos under `/home`, not `/mnt/c`;
  "WSL1 was supported through Codex 0.114. Starting in Codex 0.115, the Linux sandbox moved to
  `bubblewrap`, so WSL1 is no longer supported."
- Stale statement: the repo's docs/install.md still says "Windows 11 **via WSL2**"; learn.chatgpt.com is current.

---

## 5. Linux specifics

- Requirements (docs/install.md): macOS 12+, Ubuntu 20.04+/Debian 10+, 4 GB RAM min (8 GB rec.), Git 2.23+ optional.
- Sandbox (https://learn.chatgpt.com/docs/sandboxing **[verified]**): "On **Linux and WSL2**, install `bubblewrap` with your
  package manager first": `sudo apt install bubblewrap` / `sudo dnf install bubblewrap`. "Codex uses the first `bwrap`
  executable it finds on `PATH`. If no `bwrap` executable is available, Codex falls back to a bundled helper, but that
  helper requires support for unprivileged user namespace creation." Codex prints a startup warning when bwrap is
  missing. Ubuntu 24.04 fix:

```bash
sudo apt update
sudo apt install apparmor-profiles apparmor-utils
sudo install -m 0644 \
  /usr/share/apparmor/extra-profiles/bwrap-userns-restrict \
  /etc/apparmor.d/bwrap-userns-restrict
sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict
```

  Ubuntu 25.04+ ships the profile in the `apparmor` package. Last resort: `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`.
  Landlock is legacy: `codex features list` shows `use_legacy_landlock deprecated false`, `use_linux_sandbox_bwrap removed false` **[verified]**.
  `codex sandbox [COMMAND]...` runs a command under the same Linux sandbox.
- Auth on headless/SSH hosts (https://learn.chatgpt.com/docs/auth **[verified]**):
  - Preferred: `codex login --device-auth` (beta; "Enable device code login in your ChatGPT security settings
    (personal account) or ChatGPT workspace permissions (workspace admin)"; interactive UI also offers "Sign in with Device Code").
  - API key: `printenv OPENAI_API_KEY | codex login --with-api-key`.
  - Access token: `printenv CODEX_ACCESS_TOKEN | codex login --with-access-token`.
  - Copy cache: `scp ~/.codex/auth.json user@remote:~/.codex/auth.json` or
    `ssh user@remote 'mkdir -p ~/.codex && cat > ~/.codex/auth.json' < ~/.codex/auth.json`
    (`docker cp ~/.codex/auth.json MY_CONTAINER:"$CONTAINER_HOME/.codex/auth.json"` for containers).
  - Tunnel: `ssh -L 1455:localhost:1455 user@remote` then `codex login` (callback `localhost:1455`).
  - `codex login status` exits 0 when credentials exist; `codex logout` clears.
  - Storage: `cli_auth_credentials_store = "file" | "keyring" | "auto" | "ephemeral"`; `file` = `$CODEX_HOME/auth.json`
    ("treat `~/.codex/auth.json` like a password").
  - Corporate CA: `export CODEX_CA_CERTIFICATE=/path/to/corporate-root-ca.pem` (takes precedence over `SSL_CERT_FILE`).
  - `codex-login.log` written under the log dir for login debugging.
- `CODEX_HOME` (default `~/.codex`): "Sets the root for Codex state, including config, auth, logs, sessions, skills,
  and standalone package metadata. If you set it, the directory must already exist." **[verified]** Contents observed
  locally: `config.toml`, `auth.json`, `history.jsonl`, `session_index.jsonl`, `sessions/`, `skills/.system/`,
  `plugins/cache/`, `packages/standalone/`, `memories_1.sqlite`, `state_5.sqlite`, `logs_2.sqlite`, `goals_1.sqlite`,
  `queue_1.sqlite`, `thread_history_1.sqlite`, `models_cache.json`, `version.json`, `installation_id`,
  `cache/remote_plugin_catalog/`, `shell_snapshots/`, `project-context/`, `tmp/`.

---

## 6. `config.toml`

### 6.1 Layers and precedence (https://learn.chatgpt.com/docs/config-file/config-basic)

Highest first: (1) CLI flags and `-c/--config` overrides; (2) project `.codex/config.toml` files root→cwd,
closest wins, **trusted projects only**; (3) profile file `~/.codex/<profile>.config.toml` selected with
`--profile <profile>` ("Layer $CODEX_HOME/<name>.config.toml on top of the base user config" per local help);
(4) `~/.codex/config.toml`; (5) cloud-managed `config.toml`; (6) `/etc/codex/config.toml`; (7) built-ins.
Separately, `managed_config.toml` (`/etc/codex/managed_config.toml`, Windows `~/.codex/managed_config.toml`)
and macOS MDM override the base at startup, and `requirements.toml` (`/etc/codex/requirements.toml`,
Windows `%ProgramData%\OpenAI\Codex\requirements.toml`, cloud, MDM) enforces allowlists.

Profiles changed in 0.134.0: `[profiles.<name>]` tables and top-level `profile = "..."` are no longer
read; use `~/.codex/<name>.config.toml` with top-level keys.

`-c key=value` **[verified local help]**: dotted path, value parsed as TOML (raw string if not TOML), e.g.
`-c model="o3"`, `-c 'sandbox_permissions=["disk-full-read-access"]'`, `-c shell_environment_policy.inherit=all`.
`--enable <feature>` == `-c features.<name>=true`. `--strict-config` errors on unknown keys.
Project configs ignore `openai_base_url`, `chatgpt_base_url`, `apps_mcp_product_sku`, `model_provider`,
`model_providers`, `notify`, `profile`, `profiles`, `experimental_realtime_ws_base_url`, `otel`.

### 6.2 Keys of interest (config reference https://learn.chatgpt.com/docs/config-file/config-reference **[verified]**)

| Key | Example / values | Notes |
|---|---|---|
| `model` | `model = "gpt-5.6-sol"` (docs example); local uses `gpt-6-astra` | `review_model`, `model_catalog_json` also exist |
| `model_reasoning_effort` | `minimal | low | medium | high | xhigh` ("xhigh is model-dependent") | `model_reasoning_summary`, `model_verbosity` exist |
| `model_provider` / `[model_providers.<id>]` | `base_url`, `env_key`, `wire_api`, `requires_openai_auth`, `http_headers`, `env_http_headers`, `auth.command` | `openai_base_url` shortcut for proxies; `--oss` with `--local-provider lmstudio|ollama` |
| `personality` | `none | friendly | pragmatic` | `/personality` at runtime |
| `approval_policy` | `"on-request"` \| `"never"` \| `{ granular = {...} }` | `"untrusted"` unsupported, `on-failure` deprecated |
| `approvals_reviewer` | `"user"` \| `"auto_review"` | guardian/auto review |
| `sandbox_mode` | `"read-only"` \| `"workspace-write"` \| `"danger-full-access"` | |
| `[sandbox_workspace_write]` | `writable_roots = [...]`, `network_access = false`, `exclude_tmpdir_env_var`, `exclude_slash_tmp` | |
| `default_permissions` / `[permissions.<name>]` | built-ins `:read-only`, `:workspace`, `:danger-full-access` | beta permission profiles; "Don't combine with `sandbox_mode`" |
| `web_search` | `disabled | cached | indexed | live` (default `cached`) | `--search` = live |
| `[projects."/abs/path"]` | `trust_level = "trusted"` \| `"untrusted"` | "Untrusted projects skip project-scoped `.codex/` layers, including project-local config, hooks, and rules" |
| `[features]` | `hooks`, `memories`, `multi_agent`, `personality`, `plugins`, `remote_plugin`, `plugin_sharing`, `skill_search`, `skill_mcp_dependency_install`, `fast_mode`, `apps`, `goals`, `shell_snapshot`, `unified_exec`, `network_proxy` | `codex features list|enable|disable` (writes `$CODEX_HOME/config.toml`; no `--profile`) |
| `[mcp_servers.<name>]` | see §6.3 | |
| `[marketplaces.<name>]` | `source_type = "git"|"local"`, `source`, `ref`, `sparse_paths` | written by `codex plugin marketplace add`; local `source` dir "contains .agents/plugins/marketplace.json" |
| `[plugins."name@marketplace"]` | `enabled = true`, `.mcp_servers.<server>.{enabled,default_tools_approval_mode,enabled_tools,disabled_tools,tools.<t>.approval_mode}` | "Marketplace refresh can install or refresh configured plugins even when disabled" |
| `[[skills.config]]` | `path = "/path/to/skill"`, `enabled = false`; `skills.max_context_tokens` (default 2% of context, cap 10000) | |
| `[memories]` | `generate_memories`, `use_memories`, `disable_on_external_context`, `max_raw_memories_for_consolidation`, `max_unused_days`, `max_rollout_age_days`, `max_rollouts_per_startup`, `min_rollout_idle_hours`, `min_rate_limit_remaining_percent`, `extract_model`, `consolidation_model` | |
| `[hooks]` / `hooks.json` | `[[hooks.PreToolUse]] matcher = "^Bash$"` … | see §10 |
| `notify` | `notify = ["python3", "/path/to/notify.py"]` | only `agent-turn-complete` |
| `[tui]` | `notifications`, `notification_method = auto|osc9|bel`, `notification_condition = unfocused|always`, `animations`, `alternate_screen`, `show_tooltips`, `theme`, `status_line`, `terminal_title`, `vim_mode_default`, `resume_cwd`, `auto_recap`, `[tui.keymap.<ctx>]` | `tui.model_availability_nux.<model>` is internal state |
| `[windows]` | `sandbox = "elevated"|"unelevated"`, `sandbox_private_desktop` | |
| `project_doc_max_bytes` | `32768` default | `project_doc_fallback_filenames = ["TEAM_GUIDE.md", ".agents.md"]` |
| `model_instructions_file` | path | replaces built-in instructions |
| `cli_auth_credentials_store` | `"file"|"keyring"|"auto"|"ephemeral"` | |
| `forced_login_method` / `forced_chatgpt_workspace_id` | `"chatgpt"|"api"` | managed |
| `check_for_update_on_startup` | `true` | |
| `[history]` | `persistence = "save-all"|"none"`, `max_bytes` | |
| `file_opener` | `"vscode"|"cursor"|"windsurf"|"vscode-insiders"|"none"` | |
| `[shell_environment_policy]` | `inherit`, `ignore_default_excludes`, `[shell_environment_policy.filters]` | |
| `log_dir`, `sqlite_home` | paths | `CODEX_SQLITE_HOME` env |
| `mcp_oauth_callback_port`, `mcp_oauth_callback_url`, `mcp_optional_startup_grace_ms` | | |
| `[agents]` | subagent roles | https://learn.chatgpt.com/docs/agent-configuration/subagents |
| `[notice]` | `hide_full_access_warning`, `hide_rate_limit_model_nudge`, `hide_world_writable_warning` | acknowledgement state |

Schema: config reference ends with `#:schema https://developers.openai.com/codex/config-schema.json` (308 → `https://learn.chatgpt.com/docs/config-schema.json`, `application/json` **[verified 2026-09-17]**); the
same `config-schema.json` is a release asset — usable for validation in the installer.

### 6.3 MCP servers (https://learn.chatgpt.com/docs/extend/mcp)

CLI (docs + local help **[verified]**):

```bash
codex mcp add <server-name> --env VAR1=VALUE1 --env VAR2=VALUE2 -- <stdio server-command>
codex mcp add context7 -- npx -y @upstash/context7-mcp
codex mcp add example --url https://mcp.example.com --oauth-client-id my-client
codex mcp list [--json]
codex mcp get <name> [--json]
codex mcp remove <name>
codex mcp login <server-name> [--scopes a,b] [--oauth-client-registration auto|cimd|dcr]
codex mcp logout <server-name>
```

Local `codex mcp add --help` (0.154.0): `codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)`,
options `--env KEY=VALUE` (stdio only), `--url`, `--bearer-token-env-var ENV_VAR` (HTTP only),
`--oauth-client-id`, `--oauth-client-registration auto|cimd|dcr`, `--oauth-resource`. Note: `--header`/`--http-headers`
is **not** a CLI flag; set `http_headers` in TOML. Docs: "Manage Model Context Protocol server entries stored in `~/.codex/config.toml`."

TOML keys — stdio: `command` (req), `args`, `env`, `env_vars`, `cwd`, `experimental_environment`;
HTTP: `url` (req), `auth = "oauth"|"chatgpt"`, `bearer_token_env_var`, `http_headers`, `env_http_headers`,
`http_headers_helper`, `[mcp_servers.<n>.oauth] client_id/callback_url/callback_port`;
common: `startup_timeout_sec` (10), `tool_timeout_sec` (60), `enabled`, `required`, `enabled_tools`,
`disabled_tools`, `default_tools_approval_mode = auto|prompt|writes|approve`, `tools.<t>.approval_mode`,
`tools.<t>.output_token_limit`. Examples from docs:

```toml
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
env_vars = ["LOCAL_TOKEN"]

[mcp_servers.context7.env]
MY_ENV_VAR = "MY_ENV_VALUE"
```

```toml
[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
bearer_token_env_var = "FIGMA_OAUTH_TOKEN"
http_headers = { "X-Figma-Region" = "us-east-1" }
```

Plugin-bundled MCP servers are controlled under `[plugins."sample@test".mcp_servers.sample]`. `codex mcp-server`
was removed (2026-09-05); use `codex app-server`. This host currently has `codex mcp list --json` → `[]`.

### 6.4 Non-interactive config merging

There is **no** `codex config set/get` (confirmed against `codex --help` subcommand list **[verified]**). Mechanisms that
write `~/.codex/config.toml` for you: `codex features enable|disable <name>`, `codex mcp add|remove`,
`codex plugin marketplace add|remove`, `codex plugin add|remove` (plugin enable state), TUI `/permissions`,
`/memories`, `/experimental`, `/model`, `/theme` (→ `tui.theme`), `/keymap` (→ `tui.keymap`), trust prompt.
Everything else must be written as TOML by the installer (recommend a TOML-aware merge, e.g. Python 3.11+
`tomllib` + a writer, and validate with `codex --strict-config exec ...` or the `config-schema.json`).
One-off values can be injected with `-c` without touching the file.

---

## 7. Skills (https://learn.chatgpt.com/docs/build-skills)

| Scope | Location | Notes |
|---|---|---|
| REPO | `$CWD/.agents/skills`, `$CWD/../.agents/skills`, …, `$REPO_ROOT/.agents/skills` | scanned from project root down to cwd (docs + `repo_agents_skill_roots` in source) |
| REPO | `<project .codex layer>/skills` i.e. `$REPO_ROOT/.codex/skills` | source: `ConfigLayerSource::Project` → `config_folder/skills` (trusted projects only) **[verified source]** |
| USER | `$HOME/.agents/skills` | documented canonical user scope |
| USER (deprecated, still read) | `$CODEX_HOME/skills` (`~/.codex/skills`) | source comment: "Deprecated user skills location (`$CODEX_HOME/skills`), kept for backward compatibility" (codex-rs/ext/skills/src/host_roots.rs) **[verified]**; this is where `$skill-installer` and `npx skills add -a codex -g` write |
| ADMIN | `/etc/codex/skills` | System config layer folder + `skills` |
| SYSTEM | bundled: `imagegen`, `openai-docs`, `plugin-creator`, `review-agent`, `skill-creator`, `skill-installer` | embedded in binary, cached to `$CODEX_HOME/skills/.system` by `install_system_skills` |
| PLUGIN | `~/.codex/plugins/cache/<mkt>/<plugin>/<ver>/skills/` | plugin skill roots |

- Format: `SKILL.md` with frontmatter `name`, `description`; optional `scripts/`, `references/`, `assets/`,
  `agents/openai.yaml` (`interface.*`, `policy.allow_implicit_invocation: false`,
  `dependencies.tools[] {type: "mcp", value, description, transport: "streamable_http", url}`).
  "Skills build on the open agent skills standard" (https://agentskills.io) **[verified]**; symlinked skill folders are followed.
- Invocation: `$skill-name` in the prompt or `/skills`; implicit matching by description. Skills catalog budget:
  `skills.max_context_tokens` default 2% of context window, cap 10000.
- Disable: `[[skills.config]] path = "/path/to/skill"; enabled = false`.
- `$skill-installer linear` (and `$skill-installer install https://github.com/openai/skills/tree/main/skills/.experimental/create-plan`)
  installs into `$CODEX_HOME/skills/<skill-name>` via `scripts/install-skill-from-github.py --repo openai/skills --path skills/.curated/<name> [--dest PATH] [--ref main] [--method auto|download|git]`.
  The openai/skills repo README now says it is deprecated in favour of openai/plugins.
- Feature flags **[verified local]**: `skill_search stable true`, `skill_mcp_dependency_install stable true`
  ("Allow prompting and installing missing MCP dependencies for skills (stable; on by default)");
  `skill_search` is not described in docs (behaviour inferred: dynamic skill selection / `dynamic_skill_selector` module in codex-rs/ext/skills).
- `npx skills` (vercel-labs/skills README **[verified]**): `npx skills add <owner/repo> [-g] [-a codex] [-y] [--skill name|'*'] [--all] [--copy]`;
  Codex row: project `.agents/skills/`, global `~/.codex/skills/`; `npx skills update [-g|-p] [-y] [skills...]`;
  `npx skills remove [skills]`; `npx skills ls -g`; symlink mode is default. Caveman's official Codex lines:
  `npx skills add JuliusBrussee/caveman -a codex -g` (INSTALL.md) and
  `npx skills add JuliusBrussee/caveman --skill '*' -a codex --yes -g` (README).
  Because `~/.codex/skills` is deprecated in Codex, prefer `-a universal`-style targets only if you want `~/.config/agents/skills`
  (not read by Codex) — i.e. keep `-a codex` (→ `~/.codex/skills`, still read) or copy into `~/.agents/skills` yourself.

---

## 8. Plugins

- A plugin bundles skills, MCP servers, browser extensions and hooks (https://learn.chatgpt.com/docs/plugins **[verified]**).
  Manifest formats (https://developers.openai.com/plugins/build/plugins **[verified]**): portable root `plugin.json`
  (`"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"`, `name`, `version`, `description`,
  `author`, `homepage`, `repository`, `license`, `keywords`, `extensions.com.openai.{apps,hooks,interface}`),
  `.codex-plugin/plugin.json` compatibility overlay/legacy ("remain supported as a compatibility fallback"), and
  "OpenAI also accepts legacy and Claude-compatible manifests, but new packages should use this format."
  Bundled MCP in root `mcp.json` ("Don't just rename `.mcp.json`"), hooks in `hooks/hooks.json` (env `PLUGIN_ROOT`,
  `PLUGIN_DATA`, plus `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` "for compatibility").
- Marketplaces (docs **[verified]**): repo `$REPO_ROOT/.agents/plugins/marketplace.json`, "a legacy-compatible marketplace at
  `$REPO_ROOT/.claude-plugin/marketplace.json`", personal `~/.agents/plugins/marketplace.json`; plus configured
  `[marketplaces.<name>]` (git/local) and the implicit `openai-curated` git marketplace
  (`https://github.com/openai/plugins.git`, catalog `.agents/plugins/marketplace.json`, name `openai-curated`,
  65 plugins on 2026-09-16 incl. `superpowers` (`source.path ./plugins/superpowers`, `policy.products ["CODEX"]`),
  `github`, `codex-security`, `vercel`, `supabase`, `sentry`, `cloudflare`, `datadog`, `notion`, `linear`, `figma`;
  API-key users get `.agents/plugins/api_marketplace.json` = `openai-api-curated`) and the remote catalog
  `openai-curated-remote` (feature `remote_plugin` "stable; on by default"; 3,935 entries on this account,
  3 installed by default: `openai-templates`, `sites`, `plugin-management`).
- Cache: `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/` (`local` for local plugins; "ChatGPT loads the
  installed copy from that cache path rather than directly from the marketplace entry"; remote installs carry
  `.codex-remote-plugin-install.json`). Local `codex plugin marketplace list --json`
  → `{"marketplaces":[{"name":"openai-curated","root":"/home/alexf/.codex/.tmp/plugins"}]}`.
- CLI (local help + docs **[verified]**):

```bash
codex plugin add sample@debug
codex plugin add sample --marketplace debug
codex plugin add superpowers@openai-curated --json
codex plugin list [--marketplace debug] [--json] [--available --json]
codex plugin remove sample@debug [--json]
codex plugin marketplace add owner/repo
codex plugin marketplace add owner/repo --ref main
codex plugin marketplace add https://github.com/example/plugins.git --sparse .agents/plugins
codex plugin marketplace add ./local-marketplace-root
codex plugin marketplace list
codex plugin marketplace upgrade
codex plugin marketplace upgrade marketplace-name
codex plugin marketplace remove marketplace-name
```

  `codex plugin add --json` prints `pluginId, name, marketplaceName, version, installedPath, authPolicy`;
  `codex plugin list --json` prints `installed` and `available` arrays (`pluginId, name, marketplaceName, version,
  installed, enabled, source, installPolicy, authPolicy, marketplaceSource`); marketplace add JSON includes
  `marketplaceName, installedRoot, alreadyAdded`. Sources: `owner/repo`, `owner/repo@ref`, HTTP(S) Git URL, SSH Git URL,
  local root dir; `--sparse` only for Git sources. TUI: `/plugins` (Space toggles enable). IDE extension does not support plugins.
- Per-repo enable: `.codex/config.toml` → `[plugins."my-plugin@local-repo"] enabled = true`.
- `plugin_sharing` (stable, true locally **[verified]**): "Publish a local plugin to your workspace" (workspace admin, via
  chatgpt.com/plugins → Personal → ⋯ → Publish); admins disable with `features.plugin_sharing = false` in cloud requirements.toml.
- Claude-plugin compatibility:
  - **superpowers**: official README **[verified]**: "Superpowers is available via the official Codex plugin marketplace"
    → in CLI: `/plugins` → search `superpowers` → "Install Plugin". Non-interactive equivalent (syntax verified, not executed):
    `codex plugin add superpowers@openai-curated --json`. Observed `superpowers@openai-curated-remote` v6.3.0 in
    `codex plugin list --available --json`. The obra/superpowers repo also ships `.codex-plugin/plugin.json` (HTTP 200 **[verified]**)
    and `.agents/plugins/marketplace.json` (name `superpowers-dev`), so
    `codex plugin marketplace add obra/superpowers` + `codex plugin add superpowers@superpowers-dev` is a dev-channel alternative.
  - **caveman**: repo has `.claude-plugin/marketplace.json` (200) but **no** `.codex-plugin/plugin.json` (404) and no
    `.agents/plugins/marketplace.json` (404) **[verified]**. Official Codex route is skills:
    `npx skills add JuliusBrussee/caveman -a codex -g`, optionally the proxy `npm install -g @caveman-ai/cli` then
    `caveman codex` (README: "Codex skips the shrink hook because its runtime rejects the rewrite (openai/codex#18491)").
    Because Codex accepts `.claude-plugin/marketplace.json` catalogs, `codex plugin marketplace add JuliusBrussee/caveman`
    may also work (unverified — not executed).
  - Anthropic's `claude-plugins-official` marketplace is a `.claude-plugin/marketplace.json` catalog; the
    same compatibility applies in principle (unverified).

---

## 9. AGENTS.md (https://learn.chatgpt.com/docs/agent-configuration/agents-md **[verified]**)

1. Global: "In your Codex home directory (defaults to `~/.codex`, unless you set `CODEX_HOME`), Codex reads
   `AGENTS.override.md` if it exists. Otherwise, Codex reads `AGENTS.md`. Codex uses only the first non-empty file at this level."
2. Project: "Starting at the project root (typically the Git root), Codex walks down to your current working directory …
   In each directory along the path, it checks for `AGENTS.override.md`, then `AGENTS.md`, then any fallback names in
   `project_doc_fallback_filenames`. Codex includes at most one file per directory."
3. "Codex skips empty files and stops adding files once the combined size reaches the limit defined by
   `project_doc_max_bytes` (32 KiB by default)."
Config: `project_doc_fallback_filenames = ["TEAM_GUIDE.md", ".agents.md"]`, `project_doc_max_bytes = 65536`.
Verify: `codex --ask-for-approval never "Summarize the current instructions."`; alternate home:
`CODEX_HOME=$(pwd)/.codex codex exec "List active instruction sources"`.

---

## 10. Hooks and memories

### Hooks (https://learn.chatgpt.com/docs/hooks **[verified]**)
- Enabled by default (`features.hooks` "Enable lifecycle hooks loaded from `hooks.json` or inline `[hooks]` config.
  `features.codex_hooks` is a deprecated alias"; locally `hooks stable true`). Sources: `~/.codex/hooks.json`,
  `~/.codex/config.toml` `[hooks]`, `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml`, plugin `hooks/hooks.json`;
  all matching hooks load; "Project-local hooks load only when the project `.codex/` layer is trusted."
- Events: during a turn `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`,
  `SubagentStop`, `Stop`; `Interrupt` (not for subagents); `SessionStart`, `SubagentStart`; `SessionEnd` (main thread only).
- Handler fields: `type = command|mcp_tool`, `command`, `commandWindows`, `matcher` (regex; `Bash`, `apply_patch`,
  `Edit|Write`, `mcp__server__tool`, `startup|resume|clear`), `timeout` (600 s default), `statusMessage`,
  `additionalContextLimit` (default 2500 **tokens**), `async` (max 8 concurrent). Exit 0 ok, 2 block (reason on stderr), other = failure.
  stdin JSON `{session_id, transcript_path, cwd, hook_event_name, turn_id, permission_mode, model, ...}`; stdout
  `{continue, stopReason, systemMessage, suppressOutput, hookSpecificOutput:{hookEventName, additionalContext,
  permissionDecision, permissionDecisionReason, decision:{behavior}}}`.
- **Trust**: "Before a non-managed hook can run, Codex requires you to review and trust the exact hook definition. Codex
  records trust against the hook's current hash, so new or changed hooks are marked for review and skipped until trusted."
  `/hooks` in the TUI. "For one-off automation that already vets hook sources outside Codex, pass
  `--dangerously-bypass-hook-trust`." Managed hooks come from `requirements.toml` (`[hooks] managed_dir = "/enterprise/hooks"`,
  `windows_managed_dir = 'C:\enterprise\hooks'`, `allow_managed_hooks_only = true`) and are "trusted by policy".
  There is no documented way to pre-seed hook trust from a script.
- TOML form:

```toml
[[hooks.PreToolUse]]
matcher = "^Bash$"

[[hooks.PreToolUse.hooks]]
type = "command"
command = '/usr/bin/python3 "$(git rev-parse --show-toplevel)/.codex/hooks/pre_tool_use_policy.py"'
timeout = 30
statusMessage = "Checking Bash command"
```

### Memories (https://learn.chatgpt.com/docs/customization/memories **[verified]**)
"Local Codex memories are off by default" (`features.memories` "Enable Memories (off by default)"; locally
`memories stable false`). Enable:

```toml
[features]
memories = true
```

Keys: `memories.generate_memories`, `memories.use_memories`, `memories.disable_on_external_context` (legacy alias
`no_memories_if_mcp_or_web_search`), `memories.max_raw_memories_for_consolidation` (256, cap 4096), `max_unused_days`,
`max_rollout_age_days`, `max_rollouts_per_startup`, `min_rollout_idle_hours`, `min_rate_limit_remaining_percent`,
`extract_model`, `consolidation_model`. Storage: "The main memory files live under `~/.codex/memories/`" (+ `memories_1.sqlite`);
per-chat control `/memories`. Claude Code project memories can be imported via `/import`.

### Notifications
`notify = ["python3", "/path/to/notify.py"]` receives one JSON arg (`type: agent-turn-complete`, `thread-id`,
`turn-id`, `cwd`, `input-messages`, `last-assistant-message`); `tui.notifications`, `tui.notification_method`.

---

## 11. Non-interactive provisioning

### Environment variables (https://learn.chatgpt.com/docs/config-file/environment-variables **[verified]**)

| Variable | Purpose |
|---|---|
| `CODEX_HOME` | state root (`~/.codex`); "If you set it, the directory must already exist" |
| `CODEX_SQLITE_HOME` | SQLite state dir (config `sqlite_home` takes precedence) |
| `CODEX_NON_INTERACTIVE` | `1|true|yes` skips installer prompts (default response) |
| `CODEX_INSTALL_DIR` | visible command dir (`~/.local/bin`; `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`); package cache stays under `CODEX_HOME/packages/standalone` |
| `CODEX_RELEASE` | version for installers (from script source) |
| `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM` | `false` to use GitHub (README) |
| `CODEX_API_KEY` | API key for `codex exec`/`review`/SDK/remote exec-server ("Set it inline rather than job-wide") |
| `CODEX_ACCESS_TOKEN` | ChatGPT/Codex access token for trusted automation; persist with `codex login --with-access-token` |
| `CODEX_CA_CERTIFICATE` / `SSL_CERT_FILE` | corporate CA bundle |
| `OPENAI_FEDERATION_RULE_ID`, `OPENAI_IDENTITY_TOKEN_FILE`, `OPENAI_WORKLOAD_IDENTITY_CONTEXT` | workload identity |
| `RUST_LOG` | logging (`codex exec` defaults to `error`) |
| `CODEX_MANAGED_BY_NPM|BUN|PNPM|VITE_PLUS` | force update-method detection (source, undocumented) |

### Pre-accepting directory trust
The TUI shows "Trust this folder? … Your trust decision will be saved." (codex-rs/tui/src/onboarding/trust_directory.rs)
and persists via `ConfigEdit::SetProjectTrustLevel` → `[projects."<path>"] trust_level` in `~/.codex/config.toml`
(codex-rs/core/src/config/edit.rs). The local config on this host contains exactly this shape. Seed it non-interactively:

```toml
[projects."/absolute/path/to/project"]
trust_level = "trusted" # or "untrusted"
```

Subdirectories resolve to the Git repository root ("Trusting will apply to the repository root"). One-off:
`-c 'projects."/abs/path".trust_level="trusted"'`.

### `codex exec` in CI (https://learn.chatgpt.com/docs/non-interactive-mode **[verified]**)

```bash
codex exec "summarize the repository structure and list the top 5 risky areas"
codex exec "generate release notes for the last 10 commits" | tee release-notes.md
codex exec --json "summarize the repo structure" | jq
codex exec "Extract project metadata" --output-schema ./schema.json -o ./project-metadata.json
codex exec --ephemeral "triage this repository and suggest next steps"
CODEX_API_KEY=<api-key> codex exec --json "triage open bug reports"
codex exec resume --last "fix the race conditions you found"
cat prompt.txt | codex exec -
```

Flags (local help **[verified]**): `-s/--sandbox read-only|workspace-write|danger-full-access`,
`--approve-for-me`, `--dangerously-bypass-approvals-and-sandbox` (**note:** `codex exec --help` in 0.154.0 has **no** `--ask-for-approval`; that flag (`-a`) exists only on the interactive top-level `codex`),
`--dangerously-bypass-hook-trust`, `--skip-git-repo-check`, `--ignore-user-config`, `--ignore-rules`,
`--ephemeral`, `--json`, `-o/--output-last-message FILE`, `--output-schema FILE`, `-C/--cd DIR`, `--add-dir DIR`,
`--worktree`, `-p/--profile`, `-c`, `--enable/--disable`, `-m/--model`, `--oss --local-provider lmstudio|ollama`,
`--thread-source`, `--color`. `--full-auto` is deprecated. `--json` emits JSONL events (`thread.started`, `turn.started`,
`turn.completed`, `turn.failed`, `item.*`, `error`). Required MCP servers (`required = true`) fail the run if they don't start.
For GitHub Actions use `openai/codex-action@v1` with `openai-api-key`.

Other automation helpers (local help **[verified]**): `codex login status` (exit 0 = logged in),
`codex doctor [--json] [--summary] [--all] [--no-color] [--ascii]` ("Emit a redacted machine-readable report"; checks
"installation, configuration, authentication, runtime, Git, terminal, app-server, and thread inventory health"),
`codex features list|enable|disable`, `codex completion bash|zsh|fish|powershell|elvish`
(e.g. `codex completion zsh > "${fpath[1]}/_codex"`), `codex plugin ... --json`, `codex mcp list --json`, `codex --strict-config`.

### Importing an existing Claude Code setup
TUI `/import` → Claude Code: instruction files→`AGENTS.md`, `settings.json`→`config.toml`, skills, plugins, project
folders, project memories, chats (≤50 / 30 days), MCP config, hooks, slash commands→skills, subagents. Not
available non-interactively, in remote sessions, or with the app-server daemon (https://learn.chatgpt.com/docs/import).

---

## 12. Recommendations for the "ultimate installer" script

1. Install Codex via the standalone scripts only; refuse/uninstall npm/brew copies to keep `codex update` deterministic
   (installer already detects and offers uninstall; in non-interactive mode it leaves them — handle explicitly:
   `npm uninstall -g @openai/codex`, `brew uninstall --cask codex`, `bun remove -g @openai/codex`).
2. Linux: `apt install bubblewrap` (+ AppArmor profile on 24.04) before first run; verify with `codex doctor --json`.
3. Windows: run `install.ps1` from PowerShell 5.1/7; then set `[windows] sandbox = "elevated"` and tell the user to run
   `/setup-default-sandbox` once (admin prompt). Offer WSL2 as the alternative path (WSL1 unsupported since 0.115).
4. Auth: prefer `codex login --device-auth` on headless nodes; support `--with-api-key` from stdin; optionally sync
   `auth.json` (0600) with `cli_auth_credentials_store = "file"`. Check with `codex login status`.
5. Config: merge a managed TOML fragment (model, `model_reasoning_effort`, `web_search`, `personality`, `[features]`,
   `[projects.*]` trust, `[mcp_servers.*]`, `[[skills.config]]`, `notify`, `[tui]`) into `~/.codex/config.toml`;
   validate with `config-schema.json` / `--strict-config`; use `codex mcp add` for MCP entries where possible.
6. Plugins: `codex plugin add superpowers@openai-curated --json` (or `@openai-curated-remote`); add extra marketplaces
   with `codex plugin marketplace add <owner/repo>`; refresh with `codex plugin marketplace upgrade`.
7. Skills: `npx skills add <repo> -a codex -g -y` (global → `~/.codex/skills`, deprecated-but-read) or copy into
   `~/.agents/skills` (canonical); `npx skills update -g -y` for upgrades. Caveman: `npx skills add JuliusBrussee/caveman -a codex -g`.
8. AGENTS.md: write `~/.codex/AGENTS.md` (mirror of the user's global CLAUDE.md content); keep under 32 KiB or raise `project_doc_max_bytes`.
9. Hooks: ship `~/.codex/hooks.json`; document that first interactive run needs `/hooks` trust, or run automation with
   `--dangerously-bypass-hook-trust`.
10. Self-update: `codex update`; fallback to re-running the installer with `CODEX_NON_INTERACTIVE=1`; pin with `CODEX_RELEASE`.

---

## 13. Sources

- https://github.com/openai/codex (README.md; docs/install.md; codex-rs/install-context/src/lib.rs; codex-rs/tui/src/update_action.rs; codex-rs/tui/src/updates.rs; codex-rs/cli/src/main.rs; codex-rs/skills/src/lib.rs; codex-rs/ext/skills/src/host_roots.rs; codex-rs/core/src/skills.rs; codex-rs/tui/src/onboarding/trust_directory.rs; codex-rs/core/src/config/edit.rs; codex-rs/utils/home-dir/src/lib.rs)
- https://api.github.com/repos/openai/codex ; https://api.github.com/repos/openai/codex/releases/latest ; https://github.com/openai/codex/releases/tag/rust-v0.128.0
- https://github.com/openai/codex/releases/download/rust-v0.154.0/install.sh ; …/install.ps1
- https://registry.npmjs.org/@openai/codex ; https://registry.npmjs.org/@openai/codex-sdk/latest ; https://pypi.org/pypi/openai-codex-cli-bin/json ; https://registry.npmjs.org/skills/latest ; https://registry.npmjs.org/@caveman-ai/cli/latest
- https://formulae.brew.sh/api/cask/codex.json ; https://formulae.brew.sh/api/formula/codex.json (404)
- https://github.com/microsoft/winget-pkgs/tree/master/manifests/o/OpenAI/Codex
- https://learn.chatgpt.com/docs/codex/cli ; /docs/developer-commands?surface=cli ; /docs/config-file/config-basic ; /docs/config-file/config-advanced ; /docs/config-file/config-reference ; /docs/config-file/config-sample ; /docs/config-file/environment-variables ; /docs/auth ; /docs/auth/ci-cd-auth ; /docs/windows/windows-sandbox ; /docs/windows/wsl ; /docs/windows/windows-app ; /docs/enterprise/windows-deployment ; /docs/sandboxing ; /docs/agent-approvals-security ; /docs/agent-configuration/agents-md ; /docs/non-interactive-mode ; /docs/customization/memories ; /docs/hooks ; /docs/build-skills ; /docs/build-plugins ; /docs/plugins ; /docs/extend/mcp ; /docs/enterprise/managed-configuration ; /docs/enterprise/plugin-management ; /docs/import ; /docs/feature-maturity ; /docs/changelog ; https://learn.chatgpt.com/llms.txt
- https://developers.openai.com/plugins/build/plugins
- https://github.com/openai/plugins (README, .agents/plugins/marketplace.json, .agents/plugins/api_marketplace.json, plugins/superpowers/.codex-plugin/plugin.json)
- https://github.com/openai/skills (README)
- https://github.com/vercel-labs/skills (README)
- https://github.com/obra/superpowers (README, .codex-plugin/plugin.json, .agents/plugins/marketplace.json)
- https://github.com/JuliusBrussee/caveman (README, INSTALL.md, .claude-plugin/marketplace.json)
- https://github.com/openai/codex/issues/24035 ; https://github.com/openai/codex/issues/9274 (request that led to `codex update`)
- Secondary (used only for cross-check): https://codex.danielvaughan.com/2026/05/08/codex-cli-codex-update-self-update-command/
- Local (read-only): `codex --help`, `codex <sub> --help`, `codex features list`, `codex plugin marketplace list --json`, `codex plugin list [--available] --json`, `codex mcp list --json`, `~/.codex/*` layout, `~/.codex/skills/.system/skill-installer/SKILL.md` and scripts.

---

## Verification (skeptical fact-check pass, 2026-09-17)

Method: every item and fact above was re-fetched from its primary source on 2026-09-17 (GitHub HTML/expanded-assets
pages because the unauthenticated GitHub API was rate-limited and the local `gh` token is invalid; raw.githubusercontent
sources on `main`; `https://chatgpt.com/codex/install.sh` and `install.ps1` downloaded to the scratchpad and read;
npm registry + `api.npmjs.org` download counts; `formulae.brew.sh` cask JSON; learn.chatgpt.com `.md` twins of every
docs page cited; local `codex 0.154.0 --help` output only — nothing was installed or mutated).

### Corrections made to the body

| # | Claim as written | Finding | Source that decided it |
|---|---|---|---|
| 1 | npm `alpha` dist-tag = `0.155.0-alpha.13` | Now `0.155.0-alpha.14` (moved overnight). `latest` still `0.154.0`, published 2026-09-09T22:40:10Z. | https://registry.npmjs.org/@openai/codex |
| 2 | winget `OpenAI.Codex` = "community manifests" | The manifests are opened by OpenAI's own CI: `.github/workflows/rust-release.yml` job `winget` uses `vedantmgoyal9/winget-releaser` with `identifier: OpenAI.Codex`, `fork-user: openai-oss-forks`, regex `^codex-(?:x86_64\|aarch64)-pc-windows-msvc\.exe\.zip$`, stable releases only. It remains undocumented on the Getting Started page, lags (0.152.0 merged vs 0.154.0 released) and is not an install method `codex update` can detect (install-context has no winget variant → falls through to npm). Verdict changed skip → optional. | https://raw.githubusercontent.com/openai/codex/main/.github/workflows/rust-release.yml ; https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/o/OpenAI/Codex/0.152.0/OpenAI.Codex.installer.yaml |
| 3 | `codex exec` flags include `--ask-for-approval` | Wrong for 0.154.0: `codex exec --help` lists `-s/--sandbox`, `--approve-for-me`, `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`, `-C/--cd`, `--add-dir`, `--worktree`, `--ephemeral`, `--json`, `--output-schema`, `-o`, `-p/--profile`, `--strict-config`, `--ignore-user-config`, `--ignore-rules`, `--skip-git-repo-check`, `--thread-source`, `--color` — but **no** `-a/--ask-for-approval`. That flag exists only on the interactive top-level `codex`. The non-interactive docs page likewise never uses it with `exec`. Removed from the `codex exec` example. | local `codex exec --help`; https://learn.chatgpt.com/docs/non-interactive-mode.md |
| 4 | Hooks `additionalContextLimit` "2500 chars" | It is a **token** threshold: "Omit `additionalContextLimit` to use the default `2500`-token threshold." | https://learn.chatgpt.com/docs/hooks.md |
| 5 | Homebrew cask "macOS only / Linuxbrew not offered" | Cask JSON has `variations.x86_64_linux` and `variations.arm64_linux` (musl packages) plus Intel-mac variation; `autobump: true`; no `depends_on`. But `codex update` only recognises brew on macOS, so Linux users should still prefer the standalone installer. | https://formulae.brew.sh/api/cask/codex.json ; https://raw.githubusercontent.com/openai/codex/main/codex-rs/install-context/src/lib.rs |
| 6 | Config schema URL `developers.openai.com/codex/config-schema.json` | 308-redirects to `https://learn.chatgpt.com/docs/config-schema.json` (200, `application/json`). Use the learn.chatgpt.com URL or the release asset. | `curl -sIL` |
| 7 | rust-v0.128.0 "30 Apr" (year unknown) | PR #19933 "Add `codex update` command" merged **2026-04-28**; release 0.128.0 dated 30 Apr → 2026-04-30. Open question resolved. | https://github.com/openai/codex/pull/19933 |
| 8 | WSL1 claim marked medium / "not re-fetched" | Re-fetched: "WSL1 was supported through Codex `0.114`. Starting in Codex `0.115`, the Linux sandbox moved to `bubblewrap`, so WSL1 is no longer supported." → high. | https://learn.chatgpt.com/docs/windows/wsl.md |
| 9 | "`codex plugin marketplace add JuliusBrussee/caveman` may work" (low, inference) | Source-confirmed (not executed): `codex-rs/core-plugins/src/marketplace.rs` `MARKETPLACE_MANIFEST_RELATIVE_PATHS = [".agents/plugins/marketplace.json", ".agents/plugins/api_marketplace.json", ".claude-plugin/marketplace.json", ".cursor-plugin/marketplace.json"]`; plugin manifests resolve root `plugin.json` (agent-plugins schema) then `DISCOVERABLE_PLUGIN_MANIFEST_PATHS = [".codex-plugin/plugin.json", ".claude-plugin/plugin.json", ".cursor-plugin/plugin.json"]` (`codex-rs/exec-server-protocol/src/protocol.rs`). Caveman's marketplace uses `"source": "./"` (string path; loader accepts `Path` variant, must start with `./`) and ships `.claude-plugin/plugin.json` (name `caveman`, version 2.7.0, has `hooks`). So `codex plugin marketplace add JuliusBrussee/caveman && codex plugin add caveman@caveman` should parse; whether its Claude-oriented hooks behave under Codex is untested. Confidence low → medium. | raw sources listed |
| 10 | "remote catalog ~3,935 entries on this account" | Could not be re-verified without running `codex plugin list --available` (network-touching, skipped in read-only pass). Kept but flagged unverified. | — |

### Facts confirmed unchanged (character-by-character)

- Install commands on the Getting Started page: `curl -fsSL https://chatgpt.com/codex/install.sh | sh`, `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`, `npm install -g @openai/codex`, `brew install --cask codex` / `brew upgrade --cask codex`; README lists the same four.
- `install.sh` (1209 lines): `RELEASE="${CODEX_RELEASE:-latest}"`, `--release VERSION`, `CODEX_NON_INTERACTIVE` (1|true|yes), `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM` (0|false|no → GitHub), `BIN_DIR="${CODEX_INSTALL_DIR:-$HOME/.local/bin}"`, `CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"`, `STANDALONE_ROOT=$CODEX_HOME_DIR/packages/standalone`, `RELEASES_BASE_URL=https://releases.openai.com/codex`, checksum asset `codex-package_SHA256SUMS`, PATH block in `~/.zprofile` / `~/.bash_profile` / `~/.profile`. It also links `$BIN_DIR/codex-code-mode-host`.
- `install.ps1` (1089 lines): `param([string]$Release = $env:CODEX_RELEASE)`, `$NonInteractive = $env:CODEX_NON_INTERACTIVE -match "^(?i:1|true|yes)$"`, `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` default, `$env:CODEX_INSTALL_DIR`, `$env:CODEX_HOME` → `packages\standalone\{releases,current}`, NTFS junction, `Get-FileHash -Algorithm SHA256`, user PATH via `[Environment]::SetEnvironmentVariable("Path", ..., "User")`, npm/bun conflict detection.
- `update_action.rs`: `("npm", ["install","-g","@openai/codex"])`, `("bun", ["install","-g","@openai/codex"])`, `("vp", ["install","-g","@openai/codex"])`, `("pnpm", ["add","-g","@openai/codex"])`, `("brew", ["upgrade","--cask","codex"])`, `sh -c "curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh"`, `powershell -ExecutionPolicy Bypass -c "$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 | iex"`.
- `install-context/src/lib.rs`: env overrides `CODEX_MANAGED_BY_VITE_PLUS`, `CODEX_MANAGED_BY_PNPM`, `CODEX_MANAGED_BY_NPM`, `CODEX_MANAGED_BY_BUN`; standalone detection via `packages/standalone/releases/<ver>-<target>`; brew only when `is_macos && (/opt/homebrew | /usr/local)`; else npm.
- `codex update --help` (0.154.0): options are only `-c`, `--enable`, `--disable`, `-h` — no `--check`.
- Release assets for rust-v0.154.0 (162 assets; full list fetched from the expanded_assets page): `codex-{x86_64,aarch64}-{apple-darwin,unknown-linux-musl}.{tar.gz,zst}`, `codex-*-apple-darwin.dmg`, `codex-{x86_64,aarch64}-pc-windows-msvc.exe{,.zip,.tar.gz,.zst}`, `codex-package-<6 targets>.tar.{gz,zst}`, `codex-package_SHA256SUMS`, `bwrap-{x86_64,aarch64}-unknown-linux-musl.*`, `codex-npm-*-0.154.0.tgz`, `codex-sdk-npm-0.154.0.tgz`, `openai_codex_cli_bin-0.154.0-py3-none-*.whl` (6), `config-schema.json`, `install.ps1`, `install.sh`, `codex-windows-sandbox-setup-*`, `codex-command-runner-*`, `codex-app-server-*`, `codex-code-mode-host-*`, `codex-responses-api-proxy-*`, `codex-symbols-*`, `.sigstore` bundles. Only `argument-comment-lint` (a lint tool) has `-unknown-linux-gnu` builds; the CLI is musl-only on Linux.
- Env-vars page: `CODEX_HOME` "If you set it, the directory must already exist."; `CODEX_NON_INTERACTIVE` "Prompts use their default response"; `CODEX_INSTALL_DIR` defaults; `CODEX_API_KEY`, `CODEX_CA_CERTIFICATE`, `SSL_CERT_FILE`.
- Auth page: `codex login --device-auth` (beta), `printenv OPENAI_API_KEY | codex login --with-api-key`, `printenv CODEX_ACCESS_TOKEN | codex login --with-access-token`, `scp ~/.codex/auth.json user@remote:~/.codex/auth.json`, `ssh -L 1455:localhost:1455 user@remote`, `cli_auth_credentials_store = file|keyring|auto|ephemeral`; CLI reference: "`codex login status` exits with `0` when credentials are present".
- Sandboxing page: `sudo apt install bubblewrap`, `sudo dnf install bubblewrap`, Ubuntu 24.04 AppArmor block (`sudo apt update`, `sudo apt install apparmor-profiles apparmor-utils`, `sudo install -m 0644 /usr/share/apparmor/extra-profiles/bwrap-userns-restrict /etc/apparmor.d/bwrap-userns-restrict`, `sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict`), fallback `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`; Ubuntu 25.04 ships the profile in `apparmor`. The page never mentions Landlock — the "Landlock deprecated" statement rests solely on `codex features list` (`use_legacy_landlock deprecated false`).
- Windows sandbox page: `[windows] sandbox = "elevated" # or "unelevated"`, Windows 11 recommended / Windows 10 1809+ best effort, `winget` should be available, `/sandbox-add-read-dir C:\absolute\directory\path`, error 1385, `CODEX_HOME/.sandbox/sandbox.log`; `/setup-default-sandbox` is documented on the CLI slash-command reference.
- Config precedence (config-basic.md): 1 CLI flags/`--config`, 2 project `.codex/config.toml` root→cwd (trusted only), 3 `~/.codex/profile-name.config.toml` via `--profile`, 4 `~/.codex/config.toml`, 5 cloud-managed, 6 `/etc/codex/config.toml`, 7 defaults. `approval_policy = "untrusted"` retired; `on-failure` deprecated.
- Config reference keys re-found: `model_reasoning_effort` `minimal | low | medium | high | xhigh`; `personality` `none | friendly | pragmatic`; `web_search` `disabled | cached | indexed | live`; `skills.max_context_tokens` (2 % of context, cap 10000); `skills.config[].path/enabled`; `projects.<path>.trust_level`; `marketplaces.<name>.{source_type,source,ref,sparse_paths}`; `plugins.<plugin>.enabled` keyed `plugin-name@marketplace-name`; `project_doc_max_bytes`; `project_doc_fallback_filenames`; `check_for_update_on_startup`; `cli_auth_credentials_store`; `features.plugin_sharing`/`features.in_app_updates`/`features.hooks` requirements toggles.
- Top-level commands (0.154.0): no `config` subcommand; `features list|enable|disable`; `mcp list|get|add|remove|login|logout`; `plugin add|list|marketplace|remove`; `plugin marketplace add|list|upgrade|remove`; `completion` shells `bash, elvish, fish, powershell, zsh`; `doctor --json|--summary|--all|--no-color|--ascii`; `sandbox`; `update`. `codex mcp-server` no longer parses as a subcommand (falls through to the TUI), matching the docs' removal note (changelog 2026-09-05, deprecated 2026-08-24).
- `codex mcp add` usage `codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)` with `--env` (stdio only), `--bearer-token-env-var` (HTTP only), `--oauth-client-id`, `--oauth-client-registration auto|cimd|dcr`, `--oauth-resource`. Docs examples `codex mcp add context7 -- npx -y @upstash/context7-mcp`, `codex mcp add <server-name> --env VAR1=VALUE1 --env VAR2=VALUE2 -- <stdio server-command>`, `codex mcp add example --url https://mcp.example.com --oauth-client-id my-client`; TOML `http_headers = { "X-Figma-Region" = "us-east-1" }`; timeouts 10 / 60 s.
- Skills: `host_roots.rs` matches the claim verbatim ("Deprecated user skills location (`$CODEX_HOME/skills`), kept for backward compatibility"; `~/.agents/skills` User; `system_cache_root_dir` System; `/etc/codex/skills` Admin; project layer `.codex/skills` Repo; `.agents/skills` root→cwd). Docs table: `$CWD/.agents/skills`, `$CWD/../.agents/skills`, `$REPO_ROOT/.agents/skills`, `$HOME/.agents/skills`, `/etc/codex/skills`, bundled SYSTEM; `$skill-installer linear`; `agents/openai.yaml` `dependencies.tools[{type: "mcp", …}]`; "Codex supports symlinked skill folders".
- `npx skills` (vercel-labs/skills, npm `skills` 1.5.26, bin `skills`/`add-skill`): Codex row `codex` → project `.agents/skills/`, global `~/.codex/skills/` (source `globalSkillsDir: join(codexHome, 'skills')`); flags `-g/--global`, `-a/--agent`, `-s/--skill` (`'*'`), `--copy`, `-y/--yes`; `npx skills update [-g|-p] [-y]`, `npx skills ls -g`, `npx skills remove`.
- Caveman `INSTALL.md` row: `npx skills add JuliusBrussee/caveman -a codex -g` (README variant `npx skills add JuliusBrussee/caveman --skill '*' -a codex --yes -g`); repo has `.claude-plugin/{marketplace,plugin}.json` only; `@caveman-ai/cli` latest 1.3.4 (published 2026-09-15).
- superpowers: README "Superpowers is available via the official Codex plugin marketplace" → `/plugins` → search → Install Plugin; `.codex-plugin/plugin.json` v6.3.0 in both obra/superpowers and openai/plugins `plugins/superpowers`; obra `.agents/plugins/marketplace.json` name `superpowers-dev`, plugin source `{ "source": "url", "url": "./" }`; no root `plugin.json`.
- openai/plugins `.agents/plugins/marketplace.json`: name `openai-curated`, 65 plugins, superpowers entry `source {source: local, path: ./plugins/superpowers}`, policy products `[CODEX]`.
- Plugins build docs: root `plugin.json` (`$schema https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`), `.codex-plugin/plugin.json` compatibility fallback, "OpenAI also accepts legacy and Claude-compatible manifests"; marketplace files `.agents/plugins/marketplace.json`, legacy `.claude-plugin/marketplace.json`, `~/.agents/plugins/marketplace.json`; cache `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/`; hooks receive `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA`; `features.plugin_sharing = false` in `requirements.toml`; CLI examples `codex plugin marketplace add owner/repo`, `… --ref main`, `… https://github.com/example/plugins.git --sparse .agents/plugins`, `… ./local-marketplace-root`, `codex plugin marketplace list|upgrade [name]|remove name`.
- Changelog: 0.153.0 (2026-09-03) and 0.154.0 (2026-09-09) both say "The plugin CLI can list, install, and remove plugins from remote marketplaces"; 0.154.0 adds `--worktree` (experimental) and Windows shared background server with managed updates.
- AGENTS.md page: global `AGENTS.override.md` else `AGENTS.md` ("only the first non-empty file"), project root→cwd, `project_doc_max_bytes` 32 KiB default, `project_doc_fallback_filenames = ["TEAM_GUIDE.md", ".agents.md"]`, `project_doc_max_bytes = 65536` example.
- Hooks page: 12 events as listed; sources `hooks.json`, inline `[hooks]`, `~/.codex/hooks.json`, `<repo>/.codex/hooks.json`, plugin `hooks/hooks.json`; trust recorded against hash, `/hooks` to review, `--dangerously-bypass-hook-trust`; `commandWindows`/`command_windows`; `managed_dir`/`windows_managed_dir`; TOML example identical to the one quoted in the body.
- Memories page: "Local Codex memories are off by default", `[features] memories = true`, files under `~/.codex/memories/`, keys `memories.generate_memories`, `use_memories`, `disable_on_external_context`, `min_rate_limit_remaining_percent`, `extract_model`, `consolidation_model`.
- Import page: Codex CLI `/import` supports Claude Code or Cursor; mapping table settings.json→config.toml, skills, plugins, project memories, MCP, hooks, slash commands→skills, subagents; not available during a task, in a remote session, or with a local app-server daemon.
- Star counts (GitHub HTML, 2026-09-17): openai/codex 124.7k, openai/plugins 6.9k, vercel-labs/skills 31.8k, obra/superpowers 287.6k, JuliusBrussee/caveman 106k — consistent with the numbers recorded on 2026-09-16.
- Homebrew analytics unchanged: 30d 104,767 / 90d 288,901 / 365d 792,840.

### New facts found while checking (marked NEW in the JSON)

- NEW: `install.sh` in non-interactive mode answers **No** to "Uninstall the existing npm/brew/bun-managed Codex now?" (`prompt_yes_no` returns 1 when `CODEX_NON_INTERACTIVE` is set) and only warns "PATH order will determine which codex runs". The installer script must itself run `npm uninstall -g @openai/codex` / `bun remove -g @openai/codex` / `brew uninstall --cask codex` (the exact strings the script would have used) before or after the standalone install. `install.ps1` behaves the same (`Prompt-YesNo` returns `$false` when `$NonInteractive` or when stdin/stdout is redirected).
- NEW: `install.sh` prompts via `/dev/tty` even when piped from curl, so without `CODEX_NON_INTERACTIVE=1` a `curl | sh` run can still block on a prompt when a conflicting install is present.
- NEW: `npx skills add … -g` stores the canonical copy at `~/.agents/skills/<skill>` (`getCanonicalSkillsDir` = `join(homedir(), '.agents', 'skills')`) and symlinks `~/.codex/skills/<skill>` to it. Codex reads **both** roots, and the docs state "If two skills share the same `name`, Codex doesn't merge them; both can appear in skill selectors" — so for Codex the canonical `~/.agents/skills` copy alone (already present on this host from the Claude-side install) is sufficient; adding `-a codex` risks duplicate entries. Not executed; inferred from source + docs.
- NEW: npm download counts: `@openai/codex` 17,149,232 in the week 2026-09-05..11 and 75,968,436 in 2026-08-13..09-11; `skills` 4,621,540/week (same window).
- NEW: winget manifest 0.152.0 declares dependencies `BurntSushi.ripgrep.MSVC` and `Microsoft.VCRedist.2015+.x64`, nested files `codex-command-runner.exe`, `codex-windows-sandbox-setup.exe`, `codex-<arch>-pc-windows-msvc.exe` (alias `codex`).
- NEW: rust-v0.134.0 (26 May 2026) "Made `--profile` the primary profile selector … with legacy profile configs rejected" (#23883 etc.) — supports the "profiles moved to `~/.codex/<name>.config.toml`" statement; config-advanced.md: "don't nest them under `[profiles.profile-name]`".
- NEW: source order for plugin manifests and marketplace files (see correction #9) also includes `.cursor-plugin/{plugin,marketplace}.json` and `.agents/plugins/api_marketplace.json`.
- NEW: `codex --version` prints `codex-cli 0.154.0` (useful for the installer's version parsing).

### Items removed

None — every URL cited resolved (GitHub API endpoints only failed with rate-limit/403, and were substituted with the HTML pages / raw files).
