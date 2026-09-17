# Claude Code: installation, update and configuration mechanics (as of 2026-09-16)

Research for the "ultimate AI coding agent installer". All commands below were copied from fetched
primary sources (code.claude.com docs `.md` endpoints, the installer scripts themselves, the CHANGELOG,
the npm registry, the official marketplace.json, the GitHub API, and `claude --help` output from the
locally installed 2.1.273 binary). Where a number is not sourced it says "unknown". Nothing was
installed or mutated during this research (read-only; only `--help`/`--version`, `curl`, `jq`).

Reference machine: Ubuntu 26.04.1, Claude Code 2.1.273 (native). Version data fetched 2026-09-16/17:

| Source | Value |
|---|---|
| `https://downloads.claude.ai/claude-code-releases/latest` | `2.1.273` |
| `https://downloads.claude.ai/claude-code-releases/stable` | `2.1.267` |
| npm dist-tags `@anthropic-ai/claude-code` | `latest`=2.1.273, `stable`=2.1.267, `next`=2.1.274 |
| npm `engines.node` | `>=22.0.0`; `deprecated` field is `null` (not npm-deprecated, only doc/README-deprecated) |
| GitHub API `anthropics/claude-code` | 145,468 stars, 23,473 forks, pushed 2026-09-16T18:56:57Z (first pass, 2026-09-16); re-check 2026-09-17: API returned 403 to this host, repo page shows 145.5k stars / 23.5k forks |
| CHANGELOG head | `## 2.1.273` (2.1.272 = "Bug fixes and reliability improvements") |

---

## 0. Executive summary for the installer author

