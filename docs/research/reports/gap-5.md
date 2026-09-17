# GAP-FILL 5: Cross-platform config-file write strategy (Codex `config.toml`, Claude `settings.json`, `~/.claude.json`)

Research date: 2026-09-17. Host: Ubuntu 26.04.1, Codex CLI 0.154.0, Claude Code 2.1.273, jq 1.8.1, python3 3.14.4, node 22.22.1, no yq/uv/pwsh installed. All tests ran on **copies** of this host's real `~/.codex/config.toml` and `~/.claude/settings.json` under a scratch `CODEX_HOME`; nothing in `$HOME` was touched. Tested scripts live in `gap-5-scripts/` next to this file.

## TL;DR (recommended strategy)

| File | Linux/macOS | Windows | Never do |
|---|---|---|---|
| `~/.codex/config.toml` — `mcp_servers.*` | `codex mcp add NAME -- cmd args` / `codex mcp add NAME --url URL [--bearer-token-env-var X]` (wrap in `timeout 15 … </dev/null`; see OAuth note) | same (`codex.exe`) | put `[mcp_servers.*]` in a marker block (Codex regroups them out of it — tested) |
| `~/.codex/config.toml` — `features.*` | `codex features enable|disable NAME` | same | own `[features]` in a marker block (Codex writes into it — tested) |
| `~/.codex/config.toml` — `plugins`, marketplaces | `codex plugin marketplace add <path|owner/repo[@ref]|git-url>`, `codex plugin add NAME@MARKET`, `codex plugin remove NAME@MARKET` (remove requires `@MARKETPLACE` or `-m`) | same | hand-write |
| `~/.codex/config.toml` — root keys (`model`, `model_reasoning_effort`, `notify`, `cli_auth_credentials_store`), `[tui]`, `[memories]`, `[windows]`, `[projects."…"]`, `[[skills.config]]` | **Preferred:** `yq -i -p toml -o toml '<expr>' file` (single static binary, comment/order preserving, tested v4.53.6). **Zero-dep fallback:** marker block `# >>> ID:root … # <<< ID:root` at top + `# >>> ID:tables … # <<< ID:tables` at bottom (bash+awk, tested) | `yq.exe` via `winget install --id MikeFarah.yq`, or the PowerShell marker port (`Set-TomlMarkerBlock.ps1`, tested on pwsh 7.6.6, 5.1-safe syntax) | naive `>>` append of root keys (silently lands inside the last table — tested); duplicate table headers (hard error — tested) |
| `~/.codex/hooks.json` | JSON; reuse the same hook-aware merge as settings.json | same | — |
| `~/.claude/settings.json` | `jq --argjson add … -f merge-settings.jq` (tested, idempotent, hook-dedupe by identity + optional family supersede) | `Merge-ClaudeSettings.ps1` (PS 5.1-compatible syntax; semantically identical output to the jq recipe, verified) | `jq -s '.[0] * .[1]'` (replaces hook arrays) |
| `~/.claude.json` | **Never hand-edit.** `claude mcp add -s user …`, `claude mcp add-json -s user NAME '{json}'`, `claude mcp remove -s user`. Auto-update control goes in settings.json `env.DISABLE_AUTOUPDATER="1"` / `autoUpdatesChannel`, not here | same | write while `claude` is running (file is rewritten about once a minute — observed via `~/.claude/backups/` timestamps) |
| plugins/marketplaces (Claude) | `claude plugin marketplace add <src> --scope user`, `claude plugin install NAME@MARKET -s user -y` (writes `enabledPlugins`/`extraKnownMarketplaces` itself) | same | hand-editing `~/.claude/plugins/*.json` |

Universal write rules (all files, all platforms): read → merge in memory → validate the result with a real parser → back up the original (`<file>.bak-YYYYmmdd-HHMMSS`, keep N) → write to a temp file **in the same directory** → rename over the original → preserve mode (`config.toml` is 0600 on this host, Codex itself writes 0600) → re-validate with the consumer (`codex mcp list` rc, `claude doctor`).

---

## 1. What Codex 0.154.0 actually does (all tested on scratch `CODEX_HOME`)

`codex --help` (0.154.0) has **no `codex config` subcommand**. Writers that exist: `codex mcp add|remove|login|logout`, `codex features enable|disable`, `codex plugin add|remove` (both take `PLUGIN@MARKETPLACE` or `PLUGIN -m MARKETPLACE`), `codex plugin marketplace add|remove|upgrade`. `codex mcp add` also carries `--oauth-client-id`, `--oauth-client-registration <auto|cimd|dcr>` and `--oauth-resource` (0.154.0 `--help`). `-c key=value` / `--enable` / `--disable` are session-only overrides, not persisted. Release page for 0.155.0-alpha.15 / alpha.16 (both 2026-09-17) could not be fetched (GitHub error pages / 404 on the tag URL); the repo `CHANGELOG.md` is a stub pointing at the releases page, so **no evidence of a `codex config` subcommand in 0.155 either** (open question).

### 1.1 Parser behaviour

