# GAP-FILL 2: Idempotency, exit codes and update-all semantics of every provisioning command

Researched 2026-09-17 on Ubuntu 26.04 with the locally installed binaries
`claude 2.1.273` (native, `~/.local/bin/claude -> ~/.local/share/claude/versions/2.1.273`; **auto-updated to 2.1.274 later the same day — all rows re-verified on 2.1.274, see Verification**)
and `codex-cli 0.154.0` (standalone, `~/.local/bin/codex -> ~/.codex/packages/standalone/current/bin/codex`,
`current -> releases/0.154.0-x86_64-unknown-linux-musl`), plus `skills` 1.5.26 (npm; **npm `latest` moved to 1.6.0 on 2026-09-17T00:01Z, see Verification**), `@caveman-ai/cli` 1.3.3
(global npm, root-owned under `/usr/local/lib/node_modules`; npm `latest` is 1.3.4 as of 2026-09-15).

Every "observed" row below was produced by actually running the command twice in throwaway state
(`CLAUDE_CONFIG_DIR=<scratch>/ccdir`, `CODEX_HOME=<scratch>/codexhome`, `HOME=<scratch>/home` for the skills
CLI). Nothing in the real `~/.claude`, `~/.codex`, `~/.agents` was modified. Rows marked "source" come from the
fetched source code / docs cited in the Sources section, not from execution (the real updaters were NOT run).

---

## 1. Claude Code: marketplaces and plugins (`claude plugin ...`)

State files written (under `$CLAUDE_CONFIG_DIR`):
`settings.json` (`extraKnownMarketplaces`, `enabledPlugins`), `plugins/known_marketplaces.json`,
`plugins/installed_plugins.json` (schema `version: 2`, one array entry per scope), `plugins/marketplaces/<name>/`
(git clone), `plugins/cache/<marketplace>/<plugin>/<version>/`, `plugins/plugin-catalog-cache.json`.

| Command | 1st run | Re-run (same state) | Exit | JSON (`--json`) | Safe unconditionally? |
|---|---|---|---|---|---|
| `claude plugin marketplace add anthropics/claude-plugins-official` | `✔ Successfully added marketplace: claude-plugins-official (declared in user settings)` (clones via HTTPS, 120 s timeout) | `✔ Marketplace 'claude-plugins-official' already on disk — declared in user settings` | 0 / 0 | no `--json` for `add` (only `--scope`, `--sparse`, `--claudeai`) | YES (idempotent). If `settings.json` declares the marketplace but `plugins/marketplaces/<name>` and `known_marketplaces.json` are missing (dotfiles restored on a new host) the re-run re-clones and exits 0. |
| same name, different source (`https://github.com/anthropics/claude-plugins-official.git`) | — | `✘ Failed to add marketplace: Cannot add marketplace "claude-plugins-official": its network source differs from the one declared for it in settings ...` | 1 | — | Keep the source string identical across hosts (`owner/repo` form). |
| `claude plugin marketplace update` (no args) | `✔ Successfully updated 1 marketplace` | same | 0 | none (no `--json` flag) | YES. Named form `... update <name>` exit 0; unknown name -> `✘ Failed to update marketplace(s): Marketplace 'nope' not found. Available marketplaces: ...` exit 1. |
| `claude plugin marketplace remove <name>` | `✔ Successfully removed marketplace` **and uninstalls every plugin from it** (`enabledPlugins` -> `{}`, `plugin list` -> `[]`) | `✘ Failed to remove marketplace: Marketplace 'x' not found` | 0 / 1 | — | NO — destructive; never use as a "reset" step. |
| `claude plugin install superpowers@claude-plugins-official --scope user --json` | `{"command":"install","outcome":"ok","plugin":"superpowers@claude-plugins-official","pluginId":"superpowers@claude-plugins-official","scope":"user","message":"Successfully installed plugin: ... (scope: user)"}` | `{"command":"install","outcome":"ok",...,"message":"Plugin \"superpowers@claude-plugins-official\" is already installed (scope: user)"}` | 0 / 0 | `command, outcome, plugin, pluginId, scope, message` (+ `failureCode` on failure; `shownCommand{sha256,...}` for command-source plugins) | YES. Named form (`@marketplace`) refreshes that marketplace first (docs: skipped if refreshed <30 s ago). Bare name `claude plugin install superpowers` resolves against installed marketplaces (exit 0). |
| install again with a different `--scope` (project / local) | writes `enabledPlugins` into `<cwd>/.claude/settings.json` / `.claude/settings.local.json`, adds a second/third entry to `installed_plugins.json` (same cache dir) | as above | 0 | `scope` = `project` / `local`, `projectPath` in `plugin list --json` | Works even outside a git repo (creates `<cwd>/.claude/settings.json`). Do NOT run project-scope from `$HOME` or `/tmp` by accident. |
| install when plugin is *enabled* in restored `settings.json` but not in `installed_plugins.json` | `Successfully installed` | — | 0 | as above | YES — this is exactly the "new host with synced settings" case; `plugin update` in that state fails (`not_installed`). Always run install, then update. |
| install when plugin is disabled | re-installs and **re-enables** (`enabledPlugins[...]=true`) | | 0 | | Note: install flips disabled plugins back on. |
| `claude plugin install does-not-exist@claude-plugins-official --json` | `{"command":"install","outcome":"failed",...,"message":"Plugin \"does-not-exist\" not found in marketplace \"claude-plugins-official\"","failureCode":"not_found"}` + human `✘` line on stderr | same | 1 | `failureCode: not_found` | Also the result when the marketplace was never added (message suggests `claude plugin marketplace update <name>`). |
| `claude plugin update superpowers@claude-plugins-official --json` (already current) | `{"command":"update","outcome":"ok","plugin":"superpowers@claude-plugins-official","pluginId":"...","scope":"user","message":"superpowers is already at the latest version (6.3.0).","updateOutcome":"up_to_date","oldVersion":"6.3.0","newVersion":"6.3.0"}` | same | 0 | extra keys: `updateOutcome` (`up_to_date`; other value on real update), `oldVersion`, `newVersion` | YES. Bare name works: `claude plugin update superpowers --json` -> `pluginId` resolved. Human output: `Checking for updates for plugin "..." at user scope…` / `✔ superpowers is already at the latest version (6.3.0).` |
| `claude plugin update <not-installed> --json` | `{"command":"update","outcome":"failed",...,"message":"Plugin \"context7\" is not installed","failureCode":"not_installed"}` | | 1 | `failureCode: not_installed` / `not_installed_at_scope` (with `--scope` mismatch, message names the scope path) / `not_found` (unknown marketplace) | Loop must tolerate exit 1. |
| `claude plugin update` (no plugin) | usage error `missing required argument 'plugin'` | | 1 | none | **There is no update-all.** Loop over `claude plugin list --json`. |
| `claude plugin uninstall X --scope local --json` | `{"command":"uninstall","outcome":"ok",...,"scope":"local","keptData":false,"message":"Successfully uninstalled plugin: superpowers (scope: local)"}` | `{"command":"uninstall","outcome":"failed","plugin":"superpowers","scope":"local","message":"Plugin \"superpowers\" is not installed in local scope. Use --scope to specify the correct scope.","failureCode":"not_installed_at_scope"}` (verified 2.1.274). The binary also carries a `failureCode:"enabled_at_project_scope"` + `installedScope` branch (uninstall at a non-project scope while the plugin is enabled by `.claude/settings.json`), which was NOT reproduced in a non-git temp dir. | 0 / 1 | `keptData`, `failureCode`, `installedScope` | Idempotent only per scope; default scope is `user`. |
| `claude plugin disable X --json` | `{"command":"disable","outcome":"ok",...}` | `{"command":"disable","outcome":"failed","message":"... is already disabled","failureCode":"already_in_goal_state","alreadyInGoalState":true}` | 0 / **1** | `alreadyInGoalState: true` | NOT exit-idempotent: check `alreadyInGoalState` in JSON or `plugin list --json .enabled` first. Same for `enable`. |
| `claude plugin list --json` | array of `{id, version, scope, enabled, installPath, installedAt, lastUpdated, projectPath?}` | same | 0 | | YES (read-only). `--available --json` returns `{installed:[...], available:[{pluginId,name,description,marketplaceName,source{...},installCount}]}` (307 available in claude-plugins-official on 2026-09-17). |
| `claude plugin marketplace list --json` | `[{name, source:"github", repo, installLocation}]` | same | 0 | | YES (read-only). |