| Question | Answer (sourced) |
|---|---|
| Recommended install | Native installer: `curl -fsSL https://claude.ai/install.sh \| bash` (macOS/Linux/WSL), `irm https://claude.ai/install.ps1 \| iex` (PowerShell), `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` (CMD). |
| Pin channel/version | Append `stable`, `latest` or `X.Y.Z`: `bash -s stable`, `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable`, `install.cmd stable`. The channel chosen at install time becomes the auto-update default (`autoUpdatesChannel`). |
| Where the binary lives | `~/.local/bin/claude` -> symlink into `~/.local/share/claude/versions/<ver>`; Windows `%USERPROFILE%\.local\bin\claude.exe` + `%USERPROFILE%\.local\share\claude`. Installer stages downloads in `~/.claude/downloads/` then runs `claude install [target]`. |
| Is npm deprecated? | Yes in docs/README ("NPM (Deprecated)"; in-app notice since v2.1.15) but still published and working (2.1.273, Node >=22). It installs the same native binary through optional platform packages. |
| Update in place | `claude update` (alias `upgrade`); `claude install [stable\|latest\|X.Y.Z] [--force]`. Native/npm installs auto-update in the background unless `DISABLE_AUTOUPDATER=1`; `DISABLE_UPDATES=1` (v2.1.118+) blocks even manual updates. Settings: `autoUpdatesChannel`, `minimumVersion`; managed-only `requiredMinimumVersion`/`requiredMaximumVersion`. There is no documented `autoUpdates` settings key any more (grep of settings-reference: none; the local `~/.claude.json` still carries a legacy `autoUpdates: false`). |
| Homebrew / WinGet / apt / dnf / apk | `brew install --cask claude-code` (stable) or `claude-code@latest`; `winget install Anthropic.ClaudeCode`; signed apt/dnf/apk repos at `downloads.claude.ai/claude-code/{apt,rpm,apk}/{stable,latest}`. None auto-update through Claude Code by default; Homebrew/WinGet can with `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1` (v2.1.129+). |
| Windows | Git for Windows is optional (recommended; enables the Bash tool, otherwise PowerShell tool). Windows 10 1809+/Server 2019+, x64 or ARM64 (v2.1.41+), 32-bit refused. WSL: run the Linux installer inside WSL; WSL1 has an Exec-format problem, use WSL2. No admin needed. |
| Linux | Ubuntu 20.04+, Debian 10+, Alpine 3.19+ (`apk add bash curl libgcc libstdc++ ripgrep` + `USE_BUILTIN_RIPGREP=0`), x64/ARM64, glibc or musl auto-detected, AVX required (docs: VMs whose hypervisor does not pass AVX through fail with `Illegal instruction`; the Proxmox `kvm64` CPU-type example is this report's inference, not in the docs or issue #50384), ~512 MB free RAM for the installer. |
| Headless auth | `claude setup-token` (browser once, prints a 1-year token) -> `CLAUDE_CODE_OAUTH_TOKEN`; or `ANTHROPIC_API_KEY`; or `claude auth login` (prints URL, accepts pasted code over SSH/WSL2/containers); Bedrock/Vertex/Foundry via `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY=1`. `--bare` only honours `ANTHROPIC_API_KEY`/`apiKeyHelper`. |
| Declarative plugin provisioning | **Partly.** `extraKnownMarketplaces` registers marketplaces on next start (user/managed settings: immediately; repo settings: after trust). For an enabled plugin that is not yet in `~/.claude/plugins/cache`, the docs say Claude Code copies it into the cache "at session start ... such as on a new machine" and that in `-p` mode "plugins install in the background" (`CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1` waits for them). The documented exception (v2.1.195+): a plugin with an external source (github/url/npm/git-subdir) that is enabled **only** by a project's `.claude/settings.json` is never auto-installed; Claude Code reports it "not installed" and prints the `claude plugin install` command. The docs do not spell out an explicit guarantee for user-settings enablement of external-source plugins beyond the "new machine" sentence and the v2.1.144 changelog line ("plugins enabled in your own settings" no longer show "not cached" errors on a fresh machine). **Recommendation**: the installer should drive `claude plugin marketplace add ...` + `claude plugin install name@marketplace --scope user --json` explicitly (deterministic, creates `installed_plugins.json` records, exit codes, JSON results) and treat settings-only provisioning as a fallback, verified with `claude plugin list --json`. |
| Plugin CLI is scriptable | `claude plugin install <p>@<m> [-s user\|project\|local] [-y] [--config k=v] [--accept-command sha] [--json]`, `uninstall`, `enable`, `disable`, `update [--json]`, `list [--json] [--available]`, `details`, `validate`, `init`, `eval`, `prune`, `tag`; `claude plugin marketplace add <src> [--scope] [--sparse] [--claudeai]`, `list [--json]`, `remove [--scope]`, `update [name]`. |
| MCP CLI | `claude mcp add [-t stdio\|http\|sse] [-s local\|user\|project] [-e K=V] [-H "K: v"] <name> <cmd\|url> [-- args]`, `add-json`, `list`, `get`, `remove`, `login [--no-browser]`, `logout`, `reset-project-choices`, `serve`. user/local -> `~/.claude.json`; project -> `.mcp.json`. Tool search defers MCP tool schemas by default (`ENABLE_TOOL_SEARCH`). No `cmd /c` wrapper needed on Windows any more (false-positive warning removed in v2.1.119). |
| Skills | Personal `~/.claude/skills/<name>/SKILL.md`; project `.claude/skills/`; managed `/etc/claude-code/.claude/skills/`; plugins ship `skills/`; claude.ai-synced skills in `~/.claude/skills/synced/` (reserved name). Agent Skills open standard (agentskills.io). `~/.claude/skills/<dir>/.claude-plugin/plugin.json` auto-loads as `<name>@skills-dir` (`claude plugin init <name>`, v2.1.157+). |
| `claude import` | `claude import [codex\|gemini\|cursor] [--dry-run] [--yes]` imports instruction files, MCP servers, commands, subagents and skills (v2.1.213+; Cursor v2.1.265+). Not on Bedrock/Vertex/Foundry/gateway or with feature-flag fetching off. |
| First-run prompts | Docs do not offer a "skip onboarding" flag. `-p` never shows the trust dialog. Trust can be pre-seeded (`projects["<path>"].hasTrustDialogAccepted: true` in `~/.claude.json`, documented). The theme can be set in `settings.json` (`"theme": "dark"`, documented). `hasCompletedOnboarding: true` in `~/.claude.json` is an **undocumented** but widely used community workaround (GitHub issue #46259, closed not-planned). |

---

## 1. Official install methods and exact commands

Source: https://code.claude.com/docs/en/setup.md (fetched 2026-09-16), installer scripts fetched from
https://claude.ai/install.sh, https://claude.ai/install.ps1, https://claude.ai/install.cmd.

### 1.1 Native installer (recommended)

```bash
# macOS, Linux, WSL  (latest channel, default)
curl -fsSL https://claude.ai/install.sh | bash
# stable channel
curl -fsSL https://claude.ai/install.sh | bash -s stable
# exact version
curl -fsSL https://claude.ai/install.sh | bash -s 2.1.89
```

```powershell
# Windows PowerShell
irm https://claude.ai/install.ps1 | iex
& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable
& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) 2.1.89
```

```batch
:: Windows CMD
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd stable && del install.cmd
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd 2.1.89 && del install.cmd
```

Docs' wrong-shell hints: `The token '&&' is not a valid statement separator` -> you are in PowerShell;
`'irm' is not recognized` -> you are in CMD.

What the scripts actually do (read from the fetched scripts):

* `install.sh`: `TARGET="$1"` validated against `^(stable|latest|[0-9]+\.[0-9]+\.[0-9]+(-[^[:space:]]+)?)$`
  (`Usage: $0 [stable|latest|VERSION]`). Refuses to run under `sudo` for a non-root `SUDO_USER` unless
  `CLAUDE_INSTALL_ALLOW_SUDO=1` (hint printed by the script:
  `curl -fsSL https://claude.ai/install.sh | sudo CLAUDE_INSTALL_ALLOW_SUDO=1 bash`). Uses curl or wget.
  Detects `uname -s`/`uname -m` (x86_64 -> x64, arm64/aarch64 -> arm64), detects musl via
  `/lib/libc.musl-*.so.1` or `ldd /bin/ls | grep musl` -> `linux-<arch>-musl`.
  `DOWNLOAD_BASE_URL=https://downloads.claude.ai/claude-code-releases`, `DOWNLOAD_DIR=$HOME/.claude/downloads`.
  Always fetches `$BASE/latest` for the version, then `$BASE/$version/manifest.json`, downloads
  `$BASE/$version/$platform/claude` (or `.zst` when a `manifest.zst.json` exists), verifies SHA256,
  then runs `"$binary_path" install ${TARGET:+"$TARGET"}` which sets up the launcher and shell integration.
  (The *latest* binary performs the install even when you pin an older version.)
* `install.ps1`: `param([ValidatePattern('^(stable|latest|\d+\.\d+\.\d+(-[^\s]+)?)$')][string]$Target = "latest")`.
  Rejects 32-bit Windows. Platform `win32-arm64` when `$env:PROCESSOR_ARCHITECTURE -eq "ARM64"` else `win32-x64`.
  `DOWNLOAD_DIR="$env:USERPROFILE\.claude\downloads"`, downloads `.../claude.exe`, verifies SHA256, runs
  `& $binaryPath install $Target`, deletes the temp file.
* `install.cmd`: same flow for environments without PowerShell; requires `curl` on PATH.

Installed layout (setup.md "Auto-updates", "Uninstall", troubleshoot-install.md):

* macOS/Linux/WSL: launcher `~/.local/bin/claude` is a symlink into `~/.local/share/claude/versions/`.
  A custom launcher at that path is left alone since v2.1.207 (all versions are then kept on disk;
  `claude doctor` reports the custom launcher). To let Claude manage it again: `rm ~/.local/bin/claude && claude update`.
* Windows: `%USERPROFILE%\.local\bin\claude.exe`, `%USERPROFILE%\.local\share\claude`.
* Verify: `claude --version` -> `2.1.273 (Claude Code)`; `claude doctor` for diagnostics.
* PATH fix if needed: `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc` (or `~/.zshrc`);
  Windows: `[Environment]::SetEnvironmentVariable('PATH', "$currentPath;$env:USERPROFILE\.local\bin", 'User')`.
* Installer needs write access to `~/.local/bin/` and `~/.claude/`; ~512 MB free RAM (OOM -> exit 137;
  docs suggest `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`).
* Docker: set `WORKDIR /tmp` before `RUN curl -fsSL https://claude.ai/install.sh | bash` (running from `/`
  scans the whole filesystem and can hang).
* Proxy: export `HTTP_PROXY`/`HTTPS_PROXY` before running the installer. Connectivity check:
  `curl -sI https://downloads.claude.ai/claude-code-releases/latest` (Windows: `curl.exe -sI ...`).

Release-channel endpoints (used by the installer; verified 2026-09-16):
`https://downloads.claude.ai/claude-code-releases/latest` -> `2.1.273`, `/stable` -> `2.1.267`,
`/<version>/manifest.json` lists platforms `darwin-arm64, darwin-x64, linux-arm64, linux-arm64-musl,
linux-x64, linux-x64-musl, win32-arm64, win32-x64` with SHA256 checksums.

Binary integrity: manifest is GPG-signed (releases >= 2.1.89):
```bash
curl -fsSL https://downloads.claude.ai/keys/claude-code.asc | gpg --import
gpg --fingerprint security@anthropic.com   # expect 31DD DE24 DDFA B679 F42D  7BD2 BAA9 29FF 1A7E CACE
REPO=https://downloads.claude.ai/claude-code-releases
VERSION=2.1.89
curl -fsSLO "$REPO/$VERSION/manifest.json"
curl -fsSLO "$REPO/$VERSION/manifest.json.sig"
gpg --verify manifest.json.sig manifest.json
sha256sum claude            # Linux
shasum -a 256 claude        # macOS
(Get-FileHash claude.exe -Algorithm SHA256).Hash.ToLower()   # PowerShell
```
macOS binaries are signed/notarized ("Anthropic PBC"); Windows Authenticode-signed ("Anthropic, PBC");
Linux binaries are not individually signed (verify via the signed manifest).

### 1.2 Homebrew

```bash
brew install --cask claude-code          # stable channel (~1 week behind latest)
brew install --cask claude-code@latest   # latest channel
brew upgrade claude-code                 # or brew upgrade claude-code@latest
brew uninstall --cask claude-code        # or claude-code@latest
```
Homebrew installs do not auto-update; the cask name picks the channel (`autoUpdatesChannel` is ignored;
`claude update` defers to `brew upgrade`). `brew cleanup` reclaims old versions. Opt in to background
upgrade with `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1` (v2.1.129+).

### 1.3 WinGet

```powershell
winget install Anthropic.ClaudeCode
winget upgrade Anthropic.ClaudeCode
winget uninstall Anthropic.ClaudeCode
```
No auto-update by default; `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1` lets Claude run the upgrade
(may fail while Claude is running because Windows locks the exe). Known issue: the update notification can
arrive before the package manager has the new version.

### 1.4 Linux package managers (apt / dnf / apk) - signed repos, stable or latest

apt (Debian/Ubuntu):
```bash
sudo apt install curl gnupg
sudo install -d -m 0755 /etc/apt/keyrings
sudo curl -fsSL https://downloads.claude.ai/keys/claude-code.asc -o /etc/apt/keyrings/claude-code.asc
gpg --show-keys /etc/apt/keyrings/claude-code.asc   # fingerprint 31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE
echo "deb [signed-by=/etc/apt/keyrings/claude-code.asc] https://downloads.claude.ai/claude-code/apt/stable stable main" \
  | sudo tee /etc/apt/sources.list.d/claude-code.list
sudo apt update
sudo apt install claude-code
# latest channel instead:
echo "deb [signed-by=/etc/apt/keyrings/claude-code.asc] https://downloads.claude.ai/claude-code/apt/latest latest main" \
  | sudo tee /etc/apt/sources.list.d/claude-code.list
# upgrade: sudo apt update && sudo apt upgrade claude-code
# remove:  sudo apt remove claude-code; sudo rm /etc/apt/sources.list.d/claude-code.list /etc/apt/keyrings/claude-code.asc
```
dnf (Fedora/RHEL):
```bash
sudo tee /etc/yum.repos.d/claude-code.repo <<'EOR'
[claude-code]
name=Claude Code
baseurl=https://downloads.claude.ai/claude-code/rpm/stable
enabled=1
gpgcheck=1
gpgkey=https://downloads.claude.ai/keys/claude-code.asc
EOR
sudo dnf install claude-code        # latest: baseurl=https://downloads.claude.ai/claude-code/rpm/latest
# upgrade: sudo dnf upgrade claude-code ; remove: sudo dnf remove claude-code; sudo rm /etc/yum.repos.d/claude-code.repo
```
apk (Alpine):
```sh
wget -O /etc/apk/keys/claude-code.rsa.pub https://downloads.claude.ai/keys/claude-code.rsa.pub
echo "https://downloads.claude.ai/claude-code/apk/stable" >> /etc/apk/repositories
apk add claude-code
# sha256 of key: 395759c1f7449ef4cdef305a42e820f3c766d6090d142634ebdb049f113168b6
# upgrade: apk update && apk upgrade claude-code
```
Package-manager installs do not auto-update through Claude Code (apt/dnf/apk need root); `claude update`
reports `Claude is up to date!` for Homebrew/WinGet/apk installs.

### 1.5 npm (deprecated in docs, still published and functional)

```bash
npm install -g @anthropic-ai/claude-code
npm install -g @anthropic-ai/claude-code@latest     # upgrade (avoid `npm update -g`)
npm uninstall -g @anthropic-ai/claude-code
```
* README on github.com/anthropics/claude-code labels it "NPM (Deprecated)"; CHANGELOG v2.1.15: "Added
  deprecation notification for npm installations - run `claude install`". The npm registry `deprecated`
  field is `null`, so `npm install` itself prints no deprecation.
* npm registry (2026-09-16): version 2.1.273, `engines.node >=22.0.0`, optional deps
  `@anthropic-ai/claude-code-{darwin-arm64,darwin-x64,linux-arm64,linux-arm64-musl,linux-x64,linux-x64-musl,win32-arm64,win32-x64}`;
  weekly downloads 10,994,666 (api.npmjs.org, week ending 2026-09-11). Docs: as of v2.1.198 requires Node 22+, but on older
  Node it only prints `EBADENGINE` and still works because the binary does not use Node at runtime.
* Postinstall links the native binary; if `--ignore-scripts`/`--omit=optional` were used, run
  `node node_modules/@anthropic-ai/claude-code/install.cjs`. Never `sudo npm install -g`.
* WSL: if npm picks Windows node, `npm config set os linux` then `npm install -g @anthropic-ai/claude-code --force`.
* Legacy local install at `~/.claude/local/` (older `claude migrate-installer`) - remove with `rm -rf ~/.claude/local`.
  `claude migrate-installer` is no longer a listed subcommand in 2.1.273.
* Migration npm -> native: run `curl -fsSL https://claude.ai/install.sh | bash` then `npm uninstall -g @anthropic-ai/claude-code`
  (the docs' "conflicting installations" section; check `which -a claude`).

### 1.6 `claude install`, `claude update`, auto-updates, `claude doctor`

From `claude --help` (2.1.273) and setup.md:

```
claude install [options] [target]   # Install Claude Code native build. target = stable | latest | X.Y.Z
  --force                           # Force installation even if already installed
claude update|upgrade               # Check for updates and install if available
claude doctor                       # Read-only install + settings diagnostics; reads settings in cwd without a trust prompt;
                                    # "/doctor" in a session can also fix issues
```
* `claude install stable|latest` also saves the channel to user settings (`autoUpdatesChannel`).
* `claude update` prints `Successfully updated from <old> to version <new>` or `Claude Code is up to date (<v>)`.
* Auto-updates (native + npm): checked at startup and periodically, installed in background, applied next start.
  Since v2.1.246 `claude install`/`claude update` defer managed-settings consent dialogs to the next interactive
  session (fixes "Raw mode is not supported" from piped installs).
* Settings: `"autoUpdatesChannel": "latest"|"stable"` (default latest; written by `/config` or `claude install <channel>`);
  `"minimumVersion": "2.1.100"` floor; managed-only `requiredMinimumVersion`/`requiredMaximumVersion` (v2.1.163+)
  refuse to start out of range (`claude update/install/doctor` still work above the ceiling).
* Env: `DISABLE_AUTOUPDATER=1` stops background checks only (`claude update`/`claude install` still work);
  `DISABLE_UPDATES=1` (v2.1.118+) blocks all update paths; `FORCE_AUTOUPDATE_PLUGINS=1` keeps plugin auto-updates
  while `DISABLE_AUTOUPDATER=1`; `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` also disables auto-updates.
  Recommended form: `{"env": {"DISABLE_AUTOUPDATER": "1"}}` in `settings.json`; verify with `claude doctor`
  (`Auto-updates` line shows `disabled (set by env: DISABLE_AUTOUPDATER)`).
* There is **no documented `autoUpdates` settings key** in the current settings reference (grep: no entry). The local
  `~/.claude.json` has `autoUpdates: false` and `autoUpdatesProtectedForNative` from older versions; treat them as legacy.
* `claude doctor` checks (docs): install health and type (native/npm/Homebrew/WinGet), result of the most recent update
  attempt, `Auto-updates` status, settings-file validation errors, custom-launcher detection, stale `enabledPlugins`
  entries, macOS Keychain writability, organization-policy load errors, invalid managed MCP entries, with suggested fixes.
  `claude update`/`claude doctor` scan `~/.zshrc`, `~/.bashrc`, `~/.config/fish/config.fish` (+ macOS profile files)
  for an outdated `claude` alias (a *directory* at one of those paths hung both commands before v2.1.214).

### 1.7 Uninstall

```bash
rm -f ~/.local/bin/claude; rm -rf ~/.local/share/claude          # native, macOS/Linux/WSL
rm -rf ~/.claude; rm ~/.claude.json; rm -rf .claude; rm -f .mcp.json   # config (destructive)
```
```powershell
Remove-Item -Path "$env:USERPROFILE\.local\bin\claude.exe" -Force
Remove-Item -Path "$env:USERPROFILE\.local\share\claude" -Recurse -Force
Remove-Item -Path "$env:USERPROFILE\.claude" -Recurse -Force; Remove-Item -Path "$env:USERPROFILE\.claude.json" -Force
```

---

## 2. Windows requirements and known issues

Sources: setup.md, troubleshoot-install.md, CHANGELOG.

* Windows 10 1809+ / Server 2019+, x64 or ARM64 (win32-arm64 native since v2.1.41). 32-bit unsupported
  (installer errors "Claude Code does not support 32-bit Windows").
* Run the installer from PowerShell or CMD; no Administrator needed.
* Git for Windows is **optional** (setup.md: "recommended on native Windows so Claude Code can use the Bash tool";
  optional since v2.1.120, it was required from v1.0.51). With Git Bash present the Bash tool is used; without it
  the PowerShell tool is the shell. Set the path if not found:
  `{"env": {"CLAUDE_CODE_GIT_BASH_PATH": "C:\\Program Files\\Git\\bin\\bash.exe"}}`. Lookup order:
  `C:\Program Files\Git`, `C:\Program Files (x86)\Git`, then `git` on PATH.
* `CLAUDE_CODE_USE_POWERSHELL_TOOL`: auto-enabled without Git Bash; on by default for claude.ai/Console accounts;
  `=1` to enable on Bedrock/Vertex/Foundry, `=0` to disable; on Linux/macOS `=1` needs `pwsh`.
  PowerShell tool passes `-ExecutionPolicy Bypass` (opt out `CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY=1`).
* Sandboxing: not supported on native Windows or WSL1; supported on WSL2.
* WSL: install inside the WSL terminal with the Linux command; WSL setups do not need Git for Windows. WSL1:
  `cannot execute binary file: Exec format error` (issue #38788) - convert with `wsl --set-version <Distro> 2`, or wrap with
  `/lib64/ld-linux-x86-64.so.2 "$(readlink -f "$HOME/.local/bin/claude")" "$@"`.
* WSL2 login: the browser shows a code, paste it at `Paste code here if prompted`; set
  `export BROWSER="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"` to open the Windows browser.
* `running scripts is disabled on this system` / `PSSecurityException` -> npm shims blocked by execution policy (native install avoids it).
* `The process cannot access the file ...` during install -> clear `%USERPROFILE%\.claude\downloads` and retry.
* Endpoint security (AppLocker/EDR): allowlist `claude.exe` and the processes it spawns (`cmd.exe`, `bash.exe`).
* Claude Desktop can shadow the `claude` command on Windows (troubleshoot section).
* MCP stdio servers: the old "Windows requires `cmd /c` wrapper" warning was a false positive and was removed in v2.1.119;
  `claude mcp add ... -- npx -y <pkg>` is documented without a wrapper.
* Credentials: `%USERPROFILE%\.claude\.credentials.json`. Managed settings: `C:\Program Files\ClaudeCode\managed-settings.json`
  or registry `HKLM\SOFTWARE\Policies\ClaudeCode` value `Settings` (HKCU also read).
* Plugin cache paths with colons broke plugin MCP servers on Windows (fixed); OneDrive folders had `EEXIST` issues (fixed).

## 3. Linux requirements and caveats

* Ubuntu 20.04+, Debian 10+, Alpine 3.19+, 4 GB RAM, x64/ARM64. Documented fixes for glibc 2.26 (Amazon
  Linux 2), glibc < 2.30 (RHEL 8) and glibc 2.44 (Arch/CachyOS/Rawhide, fixed v2.1.245).
* musl/Alpine: `apk add bash curl libgcc libstdc++ ripgrep` (community repo may need
  `echo "https://dl-cdn.alpinelinux.org/alpine/v3.22/community" >> /etc/apk/repositories && apk update`), then
  `{"env": {"USE_BUILTIN_RIPGREP": "0"}}`. Installer auto-selects `linux-<arch>-musl`; a glibc host with musl
  cross packages can be misdetected (`Error loading shared library libstdc++.so.6`) - check `ldd --version`.
* ripgrep is bundled; `USE_BUILTIN_RIPGREP=0` uses system `rg`.
* AVX required: `grep -m1 -ow avx /proc/cpuinfo` empty -> `Illegal instruction` (troubleshoot-install.md + issue #50384,
  closed not-planned; docs say "virtual machines where the hypervisor does not pass AVX through". The Proxmox `kvm64`
  CPU-type example and the `host` CPU-type advice are inference by this report, not stated by Anthropic). No workaround.
* Check missing libs: `ldd "$(command -v claude)" | grep "not found"`.
* Credentials `~/.claude/.credentials.json` (0600). Managed settings `/etc/claude-code/managed-settings.json`
  (+ `managed-settings.d/*.json`, `managed-mcp.json`), managed skills `/etc/claude-code/.claude/skills/`.
* FreeBSD unsupported (installer reports it since v2.1.205).

## 4. Authentication on headless hosts

Source: authentication.md, headless.md, `claude auth login --help`.

Precedence (highest first): 1) cloud provider (`CLAUDE_CODE_USE_BEDROCK|VERTEX|FOUNDRY`), 2) `ANTHROPIC_AUTH_TOKEN`
(Bearer), 3) `ANTHROPIC_API_KEY` (X-Api-Key; interactive prompts once to approve, `-p` always uses it),
4) `apiKeyHelper` script, 5) `CLAUDE_CODE_OAUTH_TOKEN`, 6) Anthropic profile / WIF (`ANTHROPIC_PROFILE`,
`~/.config/anthropic`), 7) `/login` subscription OAuth.

