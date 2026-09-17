# GAP-FILL 1: Codex plugin catalog and Claude -> Codex parity map

Researched 2026-09-17 on Ubuntu 26.04, `codex-cli 0.154.0` (standalone musl binary, mtime 2026-09-10), read-only against `~/.codex`; all mutating experiments ran in throwaway `CODEX_HOME` directories under the scratchpad (`gap1/home_noauth`, `gap1/home_chatgpt`, `gap1/home_apikey`). The one account-level side effect (remote install of `remember`) was reverted with `codex plugin remove` in the same run and the final `installed` list matched the pre-test state. Copied credentials were deleted afterwards.

## 1. Headline findings

1. **There are three, not two, catalogs** that `codex plugin add` can pull from, and the selector after `@` picks the catalog:
   - `<name>@openai-curated-remote` -> ChatGPT-backend "global" catalog (`/ps/plugins/list`, `/ps/plugins/{id}/install`). Requires ChatGPT login. Installed state is **account-level (server-side)**, not in `config.toml`.
   - `<name>@openai-curated` (ChatGPT users) / `<name>@openai-api-curated` (API-key users) -> reserved, Codex-managed git snapshot of `https://github.com/openai/plugins.git` at `$CODEX_HOME/.tmp/plugins`. Cannot be added manually (`marketplace openai-curated is reserved and cannot be added from this source`). Only synced by the TUI/app-server startup task, and **only when the remote global catalog is inactive** (`!(features.remote_plugin && ChatGPT auth)`), so on this machine the snapshot is frozen at commit `1e285826` (2026-08-28) while upstream HEAD is `1dc19589`.
   - `<name>@<your-marketplace>` -> any git/local marketplace you add with `codex plugin marketplace add owner/repo`. **Codex 0.154.0 accepts Claude-format marketplaces** (`.claude-plugin/marketplace.json`) and Claude-format plugin manifests (`.claude-plugin/plugin.json`). Verified: `codex plugin marketplace add anthropics/claude-plugins-official` exposes **308 plugins**, and `codex plugin add context7@claude-plugins-official` etc. installed cleanly; `codex mcp list --json` then shows the plugin-provided MCP servers (context7, playwright, github, serena). This is the parity path the installer should use.
2. `codex plugin list --available --json` with ChatGPT auth returned **3,984 entries** (4 installed + 3,980 available), all `marketplaceName=openai-curated-remote`, `source.source=remote`. Composition (from the catalog cache `$CODEX_HOME/cache/remote_plugin_catalog/*.json`, fetched_at 2026-09-17T04:08:54Z; re-counted 2026-09-17 against the real-home cache fetched_at 03:50:58Z): 3,375 LISTED (of which 3,276 are ChatGPT Apps-SDK apps `plugin_asdk_app_*`, ~100 are OpenAI-curated plugins/connectors) + 605 UNLISTED community-published plugins (`plugins_6a...` ids, e.g. remember, compound-engineering, frontend-design-premium). Installed-by-default on this account: `openai-templates`, `sites`, `plugin-management` (`installPolicy=INSTALLED_BY_DEFAULT`, `authPolicy=ON_USE`); `task-tool` is also INSTALLED_BY_DEFAULT in the catalog but not currently installed. 17 entries are `NOT_AVAILABLE` / `DISABLED_BY_ADMIN` (salesforce, bigquery, company-knowledge, admin-console, 13 anonymous `app-*`).
3. With **no auth** or **API-key auth**, the remote catalog is empty (`{"installed":[],"available":[]}`), `plugin add X@openai-curated-remote` fails with `chatgpt authentication required for remote plugin catalog` (exit 1), and `X@openai-curated` / `X@openai-api-curated` fail with `plugin X was not found in marketplace ...` because the CLI never creates the curated snapshot. Git marketplaces work fine with API-key auth (tested end to end).
4. **Update paths differ per catalog**: remote plugins are reconciled at every Codex startup from the authoritative `/ps/plugins/installed` snapshot (re-materialized when `release.version` differs, removed when uninstalled server-side) -> effectively auto-update; there is no CLI command for them. Git-marketplace plugins are refreshed by `codex plugin marketplace upgrade [--json] [NAME]` (also auto-run at startup in `PluginGitMode::Automatic`), which re-fetches the snapshot and force-reinstalls the configured plugins from it. The reserved `openai-curated` snapshot has no CLI refresh at all (`codex plugin marketplace upgrade openai-curated` -> `Error: marketplace `openai-curated` is not configured as a Git marketplace`; verified 2026-09-17, string at manager.rs:2912).

## 2. Local inventory reproduced

Real `~/.codex` (read-only):

```
$ codex plugin marketplace list --json
{ "marketplaces": [ { "name": "openai-curated", "root": "/home/alexf/.codex/.tmp/plugins" } ] }
$ codex plugin list --json | jq '.installed | map({name,version,installPolicy})'
superpowers 6.3.0 AVAILABLE | openai-templates 0.1.1 INSTALLED_BY_DEFAULT | sites 0.1.65 INSTALLED_BY_DEFAULT | plugin-management 0.1.0 INSTALLED_BY_DEFAULT
$ ls ~/.codex/plugins/cache/openai-curated-remote   -> plugin-management  openai-templates   (superpowers and sites NOT materialized locally)
$ cat ~/.codex/.tmp/plugins.sha  -> 1e285826e604f66f7208f7ac4dba0fe8341d1f57  (git log: 2026-08-28 "Add CrowdStrike Foundry and Fusion to curated marketplaces (#391)")
$ git ls-remote https://github.com/openai/plugins.git HEAD -> 1dc195897af4161d039b80d8471ec0a10c9bbc89
$ codex features list | grep plugin  -> plugins stable true; remote_plugin stable true; plugin_sharing stable true; recommended_plugins stable false; plugin_hooks removed
```

`config.toml` has no `[marketplaces.*]` or `[plugins.*]` tables, confirming remote installs are server-side state. Note `superpowers@openai-curated-remote` shows `installed:true` on the account but has no local bundle in `~/.codex/plugins/cache` (only 2 of the 4 installed plugins are materialized). The startup bundle sync should materialize it on the next TUI launch; worth a `remember:doctor`-style check in the installer.

## 3. The openai/plugins git catalog (openai-curated)

Source: `https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json` (fetched 2026-09-17). `name: "openai-curated"`, `interface.displayName: "Codex official"`, **65 plugins** (local snapshot has 64: `qodo` added upstream since 2026-08-28). API-key users get `.agents/plugins/api_marketplace.json` = `name: "openai-api-curated"`, 49 plugins (local snapshot 48). Repo: 6.9k stars, 897 forks (github.com/openai/plugins page, 2026-09-17).