Docs confirm: `--json` prints ONE JSON object as the **last line of stdout** (parse only that line; a marketplace-declared
command may be printed above it); "same exit codes"; usage errors print no JSON and exit 1; `--json` requires
v2.1.268+, `--accept-command` v2.1.271+. Plugins with a `command` source or `headersHelper` need `-y` when stdin/stdout
is not a TTY. Version detection: Claude Code uses the plugin's `version` (or content hash / commit sha, e.g. the
user's `code-review 76c85b7366c8`) as the cache key; if the marketplace publishes new commits without bumping
`version`, `plugin update` reports "already at the latest version" (docs, plugins-reference "Version management").

Auto-update: `claude-plugins-official` (and most Anthropic marketplaces) have background auto-update on by default
(refresh + plugin update after session start with up to 10 min random delay); third-party marketplaces (caveman) are
off by default. `DISABLE_AUTOUPDATER=1` disables both CLI and plugin auto-updates; add `FORCE_AUTOUPDATE_PLUGINS=1` to
keep plugin auto-updates. This host has `autoUpdates=false` in `~/.claude.json` yet `claude doctor` reports
`Auto-updates: enabled` and `Config install method: unknown` (warning: run `claude install` to record it).

---

## 2. Claude Code: MCP servers (`claude mcp ...`)

All user/local scope state lives in `$CLAUDE_CONFIG_DIR/.claude.json` (`mcpServers` for user scope,
`projects[<path>].mcpServers` for local scope); project scope is `<cwd>/.mcp.json`.

| Command | 1st run | Re-run | Exit | JSON | Safe unconditionally? |
|---|---|---|---|---|---|
| `claude mcp add -s user -t http context7 https://mcp.context7.com/mcp` | `Added HTTP MCP server context7 with URL: https://mcp.context7.com/mcp to user config` + `File modified: .../.claude.json` | `MCP server context7 already exists in user config` | 0 / **1** | none (no `--json`) | **NO.** Same error even when the URL differs (no upsert). Docs (mcp.md) confirm: "running `claude mcp add` again with the same server name at the same scope fails with `MCP server sentry already exists in local config`". |
| `claude mcp add-json -s user context7 '{"type":"http","url":"..."}'` | same as add | `MCP server context7 already exists in user config` | 0 / **1** | none | **NO** — add-json does NOT overwrite either. Invalid JSON/schema -> `Invalid configuration: : Invalid input` exit 1. |
| same name in another scope (`-s local`) | `Added ... to local config` | | 0 | | Scopes are independent namespaces; `claude mcp list` warns on same-name conflicts with different endpoints. |
| `claude mcp remove context7` (no scope) when it exists in 2 scopes | `MCP server "context7" exists in multiple scopes: ... To remove from a specific scope, use: claude mcp remove context7 -s local / -s user` | same | **1** | none | Always pass `-s`. |
| `claude mcp remove -s user context7` | `Removed MCP server context7 from user config` | `No MCP server named "context7" in user scope` | 0 / 1 | | Not idempotent by exit code; ignore exit code. |
| `claude mcp remove nope` | `No MCP server named "nope". Configured servers: ...` (when nothing is configured at all: `No MCP server named "nope". Run \`claude mcp add\` to add one.`) | | 1 | | |
| `claude mcp get <name>` | prints scope/status/type/URL and health-checks (connects!) | | 0 (exists) / 1 (`No MCP server named "nope". Configured servers: ...`) | none | Usable as an existence probe but it performs a live connection; prefer `jq` on `.claude.json`. |
| `claude mcp list` | health-checks every server (`✔ Connected`), includes plugin servers as `plugin:<plugin>:<server>` | | 0 | none (no `--json`) | Read-only but slow/network. |
| `claude mcp add -s user pw -- npx @playwright/mcp@latest` | `Added stdio MCP server pw with command: npx @playwright/mcp@latest to user config` | `MCP server pw already exists in user config` | 0 / 1 | | Same as HTTP. |
| flag ordering gotcha | `claude mcp add -s user -e FOO=bar cave -- cmd` -> `error: missing required argument 'commandOrUrl'` (variadic `-e` swallows the name) | | 1 | | Put `-e`/`-H` AFTER the name: `claude mcp add -s user cave -e FOO=bar -- /path/caveman-mcp` (writes `{"type":"stdio","command":...,"args":[],"env":{"FOO":"bar"}}`). |

Recommended upsert pattern (verified): `claude mcp remove -s user <name> >/dev/null 2>&1 || true; claude mcp add -s user ...`.
Caveat: removing a remote server also deletes its stored OAuth tokens/client registration (mcp.md), so for OAuth
servers compare the existing JSON first (`jq -e '.mcpServers["<name>"]' "$CLAUDE_CONFIG_DIR/.claude.json"`) and only
remove+add when the definition differs. claude.ai connectors (Gmail, Drive, ...) are not managed by `claude mcp add`.

---

## 3. Claude Code: CLI self-update (`claude update`, `claude install`)

Source of truth: `code.claude.com/docs/en/setup.md` (fetched) + strings in the 2.1.273 binary + `https://claude.ai/install.sh` (fetched, 260 lines). The real updater was NOT executed.

| Situation | Output | Exit |
|---|---|---|
| native, already newest on channel | `Claude Code is up to date (2.1.273)` | 0 |
| native, update installed | `Successfully updated from <old> to version <new>` | 0 |
| native, another Claude process holds the install lock | `Another Claude process (PID n) is currently running. Please try again in a moment.` (yellow) | **0** — silent no-op; the installer must check `claude --version` afterwards or run updates when no `claude` session is open |
| native, version check failed | `Failed to check for updates` (stderr) | 1 |
| native, install failed | `Error: Failed to install native update` + `Try running "claude doctor" for diagnostics` | 1 |
| native, `autoUpdatesChannel: "stable"` and stable is older than current, NO `minimumVersion` | prints `@stable is at X (older than 2.1.273)...` then runs the installer and reports `Successfully updated from 2.1.273 to version X` — i.e. **`claude update` will DOWNGRADE** to the stable channel version (binary code path; not exercised) | 0 |
| native, `minimumVersion` or managed `requiredMaximumVersion` set and the channel target is outside the range | `The stable channel is at X, which is <reason>. Staying on 2.1.273.` | 0 |
| Homebrew install | `Claude is managed by Homebrew.` then either `Update available: 2.1.273 → X` + `To update, run:` `  brew upgrade claude-code` (or `claude-code@latest`) or `Claude is up to date!` (+ tip about the `claude-code@latest` cask). **Never runs brew itself.** | 0 |
| WinGet install | `Claude is managed by winget.` + `Update available ... To update, run:` `  winget upgrade Anthropic.ClaudeCode` or `Claude is up to date!` | 0 |
| apk install | `Claude is managed by apk.` ... `  apk upgrade claude-code` or `Claude is up to date!` | 0 |
| apt/dnf/other package manager | `Claude is managed by a package manager.` / `Please use your package manager to update.` (no version check) | 0 |
| npm global | `npm view @anthropic-ai/claude-code@latest version` then installs; docs: use `npm install -g @anthropic-ai/claude-code@latest`, never `npm update -g` | 0 / 1 |
| development build | `Warning: Cannot update development build` | 1 |
| `DISABLE_UPDATES=1` | blocks `claude update` and `claude install` too (`DISABLE_AUTOUPDATER` only stops background checks) | — |

Optional env: `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1` lets Claude Code run `brew upgrade` / `winget upgrade` itself in the background (docs). On WinGet the upgrade can fail while claude.exe is running (file lock).