| Test | Result |
|---|---|
| Duplicate table header `[mcp_servers.x]` twice | `Error: failed to load bootstrap configuration … config.toml:18:14: duplicate key` (rc=1 from `codex mcp list`) |
| Duplicate root key `model` twice | same hard error |
| Root key appended **after** tables (`printf '\nmodel_reasoning_effort = "xhigh"' >> config.toml`) | **No error** — key silently becomes `notice.model_reasoning_effort` (confirmed with tomllib). This is the classic "append" corruption. |
| Unknown key `bogus_key = 1` | accepted silently (`codex mcp list` rc=0). `--strict-config` is rejected for `mcp`/`features` subcommands ("not supported"), so it cannot be used as a validator there. |
| `codex doctor --summary` | prints `[ok] config loaded` vs `[XX] config could not be loaded`; exits 1 anyway when not logged in, so grep the line rather than trusting rc. **Better (verified):** `codex doctor --json \| jq -r '.checks[] \| select(.id=="config.load") \| .status'` prints `ok` / `fail` (rc is 1 in both cases here). |
| `codex mcp list` | rc=1 on parse error, rc=0 otherwise, no network, ~0.1 s → **cheapest validator**. |

### 1.2 Writer behaviour (`codex mcp add`, `codex features enable`)

Input (copy of this host's config with comments/inline tables added):

```toml
# top comment
model = "gpt-5.6-sol" # inline comment
model_reasoning_effort = "low"
# projects section
[projects."/home/alexf/code/ai-job-search"]
trust_level = "trusted"
[projects."/home/alexf"]
trust_level = "trusted"
[tui.model_availability_nux]
gpt-6-astra = 4
[notice]
hide_rate_limit_model_nudge = true
# my existing mcp server
[mcp_servers.existing]
command = "foo"
args = ["--x", "1"]
env = { A = "b" }
enabled = true
```

After `codex mcp add ctx7 --url https://mcp.context7.com/mcp`:

* `# top comment`, the inline comment, `# projects section`, quoted `[projects."/abs"]` headers: **preserved** (toml_edit-style document editing).
* Inside `mcp_servers`: `# my existing mcp server` **dropped**, `env = { A = "b" }` **expanded** to `[mcp_servers.existing.env]`, `enabled = true` **dropped** (default elided), `startup_timeout_sec = 30` → `30.0` (float). `enabled = false` (non-default) is kept. This reproduces open issue **openai/codex#45432** ("`codex mcp add / mcp remove` rewrite every `[mcp_servers.*]` entry, silently dropping comments and unknown keys", opened 2026-09-14, open, no maintainer response at fetch time).
* Re-adding an existing name **overwrites** (upsert). `codex mcp remove NAME` deletes only that table.
* `--url` servers: "Added global MCP server" is written **before** OAuth starts; with an OAuth-capable server the command then **blocks** on the browser flow (even with `</dev/null`, killed by `timeout 20`; config was intact). With `--bearer-token-env-var X` no OAuth is attempted and it exits immediately. Installer rule: `timeout 15 codex mcp add NAME --url … </dev/null || true`, then verify with `codex mcp get NAME --json`; run `codex mcp login NAME` as a separate, interactive step.
* `--env KEY=VAL` on stdio servers becomes `[mcp_servers.NAME.env]` sub-table.

After `codex features enable memories`: appends

```toml
[features]
memories = true
```

at the end; on subsequent calls it edits the existing `[features]` table in place (`fast_mode = true`, then `disable` writes `fast_mode = false` rather than deleting). Unknown feature → `Error: Unknown feature flag: not_a_feature`.

### 1.3 Marker blocks vs Codex writers — the decisive test

Installer wrote a tables block containing `[features]`, `[mcp_servers.context7]`, `[mcp_servers.caveman]`. Then `codex mcp add usertool -- /usr/bin/true` and `codex features enable fast_mode`. Result:

```toml
[mcp_servers.existing]          # regrouped
…
[mcp_servers.context7]          # <- pulled OUT of the marker block
url = "https://mcp.context7.com/mcp"
[mcp_servers.caveman]
command = "/home/alexf/.caveman/bin/caveman-mcp"
[mcp_servers.usertool]
command = "/usr/bin/true"

# >>> agentkit:tables
[features]
memories = true
fast_mode = true                # <- Codex wrote INTO the installer's block
# <<< agentkit:tables
```

On the next installer run the collision guard refused (`[mcp_servers.context7] already exists outside the agentkit block`). Conclusion: **never own `mcp_servers.*` or `features.*` with markers; delegate those to the CLI.** Marker/yq is only for keys Codex has no CLI writer for.

### 1.4 Config layering facts (docs)

* Precedence (high → low): CLI flags/`-c` → project `.codex/config.toml` (trusted projects only, closest wins) → profile file `$CODEX_HOME/<name>.config.toml` (via `--profile`; since 0.134.0 `[profiles.<name>]` tables in config.toml are **no longer read**) → `~/.codex/config.toml` → cloud-managed → `/etc/codex/config.toml` → defaults. `requirements.toml` = admin constraints. `CODEX_HOME` relocates everything (used for all tests here). Source: learn.chatgpt.com/docs/config-file/config-basic, config-advanced, config-reference.
* Hooks: `~/.codex/hooks.json` or inline `[[hooks.PreToolUse]]` tables in config.toml; project hooks only when trusted. Caveman writes `~/.codex/hooks.json` (same shape as Claude's `hooks` object, events include `PermissionRequest`, `PostCompact`).
* Keys the installer cares about and their writer:

| Key | Type (docs) | CLI writer | Installer path |
|---|---|---|---|
| `model` | string | none (TUI `/model` writes it) | yq / marker root block; **only set if absent or user explicitly chose** (Codex's own TUI writes here; installer must not clobber on rerun) |
| `model_reasoning_effort` | `minimal|low|medium|high|xhigh` | none | same |
| `projects."<abs>".trust_level` | `"trusted"|"untrusted"` | none (trust prompt writes it) | yq `.projects["/abs"].trust_level = "trusted"`; marker cannot express per-path merges cleanly → yq |
| `features.<name>` | bool | `codex features enable|disable` | CLI |
| `mcp_servers.<name>` (`command`,`args`,`env`,`url`,`bearer_token_env_var`,`http_headers`,`enabled`,`startup_timeout_sec`,`tool_timeout_sec`,`enabled_tools`,`disabled_tools`) | table | `codex mcp add/remove` | CLI (accept #45432 comment loss inside `mcp_servers`) |
| `notify` | `["cmd", "arg"]` | none | yq / marker root |
| `tui.notifications`, `tui.theme`, `tui.status_line`, `tui.keymap.*` | table | none | yq (`[tui]` may already exist — e.g. `[tui.model_availability_nux]` on this host — so marker would collide) |
| `hooks` | `[[hooks.<Event>]]` or `~/.codex/hooks.json` | none | write `~/.codex/hooks.json` with the JSON merge recipe |
| `memories.*` | table | `codex features enable memories` for the flag; `[memories] use_memories/generate_memories/...` table has no writer | yq / marker tables |
| `cli_auth_credentials_store` | `"file"|"keyring"|"auto"|"ephemeral"` | none | yq / marker root |
| `windows.sandbox`, `windows.sandbox_private_desktop` | `"unelevated"|"elevated"`, bool | none | yq / marker tables (Windows only) |
| `[[skills.config]]` (`path`, `enabled`) | array of tables | none in CLI (`skills` CLI from skills.sh manages `~/.agents/skills`, not this table) | yq `.skills.config |= (map(select(.path != $p)) + [{path:$p, enabled:true}])` (tested idempotent) |
| `plugins."name@market".enabled`, `[[marketplaces.<name>]]` | table / array | `codex plugin add`, `codex plugin marketplace add` | CLI |

## 2. TOML editing options — measured

Round-trip fidelity on the commented copy above plus a "hard" file (`[[skills.config]]`, inline table, multi-line basic string, literal string, dotted key, datetime, big int, bare `[servers]` parent header, Windows-style `[projects."C:\\Users\\alex\\proj one"]`):

| Option | Comments | Key order | Quoted keys (`/abs`, `C:\\…`) | `[[array.of.tables]]` | Inline tables | Multi-line / literal strings | Blank lines | Codex parses output | Idempotent rerun | Dependency |
|---|---|---|---|---|---|---|---|---|---|---|
| **A. marker block (bash/awk, PS)** | user text untouched byte-for-byte | untouched | untouched | ok (inside block only) | untouched | untouched | one extra trailing blank on uninstall | yes | yes (3 runs identical) | none |
| **B. yq v4.53.6 `-p toml -o toml`** | **preserved** (block + inline; inline spacing normalised to two spaces; comments on a *bare parent header* like `# [servers]` are lost together with the header) | preserved; new root keys inserted **before** tables (correct) | preserved | preserved (blank lines between entries removed) | preserved | `"""…"""` → `"multi\nline\n"`, `'C:\x'` → `"C:\\x"` (semantically equal); dotted key `e.f = 2` moved to `[a.b.c.e]` | mostly kept | yes | yes | one static binary (~10 MB) |
| **C1. python `tomllib` + `tomli-w` 1.2.0** | **all lost** | insertion order kept (documented "respects insertion order") | preserved | rewritten as inline array of inline tables (valid; Codex parses) | expanded to sub-tables | normalised | rewritten | yes | yes | `pip install tomli-w` (PEP 668 blocks `--user` on Ubuntu 26.04 → use `--target` or `uv run --with tomli-w`) |
| **C2. `tomlkit` 0.15.1** | **preserved** ("preserves all comments, indentations, whitespace and internal element ordering") | preserved | preserved | preserved (minor blank-line quirks) | preserved | preserved | minor | yes | yes | `uv run --with tomlkit python3 edit.py` (uv downloads Python if missing) |
| **D1. `smol-toml` 1.8.0 (npm, last publish 2026-08-11)** | lost | preserved | preserved | preserved | expanded | normalised | rewritten | yes | yes | node + 140 KB package |
| **D2. `@iarna/toml` 2.2.5 (last publish 2020-04-22)** | lost | preserved | preserved | preserved | expanded, indented sub-tables | `"""` kept | rewritten | yes | yes | node + 156 KB, unmaintained since 2020 |
| E. `codex mcp add` / `features enable` | preserved outside `mcp_servers`; lost inside `mcp_servers` (#45432) | regroups all `mcp_servers.*` together | preserved | n/a | expanded | n/a | n/a | by definition | yes (upsert) | none |

yq caveat: it is **not a validator** — a duplicate-key file round-trips silently (last wins, rc=0). Always validate the result with `python3 -c 'import tomllib…'` or `codex mcp list` before/after replacing.

Cross-platform yq install (from README, fetched): Windows `winget install --id MikeFarah.yq` / `choco install yq` / `scoop install main/yq`; macOS `brew install yq`; Linux `wget https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 -O /usr/local/bin/yq && chmod +x /usr/local/bin/yq` (also `snap install yq`). `yq_windows_amd64.exe` exists under the same `releases/latest/download/` path (HTTP 200). GitHub shows 16.0k stars (2026-09-17, README page). `yq -i` in-place preserved the 0600 mode in the test.

### Tested yq expressions (copy verbatim)

```bash
# set/replace root keys (inserted before the first table when absent)
yq -i -p toml -o toml '.model_reasoning_effort = "xhigh" | .notify = ["python3", "/home/alexf/.local/bin/notify.py"]' ~/.codex/config.toml
# trust a project (quoted key with slashes or backslashes)
yq -i -p toml -o toml '.projects["/home/alexf/work/proj"].trust_level = "trusted"' ~/.codex/config.toml
yq -i -p toml -o toml '.projects["D:\\work\\x"].trust_level = "trusted"' ~/.codex/config.toml
# idempotent [[skills.config]] upsert
yq -i -p toml -o toml '.skills.config |= ((. // []) | map(select(.path != "/home/alexf/.agents/skills/baz")) + [{"path":"/home/alexf/.agents/skills/baz","enabled":true}])' ~/.codex/config.toml
# nested tables that may or may not exist yet
yq -i -p toml -o toml '.tui.notifications = true | .windows.sandbox = "elevated" | .memories.use_memories = true' ~/.codex/config.toml
# delete a key
yq -i -p toml -o toml 'del(.notice)' ~/.codex/config.toml
```

Wrap every `yq -i` in: backup → `yq` to temp (`yq -p toml -o toml EXPR file > file.tmp`) → `python3 -c tomllib` or `codex mcp list` check → `mv -f`.

### Option A marker format (copied from `@caveman-ai/cli` 1.3.3 `dist/index.js`, lines 6362-6365 and `codexNativeConfig`)

```
# >>> caveman:native-root
model_provider = "caveman"
# <<< caveman:native-root

<user's original text, caveman's own blocks and legacy caveman tables stripped>

# >>> caveman:native-tables
[model_providers.caveman]
name = "Caveman"
base_url = "…"
wire_api = "responses"
requires_openai_auth = true

[mcp_servers.caveman]
command = "/home/alexf/.caveman/bin/caveman-mcp"
# <<< caveman:native-tables
```

Caveman's rules worth copying: (1) root block first, tables block last, so root keys can never fall into a table; (2) both begin/end must exist or it throws "existing Codex Caveman block is corrupted"; (3) it strips its own blocks first, then legacy unmarked tables it owns, then rebuilds — never regex-edits in place; (4) `installMcpCodexToml` refuses to overwrite an existing `[mcp_servers.NAME]` unless a journal marker proves it wrote it ("refusing to claim ownership"); (5) its hook writer uses "replace, never accumulate": identity is the hook *family* (`native-hook:claude`, `shrink-hook`), so a moved binary path replaces the stale entry instead of duplicating it.

Note: `caveman` 1.3.3 itself places `[mcp_servers.caveman]` inside its tables block — by the test in 1.3 that block will be regrouped by the next `codex mcp add`; caveman then guards with `readMcpServerMarker` journaling. The installer should not repeat that design.

`toml-marker.sh` (bash, tested) and `Set-TomlMarkerBlock.ps1` (PowerShell, tested with pwsh 7.6.6, byte-identical output to the bash version) implement: strip own blocks → collision guard (any header or root key we would write that already exists outside our block → `REFUSE` rc=2 unless `TOML_MARKER_ADOPT=1`/`-Adopt`) → rebuild → `tomllib` validation (when python3 present) → backup → temp+rename with mode 0600. Verified: 3-run idempotent; value change replaced in place; empty root+tables = clean uninstall (original restored except one trailing newline); missing file created; CRLF input normalised; Windows quoted keys handled.

## 3. JSON: `~/.claude/settings.json` (and `~/.codex/hooks.json`)

### 3.1 Schema facts (Claude Code docs, fetched)

`hooks: { <Event>: [ { matcher?: string, hooks: [ {type: "command"|"http"|"mcp_tool"|"prompt"|"agent", command?, args?, prompt?, url?, headers?, server?, tool?, input?, timeout?, async?, asyncRewake?, shell?, if?, statusMessage?, once?} ] } ] }`. `matcher` `"*"`, `""` or omitted = match all. Events now include `Setup, UserPromptExpansion, PermissionRequest, PermissionDenied, PostToolBatch, StopFailure, TaskCreated, TaskCompleted, TeammateIdle, PostCompact, PreModelSwitch, PostModelSwitch, Notification, MessageDisplay, InstructionsLoaded, ConfigChange, CwdChanged, DirectoryAdded, FileChanged, WorktreeCreate, WorktreeRemove, Elicitation, ElicitationResult` in addition to the classic ten. Across *files* Claude merges hooks and dedupes identical ones; within one file nothing dedupes — that is the installer's job. Claude Code watches settings files and hot-reloads (`ConfigChange` hook fires), so writing `settings.json` while a session runs is safe; malformed JSON → "Settings Error" dialog (interactive) or skipped (`-p`). Lists such as `permissions.allow` merge across scopes; `fallbackModel`, `modelPicker`, `availableModels` do not.

`claude config` **no longer exists** in 2.1.273 (`claude --help` command list: agents, attach, auth, auto-mode, doctor, gateway, import, install, logs, mcp, plugin, project, respawn, rm, setup-token, stop, ultrareview, update). Settings writers: `/config` in the TUI, `claude plugin …`, `claude mcp …`. Everything else = edit the file.

### 3.2 jq recipe (`gap-5-scripts/merge-settings.jq`, jq ≥ 1.6 for `IN`; tested with 1.8.1)

```bash
jq --argjson add "$(cat fragment.json)" \
   --argjson supersede '["caveman-proxy. native-hook claude","shrink-hook$"]' \
   -f merge-settings.jq ~/.claude/settings.json > "$tmp" \
 && jq -e . "$tmp" >/dev/null && cp -p ~/.claude/settings.json ~/.claude/settings.json.bak-$(date +%Y%m%d-%H%M%S) \
 && mv -f "$tmp" ~/.claude/settings.json
```

Semantics: objects deep-merge (unknown keys and key order preserved); scalar arrays (`permissions.allow` etc.) set-union; hooks identity = (event, matcher//"", type, command|args|prompt|url|server+tool); an identical hook already present in **any** group with the same matcher is skipped (this host keeps shrink-hook in a *second* matcher-less group — the naive "first group" check produced a duplicate, fixed); optional `$supersede` regex list makes a family match **replace in place** (moved/upgraded binary path), keeping group order. Verified on the real 11-hook file: 11 → 13 entries with a fragment re-declaring two caveman hooks + one new `Bash` matcher hook + `Notification`; second run byte-identical; moved-path fragment replaced `SessionStart` entry in place and left untouched events alone; `{}` input works; fragment without hooks leaves hooks intact. Pitfalls found on the way: jq `index()` on arrays is a sub-array search (never use it for array-valued ids — use `IN`), and `getpath` inside `select` changes `.`.

Limitation: arrays of objects outside `hooks` are replaced by the fragment (none of the keys the installer writes are of that shape).

### 3.3 PowerShell (`gap-5-scripts/Merge-ClaudeSettings.ps1`)

Constraints from the Windows PowerShell 5.1 docs (fetched): `ConvertTo-Json -Depth` default **2**, max 100, warns and truncates beyond → always `-Depth 100`; `ConvertFrom-Json` in 5.1 returns `PSCustomObject` (property order preserved), has **no `-AsHashtable`/`-Depth`**, **errors on JSON comments**, and keeps only the last duplicate key; `Set-Content` default encoding is ANSI ("Default") and `-Encoding UTF8` in 5.1 writes a BOM → use `[IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))`; 5.1's JavaScriptSerializer escapes `< > & '` as `\u003c…` (valid JSON; the script un-escapes them cosmetically). Syntax kept 5.1-safe: no `??`, no ternary, no `` `u{…} `` (that one was in the first draft and would have failed on 5.1 — replaced by `[char]0x1e`), no `-AsHashtable`; `,$array` returns to avoid pipeline unrolling; `$args` automatic variable avoided. Tested on pwsh 7.6.6 (downloaded to scratch; **not** run on real 5.1 — open item): output semantically identical to the jq result (`jq -S` compare), idempotent, BOM-prefixed input handled (`ReadAllText` strips it), empty/missing file, LF output, backup + temp + `Move-Item -Force`. For strictly atomic replace on NTFS use `[IO.File]::Replace($tmp, $path, $bak)`.

### 3.4 `~/.claude.json`

Docs: "Claude Code also keeps a fifth file, `~/.claude.json`, that it writes for itself; you don't need to edit it" (holds OAuth session, `mcpServers`, per-project trust, global `/config` keys `autoConnectIde`, `autoInstallIdeExtension`, `copyOnSelect`, `diffTool`, `externalEditorContext`). Claude rewrites the whole file and keeps the 5 newest `~/.claude/backups/.claude.json.backup.<ts>` plus any `.corrupted.<ts>`; on this host new backups appeared every ~60 s while sessions ran (07:13, 07:14, 07:15, 07:16, 07:17). Writers: `claude mcp add -s user NAME -- cmd`, `claude mcp add -s user --transport http NAME URL [-H …]`, `claude mcp add-json -s user NAME '{"type":"stdio","command":…}'`, `claude mcp remove -s user NAME`. Auto-updates: `settings.json` → `{"env":{"DISABLE_AUTOUPDATER":"1"}}` and `"autoUpdatesChannel":"stable"|"latest"`, `"minimumVersion"`. If the installer must touch a global key it has no CLI for: require no running `claude` process, use the same JSON merge recipe, keep Claude's own backup convention.

## 4. Failure modes observed (keep as installer test cases)

1. Append root key after tables → silently mis-scoped (`notice.model_reasoning_effort`).
2. Duplicate header/key → Codex refuses to start (`duplicate key` at line:col).
3. `codex mcp add` regroups all `mcp_servers.*`, drops comments/`enabled = true`, floats ints, expands inline tables (#45432); pulls tables out of foreign marker blocks.
4. `codex features enable` edits an existing `[features]` table wherever it is (inside a marker block included).
5. `codex mcp add --url` blocks on OAuth after writing config; `--bearer-token-env-var` avoids it.
6. yq silently accepts duplicate keys; `--strict-config` unavailable on subcommands → validate with tomllib or `codex mcp list` rc.
7. jq `index()` on arrays = subsequence search → false negatives in dedupe.
8. Hook dedupe must scan all groups with the same matcher, not the first.
9. "Remove then append" supersede reorders groups → non-idempotent; replace in place instead.
10. PS: `` `u{} `` syntax, `-AsHashtable`, `??`, ternary are 7+ only; `-Encoding UTF8` writes BOM on 5.1; default `-Depth 2` truncates `hooks` (depth 4).
11. `~/.claude.json` is rewritten every minute by a live session → never edit while `claude` runs.
12. Uninstall via empty marker blocks leaves one trailing newline (cosmetic).

## 5. Backup / atomic-write rules

* Backup before every write: `<file>.bak-YYYYmmdd-HHMMSS` next to the file (Claude's own convention is `~/.claude/backups/`; Codex keeps none), prune to last 10.
* Merge in memory; write `<file>.tmp-<pid>` in the same directory; validate the temp (`tomllib`, `jq -e .`, `ConvertFrom-Json`); then `mv -f` / `Move-Item -Force` / `[IO.File]::Replace`.
* Preserve mode (0600 for `config.toml`, `auth.json`), owner, and line endings (LF everywhere; Codex/Claude write LF on Windows too).
* Post-write smoke test: `codex mcp list >/dev/null` (rc), `claude doctor` (settings validation), and the installer's own re-read.
* Refuse, don't guess: half a marker block, a header we own found outside our block, non-object JSON root, or a parse failure of the *existing* file → abort with the backup path printed.
* Idempotency contract: every writer must produce byte-identical output on an immediate rerun (all four shipped scripts do).

## 6. Sources

* Local: `/usr/local/lib/node_modules/@caveman-ai/cli/dist/index.js` (1.3.3; `CODEX_NATIVE_ROOT_BEGIN` l.6362, `codexNativeConfig` l.7028, `installMcpCodexToml` l.12558, `nativeHooksDocument` l.6137); `codex --help`, `codex mcp add --help`, `codex features --help`, `codex plugin --help`, `codex doctor --help`; `claude --help`, `claude mcp --help`, `claude plugin install --help`.
* https://github.com/openai/codex/issues/45432 (open, 2026-09-14)
* https://github.com/openai/codex/releases (0.155.0-alpha.15, 2026-09-17; notes not retrievable)
* https://learn.chatgpt.com/docs/config-file/config-reference , /config-basic , /config-advanced ; https://learn.chatgpt.com/docs/extend/mcp?surface=cli
* https://code.claude.com/docs/en/hooks ; /settings ; /settings-reference ; /claude-directory ; /setup
* https://github.com/mikefarah/yq (README install commands, 16.0k stars 2026-09-17); https://raw.githubusercontent.com/mikefarah/yq/master/pkg/yqlib/doc/usage/toml.md ; binary v4.53.6 from `releases/latest/download/`
* https://pypi.org/pypi/tomli-w/json (1.2.0, 2025-01-15); https://github.com/hukkin/tomli-w (143 stars); https://pypi.org/pypi/tomlkit/json (0.15.1, 2026-07-17); https://github.com/python-poetry/tomlkit (850 stars)
* https://registry.npmjs.org/smol-toml (1.8.0, 2026-08-11); https://github.com/squirrelchat/smol-toml (308 stars); https://registry.npmjs.org/@iarna/toml (2.2.5, 2020-04-22)
* https://docs.astral.sh/uv/guides/scripts/ (`uv run --with rich example.py`)
* https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/convertto-json?view=powershell-5.1 ; …/convertfrom-json?view=powershell-5.1 ; …/microsoft.powershell.management/set-content?view=powershell-5.1
* https://github.com/PowerShell/PowerShell/releases (v7.6.6 tarball used for testing only)

## Verification (skeptical fact-check pass, 2026-09-17)

Second researcher re-fetched every primary source and re-ran the local tests on fresh copies (scratch `CODEX_HOME`, nothing in `$HOME` touched). Result: **no item removed, no fact refuted.** Corrections and additions below; the JSON handed back carries the same list.

### Confirmed against primary sources

| Claim | Source re-fetched | Result |
|---|---|---|
| No `codex config` subcommand; writers are `mcp add/remove`, `features enable/disable`, `plugin add/remove`, `plugin marketplace add/remove/upgrade` | `codex --help`, `codex mcp --help`, `codex features --help`, `codex plugin --help`, `codex plugin marketplace --help` (0.154.0, local) | confirmed |
| No `claude config` subcommand; `claude mcp add/add-json/remove -s user`, `claude plugin install -s user -y --json`, `claude plugin marketplace add --scope user`, `claude plugin enable -s user`, `claude plugin marketplace update [name]` | `claude --help`, `claude mcp --help`, `claude mcp add --help`, `claude plugin --help`, `claude plugin install --help`, `claude plugin marketplace add --help` (2.1.273, local) | confirmed; every flag exists as written |
| Duplicate header → `duplicate key` rc=1; root key appended after tables silently lands in `[notice]`; `--strict-config` rejected for `codex mcp` (`not supported`); `codex mcp list` rc=0/1; `codex doctor --summary --ascii` prints `[ok] config loaded` with rc=1 | re-run on scratch `CODEX_HOME` (0.154.0) | all reproduced |
| Codex precedence CLI > project (trusted) > profile file > user > cloud-managed > `/etc/codex/config.toml` > defaults; `[profiles.<name>]` not read since 0.134.0; hooks from `~/.codex/hooks.json` or `[[hooks.<Event>]]` | https://learn.chatgpt.com/docs/config-file/config-basic ("Codex resolves values in this order (highest precedence first): …"), /config-advanced ("the profile file is a layer above your base user config and below project and CLI config"; "In Codex 0.134.0 and later, --profile no longer reads [profiles.profile-name]") | confirmed verbatim. (A WebFetch summary first placed project config below user config; the raw page text proves that summary wrong.) |
| Config reference key shapes (`model_reasoning_effort` minimal..xhigh, `trust_level`, `mcp_servers.*` subkeys, `notify`, `cli_auth_credentials_store` file/keyring/auto/ephemeral, `[windows]`, `[[skills.config]]`, `[memories]`, `tui.*`, `plugins."name@market".enabled`, `marketplaces.<name>`) | https://learn.chatgpt.com/docs/config-file/config-reference | confirmed |
| MCP docs: `codex mcp add <name> --env … -- <cmd>`; `codex mcp login <server-name>` is the documented separate OAuth step | https://learn.chatgpt.com/docs/extend/mcp?surface=cli | confirmed (the "add blocks on OAuth" part is the first researcher's observation; not re-run to avoid launching a browser — downgraded to medium) |
| openai/codex#45432 open, opened 2026-09-14, 0 comments, no maintainer response; also names `codex mcp login` as a rewriter | https://github.com/openai/codex/issues/45432 | confirmed |
| yq install commands (winget/choco/scoop/brew/wget/snap), 16.0k stars, latest v4.53.6, `yq_windows_amd64.exe` on `releases/latest/download/` | https://github.com/mikefarah/yq README; `releases/latest` redirect → `v4.53.6`; HEAD on the .exe → 302 → 200 | confirmed character-by-character |
| yq TOML doc: bare `[servers]` parent header "yq can't do this one yet" | https://raw.githubusercontent.com/mikefarah/yq/master/pkg/yqlib/doc/usage/toml.md | confirmed |
| tomli-w 1.2.0 (2025-01-15), 143 stars, "cannot write comments", respects input order; tomlkit 0.15.1 (2026-07-17), 850 stars, "preserves all comments, indentations, whitespace and internal element ordering" | https://pypi.org/pypi/tomli-w/json, https://pypi.org/pypi/tomlkit/json, both GitHub READMEs | confirmed |
| smol-toml 1.8.0 (2026-08-11), 308 stars, TOML 1.1; @iarna/toml 2.2.5 (2020-04-22) | https://registry.npmjs.org/smol-toml, https://registry.npmjs.org/@iarna/toml, https://github.com/squirrelchat/smol-toml | confirmed. Note: npm does **not** flag @iarna/toml as deprecated; "deprecated" here is the researcher's verdict (unmaintained), not an npm status. |
| `uv run --with <pkg> script.py`; uv downloads Python if missing | https://docs.astral.sh/uv/guides/scripts/ | confirmed |
| Claude settings precedence, list merge (`permissions.allow`) with the `fallbackModel`/`modelPicker`/`availableModels` exceptions, file watcher hot-reload + `ConfigChange`, `~/.claude.json` "writes for itself; you don't need to edit it", `.corrupted.<ts>` + five newest `.backup.<ts>` | https://code.claude.com/docs/en/settings, /claude-directory | confirmed |
| Hooks schema (5 types, fields, all event names), cross-file dedupe ("If you define the same handler in more than one settings file, it runs once") | https://code.claude.com/docs/en/hooks | confirmed; same-file dedupe still undocumented (open question stands) |
| `env.DISABLE_AUTOUPDATER="1"`, `autoUpdatesChannel`, `minimumVersion`, `claude update`, native install one-liners, `claude doctor` "Auto-updates … disabled (set by env: DISABLE_AUTOUPDATER)" | https://code.claude.com/docs/en/setup | confirmed |
| `enabledPlugins`, `extraKnownMarketplaces` are settings.json keys ("Any file") | https://code.claude.com/docs/en/settings-reference | confirmed |
| PS 5.1: `ConvertTo-Json -Depth` default 2, range 1–100, warns; `ConvertFrom-Json` has only `-InputObject`, errors on comments, keeps last duplicate key, PSObject keeps order | learn.microsoft.com 5.1 pages | confirmed |
| `~/.claude.json` rewritten about every 60 s while sessions run | `ls ~/.claude/backups/` at 07:38 → backups at 07:34, 07:35, 07:36, 07:37, 07:38 | re-confirmed |
| caveman marker strings `# >>> caveman:native-root` / `# >>> caveman:native-tables`, "existing Codex Caveman block is corrupted", "refusing to claim ownership" | local 1.3.3 `dist/index.js` **and** the npm 1.3.4 tarball (published 2026-09-15) | confirmed; marker format unchanged in 1.3.4 |
| `winget install jqlang.jq`, `winget install --id MikeFarah.yq` package IDs | raw winget-pkgs manifests `jqlang.jq/1.8.1` and `MikeFarah.yq/4.53.6` (HTTP 200) | confirmed |
| Shipped scripts: `merge-settings.jq` 11→13 hooks, byte-identical rerun, dedupe of an already-present hook; `toml-marker.sh` idempotent, 0600 kept, `[notice]` collision → `REFUSE` rc=2, result loads in Codex (`codex mcp list` rc=0, tomllib ok) | re-run on copies in `scratchpad/verify5*/` | confirmed |

### Corrections made

1. `codex plugin remove PLUGIN` → **`codex plugin remove PLUGIN@MARKETPLACE`** (or `PLUGIN -m MARKETPLACE`); the bare form is rejected by 0.154.0 (`codex plugin remove --help`). Fixed in the TL;DR table and item 3.
2. `codex plugin marketplace add` source forms spelled out from `--help`: local path, `owner/repo[@ref]`, HTTPS or SSH Git URL; extra flags `--ref`, `--sparse`, `--json`.
3. Codex release fact updated: newest pre-release is **0.155.0-alpha.16 (2026-09-17 04:34)**, after alpha.15 (2026-09-17 01:21) and alpha.9 (2026-09-16); the stable `releases/latest` redirect still points at `rust-v0.154.0`. Release-note bodies still fail to load ("There was an error while loading"), so the `codex config` question remains open.
4. "add blocks on OAuth" confidence lowered to **medium** (single observation by the first researcher; docs only say `codex mcp login` is a separate step; not re-run here).
5. Star counts remain README-page readings (GitHub API unauthenticated limit hit, `gh` token invalid) — unchanged numbers, still dated 2026-09-17.

### Facts added by the fact-checker

* `codex doctor --json` emits `{schemaVersion, codexVersion, generatedAt, overallStatus, checks[]}`; `checks[] | select(.id=="config.load") | .status` is `"ok"` on a good file and `"fail"` (summary "config could not be loaded", notes "failed to load bootstrap configuration") on a broken one. Exit code is 1 in both cases on this unauthenticated scratch home, so use the JSON field, not rc. This replaces the ASCII grep in the validation item.
* `codex mcp add` (0.154.0) has `--oauth-client-id`, `--oauth-client-registration <auto|cimd|dcr>` and `--oauth-resource` — OAuth for HTTP servers is configurable at add time; the earlier open question about skipping OAuth discovery is unchanged (no flag skips it).
* Codex prints `WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper binaries under temporary dir "/tmp"` when `CODEX_HOME` is under `/tmp` — harmless for validation runs, but an installer that stages a scratch `CODEX_HOME` for dry-runs should expect the warning on stderr.
* Claude docs: `DISABLE_UPDATES` blocks *all* update paths including `claude update`/`claude install` (vs `DISABLE_AUTOUPDATER`, background only); `winget install Anthropic.ClaudeCode` and `brew install --cask claude-code` installs do not auto-update unless `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1`.
* Claude docs: JSON passed with `--settings <file-or-json>` merges by the same rules as the file levels (key-wise override, lower-level values kept for omitted keys) — the installer's dry-run can preview a fragment with `claude --settings fragment.json` without writing.
* `@caveman-ai/cli` latest on npm is **1.3.4** (2026-09-15); this host runs 1.3.3. Marker strings and the two guard messages are identical in both.

### Additional sources used in this pass

* https://registry.npmjs.org/@openai/codex (dist-tags: latest=0.154.0, alpha=0.155.0-alpha.15, published 2026-09-17T01:29Z)
* https://github.com/openai/codex/releases (alpha.16 listed) ; https://github.com/openai/codex/releases/tag/rust-v0.155.0-alpha.16 (body fails to load)
* https://registry.npmjs.org/@caveman-ai/cli (1.3.4 tarball inspected)
* https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/j/jqlang/jq/1.8.1/jqlang.jq.yaml ; …/manifests/m/MikeFarah/yq/4.53.6/MikeFarah.yq.yaml
* https://code.claude.com/docs/en/settings-reference (enabledPlugins / extraKnownMarketplaces / autoUpdatesChannel scope lines)