| # | plugin | source | install policy | auth | category |
|---|---|---|---|---|---|
| 1 | linear | local | AVAILABLE | ON_INSTALL | Productivity |
| 2 | atlassian-rovo | local | AVAILABLE | ON_INSTALL | Productivity |
| 3 | google-calendar | local | AVAILABLE | ON_INSTALL | Productivity |
| 4 | gmail | local | AVAILABLE | ON_INSTALL | Communication |
| 5 | slack | local | AVAILABLE | ON_INSTALL | Communication |
| 6 | teams | local | AVAILABLE | ON_INSTALL | Communication |
| 7 | sharepoint | local | AVAILABLE | ON_INSTALL | Productivity |
| 8 | outlook-email | local | AVAILABLE | ON_INSTALL | Communication |
| 9 | outlook-calendar | local | AVAILABLE | ON_INSTALL | Productivity |
| 10 | canva | local | AVAILABLE | ON_INSTALL | Creativity |
| 11 | figma | local | AVAILABLE | ON_INSTALL | Creativity |
| 12 | stripe | local | AVAILABLE | ON_INSTALL | Finance |
| 13 | vercel | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 14 | game-studio | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 15 | superpowers | local | AVAILABLE | ON_INSTALL | Developer Tools (policy.products=[CODEX]) |
| 16 | github | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 17 | circleci | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 18 | google-drive | local | AVAILABLE | ON_INSTALL | Productivity |
| 19 | notion | local | AVAILABLE | ON_INSTALL | Productivity |
| 20 | cloudflare | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 21 | sentry | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 22 | build-ios-apps | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 23 | build-macos-apps | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 24 | build-web-apps | local | AVAILABLE | ON_USE | Developer Tools |
| 25 | build-web-data-visualization | local | AVAILABLE | ON_USE | Developer Tools |
| 26 | test-android-apps | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 27 | life-science-research | local | AVAILABLE | ON_INSTALL | Education & Research |
| 28 | zotero | local | AVAILABLE | ON_INSTALL | Education & Research |
| 29 | expo | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 30 | coderabbit | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 31 | remotion | local | AVAILABLE | ON_INSTALL | Creativity |
| 32 | plugin-eval | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 33 | granola | local | AVAILABLE | ON_INSTALL | Productivity |
| 34 | monday-com | local | AVAILABLE | ON_INSTALL | Productivity |
| 35 | temporal | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 36 | hyperframes | local | AVAILABLE | ON_INSTALL | Creativity |
| 37 | supabase | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 38 | codex-security | local | AVAILABLE | ON_USE | Security (v0.1.24, skills+apps+mcp, Proprietary) |
| 39 | twilio-developer-kit | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 40 | openai-developers | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 41 | datadog | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 42 | zoom | local | AVAILABLE | ON_INSTALL | Communication |
| 43 | mixpanel-headless | local | AVAILABLE | ON_INSTALL | Data & Analytics |
| 44 | airtable | local | AVAILABLE | ON_INSTALL | Productivity |
| 45 | nvidia | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 46 | posthog | local | AVAILABLE | ON_INSTALL | Data & Analytics |
| 47 | ngs-analysis | local | AVAILABLE | ON_INSTALL | Education & Research |
| 48 | shopify | local | AVAILABLE | ON_INSTALL | Business & Operations |
| 49 | magicpath | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 50 | openai-ads-conversions | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 51 | boltz-api-cli | local | AVAILABLE | ON_INSTALL | Scientific Research |
| 52 | dropbox | local | AVAILABLE | ON_INSTALL | Productivity |
| 53 | product-design | local | AVAILABLE | ON_USE | Creativity |
| 54 | data-analytics | local | AVAILABLE | ON_USE | Data & Analytics |
| 55 | creative-production | local | AVAILABLE | ON_USE | Creativity |
| 56 | public-equity-investing | local | AVAILABLE | ON_USE | Finance |
| 57 | adobe | local | AVAILABLE | ON_INSTALL | Creativity |
| 58 | lovable | local | AVAILABLE | ON_INSTALL | Developer Tools |
| 59 | clickup | local | AVAILABLE | ON_INSTALL | Productivity |
| 60 | consensus | local | AVAILABLE | ON_INSTALL | Education & Research |
| 61 | chatcut | local | AVAILABLE | ON_INSTALL | Creativity |
| 62 | higgsfield | local | AVAILABLE | ON_INSTALL | Creativity |
| 63 | crowdstrike-falcon-foundry | url (github.com/CrowdStrike/foundry-skills.git) | AVAILABLE | ON_INSTALL | Developer Tools |
| 64 | crowdstrike-falcon-fusion | url (github.com/CrowdStrike/fusion-skills.git) | AVAILABLE | ON_INSTALL | Developer Tools |
| 65 | qodo | git-subdir (github.com/qodo-ai/qodo-skills.git, path codex-packages/qodo) | AVAILABLE | ON_INSTALL | Developer Tools (not in local snapshot) |

Entry schema: `{name, source:{source:"local"|"url"|"git-subdir", path?|url?}, policy:{installation, authentication, products?}, category, interface?:{displayName}}`. `plugins/superpowers/.codex-plugin/plugin.json` = v6.3.0 by Jesse Vincent, `skills: ./skills/`, `hooks: {}` (no hooks in the Codex edition).

**Not present in openai-curated (either edition):** context7, playwright, caveman, skill-creator, commit-commands, security-guidance, remember, compound-engineering, frontend-design, hookify, feature-dev, claude-md-management, LSP plugins, mattpocock-skills, document-skills, context-mode, serena.

## 4. The remote catalog (openai-curated-remote)

`codex plugin list --available --json` (throwaway home with copied ChatGPT auth, 17.5 s, exit 0). Top-level `{installed:[...], available:[...]}`; every entry:

```json
{
  "pluginId": "remember@openai-curated-remote",
  "name": "remember",
  "marketplaceName": "openai-curated-remote",
  "version": "0.31.0",
  "installed": false,
  "enabled": false,
  "source": { "source": "remote", "id": "plugins_6aa5bad3c1f881918949b7ea822785b0" },
  "installPolicy": "AVAILABLE",          // AVAILABLE | INSTALLED_BY_DEFAULT | NOT_AVAILABLE
  "authPolicy": "ON_INSTALL"             // ON_INSTALL | ON_USE
}
```

Git-marketplace entries in the same list carry instead `"source": {"source":"local"|"git", "url": "<snapshot root>"}` plus `"marketplaceSource": {"sourceType":"git","source":"https://github.com/..."}`.

Remote id prefixes observed (n): `plugin_asdk_app_*` 3,276 (ChatGPT apps), `plugins_*` 609 (community-published plugins), `Plugin_*` 37 and `plugins~Plugin_*` 13 (OpenAI curated plugins incl. superpowers, codex-security, expo, cloudflare, sentry), `plugin_connector_1p_*` 17 and `plugin_connector_*` 16 (first/third-party connectors: gmail, github, figma, stripe, vercel...), `plugin_templated_apps_*` 12.

Richer per-plugin metadata (developer, description, skills count, apps, eligible plans, `bundle_download_url`) lives in `$CODEX_HOME/cache/remote_plugin_catalog/<hash>.json` (20 MB, `schema_version:1`, `fetched_at`). Parity-relevant rows there (VERIFICATION NOTE: the `authentication_policy` of codex-security in the REMOTE catalog is `ON_INSTALL`; the `ON_USE` value in the table of section 3 comes from the git `marketplace.json` and the two disagree):