`claude install [stable|latest|VERSION] [--force]` ("Force installation even if already installed"):
- Binary strings: `Install: Calling installLatest(channelOrVersion=..., forceReinstall=...)`, `Install: Already up to date`, `Install: Saved autoUpdatesChannel=<x> to user settings`, `Claude Code successfully installed!`, `Could not install - another process is currently installing Claude. Please try again in a moment.`, `Install: Shell PATH already configured`.
- So `claude install stable` on a `latest` install (a) persists `autoUpdatesChannel: "stable"` in user settings and (b) installs the stable version — a downgrade unless `minimumVersion` is set (docs: the `/config` UI prompts and can set `minimumVersion`; the CLI path does not prompt). Treat `claude install stable` as "switch channel", not as "update".
- `https://claude.ai/install.sh [stable|latest|VERSION]`: refuses `sudo` unless `CLAUDE_INSTALL_ALLOW_SUDO=1`; **always downloads the newest binary (~220 MB, `downloads.claude.ai/claude-code-releases/latest`, zstd if available, sha256-verified) even when already installed**, then runs `<binary> install [target]` and deletes the download; exit 137 = OOM (needs ~512 MB). Not a cheap rerun — prefer `claude update` when `claude` is present. Windows: `irm https://claude.ai/install.ps1 | iex` (stable: `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable`), `winget install Anthropic.ClaudeCode`, `winget upgrade Anthropic.ClaudeCode`.
- Launcher: `~/.local/bin/claude` symlink into `~/.local/share/claude/versions/`; since v2.1.207 a custom launcher at that path is left alone. A few old versions are kept (2.1.272, 2.1.273, 2.1.274 present at 2026-09-17 13:30Z after the auto-update to 2.1.274; 2.1.270/271 had been pruned).
- **2.1.274 additions (binary code, `GIT_SHA 1efcc136`, `BUILD_TIME 2026-09-16T21:39:42Z`):** the native updater has a `skippedUnverifiedRelease` guard — if the channel target "predates release-signature enforcement" it prints `Update target X (from @<channel> or a server-side override) predates release-signature enforcement; staying on <cur>. Run \`claude install X\` to switch to it explicitly.` and exits 0; `claude install` accepts a hidden `rc` target (saved as `autoUpdatesChannel: "stable"`); the package-manager table also knows `mise` (`mise upgrade claude`). The npm code path (not native) has an explicit non-downgrade guard: `You're running <cur>, which is newer than the <channel> channel's <X>. Skipping update. To switch back to the channel version, run claude install <X>.` exit 0 — this guard does NOT exist in the native branch, which only prints `@<channel> is at X (older than <cur>)...` and calls the installer.

---

## 4. Codex CLI: MCP servers (`codex mcp ...`)

State: `$CODEX_HOME/config.toml` `[mcp_servers.<name>]` tables. Running with `CODEX_HOME` under `/tmp` prints
`WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper binaries under temporary dir "/tmp"` on every command (harmless; only for throwaway homes).

| Command | 1st run | Re-run | Exit | JSON | Safe unconditionally? |
|---|---|---|---|---|---|
| `codex mcp add context7 --url https://mcp.context7.com/mcp` | writes `[mcp_servers.context7]\nurl = "..."`, prints `Added global MCP server 'context7'.` then **`Detected OAuth support. Starting OAuth flow…` + `Authorize context7 by opening this URL in your browser: https://clerk.context7.com/oauth/authorize?...` and BLOCKS waiting for the 127.0.0.1 callback** (killed after >120 s; exit 143 on SIGTERM) | identical: rewrites the table and starts OAuth again | 0 only after browser login | none | **NO in headless mode.** Source (`codex-mcp/src/mcp/auth.rs::oauth_login_candidate`): OAuth discovery is skipped when `bearer_token_env_var` is set. Verified: `codex mcp add context7 --url https://mcp.context7.com/mcp --bearer-token-env-var CONTEXT7_API_KEY` -> `Added global MCP server 'context7'.` exit 0, no OAuth. The config is written BEFORE the OAuth flow, so `timeout 15 codex mcp add ...` also leaves a valid entry (exit 124). Alternative: write the TOML table yourself. |
| `codex mcp add pw -- npx @playwright/mcp@latest` | `Added global MCP server 'pw'.` | `Added global MCP server 'pw'.` (overwrites) | 0 / 0 | none | YES (upsert), BUT `add` **replaces the whole table**: a re-add drops hand-edited keys (`startup_timeout_sec`, `enabled = false`, `env`, `[mcp_servers.pw.env]`). Verified. |
| `codex mcp list` / `--json` | table; JSON array of `{name, enabled, disabled_reason, transport{type:"stdio"|"streamable_http", command,args,env,env_vars,cwd | url,bearer_token_env_var,http_headers,...}, startup_timeout_sec, tool_timeout_sec, auth_status ("bearer_token"|"unsupported"|...)}` | same | 0 | yes | YES (no network). |
| `codex mcp get context7 [--json]` | details / JSON with `enabled_tools`, `disabled_tools` | | 0; unknown name -> `Error: No MCP server named 'nope' found.` exit 1 | yes | Cheap existence probe. |
| `codex mcp remove context7` | `Removed global MCP server 'context7'.` | `No MCP server named 'context7' found.` | 0 / **0** | none | YES (idempotent, exit 0 both times). |
| corrupt TOML (e.g. duplicate `[mcp_servers.pw]` table appended by a naive script) | every `codex` subcommand fails: `Error: failed to load configuration ... duplicate key` | | 1 | | Never append TOML tables blindly; parse/merge (python `tomllib`+`tomli_w`, or `codex mcp add`). |

---

## 5. Codex CLI: plugins and marketplaces (`codex plugin ...`)

State: `config.toml` `[marketplaces.<name>]` (`source_type = "git"`, `source = "https://github.com/<owner>/<repo>.git"`) and
`[plugins."<plugin>@<marketplace>"] enabled = true`; snapshots in `$CODEX_HOME/.tmp/marketplaces/<name>/`; installed
copies in `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/`; curated (`openai-curated` / id suffix
`openai-curated-remote`) snapshot in `$CODEX_HOME/.tmp/plugins` + `.tmp/plugins.sha`, remote markers
`plugins/cache/openai-curated-remote/<plugin>/.codex-remote-plugin-install.json` (`{"schema_version":1,"remote_plugin_id":"plugin_connector_1p_..."}`).

| Command | 1st run | Re-run | Exit | JSON | Safe unconditionally? |
|---|---|---|---|---|---|
| `codex plugin marketplace add anthropics/claude-plugins-official --json` (Claude-format `.claude-plugin/marketplace.json` is accepted) | `{"marketplaceName":"claude-plugins-official","installedRoot":".../.tmp/marketplaces/claude-plugins-official","alreadyAdded":false}` | same with `"alreadyAdded": true` | 0 / 0 | `marketplaceName, installedRoot, alreadyAdded` | YES. |
| `codex plugin marketplace add openai/plugins` | `Error: marketplace \`openai-curated\` is reserved and cannot be added from this source` | same | 1 | | The curated marketplace is implicit; do not add it. In a fresh `CODEX_HOME` without auth, `marketplace list --json` -> `{"marketplaces": []}`; on the real (logged-in) home it lists `{"name":"openai-curated","root":"~/.codex/.tmp/plugins"}`. |
| `codex plugin marketplace list --json` | `{"marketplaces":[{name, root, marketplaceSource{sourceType:"git", source}}]}` | | 0 | | read-only |
| `codex plugin marketplace upgrade [--json] [NAME]` | `{"selectedMarketplaces":["claude-plugins-official"],"upgradedRoots":[".../claude-plugins-official"],"errors":[]}` | `{"selectedMarketplaces":[...],"upgradedRoots":[],"errors":[]}` (nothing changed) | 0 / 0 | `selectedMarketplaces, upgradedRoots, errors` | YES. Only refreshes **Git** marketplace snapshots; it does not touch `openai-curated` and does not reinstall plugins. |
| `codex plugin marketplace remove NAME` | `Removed marketplace ...` + `Removed installed marketplace root: ...` | `Error: marketplace \`x\` is not configured or installed` | 0 / 1 | (`--json` exists per docs) | |
| `codex plugin add superpowers@claude-plugins-official --json` | `{"pluginId":"superpowers@claude-plugins-official","name":"superpowers","marketplaceName":"claude-plugins-official","version":"6.3.0","installedPath":".../plugins/cache/claude-plugins-official/superpowers/6.3.0","authPolicy":"ON_INSTALL"}`; adds `[plugins."superpowers@claude-plugins-official"] enabled = true` | identical JSON | 0 / 0 | `pluginId,name,marketplaceName,version,installedPath,authPolicy` | YES. Source (`core-plugins/src/store.rs::install_with_version_and_manifest` -> `replace_plugin_root_atomically`) always re-copies from the marketplace snapshot, so **re-`add` after `marketplace upgrade` IS the update path** (there is no `codex plugin update`). |
| `codex plugin add nope@claude-plugins-official --json` | `Error: plugin \`nope\` was not found in marketplace \`claude-plugins-official\`` | | 1 | no JSON on error | |
| `codex plugin remove superpowers@claude-plugins-official --json` | `{"pluginId":"...","name":"superpowers","marketplaceName":"claude-plugins-official"}` and removes the `[plugins...]` table + cache | identical JSON | 0 / **0** | | YES (idempotent). |
| `codex plugin list [--json]` | human table `PLUGIN STATUS VERSION SOURCE`; JSON `{installed:[{pluginId,name,marketplaceName,version,installed,enabled,source{source:"git",url,sha},marketplaceSource{sourceType,source},installPolicy,authPolicy}], available:[...]}` (keys verified 0.154.0) | | 0 | | read-only; the real home shows `superpowers@openai-curated-remote 6.3.0 AVAILABLE`, `openai-templates 0.1.1`, `sites 0.1.65`, `plugin-management 0.1.0` (`INSTALLED_BY_DEFAULT`). |

