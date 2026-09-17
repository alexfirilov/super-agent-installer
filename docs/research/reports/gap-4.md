# GAP-FILL 4 — Windows parity matrix for every non-agent component

Researched 2026-09-17 from a Linux host (Ubuntu 26.04). READ-ONLY. **No Windows VM was available in this
session, so the two "test on a patched Windows 10/11 VM" items (install.ps1 prompt, `claude mcp add ... npx`)
could NOT be executed; what follows for them is sourced from Microsoft docs, the fetched install scripts, the
Claude Code CHANGELOG and dated GitHub issues, and is labelled "unverified on VM".**

Conventions: PS5.1 = Windows PowerShell 5.1 (ships with Windows). pwsh = PowerShell 7.x (`winget install
Microsoft.PowerShell`, winget-pkgs manifest 7.6.6.0 on 2026-09-17). "Git Bash" = Git for Windows (`winget
install Git.Git`, manifest 2.55.0.3). All commands below are copied verbatim from the cited source; where a
Windows command is missing from every source I write **n/a (no sourced command)**.

---

## 0. Platform facts that drive every row

| Fact | Source |
|---|---|
| Claude Code native Windows: Git for Windows is **optional** since **2.1.120** (CHANGELOG 2.1.120, verified at tag v2.1.120: "Windows: Git for Windows (Git Bash) is no longer required — when absent, Claude Code uses PowerShell as the shell tool"). With Git Bash present, Bash tool + PowerShell tool both exist; without it only PowerShell tool. `CLAUDE_CODE_GIT_BASH_PATH` in `settings.json.env` if Git Bash is not found. | https://code.claude.com/docs/en/setup ; CHANGELOG line "Windows: Git for Windows (Git Bash) is no longer required" |
| **Claude hooks on Windows**: shell-form `command` runs in **Git Bash when installed, else PowerShell**. Per-hook `"shell": "powershell"` forces PowerShell ("Ignored when `args` is set"). Exec form (`command` + `args`) needs a real `.exe`; npm `.cmd` shims cannot be spawned in exec form — use `node <script.js>`. *(Verifier: the sub-claims "auto-detects `pwsh.exe`, falls back to `powershell.exe`" and "`${CLAUDE_PROJECT_DIR}` rewritten to `${env:NAME}` for PowerShell hooks (v2.1.198+)" were NOT found in the fetched hooks page — treat as unsourced.)* | https://code.claude.com/docs/en/hooks (fields table: `shell`; "Windows PowerShell tool" section) |
| **Claude statusLine on Windows**: "runs status line commands through Git Bash when Git Bash is installed, or through PowerShell when Git Bash is absent." Use forward slashes in paths. Documented cross-shell form: `"command": "powershell -NoProfile -File C:/Users/username/.claude/statusline.ps1"`. | https://code.claude.com/docs/en/statusline#windows-configuration |
| **Claude MCP stdio on native Windows (current)**: Claude Code now auto-wraps `"command": "npx"` as `cmd.exe /d /s /c "npx ^"...^""` (observed Sep 2 2026, issue #91526). The old "Windows requires 'cmd /c' wrapper" warning was removed in **2.1.119** (verified at tag v2.1.120: "Windows: removed false-positive "Windows requires 'cmd /c' wrapper" MCP config warning"; same release also "Fixed MCP servers from plugins not spawning on Windows when the plugin cache was incomplete"). Side effect: args containing `^ & | < > %` get mangled by cmd.exe (#91526, open). Plugin-shipped bare-`npx` MCP servers were still reported failing at 2.1.139 (#58510, closed not-planned). **Unverified on VM.** | CHANGELOG 2.1.119; https://github.com/anthropics/claude-code/issues/91526 ; /issues/58510 ; /issues/20061 ; /issues/46360 |
| **Claude LSP plugins on native Windows**: `typescript-language-server --stdio` / `pyright-langserver --stdio` are npm `.cmd` shims; Claude spawns without shell → `ENOENT ... uv_spawn 'typescript-language-server'`. Still reported at **2.1.143 (2026-05-17, #59925)**; pyright works when it resolves to a real `.exe` (pip install). No CHANGELOG entry through 2.1.274 mentions a `.cmd`/PATHEXT fix (#58510 claims LSP spawn fixed in 2.1.132 but #59925 contradicts). | https://github.com/anthropics/claude-code/issues/59925 , /51191 , /16751 ; dev.to guide (2.1.71) |
| **Codex hooks on Windows**: supported. Codex resolves `command_windows`/`commandWindows` when `cfg!(windows)`, otherwise uses `command`; hooks execute through `%COMSPEC% /C` (fallback `cmd.exe /C`; unix: `$SHELL -lc`, fallback `/bin/sh -lc`), i.e. **cmd.exe syntax, not PowerShell, not bash**. `windows_managed_dir` for managed hooks. Trust via `/hooks`. Docs also say hooks are gated by `[features] hooks = true` in `config.toml` (your local inventory lists `hooks` as stable, so it may already be on). **Docs moved**: `developers.openai.com/codex/*.md` now 308-redirects to `https://learn.chatgpt.com/docs/hooks.md` (verified 2026-09-17). | https://learn.chatgpt.com/docs/hooks.md ; codex-rs/hooks/src/engine/command_runner.rs (`("COMSPEC", "cmd.exe", "/C")`), engine/discovery.rs (`command_windows.unwrap_or(command)`) |
| **Codex MCP stdio on Windows**: Codex resolves `npx`→`npx.cmd` itself via the `which` crate + PATHEXT ("enables tools like `npx`, `pnpm`, and `yarn` to work correctly on Windows without ... extensions"). No `cmd /c` needed. | codex-rs/rmcp-client/src/program_resolver.rs |
| **Codex sandbox on Windows**: no bubblewrap; `[windows] sandbox = "elevated"` (preferred, admin setup) or `"unelevated"`. "`winget` should be available. If it's missing, update Windows or install the Windows Package Manager before setting up Codex." Win11 recommended; Win10 ≥1809 best effort. Enterprise pin: `[windows] allowed_sandbox_implementations = ["elevated"]`. (IDE extension native deps: `winget install --id Microsoft.VisualStudio.2022.BuildTools -e`.) | https://learn.chatgpt.com/docs/windows/windows-sandbox.md (308 from developers.openai.com/codex/windows.md) |
| **PS 5.1 `irm | iex` and CVE-2025-54100**: since the **2025-12-09** Windows update, `Invoke-WebRequest` **without `-UseBasicParsing`** shows "Security Warning: Script Execution Risk ... Do you want to continue?" — "There is no way to bypass this prompt without using the UseBasicParsing parameter"; non-interactive scripts "could ... hang while waiting for input" (KB5074596). `Invoke-RestMethod` (`irm`) is not listed as affected. PowerShell 7 is not affected (no IE DOM parser). | https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/invoke-webrequest?view=powershell-5.1 ; https://support.microsoft.com/KB/5074596 |
| **Windows symlinks**: skills CLI uses NTFS **junctions** on win32 (`symlinkType = 'junction'`) which need no privilege; on failure it silently falls back to copy. Developer Mode is only needed for real symlinks (git `core.symlinks`, caveman-for-Codex clone). Registry: `reg add "HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /t REG_DWORD /f /v "AllowDevelopmentWithoutDevLicense" /d "1"` (admin). | vercel-labs/skills src/installer.ts ; https://learn.microsoft.com/en-us/windows/advanced-settings/developer-mode |

---

## 1. The matrix

Status legend: **works** = native Windows from PS5.1/pwsh without Git Bash; **needs Git Bash**; **needs WSL**; **broken/unsupported**; **unverified** = only evidence is docs/issues, not a VM run.

### 1.1 caveman (plugin + hooks + statusline + CLI)  — v2.7.0 plugin, @caveman-ai/cli 1.3.4 (npm 2026-09-15); 106.1k★ (2026-09-17)

| Piece | Linux | Windows PS 5.1 | Windows pwsh 7 | Status | Source |
|---|---|---|---|---|---|
| Unified installer (plugin+hooks+statusline, auto-detects agents) | `curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/v2.7.0/install.sh \| bash` | `irm https://raw.githubusercontent.com/JuliusBrussee/caveman/v2.7.0/install.ps1 \| iex` (if blocked: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`) | same `irm ... \| iex` | **works** (install.ps1 is a thin shim → `npx -y "github:JuliusBrussee/caveman#v2.7.0"`; needs Node ≥18 for shim, CLI needs ≥22.13; refuses to run Windows-Node inside WSL) | INSTALL.md; install.ps1; bin/install.js `checkWslWindowsNode` |
| Preview | `curl ... \| bash -s -- --dry-run` | `pwsh install.ps1 --list` (from clone) / `npx -y github:JuliusBrussee/caveman -- --list` | same | works | INSTALL.md |
| Claude plugin only | `claude plugin marketplace add JuliusBrussee/caveman && claude plugin install caveman@caveman` | same (`;` instead of `&&` on PS5.1) | same | works (`&&` is valid in pwsh 7, not PS5.1) | INSTALL.md per-agent table |
| Plugin hooks (SessionStart/UserPromptSubmit from plugin.json) | run via `sh -c` | Plugin hook command is `HOOK_ROOT=$(printf %s "${CLAUDE_PLUGIN_ROOT}" \| sed 's\|^/\([a-zA-Z]\)/\|\1:/\|'); node "$HOOK_ROOT/src/hooks/caveman-activate.js"` → POSIX syntax (`sed`, `$(...)`) | same | **needs Git Bash** (Claude runs shell-form hooks in Git Bash when present; without Git Bash they run in PowerShell and this syntax fails). The `sed` converts Git-Bash `/c/Users` to `c:/Users`, which proves it targets Git Bash. | .claude-plugin/plugin.json; hooks docs |
| Standalone hooks (bin/install.js `--only claude`, used when plugin install fails or `--with-hooks`) | `node <abs node path> ~/.claude/hooks/caveman-activate.js` | writes `node` + absolute script paths; statusline `pwsh -NoProfile -ExecutionPolicy Bypass -File <hooksDir>\caveman-statusline.ps1` if `pwsh` on PATH else `powershell ...` | same | **works** without Git Bash | bin/install.js lines 1196-1206 |
| Statusline badge, plugin users | Claude nudge suggests `bash "<cache>/src/hooks/caveman-statusline.sh"`; your machine uses `bash "$(ls -td "$HOME/.claude/plugins/cache/caveman/caveman/"*/ 2>/dev/null \| head -1)src/hooks/caveman-statusline.sh"` | nudge on win32 suggests `powershell -ExecutionPolicy Bypass -File "<cache>\src\hooks\caveman-statusline.ps1"` (path contains the plugin version hash) | same | **works via .ps1 port** (`src/hooks/caveman-statusline.ps1`, 82 lines, ships in plugin cache — verified locally at `~/.claude/plugins/cache/caveman/caveman/15581d14007f/src/hooks/`). The `ls -td` glob form is bash-only → **needs Git Bash**; the unified installer does NOT wire a statusline when the plugin install succeeds (hooks skipped: "plugin manifest handles hooks"). | src/hooks/caveman-activate.js lines 405-421; src/hooks/README.md |
| `caveman setup --agent-native claude` (CLI; your current hooks) | writes `'<path>/caveman-proxy' native-hook claude --adapter '<path>/native-hook-fast.js'` | writes `& '<C:/path>/caveman-proxy.exe' native-hook claude --adapter '...'` and sets `hook.shell = "powershell"` on win32 (Claude only; timeout 30) | same | **works, PowerShell-native** (no Git Bash) | packages/cli/src/index.ts `hookExecutableInvocation`, `nativeHookEntry` |
| `caveman setup --agent-native codex` | same CLI | same CLI; Codex runs hooks via cmd.exe — index.ts sets `hookShell = win32 ? "powershell" : "bash"` and builds `& '<exe>' ...` on win32; the "PowerShell-form only for `agentId === "claude"`" claim could NOT be re-confirmed by the verifier (two fetches of index.ts showed different truncations) — treat as **medium** | same | **unverified**; caveman docs: "Codex hooks are currently disabled on Windows, so use `$caveman` to start the mode manually each session" (docs/install-windows.md) | docs/install-windows.md |
| Codex plugin/skill | `npx skills add JuliusBrussee/caveman -a codex -g` | `git config --global core.symlinks true` (needs Developer Mode/admin) → clone → VS Code Codex Settings → Plugins → local marketplace → Install. Or `npx skills add JuliusBrussee/caveman --copy` | same | works with `--copy`; symlink route needs Developer Mode | docs/install-windows.md |
| Manual fallback (issues #249/#199/#72) | n/a | PowerShell block in docs/install-windows.md (copies SKILL.md into `~/.claude/.agents/plugins/caveman/skills/caveman`, updates marketplace.json) | same | works | docs/install-windows.md |
| Update | `claude plugin update caveman@caveman` ; re-run `npx -y github:JuliusBrussee/caveman` ; `npm i -g @caveman-ai/cli` | same | same | works (`claude plugin update caveman` short name FAILS — must be `caveman@caveman`) | INSTALL.md Update |
| Uninstall | `npx -y github:JuliusBrussee/caveman -- --uninstall` (run BEFORE `npm uninstall -g @caveman-ai/cli`) | same | same | works | INSTALL.md |

Picker recommendation on Windows: install plugin + `caveman setup --agent-native claude` (PowerShell-native), set statusline to the `.ps1` with an **installer-resolved absolute path** (re-resolve on every update run because the cache dir name is the plugin version hash) or copy `caveman-statusline.ps1` to `~/.claude/hooks/` and point at that stable path. If Git Bash is absent, the plugin's own SessionStart/UserPromptSubmit hooks will fail → either require Git Bash or use `npx -y github:JuliusBrussee/caveman -- --only claude --with-hooks` (double-fire warning if plugin also installed).

### 1.2 skills CLI (vercel-labs/skills) — npm `skills` 1.6.0 (2026-09-17), engines node ≥22.20.0; 31.8k★ (2026-09-17)

| Piece | Linux | PS 5.1 | pwsh 7 | Status | Source |
|---|---|---|---|---|---|
| Install a skill globally | `npx skills add <owner/repo> -g -a claude-code -a codex -y` (README: `npx skills add vercel-labs/agent-skills --skill frontend-design -g -a claude-code -y`) | same | same | **works**; on win32 `createSymlink` uses `symlink(target, link, 'junction')`; any failure → silent copy fallback (`symlinkFailed: true`) | src/installer.ts lines 285-288, 426-437 |
| Force copy | `--copy` ("Copy files instead of symlinking to agent directories") | `npx skills add JuliusBrussee/caveman --copy` | same | works | README flags table; caveman docs |
| Update | `npx skills update -y` / `npx skills update -g` | same | same | works | README `skills update` |
| Developer Mode | n/a | not required for junctions; only for real symlinks (git core.symlinks). `reg add "HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /t REG_DWORD /f /v "AllowDevelopmentWithoutDevLicense" /d "1"` (admin PowerShell) | same | n/a | learn.microsoft.com developer-mode |
| Node requirement | ≥22.20.0 (`engines`) | same (`winget install OpenJS.NodeJS.LTS`, manifest 24.19.0) | same | works | registry.npmjs.org/skills/latest |

README has **no Windows section**; junction/copy behaviour is code-sourced.

### 1.3 ccusage — npm 20.0.20 (2026-08-15), no `engines`; 18.6k★ (2026-09-17)

| Piece | Linux | PS 5.1 | pwsh 7 | Status | Source |
|---|---|---|---|---|---|
| Run | `npx ccusage@latest` / `bunx ccusage` | same | same | works (Node) | apps/ccusage/README.md |
| Statusline JSON | `{"statusLine":{"type":"command","command":"bun x ccusage statusline","padding":0}}` (recommended) or `"npx -y ccusage statusline"` or `"BUN_BE_BUN=1 claude x ccusage statusline"` (native Claude only) | `npx -y ccusage statusline` (runs under Git Bash or PowerShell — `npx` resolves in both shells in shell-form) ; the `BUN_BE_BUN=1 ...` env-prefix form is bash syntax → needs Git Bash | same | **works** with the npx/bun-x form; docs have **no Windows notes** | https://ccusage.com/guide/statusline |
| Update | re-run `npx ccusage@latest` (always latest) | same | same | works | README |

### 1.4 claude-hud (jarrodwatts/claude-hud) — 28.1k★ (2026-09-17)

| Piece | Linux | PS 5.1 | pwsh 7 | Status | Source |
|---|---|---|---|---|---|
| Install | README (in-session): `/plugin marketplace add jarrodwatts/claude-hud` → `/plugin install claude-hud` → `/reload-plugins` → `/claude-hud:setup`; README also gives the CLI line `claude plugin install claude-hud@claude-hud` (the CLI form `claude plugin marketplace add jarrodwatts/claude-hud` is NOT in the README — composed from Claude's generic plugin CLI syntax) | same; if setup says no JS runtime: `winget install OpenJS.NodeJS.LTS`, restart shell, re-run `/claude-hud:setup` | same | **works** (README: "Windows: Node.js 18+"; macOS/Linux: Node 18+ or Bun) | README Install + Requirements |
| Update | `claude plugin update claude-hud@claude-hud` (generic Claude plugin update; not in README) | same | same | works | code.claude.com plugins |

### 1.5 agent-notifications (777genius/agent-notifications) — 812★ (2026-09-17); GPL-3.0

| Piece | Linux | PS 5.1 | pwsh 7 | Status | Source |
|---|---|---|---|---|---|
| Install / update (same cmd) | `(set -o pipefail; curl -fsSL https://raw.githubusercontent.com/777genius/agent-notifications/a512deb5819c3f8c7c3be8335f713cc8bb734fc3/bin/setup.sh \| bash)`; non-interactive: append `-s -- --product claude` / `codex` / `both` after `bash` | **n/a from PowerShell** — README: "On Windows, use **Git Bash** with native Windows Python or Node"; INSTALLATION.md: "open Git Bash from the Start menu and run this command there. Do not run the `curl ... \| bash` command from PowerShell or Windows Terminal if `bash` opens WSL" | n/a | **needs Git Bash (installer only)**; runtime: "notifications work in PowerShell, CMD, Git Bash, or WSL", native Toast, click-to-focus raises the terminal window | README; docs/INSTALLATION.md; docs/PLATFORMS.md |
| Codex | choose Codex/both; then restart Codex, `/hooks`, trust | same via Git Bash | same | works (hooks land in `%USERPROFILE%\.codex\hooks.json`) | README; docs/INSTALLATION.md |
| Alternative, PowerShell-only (no Git Bash) | n/a | `Invoke-WebRequest -Uri "https://raw.githubusercontent.com/soulee-dev/claude-code-notify-powershell/main/claude-hook-toast.ps1" -OutFile "$env:USERPROFILE\.claude\claude-hook-toast.ps1"` + hooks JSON `"command": "cmd /c chcp 65001 >nul && powershell -ExecutionPolicy Bypass -File %USERPROFILE%\\.claude\\claude-hook-toast.ps1"` on `Notification` and `Stop` | same (on patched PS5.1 add `-UseBasicParsing` to avoid the CVE-2025-54100 prompt — my addition, not in that README) | works (93★, Claude-only, toast only) | github.com/soulee-dev/claude-code-notify-powershell |

### 1.6 rtk (rtk-ai/rtk) — v0.49.0 (2026-09-11); 80.8k★ (2026-09-17)

| Piece | Linux | PS 5.1 | pwsh 7 | Status | Source |
|---|---|---|---|---|---|
| Install | `curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh \| sh` (→ `~/.local/bin`) or `brew install rtk` or `cargo install --git https://github.com/rtk-ai/rtk` | `winget install rtk-ai.rtk` ("Easiest way to install on Windows — one command, no PATH setup needed") — documented in README on the **develop** branch; master README only documents the zip (`rtk-x86_64-pc-windows-msvc.zip` → put `rtk.exe` on PATH). winget-pkgs manifest exists (`manifests/r/rtk-ai/rtk`; verifier listed dirs `0.36.0 … 0.46.0, v0.47.0, v0.48.0` — highest **v0.48.0**, `PackageVersion: v0.48.0`, installer URL `https://github.com/rtk-ai/rtk/releases/download/v0.48.0/rtk-x86_64-pc-windows-msvc.zip`; no `v0.49.0` dir yet on 2026-09-17) | same | **works natively** — "Since v0.37.2 the auto-rewrite hook runs as a native binary command (`rtk hook claude`) — no Unix shell, bash, or jq required" | README (master + develop); winget-pkgs |
| Init Claude | `rtk init -g` (or `--auto-patch`, `--hook-only`) | `rtk init -g` | same | works (re-run migrates legacy `rtk-rewrite.sh`) | README Windows |
| Init Codex | `rtk init -g --codex` (AGENTS.md + RTK.md instructions, no hook) | same | same | works | README Supported AI Tools |
| Prereq | ripgrep | `winget install BurntSushi.ripgrep.MSVC` | same | works | README Windows |
| Update | re-run installer / `brew upgrade rtk` / `cargo install --git ... --force` (no `self-update` documented) | `winget upgrade rtk-ai.rtk` (generic winget; not in README) | same | works | winget |

### 1.7 headroom (headroomlabs-ai/headroom) — 72.5k★ (2026-09-17); Python ≥3.10

| Piece | Linux | PS 5.1 | pwsh 7 | Status | Source |
|---|---|---|---|---|---|
| Install | `uv tool install --python 3.13 "headroom-ai[all]"` (or `pip install "headroom-ai[all]"`, `pipx install --python python3.13 "headroom-ai[all]"`); `uv tool update-shell` if `~/.local/bin` not on PATH | `uv tool install --python 3.13 "headroom-ai[all]"` (docs.headroomlabs.ai: "Release wheels are built for CPython 3.10 through 3.13 on Linux (manylinux_2_28 x86_64 / aarch64), macOS (Apple Silicon and Intel), and Windows x86_64." **Verifier confirmed on PyPI**: headroom-ai 0.37.0 (2026-08-27) ships `headroom_ai-0.37.0-cp310-abi3-win_amd64.whl` plus manylinux x86_64/aarch64, macOS arm64/x86_64 wheels and an sdist; if pip falls back to sdist you need MSVC Build Tools "Desktop development with C++" + rustup `stable-x86_64-pc-windows-msvc`, then a fresh PowerShell) | same | **works (native wheel for win x86_64)**; note README sentence "Native wheels currently cover macOS Apple Silicon and Linux" refers to the `[ml]/[vector]` extras context — treat Windows as best-effort, ARM64 Windows unsupported | README; https://docs.headroomlabs.ai/docs/installation |
| Wire agents | `headroom wrap claude` / `headroom deploy` / `headroom proxy --port 8787`; Codex MCP: `[mcp_servers.headroom] command = "/abs/path/headroom" args = ["mcp","serve"]` (absolute path because MCP clients don't inherit PATH) | same (absolute `C:\Users\<you>\.local\bin\headroom.exe`) | same | works | README |
| Update | `headroom update` ("detects pip / pipx / uv tool and upgrades in place ... on macOS, Linux and Windows") | same | same | works | README Updating |

### 1.8 uv (astral) — 0.12.15 (docs + winget manifest, 2026-09-17)

| Piece | Linux | PS 5.1 | pwsh 7 | Status | Source |
|---|---|---|---|---|---|
| Install | `curl -LsSf https://astral.sh/uv/install.sh \| sh` (pinned: `curl -LsSf https://astral.sh/uv/0.12.15/install.sh \| sh`) | `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 \| iex"` (pinned: `.../uv/0.12.15/install.ps1`) — **confirmed on docs.astral.sh**; script itself checks `$PSVersionTable.PSVersion.Major -lt 5` | same, or `winget install --id=astral-sh.uv -e`, or `scoop install main/uv` | **works** (uses `irm`, not `iwr` → no CVE prompt) | https://docs.astral.sh/uv/getting-started/installation/ |
| Update | `uv self update` | `uv self update` (or `winget upgrade astral-sh.uv`) | same | works | same |

### 1.9 Generic tooling via winget (IDs verified against microsoft/winget-pkgs on 2026-09-17)

| Tool | Linux (apt) | Windows (PS5.1 & pwsh identical) | Manifest version seen | Status |
|---|---|---|---|---|
| gum | `sudo apt install gum` (Charm repo) | `winget install charmbracelet.gum` | 2.0.0 | works |
| jq | `sudo apt install jq` | `winget install jqlang.jq` | 1.8.2 | works |
| fzf | `sudo apt install fzf` | `winget install junegunn.fzf` | 0.74.4 | works |
| git | `sudo apt install git` | `winget install Git.Git` | 2.55.0.3 | works (provides Git Bash) |
| node LTS | nodesource / nvm | `winget install OpenJS.NodeJS.LTS` | 24.19.0 | works |
| PowerShell 7 | n/a | `winget install Microsoft.PowerShell` | 7.6.6.0 | works |
| ripgrep | `sudo apt install ripgrep` | `winget install BurntSushi.ripgrep.MSVC` | 15.2.0 | works |
| Go | `sudo apt install golang-go` | `winget install GoLang.Go` | 1.27.0 | works |
| rustup | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` | `winget install Rustlang.Rustup` | 1.29.1 | works |
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` | `irm https://claude.ai/install.ps1 \| iex` / `winget install Anthropic.ClaudeCode` / CMD: `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` | winget 2.1.268 | see §2 |
| Codex CLI | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` / `npm install -g @openai/codex` / `brew install --cask codex` | `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 \| iex"` (docs: update = re-run the same installer; npm `npm install -g @openai/codex`; brew `brew upgrade --cask codex`; the docs do not document `codex update`, though your local 0.154.0 binary has that subcommand) / `winget install OpenAI.Codex` (winget is NOT listed in the official CLI docs) | winget 0.152.0 (0.154.0 dir absent 2026-09-17) | works |

(apt lines are the obvious distro commands for parity only; Linux install is covered by other researchers.)

### 1.10 LSP binaries (anthropics/claude-plugins-official/plugins/*-lsp READMEs)

| Plugin | Linux/macOS command (README verbatim) | Windows command (same README) | Status on native Windows | Source |
|---|---|---|---|---|
| typescript-lsp (`typescript-language-server --stdio`) | `npm install -g typescript-language-server typescript` (or `yarn global add ...`) | same (README has no Windows section) | **broken**: npm creates `typescript-language-server.cmd`; Claude spawns bare name → `ENOENT ... uv_spawn` (#59925 at 2.1.143; #51191; #17136). Workarounds in issues: edit `~/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json` `"command": "typescript-language-server.cmd"` (lost on marketplace update), or WSL. **Mark Linux/WSL-only.** | plugins/typescript-lsp/README.md; issues |
| pyright-lsp (`pyright-langserver --stdio`) | `npm install -g pyright` / `pip install pyright` / `pipx install pyright` | `pip install pyright` (creates a real `pyright-langserver.exe`; documented working on 2.1.71 in dev.to guide, and #59925 reports pyright working while TS fails) | **works only via pip/pipx path**; npm path broken (#16751, #46702) | plugins/pyright-lsp/README.md; issues |
| gopls-lsp (`gopls`) | `go install golang.org/x/tools/gopls@latest` (needs `$GOPATH/bin` on PATH) | same after `winget install GoLang.Go`; produces `gopls.exe` | **works** (real .exe; no Windows issue found) | plugins/gopls-lsp/README.md |
| rust-analyzer-lsp (`rust-analyzer`) | `rustup component add rust-analyzer` (or `brew install rust-analyzer`, `sudo apt install rust-analyzer`, `sudo pacman -S rust-analyzer`) | `rustup component add rust-analyzer` after `winget install Rustlang.Rustup`; real .exe | **works** (untested, no issue found) | plugins/rust-analyzer-lsp/README.md |

Note: the plugin repo's `.claude-plugin/marketplace.json` defines `lspServers` inline with bare commands (`typescript-language-server`, `pyright-langserver`, `gopls`, `rust-analyzer`); the plugin cache dirs contain only README/LICENSE.

### 1.11 MCP servers

| Server | Linux (verbatim) | Windows PS5.1 | Windows pwsh 7 | Status | Source |
|---|---|---|---|---|---|
| Playwright, Claude user scope | `claude mcp add playwright npx @playwright/mcp@latest` (Playwright README) — with scope: `claude mcp add --scope user playwright -- npx -y @playwright/mcp@latest` (composed from Claude docs syntax `claude mcp add [options] <name> -- <command> [args...]`) | same command; Claude now auto-wraps `npx` in `cmd.exe /d /s /c` (#91526, Sep 2026) so no manual `cmd /c`; **do not** write `cmd /c` yourself — `claude mcp add ... cmd /c npx` mangles `/c` → `C:/` (#20061, #46360). Args with `^ & \| < > %` break. | same | **works (unverified on VM)**; robust fallback = `"command":"node","args":["<abs>/node_modules/@playwright/mcp/cli.js"]` after `npm add -D @playwright/mcp` (#46360) | mcp docs; issues |
| Playwright, official plugin (`playwright@claude-plugins-official`) | `.mcp.json`: `{"playwright":{"command":"npx","args":["@playwright/mcp@latest"]}}` | bare-`npx` plugin servers reported `spawn npx ENOENT` at 2.1.139 (#58510, closed not-planned) | same | **unverified / previously broken** → prefer user-scope `claude mcp add` on Windows | local cache `.mcp.json`; #58510 |
| Playwright, Codex | `codex mcp add playwright npx "@playwright/mcp@latest"` (Playwright README) / `codex mcp add <name> -- <cmd>` (Codex docs) | same — Codex resolves `npx.cmd` via PATHEXT | same | **works** | Playwright README; program_resolver.rs |
| context7 | plugin uses **remote HTTP**: `.mcp.json` = `{"type":"http","url":"https://mcp.context7.com/mcp?client=claude-code-plugin","headers":{"Authorization":"${CONTEXT7_API_KEY:-}"}}` (verified in repo and local cache; header is `Authorization`, empty when `CONTEXT7_API_KEY` unset); Codex: `codex mcp add context7 -- npx -y @upstash/context7-mcp` (Codex docs) | HTTP transport → no process spawn | same | **works** everywhere; prefer HTTP on Windows (`claude mcp add --transport http context7 --scope user https://mcp.context7.com/mcp`, composed) | plugin `.mcp.json`; Codex mcp.md |

---

## 2. The two VM tests that were requested (NOT RUN — no Windows host)

### 2.1 `irm https://claude.ai/install.ps1 | iex` on patched PS 5.1 — does it show "Script Execution Risk"?
* Fetched `https://claude.ai/install.ps1` (302 → `https://downloads.claude.ai/claude-code-releases/bootstrap.ps1`, ~96 lines on 2026-09-17 re-fetch). It sets `$ProgressPreference = 'SilentlyContinue'`, uses `Invoke-RestMethod` for `manifest.json`, then **`Invoke-WebRequest -Uri "$DOWNLOAD_BASE_URL/$version/$platform/claude.exe"` (OutFile download) with NO `-UseBasicParsing`** — re-confirmed by the verifier. (`install.cmd` 302 → `bootstrap.cmd`, ~400 lines, `curl -fsSL` + `certutil -hashfile`, no PowerShell.)
* Microsoft (Invoke-WebRequest 5.1 reference, updated 2026-05-05): after the 2025-12-09 update the cmdlet shows the "Security Warning: Script Execution Risk" confirmation; "There is no way to bypass this prompt without using the UseBasicParsing parameter". KB5074596: non-interactive scripts "could cause the script to hang".
* Therefore: **expected = prompt appears (interactive) / hang (non-interactive) under Windows PowerShell 5.1**; not under pwsh 7. Claude Code issue #51733 (2026-04-21, closed) reports the PS5.1 installer failing on patched Windows and explicitly attributes it to the missing `-UseBasicParsing`; the "Installation complete!" false-success was fixed in 2.1.153 but the fetched script still lacks the switch.
* Codex's `install.ps1` (`https://chatgpt.com/codex/install.ps1` 302 → `https://releases.openai.com/codex/install.ps1`) uses `-UseBasicParsing` on all four `Invoke-WebRequest` calls (one `Invoke-RestMethod` without, which is not affected); uv's uses `irm`. Both are prompt-free.
* Caveat on #51733 (verifier): the issue's quoted error is `Failed to fetch version ... unable to get local issuer certificate` and the reporter *attributes* it to the new `-UseBasicParsing` prompting; it is not a clean reproduction of the "Security Warning" prompt. Treat the PS5.1 prompt/hang as *expected from Microsoft's docs*, not as *observed in Claude's installer*.
* **Recommended installer strategy on Windows**: (a) run Claude bootstrap in **pwsh 7** when available; (b) otherwise use **`winget install Anthropic.ClaudeCode`** (manifest 2.1.268; no auto-update — `winget upgrade Anthropic.ClaudeCode` or set `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1`) or the **CMD installer** (`install.cmd` uses `curl.exe` + `certutil`, no IWR); (c) if you must use PS5.1 `install.ps1`, pre-download and patch: `(irm https://claude.ai/install.ps1) -replace 'Invoke-WebRequest -Uri','Invoke-WebRequest -UseBasicParsing -Uri' | iex` (my construction, untested).
* `claude update` afterwards works for native installs (`Successfully updated from ...`).

### 2.2 `claude mcp add -s user playwright -- npx -y @playwright/mcp@latest` from PowerShell without manual `cmd /c`
* Evidence for "works now": CHANGELOG 2.1.119 removed the `cmd /c` warning; issue #91526 (2026-09-02, "latest stable") shows Claude launching `cmd.exe /d /s /c "npx ^"...^""` automatically for `"command":"npx"`.
* Evidence for "still fragile": #91526 open (metacharacter mangling); #58510 (2.1.139, plugin-shipped bare npx → `spawn npx ENOENT`, closed not-planned); #46360 (2026-04-10) workaround uses `node <cli.js>`.
* **Verdict: probably works for user-scope config on 2.1.27x; unverified. Installer should verify with `claude mcp list` / `claude mcp get playwright` and fall back to the `node` + absolute `cli.js` form.**

---

## 3. Components to mark "Linux/WSL only" (or degrade) in the Windows picker

| Component | Windows verdict | Why |
|---|---|---|
| `typescript-lsp` plugin | **Linux/WSL only** | `.cmd` shim ENOENT unresolved through 2.1.143+; no changelog fix by 2.1.274 |
| `pyright-lsp` via npm | Linux/WSL only; **Windows only via `pip install pyright`** | same shim bug; pip gives `.exe` |
| caveman plugin SessionStart/UserPromptSubmit hooks | **needs Git Bash** (or use standalone `node` hooks) | plugin.json commands use `sed`/`$(...)` |
| caveman `ls -td` statusline glob | **needs Git Bash**; replace with `.ps1` + resolved path | bash-only syntax |
| caveman for Codex (hooks) | degrade: skill only, manual `$caveman` | caveman docs: Codex hooks disabled on Windows |
| agent-notifications installer | **needs Git Bash** to install; runtime native | README/INSTALLATION.md |
| ccusage `BUN_BE_BUN=1 claude x ...` variant | needs Git Bash; use `npx -y ccusage statusline` | env-prefix syntax |
| Codex bubblewrap/seatbelt sandbox settings | n/a; use `[windows] sandbox = "elevated"|"unelevated"` | Codex Windows doc |
| Claude Code sandboxing | not supported on native Windows; WSL2 only | setup docs table |
| headroom `[vector]` extra / any sdist build | Windows needs MSVC + Rust toolchain; otherwise Docker | docs.headroomlabs.ai |
| Playwright official plugin on native Windows | degrade to user-scope `claude mcp add` (or `node cli.js`) | #58510 |
| `brew`-only paths (rtk `brew install rtk`, Claude `brew install --cask claude-code`) | n/a on Windows → winget IDs | — |

Everything else in the recommended set (caveman CLI native hooks, claude-hud, rtk, uv, headroom core, skills CLI, gum/jq/fzf/git/node, context7 HTTP, Codex hooks with `command_windows`, Codex MCP with npx) has a sourced native-Windows path.

---

## 4. Script design notes derived from the sources

1. **Shell dispatch**: On Windows, emit Claude hooks either as exec-form `"command":"node","args":[...]`/`"command":"powershell.exe","args":["-NoProfile","-ExecutionPolicy","Bypass","-File",...]` (works with or without Git Bash) or shell-form with `"shell":"powershell"`. Never rely on Git Bash for user-level hooks unless the picker confirms Git Bash.
2. **Codex hooks**: emit `command` (POSIX) **and** `command_windows` (cmd.exe syntax, e.g. `py -3 C:\...\hook.py` or `node C:\...\hook.js`). Remind the user to `/hooks` → trust after install.
3. **Statusline**: write `"command": "powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/<u>/.claude/hooks/caveman-statusline.ps1"` (forward slashes) and copy the `.ps1` from the plugin cache on each update run, or point at the standalone-installed `~/.claude/hooks/` copy.
4. **PS5.1 vs pwsh**: use `;` not `&&` in PS5.1 one-liners; prefer `irm` over `iwr`; if `iwr` is unavoidable add `-UseBasicParsing`. Detect `$PSVersionTable.PSVersion.Major`.
5. **MCP**: user scope `claude mcp add --scope user <name> -- npx -y <pkg>` (no `cmd /c`), then verify; `codex mcp add <name> -- npx -y <pkg>` works as-is.
6. **Skills**: `npx skills add ... -g -a claude-code -a codex -y`; add `--copy` on Windows only if the user disables junctions (rare); Node ≥22.20 required for skills 1.6.0.
7. **WSL detection**: caveman's installer aborts when Windows Node runs inside WSL (`WSL_DISTRO_NAME` / `/proc/version`); mirror that check.

---

## 5. Sources (all fetched 2026-09-17)

- https://raw.githubusercontent.com/JuliusBrussee/caveman/main/INSTALL.md
- https://raw.githubusercontent.com/JuliusBrussee/caveman/main/README.md
- https://raw.githubusercontent.com/JuliusBrussee/caveman/main/docs/install-windows.md
- https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.ps1
- https://raw.githubusercontent.com/JuliusBrussee/caveman/main/bin/install.js
- https://raw.githubusercontent.com/JuliusBrussee/caveman/main/src/hooks/README.md
- https://raw.githubusercontent.com/JuliusBrussee/caveman/main/src/hooks/caveman-activate.js
- https://raw.githubusercontent.com/JuliusBrussee/caveman/main/src/hooks/caveman-statusline.ps1
- https://raw.githubusercontent.com/JuliusBrussee/caveman/main/.claude-plugin/plugin.json
- https://raw.githubusercontent.com/JuliusBrussee/caveman/main/packages/cli/README.md
- https://raw.githubusercontent.com/JuliusBrussee/caveman/main/packages/cli/src/index.ts
- https://registry.npmjs.org/@caveman-ai/cli/latest (1.3.4, node>=22.13)
- https://github.com/JuliusBrussee/caveman (106.1k★)
- https://raw.githubusercontent.com/vercel-labs/skills/main/README.md ; /src/installer.ts ; https://registry.npmjs.org/skills/latest (1.6.0, node>=22.20.0) ; https://github.com/vercel-labs/skills (31.8k★)
- https://learn.microsoft.com/en-us/windows/advanced-settings/developer-mode
- https://raw.githubusercontent.com/ryoppippi/ccusage/main/apps/ccusage/README.md ; https://ccusage.com/guide/statusline ; registry.npmjs.org/ccusage (20.0.20) ; github.com/ryoppippi/ccusage (18.6k★)
- https://raw.githubusercontent.com/jarrodwatts/claude-hud/main/README.md ; github.com/jarrodwatts/claude-hud (28.1k★)
- https://raw.githubusercontent.com/777genius/agent-notifications/main/README.md ; /docs/PLATFORMS.md ; /docs/INSTALLATION.md ; github (812★)
- https://github.com/soulee-dev/claude-code-notify-powershell (93★)
- https://raw.githubusercontent.com/rtk-ai/rtk/master/README.md ; /develop/README.md ; /master/INSTALL.md ; https://github.com/rtk-ai/rtk/releases/latest (v0.49.0, 2026-09-11) ; github (80.8k★) ; https://github.com/microsoft/winget-pkgs/tree/master/manifests/r/rtk-ai/rtk
- https://raw.githubusercontent.com/headroomlabs-ai/headroom/main/README.md ; https://docs.headroomlabs.ai/docs/installation ; github (72.5k★)
- https://docs.astral.sh/uv/getting-started/installation/ ; https://astral.sh/uv/install.ps1
- https://github.com/microsoft/winget-pkgs/tree/master/manifests/... (charmbracelet/gum 2.0.0, jqlang/jq 1.8.2, junegunn/fzf 0.74.4, Git/Git 2.55.0.3, OpenJS/NodeJS/LTS 24.19.0, astral-sh/uv 0.12.15, Microsoft/PowerShell 7.6.6.0, BurntSushi/ripgrep/MSVC 15.2.0, GoLang/Go 1.27.0, Rustlang/Rustup 1.29.1, Anthropic/ClaudeCode 2.1.268, OpenAI/Codex 0.152.0)
- https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/{typescript-lsp,pyright-lsp,gopls-lsp,rust-analyzer-lsp}/README.md ; /.claude-plugin/marketplace.json
- https://code.claude.com/docs/en/setup.md ; /hooks.md ; /statusline.md ; /mcp.md ; /plugins-reference.md
- https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md (2.1.274 top; 2.1.119, 2.1.132, 2.1.153 entries)
- https://claude.ai/install.ps1 ; https://claude.ai/install.cmd ; https://chatgpt.com/codex/install.ps1
- https://github.com/anthropics/claude-code/issues/20061 , /46360 , /91526 , /58510 , /59925 , /51191 , /16751 , /17312 , /51733
- https://dev.to/magnuscole/how-to-fix-pyright-lsp-on-claude-code-for-windows-the-complete-guide-3013 (2026-03-09, CC 2.1.71)
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/invoke-webrequest?view=powershell-5.1 ; https://support.microsoft.com/KB/5074596
- https://developers.openai.com/codex/hooks.md ; /codex/windows.md ; /codex/cli.md ; /codex/mcp.md ; /codex/config-reference.md — **all 308-redirect (2026-09-17) to** https://learn.chatgpt.com/docs/hooks.md ; https://learn.chatgpt.com/docs/windows/windows-sandbox.md ; https://learn.chatgpt.com/docs/codex/cli.md ; https://learn.chatgpt.com/docs/extend/mcp.md?surface=cli
- https://pypi.org/project/headroom-ai/#files (0.37.0, 2026-08-27, win_amd64 wheel) — added by verifier
- https://raw.githubusercontent.com/anthropics/claude-code/v2.1.120/CHANGELOG.md ; /v2.1.154/CHANGELOG.md ; /v2.1.133/CHANGELOG.md (tag-pinned fetches used to read the 2.1.119/2.1.120/2.1.132/2.1.153 entries; the `main` CHANGELOG is too large for a single fetch) — added by verifier
- https://downloads.claude.ai/claude-code-releases/bootstrap.ps1 ; /bootstrap.cmd ; https://releases.openai.com/codex/install.ps1 (redirect targets) — added by verifier
- https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/r/rtk-ai/rtk/v0.48.0/rtk-ai.rtk.installer.yaml ; /a/Anthropic/ClaudeCode/2.1.268/Anthropic.ClaudeCode.installer.yaml ; /g/GoLang/Go/1.27.0/GoLang.Go.installer.yaml ; /m/Microsoft/PowerShell/7.6.6.0/Microsoft.PowerShell.installer.yaml — added by verifier
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/hooks/src/engine/command_runner.rs ; /engine/discovery.rs ; /codex-rs/rmcp-client/src/program_resolver.rs
- https://raw.githubusercontent.com/microsoft/playwright-mcp/main/README.md ; registry.npmjs.org/@playwright/mcp (0.0.81)

---

## Verification (skeptical re-check, 2026-09-17)

Method: every item/fact re-fetched from its primary source with WebFetch (the local shell was unavailable in the verification session, and the GitHub REST API returned 403/rate-limited for every `api.github.com/repos/*` call, so `pushed_at` remains unknown and star counts come from the repo HTML pages). No item was removed: every repo, package, doc page and script URL resolved.

### Confirmed as written (no change)
- Star counts (repo pages, 2026-09-17): caveman 106.1k, skills 31.8k, claude-hud 28.1k, ccusage 18.6k, agent-notifications 812 (GPL-3.0-or-later), rtk 80.8k, headroom 72.5k, claude-code-notify-powershell 93 (3 commits).
- npm: `@caveman-ai/cli` 1.3.4 (2026-09-15T04:12Z, `node>=22.13`, bins `cave`/`caveman`); `skills` 1.6.0 (`node>=22.20.0`, bins `skills`/`add-skill`); `ccusage` 20.0.20 (no `engines`); `@playwright/mcp` 0.0.81 (`node>=18`).
- caveman: INSTALL.md one-liners (`v2.7.0` pinned URLs), `--dry-run`, `--list`, `--with-hooks`/`--no-hooks`, `--only claude`, `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`, "Hooks failing on Windows" → `install.ps1` wires `caveman-statusline.ps1`, `claude plugin update caveman@caveman` (short name `claude plugin update caveman` "fails"), `npx -y github:JuliusBrussee/caveman -- --uninstall`, `npx skills add JuliusBrussee/caveman -a codex -g`; install.ps1 runs `& npx -y "github:JuliusBrussee/caveman#v2.7.0" @InstallerArgs` (Node ≥18 check, ~60 lines, no `Invoke-WebRequest` inside); plugin.json 2.7.0 hooks use `HOOK_ROOT=$(printf %s "${CLAUDE_PLUGIN_ROOT}" | sed ...)`; bin/install.js `psHost = pwsh|powershell` + `-NoProfile -ExecutionPolicy Bypass -File <hooksDir>/caveman-statusline.ps1`, "plugin manifest handles hooks" skip, `checkWslWindowsNode` die message; caveman-activate.js win32 nudge `powershell -ExecutionPolicy Bypass -File "<path>"` with `caveman-statusline.ps1` (at lines ~371-374, not 405-421 — cosmetic); `.ps1` exists in repo (~70 lines) and in the local cache; docs/install-windows.md `git config --global core.symlinks true`, `npx skills add JuliusBrussee/caveman --copy`, "Codex hooks are currently disabled on Windows, so use `$caveman`"; packages/cli README: `--agent-native` supports `claude` and `codex`, `caveman setup --install`.
- skills CLI: `symlinkType = platform() === 'win32' ? 'junction' : undefined` with absolute target and copy fallback `symlinkFailed: true` (installer.ts ~318-325, 441-448); README flags `-g`, `-a`, `-y`, `--copy`; `npx skills update -y` / `-g`; no Windows section.
- ccusage statusline docs: `bun x ccusage statusline` (recommended), `npx -y ccusage statusline`, `BUN_BE_BUN=1 claude x ccusage statusline` ("requires the native version of Claude Code"), effort display needs 2.1.119+, no Windows notes.
- claude-hud README: slash-command install flow, `claude plugin install claude-hud@claude-hud`, `winget install OpenJS.NodeJS.LTS`, Requirements "Windows: Node.js 18+", Claude Code v1.0.80+, no update command in README.
- agent-notifications: exact `(set -o pipefail; curl -fsSL https://raw.githubusercontent.com/777genius/agent-notifications/a512deb5819c3f8c7c3be8335f713cc8bb734fc3/bin/setup.sh | bash)`, `-s -- --product claude|codex|both`, INSTALLATION.md Git Bash-only wording, PLATFORMS.md "notifications work in PowerShell, CMD, Git Bash, or WSL", native Toast, click-to-focus.
- soulee-dev: `Invoke-WebRequest -Uri ".../claude-hook-toast.ps1" -OutFile "$env:USERPROFILE\.claude\claude-hook-toast.ps1"` and hook `cmd /c chcp 65001 >nul && powershell -ExecutionPolicy Bypass -File %USERPROFILE%\.claude\claude-hook-toast.ps1`.
- rtk: develop README has `winget install rtk-ai.rtk`, `winget install BurntSushi.ripgrep.MSVC`, "Since **v0.37.2** ... (`rtk hook claude`)", `rtk init -g --codex`, `--auto-patch`, `--hook-only`; master README has the zip route, `brew install rtk`, `cargo install --git https://github.com/rtk-ai/rtk`, the curl one-liner; INSTALL.md has the crates.io "Rust Type Kit" collision warning and `rtk gain` check; release v0.49.0 dated 11 Sep 2026 (asset list failed to render). `winget upgrade` is not in any rtk doc (generic winget).
- uv docs: all five commands verbatim incl. `winget install --id=astral-sh.uv -e`, `scoop install main/uv`, `uv self update`, pinned 0.12.15 URLs.
- LSP READMEs: all four sets of commands verbatim; plugin dirs contain only LICENSE + README (no per-plugin plugin.json, 404); `external_plugins/playwright/.mcp.json` = `{"playwright":{"command":"npx","args":["@playwright/mcp@latest"]}}`.
- Playwright README: `claude mcp add playwright npx @playwright/mcp@latest`, `codex mcp add playwright npx "@playwright/mcp@latest"`, Node 18+, `%USERPROFILE%\AppData\Local\ms-playwright\mcp-{channel}-{workspace-hash}`, playwright-cli skills alternative.
- Claude docs: hooks `shell` field text, `sh -c` / Git Bash / PowerShell sentence, exec-form `.cmd`/`.bat` paragraph with `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/node_modules/eslint/bin/eslint.js"]` example; setup page (Git for Windows optional, `CLAUDE_CODE_GIT_BASH_PATH`, sandboxing "Not supported" on native Windows, `winget install Anthropic.ClaudeCode`, `winget upgrade Anthropic.ClaudeCode`, `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1`, `claude update`, `brew install --cask claude-code`, CMD line `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`); mcp page (`claude mcp add --transport http hubspot --scope user https://mcp.hubspot.com/anthropic`, `claude mcp list`, `claude mcp get`, no Windows `cmd /c` note). The hooks page does NOT mention pwsh.exe→powershell.exe auto-detection nor `${env:...}` rewriting in the fetched text — those two sub-claims are unsourced and downgraded (see below).
- Microsoft: Invoke-WebRequest 5.1 page (updated 2026-05-05) and KB5074596 quotes verbatim; KB names only `Invoke-WebRequest`, confirms PowerShell 7 "already uses secure parsing by default"; Developer Mode `reg add` line verbatim.
- Codex: `command_runner.rs` `("COMSPEC", "cmd.exe", "/C")` (unix `("SHELL", "/bin/sh", "-lc")`); `discovery.rs` `command_windows.unwrap_or(command)` under `cfg!(windows)`; `program_resolver.rs` `which` crate + PATHEXT comment naming `npx`, `pnpm`, `yarn`; windows doc `[windows] sandbox = "elevated"`/`"unelevated"`, winget sentence, `allowed_sandbox_implementations = ["elevated"]`; cli doc install lines; mcp doc `codex mcp add context7 -- npx -y @upstash/context7-mcp`.
- Issues: #91526 (open, 2026-09-02, `cmd.exe /d /s /c "npx ^"...^""`, metachar list, node+abs path workaround); #58510 (closed not-planned, 2026-05-12, 2.1.139, `spawn npx ENOENT`, lists playwright/context7 etc., claims LSP fix in 2.1.132 via #17312); #59925 (closed as duplicate, 2026-05-17, v2.1.143, `uv_spawn 'typescript-language-server'`, pyright OK, `.cmd` workaround); #46360 (closed not-planned, 2026-04-10, `/c`→`C:/`, node+cli.js); #17312 (closed, 2026-01-10, no fix-version comment visible). dev.to guide 2026-03-09, CC 2.1.71, `pip install pyright`.
- winget-pkgs (manifest dirs verified 2026-09-17): charmbracelet.gum 2.0.0; jqlang.jq 1.8.2; junegunn.fzf 0.74.4; Git.Git 2.55.0.3; OpenJS.NodeJS.LTS 24.19.0; Microsoft.PowerShell 7.6.6.0 (dir + installer.yaml); BurntSushi.ripgrep.MSVC 15.2.0; GoLang.Go 1.27.0 (dir + installer.yaml); Rustlang.Rustup 1.29.1; astral-sh.uv 0.12.15; Anthropic.ClaudeCode 2.1.268 (installer.yaml: portable, `downloads.claude.ai/claude-code-releases/2.1.268/win32-x64/claude.exe`; `2.1.273` dir 404); OpenAI.Codex 0.152.0 (`0.154.0` 404).

### Corrections made to the body
1. **rtk winget version**: listing actually contains `v0.47.0` and `v0.48.0` (with `v` prefix); highest manifest is **v0.48.0**, not "≥0.46.0". `v0.49.0` not yet packaged. Open question closed.
2. **Codex docs URLs**: every `developers.openai.com/codex/*.md` page now returns **308** to `learn.chatgpt.com/docs/...`; sources list updated. Content unchanged.
3. **Codex hooks feature flag**: docs say `[features] hooks = true` in `config.toml` enables hooks (added to §0). Local inventory lists `hooks` as stable, so this may be a no-op on 0.154.0 — unverified.
4. **Claude `install.ps1`**: 302 → `downloads.claude.ai/claude-code-releases/bootstrap.ps1`; ~96 lines (not 110); still no `-UseBasicParsing`; also sets `$ProgressPreference='SilentlyContinue'`. `install.cmd` → `bootstrap.cmd` (~400 lines). Codex → `releases.openai.com/codex/install.ps1` with `-UseBasicParsing` on all 4 IWR calls.
5. **#51733 nuance**: the reported error is a TLS "unable to get local issuer certificate", attributed by the reporter to the `-UseBasicParsing` prompting; not a clean prompt reproduction. Confidence kept medium; wording softened in §2.1.
6. **Git for Windows optional since 2.1.120** (was "2.1.1xx"); verified in the tag-pinned CHANGELOG. 2.1.119 also "Fixed MCP servers from plugins not spawning on Windows when the plugin cache was incomplete".
7. **context7 `.mcp.json`**: URL is `https://mcp.context7.com/mcp?client=claude-code-plugin` and the header is `Authorization: ${CONTEXT7_API_KEY:-}` (not a `CONTEXT7_API_KEY` header).
8. **claude-hud CLI**: README contains `claude plugin install claude-hud@claude-hud` but NOT `claude plugin marketplace add jarrodwatts/claude-hud` (only the `/plugin marketplace add` slash form); the CLI marketplace line is composed.
9. **headroom Windows wheels**: confirmed on PyPI (0.37.0, 2026-08-27, `cp310-abi3-win_amd64`). The README "Native wheels currently cover macOS Apple Silicon and Linux" sentence is stale relative to PyPI. Open question closed; item confidence raised to high with the PyPI source.
10. **caveman CLI "PowerShell form only for claude"**: could not be re-confirmed (index.ts fetches truncated inconsistently; one showed `hookShell = win32 ? "powershell" : "bash"` and `& '<exe>' ...`, another a `powershell -NoProfile -Command "& { ... }"` wrapper). Downgraded to medium. New detail found: index.ts comment "An npm-installed caveman-mcp on Windows is a `.cmd` shim".
11. **Claude hooks docs sub-claims** "auto-detects pwsh.exe, falls back to powershell.exe" and "`${CLAUDE_PROJECT_DIR}` rewritten to `${env:NAME}` (v2.1.198+)" were not present in the fetched hooks page text → downgraded to low/unsourced; do not rely on them.
12. **Codex CLI update path**: official docs say re-run the installer / `npm install -g @openai/codex` / `brew upgrade --cask codex`; `codex update` and `winget install OpenAI.Codex` are not in the docs (winget manifest exists; `codex update` exists in the local binary per inventory).
13. **`claude mcp add --scope user playwright -- npx -y @playwright/mcp@latest`** and **`claude mcp add --transport http context7 --scope user https://mcp.context7.com/mcp`** remain *composed* from documented syntax, not copied; flagged as such.

### Still open after verification
- Both Windows VM tests (PS5.1 prompt; `claude mcp add ... npx`) remain unexecuted.
- `pushed_at`/last-commit dates for all GitHub repos (API 403).
- Whether `[features] hooks = true` is still required on Codex 0.154.0.
- Whether the LSP `.cmd` spawn bug is fixed after 2.1.143 (no CHANGELOG line found in the 2.1.120–2.1.154 or 2.1.260–2.1.274 windows that were readable; the middle of the CHANGELOG was not scanned line-by-line).