| remote plugin | version | developer | discoverability | skills | apps | website |
|---|---|---|---|---|---|---|
| superpowers | 6.3.0 | Jesse Vincent | LISTED | 14 | 0 | github.com/obra/superpowers |
| codex-security | 0.1.24 | OpenAI | LISTED | 15 | 3 | openai.com |
| github | 0.1.12-5f7cd798dc99 | OpenAI | LISTED | 0 | 1 (connector) | github.com |
| compound-engineering | 3.24.0 | Kieran Klaassen and Trevin Chow | UNLISTED | 35 | 0 | github.com/EveryInc/compound-engineering-plugin |
| compound-writing | 2.4.1 | Every | UNLISTED | 33 | 0 | github.com/EveryInc/compound-writing |
| remember | 0.31.0 | Florian David | UNLISTED | 1 | 0 | github.com/Digital-Process-Tools/claude-remember (README of installed bundle: "Skills-only edition; the full hook-based automatic capture is available from the GitHub marketplace") |
| frontend-design-premium | 1.4.0 | TryHand Co., Ltd | UNLISTED | 2 | 0 | github.com/TryHand-Co-Ltd/frontend-design-premium (third party, not Anthropic's frontend-design) |
| session-exporter | 0.1.2 | Tor Production | UNLISTED | 1 | 0 | tor-production.github.io/session-exporter |

Searched and **absent** from the remote catalog: caveman, context7, playwright, hookify, skill-creator (only `plugin-creator-plus`), commit-commands, security-guidance, feature-dev, claude-md-management, any `*-lsp`, mattpocock, document skills, context-mode, serena, code-review, pr-review. Memory-adjacent alternatives that do exist: yaps-memory 0.2.14, talamus-memory 1.1.1, project-memory-core 1.1.0, tree-ring-memory 0.3.1.

## 5. Experiments: selectors x auth modes

| # | CODEX_HOME state | command | exit | result |
|---|---|---|---|---|
| a0 | fresh, no auth | `codex plugin marketplace list --json` | 0 | `{"marketplaces":[]}` (curated snapshot is NOT created by the CLI) |
| a0 | fresh, no auth | `codex plugin list --available --json` | 0 | `{"installed":[],"available":[]}` |
| a1 | ChatGPT auth | `codex plugin list --available --json` | 0 | installed 4 (superpowers, openai-templates, sites, plugin-management), available 3,980 |
| a1 | ChatGPT auth | `codex plugin add superpowers@openai-curated --json` | 1 | `Error: plugin superpowers was not found in marketplace openai-curated` (no snapshot in fresh home; would work in `~/.codex` where the snapshot exists) |
| a1 | ChatGPT auth | `codex plugin marketplace add openai/plugins --json` | 1 | `Error: marketplace openai-curated is reserved and cannot be added from this source` |
| a2 | ChatGPT auth | `codex plugin add remember@openai-curated-remote --json` | 0 | 8.9 s; JSON below; bundle at `plugins/cache/openai-curated-remote/remember/0.31.0`, sidecar `.codex-remote-plugin-install.json` `{"schema_version":1,"remote_plugin_id":"plugins_6aa5..."}`; config.toml untouched |
| a3 | ChatGPT auth | `codex plugin add superpowers@openai-curated-remote --json` (already installed on account) | 0 | idempotent, materializes 6.3.0 locally |
| a4 | ChatGPT auth | `codex plugin remove remember@openai-curated-remote --json` | 0 | `{"pluginId":"remember@openai-curated-remote","name":"remember","marketplaceName":"openai-curated-remote"}`; account state restored |
| b1 | `codex login --with-api-key` (dummy key) | `codex plugin list --available --json` | 0 | empty; `codex login status` = "Logged in using an API key" |
| b2 | API key | `codex plugin add superpowers@openai-curated --json` | 1 | not found (no snapshot) |
| b3 | API key | `codex plugin add remember@openai-curated-remote --json` | 1 | `Error: chatgpt authentication required for remote plugin catalog` |
| b4 | API key | `codex plugin add superpowers@openai-api-curated --json` | 1 | not found (no snapshot) |
| c1 | API key | `codex plugin marketplace add obra/superpowers --json` | 0 | `{"marketplaceName":"superpowers-dev","installedRoot":".../.tmp/marketplaces/superpowers-dev","alreadyAdded":false}` + `[marketplaces.superpowers-dev] source_type="git" source="https://github.com/obra/superpowers.git"` in config.toml |
| c2 | API key | `codex plugin add superpowers@superpowers-dev --json` | 0 | v6.3.0 -> `plugins/cache/superpowers-dev/superpowers/6.3.0`; config.toml gains `[plugins."superpowers@superpowers-dev"] enabled = true` |
| c3 | API key | `codex plugin marketplace upgrade --json` | 0 | `{"selectedMarketplaces":["superpowers-dev"],"upgradedRoots":[...],"errors":[]}` |
| d1 | API key | `codex plugin marketplace add JuliusBrussee/caveman --json` | 0 | marketplaceName `caveman` (Claude-format `.claude-plugin/marketplace.json` accepted) |
| d2 | API key | `codex plugin marketplace add anthropics/claude-plugins-official --json` | 0 | marketplaceName `claude-plugins-official`, **308 plugins** listed by `codex plugin list --available --json` |
| e | API key | `codex plugin add <p>@claude-plugins-official --json` for caveman@caveman, context7, playwright, commit-commands, security-guidance, frontend-design, hookify, typescript-lsp, feature-dev, claude-md-management, skill-creator, mattpocock-skills, serena, github, remember | 0 x15 | all installed; versions: caveman 2.7.0, security-guidance 2.0.8, typescript-lsp 1.0.0, claude-md-management 1.0.0, mattpocock-skills 1.2.3, remember 0.33.0, others `local` (no version in plugin.json) |
| e | API key | `codex mcp list --json` | 0 | shows plugin MCPs: context7 (streamable_http `https://mcp.context7.com/mcp?client=claude-code-plugin`), github (`https://api.githubcopilot.com/mcp/`), playwright (stdio `npx @playwright/mcp@latest`), serena (stdio `uvx --from git+https://github.com/oraios/serena serena start-mcp-server`) |
| f | API key | `codex plugin marketplace upgrade --json` (3 marketplaces) | 0 | 7.8 s; `upgradedRoots` = caveman, claude-plugins-official |
| f | API key | `codex plugin remove hookify@claude-plugins-official --json` | 0 | removes `[plugins."hookify@..."]` from config.toml and the cache dir |

`codex plugin add --json` output schema (both catalogs):
```json
{ "pluginId": "remember@openai-curated-remote", "name": "remember", "marketplaceName": "openai-curated-remote",
  "version": "0.31.0", "installedPath": "<CODEX_HOME>/plugins/cache/openai-curated-remote/remember/0.31.0", "authPolicy": "ON_INSTALL" }
```
`codex plugin marketplace list --json`: `{"marketplaces":[{"name","root","marketplaceSource"?:{"sourceType":"git","source":"<url>"}}]}` (the reserved `openai-curated` row has no `marketplaceSource`). Snapshot sidecar `.tmp/marketplaces/<name>/.codex-marketplace-install.json` = `{"source_type":"git","source":"<url>","ref_name":null,"sparse_paths":[],"revision":"<sha>"}`.

Note: `codex plugin install` does **not** exist in 0.154.0 (`unrecognized subcommand 'install'`); the claude-remember README's `codex plugin install remember` line is stale. Running any `codex` command with `CODEX_HOME` under `/tmp` prints `WARNING: ... Refusing to create helper binaries under temporary dir "/tmp"` (harmless).

## 6. Semantics from codex-rs source (tag rust-v0.154.0)

- `codex-rs/core-plugins/src/remote.rs`: `REMOTE_GLOBAL_MARKETPLACE_NAME = "openai-curated-remote"` (display "OpenAI Curated Remote"); other remote scopes `created-by-me-remote`, `workspace-directory`, `workspace-shared-with-me*`. Endpoints: `{base}/ps/plugins/list`, `/ps/plugins/installed`, `/ps/plugins/{id}/install`, `/ps/plugins/{id}/uninstall`, `/ps/plugins/suggested/codex`. `ensure_chatgpt_auth` -> `AuthRequired` / `UnsupportedAuthMode` unless `auth.uses_codex_backend()`.
- `codex-rs/core-plugins/src/lib.rs`: `OPENAI_CURATED_MARKETPLACE_NAME = "openai-curated"`, `OPENAI_API_CURATED_MARKETPLACE_NAME = "openai-api-curated"`, `OPENAI_BUNDLED_MARKETPLACE_NAME = "openai-bundled"`. `marketplace_policy.rs::is_reserved_marketplace_name` blocks adding these names.
- `codex-rs/cli/src/plugin_cmd.rs::run_plugin_add`: if selector marketplace == `openai-curated-remote` -> fetch remote catalog (cache first, force refetch if the name is missing), resolve `remote_plugin_id`, `install_remote_plugin`; else `find_marketplace_for_plugin(include_openai_curated=true)` over configured git/local roots plus the curated snapshot, then `install_plugin`. `fetch_remote_marketplaces` short-circuits with `chatgpt authentication required for remote plugin catalog` when auth is not ChatGPT, and when `features.remote_plugin` is off it falls back to `fetch_openai_curated_remote_collection_marketplace` (a smaller remote collection) with `uses_global_catalog=false`, in which case `plugin list` also includes the local curated snapshot.
- `codex-rs/core-plugins/src/manager.rs::maybe_start_curated_repo_sync_for_config`: git-sync of `https://github.com/openai/plugins.git` into `$CODEX_HOME/.tmp/plugins` (fetch ref `refs/codex/curated-sync`, sha file `.tmp/plugins.sha`, lock `.tmp/plugins.sync.lock`; fallbacks: GitHub HTTP API `api.github.com/repos/openai/plugins`, then `https://chatgpt.com/backend-api/plugins/export/curated`) runs **only if** `plugins_enabled && !(remote_plugin_enabled && ChatGPT auth)`. `target_curated_marketplace`: ChatGPT auth -> `.tmp/plugins` (name openai-curated); otherwise `.tmp/plugins/.agents/plugins/api_marketplace.json` (name openai-api-curated).
- `manager.rs::maybe_start_plugin_startup_tasks_for_config`: at session start also spawns `upgrade_configured_marketplaces_for_config_with_mode(PluginGitMode::Automatic)` (auto-upgrade of all configured git marketplaces + `refresh_non_curated_plugin_cache_force_reinstall_detailed` of installed plugins), then `maybe_start_remote_plugin_caches_refresh`, `maybe_start_remote_installed_plugin_bundle_sync`, and a forced remote catalog cache refresh.
- `codex-rs/core-plugins/src/remote/remote_installed_plugin_sync.rs::sync_remote_installed_plugin_bundles_once_with_snapshot`: `/installed` is "an authoritative full snapshot"; for each installed remote plugin, if `store.active_plugin_version == release.version` it only re-writes the id sidecar, otherwise it validates and downloads the bundle (`remote_bundle::validate_remote_plugin_bundle`) and materializes the new version; plugins no longer in the snapshot are removed from the local cache (`remove_stale_remote_plugin_caches`). => remote plugins auto-update on startup; no `remove`+`add` needed.
- `codex-rs/cli/src/marketplace_cmd.rs`: `upgrade` JSON = `{selectedMarketplaces, upgradedRoots, errors[{marketplaceName,message}]}`; text mode prints `No configured Git marketplaces to upgrade.` / `Marketplace X is already up to date.`; non-git marketplace name -> `marketplace X is not configured as a Git marketplace`.
- `codex-rs/core-plugins/src/marketplace.rs`: accepted marketplace manifests, in order: `.agents/plugins/marketplace.json`, `.agents/plugins/api_marketplace.json`, `.claude-plugin/marketplace.json`, `.cursor-plugin/marketplace.json`. `utils/plugins/src/plugin_namespace.rs::find_plugin_manifest_path`: `plugin.json` (Agent Plugins v1 schema) first, then the discoverable list (`.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json` per tests). `loader.rs`: defaults `hooks/hooks.json` and `.mcp.json`; manifest `hooks` may be a path, list, inline object or inline list; `commands/` are migrated to skills (`command_migration.rs`). The binary contains the `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA` variable names and Codex hook events `PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SessionStart, SessionEnd, UserPromptSubmit, SubagentStart, SubagentStop, Interrupt, Stop` (no `Notification`, `PostToolUseFailure`, `statusLine`).

Release rust-v0.154.0 notes (github.com/openai/codex/releases/tag/rust-v0.154.0, page shows "09 Sep"; binary mtime 2026-09-10): "Existing sessions pick up newly installed plugin tools and refresh skills and hooks after external plugin upgrades or rollbacks", "Reload user config after local plugin installation", "Refresh session hooks after external plugin updates".

## 7. Parity table: Claude must-have/recommended -> Codex

Legend for routes: **remote** = `codex plugin add <name>@openai-curated-remote` (ChatGPT auth only); **curated** = `<name>@openai-curated` / `@openai-api-curated` (needs the snapshot; unreliable, see 1.1); **git-mkt** = `codex plugin marketplace add <owner/repo>` then `codex plugin add <name>@<marketplace-name>` (works with API-key or ChatGPT auth); **skills** = `npx skills add ...` (Codex reads `$HOME/.agents/skills` natively per learn.chatgpt.com/docs/build-skills; the skills CLI's Codex global path is `~/.codex/skills/`); **MCP** = `codex mcp add ...`; **built-in** = ships with Codex.

| Claude item (installed version) | Best Codex route | Exact command(s) | Alt route | Fidelity / notes |
|---|---|---|---|---|
| superpowers 6.3.0 | remote (already installed on this account) | `codex plugin add superpowers@openai-curated-remote --json` | git-mkt: `codex plugin marketplace add obra/superpowers` + `codex plugin add superpowers@superpowers-dev`; curated: `codex plugin add superpowers@openai-curated` (needs snapshot); upstream README: `/plugins` -> search "superpowers" | Same 6.3.0 skills-only edition (`hooks: {}`); API-key hosts must use git-mkt |
| caveman (git 15581d1 / plugin.json 2.7.0) | git-mkt (verified) | `codex plugin marketplace add JuliusBrussee/caveman` + `codex plugin add caveman@caveman` | skills (README line 145): `npx skills add JuliusBrussee/caveman --skill '*' -a codex --yes -g`; INSTALL.md table row for Codex CLI: `npx skills add JuliusBrussee/caveman -a codex -g` ("Per-session: /caveman"); proxy: `npm install -g @caveman-ai/cli && caveman setup --install`, then `caveman claude        # or codex · gemini · ...` (README shows `caveman claude` with codex as a listed alternative; no literal `caveman codex` line). Repo also ships `.codex/hooks.json` (SessionStart echo of the caveman rules) + `.codex/config.toml` (`[features] hooks = true`) for repo-local Codex use; README: Codex skips the shrink hook (openai/codex#18491). npm @caveman-ai/cli latest 1.3.4 (2026-09-15) | Plugin brings SessionStart/UserPromptSubmit hooks using `${CLAUDE_PLUGIN_ROOT}` (Codex substitutes the var; runtime not verified here). The caveman-proxy/statusline are Claude-settings features; for Codex the `caveman codex` wrapper "uses env vars (API key) and an ephemeral CODEX_HOME". Not in either OpenAI catalog |
| security-guidance 2.0.8 | git-mkt (install verified) but effectively Claude-only | `codex plugin add security-guidance@claude-plugins-official` (after marketplace add) | remote (different product): `codex plugin add codex-security@openai-curated-remote` (OpenAI scanner, v0.1.24; remote catalog authPolicy ON_INSTALL, git manifest says ON_USE); built-in `/review` | CORRECTED: hooks are SessionStart / UserPromptSubmit / PostToolUse (matcher `Edit\|Write\|MultiEdit\|NotebookEdit`, Claude tool names) / Stop / SubagentStop, all python via `sg-python.sh`. SessionStart runs `ensure_agent_sdk.py` (installs `claude_agent_sdk`) and the Stop review in `hooks/llm.py` calls the Claude API (`ANTHROPIC_API_KEY` / Agent SDK). Under Codex the matcher never fires and the review needs Anthropic credentials -> skip for Codex |
| context7 | git-mkt (verified; MCP appears in `codex mcp list`) | `codex plugin add context7@claude-plugins-official` | MCP (context7.com/docs/resources/all-clients): `codex mcp add context7 -- npx -y @upstash/context7-mcp --api-key YOUR_API_KEY`; or `[mcp_servers.context7] command="npx" args=["-y","@upstash/context7-mcp","--api-key","YOUR_API_KEY"] startup_timeout_ms=20_000` | Plugin `.mcp.json` = HTTP `https://mcp.context7.com/mcp?client=claude-code-plugin` with header `Authorization: ${CONTEXT7_API_KEY:-}` (so the plugin route can carry a key via env var IF Codex expands the placeholder — unverified); the direct MCP route is the documented way to pass a key. npm `@upstash/context7-mcp` latest 4.1.1 (2026-09-17) |
| LSP plugins (typescript-lsp 1.0.0, pyright-lsp 1.0.0, gopls-lsp 1.0.0) | none (Codex has no LSP plugin surface) | git-mkt installs succeed (`typescript-lsp@claude-plugins-official` -> 1.0.0) but there is no consumer | - | `plugin.json` `lspServers` is a Claude-only key; skip for Codex |
| commit-commands | git-mkt (verified) | `codex plugin add commit-commands@claude-plugins-official` | none in OpenAI catalogs | `commands/*.md` are migrated to skills by Codex (`command_migration.rs`); Codex has no `/commit` slash-command surface, so they surface as skills |
| frontend-design | git-mkt (verified) | `codex plugin add frontend-design@claude-plugins-official` | skills: `npx skills add anthropics/skills --skill frontend-design -g` (894.1K installs on skills.sh, 2026-09-17); remote (third party, not equivalent): `codex plugin add frontend-design-premium@openai-curated-remote` (TryHand 1.4.0) | Skills-only, full fidelity |
| skill-creator | built-in | nothing to install: `~/.codex/skills/.system/skill-creator` (also `plugin-creator`, `skill-installer`, `review-agent`, `openai-docs`, `imagegen`) | git-mkt `skill-creator@claude-plugins-official` also installs; skills: `npx skills add anthropics/skills --skill skill-creator -g` | Prefer built-in; remote has only `plugin-creator-plus` |
| feature-dev | git-mkt (verified) | `codex plugin add feature-dev@claude-plugins-official` | none | Claude `agents/` + command; Codex loads skills/commands, agents support unverified. superpowers covers most of the workflow |
| claude-md-management 1.0.0 | git-mkt (verified) or none | `codex plugin add claude-md-management@claude-plugins-official` | none | Semantically Claude-specific (CLAUDE.md); Codex reads AGENTS.md. Mark optional/skip for Codex |
| hookify | none | (installs via git-mkt, removed again in test) | built-in Codex hooks: `~/.codex/hooks.json` with `[features] hooks=true` | hookify generates Claude `.claude/hookify.*.local.md` rules; no Codex consumer |
| playwright | git-mkt (verified; stdio MCP registered) | `codex plugin add playwright@claude-plugins-official` | MCP (microsoft/playwright-mcp README): `codex mcp add playwright npx "@playwright/mcp@latest"`; built-in `browser_use` / `computer_use` features | Equivalent |
| mattpocock-skills 1.2.3 | git-mkt (verified) | `codex plugin add mattpocock-skills@claude-plugins-official` | skills: `npx skills add mattpocock/skills -g` (53 skills, 22.9M installs on skills.sh 2026-09-17) | Skills-only, full fidelity either way |
| document-skills (anthropics/skills docx/pdf/pptx/xlsx) | skills | `npx skills add anthropics/skills --skill docx --skill pdf --skill pptx --skill xlsx -g` (skills.sh: pptx 222.2K, pdf 197.1K, docx 189.0K, xlsx 169.5K installs) | none in OpenAI catalogs | Same SKILL.md files |
| remember 0.32.0 (Claude) | git-mkt (verified, 0.33.0 with `hooks: ./hooks/hooks.codex.json`; README requirements: Python 3.9+, **Claude CLI with Haiku access** for the compression step, Bash 3.2+, jq) | `codex plugin add remember@claude-plugins-official` or per README `codex plugin marketplace add Digital-Process-Tools/claude-remember` + `codex plugin add remember@remember-dev` | remote: `codex plugin add remember@openai-curated-remote` (0.31.0, skills-only, no hooks) | README says the Codex path was "Observed working against codex-cli 0.150.1"; README's `codex plugin install` should be `codex plugin add` |
| context-mode | git-mkt (repo ships `.agents/plugins/marketplace.json` + `.codex-plugin/plugin.json` 1.0.169 with `mcpServers: ./.codex-plugin/mcp.json`, `hooks: ./.codex-plugin/hooks.json`, `skills: ./skills/`) | `codex plugin marketplace add mksglu/context-mode` + `codex plugin add context-mode@context-mode` (the README does NOT document this route; only the manual one) | README manual route (verbatim): `npm install -g context-mode`; config.toml `[features]\nhooks = true\n\n[mcp_servers.context-mode]\ncommand = "context-mode"\n\n[mcp_servers.context-mode.env]\nCONTEXT_MODE_PLATFORM = "codex"`; `$CODEX_HOME/hooks.json` with PreToolUse/PostToolUse/SessionStart/PreCompact/UserPromptSubmit/Stop entries (`context-mode hook codex <event>`); `CM_ROOT="$(npm root -g)/context-mode"` + `cp "$CM_ROOT/configs/codex/AGENTS.md" ./AGENTS.md` | Hooks are ON by default in Codex (docs: `[features] hooks = false` turns them off), so the README's `hooks = true` line is harmless but not required; npm latest 1.0.169 (last modified 2026-06-29); plugin route not runtime-tested |
| compound-engineering | remote (3.24.0) or git-mkt (3.26.3, newer) | `codex plugin add compound-engineering@openai-curated-remote` / `codex plugin marketplace add EveryInc/compound-engineering-plugin` + `codex plugin add compound-engineering@compound-engineering-plugin` | - | 35 skills; git route is newer |
| github | remote (connector) or git-mkt (MCP) | `codex plugin add github@openai-curated-remote` (OpenAI connector app, ON_INSTALL OAuth) / `codex plugin add github@claude-plugins-official` (registers `https://api.githubcopilot.com/mcp/`) | MCP: `codex mcp add github --url https://api.githubcopilot.com/mcp/` ; or just `gh` CLI | Remote version needs ChatGPT app auth; the Claude-marketplace plugin's `.mcp.json` sends `Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}` (PAT env var, placeholder expansion under Codex unverified). openai/plugins git edition is 0.1.11 (`apps: ./.app.json`, no skills/mcp) |
| serena | git-mkt (verified; registers `uvx --from git+https://github.com/oraios/serena serena start-mcp-server`) | `codex plugin add serena@claude-plugins-official` | Official (oraios.github.io/serena clients page): `uv tool install -p 3.13 serena-agent` then `serena setup codex`, or `[mcp_servers.serena] startup_timeout_sec=15 command="serena" args=["start-mcp-server","--project-from-cwd","--context=codex"]`; Claude: `claude mcp add --scope user serena -- serena start-mcp-server --context claude-code --project-from-cwd` | Plugin route lacks `--context codex`; prefer `serena setup codex` (needs `uv`, missing on this host). Serena README explicitly warns against outdated install commands from plugin marketplaces. Serena docs still say `codex_hooks = true` for hooks; Codex docs: `hooks` is canonical, `codex_hooks` a deprecated alias, and hooks are on by default |
| code-review / pr-review-toolkit / code-simplifier / plugin-dev / ralph-loop / claude-code-setup (installed extras) | git-mkt possible (all present in the 308 list) or built-in | `codex plugin add code-review@claude-plugins-official` etc.; built-in `/review` + `.system/review-agent`, `.system/plugin-creator` | - | Agent-heavy plugins (`agents/`) have unverified Codex support |

## 8. Recommended installer strategy for Codex parity

1. Detect auth: `codex login status` -> "Logged in using ChatGPT" vs "Logged in using an API key". Remote selectors only for ChatGPT; git-mkt for everyone.
2. Always add the git marketplaces declaratively (they persist in `config.toml`): `codex plugin marketplace add anthropics/claude-plugins-official`, `codex plugin marketplace add JuliusBrussee/caveman`, plus per-choice `obra/superpowers`, `Digital-Process-Tools/claude-remember`, `mksglu/context-mode`, `EveryInc/compound-engineering-plugin`. Then `codex plugin add <name>@<mkt> --json` for each selection (idempotent: re-adding an installed plugin returns exit 0).
3. For ChatGPT users additionally offer `superpowers@openai-curated-remote`, `compound-engineering@openai-curated-remote`, `codex-security@openai-curated-remote`, `github@openai-curated-remote`; never touch `openai-templates`, `sites`, `plugin-management` (INSTALLED_BY_DEFAULT), and do not rely on `@openai-curated` (snapshot may be absent or stale; reserved name cannot be re-added).
4. Skills that are not plugins (document-skills, mattpocock, caveman skills): `npx skills add <owner/repo> [--skill X] -g -y` (Codex scans `~/.agents/skills`; skills CLI also symlinks to `~/.codex/skills/`).
5. MCP-only items: `codex mcp add context7 -- npx -y @upstash/context7-mcp --api-key KEY`, `codex mcp add playwright npx "@playwright/mcp@latest"`, `serena setup codex`.
6. Update: `codex plugin marketplace upgrade --json` (git marketplaces + reinstall of their plugins; also runs automatically at session start), `npx skills update -g -y`, `codex update` for the binary; remote plugins need nothing (startup reconcile from `/ps/plugins/installed`). Uninstall: `codex plugin remove <name>@<mkt> --json`, `codex plugin marketplace remove <name>`.
7. Codex hook events available for parity of hook-based plugins: PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SessionStart, SessionEnd, UserPromptSubmit, SubagentStart, SubagentStop, Interrupt, Stop. No statusLine, Notification or PostToolUseFailure.

## 9. Open questions

- Runtime behaviour of Claude-format hooks (`${CLAUDE_PLUGIN_ROOT}` substitution, python hooks of security-guidance, caveman activate hooks) inside a Codex session was not executed (would require running a session). Binary strings confirm the variable names are handled.
- Whether Codex loads Claude `agents/*.md` from plugins (feature-dev, pr-review-toolkit) is unverified.
- Why `superpowers@openai-curated-remote` and `sites` are installed on the account but not materialized in `~/.codex/plugins/cache`; expected to self-heal on next TUI start.
- `features.remote_plugin` can be disabled (`--disable remote_plugin`), which makes Codex fall back to the smaller "curated remote collection" plus the local `openai-curated` snapshot; not tested.
- The Claude plugin `frontend-design` is in `anthropics/skills` on skills.sh, but the Claude marketplace copy has no version (shows `local` in Codex).

## 10. Sources

- Local: `codex --version`, `codex plugin ... --help`, `codex mcp add --help`, `codex features list`, `~/.codex/config.toml`, `~/.codex/.tmp/plugins` (git log/remote), `~/.codex/plugins/cache`, `~/.codex/skills/.system`, `~/.agents/skills`, `~/.claude/skills`; throwaway runs recorded in `/tmp/claude-1000/-temp-super-agent-installer/1737cab9-8dc4-4253-8b76-8c91a0a13e9f/scratchpad/gap1/*.out|*.err|avail_chatgpt.json|mkt_main.json|api_mkt_main.json`.
- https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json (65 plugins) and `.../api_marketplace.json` (49)
- https://raw.githubusercontent.com/openai/plugins/main/plugins/{superpowers,codex-security,github}/.codex-plugin/plugin.json
- https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/core-plugins/src/{manager.rs,remote.rs,remote_mutations.rs,startup_sync.rs,marketplace.rs,marketplace_policy.rs,marketplace_add.rs,manifest.rs,loader.rs,lib.rs,remote/remote_installed_plugin_sync.rs,marketplace_upgrade/activation.rs}; `codex-rs/cli/src/{plugin_cmd.rs,marketplace_cmd.rs}`; `codex-rs/utils/plugins/src/plugin_namespace.rs`
- https://github.com/openai/codex/releases/tag/rust-v0.154.0
- https://github.com/openai/plugins (6.9k stars, 2026-09-17); https://github.com/anthropics/claude-plugins-official (36.4k stars, 2026-09-17)
- https://learn.chatgpt.com/docs/plugins (redirect target of developers.openai.com/codex/plugins); https://learn.chatgpt.com/docs/build-skills (skill dirs: `$CWD/.agents/skills`, `$REPO_ROOT/.agents/skills`, `$HOME/.agents/skills`, `/etc/codex/skills`, system)
- https://raw.githubusercontent.com/obra/superpowers/main/README.md and `.agents/plugins/marketplace.json` (name superpowers-dev), `.codex-plugin/plugin.json` (6.3.0)
- https://raw.githubusercontent.com/JuliusBrussee/caveman/main/README.md (Codex: `npx skills add JuliusBrussee/caveman --skill '*' -a codex --yes -g`; `caveman codex`)
- https://raw.githubusercontent.com/Digital-Process-Tools/claude-remember/main/README.md and `.agents/plugins/marketplace.json` (remember-dev), `.codex-plugin/plugin.json` (0.33.0, hooks.codex.json)
- https://raw.githubusercontent.com/mksglu/context-mode/main/README.md and `.agents/plugins/marketplace.json` (context-mode), `.codex-plugin/plugin.json` (1.0.169)
- https://raw.githubusercontent.com/EveryInc/compound-engineering-plugin/main/.agents/plugins/marketplace.json (compound-engineering-plugin), `.codex-plugin/plugin.json` (3.26.3)
- https://raw.githubusercontent.com/vercel-labs/skills/main/README.md (agents table: Codex -> `.agents/skills/` / `~/.codex/skills/`; `npx skills update`)
- https://skills.sh/anthropics/skills ; https://skills.sh/mattpocock/skills (install counts, 2026-09-17)
- https://oraios.github.io/serena/02-usage/030_clients.html ; https://raw.githubusercontent.com/oraios/serena/main/README.md (`uv tool install -p 3.13 serena-agent`)
- https://context7.com/docs/resources/all-clients ; https://raw.githubusercontent.com/upstash/context7/master/README.md
- https://raw.githubusercontent.com/microsoft/playwright-mcp/main/README.md (`codex mcp add playwright npx "@playwright/mcp@latest"`)

## Verification (skeptical fact-check, 2026-09-17)

Method: every source re-fetched (raw.githubusercontent.com manifests/READMEs/codex-rs source at tag `rust-v0.154.0`, learn.chatgpt.com docs, npm registry, GitHub HTML pages); sha256 of the researcher's downloaded `gap1/src/*.rs` compared with the tag (all identical); the recorded experiment outputs in `scratchpad/gap1/*.out|*.err|avail_chatgpt.json` and the materialized plugin caches in `gap1/home_apikey` / `gap1/home_chatgpt` were re-read. `api.github.com` was rate-limited and `gh` has an invalid token, so star counts remain HTML-page numbers (medium confidence). No mutating command was run; the only new `codex` invocations were `--help`, `--version`, `features list`, `login status`, `plugin marketplace list --json` and one refused `plugin marketplace upgrade openai-curated` (error, no change).

### Confirmed as stated
- Three catalogs and the selector logic (`plugin_cmd.rs`: `selection.marketplace_name == REMOTE_GLOBAL_MARKETPLACE_NAME` -> `install_remote_plugin`, else `find_marketplace_for_plugin` with `include_openai_curated=true`; `run_plugin_list` uses `!remote_listing.uses_global_catalog`). Error string `chatgpt authentication required for remote plugin catalog` confirmed.
- Reserved names (`lib.rs` 41-45: openai-curated, openai-api-curated, openai-bundled, openai-bundled-alpha, openai-primary-runtime; `marketplace_policy.rs::is_reserved_marketplace_name` also blocks every `RemotePluginScope` name incl. openai-curated-remote). Error `marketplace `X` is reserved and cannot be added from this source` confirmed.
- Curated sync gating: `manager.rs:705` `remote_global_catalog_active = remote_plugin_enabled && auth uses codex backend`; `:710` sync only if `plugins_enabled && !remote_global_catalog_active && git policy ok`. `startup_sync.rs`: `https://github.com/openai/plugins.git`, `.tmp/plugins`, `.tmp/plugins.sha`, `refs/codex/curated-sync`, lock `.tmp/plugins.sync.lock`, fallbacks `https://api.github.com` and `https://chatgpt.com/backend-api/plugins/export/curated`. Local sha `1e285826` (2026-08-28) vs upstream HEAD `1dc19589` re-confirmed via `git ls-remote`.
- Startup tasks: `manager.rs:2752 maybe_start_plugin_startup_tasks_for_config` spawns thread `plugins-marketplace-auto-upgrade` calling `upgrade_configured_marketplaces_for_config_with_mode(..., PluginGitMode::Automatic, ...)`; `:2894-2940` that function calls `refresh_non_curated_plugin_cache_force_reinstall_detailed` for configured plugins when `upgraded_roots` is non-empty. `marketplace_cmd.rs` JSON `{selectedMarketplaces, upgradedRoots, errors[{marketplaceName,message}]}` and messages `No configured Git marketplaces to upgrade.` / `is already up to date.` confirmed.
- Remote reconcile: `remote/remote_installed_plugin_sync.rs` line ~180 comment "'/installed' is an authoritative full snapshot", version compare `store.active_plugin_version(&plugin_id) == release.version`, `remove_stale_remote_plugin_caches` at ~356.
- Manifest lists: `marketplace.rs:20-24` `.agents/plugins/marketplace.json`, `.agents/plugins/api_marketplace.json`, `.claude-plugin/marketplace.json`, `.cursor-plugin/marketplace.json`; `plugin_namespace.rs` `plugin.json` first, `.claude-plugin/plugin.json` / `.cursor-plugin/plugin.json` alternates, `.codex-plugin/plugin.json` legacy/fallback; `loader.rs:69-70` `hooks/hooks.json`, `.mcp.json`.
- openai/plugins: 65 plugins (`openai-curated`), api manifest 49 (`openai-api-curated`) — re-listed one by one. anthropics/claude-plugins-official `.claude-plugin/marketplace.json` = 308 entries (re-downloaded, `jq length`).
- Remote catalog numbers: 3,980 available (AVAILABLE 3,962 / INSTALLED_BY_DEFAULT 1 = task-tool / NOT_AVAILABLE 17), id prefixes 3,276 `plugin_asdk_app`, 609 `plugins`, 37 `Plugin`, 13 `plugins~Plugin`, 17 `plugin_connector_1p`, 16 `plugin_connector`, 12 `plugin_templated_apps`; absent names re-grepped (only codex-security, compound-engineering, frontend-design-premium, github, plugin-creator-plus, remember, session-exporter, task-tool matched). Installed on account: superpowers 6.3.0, openai-templates 0.1.1, sites 0.1.65, plugin-management 0.1.0.
- All 15 `codex plugin add ...@claude-plugins-official|caveman` outputs re-read: exit 0 with the stated versions; `config.toml` of the throwaway home holds `[marketplaces.*] source_type="git"` and `[plugins."x@y"] enabled=true`; sidecar `.codex-marketplace-install.json` revision `ea0a38e1...`.
- JSON shapes for add/remove/list/marketplace add/list; `codex plugin install` does not exist (subcommands: add, list, marketplace, remove); `codex plugin marketplace add <SOURCE>` accepts `a local path, owner/repo[@ref], HTTPS Git URL, or SSH Git URL`, flags `--ref`, `--sparse` (repeatable), `--json`.
- Codex hook events (docs learn.chatgpt.com/docs/hooks): SessionStart, SessionEnd, SubagentStart, SubagentStop, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, Stop, Interrupt — matches the list in section 6.
- Third-party manifests: obra/superpowers `superpowers-dev` / 6.3.0 `hooks: {}`; JuliusBrussee/caveman `.claude-plugin/plugin.json` 2.7.0 with SessionStart+UserPromptSubmit `${CLAUDE_PLUGIN_ROOT}` hooks; claude-remember `remember-dev` / 0.33.0 `hooks: ./hooks/hooks.codex.json`; mksglu/context-mode `context-mode` / 1.0.169; EveryInc `compound-engineering-plugin` / 3.26.3; README lines for remember (`codex plugin install remember`, "Observed working against codex-cli 0.150.1"), compound-engineering (`codex plugin marketplace add EveryInc/compound-engineering-plugin` + `codex plugin add compound-engineering@compound-engineering-plugin`), context7 (`codex mcp add context7 -- npx -y @upstash/context7-mcp --api-key YOUR_API_KEY`, `startup_timeout_ms = 20_000`), playwright (`codex mcp add playwright npx "@playwright/mcp@latest"`), serena (`serena setup codex`, `[mcp_servers.serena] startup_timeout_sec = 15 ... "--context=codex"`, `uv tool install -p 3.13 serena-agent`), vercel-labs/skills (Codex row `codex` / `.agents/skills/` / `~/.codex/skills/`; `npx skills update [-g|-p|-y]`; `-a`, `-s/--skill`, `-y`, `--all`).
- skills.sh counts re-read (frontend-design 894.2K now vs 894.1K, docx 189.1K vs 189.0K — within drift; mattpocock 53 skills / 22.9M). GitHub HTML: openai/plugins 6.9k/897, claude-plugins-official 36.4k/4.1k.
- rust-v0.154.0 release page: "September 9"; bullets "Existing sessions pick up newly installed plugin tools and refresh skills and hooks after external plugin upgrades or rollbacks", "Reload user config after local plugin installation", "Refresh session hooks after external plugin updates" confirmed.

### Corrections made
1. **`Only configured Git marketplaces can be upgraded`** is not a string in 0.154.0. Naming the reserved snapshot gives `Error: marketplace `openai-curated` is not configured as a Git marketplace` (manager.rs:2912; reproduced). Body edited.
2. **LISTED count** 3,376 -> **3,375** (3,375 + 605 = 3,980).
3. **codex-security authPolicy**: the remote catalog entry is `ON_INSTALL` (both `avail_chatgpt.json` and the catalog cache `authentication_policy`); `ON_USE` is only in the git `marketplace.json`. Summary/items corrected.
4. **security-guidance hooks** are SessionStart / UserPromptSubmit / PostToolUse(matcher `Edit|Write|MultiEdit|NotebookEdit`) / Stop / SubagentStop, not "PreToolUse"; the Stop review (`hooks/llm.py`) calls the Claude API / `claude_agent_sdk`, and `ensure_agent_sdk.py` pip-installs the SDK at SessionStart. Verdict for Codex downgraded to **skip** (install works, value does not transfer).
5. **Hooks feature flag**: Codex docs say hooks are enabled by default (`[features] hooks = false` disables; `codex_hooks` is a deprecated alias). Claims "needs `[features] hooks=true`" (context-mode, serena `codex_hooks=true`) reworded as "harmless but not required".
6. **context-mode manual route** was incomplete: README also sets `[mcp_servers.context-mode.env] CONTEXT_MODE_PLATFORM = "codex"` and uses `CM_ROOT="$(npm root -g)/context-mode"` before `cp`. Fixed verbatim. The README does not document the `codex plugin marketplace add mksglu/context-mode` route (it exists only via the shipped manifests).
7. **caveman**: README has no literal `caveman codex` line; it shows `caveman claude        # or codex · gemini · ...`. INSTALL.md's Codex row is `npx skills add JuliusBrussee/caveman -a codex -g` (README line 145 has the `--skill '*' ... --yes` variant). Added: repo ships `.codex/hooks.json` + `.codex/config.toml`; README says Codex skips the shrink hook (openai/codex#18491). Claude command is `claude plugin marketplace add JuliusBrussee/caveman && claude plugin install caveman@caveman` (CLI form, confirmed).
8. **context7 plugin route** does carry a key: `.mcp.json` header `Authorization: ${CONTEXT7_API_KEY:-}`; whether Codex expands `${VAR:-}` in plugin `.mcp.json` headers is unverified (moved to open questions).
9. **github plugin (Claude marketplace)** uses `Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}` (PAT), not "Copilot MCP OAuth". openai/plugins git edition is 0.1.11 with `apps: ./.app.json` only.
10. **Digital-Process-Tools/claude-marketplace** default branch is `master` (main 404); manifest name `dpt-plugins`, remember source `github:Digital-Process-Tools/claude-remember` — Claude install line confirmed. README requirements for remember: Python 3.9+, Claude CLI with Haiku access (compression), Bash 3.2+, jq.
11. **openai/plugins `github` plugin URL** `https://github.com/openai/plugins/tree/main/plugins/github` exists (raw plugin.json 200).
12. **`codex plugin marketplace upgrade`** does not "force-reinstall" unconditionally: only when `upgraded_roots` is non-empty (i.e. the remote revision changed); otherwise `is already up to date`. Wording tightened.

### Facts added by the checker
- **Codex 0.154.0 has a built-in Claude Code import**: TUI slash command `/import` = "import setup, this project, and recent chats from Claude Code" (`tui/src/slash_command.rs:112`), backed by crate `codex-rs/external-agent-migration` (`source_cla.rs`: reads `~/.claude/plugins/known_marketplaces.json`, `settings.json` `enabledPlugins` / `extraKnownMarketplaces`, maps `claude-plugins-official` -> `anthropics/claude-plugins-official` and `claude-code-plugins` -> `anthropics/claude-code`; `service.rs` item types Config, Skills, AgentsMd, Plugins, McpServerConfig, Hooks, Memory, Sessions; `hooks_cla.rs` rewrites Claude hooks into Codex `HOOK_EVENT_NAMES`). App-server methods `externalAgentConfig/detect` and `externalAgentConfig/import` exist in the binary. Feature flags: `external_migration` = removed (i.e. graduated), `external_agent_memory_import` = under development/false. There is **no `codex` CLI subcommand** for it (top-level commands: agents, exec, review, login, logout, mcp, plugin, app-server, remote-control, completion, update, doctor, sandbox, debug, apply, resume, queue, archive, delete, migrate-rollouts, unarchive, fork, cloud, exec-server, features), so it is interactive-only unless driven through the app-server JSON-RPC.
- `codex mcp add` grammar: `codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)` with `--env KEY=VALUE`, `--bearer-token-env-var`, `--oauth-client-id`, `--oauth-client-registration <AUTO|CIMD|DCR>`.
- `codex plugin list` flags: `-m/--marketplace`, `--json`, `--available` ("Include uninstalled marketplace plugins in the JSON output").
- Config reference (learn.chatgpt.com/docs/config-file/config-reference): `marketplaces.<name>.source_type = git|local`, `.source`, `.ref`, `.sparse_paths`; `plugins.<plugin>.enabled` keyed `plugin-name@marketplace-name`; `plugins.<plugin>.mcp_servers.<server>.{enabled,enabled_tools,disabled_tools,approval_mode}`; `features.remote_plugin` and `features.hooks` both stable, default on.
- Docs (learn.chatgpt.com/docs/plugins): API-key users "can browse, install, and manage supported OpenAI-curated plugins"; some plugins unavailable with API key because their OAuth flows are unsupported; enterprise page: workspace-imported GitHub marketplaces sync daily.
- npm latest (2026-09-17): `@caveman-ai/cli` 1.3.4 (node >=22.13; host has 1.3.3), `context-mode` 1.0.169 (node >=22.5.0), `@upstash/context7-mcp` 4.1.1 (node >=20.18.1), `@playwright/mcp` 0.0.81 (node >=18), `skills` 1.6.0 (node >=22.20.0), `@openai/codex` 0.154.0.
- GitHub HTML stars 2026-09-17: obra/superpowers 287.7k / 25.7k forks; JuliusBrussee/caveman 106.1k / 6.1k; mksglu/context-mode 23.3k / 1.7k; EveryInc/compound-engineering-plugin 25.1k / 2.1k; Digital-Process-Tools/claude-remember 172 / 54; upstash/context7 62.1k / 3.0k; microsoft/playwright-mcp 37.2k / 3.2k; oraios/serena 29.5k / 2.0k.
- security-guidance marketplace.json entry says version 2.0.7 while its plugin.json says 2.0.8 (Codex reports 2.0.8).
- The remote `superpowers` bundle (home_chatgpt cache) is `{"name":"superpowers","version":"6.3.0","hooks":{},"skills":"./skills/"}` — identical to the git edition.

### Removed
- Nothing removed: every URL resolved (Digital-Process-Tools/claude-marketplace only on branch `master`).