Curated plugins: Codex itself syncs `https://github.com/openai/plugins.git` (`refs/codex/curated-sync`, fallback
`https://chatgpt.com/backend-api/plugins/export/curated`) on a `plugins-curated-repo-sync` thread at startup and
refreshes the curated cache when the sha changes; non-curated caches are refreshed `IfVersionChanged`
(`core-plugins/src/manager.rs` ~L3289, ~L3476). So Codex plugins effectively auto-update at session start; the
installer's job is only to ensure the `[plugins."x@y"]` tables exist. `codex plugin add <x>@openai-curated-remote`
could not be exercised in a throwaway home (needs ChatGPT auth). Note `codex plugin marketplace upgrade` cannot refresh the curated marketplace.

---

## 6. Codex CLI: self-update (`codex update`) and `install.sh`

From `codex-rs/cli/src/main.rs::run_update_command`, `codex-rs/tui/src/update_action.rs`, `codex-rs/install-context/src/lib.rs` (commit `77c1feb`, 2026-09-17) and the fetched `https://chatgpt.com/codex/install.sh` (1209 lines):

| Install method (detection) | `codex update` runs | Notes |
|---|---|---|
| Standalone Unix: exe canonical path under `$CODEX_HOME/packages/standalone/releases/` | `sh -c "curl -fsSL https://chatgpt.com/codex/install.sh \| CODEX_NON_INTERACTIVE=1 sh"` | This host. |
| Standalone Windows | `powershell -ExecutionPolicy Bypass -c "$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 \| iex"` (resolved through absolute PATH entries, run from a temp cwd) | |
| npm / bun / pnpm / vp (env `CODEX_MANAGED_BY_NPM|BUN|PNPM|VITE_PLUS` set by the JS shim) | `npm install -g @openai/codex` / `bun install -g @openai/codex` / `pnpm add -g @openai/codex` / `vp install -g @openai/codex` | |
| Brew (macOS only: exe under `/opt/homebrew` or `/usr/local`) | `brew upgrade --cask codex` | Linuxbrew -> `Other`. |
| `Other` (winget, scoop, choco, cargo, app bundle, custom path) | `Could not detect the Codex installation method. Please update manually: https://developers.openai.com/codex/cli/` | **exit 1** (anyhow bail). `install-context` has no winget/scoop/choco *install-method* detection: the only WinGet code (`CodexPackageLayout::from_exe`, `#[cfg(windows)]`, `layoutVersion == 1`) recognises the package *layout* for resource lookup, and `install_method_from_exe` still returns `InstallMethod::Other` for it. `UpdateAction` also has a `Daemon(DaemonUpdateSource)` variant (`codex app-server daemon update`) that is not used by `codex update`. |
| debug build | `codex update is not available in debug builds...` | exit 1 |

`codex update` does no version comparison itself: it always executes the update action; success prints
`Updating Codex via \`<cmd>\`...` then `🎉 Update ran successfully! Please restart Codex.`, failure `\`<cmd>\` failed with status <n>` exit 1.
The docs page only says: "Check for and apply a Codex CLI update when the installed release supports self-update."

`install.sh` rerun semantics (verified by reading): resolves `latest` (or `CODEX_RELEASE`/`--release`), prints
`==> Updating Codex CLI` (same version) / `==> Updating Codex CLI from A to B` / `==> Installing Codex CLI`; if
`releases/<ver>-<target>` is already complete (binary reports expected version, `codex-resources/bwrap` present on
Linux) it **skips the download**, re-points `current`, re-links `~/.local/bin/codex` (`CODEX_INSTALL_DIR`), checks
PATH (`# >>> Codex installer >>>` block in the profile; prints `==> ~/.local/bin is already on PATH`), warns on a
conflicting npm/bun/brew codex (`Detected existing npm-managed Codex at ...`; asks to uninstall it unless
`CODEX_NON_INTERACTIVE=1` -> keeps it and warns "PATH order will determine which codex runs"), prints
`Codex CLI <ver> installed successfully.`, and prompts `Start Codex now?` unless non-interactive. Uses an install lock
(`packages/standalone/install.lock`, stale after 600 s). Exit 0 on a no-op rerun. Old release dirs are kept
(0.153.4 and 0.154.0 present here). `version.json` (`latest_version`, `last_checked_at`) is the TUI's update-check cache.

---

## 7. skills CLI (`npx skills ...`, tested with vercel-labs/skills 1.5.26; npm latest is 1.6.0 / repo HEAD 1a6f864 as of 2026-09-17, no behavioural change in the cited code paths)

Isolated `HOME`; commands run with `npx -y skills@1.5.26`. Lock file: `~/.agents/.skill-lock.json` (`version: 3`, per-skill
`source, sourceType, sourceUrl, skillPath, skillFolderHash, installedAt, updatedAt`). Canonical dir `~/.agents/skills/<name>`;
Claude Code gets a symlink `~/.claude/skills/<name> -> ../../.agents/skills/<name>`; Codex is a "universal" agent
(`skillsDir: '.agents/skills'`, reads `~/.agents/skills` directly, no symlink).

