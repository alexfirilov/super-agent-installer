# Local inventory audit — staleness, gaps, replacements (as of 2026-09-17)

Scope: everything currently installed on this Ubuntu 26.04 host for Claude Code + Codex CLI, compared with upstream (npm registry, raw GitHub manifests, GitHub release pages, official docs). Read-only; nothing was installed or changed. GitHub REST API was rate-limited from this IP and `gh` has an invalid keyring token, so stars/dates come from GitHub HTML pages (`aria-label="N users starred this repository"`, fetched 2026-09-17), `releases/latest` redirects, raw.githubusercontent.com manifests, npm registry JSON and local files.

## 0. Headline findings

| # | Finding | Severity |
|---|---------|----------|
| 1 | **Three LSP plugins (typescript-lsp, pyright-lsp, gopls-lsp) are installed but none of their binaries exist** (`typescript-language-server`, `pyright-langserver`, `gopls` all missing; Go toolchain absent). They currently do nothing except show "Executable not found in $PATH" in `/plugin` Errors. The plugin never installs the binary (docs). | fix or remove |
| 2 | **caveman plugin is one release behind**: installed commit `15581d1` = v2.6.0 (2026-09-07); upstream v2.7.0 tagged 2026-09-15. **@caveman-ai/cli 1.3.3 → 1.3.4** (npm 2026-09-15). Third-party marketplaces do not auto-update by default, so `caveman@caveman` will silently stay stale. | update |
| 3 | **remember plugin stale**: installed 0.32.0 (sha 9f92bc6); official marketplace now pins sha `a5cc87c` = **0.33.0**. | update |
| 4 | `autoUpdates: false` in `~/.claude.json` is **not a documented setting and is not honored on native installs** (issue #60956, closed "not planned"). Auto-updates are in fact ON. Documented switch is `env.DISABLE_AUTOUPDATER="1"` in settings.json (+ `FORCE_AUTOUPDATE_PLUGINS=1` to keep plugin auto-update). | config hygiene |
| 5 | The 10-event `caveman-proxy native-hook` block matches exactly what @caveman-ai/cli 1.3.4 still generates for `claude` (verified in the 1.3.4 tarball: `["SessionStart","UserPromptSubmit","PreToolUse","PostToolUse","PostToolUseFailure","PreCompact","SubagentStart","SubagentStop","Stop","SessionEnd"]`). It is current. But it hard-codes `/usr/local/lib/node_modules/@caveman-ai/cli/dist/native-hook-fast.js` (root-owned sudo npm global) — host-specific; regenerate per host with `caveman setup --agent-native claude`. | portable? no |
| 6 | statusLine `bash "$(ls -td "$HOME/.claude/plugins/cache/caveman/caveman/"*/ ...)src/hooks/caveman-statusline.sh"` is a hand-rolled workaround. The plugin's own SessionStart nudge emits a *hard* path into `~/.claude/plugins/cache/caveman/caveman/<hash>/src/hooks/caveman-statusline.sh` (breaks on every plugin update); the standalone installer instead copies the script to `~/.claude/hooks/caveman-statusline.sh` and points at that. Glob works on Linux/macOS only; Windows needs `caveman-statusline.ps1` via pwsh. | fragile |
| 7 | **Codex is far less of a gap than assumed**: Codex reads `$HOME/.agents/skills` natively (docs), so all 20 caveman-family skills already installed there ARE visible to Codex; and `codex plugin list` reports **`superpowers@openai-curated-remote 6.3.0 installed, enabled`** (account-level remote plugin; not in the local cache dir). Real gaps: **0 MCP servers** (`codex mcp list` → "No MCP servers configured yet"), no context7/playwright/caveman-mcp, no caveman native hooks for Codex. | gap |
| 8 | `~/.codex/config.toml` currently says `model = "gpt-5.6-sol"`, `model_reasoning_effort = "low"` (file mtime 2026-09-16 21:02) — not `gpt-6-astra/xhigh` as the inventory claims. Verify before baking into the installer. | verify |
| 9 | Toolchain from Ubuntu apt is old: **gh 2.46.0 (apt) vs v2.101.0 upstream**, **npm 9.2.0 (separate Debian `npm` deb) vs 10.9.8 bundled with Node 22.23.2 / 11.19.1 on Node 24/26**. Node 22.22.1 is Maintenance LTS (ends 2027-04-30); Node 24 is Active LTS (24.21.0), Node 26 becomes LTS 2026-10-28. `gh auth` token is invalid. | update |
| 10 | Personal skills `upskill`, `job-scraper`, `job-application-assistant` are **symlinks into `~/code/ai-job-search/.claude/skills/`** — not registry-installable; they will dangle on any other host. Exclude from the generic installer (or offer a "personal repo skills" hook). | portability |
| 11 | pr-review-toolkit (~2,033 always-on tokens) + plugin-dev (~2,349) + caveman (~1,812) + superpowers (~688) are the context-cost hogs; total always-on across all 20 plugins ≈ 7.9k tokens/session (from `claude plugin details`). | cost |

## 1. Agents

### Claude Code — installed 2.1.273 (native), latest 2.1.273 ✅
- npm dist-tags (2026-09-16): `latest=2.1.273` (published 2026-09-15T18:06Z), `stable=2.1.267`, `next=2.1.274`. Source: https://registry.npmjs.org/@anthropic-ai/claude-code
- `~/.claude.json`: `installMethod: "native"`, `autoUpdates: false`, `lastReleaseNotesSeen: "2.1.272"`.
- **`autoUpdates:false` is not honored on native installs** — GitHub issue #60956 ("autoUpdates: false in ~/.claude.json is not respected on native installation — CLI self-updates on launch", opened 2026-05-20, closed as not planned). The settings reference lists only `autoUpdatesChannel`, `minimumVersion`, `requiredMinimumVersion/MaximumVersion`; setup docs say: disable with `{"env":{"DISABLE_AUTOUPDATER":"1"}}` in settings.json, verify with `claude doctor` → `Auto-updates: disabled (set by env: DISABLE_AUTOUPDATER)`. `DISABLE_UPDATES` blocks manual `claude update` too. To keep plugin auto-updates while disabling CLI auto-update: `DISABLE_AUTOUPDATER=1` + `FORCE_AUTOUPDATE_PLUGINS=1`.
  - Why someone sets it: reproducibility across hosts / supply-chain gating / avoid mid-session binary swaps. Risks of actually disabling: miss security fixes; plugin auto-update is also disabled unless FORCE_AUTOUPDATE_PLUGINS=1; version skew between hosts. Recommended installer posture: leave auto-update on, use `autoUpdatesChannel: "stable"` on work hosts/Proxmox nodes, `"latest"` on the home PC; optionally `minimumVersion`.
- Install (docs, verbatim): Linux/macOS/WSL `curl -fsSL https://claude.ai/install.sh | bash` (stable: `| bash -s stable`; pinned: `| bash -s 2.1.89`); Windows PowerShell `irm https://claude.ai/install.ps1 | iex` (stable: `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable`); Windows CMD `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`; also `winget install Anthropic.ClaudeCode`, `brew install --cask claude-code`, signed apt/dnf/apk repos (`https://downloads.claude.ai/claude-code/apt/stable stable main`, key fingerprint `31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE`).
- Update: `claude update`; launcher `~/.local/bin/claude` → `~/.local/share/claude/versions/`. Verify: `claude --version`, `claude doctor`.
- Windows: native needs no Node; Git for Windows optional (enables Bash tool; else PowerShell tool). Sandboxing only under WSL2.
- Built-ins that overlap installed plugins (CHANGELOG): `/code-review` (formerly `/simplify`, later `/simplify` re-added as cleanup-only, `/review` alias), `/security-review`, auto-memory (`/memory`, `autoMemoryDirectory`). Plugin `code-review` (multi-agent PR review) and `code-simplifier` are separate implementations from the built-ins, not deprecated.

### Codex CLI — installed 0.154.0 (standalone installer), latest 0.154.0 ✅
- Binary: `~/.local/bin/codex` → `~/.codex/packages/standalone/releases/0.154.0-x86_64-unknown-linux-musl/bin/codex` (so it was installed with the official `install.sh`, not npm). npm `latest=0.154.0` (published 2026-09-09T22:40Z); `alpha=0.155.0-alpha.14` (was .13 at first pass). GitHub `releases/latest` = `rust-v0.154.0` (2026-09-09T22:35Z). GitHub page shows 124,738 stars (2026-09-17).
- Install (README verbatim): Mac/Linux `curl -fsSL https://chatgpt.com/codex/install.sh | sh`; Windows `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`; alternatives `npm install -g @openai/codex`, `brew install --cask codex`. Installer downloads from `https://releases.openai.com/codex`, falls back to GitHub Releases (`CODEX_INSTALLER_USE_RELEASES_OPENAI_COM=false` forces GH).
- Update: `codex update` (subcommand exists locally: "Update Codex to the latest version"; `codex update --help` verified); docs page says re-run the install.sh. `codex doctor` for diagnostics. Feature flag `in_app_updates` stable.
- docs/install.md system requirements: macOS 12+, Ubuntu 20.04+/Debian 10+, **Windows 11 via WSL2** (native Windows binaries do exist on npm: win32-x64/arm64 dist-tags, and install.ps1 is documented in README).
- Plugin CLI (0.154.0, from `--help`): `codex plugin add <PLUGIN[@MARKETPLACE]>` (**there is no `codex plugin install`** — `error: unrecognized subcommand 'install'`), `codex plugin list`, `codex plugin marketplace add <owner/repo[@ref] | path | git URL> [--ref] [--sparse]`, `codex plugin marketplace upgrade`, `codex plugin remove`. MCP CLI: `codex mcp add <NAME> (--url <URL> | -- <COMMAND>...)` with `--env`, `--bearer-token-env-var`, OAuth flags; `codex mcp list/get/remove/login/logout`.
- Skills: Codex reads `.agents/skills` (cwd, parents, repo root), **`$HOME/.agents/skills`**, `/etc/codex/skills`, plus `~/.codex/skills` (skills CLI's Codex global path). Install with `$skill-installer <name>` system skill, or skills CLI. Disable via `[[skills.config]] enabled = false` in config.toml.
- Observed config.toml (2026-09-16 21:02): `model = "gpt-5.6-sol"`, `model_reasoning_effort = "low"`, two trusted projects, `[tui.model_availability_nux] gpt-6-astra = 4`, `[notice] hide_rate_limit_model_nudge = true`. No `[mcp_servers]`, no hooks.
- `codex plugin list` (read-only): marketplace `openai-curated-remote` (3,971 entries); **installed+enabled: superpowers 6.3.0, openai-templates 0.1.1, plugin-management 0.1.0**; local cache holds only the latter two (superpowers appears to be an account-level remote plugin — `remote_plugin`/`plugin_sharing` features are stable).

## 2. Claude plugins (official marketplace `claude-plugins-official`, 305 plugins in marketplace.json; repo 36,430 stars on 2026-09-17)

Marketplace auto-updates by default (official marketplaces do; third-party like `caveman` do not). Official plugins with no `version` field are keyed by marketplace commit (`76c85b7366c8` = marketplace commit at last refresh 2026-09-16T17:03Z). Plugins with a `version` field only bump when the author bumps it.

| Plugin | Installed | Latest upstream | Status | Always-on tokens | Verdict |
|---|---|---|---|---|---|
| caveman@caveman | `15581d1` = **2.6.0** (commit 2026-09-07T08:19Z; package.json 2.6.0, plugin.json had no version field then) | **2.7.0** (tag v2.7.0, 2026-09-15) | stale; 3rd-party marketplace, no auto-update | ~1,812 | must-have (update) |
| superpowers | 6.3.0 (sha b36e082) | 6.3.0 (v6.3.0 released 2026-08-12T16:58Z; upstream main plugin.json 6.3.0) | current; 287,606 stars per GitHub page 2026-09-17 | ~688 | must-have |
| remember | 0.32.0 (sha 9f92bc6; raw plugin.json at that sha says 0.31.0) | **0.33.0** (marketplace pin a5cc87c = 0.33.0; repo 172 stars) | stale | ~73 | recommended (update) — also has Codex support: README says `codex plugin marketplace add Digital-Process-Tools/claude-remember` then `codex plugin install remember`, but Codex 0.154.0 has no `install` subcommand; the marketplace manifest (`.agents/plugins/marketplace.json`) is named `remember-dev`, so the working form is `codex plugin add remember@remember-dev` (constructed from `codex plugin add --help`; verify) |
| security-guidance | 2.0.8 | 2.0.8 (plugin.json; marketplace.json entry still says 2.0.7) | current | ~0 (hooks only) | recommended |
| code-review | `76c85b7366c8` (also a stray *project-scope* duplicate "Version: unknown") | marketplace HEAD | current; overlaps built-in `/code-review` | ~20 | optional (dedupe project-scope copy) |
| code-simplifier | 1.0.0 | 1.0.0 | current; overlaps built-in `/simplify` and pr-review-toolkit's `code-simplifier` agent | ~64 | optional |
| commit-commands | 76c85b7366c8 | HEAD | current | ~103 | recommended |
| context7 | 76c85b7366c8 | HEAD (remote HTTP MCP `https://mcp.context7.com/mcp?client=claude-code-plugin`, header `Authorization: ${CONTEXT7_API_KEY:-}`) | current | ~0 | must-have |
| playwright | 76c85b7366c8 | HEAD (`npx @playwright/mcp@latest`; npm @playwright/mcp latest 0.0.81) | current | ~0 | recommended |
| feature-dev | 76c85b7366c8 | HEAD | current | ~238 | optional |
| frontend-design | 76c85b7366c8 | HEAD | current | ~78 | optional |
| plugin-dev | 76c85b7366c8 | HEAD | current | **~2,349** | optional (heavy; enable only when writing plugins) |
| pr-review-toolkit | 76c85b7366c8 | HEAD | current | **~2,033** | optional (heavy) |
| skill-creator | 76c85b7366c8 | HEAD | current | ~112 | recommended |
| claude-code-setup | 1.0.0 | 1.0.0 | current | ~139 | optional |
| claude-md-management | 1.0.0 | 1.0.0 | current | ~175 | optional |
| ralph-loop | 1.0.0 | 1.0.0 | current | ~84 | optional |
| typescript-lsp | 1.0.0 | 1.0.0 (config lives inline in marketplace.json `lspServers`; plugin dir has only README+LICENSE) | **binary missing** | 0 | skip unless `npm install -g typescript-language-server typescript` |
| pyright-lsp | 1.0.0 | 1.0.0 | **binary missing** | 0 | skip unless `npm install -g pyright` / `pipx install pyright` |
| gopls-lsp | 1.0.0 | 1.0.0 | **binary missing, no Go toolchain** | 0 | skip (remove) unless `go install golang.org/x/tools/gopls@latest` |

Update commands (Claude Code CLI): `claude plugin marketplace update claude-plugins-official`, `claude plugin marketplace update caveman`, `claude plugin update <plugin>@<marketplace>` (restart required), `claude plugin list`, `claude plugin details <name>` (token cost), `claude plugin prune`.

Leftover: `~/.claude/plugins/marketplaces/claude-plugins-official.bak/` exists (harmless).

## 3. Caveman CLI, hooks, statusline

- **@caveman-ai/cli**: installed 1.3.3 (`binary_release: bin-v1.1.6`, at `/usr/local/lib/node_modules`, root-owned → installed with sudo npm -g). Latest **1.3.4** (npm 2026-09-15T04:12Z, gitHead 4df4b03; ships with caveman v2.7.0; runtime binaries bin-v1.1.7). `~/.caveman/integrations/claude.json`: `pack_version 2.2.0`, installed 2026-09-04 against Claude Code 2.1.243. Needs Node.js 22.13+ (README).
- Update: `npm install -g @caveman-ai/cli` then `caveman setup --install` (README: `npm install -g @caveman-ai/cli && caveman setup --install`), then re-run `caveman setup --agent-native claude` (and `--agent-native codex`).
- **Hooks block is current**: 1.3.4's `nativeHooksDocument()` still emits, for `claude`, exactly the 10 events present in settings.json; for `codex` it emits 12 (adds PermissionRequest, PostCompact). `caveman shrink-hook` on PreToolUse is the opt-in MCP shrink middleware (`--with-mcp-shrink`). README notes Codex skips the shrink hook (openai/codex#18491).
- Portability caveats: the adapter path `/usr/local/lib/node_modules/@caveman-ai/cli/dist/native-hook-fast.js` is derived from `import.meta.url` at setup time → differs on nvm/fnm/Windows hosts. Never copy settings.json hooks verbatim; run `caveman setup --agent-native <agent>` on each host. `caveman enable claude` writes `ANTHROPIC_BASE_URL` (+ `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL`) into settings.json, which **disables Claude Code Remote Control** (docs/technical/agent-wrapping.md). Current `env: {}` → proxy routing is not enabled right now.
- **statusLine**: the `ls -td` glob into `~/.claude/plugins/cache/caveman/caveman/*/` is not any installer's output. The plugin's SessionStart nudge (`src/hooks/caveman-activate.js`) emits a hard-coded `bash "<plugin-cache>/<hash>/src/hooks/caveman-statusline.sh"`; the standalone installer (`bin/install.js`) copies hooks into `$CLAUDE_CONFIG_DIR/hooks/` and writes `bash ~/.claude/hooks/caveman-statusline.sh` (Windows: `pwsh -NoProfile -ExecutionPolicy Bypass -File ...caveman-statusline.ps1`). The glob survives plugin hash changes (better than the nudge) but: depends on `ls -td` ordering (mtime), breaks if two versions coexist with odd mtimes, is bash-only, and silently blanks if the cache is cleared (`rm -rf ~/.claude/plugins/cache` is the documented troubleshooting step). Recommendation for the installer: copy the script to `~/.claude/hooks/caveman-statusline.sh` (what install.sh does) or run the official installer `curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/v2.7.0/install.sh | bash` / `irm https://raw.githubusercontent.com/JuliusBrussee/caveman/v2.7.0/install.ps1 | iex`.

## 4. Skills (skills.sh CLI, `~/.agents/skills`, lock v3)

- **skills CLI**: local 1.5.23, latest **1.5.26** (npm 2026-09-11). Commands: `npx skills add <src> [-g] [-a <agent>...] [--skill '*'] [-y] [--copy]`, `npx skills update [-g|-p] [-y] [skills...]`, `npx skills list`, `npx skills remove`, `npx skills find`. Agent global paths: claude-code → `~/.claude/skills/`, codex → `~/.codex/skills/`, cline/kimi/zed/etc → `~/.agents/skills/`. Skills also discover `.claude-plugin/marketplace.json` skill declarations.
- Installed 2026-09-04 (lock): 20 skills from `JuliusBrussee/caveman` (cavecrew, caveman, caveman-commit, -compress, -discover, -evidence-review, -explore, -help, -learn, -manage, -optimize, -review, -setup, -stats, investigate-first, lean-build, migration, safe-refactor, surgical-patch, verify-and-stop) + `find-skills` from `vercel-labs/skills`. Only `find-skills` is symlinked into `~/.claude/skills/`; the caveman skills reach Claude via the plugin (duplicated definition: plugin + ~/.agents copy) and reach Codex via `$HOME/.agents/skills` (docs).
- Staleness: caveman repo moved 2.6.0 → 2.7.0 since install (release notes: "Caveman skill reinforcement strengthened mid-conversation"). Run `npx skills update -g -y`. find-skills upstream change status unknown (API rate-limited).
- **Not from a registry**: `upskill`, `job-scraper`, `job-application-assistant` are symlinks to `~/code/ai-job-search/.claude/skills/*` (personal project, `framework_version: 1.3.4` in frontmatter). Skip in the generic installer.
- `~/.codex/skills/` contains only `.system/` (review-agent, skill-installer, openai-docs, imagegen, skill-creator, plugin-creator) — expected; user skills live in `~/.agents/skills` which Codex reads.

## 5. Codex gap analysis — Claude-side capability → Codex equivalent

| Claude-side | Codex status now | How to get it on Codex (sourced commands) |
|---|---|---|
| caveman plugin (skills + SessionStart/UserPromptSubmit hooks) | skills present via `~/.agents/skills`; no hooks | `npx skills add JuliusBrussee/caveman -a codex -g` (INSTALL.md) or `npx skills add JuliusBrussee/caveman --skill '*' -a codex --yes -g` (README); native hooks: `caveman setup --agent-native codex`; wrap/proxy: `caveman codex` |
| caveman-mcp (stdio `~/.caveman/bin/caveman-mcp`) | absent | delivered by `caveman codex` wrap ("hands the agent the five MCP tools"); manual: `codex mcp add caveman -- ~/.caveman/bin/caveman-mcp` (constructed from `codex mcp add` usage; verify with `codex mcp list`) |
| superpowers | **installed, enabled 6.3.0** (`superpowers@openai-curated-remote`) | already there; README: `/plugins` → search `superpowers` → Install |
| context7 (HTTP MCP) | absent | `codex mcp add context7 -- npx -y @upstash/context7-mcp --api-key YOUR_API_KEY` or config.toml `[mcp_servers.context7] url = "https://mcp.context7.com/mcp" http_headers = { "Authorization" = "Bearer YOUR_API_KEY" }` (context7.com/docs/resources/all-clients) |
| playwright MCP | absent | `codex mcp add playwright npx "@playwright/mcp@latest"` or `[mcp_servers.playwright] command = "npx" args = ["@playwright/mcp@latest"]` (microsoft/playwright-mcp README) |
| remember | absent | `codex plugin marketplace add Digital-Process-Tools/claude-remember` then `codex plugin add remember@remember-dev` (README says `codex plugin install remember`, which 0.154.0 rejects; marketplace name from `.agents/plugins/marketplace.json`) |
| find-skills / other skills | via `~/.agents/skills` | `npx skills add <src> -g -a codex` writes to `~/.codex/skills/` |
| claude.ai connectors (Gmail, Calendar, Drive, Expedia, Booking) | n/a | Codex curated marketplace has gmail, google-calendar, google-drive, github, slack, notion, linear… (`codex plugin add gmail@openai-curated-remote`) |
| fli MCP (`~/.local/bin/fli-mcp`) | absent | personal; `codex mcp add fli -- ~/.local/bin/fli-mcp` if wanted |
| LSP plugins | no Codex equivalent | n/a |

## 6. Toolchain

| Tool | Installed | Latest | Source | Notes / update |
|---|---|---|---|---|
| Node.js | v22.22.1 (Ubuntu `nodejs` deb) | v22.23.2 (2026-07-28, npm 10.9.8); v24.21.0 Active LTS (2026-09-07, npm 11.19.0); v26.9.0 Current (2026-09-16, LTS from 2026-10-28) | nodejs.org/dist/index.json, nodejs/Release schedule | v22 in Maintenance until 2027-04-30. Neither Claude Code native nor Codex standalone need Node; needed for npx (skills CLI, @playwright/mcp, caveman CLI ≥22.13). Prefer fnm/nvm on non-Debian hosts: `curl -fsSL https://fnm.vercel.app/install | bash` (fnm README) then `fnm install 24`; `brew install fnm` on macOS. |
| npm | 9.2.0 (separate Debian `npm` deb `9.2.0~ds3-1`) | 12.0.2 (requires node ^22.22.2 — **0.0.1 above installed**); npm 11.19.1 (`latest-11`); 10.9.8 bundled w/ Node 22 | registry.npmjs.org/npm | Explains the node22/npm9 mismatch: Ubuntu ships npm as its own package. Fix: install Node from nodejs.org/fnm/NodeSource (bundles matching npm) or `npm install -g npm@11`. |
| bun | 1.4.2 | 1.4.2 (`bun-v1.4.2`) ✅ | github releases redirect, npm | `bun upgrade`; install `curl -fsSL https://bun.com/install | bash`, Windows `powershell -c "irm bun.sh/install.ps1 | iex"` |
| gh | 2.46.0 (Ubuntu apt `2.46.0-4`) | **v2.101.0** (2026-09-15) | github.com/cli/cli/releases/latest | Official apt repo, verbatim from docs/install_linux.md: `(type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y)) && sudo mkdir -p -m 755 /etc/apt/keyrings && out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg && cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && sudo mkdir -p -m 755 /etc/apt/sources.list.d && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null && sudo apt update && sudo apt install gh -y`; upgrade `sudo apt update` + `sudo apt install gh`. Windows: `winget install --id GitHub.cli --source winget` (docs/install_windows.md). **Token in keyring is invalid** (`gh auth status`): `gh auth login -h github.com`. |
| git | 2.53.0 | n/a | | fine |
| jq | 1.8.1 | n/a | | fine |
| python3 | 3.14.4 | n/a | | fine; `pipx` present, `uv` missing |
| missing | uv, gum, pwsh | | | gum optional for the picker; pwsh needed only for Windows/statusline.ps1 |

## 7. settings.json observations (verbatim structure)
- `hooks`: 10 × `'/home/alexf/.caveman/bin/caveman-proxy' native-hook claude --adapter '/usr/local/lib/node_modules/@caveman-ai/cli/dist/native-hook-fast.js'` (timeout 30) + `'/usr/local/bin/caveman' shrink-hook` on PreToolUse. Absolute per-host paths.
- `statusLine.command`: `bash "$(ls -td "$HOME/.claude/plugins/cache/caveman/caveman/"*/ 2>/dev/null | head -1)src/hooks/caveman-statusline.sh"` — script exists today at `.../15581d14007f/src/hooks/caveman-statusline.sh`.
- `env: {}` — no proxy route; Remote Control usable.
- `extraKnownMarketplaces.caveman` = github JuliusBrussee/caveman (auto-update off by default for third-party marketplaces).
- `enabledPlugins` (20) incl. a duplicate `code-review` at project scope with "Version: unknown" (installed_plugins.json: project-scope entry from 2026-08-24, user-scope from 2026-09-14).
- `model` is `"opus[1m]"` in settings.json (the inventory handed to this research said `fable[1m]` — that is not what the file contains).
- `skipDangerousModePermissionPrompt` set — carry over deliberately (security posture), not silently.

## 8. Recommended actions for the installer (this host and others)
1. `claude update` (already latest) / `codex update` (already latest).
2. `claude plugin marketplace update caveman && claude plugin update caveman@caveman` → 2.7.0; `claude plugin update remember@claude-plugins-official` → 0.33.0.
3. `npm install -g @caveman-ai/cli` (→1.3.4) then `caveman setup --install` and `caveman setup --agent-native claude` (+ `codex`); never copy the hooks block between hosts.
4. `npx skills update -g -y`; use `npx skills@latest` to get 1.5.26.
5. Either install LSP binaries (`npm install -g typescript-language-server typescript`, `npm install -g pyright` or `pipx install pyright`, `go install golang.org/x/tools/gopls@latest`) or `claude plugin uninstall gopls-lsp@claude-plugins-official` (and the others) — make LSP plugins conditional on the binary in the picker.
6. Replace `autoUpdates:false` with an explicit choice: `autoUpdatesChannel` (stable/latest) or `env.DISABLE_AUTOUPDATER=1` + `FORCE_AUTOUPDATE_PLUGINS=1`.
7. Codex: `codex mcp add context7 ...`, `codex mcp add playwright npx "@playwright/mcp@latest"`, caveman via `caveman setup --agent-native codex` / `npx skills add JuliusBrussee/caveman -a codex -g`; superpowers already installed at account level (verify with `/plugins`).
8. gh: switch to cli.github.com apt repo; `gh auth login`. Node: consider Node 24 LTS via fnm; drop Debian npm 9.
9. Treat `upskill`/`job-*` skills and `fli` MCP as personal, host-specific.

## Sources
- https://registry.npmjs.org/@anthropic-ai/claude-code , /@openai/codex , /@caveman-ai/cli , /skills , /npm , /bun , /@playwright/mcp , /@upstash/context7-mcp (fetched 2026-09-17)
- https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json and each plugin's `.claude-plugin/plugin.json`, `external_plugins/context7/.mcp.json`, `external_plugins/playwright/.mcp.json`, `plugins/{typescript,pyright,gopls}-lsp/README.md`
- https://github.com/anthropics/claude-plugins-official (stars/commits), https://github.com/anthropics/claude-plugins-official/tree/main/plugins
- https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md
- https://code.claude.com/docs/en/setup , https://code.claude.com/docs/en/settings-reference , https://code.claude.com/docs/en/discover-plugins
- https://github.com/anthropics/claude-code/issues/60956
- https://github.com/obra/superpowers , https://github.com/obra/superpowers/releases , raw README.md and .claude-plugin/plugin.json (main and b36e082)
- https://github.com/Digital-Process-Tools/claude-remember , raw plugin.json at main / a5cc87c / 9f92bc6
- https://github.com/JuliusBrussee/caveman/releases , /releases/tag/v2.7.0 , raw README.md, INSTALL.md, docs/technical/agent-wrapping.md, src/hooks/README.md, bin/install.js, .claude-plugin/plugin.json + package.json (main and 15581d1), @caveman-ai/cli@1.3.4 tarball (dist/index.js `nativeHooksDocument`)
- https://github.com/openai/codex/releases , /releases/latest , raw README.md, docs/install.md, docs/config.md; https://learn.chatgpt.com/docs/codex/cli , https://learn.chatgpt.com/docs/build-skills , https://learn.chatgpt.com/docs/skills-and-plugins
- https://raw.githubusercontent.com/vercel-labs/skills/main/README.md
- https://raw.githubusercontent.com/microsoft/playwright-mcp/main/README.md , https://raw.githubusercontent.com/upstash/context7/master/README.md , https://context7.com/docs/resources/all-clients
- https://nodejs.org/dist/index.json , https://raw.githubusercontent.com/nodejs/Release/main/schedule.json , https://nodejs.org/en/download
- https://github.com/cli/cli/releases/latest , https://raw.githubusercontent.com/cli/cli/trunk/docs/install_linux.md , https://github.com/oven-sh/bun/releases/latest , raw bun README.md
- Local (read-only): `~/.claude/settings.json`, `~/.claude.json`, `~/.claude/plugins/installed_plugins.json`, `known_marketplaces.json`, plugin cache, `~/.agents/.skill-lock.json`, `~/.codex/config.toml`, `codex --help`/`codex plugin list`/`codex mcp list`/`codex features list`, `claude plugin list`/`claude plugin details`, `dpkg -l`, `gh auth status`.

## Verification (skeptical fact-check pass, 2026-09-17)

Method: every claim re-fetched from its primary source (npm registry JSON via curl, raw.githubusercontent.com manifests, GitHub `releases/latest` redirects and repo HTML `aria-label` star counts because api.github.com was rate-limited from this IP and returned 403 via WebFetch, code.claude.com docs, learn.chatgpt.com docs, the @caveman-ai/cli 1.3.4 tarball, and read-only local commands: `claude plugin details`, `codex plugin list`, `codex mcp list`, `codex ... --help`, `gh auth status`, `dpkg -l`, file reads). Nothing was installed or modified.

### Confirmed as-is (no change)
- npm dist-tags: @anthropic-ai/claude-code latest=2.1.273 (2026-09-15T18:06Z), stable=2.1.267, next=2.1.274; @openai/codex latest=0.154.0 (2026-09-09T22:40Z); @caveman-ai/cli 1.3.4 (2026-09-15T04:12Z); skills 1.5.26 (2026-09-11); npm 12.0.2 (2026-07-29, engines `^22.22.2 || ^24.15.0 || >=26.0.0`; 9.2.0 engines `^14.17.0 || ^16.13.0 || >=18.0.0`; 11.19.1 engines `^20.17.0 || >=22.9.0`); @playwright/mcp 0.0.81 (2026-09-14); @upstash/context7-mcp 4.1.1 (2026-09-14); bun 1.4.2.
- `releases/latest` redirects: openai/codex → rust-v0.154.0; JuliusBrussee/caveman → v2.7.0 (2026-09-15T04:01Z; v2.6.0 2026-09-04T00:19Z); obra/superpowers → v6.3.0 (2026-08-12T16:58Z); cli/cli → v2.101.0 (2026-09-15T14:24Z); oven-sh/bun → bun-v1.4.2; vercel-labs/skills → v1.5.26.
- marketplace.json (305 plugins): remember pinned sha a5cc87c3… (plugin.json 0.33.0 at that sha and at main), superpowers pinned b36e0829… (6.3.0), security-guidance entry 2.0.7 vs plugin.json 2.0.8, LSP configs inline (`lspServers`: typescript-language-server --stdio, pyright-langserver --stdio, gopls). claude-remember plugin.json at 9f92bc6 = 0.31.0 (installed_plugins.json says 0.32.0).
- caveman at 15581d14007f: package.json 2.6.0, commit date 2026-09-07T08:19Z ("chore: sync SKILL.md copies"); main = 2.7.0. plugin.json at that commit has no `version` field (main does).
- @caveman-ai/cli 1.3.4 tarball: `nativeHooksDocument()` (dist/index.js:6180) emits exactly the 10 claude events / 12 codex events listed; `nativeHookCommand()` derives the adapter path from `import.meta.url` (host-specific, as claimed); `engines.node >=22.13`; ships `bin-v1.1.7` (local 1.3.3 has bin-v1.1.6). `caveman setup --agent-native <claude|codex> [--remove]` exists.
- caveman docs: INSTALL.md/README commands (`claude plugin marketplace add JuliusBrussee/caveman && claude plugin install caveman@caveman`, `npx skills add JuliusBrussee/caveman -a codex -g`, `npx skills add JuliusBrussee/caveman --skill '*' -a codex --yes -g`, `npm install -g @caveman-ai/cli && caveman setup --install`, install.sh/install.ps1 pinned to v2.7.0, Node 22.13+, Codex skips shrink hook openai/codex#18491); agent-wrapping.md Remote Control / ANTHROPIC_BASE_URL / `caveman disable claude` text; bin/install.js copies caveman-statusline.sh/.ps1 into `$CLAUDE_CONFIG_DIR/hooks/` and uses pwsh/powershell `-NoProfile -ExecutionPolicy Bypass -File` on Windows; plugin `caveman-activate.js` lines 405-420 emit the hard `__dirname` path nudge.
- code.claude.com/docs/en/setup: all install commands, system requirements, `autoUpdatesChannel`, `minimumVersion`, `DISABLE_AUTOUPDATER` env snippet + `claude doctor` line, `DISABLE_UPDATES`, `claude update`. discover-plugins: `FORCE_AUTOUPDATE_PLUGINS=1`, official marketplaces auto-update / third-party do not, LSP binary table ("the plugin doesn't install it for you"). Issue #60956: opened 2026-05-20, closed not planned.
- LSP plugin READMEs give verbatim: `npm install -g typescript-language-server typescript`; `npm install -g pyright` / `pip install pyright` / `pipx install pyright`; `go install golang.org/x/tools/gopls@latest`.
- Codex README/docs: install.sh / install.ps1 / `npm install -g @openai/codex` / `brew install --cask codex`, releases.openai.com fallback, docs/install.md "macOS 12+, Ubuntu 20.04+/Debian 10+, or Windows 11 via WSL2". learn.chatgpt.com/docs/build-skills: `$CWD/.agents/skills`, parent, `$REPO_ROOT/.agents/skills`, `$HOME/.agents/skills`, `/etc/codex/skills`, `$skill-installer`, `[[skills.config]] enabled = false`.
- microsoft/playwright-mcp README: `claude mcp add playwright npx @playwright/mcp@latest`, `codex mcp add playwright npx "@playwright/mcp@latest"`, `[mcp_servers.playwright] command = "npx" args = ["@playwright/mcp@latest"]`. context7.com/docs/resources/all-clients: both Codex forms and both Claude Code forms as quoted.
- superpowers README: `/plugin install superpowers@claude-plugins-official`; Codex `/plugins` → search superpowers → Install Plugin; `gemini extensions install https://github.com/obra/superpowers`; `devin plugins install obra/superpowers`; `pi install git:github.com/obra/superpowers`. v6.2.0 notes confirm the Windows SessionStart/Git Bash fix.
- Local: installed_plugins.json matches the inventory (code-review has project-scope "unknown" from 2026-08-24 + user-scope 76c85b7366c8 from 2026-09-14); `~/.claude.json` installMethod native / autoUpdates false; codex binary under `~/.codex/packages/standalone/releases/0.154.0-x86_64-unknown-linux-musl/`; `codex update`/`doctor`/`plugin`/`mcp` subcommands present; `codex mcp list` = none; `codex plugin list` = superpowers 6.3.0 + openai-templates 0.1.1 + plugin-management 0.1.0 installed/enabled (3,972 openai-curated-remote rows), local cache holds only the latter two; `~/.codex/config.toml` mtime 2026-09-16 21:02, `model = "gpt-5.6-sol"`, `model_reasoning_effort = "low"`, no `[mcp_servers]`; skill lock v3 = 21 entries (20 caveman + find-skills) all 2026-09-04; upskill/job-* symlinks 2026-09-08; typescript-language-server/pyright-langserver/gopls/go/uv/gum/pwsh/fnm all missing, pipx present; dpkg nodejs 22.22.1, npm 9.2.0~ds3-1, gh 2.46.0-4; gh keyring token invalid; `claude plugin details` always-on: plugin-dev ~2,349, pr-review-toolkit ~2,033, caveman ~1,812, superpowers ~688, remember ~73.
- Node: schedule.json v22 end 2027-04-30, v24 lts 2025-10-28 / maintenance 2026-10-20, v26 lts 2026-10-28; dist/index.json v22.23.2 (npm 10.9.8), v24.21.0 (npm 11.19.0), v26.9.0 (npm 11.19.1).
- CHANGELOG: "Renamed `/simplify` to `/code-review`", later "`/simplify` now runs a cleanup-only review", "`/review` to be an alias of `/code-review`", `/security-review` present.

### Corrections made
1. **remember on Codex**: README says `codex plugin marketplace add Digital-Process-Tools/claude-remember` + `codex plugin install remember` ("observed against codex-cli 0.150.1"). On the installed 0.154.0, `codex plugin install --help` → `error: unrecognized subcommand 'install'`; the subcommand is `codex plugin add <PLUGIN[@MARKETPLACE]>`. The repo's Codex marketplace manifest (`.agents/plugins/marketplace.json`) is named `remember-dev`, so the corrected second step is `codex plugin add remember@remember-dev` (constructed from `--help`; confidence medium). Also: the Claude-side README install path is `/plugin marketplace add Digital-Process-Tools/claude-marketplace` + `/plugin install remember@dpt-plugins`; the official-marketplace path used here (`remember@claude-plugins-official`) is equally valid.
2. **gh apt install**: the first-pass one-liner was a paraphrase (used `/tmp/gh.gpg`, dropped the wget check and `mkdir /etc/apt/sources.list.d`). Replaced with the verbatim block from docs/install_linux.md. Windows id corrected to `winget install --id GitHub.cli --source winget` (docs/install_windows.md).
3. **fnm**: `curl -o- https://fnm.vercel.app/install | bash` → README form `curl -fsSL https://fnm.vercel.app/install | bash`.
4. **Codex alpha tag** moved to 0.155.0-alpha.14 during the check (was .13).
5. **Star counts** now exact (GitHub HTML, 2026-09-17): anthropics/claude-code 145,476; openai/codex 124,738; JuliusBrussee/caveman 106,038; obra/superpowers 287,606; Digital-Process-Tools/claude-remember 172; vercel-labs/skills 31,801; anthropics/claude-plugins-official 36,430; microsoft/playwright-mcp 37,181; upstash/context7 62,096. `pushed_at` still unavailable (API 403/rate-limit) — the "4,235 commits" figure was dropped as unverifiable.
6. **settings.json `model`** is `"opus[1m]"`, not `fable[1m]` as the inventory JSON given to the researchers states.
7. **Codex docs canonical URL**: developers.openai.com/codex/skills 308-redirects to https://learn.chatgpt.com/docs/build-skills (resolves part of open question 6).
8. `npx skills@latest update -g -y` is an npx-semantics construction; the README documents `npx skills update -g -y` (and `npx skills update <skill>`). Both kept, the former flagged.
9. `codex mcp add caveman -- ~/.caveman/bin/caveman-mcp` remains a construction from `codex mcp add` usage (`<NAME> (--url <URL> | -- <COMMAND>...)`) — flagged, not sourced from caveman docs.

### Additional facts found during verification
- Claude Code docs: `DISABLE_AUTOUPDATER` only stops the background check — `claude update`/`claude install` still work; `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1` lets Homebrew/WinGet installs self-upgrade; apt/dnf/apk installs never auto-update; npm package needs Node ≥22 since v2.1.198 (registry engines `>=22.0.0`); Homebrew has `claude-code` (stable) and `claude-code@latest` casks.
- discover-plugins: plugins enabled on claude.ai are synced into terminal sessions on Claude Code v2.1.273+ (`synced` source in `/plugin` Installed tab) — relevant to the installer's plugin picker (some plugins may arrive via account sync rather than local install).
- `claude plugin install plugin@marketplace` refreshes that marketplace first (v2.1.232+) even when auto-update is off — so an installer can rely on `claude plugin install caveman@caveman` picking up 2.7.0 without a separate `marketplace update`.
- Codex `codex plugin marketplace add <SOURCE>` accepts local path, `owner/repo[@ref]`, HTTPS or SSH Git URL, `--ref`.

### Removed
- None. Every URL resolved (raw manifests 200, docs 200, repo pages 200). `https://raw.githubusercontent.com/JuliusBrussee/caveman/main/src/hooks/README.md` returns 200.