```
claude auth login [--claudeai|--console] [--email <email>] [--sso]   # prints URL; accepts pasted code
claude auth status [--json|--text]
claude auth logout
claude setup-token                         # one-year OAuth token; prints, does not store; needs Pro/Max/Team/Enterprise
export CLAUDE_CODE_OAUTH_TOKEN=your-token
export ANTHROPIC_API_KEY=sk-ant-...        # Console key
```
* Browser-less machines: `claude`/`claude auth login` prints the login URL (press `c` to copy); when the browser
  cannot reach the local callback (WSL2, SSH, containers) it shows a code you paste at `Paste code here if prompted`.
* `--bare` / `CLAUDE_CODE_SIMPLE=1` never reads OAuth/keychain/`CLAUDE_CODE_OAUTH_TOKEN`: use `ANTHROPIC_API_KEY` or
  `--settings '{"apiKeyHelper": ...}'`.
* `CLAUDE_CODE_OAUTH_TOKEN` cannot use Remote Control or claude.ai connectors; local MCP still works.
* Storage: macOS Keychain (falls back to `~/.claude/.credentials.json` when locked over SSH); Linux
  `~/.claude/.credentials.json` 0600; Windows `%USERPROFILE%\.claude\.credentials.json`; honours `CLAUDE_CONFIG_DIR`.