| Command | 1st run | Re-run | Exit | JSON | Safe unconditionally? |
|---|---|---|---|---|---|
| `npx skills add vercel-labs/agent-skills --skill frontend-design -g -a claude-code -y` | `■ No matching skills found for: frontend-design` + list of the 9 available (`web-design-guidelines`, `vercel-optimize`, ...) | same | **1** | with `--json`: `[{"name":"frontend-design","status":"skipped","reason":"No matching skill found in source"}]` (re-verified with skills 1.6.0) | The brief's example skill no longer exists under that name; the design-guidelines skill is `web-design-guidelines`. |
| `npx skills add vercel-labs/agent-skills --skill web-design-guidelines -g -a claude-code -y --json` (`--json` exists only since skills 1.5.26, release notes #1686; the npx cache on this host holds 1.5.23 which lacks it — always use `npx -y skills@latest`) | `[{"name":"web-design-guidelines","status":"installed","source":"vercel-labs/agent-skills","ref":null,"hash":"a6a44d...","path":"~/.claude/skills/web-design-guidelines","scope":"global","agents":["Claude Code"],"mode":"copy","security":null}]` | identical (`status: installed` again; it re-clones and overwrites, no "already installed" state) | 0 / 0 | `name,status(installed|skipped|failed),source,ref,hash,path,scope,agents,mode(copy|symlink),security,reason,error` | YES (idempotent by overwrite), costs a git clone each time. With a single non-universal agent it uses `mode: copy` into `~/.claude/skills`; with `-a claude-code codex` it uses `~/.agents/skills` + symlink (`mode: symlink`). `--json` requires `-y`. |
| `... -g -a '*' -y --json` | `[{"name":"vercel-optimize","status":"failed","error":"Eve does not support global skill installation"}]` — but the skill IS installed for the other agents | | **1** | | Do not use `-a '*'` with `-g`; list agents explicitly (`-a claude-code codex`). |
| `npx skills update -g -y` (nothing changed) | `Checking for skill updates…` / `Checking skills from source: vercel-labs/agent-skills` / (`GitHub API unavailable; checking via Git clone` when rate-limited) / `✓ All global skills are up to date` | same | 0 / 0 | none | YES. With `-y` and a non-TTY the scope auto-detects (project if `skills-lock.json`/`.agents` in cwd, else global) — pass `-g` explicitly. |
| `npx skills update -g -y` with a changed `skillFolderHash` | `Found 1 global update(s)` / `Updating web-design-guidelines…` / `✓ Updated web-design-guidelines` / `✓ Updated 1 skill(s)`; internally re-spawns `cli.mjs add <sourceUrl> --skill <name> -g -y` | | 0; `process.exitCode = 1` only if some update failed (`Failed to update N skill(s)`) | | Update relocated the copy-mode skill into `~/.agents/skills` + symlink (side effect). Sources without `sourceUrl` in the lock are reported as `cannot be checked automatically`. |
| `npx skills ls -g --json` | `[{name,path,scope,agents,source,sourceUrl,sourceType}]` | | 0 | yes | read-only |

Note: the user's real `~/.agents/skills` holds 24 skills including the whole caveman suite; `npx skills update -g -y`
will try to check each source (`JuliusBrussee/caveman` etc.) via GitHub API then git clone.

---

## 8. caveman (`npm i -g @caveman-ai/cli`, `caveman setup --agent-native claude`)

| Command | Observed / source | Exit | Safe? |
|---|---|---|---|
| `npm i -g @caveman-ai/cli@latest` as the normal user while `/usr/local/lib/node_modules/@caveman-ai/cli` is root-owned (installed with sudo) | `npm ERR! code EACCES` ... `EACCES: permission denied, rename '/usr/local/lib/node_modules/@caveman-ai/cli' -> '/usr/local/lib/node_modules/@caveman-ai/.cli-XXXX'` + "It is likely you do not have the permissions..." | **243** (npm 9.2.0 on Node 22) | Fails, nothing changed. The installer must either (a) `sudo npm i -g @caveman-ai/cli@latest` (re-creates the same root-owned state), or (b) migrate to a user prefix once (`npm config set prefix ~/.local` or `~/.npm-global`, then `sudo npm uninstall -g @caveman-ai/cli` and reinstall as user). Detect with `[ -w "$(npm root -g)/@caveman-ai/cli" ]`. `caveman --help` still works (1.3.3 installed, 1.3.4 latest on 2026-09-15). |
| `caveman setup --agent-native claude` rerun | `dist/index.js::nativeHooksDocument`: for each lifecycle event (`SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, SubagentStart, SubagentStop, Stop, SessionEnd`; codex adds `PermissionRequest, PostCompact`) it **filters out any existing entry whose command identity is `native-hook:<agent>` and pushes exactly one new entry** ("Replace, never accumulate ... a caveman native-hook entry for this agent that points at another binary or adapter path ... is the SAME hook"). `shrink-hook` uses the same replace-not-accumulate rule (`shrinkHookEntry` = any handler whose command includes `shrink-hook`). Setup runs under `withIntegrationLock("agent-native-bundle-<agent>")`, journals to `~/.caveman/integrations/<agent>.agent-native-bundle.json`, rolls back on failure, and ends with `✔ claude: complete agent-native bundle ready`. | 0 / non-zero on failure (`agent-native setup failed: ...; changes rolled back`); `--agent-native` other than claude/codex -> exit 2 | YES — idempotent, no duplicate hook blocks. **In the installed 1.3.3** paths are hard-coded: `join(homedir(), ".claude", "settings.json")`, `join(homedir(), ".codex", "hooks.json")` — `CLAUDE_CONFIG_DIR` is ignored. **Corrected (Verification): the npm `latest` 1.3.4 (2026-09-15) replaces these with `claudeConfigDir()` (honours `CLAUDE_CONFIG_DIR`) and `codexHomeDir()` (honours `CODEX_HOME`)** — `claudeSettingsPath()` = `join(claudeConfigDir(), "settings.json")`, `codexHooksPath()` = `join(codexHomeDir(), "hooks.json")` (cli-1.3.4.tgz `dist/index.js` L5838-5860, L13922-13930). The replace-not-accumulate hook logic is unchanged in 1.3.4 (L6193). Other hooks in the file are preserved; a non-object settings.json is refused. Not executed here (would touch the real `~/.claude/settings.json`). |
| `caveman setup --agent-native claude --remove` | removes the bundle, restores prior skills/cloud MCP | | for uninstall only |

---

## 9. Recommended update-all sequence (idempotent, safe to run on every host, every time)

Run while **no interactive `claude` session is open** (the native updater silently exits 0 when another process holds the lock; WinGet upgrades fail while claude.exe runs).

```bash
set -u
# 0. Preconditions
command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash      # first install only (downloads ~220MB every run)
command -v codex  >/dev/null || curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh

# 1. Marketplaces (idempotent; keep the exact same source string everywhere)
for m in anthropics/claude-plugins-official JuliusBrussee/caveman; do
  claude plugin marketplace add "$m"            # exit 0 if already on disk; re-clones if cache missing
done
claude plugin marketplace update                # refresh ALL claude marketplaces (no --json)
codex plugin marketplace upgrade --json >/dev/null   # refresh git-backed codex marketplaces only (curated syncs itself at codex startup)

# 2. Claude plugins: install (no-op if present, re-enables if disabled) then update
for p in "${CLAUDE_PLUGINS[@]}"; do            # e.g. superpowers@claude-plugins-official caveman@caveman ...
  claude plugin install "$p" --scope user --json | tail -n1 | jq -e '.outcome=="ok"' >/dev/null || echo "install failed: $p"
done
claude plugin list --json | jq -r '.[] | select(.scope=="user") | .id' | while read -r id; do
  claude plugin update "$id" --json | tail -n1 | jq -r '"\(.pluginId): \(.updateOutcome // .failureCode) \(.oldVersion // "")->\(.newVersion // "")"'
done

# 3. Codex plugins: re-add == update (store always re-copies from the refreshed snapshot)
for p in "${CODEX_PLUGINS[@]}"; do            # e.g. superpowers@claude-plugins-official, superpowers@openai-curated-remote
  codex plugin add "$p" --json >/dev/null || echo "codex plugin add failed: $p"
done

# 4. MCP servers: Claude needs remove+add (add errors with "already exists", exit 1); Codex add overwrites but drops extra keys
claude mcp remove -s user context7 >/dev/null 2>&1 || true
claude mcp add -s user -t http context7 https://mcp.context7.com/mcp
# codex: skip OAuth-capable HTTP servers unless a bearer env var is given, or the command blocks on a browser login
codex mcp add context7 --url https://mcp.context7.com/mcp --bearer-token-env-var CONTEXT7_API_KEY

# 5. Skills (global): add is overwrite-idempotent; update is a no-op when hashes match
npx -y skills@latest add vercel-labs/agent-skills --skill web-design-guidelines -g -a claude-code codex -y --json | jq -r '.[]|"\(.name): \(.status)"'
npx -y skills@latest update -g -y

# 6. CLI self-updates (last, so plugin/MCP steps ran on a known binary)
claude update            # native: "Claude Code is up to date (x)" / "Successfully updated from a to version b"; brew/winget/apt: prints the command, exit 0, does nothing
codex update             # standalone/npm/bun/pnpm/brew(macOS) only; winget/scoop/choco/linuxbrew -> exit 1 "Could not detect the Codex installation method"
#   Windows fallbacks: winget upgrade Anthropic.ClaudeCode ; powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"

# 7. caveman (needs writable npm prefix) and regenerate hooks (replace-not-accumulate, safe to rerun)
if [ -w "$(npm root -g)/@caveman-ai" ]; then npm i -g @caveman-ai/cli@latest; else sudo npm i -g @caveman-ai/cli@latest; fi
caveman setup --agent-native claude
caveman setup --agent-native codex
```

Ordering rationale: marketplace refresh must precede `plugin install`/`update` (the update compares against the local
catalog copy; the named `plugin install x@y` form refreshes too but only that marketplace). Codex `marketplace upgrade`
must precede `plugin add` because `add` copies from the snapshot. MCP and skills are independent of plugin state.
CLI self-update goes last because a freshly updated `claude` may require a restart and the WinGet/brew paths only
print instructions. Caveman hook regeneration goes after the caveman CLI update because the hook command embeds the
`~/.caveman/bin/caveman-proxy` path/adapter that the new CLI may have moved (its matcher replaces the old entry).

---

## 10. Cross-cutting gotchas for the installer

1. **Exit codes are inconsistent across tools.** Claude plugin commands: success/no-op exit 0, `enable`/`disable` on a no-op exit 1 with `alreadyInGoalState:true`; `claude mcp add` duplicate exit 1; `codex mcp remove` missing exit 0; `codex plugin remove` missing exit 0; `npx skills add` partial failure exit 1 with `status:"failed"` per entry. Parse JSON where available instead of relying on exit codes.
2. **`--json` availability (2.1.273):** yes for `plugin install/update/uninstall/enable/disable/list/validate`; no for `plugin marketplace add/update/remove`, `mcp add/add-json/remove/get/list`, `update`, `install`. Codex: `--json` on `mcp list/get`, `plugin add/remove/list`, `plugin marketplace add/list/upgrade/remove`, `doctor`; none on `mcp add/remove`, `update`.
3. **Marketplace removal cascades** (`claude plugin marketplace remove` uninstalls its plugins). Never "remove and re-add" to fix a marketplace.
4. **Restored dotfiles**: `settings.json` `enabledPlugins`/`extraKnownMarketplaces` alone are not enough; `plugin install` must run to populate `installed_plugins.json` and the cache (verified), and `marketplace add` re-clones a missing cache.
5. **Codex OAuth on `mcp add --url`** blocks headless runs; use `--bearer-token-env-var`, a timeout, or write TOML.
6. **Codex `mcp add` clobbers** the whole `[mcp_servers.<name>]` table; **appending TOML** with a duplicate table breaks every codex command.
7. **`claude update` can downgrade** when `autoUpdatesChannel=stable` is set and no `minimumVersion` pin exists; `claude install stable` also switches the channel. Decide channel explicitly in the installer and set `minimumVersion` if you never want a downgrade.
8. **Lock contention**: `claude update`/`claude install` exit 0 with a warning while another claude process runs; codex `install.sh` uses `install.lock` (stale after 10 min).
9. **Package-manager installs**: `claude update` never runs brew/winget/apt itself (exit 0, prints the command); `codex update` cannot handle winget/scoop/choco or Linuxbrew (exit 1). The installer must own these paths.
10. **caveman 1.3.3 ignores `CLAUDE_CONFIG_DIR`** (hard-coded `~/.claude/settings.json`); **1.3.4 honours `CLAUDE_CONFIG_DIR`/`CODEX_HOME`** — so update the CLI *before* running `caveman setup` on hosts that use a non-default config dir. It needs a writable npm prefix; `sudo npm i -g` is what created the root-owned dir on this host.
11. **`npx skills add -g -a '*'`** fails on the "Eve" agent; enumerate agents. The example skill `frontend-design` does not exist in `vercel-labs/agent-skills` (use `web-design-guidelines`).
12. `claude mcp add` variadic flags (`-e`, `-H`) must come after the server name.
13. `codex plugin add` on Windows/anywhere prints a PATH-alias warning when `CODEX_HOME` is under `/tmp` — cosmetic, but it means Codex writes helper binaries into `$CODEX_HOME`; don't point `CODEX_HOME` at tmpfs in production.
14. `claude doctor` reports `Config install method: unknown` on this host — the installer should run `claude install` once (no target) on native installs so `installMethod` is recorded, or ignore the warning.

---

## Sources

- Local binaries: `claude --version` = `2.1.273 (Claude Code)`; `codex --version` = `codex-cli 0.154.0`; `claude plugin --help`, `claude plugin install/update/uninstall/enable/list --help`, `claude plugin marketplace add/update --help`, `claude mcp/add/add-json/remove/list/get --help`, `claude update --help`, `claude install --help`, `claude doctor`; `codex --help`, `codex mcp add/remove --help`, `codex plugin add/remove/marketplace/marketplace add/marketplace upgrade --help`, `codex update --help`, `codex doctor --help` (2026-09-17).
- Executed experiments (throwaway dirs, 2026-09-17): `<scratchpad>/ccdir`, `<scratchpad>/ccdir2`, `<scratchpad>/proj`, `<scratchpad>/codexhome`, `<scratchpad>/home` (outputs quoted inline above).
- Claude Code binary strings: `~/.local/share/claude/versions/2.1.273` (`strings -n 12`, update/install code path around "Claude is up to date!", "Claude Code is up to date (", "Successfully updated from", "Install: Already up to date", "Install: Saved autoUpdatesChannel=").
- https://claude.ai/install.sh (fetched 2026-09-17, 260 lines).
- https://code.claude.com/docs/en/setup.md (fetched; sections "Update Claude Code", "Auto-updates", "Configure release channel", "Pin a minimum version", "Update manually", "Install a specific version", "Install with Linux package managers", "Install with npm").
- https://code.claude.com/docs/en/troubleshoot-install.md (fetched; exit 137 OOM, `Raw mode is not supported` during piped `claude install`).
- https://code.claude.com/docs/en/plugins-reference.md (fetched; "--json result format", "plugin update", "Version management").
- https://code.claude.com/docs/en/discover-plugins.md (fetched; "Configure auto-updates", refresh-before-install behaviour).
- https://code.claude.com/docs/en/mcp.md (fetched; L757 "running `claude mcp add` again with the same server name at the same scope fails with `MCP server sentry already exists in local config`"; OAuth token deletion on remove).
- https://github.com/openai/codex @ 77c1feb00ed60a5540003dd48ce4df3598e13c9d (2026-09-17): `codex-rs/cli/src/main.rs` (`run_update_command`, `run_update_action`), `codex-rs/tui/src/update_action.rs` (`UpdateAction`, `command_args`), `codex-rs/install-context/src/lib.rs` (`InstallMethod`, `install_method_from_exe`, `standalone_install_method`), `codex-rs/cli/src/mcp_cmd.rs` (`run_add`, `run_remove`), `codex-rs/codex-mcp/src/mcp/auth.rs` (`oauth_login_candidate`), `codex-rs/core-plugins/src/store.rs` (`install_with_version_and_manifest`), `codex-rs/core-plugins/src/manager.rs` (`install_plugin`, curated sync thread, `NonCuratedCacheRefreshMode`), `codex-rs/core-plugins/src/startup_sync.rs` (constants).
- https://chatgpt.com/codex/install.sh (fetched 2026-09-17, 1209 lines).
- https://learn.chatgpt.com/docs/cli.md and https://developers.openai.com/codex/cli/reference.md -> https://learn.chatgpt.com/docs/developer-commands.md (fetched; `codex plugin`/`codex plugin marketplace` JSON field lists, `codex update` description, install/update commands).
- https://github.com/vercel-labs/skills @ e7354a26dea1cd74ab7969f2c67e6cdb01784bf8 (2026-09-16, package.json version 1.5.26); re-checked at HEAD 1a6f8649 (2026-09-16T23:59Z, package.json 1.6.0, npm latest 1.6.0 published 2026-09-17T00:01Z): `src/update.ts` (`updateGlobalSkills`, exit code logic), `src/add.ts` (`AddJsonResult`, overwrite handling), `src/cli.ts` (help text), `src/agents.ts` (`codex` config, `isUniversalAgent`).
- `/usr/local/lib/node_modules/@caveman-ai/cli/dist/index.js` (1.3.3): `installSettingsHookGeneric`, `nativeHooksDocument`, `claudeSettingsPath`, `codexHooksPath`, `--agent-native` handler (~L2851-2945); `npm view @caveman-ai/cli version` = 1.3.4 (modified 2026-09-15T04:12:30Z); npm debug log `~/.npm/_logs/2026-09-17T04_23_50_549Z-debug-0.log` (EACCES).
- Real-host read-only inspections: `~/.codex/version.json`, `~/.codex/packages/standalone/current/codex-package.json`, `~/.codex/plugins/cache/openai-curated-remote/*/.codex-remote-plugin-install.json`, `codex plugin marketplace list --json`, `codex plugin list --json`, `~/.claude/plugins/known_marketplaces.json`, `~/.agents/.skill-lock.json`.

---

## Verification

Fact-checked 2026-09-17 13:30–13:45 UTC by a second pass. Every "observed" row was **re-executed** in fresh throwaway
dirs (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, isolated `HOME`; scratchpad `vcc.*`, `vcc2.*`, `vcc3.*`, `vproj.*`, `vcx.*`,
`vhome.*`); nothing under `~/.claude`, `~/.claude.json`, `~/.codex`, `~/.agents` was touched. Primary sources were
re-fetched (docs pages, raw GitHub sources at `openai/codex@main` and `vercel-labs/skills@main`, both installer scripts,
npm registry, `npm pack @caveman-ai/cli@1.3.4` into the scratchpad). The real updaters (`claude update`, `codex update`,
`install.sh`, `npm i -g`, `caveman setup`) were again NOT run.

### Environment drift since the report was written
- **Claude Code auto-updated from 2.1.273 to 2.1.274** (`~/.local/bin/claude -> versions/2.1.274`, symlink mtime
  2026-09-17 16:25 local; `BUILD_TIME 2026-09-16T21:39:42Z`, `GIT_SHA 1efcc1361e64…`). All Claude rows below were
  re-verified on **2.1.274**; behaviour and messages are unchanged unless noted. `versions/` now holds 2.1.272–2.1.274.
- codex-cli 0.154.0, skills npm `latest` 1.6.0 (published 2026-09-17T00:01:30Z), `@caveman-ai/cli` latest 1.3.4
  (2026-09-15T04:12:29Z), installed 1.3.3 — unchanged.

### Confirmed by re-execution (2026-09-17, claude 2.1.274 / codex 0.154.0 / skills 1.6.0)
- `claude plugin marketplace add anthropics/claude-plugins-official` ×2: `✔ Successfully added marketplace: claude-plugins-official (declared in user settings)` / `✔ Marketplace 'claude-plugins-official' already on disk — declared in user settings`, exit 0/0; different source string → `✘ Failed to add marketplace: Cannot add marketplace "claude-plugins-official": its network source differs …` exit 1. `--help` options: `--claudeai`, `--scope`, `--sparse` (no `--json`).
- `claude plugin marketplace update` → `✔ Successfully updated 1 marketplace` exit 0; `update nope` → `✘ Failed to update marketplace(s): Marketplace 'nope' not found. Available marketplaces: claude-plugins-official` exit 1. Help text: "updates all if no name specified".
- `claude plugin marketplace remove claude-plugins-official` → exit 0 and `settings.json` becomes `{"enabledPlugins":{},"extraKnownMarketplaces":{}}`, `plugin list --json` → `[]`; second run exit 1 (`Marketplace 'claude-plugins-official' not found`). Docs (discover-plugins.md) carry the same warning: "Removing a marketplace will uninstall any plugins you installed from it."
- `claude plugin install superpowers@claude-plugins-official --scope user --json` ×2: identical JSON to the report (keys `command, outcome, plugin, pluginId, scope, message`), exit 0/0; unknown plugin → `failureCode:"not_found"` exit 1 with the human `✘` line on stderr.
- `claude plugin update superpowers@claude-plugins-official --json` → `updateOutcome:"up_to_date","oldVersion":"6.3.0","newVersion":"6.3.0"` exit 0; bare name resolves `pluginId`; not-installed → `failureCode:"not_installed"` exit 1; no argument → `error: missing required argument 'plugin'` exit 1 (no update-all).
- **Refinement of the "restored dotfiles" row:** with `settings.json` restored but *no marketplace clone*, `plugin update` fails with `failureCode:"not_found"` (`Plugin "superpowers" not found`); once the marketplace is on disk but `installed_plugins.json` is still absent it fails with `failureCode:"not_installed"`. `marketplace add` re-clones (exit 0) and `plugin install` then succeeds (exit 0) — the recommended `add → install → update` order stands.
- `claude plugin disable superpowers --json` ×2: ok / `failureCode:"already_in_goal_state","alreadyInGoalState":true` exit 0/1. `install` on the disabled plugin re-enables it (`enabledPlugins[...]=true`).
- `claude plugin install … --scope project` / `--scope local` in a non-git temp dir: creates `<cwd>/.claude/settings.json` / `settings.local.json`, exit 0; `plugin list --json` shows one entry per scope with `projectPath`. `uninstall --scope local --json` → `keptData:false`; rerun → `failureCode:"not_installed_at_scope"` exit 1 (see corrected row: `enabled_at_project_scope` exists in the binary but was not reproduced).
- `--json` availability on 2.1.274 (help text grep): plugin `install/update/uninstall/enable/disable/list/validate` yes; `marketplace list` yes; `marketplace add/update/remove` no; `mcp add/add-json/remove/get/list` no; `update`/`install` no. Matches the report. `claude plugin list --available --json` → 307 available plugins (2026-09-17).
- `claude mcp add -s user -t http context7 https://mcp.context7.com/mcp` ×2: `Added HTTP MCP server context7 with URL: … to user config` + `File modified: …/.claude.json` / `MCP server context7 already exists in user config`, exit 0/1; different URL → same error exit 1; `add-json` same name → same error exit 1; invalid JSON → `Invalid configuration: : Invalid input` exit 1; same name in `-s local` → exit 0; `remove context7` without `-s` when in two scopes → multi-scope message exit 1; `remove -s user` ×2 → `Removed …` / `No MCP server named "context7" in user scope` exit 0/1; `get nope` → exit 1; stdio `add pw -- npx @playwright/mcp@latest` ×2 → 0/1; `-e` before the name → `error: missing required argument 'commandOrUrl'` exit 1; `-e` after the name writes `{"type":"stdio","command":"/bin/true","args":[],"env":{"FOO":"bar"}}`. mcp.md still contains the "already exists" sentence and the OAuth-token deletion sentence; no `claude mcp` subcommand documents `--json`.
- `codex mcp add context7 --url … --bearer-token-env-var CONTEXT7_API_KEY` ×2: `Added global MCP server 'context7'.` exit 0/0, no OAuth. Without the flag: `Added global MCP server 'ctx7oauth'.` then `Detected OAuth support. Starting OAuth flow…` + `Authorize \`ctx7oauth\` by opening this URL in your browser: https://clerk.context7.com/oauth/authorize?…` and blocks (`timeout 15` → exit 124, TOML entry already written). `codex mcp add pw -- npx …` on a table with a hand-added `startup_timeout_sec = 60` → key dropped (verified). `mcp list --json` keys as in the report (`auth_status` = `bearer_token` / `not_logged_in` / `unsupported`). `mcp get nope` → `Error: No MCP server named 'nope' found.` exit 1; `mcp remove` ×2 → `Removed …` / `No MCP server named 'ctx7oauth' found.` exit **0/0**. `codex mcp add --help` also lists `--oauth-client-id`, `--oauth-client-registration <AUTO|CIMD|DCR>`, `--oauth-resource`.
- `codex plugin marketplace add anthropics/claude-plugins-official --json` ×2 → `alreadyAdded:false` / `true`, exit 0/0; `openai/plugins` → `Error: marketplace \`openai-curated\` is reserved and cannot be added from this source` exit 1; `marketplace list --json`, `marketplace upgrade --json` ×2 (`upgradedRoots` non-empty then `[]`), `plugin add superpowers@claude-plugins-official --json` ×2 (identical JSON, exit 0/0), `plugin add nope@…` (exit 1, no JSON), `plugin remove … --json` ×2 (identical JSON, exit 0/0), `marketplace remove` ×2 (`{"marketplaceName","installedRoot"}` exit 0, then `Error: marketplace \`claude-plugins-official\` is not configured or installed` exit 1) — all as reported.
- **"re-add == update" proven empirically:** after `codex plugin add`, a marker line appended to `README.md` and a new file inside `installedPath` were both gone after a second `codex plugin add` (exit 0) — the store re-copies the plugin root from the marketplace snapshot.
- skills 1.6.0 (`npx -y skills@latest`, isolated `HOME`): `add … --skill frontend-design` → exit 1, `--json` gives `[{"name":"frontend-design","status":"skipped","reason":"No matching skill found in source"}]`; `add … --skill web-design-guidelines -g -a claude-code -y --json` ×2 → `status:"installed"`, `mode:"copy"`, path `~/.claude/skills/web-design-guidelines`, exit 0/0; `-a claude-code codex` → `mode:"symlink"`, path `~/.agents/skills/…`, `~/.claude/skills/web-design-guidelines -> ../../.agents/skills/web-design-guidelines`; `-a '*' -g` → `status:"failed","error":"Eve does not support global skill installation"` exit 1; `update -g -y` → `Checking for skill updates…` / `Checking skills from source: vercel-labs/agent-skills` / `GitHub API unavailable; checking via Git clone` / `✓ All global skills are up to date` exit 0; `ls -g --json` keys as reported. `~/.agents/.skill-lock.json` `version: 3` with the listed per-skill keys.
- caveman: installed 1.3.3 `dist/index.js` L13706-13714 hard-codes `join(homedir(), ".claude", "settings.json")` / `join(homedir(), ".codex", "hooks.json")`; the 1.3.4 tarball (`npm pack`, `dist/index.js` L5838 `claudeConfigDir()` honouring `CLAUDE_CONFIG_DIR`, L5857 `codexHomeDir()` honouring `CODEX_HOME` (must exist and be a directory, otherwise throws), L13922-13930 `claudeSettingsPath()`/`codexHooksPath()`) confirms the correction. `nativeHooksDocument` (1.3.4 L6185-6215) filters `managedHookIdentity(...) !== "native-hook:<agent>"` then pushes one entry per event ("Replace, never accumulate"); event lists for claude (10) and codex (12, adds `PermissionRequest`, `PostCompact`) match; 1.3.4 additionally supports `gemini`. `setup --agent-native <other>` → `caveman setup: --agent-native must be claude or codex` exit 2 (1.3.3 L2864-2865); `withIntegrationLock("agent-native-bundle-<agent>")`, rollback message and `complete agent-native bundle ready` present in both versions. `$(npm root -g)/@caveman-ai/cli` is root-owned and not writable by the user (`[ -w … ]` false) — the EACCES claim is consistent; the npm run itself was not repeated.

### Confirmed against primary sources (re-fetched 2026-09-17)
- `https://claude.ai/install.sh`: 260 lines; refuses sudo unless `CLAUDE_INSTALL_ALLOW_SUDO=1` (L20-34); `DOWNLOAD_BASE_URL="https://downloads.claude.ai/claude-code-releases"`, `version=$(download_file "$DOWNLOAD_BASE_URL/latest")` (L149), zstd path (L187-206), sha256 check (L181), then `"$binary_path" install ${TARGET:+"$TARGET"}` (L226) and `rm -f "$binary_path"` (L229); exit 137 = OOM, "roughly 512MB" (L249-251). `https://claude.ai/install.ps1` → 302 → `downloads.claude.ai/claude-code-releases/bootstrap.ps1` (3189 B); `install.cmd` → `bootstrap.cmd` (8335 B).
- setup.md: `claude update` messages (`Successfully updated from <old version> to version <new version>`, `Claude Code is up to date (<version>)`, Homebrew/WinGet/apk → `Claude is up to date!`); `DISABLE_AUTOUPDATER` only stops the background check, `DISABLE_UPDATES` blocks `claude update`/`claude install` too; `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1`; "`minimumVersion` … Background auto-updates and `claude update` refuse to install any version below this value, so moving to the `stable` channel does not downgrade you if you are already on a newer `latest` build" (i.e. without the pin a downgrade is expected — consistent with the binary's native branch, which prints `@stable is at X (older than <cur>)...` and proceeds); `brew upgrade claude-code` / `claude-code@latest`, `winget upgrade Anthropic.ClaudeCode`, `sudo apt update && sudo apt upgrade claude-code`, `sudo dnf upgrade claude-code`, `apk update && apk upgrade claude-code`, `npm install -g @anthropic-ai/claude-code@latest` (avoid `npm update -g`); stable install `curl -fsSL https://claude.ai/install.sh | bash -s stable`, `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable`.
- Binary 2.1.274 (`strings`): all quoted messages present — `Claude Code is up to date (`, `Successfully updated from`, `Another Claude process${n} is currently running. Please try again in a moment.` followed by exit 0, `Failed to check for updates` (exit 1), `Error: Failed to install native update` + `Try running "claude doctor" for diagnostics` (exit 1), `The ${f} channel is at ${e}, which is ${n}. Staying on <cur>.` (exit 0, only when `minimumVersion` or `policySettings.requiredMaximumVersion` is set), `Claude is managed by Homebrew.` / `winget.` / `apk.` / `a package manager.` + `Please use your package manager to update.`, `Warning: Cannot update development build` (exit 1), `Install: Already up to date`, `Install: Saved autoUpdatesChannel=`, `Could not install - another process is currently installing Claude…`. `brew upgrade claude-code` is templated (`brew upgrade ${cask ?? "claude-code"}`), not a literal string.
- plugins-reference.md: `--json` = one JSON object as the last stdout line, `command/outcome/message` always present, usage errors print no result line and exit 1, `--json` requires v2.1.268+, `--accept-command` v2.1.271+, `shownCommand.sha256`. discover-plugins.md: named `plugin@marketplace` install refreshes that marketplace first (skipped if refreshed within 30 s, seed dir, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, or non-remote source); bare-name `claude plugin install name` reads cached catalogs without refreshing; `claude-plugins-official` auto-update on by default, third-party/local off; random delay up to ten minutes; `DISABLE_AUTOUPDATER` + `FORCE_AUTOUPDATE_PLUGINS=1`.
- `openai/codex@main` (raw, 2026-09-17): `codex-rs/tui/src/update_action.rs` (199 lines) — `StandaloneUnix` → `curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh`, `StandaloneWindows` → `$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 | iex`, npm/bun/vp `install -g @openai/codex`, pnpm `add -g @openai/codex`, brew `upgrade --cask codex`; `codex-rs/cli/src/main.rs` L1014-1031 `run_update_command` (debug-build bail; `Could not detect the Codex installation method. Please update manually: https://developers.openai.com/codex/cli/`; no version comparison), L951 `Updating Codex via \`{cmd_str}\`...`, L991 `\`{cmd_str}\` failed with status {status}`, L993 `🎉 Update ran successfully! Please restart Codex.`; `codex-rs/install-context/src/lib.rs` (915 lines) `InstallMethod {Standalone, Npm, Bun, Pnpm, VitePlus, Brew, Other}`, `CODEX_MANAGED_BY_NPM|BUN|PNPM|VITE_PLUS`, brew only when `is_macos` and exe under `/opt/homebrew` or `/usr/local`; `codex-rs/codex-mcp/src/mcp/auth.rs` L123-136 `oauth_login_candidate` returns `None` when `bearer_token_env_var.is_some()`; `codex-rs/core-plugins/src/store.rs` L340 `install_with_version_and_manifest`, L605 `replace_plugin_root_atomically`; `codex-rs/core-plugins/src/manager.rs` L3246 thread `plugins-curated-repo-sync`, `NonCuratedCacheRefreshMode::IfVersionChanged`; `codex-rs/core-plugins/src/startup_sync.rs` L27-31 `https://chatgpt.com/backend-api/plugins/export/curated`, `https://github.com/openai/plugins.git`, `refs/codex/curated-sync`; `codex-rs/cli/src/mcp_cmd.rs` L495-497 `Removed global MCP server '{name}'.` / `No MCP server named '{name}' found.` (both `println!`, no error → exit 0).
- `https://chatgpt.com/codex/install.sh`: 1209 lines; `CODEX_RELEASE`, `CODEX_NON_INTERACTIVE`, `CODEX_INSTALL_DIR` (L5-15, L87-88), `install.lock` + `LOCK_STALE_AFTER_SECS=600` (L22-24), `# >>> Codex installer >>>` (L599), `==> Updating Codex CLI from A to B` / `==> Updating Codex CLI` / `==> Installing Codex CLI` (L1133-1137), download skipped when `release_dir_is_complete` (L1156-1180), `update_current_link`, `update_visible_command`, `$BIN_DIR is already on PATH` (L1203), `Codex CLI <ver> installed successfully.` (L1208), `Start Codex now?` (L888), `Detected existing $manager-managed Codex at …` / `PATH order will determine which codex runs.` (L904-931). `https://chatgpt.com/codex/install.ps1` → 302 → `https://releases.openai.com/codex/install.ps1` (37146 B).
- `vercel-labs/skills@main`: `package.json` 1.6.0; `src/update.ts` (1047 lines) L669/681 `✓ All global skills are up to date`, L686 `Found N global update(s)`, L1034-1035 `Failed to update N skill(s)` + `process.exitCode = 1`, L219 `cannot be checked automatically`. Release v1.5.26 changelog includes `feat(add): add --json flag for machine-readable output (#1686)`.
- `learn.chatgpt.com/docs/developer-commands.md`, `learn.chatgpt.com/docs/cli.md`, `developers.openai.com/codex/cli/reference.md`, `code.claude.com/docs/en/troubleshoot-install.md`, `github.com/JuliusBrussee/caveman` all return HTTP 200. `https://www.npmjs.com/package/@caveman-ai/cli` returns 403 to curl (bot block) but the registry endpoint `https://registry.npmjs.org/@caveman-ai%2Fcli` confirms `latest = 1.3.4`.

### Corrections applied to the body
1. Header: noted the mid-day auto-update to 2.1.274; launcher bullet: versions present are 2.1.272–2.1.274 (not 2.1.270–273).
2. `claude plugin uninstall` row: the rerun result is `failureCode:"not_installed_at_scope"` (verified); `enabled_at_project_scope` demoted to "present in the binary, not reproduced".
3. `claude mcp remove nope` row: added the message variant printed when no servers are configured.
4. skills row: replaced the placeholder JSON (`nope-skill`) with the real `frontend-design` output.
5. `codex plugin list --json`: full key list for `installed[]` entries.
6. `codex update` "Other" row: clarified that the WinGet code in `install-context` is a package-layout probe (still `InstallMethod::Other`) and noted the unrelated `Daemon` update action.
7. Section 3: added the 2.1.274 `skippedUnverifiedRelease` guard, the hidden `rc` install target, the `mise` package-manager path, and the fact that the explicit "newer than the channel — Skipping update" guard exists only in the npm branch, not the native one (keeps the downgrade claim at medium confidence).

### Not verifiable / removed
- The `claude update` downgrade-on-stable-channel claim remains **medium** confidence (native branch read from minified code; not executed). Nothing was removed from the report; no claim was found to be false.
- `npm i -g @caveman-ai/cli@latest` exit code 243 was not re-run (it is an installer); the precondition (root-owned, non-writable prefix) was re-checked.
- `codex plugin add <x>@openai-curated-remote` still cannot be exercised without ChatGPT auth.