* Bedrock/Vertex/Foundry: `CLAUDE_CODE_USE_BEDROCK=1` (+AWS creds/`AWS_REGION`), `CLAUDE_CODE_USE_VERTEX=1`
  (+`ANTHROPIC_VERTEX_PROJECT_ID`, GCP creds), `CLAUDE_CODE_USE_FOUNDRY=1` (+`ANTHROPIC_FOUNDRY_RESOURCE` or
  `ANTHROPIC_FOUNDRY_BASE_URL`, `ANTHROPIC_FOUNDRY_API_KEY`); `CLAUDE_CODE_SKIP_BEDROCK_AUTH`/`_VERTEX_AUTH`/`_FOUNDRY_AUTH`
  for gateways; `/setup-bedrock`, `/setup-vertex` wizards. Settings: `awsAuthRefresh`, `apiKeyHelper`,
  `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`. `forceLoginMethod` = `claudeai|console|gateway`, `forceLoginOrgUUID`.
* Known gap (issue #46259, closed not-planned, opened 2026-04-10): with only `CLAUDE_CODE_OAUTH_TOKEN` set, the
  *interactive* TUI still shows the onboarding/login screen; community workaround is `"hasCompletedOnboarding": true`
  in `~/.claude.json` (undocumented key; present in the local file).
* `/logout` resets first-launch onboarding state.

## 5. Settings files, precedence, and key semantics

Sources: settings.md, settings-reference.md, managed-settings.md, claude-directory.md, env-vars.md.

Precedence (highest first): 1) Managed (`managed-settings.json` + `managed-settings.d/*.json`, MDM plist
`com.anthropic.claudecode`, Windows registry `HKLM\SOFTWARE\Policies\ClaudeCode` / HKCU, server-managed from
claude.ai), 2) `claude --settings <file-or-json>` (one session), 3) `.claude/settings.local.json`,
4) `.claude/settings.json`, 5) `~/.claude/settings.json`. Env vars are not a level; per-key rules apply
(e.g. `ANTHROPIC_MODEL` beats `model`).

| File | Role |
|---|---|
| `~/.claude/settings.json` | User settings (all projects). Windows: `%USERPROFILE%\.claude\settings.json`. |
| `.claude/settings.json` | Shared project settings (commit it). `permissions.allow`, `additionalDirectories`, `extraKnownMarketplaces`, most `env` values and `@skills-dir` plugins wait for folder trust; `deny`/`ask` apply immediately. |
| `.claude/settings.local.json` | Personal per-project; gitignored when Claude writes it. |
| Managed | macOS `/Library/Application Support/ClaudeCode/managed-settings.json`; Linux/WSL `/etc/claude-code/managed-settings.json`; Windows `C:\Program Files\ClaudeCode\managed-settings.json`. `wslInheritsWindowsSettings` lets WSL read the Windows chain. |
| `~/.claude.json` | Global config written by Claude itself: theme (legacy location), OAuth account, per-project trust (`projects["<path>"].hasTrustDialogAccepted`), personal (user/local-scope) MCP servers, `enabledMcpjsonServers/disabledMcpjsonServers`, onboarding/UI state (`hasCompletedOnboarding`, `numStartups`, `installMethod`, `officialMarketplaceAutoInstalled`...). "Mostly managed through `/config` rather than editing directly." Backups in `~/.claude/backups/`. |
| `.mcp.json` | Project-scope MCP servers (project root). |
| `CLAUDE_CONFIG_DIR` | Overrides `~/.claude`: "All settings, session history, and plugins are stored under this path"; every `~/.claude` path on the directory page moves (`alias claude-work='CLAUDE_CONFIG_DIR=~/.claude-work claude'`). Set in shell/user/managed settings - project/local `env` cannot set it. |

Key semantics relevant to provisioning (settings-reference.md, fetched 2026-09-16):

* `enabledPlugins` (Any file): object `"plugin@marketplace": true|false`. "A plugin with no entry at any scope falls back to
  its `defaultEnabled` value. When you enable or disable a plugin with `/plugin` or `claude plugin enable`, Claude Code
  writes this key for you." Project beats user; opt out per machine in `settings.local.json`; managed `false` blocks install
  everywhere. Verbatim: "Enabling a plugin from an external source such as a GitHub repository or npm package in a project's
  `.claude/settings.json` doesn't install it for other people. On every path that loads plugins, Claude Code reports the
  plugin as not installed until each user installs it themselves." Aliases `additionalMarketplaces`/`allowedMarketplaces`
  exist for `extraKnownMarketplaces`/`strictKnownMarketplaces` (v2.1.232+).
* `extraKnownMarketplaces` (Any file): name -> `{ "source": {...}, "autoUpdate"?: bool }`. Verbatim: "Claude Code registers
  each marketplace it doesn't already know. Whether a plugin that `enabledPlugins` names from it installs depends on the
  plugin's source and which file enables it." Honoured from repo files only after trust (ignored silently in `-p` runs in
  untrusted folders); honoured immediately from user/managed settings. Source types: `github {repo, ref?, path?}`,
  `git {url}`, `url {url, headers?, headersHelper?}`, `file {path}`, `directory {path}`, `settings {name, plugins[]}` (inline
  marketplace; plugins must be external sources; still needs `enabledPlugins`). `skipLfs`. Marketplace state is per user in
  `~/.claude/plugins/known_marketplaces.json`.
* **Declarative provisioning - what the docs actually say**:
  1. plugins-reference "Node.js package dependencies": Claude Code creates the cached copy "when you install a plugin, when
     Claude Code updates a plugin to a new version, and **at session start when an enabled plugin isn't cached yet, such as
     on a new machine**".
  2. env-vars `CLAUDE_CODE_SYNC_PLUGIN_INSTALL`: "Set to `1` in non-interactive mode (the `-p` flag) to wait for plugin
     installation to complete before the first query. **Without this, plugins install in the background** and may not be
     available on the first turn." `--bare` "skips ... plugin sync".
  3. plugin-marketplaces "command sources": re-run "At startup or on `/reload-plugins`, when an enabled plugin's installed
     version is missing from the plugin cache".
  4. CHANGELOG 2.1.144: "Fixed plugins enabled in your own settings showing 'not cached' errors after first load on a fresh
     machine; plugins enabled only by a project's `.claude/settings.json` now show an actionable `claude plugin install` hint".
     CHANGELOG 2.1.195: "Fixed external plugins enabled only by project `.claude/settings.json` not requiring explicit install
     consent on every loader path". discover-plugins.md: "As of Claude Code v2.1.195, adding the marketplace doesn't install
     plugins that come from an external source, on any path that loads plugins. A plugin that only the project's
     `.claude/settings.json` enables, and that comes from an external source ... doesn't load until the team member installs it."
  5. Seed dirs: `extraKnownMarketplaces`/`enabledPlugins` "Composes with settings: if ... declare a marketplace that already
     exists in the seed, Claude Code uses the seed copy instead of cloning."
  Conclusion: user-scope (`~/.claude/settings.json`) or managed enablement of a plugin from a registered marketplace is the
  documented "install on new machine at session start" path; project-only enablement of external-source plugins is not.
  Because the exact per-source behaviour for user-scope external sources is only implied (not stated as a guarantee) and
  was not tested here (read-only research), the installer should use the explicit CLI (section 6) and only rely on
  settings for *enable/disable state*. Official-marketplace source histogram (marketplace.json 2026-09-16: url 155, git-subdir 90, relative 52;
  re-fetched 2026-09-17: 305 plugins = url 157, git-subdir 96, relative 52) (`superpowers`, `remember` = `url` + `sha`; `context7`, `playwright` = `./external_plugins/...`;
  `commit-commands`, `feature-dev` = `./plugins/...`).
* `statusLine`: `{"type":"command","command":"...","padding":2,"refreshInterval":N,"hideVimModeIndicator":bool}`; any file;
  disabled by `disableAllHooks` (outside managed) or `allowManagedHooksOnly`.
* `hooks`: same schema as plugin `hooks/hooks.json` (`{"hooks": {"PreToolUse": [{"matcher": "...", "hooks": [{"type": "command", ...}]}]}}`);
  handler types `command|http|mcp_tool|prompt|agent`; `disableAllHooks`, `allowManagedHooksOnly`, `allowedHttpHookUrls`.
* `permissions`: `allow`, `deny`, `ask`, `defaultMode` (`default|acceptEdits|plan|auto|dontAsk|bypassPermissions|manual`),
  `additionalDirectories`, `blockReadsOutsideWorkingDirectories`, `disableBypassPermissionsMode`;
  `skipDangerousModePermissionPrompt` (user/local/managed only).
* `model`, `modelSettings` (per-model effort), `effortLevel`, `maxEffortLevel`, `language`, `alwaysThinkingEnabled`,
  `theme` (`auto|dark|light|dark-daltonized|light-daltonized|dark-ansi|light-ansi|custom:<slug>`; "A value in `~/.claude.json`
  from an older version applies when no settings file sets it"), `tui`, `agent`.
* `env`: sets env vars for every session and subprocess (project/local `env` cannot set `CLAUDE_CONFIG_DIR`,
  `CLAUDE_CODE_TMPDIR`, `TMPDIR/TMP/TEMP`, `CLAUDE_CODE_PLUGIN_CACHE_DIR`, `CLAUDE_CODE_PLUGIN_SEED_DIR`, `CLAUDE_CODE_SYNC_*`).
* `autoUpdatesChannel`, `minimumVersion` (see 1.6). No `autoUpdates` key.
* `includeCoAuthoredBy`: deprecated since v2.0.62; use `attribution: {"commit": "...", "pr": "", "sessionUrl": false}`.
  `includeCoAuthoredBy: false` still honoured unless `attribution.commit/pr` is set.
* Plugin-related: `pluginAutoUpdate`, `pluginAutoUpdateInterval`, `pluginAutoRefreshInterval`, `pluginConfigs`
  (user/managed/--settings), `syncClaudeAiPlugins`, `syncClaudeAiSkills`; managed-only `strictKnownMarketplaces`,
  `blockedMarketplaces`, `strictPluginOnlyCustomization`, `disableCommandPluginSources`, `disableSideloadFlags`,
  `pluginSuggestionMarketplaces`, `pluginTrustMessage`, `allowedChannelPlugins`.
* MCP-related: `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers`, `allowedMcpServers`,
  `deniedMcpServers`, `managedMcpServers` (managed), `allowManagedMcpServersOnly`, `disableClaudeAiConnectors`.
* Misc: `cleanupPeriodDays` (default 30), `forceLoginMethod`, `forceLoginOrgUUID`, `apiKeyHelper`, `awsAuthRefresh`,
  `companyAnnouncements`, `respectGitignore`, `spinnerTipsEnabled`.

## 6. Plugin CLI, marketplaces, cache, versions, skills-dir plugins

Sources: `claude plugin --help`, `claude plugin install --help`, `claude plugin marketplace add --help` (2.1.273),
plugins-reference.md, discover-plugins.md, plugin-marketplaces.md.

```
claude plugin|plugins <cmd>
  install|i <plugin>[@marketplace] [-s user|project|local] [--config k=v]... [-y|--yes] [--accept-command <sha256>] [--json]
  uninstall|remove|rm <plugin> [-s scope] [--keep-data] [--prune] [-y] [--json]
  enable <plugin> [-s scope] [--json]          disable [plugin] [-s scope] [--json]    (bare name auto-detects scope)
  update <plugin> [-s user|project|local|managed] [-y] [--accept-command <sha256>] [--json]   # --json v2.1.268+
  list [--json] [--available]                  # --available requires --json; rows carry errors/notes (+errorDetails/noteDetails v2.1.268)
  details <name>                               # component inventory + projected token cost
  validate <path> [--strict] [--json]
  init|new <name> [--description] [--author] [--with skills,agents,hooks,mcp,lsp,output-style,channel] [-f]  # scaffolds in .claude/skills
  eval [target] [--trust-plugin]               prune|autoremove [-s scope] [-y] [--json]     tag [path]
claude plugin marketplace <cmd>   (in-session alias: /plugin market)
  add <source> [--scope user|project|local] [--sparse <paths...>] [--claudeai]   # source: owner/repo[@ref], git URL[#ref], https://.../marketplace.json, ./dir
  list [--json]      remove|rm <name> [--scope]      update [name]
```
(The docs list exactly `--scope` and `--sparse` for `marketplace add`; the local build adds `--claudeai`. No `--name`,
`--priority` or `--trusted` flags exist.) Example scripts:

```bash
claude plugin marketplace add anthropics/claude-plugins-official      # needed on hosts whose first launch is non-interactive
claude plugin marketplace add anthropics/claude-plugins-community     # community catalog, install as @claude-community
claude plugin marketplace add JuliusBrussee/caveman
claude plugin marketplace add acme-corp/claude-plugins@v2.0           # pin ref
claude plugin marketplace add https://gitlab.example.com/team/plugins.git
claude plugin marketplace add acme-corp/monorepo --sparse .claude-plugin plugins
claude plugin install superpowers@claude-plugins-official --scope user --json
claude plugin install caveman@caveman -y
claude plugin update superpowers@claude-plugins-official --json
claude plugin list --json
claude plugin marketplace list --json
claude plugin marketplace update
claude plugin disable my-tool@skills-dir
```
* Install identifiers: `plugin-name@marketplace-name` where plugin-name is the marketplace entry name. Named installs
  refresh the marketplace first and retry before "not found" (v2.1.232+ even with `DISABLE_AUTOUPDATER`; skipped within 30 s,
  with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, for seed or local marketplaces). Bare `claude plugin install plugin-name`
  reads cached catalogs only (run `claude plugin marketplace update <name>` first for new plugins).
* `-y` is required when stdin/stdout is not a TTY for command-source or headersHelper plugins; `--json` prints one
  result line `{command, outcome: ok|failed, message, pluginId?, scope?, failureCode?, shownCommand?}` with the same exit codes.
* Shell installs load on next start or `/reload-plugins` (also in `-p`, v2.1.260+; not for plugin MCP servers).
* Version resolution: `plugin.json version` -> marketplace entry `version` -> command output hash -> git SHA / latest.
  Marketplaces pin via `sha`/`ref`/`version` fields (e.g. official `superpowers` entry pins `sha`). npm sources support
  explicit version pinning (v2.1.7x+). No `name@marketplace@1.2.0` install syntax is documented.
* Auto-refresh/auto-update: after session start with up to 10 min random delay; `claude-plugins-official` and most
  Anthropic marketplaces default `autoUpdate: true`, third-party default `false` (toggle in `/plugin` -> Marketplaces or
  `"autoUpdate": true` on the `extraKnownMarketplaces` entry). Command-source plugins re-run once per session regardless.
  `DISABLE_AUTOUPDATER` also stops plugin auto-updates unless `FORCE_AUTOUPDATE_PLUGINS=1`.
* Cache layout (verified locally): `~/.claude/plugins/{cache,data,marketplaces,installed_plugins.json,known_marketplaces.json,plugin-catalog-cache.json}`;
  `cache/<marketplace>/<plugin>/<version>/` (e.g. `cache/claude-plugins-official/superpowers/6.3.0`), `+ node_modules/` when
  package.json+lockfile (`npm ci --ignore-scripts` / `bun install --frozen-lockfile --ignore-scripts`);
  `installed_plugins.json` = `{"version": 2, "plugins": {"superpowers@claude-plugins-official": [{"scope": "user",
  "installPath": ".../cache/claude-plugins-official/superpowers/6.3.0", "version": "6.3.0", "installedAt": "...",
  "lastUpdated": "...", "gitCommitSha": "..."}]}}` (project-scope entries add `projectPath`);
  `known_marketplaces.json` = `{"claude-plugins-official": {"source": {"source": "github", "repo": "anthropics/claude-plugins-official"},
  "installLocation": "~/.claude/plugins/marketplaces/claude-plugins-official", "lastUpdated": "..."}}`;
  `data/<plugin-id-with-dashes>/` persistent (`${CLAUDE_PLUGIN_DATA}`, `--keep-data`); `synced/` for claude.ai plugins;
  old versions swept ~14 days after update/uninstall. Root overridable with `CLAUDE_CODE_PLUGIN_CACHE_DIR`; read-only seeds with
  `CLAUDE_CODE_PLUGIN_SEED_DIR` (`:`/`;`-separated). `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` clones `owner/repo` over HTTPS;
  `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1` for offline hosts; `CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS` (default 120 s).
  `rm -rf ~/.claude/plugins/cache` resets. `CLAUDE_CONFIG_DIR` relocates all of it.
* Official marketplace auto-registers on the first *interactive* launch (`~/.claude.json` records
  `officialMarketplaceAutoInstallAttempted/officialMarketplaceAutoInstalled`); `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1`
  skips it permanently. Non-interactive first runs must `claude plugin marketplace add anthropics/claude-plugins-official`.
  Removing a marketplace from its last scope uninstalls its plugins.
* Session flags: `--plugin-dir <dir|zip>` (repeatable; a folder of plugins loads each child), `--plugin-url <zip-url>`;
  managed `disableSideloadFlags` can block them.
* Skills-directory plugins: `~/.claude/skills/<name>/.claude-plugin/plugin.json` (personal, no trust needed) or
  `<cwd>/.claude/skills/<name>/` (project, after trust; no monitors, MCP per-server approval, no walk-up) loads as
  `<name>@skills-dir` "with no marketplace and no install step"; `claude plugin init <name>` scaffolds at `~/.claude/skills/<name>/`
  (user dir; plugins-reference.md + `claude plugin init --help` 2.1.273; the 2.1.157 changelog wording `.claude/skills` is superseded); SKILL.md edits are live,
  other components need `/reload-plugins`; disable with `claude plugin disable my-tool@skills-dir`.
* claude.ai-synced plugins: `~/.claude/plugins/synced/<name>` as `<name>@synced` (terminal sync needs v2.1.273+ and a
  sign-in that grants plugin access); managed on claude.ai, not via `claude plugin install`; `syncClaudeAiPlugins: false` stops it.
* Plugin `settings.json` at plugin root supports only `agent` and `subagentStatusLine`. `userConfig` values via
  `claude plugin install --config key=value`, stored in `~/.claude/settings.json` `pluginConfigs`, sensitive ones in
  keychain/`~/.claude/.credentials.json`.
* LSP plugins (`typescript-lsp`, `pyright-lsp`, `gopls-lsp`...) need the language server binary installed separately
  (e.g. `npm install -g typescript-language-server typescript`).

## 7. MCP CLI and storage

Sources: `claude mcp --help` (2.1.273), mcp.md, headless.md, env-vars.md.

```
claude mcp add [-t stdio|sse|http] [-s local|user|project] [-e KEY=value]... [-H "Header: value"]...
               [--callback-port <port>] [--client-id <id>] [--client-secret] <name> <commandOrUrl> [args...]
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp
claude mcp add --transport http corridor https://app.corridor.dev/api/mcp --header "Authorization: Bearer ..."
claude mcp add example --env API_KEY=your-key -- npx -y @example/mcp-server
claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp
claude mcp add-json [-s scope] [--client-secret] <name> '<json>'     # e.g. '{"command":"npx","args":["-y","@example/mcp-server"]}'
claude mcp add-from-claude-desktop                                    # macOS and WSL only
claude mcp list | get <name> | remove [-s scope] <name>
claude mcp login <name> [--no-browser]   # OAuth; --no-browser prints URL, paste redirect URL back (SSH/headless)
claude mcp logout <name>
claude mcp reset-project-choices          # reset .mcp.json approvals
claude mcp serve                          # run Claude Code as an MCP server
```
* Scopes: `local` (default) -> `~/.claude.json` under `projects["<path>"].mcpServers`; `user` -> `~/.claude.json` top-level
  `mcpServers`; `project` -> `.mcp.json` at project root (needs interactive approval; `enableAllProjectMcpServers: true` or
  `enabledMcpjsonServers` to approve without prompt; `-p` connects them without asking unless `--setting-sources user`,
  `--bare`, `--strict-mcp-config` or `disabledMcpjsonServers`).
* `.mcp.json` supports `${VAR}` / `${VAR:-default}` expansion in `command`, `args`, `env`, `url`, `headers`; Claude's
  own credentials (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, AWS creds, `HTTPS_PROXY`, `NPM_TOKEN`) read as empty
  in remote `url`/`headers`. `headersHelper` for dynamic auth headers. Per-server `timeout`, `alwaysLoad`. Stdio servers
  receive `CLAUDE_PROJECT_DIR`.
* OAuth in-session: `/mcp` -> select server -> browser; CLI `claude mcp login`. Tokens stored per server; `claude mcp remove`
  deletes them. Managed: `managedMcpServers`, `allowedMcpServers`, `deniedMcpServers`, `managed-mcp.json`.
* Session flags: `--mcp-config <files-or-json...>` (space separated), `--strict-mcp-config` (only those servers).
  In `-p` with `--mcp-config` Claude waits up to `MCP_TIMEOUT` (default 30000 ms) for servers; entries that fail
  validation are skipped silently - check `system/init.mcp_server_errors` in `stream-json`.
* Tool search / deferred loading: "Tool search is enabled by default: MCP tools are deferred and discovered on demand."
  Only tool names + server instructions load at start; full schemas are fetched via the `ToolSearch` tool on demand, so
  many MCP servers cost little context. `ENABLE_TOOL_SEARCH`: unset (defer, with fallbacks), `true`, `auto` (defer when
  definitions >= 10 % of context), `auto:N`, `false` (load all upfront). Disabled automatically with non-first-party
  `ANTHROPIC_BASE_URL`, pre-4.5 Vertex models, Azure-hosted Foundry; `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` forces it off
  (managed settings can keep it on, v2.1.227+). Without tool search Claude uses `WaitForMcpServers`. Deny `ToolSearch` via
  `permissions.deny`. Plugin MCP tools are named `mcp__plugin_<plugin>_<server>__<tool>`.
  Other env: `MCP_TOOL_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS` (25000), `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`,
  `ENABLE_CLAUDEAI_MCP_SERVERS=false` / `disableClaudeAiConnectors` for claude.ai connectors.
* Windows: no `cmd /c` wrapper needed for `npx`-based stdio servers (false-positive warning removed in v2.1.119; the current
  mcp.md examples use plain `-- npx -y ...`).

## 8. Skills

Sources: skills.md, plugins-reference.md, commands.md, cli-reference.md.

| Location | Path |
|---|---|
| Personal | `~/.claude/skills/<name>/SKILL.md` (or `$CLAUDE_CONFIG_DIR/skills/`) |
| Project | `.claude/skills/<name>/SKILL.md`; nested `<subdir>/.claude/skills/` load lazily |
| Enterprise | `<managed dir>/.claude/skills/<name>/SKILL.md`, e.g. `/etc/claude-code/.claude/skills/` (`CLAUDE_CODE_DISABLE_POLICY_SKILLS=1` skips) |
| Plugin | `<plugin>/skills/<name>/SKILL.md` -> `/plugin:skill`; single-skill plugins may put `SKILL.md` at root |
| `--add-dir` | that dir's `.claude/skills/` for the session (also in `--bare`) |
| claude.ai synced | `~/.claude/skills/synced/` (reserved folder name; resync ~10 min; `syncClaudeAiSkills`) |

* "Claude Code skills follow the Agent Skills open standard (https://agentskills.io)"; standard fields `name`, `description`,
  `license`, `compatibility`, `metadata`, `allowed-tools`; Claude extensions: `context: fork`, `disable-model-invocation`,
  `user-invocable`, `model`, `effort`, `paths`, `shell`, `hooks`, `arguments`, `argument-hint`, `when_to_use`.
  Skill descriptions are always in context; bodies load on invocation. Precedence: enterprise > personal > project.
* The skills.sh `~/.agents/skills` directory is **not** a documented Claude Code load path (no mention in skills.md or
  plugins-reference.md); the skills CLI must place/link skills under `~/.claude/skills` (verify in the skills.sh research area).
* `claude import [codex|gemini|cursor] [--dry-run] [--yes]`: "Import config from another AI coding agent into Claude Code";
  `/import` "Bring configuration from OpenAI Codex, Google Gemini CLI, or Cursor on your machine into Claude Code, including
  instruction files, MCP servers, commands, subagents, and skills. In non-interactive mode with `-p`, `/import` lists what it
  found and gives you the command that confirms the import" (`--yes=<digest>`). v2.1.213+, Cursor v2.1.265+. Not on
  Bedrock/Vertex/Foundry/Claude Platform on AWS/apps gateway, nor with feature-flag fetching off. `/init` offers `/import`
  when Codex or Gemini config is found.
* `/reload-skills` rescans skill dirs; `/skill-doctor` and `/plugin` Stats show per-skill context cost.

## 9. Non-interactive provisioning and CI patterns

Sources: headless.md, permissions.md, cli-reference.md, `claude --help` (2.1.273).

* `claude -p "..."` never shows the workspace-trust dialog ("also whenever stdout is not a TTY"); settings files that fail
  validation are silently ignored. Without `--bare` it still runs project hooks and connects `.mcp.json` servers. To trust a
  folder by hand (documented in permissions.md): set `projects["<repo-root>"].hasTrustDialogAccepted = true` in `~/.claude.json`.
* Onboarding/theme prompts: no documented skip flag. Documented levers: `ANTHROPIC_API_KEY` set -> login skipped (one-time
  approval prompt in interactive mode, always used in `-p`); `CLAUDE_CODE_OAUTH_TOKEN` avoids `/login` for `-p`;
  `"theme": "dark"` in `settings.json` (documented key) avoids the theme picker's *effect*. Undocumented but community-standard
  (issue #46259, etokarev/claude-code-docker, jedi.be write-up): pre-seed `~/.claude.json` with
  `{"hasCompletedOnboarding": true, "theme": "dark", "projects": {"/work": {"hasTrustDialogAccepted": true}}}`;
  the `--dangerously-skip-permissions` safety warning cannot be pre-seeded per those sources (`skipDangerousModePermissionPrompt`
  setting exists for user/local/managed scope per settings-reference). Local `~/.claude.json` confirms keys
  `hasCompletedOnboarding`, `lastOnboardingVersion`, `theme`, `installMethod`, `numStartups`, `officialMarketplaceAutoInstalled`.
* Flags for provisioning/CI (from `claude --help`): `--settings <file-or-json>`, `--setting-sources user,project,local`,
  `--plugin-dir`, `--plugin-url`, `--mcp-config`, `--strict-mcp-config`, `--agents <json>`, `--add-dir`,
  `--allowedTools`/`--disallowedTools`, `--tools`, `--permission-mode <acceptEdits|auto|bypassPermissions|manual|dontAsk|plan>`,
  `--permission-prompts host|none`, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`,
  `--output-format text|json|stream-json`, `--json-schema`, `--max-turns`, `--max-budget-usd`, `--no-session-persistence`,
  `--bare`, `--restricted`, `--safe-mode` (`CLAUDE_CODE_SAFE_MODE=1`), `--debug[=cats]`, `--debug-file`, `--session-id`,
  `--model`, `--effort low|medium|high|xhigh|max`, `--fallback-model`, `--betas`, `--bg`, `--worktree`.
* `--bare` (v2.1.81+; sets `CLAUDE_CODE_SIMPLE=1`): "skip hooks, LSP, plugin sync, attribution, auto-memory, background
  prefetches, keychain reads, and CLAUDE.md auto-discovery ... Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper
  via --settings". Provide context explicitly via `--system-prompt[-file]`, `--add-dir`, `--mcp-config`, `--settings`,
  `--agents`, `--plugin-dir`.
* Plugin install in `-p`: `CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1` (+`_TIMEOUT_MS`) waits for background plugin installs and emits
  `system/plugin_install` events; `system/init` has `plugins`, `plugin_errors`, `mcp_servers`, `mcp_server_errors` for CI gates.
  `CLAUDE_CODE_SYNC_SKILLS=1` (+`_WAIT_TIMEOUT_MS`) for claude.ai-synced skills.
* Containers: build a seed with `CLAUDE_CODE_PLUGIN_CACHE_DIR=/opt/claude-seed claude plugin marketplace add org/plugins` and
  `CLAUDE_CODE_PLUGIN_CACHE_DIR=/opt/claude-seed claude plugin install my-tool@plugins`, then run with
  `CLAUDE_CODE_PLUGIN_SEED_DIR=/opt/claude-seed` (read-only, works in `-p`, seed entries override user config).
* Telemetry/traffic: `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`
  (also disables feature-flag fetching -> `claude import`, Remote Control unavailable), `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1`,
  `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`, `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1`, `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`.
* GitHub Actions: `anthropics/claude-code-action` with secret `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (from
  `claude setup-token`); `/install-github-app` automates it.
* Other subcommands in 2.1.273: `agents`, `attach`, `auth`, `auto-mode`, `doctor`, `gateway`, `import`, `install`, `logs`, `mcp`,
  `plugin|plugins`, `project` (`claude project purge [path]`), `respawn`, `rm`, `setup-token`, `stop|kill`, `ultrareview`, `update|upgrade`.

## 10. Suggested installer flow (derived from the sources above)

```bash
# 1. install / update (Linux, macOS, WSL)
curl -fsSL https://claude.ai/install.sh | bash -s "${CLAUDE_CHANNEL:-latest}"    # or: claude update
export PATH="$HOME/.local/bin:$PATH"
claude --version && claude doctor
# 2. auth (headless)
export CLAUDE_CODE_OAUTH_TOKEN=...   # from `claude setup-token` on a browser host, or ANTHROPIC_API_KEY
# 3. marketplaces + plugins (explicit, idempotent, JSON results)
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add JuliusBrussee/caveman
for p in superpowers@claude-plugins-official caveman@caveman ...; do claude plugin install "$p" --scope user -y --json; done
claude plugin update <plugin>@<marketplace> --json        # upgrade path; or: claude plugin marketplace update
claude plugin list --json                                 # verify
# 4. MCP
claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp
claude mcp add --scope user caveman -- ~/.caveman/bin/caveman-mcp
# 5. settings: merge keys into ~/.claude/settings.json with jq (model, hooks, statusLine, permissions, env, autoUpdatesChannel, theme)
# 6. skills: copy/symlink into ~/.claude/skills/<name>/SKILL.md ; optional: claude import codex --dry-run
```
Windows (PowerShell): `irm https://claude.ai/install.ps1 | iex` (or `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable`),
then the same `claude plugin` / `claude mcp` commands; `winget install Anthropic.ClaudeCode` as an alternative.

## Sources

* https://code.claude.com/docs/en/setup.md - install methods, channels, Alpine, Windows, updates, signing, uninstall
* https://code.claude.com/docs/en/troubleshoot-install.md - PATH, conflicts, Windows/WSL/musl/AVX/Docker/OOM, login, doctor
* https://code.claude.com/docs/en/settings.md, https://code.claude.com/docs/en/settings-reference.md - precedence, keys (`enabledPlugins`, `extraKnownMarketplaces`, `theme`, `autoUpdatesChannel`, `minimumVersion`)
* https://code.claude.com/docs/en/managed-settings.md - managed paths, registry, plist, managed-settings.d
* https://code.claude.com/docs/en/env-vars.md - environment variables (`CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_SYNC_PLUGIN_INSTALL`, `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL`, `CLAUDE_CODE_PLUGIN_*`)
* https://code.claude.com/docs/en/authentication.md - login methods, precedence, setup-token, credential storage
* https://code.claude.com/docs/en/cli-reference.md - commands and flags, `claude import`
* https://code.claude.com/docs/en/headless.md - `-p`, `--bare`, CI patterns, plugin sync events
* https://code.claude.com/docs/en/permissions.md - trust dialog rules, `hasTrustDialogAccepted`
* https://code.claude.com/docs/en/plugins.md, plugins-reference.md, discover-plugins.md, plugin-marketplaces.md - plugin CLI, scopes, cache, seed dirs, auto-update, synced plugins, skills-dir plugins
* https://code.claude.com/docs/en/mcp.md - MCP CLI, scopes, tool search
* https://code.claude.com/docs/en/skills.md, https://code.claude.com/docs/en/commands.md - skills, `/import`
* https://code.claude.com/docs/en/hooks.md - hook events/schema
* https://code.claude.com/docs/en/claude-directory.md - `~/.claude` layout, `~/.claude.json` contents, `CLAUDE_CONFIG_DIR`
* https://claude.ai/install.sh, https://claude.ai/install.ps1, https://claude.ai/install.cmd - installer internals
* https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md - version history (2.1.273 top; entries 2.1.15, 2.1.41, 2.1.81, 2.1.118, 2.1.119, 2.1.129, 2.1.144, 2.1.157, 2.1.195, 2.1.232, 2.1.268)
* https://api.github.com/repos/anthropics/claude-code - stars/forks/pushed_at (2026-09-16)
* https://github.com/anthropics/claude-code - README (npm marked deprecated)
* https://github.com/anthropics/claude-code/issues/46259 - onboarding ignores `CLAUDE_CODE_OAUTH_TOKEN`, `hasCompletedOnboarding` workaround
* https://registry.npmjs.org/@anthropic-ai/claude-code/latest, https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags, https://api.npmjs.org/downloads/point/last-week/@anthropic-ai/claude-code
* https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json - plugin sources
* https://downloads.claude.ai/claude-code-releases/{latest,stable,<v>/manifest.json} - channel versions, platforms
* Local: `claude --help`, `claude plugin --help`, `claude plugin install --help`, `claude plugin marketplace add --help`, `claude plugin list --help`, `claude mcp --help`, `claude auth login --help`, `claude import --help`, `claude install --help`, `claude doctor --help` (2.1.273); read-only inspection of `~/.claude/plugins/*.json` and `~/.claude.json` keys


## Verification (fact-check pass, 2026-09-17)

Method: every URL, command and version above was re-fetched on 2026-09-17 (installer scripts from
`https://claude.ai/install.{sh,ps1,cmd}`, the `.md` endpoints of code.claude.com docs, raw CHANGELOG/README,
npm registry + api.npmjs.org, downloads.claude.ai channel endpoints and manifests, formulae.brew.sh cask API,
github.com winget-pkgs tree, the official marketplace.json, GitHub issues #46259/#50384) and compared with
`claude ... --help` output of the locally installed 2.1.273 binary. Nothing was installed or mutated.

### Confirmed unchanged (character-by-character)
* All three native install commands and their pin variants (`bash -s stable|2.1.89`, `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable`, `install.cmd stable`): setup.md lines 45-57 and 302-358.
* install.sh: regex `^(stable|latest|[0-9]+\.[0-9]+\.[0-9]+(-[^[:space:]]+)?)$`, `CLAUDE_INSTALL_ALLOW_SUDO`, `DOWNLOAD_BASE_URL=https://downloads.claude.ai/claude-code-releases`, `DOWNLOAD_DIR=$HOME/.claude/downloads`, musl detection, always downloads `latest`, manifest.json SHA256 check, then `"$binary_path" install ${TARGET:+"$TARGET"}`, exit-137 OOM hint (512 MB). install.ps1: `[ValidatePattern('^(stable|latest|\d+\.\d+\.\d+(-[^\s]+)?)$')]`, 32-bit refusal, win32-arm64/x64, `$env:USERPROFILE\.claude\downloads`. install.cmd: requires curl, `--ssl-revoke-best-effort` retry, runs `"!BINARY_PATH!" install "!TARGET!"`.
* Channel endpoints: latest=2.1.273, stable=2.1.267. npm dist-tags latest=2.1.273 / stable=2.1.267 / next=2.1.274; `deprecated: null`; `engines.node >=22.0.0`; optionalDependencies = the 8 platform packages; 10,994,666 downloads for 2026-09-05..2026-09-11.
* README: "Installation via npm is deprecated"; CHANGELOG 2.1.15 deprecation notice; setup.md "As of v2.1.198, the npm package requires Node.js 22 or later" (EBADENGINE warning only). README badge still says "Node.js 18+" (stale badge, ignore).
* apt/dnf/apk snippets, key URL, fingerprint `31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE`, apk key sha256 `395759c1...68b6`, upgrade commands (setup.md 372-459). Manifest signatures "available for releases from 2.1.89 onward" (setup.md 559); `2.1.273/manifest.json.sig` returns HTTP 200.
* `brew install --cask claude-code` / `claude-code@latest`, `winget install Anthropic.ClaudeCode`, no auto-update, `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE` (CHANGELOG 2.1.129), WinGet lock caveat.
* `DISABLE_AUTOUPDATER` vs `DISABLE_UPDATES` (2.1.118), `claude doctor` "disabled (set by env: DISABLE_AUTOUPDATER)", `autoUpdatesChannel`, `minimumVersion`, `requiredMinimumVersion/requiredMaximumVersion`; settings-reference has NO `autoUpdates` key (grep: 0 hits); custom launcher preserved since 2.1.207; `claude update|upgrade`, `claude install [target] --force`.
* Windows: 10 1809+/Server 2019+, x64+ARM64 (2.1.41), no admin, Git for Windows optional, `CLAUDE_CODE_GIT_BASH_PATH`, cmd /c warning removed 2.1.119; WSL1 Exec format error (issue #38788); Alpine packages + `USE_BUILTIN_RIPGREP=0`; Docker `WORKDIR /tmp`; AVX section + issue #50384.
* Auth: precedence list (7 entries, authentication.md 199-209), `claude setup-token` one-year token not stored, Pro/Max/Team/Enterprise, no Remote Control/connectors, `--bare` ignores `CLAUDE_CODE_OAUTH_TOKEN`; "Paste code here if prompted", press `c`; credentials `.credentials.json` 0600 / Keychain / follows `CLAUDE_CONFIG_DIR`; `claude auth status --json` (default) / `--text`.
* Settings precedence and managed paths (`/etc/claude-code/managed-settings.json`, `managed-settings.d/`, `C:\Program Files\ClaudeCode\managed-settings.json`, `HKLM\SOFTWARE\Policies\ClaudeCode` value `Settings`); `-p` shows no trust dialog, skips broken settings and continues (settings.md 614); `projects["<path>"].hasTrustDialogAccepted` (permissions.md 684); `theme` key with legacy `~/.claude.json` fallback; `includeCoAuthoredBy` deprecated since v2.0.62 -> `attribution` (settings-reference 3705-3711).
* Plugins: enabledPlugins/extraKnownMarketplaces quotes verbatim (settings-reference 4485, 4489-4491); "such as on a new machine" (plugins-reference 829, in the dependency-install paragraph); v2.1.195 rule (discover-plugins 502); CHANGELOG 2.1.144 "not cached" fix (line 3027, inside the 2.1.144 section); `claude plugin marketplace add` flags = `--scope`, `--sparse`, `--claudeai` only; `plugin install` flags `-s/-y/--config/--accept-command/--json`; `plugin update -s user|project|local|managed`; `--json` requires v2.1.268; `list --json --available`, `errorDetails/noteDetails` (2.1.268); orphan sweep ~14 days; seed-dir commands and 5 behaviour bullets; official marketplace auto-registration env var; `FORCE_AUTOUPDATE_PLUGINS`; 10-minute random delay; official marketplaces auto-update on by default.
* installed_plugins.json `version: 2` with `{scope, installPath, version, installedAt, lastUpdated, gitCommitSha}` arrays and known_marketplaces.json `{source, installLocation, lastUpdated}` (local read-only inspection). `~/.claude/plugins/synced/` is documented (plugins-reference 811) even though absent locally.
* MCP: `claude mcp add` flags (`-t` defaults to stdio, `-s`, `-e`, `-H`, `--callback-port`, `--client-id`, `--client-secret`), subcommands incl. `add-from-claude-desktop` ("Mac and WSL only"), `login --no-browser`, `reset-project-choices`, `serve`; local/user in `~/.claude.json`, project in `.mcp.json`; tool search on by default, 2 KB truncation, `WaitForMcpServers` fallback, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`.
* `claude import [codex|gemini|cursor] [--dry-run] [--yes]`, v2.1.213+, Cursor v2.1.265+, `--yes=<digest>` headless, unavailable on Bedrock/Agent Platform/Foundry/gateway or without feature-flag fetching (commands.md 97, cli-reference 35, local `--help`).
* `--bare` help text (2.1.273): skips hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, CLAUDE.md auto-discovery; sets `CLAUDE_CODE_SIMPLE=1`.
* Issue #46259 "Onboarding flow ignores CLAUDE_CODE_OAUTH_TOKEN, blocks interactive CLI", opened 2026-04-10, closed as not planned, workaround `"hasCompletedOnboarding": true` in `~/.claude.json` (key present locally = true).

### Corrections made
1. `claude plugin init <name>` scaffolds at `~/.claude/skills/<name>/` (user directory), not the project `.claude/skills/` as the item's comment said. Source: plugins-reference.md "### plugin init" + `claude plugin init --help` (2.1.273). The 2.1.157 changelog wording (".claude/skills") is superseded.
2. `claude auth login --email` takes an argument: `--email <email>` (local `--help`). Written as `[--email]` in the JSON summary/item.
3. Official marketplace plugin count: 305 on 2026-09-17 (was 297 on 2026-09-16); source histogram now url 157 / git-subdir 96 / relative 52.
4. GitHub star/fork numbers: api.github.com returned 403 to this host on 2026-09-17, so the exact 145,468 / 23,473 figures could not be re-read; the repository page shows "145.5k stars, 23.5k forks", consistent. Confidence for the exact figures lowered to medium.
5. The Proxmox `kvm64` example for the AVX crash is inference (docs say "virtual machines where the hypervisor does not pass AVX through"; issue #50384 is about an AMD A4 APU and never mentions kvm64/Proxmox/QEMU). The AVX requirement itself is now confirmed from troubleshoot-install.md (confidence raised to high; kvm64 kept as a note).
6. `includeCoAuthoredBy` deprecation re-grepped and confirmed (settings-reference 3705-3711) -> confidence raised to high.
7. Homebrew item: `platforms` said "Homebrew on Linux not mentioned"; still true, and the cask API now confirms `claude-code` = 2.1.267 (stable) and `claude-code@latest` = 2.1.273 with `url` pointing at `downloads.claude.ai/claude-code-releases/<ver>/darwin-arm64/claude` (macOS binaries only). Popularity remains unknown.
8. WinGet item: manifests for `Anthropic.ClaudeCode` exist in microsoft/winget-pkgs up to at least 2.1.267 (directory `manifests/a/Anthropic/ClaudeCode/2.1.267` exists, 2026-09-17). `last_activity` updated accordingly.

### Added facts (missed by the first pass)
* `CLAUDE_CODE_SYNC_PLUGIN_INSTALL_TIMEOUT_MS` bounds the wait that `CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1` introduces (env-vars.md); headless stream emits `system/plugin_install` events while waiting (headless.md 220, 247).
* `claude mcp add-json` / `.mcp.json` / `~/.claude.json` accept `"type": "streamable-http"` as an alias for `http` (mcp.md 83).
* `~/.claude/plugins/plugin-catalog-cache.json` exists next to `installed_plugins.json` and `known_marketplaces.json` on 2.1.273 (local inspection; undocumented, treat as cache).
* `claude plugin marketplace remove <name>` from its last remaining scope also uninstalls the plugins installed from it (plugin-marketplaces.md 1325) - installer must not "remove + re-add" to refresh; use `marketplace update`.
* Installing `plugin@marketplace` refreshes that marketplace first even with auto-update off or `DISABLE_AUTOUPDATER` set (discover-plugins.md 309, since v2.1.232).
* `claude plugin uninstall --json` cannot be combined with `--prune` (plugins-reference 1083).
* `claude plugin validate --json` requires v2.1.259+ (plugins-reference 1282).
* Manifest platforms for 2.1.273: darwin-arm64, darwin-x64, linux-arm64, linux-arm64-musl, linux-x64, linux-x64-musl, win32-arm64, win32-x64 (downloads.claude.ai manifest.json).

### Removed items
None. Every URL in the item list resolved (code.claude.com `.md` endpoints, npmjs.com package, claude.ai installer scripts).
