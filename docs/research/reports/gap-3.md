# GAP-FILL 3 — Version detection table: installed vs latest for every component

Research date: 2026-09-17 (probes run on the reference Ubuntu 26.04 host; all commands read-only).
Scope: per-component (1) installed-version probe + parse rule, (2) latest-version probe, (3) rate-limit / auth needs; Codex install-method detection; `--check` drift-report design; exact GitHub API endpoints and auth guidance.

Everything below was either executed locally, fetched from a primary source, or read out of the shipped binaries (`strings` on the Claude Code 2.1.273 bun bundle and the Codex 0.154.0 musl binary). Where the docs and the binary disagree, the binary/observed behaviour is recorded and the disagreement is flagged.

---

## 0. Headline findings (what changes the installer design)

1. **No GitHub API is needed for any drift check on this stack.** Every "latest" probe has a rate-limit-free source:
   - Claude Code: `https://downloads.claude.ai/claude-code-releases/{latest|stable}` (plain text version) and `/<version>/manifest.json`.
   - Official Claude marketplace: `https://downloads.claude.ai/claude-code-releases/plugins/claude-plugins-official/latest` returns the snapshot SHA that the local file `~/.claude/plugins/marketplaces/claude-plugins-official/.gcs-sha` stores. The official marketplace is **no longer a git clone** (it is a zip snapshot from GCS; verified in the 2.1.273 binary, function `fetchOfficialMarketplaceFromGcs`).
   - Per-plugin catalog truth (version, pinned sha, `last_updated`, `unique_installs`, token cost): `https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/plugin-stats/plugin-details.json` (same URL Claude Code caches as `~/.claude/plugins/plugin-catalog-cache.json`, 24 h TTL).
   - Codex: `https://releases.openai.com/codex/channels/latest` (GitHub-release-shaped JSON, `tag_name: "rust-v0.154.0"`), plus npm dist-tags and brew cask JSON.
   - Third-party git marketplaces and skills.sh skills: `git ls-remote` and a blobless no-checkout clone (`git clone --depth 1 --filter=blob:none --no-checkout`, 0.7 s / 192 KB for JuliusBrussee/caveman) give the remote HEAD and the **exact folder tree SHA that `.skill-lock.json` stores as `skillFolderHash`** (verified: `git rev-parse HEAD:skills/caveman` == lock value).
   - GitHub "latest release" without the API: `curl -sI https://github.com/<owner>/<repo>/releases/latest` returns `302` with `Location: .../releases/tag/<tag>`; `git ls-remote --tags` lists all tags. Neither counts against the REST rate limit.
2. **The unauthenticated GitHub REST limit (60/h per IP) was already exhausted on this host during research** (`x-ratelimit-remaining: 0`, reset 04:41 UTC), and Codex's own update check hit it too: `codex doctor --json` reports `"latest version probe": "HTTP 403 Forbidden"` because Codex polls `https://api.github.com/repos/openai/codex/releases/latest`. A fleet-wide `--check` that uses the REST API will fail the same way; the installer must default to the API-free probes above and use the API only as an opt-in with a token.
3. **`gh auth token` cannot be trusted blindly**: on this host `gh auth token` prints a token but `gh auth status` says "The token in keyring is invalid" and the API returns `401 Bad credentials`. The installer must validate a token with one `GET /rate_limit` (free) before using it.
4. **Claude Code plugin version strings**: for official plugins without a `version` in `plugin.json`, the installed "version" is the **first 12 hex chars of the marketplace snapshot SHA** (observed `76c85b7366c8` == `.gcs-sha[0:12]`), so every marketplace refresh makes those plugins "drift" even when their folder did not change. Use the catalog's per-plugin `last_updated`/`source_sha` to distinguish "snapshot moved" from "plugin content changed". `version: "unknown"` occurs when none of the fallbacks applied (see 3.3).
5. **`autoUpdates: false` in `~/.claude.json` is ignored for native installs** when `autoUpdatesProtectedForNative: true` is present (binary: `n.autoUpdates===!1&&(n.installMethod!=="native"||n.autoUpdatesProtectedForNative!==!0)`), which is why `claude doctor` prints `Auto-updates: enabled` on this host. To really disable, set `DISABLE_AUTOUPDATER=1` (docs). The channel is `autoUpdatesChannel` (`latest` default | `stable`) in `~/.claude/settings.json`.
6. **`skills check` is an alias of `skills update` in the vercel-labs `skills` CLI (1.5.23)** — it mutates. There is no dry-run in that CLI, so the installer must implement its own read-only compare (the lock format is simple; see 3.7).
7. **Codex install-method detection**: `codex doctor --json` → `.checks.installation.details["install context"]` (`standalone (unix, package <dir>, ...)`) and `.checks["runtime.provenance"].details["install method"]`; the binary's update-action table knows only: `standalone installer`, `npm install -g @openai/codex`, `bun install -g @openai/codex`, `pnpm add -g @openai/codex`, `vp install -g @openai/codex`, `brew upgrade --cask codex`, `manual or unknown`. winget/scoop/choco are not in that table, hence "Could not detect the Codex installation method. Please update manually: https://developers.openai.com/codex/cli/". The installer must detect those itself (`winget list --id OpenAI.Codex --exact`, `scoop list codex`, `choco list --exact codex`) and upgrade through the same manager.

---

## 1. Master table — installed probe / latest probe / auth

Legend: **none** = no auth, no meaningful rate limit; **GH-API** = api.github.com (60/h unauth per IP, 5000/h with token); 12-hex = first 12 characters of a SHA.

| # | Component | Installed probe (exact output → parse rule) | Latest probe | Auth / limit | Update command (official) |
|---|---|---|---|---|---|
| 1 | **Claude Code (native)** | `claude --version` → `2.1.273 (Claude Code)` → `awk '{print $1}'`. Install method: `jq -r .installMethod ~/.claude.json` → `native`. Binary path: `readlink -f ~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.273` (Windows: `%USERPROFILE%\.local\bin\claude.exe`, versions under `%USERPROFILE%\.local\share\claude\versions\`). Channel: `jq -r '.autoUpdatesChannel // "latest"' ~/.claude/settings.json`. Human: `claude doctor` prints `Running: native (2.1.273)`, `Auto-update channel: latest`, `Last update attempt: success → 2.1.273 (2026-09-16)` (no `--json`). | `curl -fsS https://downloads.claude.ai/claude-code-releases/latest` → `2.1.274`; `/stable` → `2.1.267`; `/<ver>/manifest.json` → `{"version","platforms":{"linux-x64":{"checksum","size"},...}}` (8 platforms: darwin-arm64/x64, linux-arm64/x64 (+musl), win32-arm64/x64). npm mirror: `https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags` → `{"stable":"2.1.267","latest":"2.1.274","next":"2.1.274"}`. Brew: `https://formulae.brew.sh/api/cask/claude-code.json` → 2.1.267, `claude-code@latest.json` → 2.1.274. choco `claude-code` → 2.1.236 (lags). | none | `claude update` (reports `Successfully updated from X to version Y` or `Claude Code is up to date (X)`); pin: `claude install stable|latest|2.1.89`; re-run `curl -fsSL https://claude.ai/install.sh | bash [-s stable|VERSION]`; Windows `irm https://claude.ai/install.ps1 | iex` / `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable`; `brew upgrade claude-code[@latest]`; `winget upgrade Anthropic.ClaudeCode`; npm: `npm install -g @anthropic-ai/claude-code@latest` (docs warn against `npm update -g`). |
| 2 | **Codex CLI** | `codex --version` → `codex-cli 0.154.0` → `awk '{print $2}'` (install.sh uses `sed -n 's/.* \([0-9][0-9A-Za-z.+-]*\)$/\1/p'`). Machine-readable: `codex doctor --json` → `.codexVersion` = `"0.154.0"`, `.schemaVersion` = 1, `.checks.installation.details["install context"]`, `.checks["runtime.provenance"].details.{version,"install method",platform,commit}`, `.checks["updates.status"].details{"cached latest version","latest version probe","update action","version cache"}`. Cache file `~/.codex/version.json` → `{"latest_version":"0.154.0","last_checked_at":"…Z","dismissed_version":null}` (Codex fills it from GH-API; stale/403-prone). Standalone layout: `$CODEX_HOME/packages/standalone/current -> releases/<ver>-<triple>` (`0.154.0-x86_64-unknown-linux-musl`), visible launcher `~/.local/bin/codex` (`$CODEX_INSTALL_DIR`); Windows launcher `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`, package `%USERPROFILE%\.codex\packages\standalone\current\bin\codex.exe`. | Primary (what install.sh uses by default, `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM=true`): `curl -fsS https://releases.openai.com/codex/channels/latest | jq -r .tag_name` → `rust-v0.154.0` → strip `rust-v`. Pinned: `https://releases.openai.com/codex/releases/<ver>/release.json`. Assets: `https://releases.openai.com/codex/releases/<ver>/<asset>` with GitHub fallback `https://github.com/openai/codex/releases/download/rust-v<ver>/<asset>`. Mirrors: npm dist-tags `https://registry.npmjs.org/-/package/@openai/codex/dist-tags` → `latest: 0.154.0`, `alpha: 0.155.0-alpha.15`; brew `https://formulae.brew.sh/api/cask/codex.json` → 0.154.0; scoop main bucket `https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/codex.json` → 0.154.0; choco `codex` → 0.154.0; winget manifests at `microsoft/winget-pkgs/manifests/o/OpenAI/Codex` → latest dir `0.152.0` (lags; enumerated API-free with a `--filter=tree:0` partial clone + `git ls-tree`, see §7.3) — on winget hosts use `winget upgrade --id OpenAI.Codex --exact`. No-API GitHub: `curl -sI https://github.com/openai/codex/releases/latest` → `302 …/releases/tag/rust-v0.154.0`. | none (releases.openai.com, npm, brew). GH-API only if you copy Codex's own probe `https://api.github.com/repos/openai/codex/releases/latest` — avoid. | `codex update` (standalone/npm/bun/pnpm/vp/brew only); or re-run `curl -fsSL https://chatgpt.com/codex/install.sh | sh` (Windows: `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`; non-interactive: `CODEX_NON_INTERACTIVE=1`, pin with `CODEX_RELEASE=x.y.z` or `--release`). npm: `npm install -g @openai/codex`; brew: `brew upgrade --cask codex`. winget/scoop/choco: upgrade via that manager (see §4). |
| 3 | **Official Claude marketplace snapshot** (`claude-plugins-official`) | `cat ~/.claude/plugins/marketplaces/claude-plugins-official/.gcs-sha` → `76c85b7366c8be78ce3ac67dd21945b3960d1a8c` (40-hex). Not a git repo (no `.git`). Registry: `jq '."claude-plugins-official".lastUpdated' ~/.claude/plugins/known_marketplaces.json`. `claude plugin marketplace list --json` → `[{"name","source":"github","repo":"anthropics/claude-plugins-official","installLocation"}]`. | `curl -fsS https://downloads.claude.ai/claude-code-releases/plugins/claude-plugins-official/latest` → `ea0a38e1d671aa18a30431c9160e31193dc9860b` (drift on this host). Snapshot archive: `…/plugins/claude-plugins-official/<sha>.zip` (3.4 MB). Client logic (binary): GET `/latest` (10 s timeout) → compare to `.gcs-sha` → if equal `noop`, else download `<sha>.zip`, extract `marketplaces/claude-plugins-official/` prefix into `.staging`, write `.gcs-sha`, atomic rename. | none | `claude plugin marketplace update claude-plugins-official` (or all: `claude plugin marketplace update`). Auto-update is on by default for this marketplace (docs), runs after session start with up to 10 min random delay. |
| 4 | **Third-party git marketplaces** (caveman = `JuliusBrussee/caveman`, claude-hud, remember-style) | `git -C ~/.claude/plugins/marketplaces/<name> rev-parse HEAD` → `15581d14007fd01fb3f132016741962f34936ca2`; `git -C … log -1 --format=%cI` → `2026-09-07T08:19:43Z`. Source from `known_marketplaces.json` `.source.repo`. Local catalog: `~/.claude/plugins/marketplaces/<name>/.claude-plugin/marketplace.json`. | `git ls-remote https://github.com/<owner>/<repo>.git HEAD | cut -f1` → `c2906c626be1d703b04e203d9f804a263e87f4ef` (drift). For pinned refs (`#tag`) compare `refs/tags/<tag>`. | none (git smart-HTTP; anonymous) | `claude plugin marketplace update <name>`; third-party marketplaces have auto-update **off** by default (docs) → the installer must run this on every `update`. |
| 5 | **Claude plugins (installed)** | `claude plugin list --json` → array of `{id,version,scope,enabled,installPath,installedAt,lastUpdated}` (observed keys in 2.1.273; docs additionally list `source`,`description` — not present here). Ground truth file `~/.claude/plugins/installed_plugins.json` (`"version": 2`, `plugins: {"<name>@<mkt>": [{scope,installPath,version,installedAt,lastUpdated,gitCommitSha?,resolvedVersion?,projectPath?,auto?}]}`). Cache layout `~/.claude/plugins/cache/<mkt>/<plugin>/<version>/` (+ `.in_use`, `.orphaned_at`, `.links_materialized` markers). Version semantics: semver from `plugin.json` (`6.3.0`, `2.0.8`, `0.32.0`), else marketplace-entry version, else 12-hex of the resolved git sha (git/url sources, e.g. caveman `15581d14007f` = marketplace clone HEAD), for `git-subdir` `sha12-<sha256(path)[0:8]>`, archives `hsn(sha256)`, for relative-path official plugins the **marketplace snapshot** 12-hex (`76c85b7366c8`), else `"unknown"`. | Catalog truth for official plugins: `curl -fsS https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/plugin-stats/plugin-details.json | jq '.plugins["<id>"] | {version, sha, source_sha, last_updated, unique_installs, tokens}'` (fields verified; `generated_at` 2026-09-16T07:35Z, `marketplace_sha`). Same data locally: `~/.claude/plugins/plugin-catalog-cache.json` (`.catalog.plugins[...]`, `fetchedAt`, 24 h TTL) and `claude plugin list --json --available` → `{installed:[…],available:[{pluginId,name,marketplaceName,source:{source,url,path,ref,sha},installCount}]}` (note: `available` excludes already-installed ids, 278 = 297 − 19). For third-party marketplaces: remote `marketplace.json` at the ls-remote HEAD (`git show HEAD:.claude-plugin/marketplace.json` in the blobless probe clone) → entry `version` or pinned `source.sha`. | none | `claude plugin update <plugin>[@mkt] [--scope user] [--json] [-y]`; auto-update covers official marketplace plugins (docs). Marketplace must be refreshed first for the catalog to move. |
| 6 | **Codex plugins** | `codex plugin list --json` → `{installed:[{pluginId,name,marketplaceName,version,installed,enabled,source:{source:"remote",id},installPolicy,authPolicy}],available:[]}` (observed: superpowers 6.3.0 `plugins~Plugin_…`, openai-templates 0.1.1, sites 0.1.65, plugin-management 0.1.0; `installed:true` is **account state**, only 2 of 4 have a local cache). Local cache `~/.codex/plugins/cache/<mkt>/<plugin>/<version>/.codex-plugin/plugin.json` + `.codex-remote-plugin-install.json` (`{"schema_version":1,"remote_plugin_id"}`). `codex plugin marketplace list` → `MARKETPLACE ROOT` table (`openai-curated /home/alexf/.codex/.tmp/plugins`). | The same `codex plugin list --json` call *is* the remote listing (it queries the server; `version` there is the served version). Drift = listed `version` ≠ local cache dir name. No public catalog URL found. | ChatGPT auth (already required by codex) | `codex plugin marketplace upgrade` (Git marketplaces), `codex plugin add <name>` re-install; no dedicated `codex plugin update` subcommand in 0.154.0. |
| 7 | **skills.sh skills (vercel-labs `skills` CLI)** | Lock: `~/.agents/.skill-lock.json` (`XDG_STATE_HOME/skills/.skill-lock.json` if set) `{"version":3,"skills":{"<name>":{source:"owner/repo",sourceType:"github",sourceUrl,skillPath:"skills/<name>/SKILL.md",skillFolderHash:<40-hex git TREE sha of the folder>,installedAt,updatedAt}},"dismissed":{}}`. Installed files `~/.agents/skills/<name>/` (symlinked into `~/.claude/skills`, `~/.codex/skills` etc.). `skillFolderHash` for well-known sources is `""` (uses `wellKnownDigest`); for local/tarball installs it is `sha256(relpath+content …)` (`computeSkillFolderHash`), not a git sha. | **API-free**: `git clone -q --depth 1 --filter=blob:none --no-checkout https://github.com/<owner>/<repo>.git $tmp && git -C $tmp rev-parse HEAD:<dirname(skillPath)>` → compare to `skillFolderHash` (verified identical for all 21 entries at the installed commit). One clone per repo (2 repos here). **API route (what the CLI does)**: `GET https://api.github.com/repos/<owner>/<repo>/git/trees/<HEAD|main|master>?recursive=1` → `.tree[] | select(.type=="tree" and .path=="skills/<name>") | .sha`. CLI order: anonymous → on 403 with `x-ratelimit-remaining: 0` retry with `GITHUB_TOKEN`/`GH_TOKEN` → then `gh api repos/<o>/<r>/git/trees/<ref>?recursive=1 --hostname github.com` → finally an authenticated git clone. | git route: none. API route: GH-API (1 call per repo per branch tried; up to 3 branch names if unpinned). | `npx skills update [-g|-p] [-y] [names…]` (`skills check` = same command, mutating). CLI itself: `npx skills@latest …` (registry 1.6.0 vs npx cache 1.5.23). |
| 8 | **Personal skills** (`~/.claude/skills/<name>`) | `ls ~/.claude/skills`; if symlink → resolves into `~/.agents/skills` (covered by #7); if a git checkout → `git rev-parse HEAD`; else content hash `find <dir> -type f | sort | xargs sha256sum | sha256sum`. | Only if provenance recorded (installer should record `{source,ref,sha}` in its own manifest). | none | Reinstall from recorded source. |
| 9 | **@caveman-ai/cli + ~/.caveman/bin** | `caveman --version` → JSON `{"version":"1.3.3","binary_release":"bin-v1.1.6"}` → `jq -r .version`, `.binary_release`. `npm ls -g --json --depth=0 | jq -r '.dependencies["@caveman-ai/cli"].version'`. Bins manifest `~/.caveman/bin/.bin-manifest.json` → `{"release":"bin-v1.1.6","artifacts":{"caveman-proxy":"<sha256>",…}}`. Individual bins have no `--version` (only `caveman-mcp version --json` → `{"version":"dev",…}`, useless). | npm: `curl -fsS https://registry.npmjs.org/@caveman-ai%2fcli/latest | jq -r .version` → `1.3.4`. Binary release pin lives in the package: `curl -sL $(curl -fsS https://registry.npmjs.org/@caveman-ai%2fcli/latest | jq -r .dist.tarball) | tar -xzO package/dist/binaries.generated.js | grep -o 'BINARY_RELEASE = "[^"]*"'` → `bin-v1.1.7` (download base `https://github.com/JuliusBrussee/caveman/releases/download/<bin-vX>/…`, ECDSA-signed). Tags without API: `git ls-remote --tags https://github.com/JuliusBrussee/caveman.git 'bin-v*'` → bin-v1.1.7. Plugin repo latest release: `curl -sI https://github.com/JuliusBrussee/caveman/releases/latest` → `v2.7.0`. | none | `npm install -g @caveman-ai/cli@latest` (bins re-fetched to the pinned `bin-v`); Claude plugin part via `claude plugin marketplace update caveman && claude plugin update caveman@caveman`. |
| 10 | **ccusage** | `ccusage --version` (npm bin `ccusage` → `./src/cli.js`); or `npm ls -g --json` / `bunx`. | `https://registry.npmjs.org/ccusage/latest` → `20.0.20` (repo `ccusage/ccusage`) | none | README (apps/ccusage/README.md, 2026-09-17) documents only run-without-install: `npx ccusage@latest`, `bunx ccusage`, `pnpm dlx ccusage`. A global `npm install -g ccusage` works (package ships a `bin`) but is **not** a documented path — prefer `npx ccusage@latest` / `bunx ccusage` (always latest, nothing to drift-check). |
| 11 | **claude-hud** (jarrodwatts/claude-hud, a Claude plugin) | It is a **plugin**: `claude plugin list --json | jq '.[]|select(.id=="claude-hud@claude-hud")'`; `plugin.json` at HEAD has `version: 0.8.0` (marketplace entry has no version → semver from plugin.json). The npm package `claude-hud` 1.1.0 is a different, unrelated status-line package (no repository field) — do not use it as the "latest" for the plugin. | `curl -fsS https://raw.githubusercontent.com/jarrodwatts/claude-hud/main/.claude-plugin/plugin.json | jq -r .version` → `0.8.0`; `git ls-remote https://github.com/jarrodwatts/claude-hud.git HEAD`. | none | `claude plugin marketplace add jarrodwatts/claude-hud`; `claude plugin install claude-hud@claude-hud`; update via `claude plugin marketplace update claude-hud && claude plugin update claude-hud@claude-hud`. |
| 12 | **agent-browser** (vercel-labs) | `agent-browser --version`; npm bin. | `https://registry.npmjs.org/agent-browser/latest` → `0.38.1`; brew formula also exists (`brew install agent-browser`), cargo crate. | none | `npm install -g agent-browser` (+ `agent-browser install` for Chrome), `brew upgrade agent-browser`. |
| 13 | **rtk** (rtk-ai/rtk) | `rtk --version` → `rtk 0.28.2`-style → `awk '{print $2}'`. | brew formula JSON `https://formulae.brew.sh/api/formula/rtk.json | jq -r .versions.stable` → `0.49.0`; `curl -sI https://github.com/rtk-ai/rtk/releases/latest` → `v0.49.0`; `git ls-remote --tags` → v0.49.0. | none | `brew upgrade rtk`; re-run `curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh` (installs to `~/.local/bin`); `cargo install --git https://github.com/rtk-ai/rtk`; Windows: zip `rtk-x86_64-pc-windows-msvc.zip` from releases → `rtk.exe` on PATH (no winget/scoop in README). |
| 14 | **headroom** (chopratejas/headroom, PyPI `headroom-ai`) | `headroom --version` (CLI from `uv tool install --python 3.13 "headroom-ai[all]"`); `uv tool list`. | `https://pypi.org/pypi/headroom-ai/json | jq -r .info.version` → `0.37.0` (uploaded 2026-08-27; `requires_python >=3.10`; the README's `--python 3.13` is a recommendation for an isolated interpreter, relevant on this host because system python is 3.14). | none | `uv tool upgrade headroom-ai` / `pip install -U "headroom-ai[all]"`. |
| 15 | **uv** | `uv --version` → `uv 0.x.y` → `awk '{print $2}'`. | `git ls-remote --tags https://github.com/astral-sh/uv.git` → `0.12.15`; or `curl -sI https://github.com/astral-sh/uv/releases/latest`. | none | `uv self update`; installer `curl -LsSf https://astral.sh/uv/install.sh | sh`; Windows `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`. |
| 16 | **gum** | `gum --version` → `gum version v2.0.1`-style → grep semver. | `git ls-remote --tags https://github.com/charmbracelet/gum.git` → `v2.0.1`; `…/releases/latest` redirect → `v2.0.1`. | none | Per gum README (fetched 2026-09-17): `brew install gum`; `winget install charmbracelet.gum`; `scoop install charm-gum` (package is **charm-gum**, not `gum`); apt: `curl -fsSL https://repo.charm.sh/apt/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/charm.gpg` + `echo "deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *" | sudo tee /etc/apt/sources.list.d/charm.list` + `sudo apt update && sudo apt install gum`; `go install charm.land/gum/v2@latest`. Update: `brew upgrade gum` / `winget upgrade charmbracelet.gum` / `scoop update charm-gum` / `apt upgrade gum`. |
| 17 | **jq** | `jq --version` → `jq-1.8.1` → strip `jq-`. | `curl -sI https://github.com/jqlang/jq/releases/latest` → `302 …/tag/jq-1.8.2`; `git ls-remote --tags https://github.com/jqlang/jq.git | grep -E 'jq-[0-9.]+$' | sort -V | tail -1` → `jq-1.8.2` (released 2026-06-20 per releases.atom; `jq-1.8.2rc1` also exists — filter `rc`). **Installed 1.8.1 is BEHIND** (verification corrected the original "== latest" claim). | none | distro package / `winget upgrade jqlang.jq` / brew. |
| 18 | **gh, node, npm, bun, python3, git** | `gh --version` (`gh version 2.46.0 (…)`), `node --version` (`v22.22.1`), `npm --version`, `bun --version`, `python3 --version`, `git --version`. | distro / official channels; report only. | none | out of scope (prereqs). |
| 19 | **The installer script itself** | Embed `INSTALLER_VERSION` + build `git describe`; store `~/.config/super-agent-installer/state.json` with `{version, commit, installedAt, lastCheck}`. | `git ls-remote https://github.com/<you>/<repo>.git HEAD` or `curl -sI …/releases/latest` (302) → tag. | none (public repo) or PAT/SSH (private) | `self-update` = re-fetch script from tag, verify checksum, re-exec. |

---

## 2. Claude Code details

### 2.1 Channels and files
- Release pointers (plain text): `https://downloads.claude.ai/claude-code-releases/latest` → `2.1.274`, `…/stable` → `2.1.267` (2026-09-17 04:0x UTC). Manifest: `…/2.1.274/manifest.json` → `platforms: darwin-arm64, darwin-x64, linux-arm64, linux-arm64-musl, linux-x64, linux-x64-musl, win32-arm64, win32-x64` with `checksum` (sha256) and `size`; detached GPG signature at `manifest.json.sig` (key `https://downloads.claude.ai/keys/claude-code.asc`, fingerprint `31DD DE24 DDFA B679 F42D 7BD2 BAA9 29FF 1A7E CACE`). Binary: `…/<version>/<platform>/claude` (optionally `.zst` per `manifest.zst.json`).
- `claude.ai/install.sh` always downloads `/latest` first (to get the freshest installer), then runs `<binary> install [stable|latest|VERSION]` — the target is applied by `claude install`, and "the channel you choose at install time becomes your default for auto-updates" (docs).
- npm dist-tags mirror the same channels: `stable`, `latest`, `next`.
- State: `~/.claude.json` keys `installMethod` (`native`), `autoUpdates`, `autoUpdatesProtectedForNative`, `lastReleaseNotesSeen`, `firstStartVersion` (`2.1.241` here). Settings: `~/.claude/settings.json` `autoUpdatesChannel` (`latest`|`stable`; `/config` shows `rc`→`slow` too), `minimumVersion`. Env: `DISABLE_AUTOUPDATER=1` (background only), `DISABLE_UPDATES` (blocks `claude update`/`claude install` too), `FORCE_AUTOUPDATE_PLUGINS=1`, `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1` (brew/winget).
- `claude doctor` (read-only, non-TTY safe) lines usable by regex: `Running: native (2.1.273)`, `Commit: d48ecfd7a41c`, `Platform: linux-x64`, `Path: …/versions/2.1.273`, `Config install method: native`, `Auto-updates: enabled`, `Auto-update channel: latest`, `Last update attempt: success → 2.1.273 (2026-09-16)`. There is no `--json`.
- Old versions are kept in `~/.local/share/claude/versions/` (4 here: 2.1.270–2.1.273); the launcher symlink selects the active one.

### 2.2 Windows equivalents
- Install: `irm https://claude.ai/install.ps1 | iex`; CMD: `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`; pin: `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable`. WinGet: `winget install Anthropic.ClaudeCode` / `winget upgrade Anthropic.ClaudeCode` (no auto-update; may fail while claude is running because the exe is locked). Native paths: `$env:USERPROFILE\.local\bin\claude.exe`, `$env:USERPROFILE\.local\share\claude`.
- Probe is identical: `claude --version` → `2.1.273 (Claude Code)`.

### 2.3 Plugin version resolution (from the 2.1.273 binary, function `BJ`)
Order actually implemented. **Verification note:** the current plugins-reference page (fetched 2026-09-17) agrees with the binary — it lists plugin.json `version` → marketplace-entry `version` → git commit SHA (github/url/git-subdir/relative-path in a git-hosted marketplace) → SHA-256 digest for archive sources "shortened to the first 12 characters" → `unknown` (npm sources / local dirs outside git), and a "12-character content hash" for command sources. It contains **no** "7 characters" statement; the earlier "docs say 7, binary says 12" discrepancy was stale and has been dropped. `substring(0,12)` occurs 8 times in the binary, `substring(0,7)` never.
1. `claudeai` source → catalog version.
2. `plugin.json` `version` ("Using manifest version").
3. marketplace-entry `version` ("Using provided version").
4. resolved git sha → 12-hex; `git-subdir` → `<sha12>-<sha256(path)[0:8]>`; when a semver exists *and* a pinned sha, the cache dir can be `<semver>-<sha12>`.
5. `archive` source → sha256-derived (`hsn(sha256)`; "pinned" vs "downloaded").
6. relative-path source inside a marketplace → marketplace clone git sha (`ADt`) 12-hex, else marketplace snapshot sha from `.gcs-sha` (`lxt`, "Using marketplace snapshot SHA") 12-hex.
7. `"unknown"`.

**Why the project-scope `code-review` shows `unknown`**: it was installed 2026-08-24 (client 2.1.241 era) from the official marketplace; `plugin.json` has no `version`, the marketplace entry has none, the official marketplace is a zip snapshot (no `.git`), and that older client had no `.gcs-sha` fallback → step 7. Reinstalling with 2.1.273 produced `76c85b7366c8` (step 6). Docs' own explanation ("command sources without structured version info, or url archives whose hash couldn't be computed") covers the other cases. Practical rule for the installer: treat `unknown` as "re-install to normalise"; `claude plugin update` handles it (`q=X==="unknown"` path bypasses the same-version short-circuit).

**`gitCommitSha` caveat**: it is not refreshed reliably on auto-update — `remember` shows `version 0.32.0` (dir `…/remember/0.32.0`) but `gitCommitSha 9f92bc6…` = tag `v0.31.0`. Compare on `version`/`installPath`, not on `gitCommitSha`.

**Catalog vs upstream**: "latest" for a marketplace-pinned plugin is the marketplace pin (e.g. `remember` pinned `d7c4a46` = v0.32.0) even though upstream already has v0.33.0. Only the marketplace maintainer moves the pin. Report upstream-ahead as informational, not drift.

**Apply the same resolution order to the remote side (verification finding)**: `caveman@caveman` is installed as `15581d14007f` because at that commit `.claude-plugin/plugin.json` had no `version`. At remote HEAD `c2906c62…` (2026-09-16) `plugin.json` now carries `"version": "2.7.0"`, so after `claude plugin marketplace update caveman && claude plugin update caveman@caveman` the installed version string becomes `2.7.0`, not `c2906c626be1`. The drift checker must compute "latest" by running the resolution order against the remote tree (`git -C $probe show HEAD:.claude-plugin/plugin.json | jq -r .version` → marketplace entry `version` → `sha[0:12]`), otherwise it will print a misleading "latest" and can never reach `ok` for plugins that switch from sha-keyed to semver.

**plugin-details.json keys**: entries are keyed by the full plugin id `<name>@claude-plugins-official` (e.g. `.plugins["superpowers@claude-plugins-official"]`), which is exactly the `id` that `claude plugin list --json` prints — a bare `superpowers` lookup returns null. The catalog's top-level `marketplace_sha` (`76c85b73…`) lags the `/latest` snapshot pointer (`ea0a38e1…`) and there is a separate `installs_generated_at` (2026-09-11) for the `unique_installs` counters, so the catalog is a per-plugin content/pin source, not the "latest snapshot" source.

### 2.4 Marketplace refresh and auto-update facts (docs + binary)
- `known_marketplaces.json` entries: `{source:{source:"github",repo}, installLocation, lastUpdated, autoUpdate?}`; `autoUpdate` = "Whether to automatically update this marketplace and its installed plugins on startup" (binary schema). Official marketplace defaults on; third-party defaults off.
- Auto-update runs after session start with a random delay ≤ 10 min; notifies to `/reload-plugins`.
- Installing `name@marketplace` refreshes that marketplace first (since v2.1.232), even when auto-update is off, unless refreshed < 30 s ago or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`.
- `claude plugin update --json` prints one JSON result line; `-y` needed when non-TTY for command-source plugins.
- `plugin-catalog-cache.json` (`version:1`, `fetchedAt`, 24 h TTL) also carries per-plugin **token cost** (`tokens.<model>.{always_on,on_invoke}`) — `claude plugin details <name>` prints it (e.g. superpowers: always-on ~688 tok). Useful for the picker's token-cost column.

---

## 3. Codex CLI details

### 3.1 Version and channel endpoints (from `chatgpt.com/codex/install.sh` and `install.ps1`, fetched 2026-09-17)
- `RELEASES_BASE_URL="https://releases.openai.com/codex"`; latest metadata `"$RELEASES_BASE_URL/channels/latest"`; pinned `"$RELEASES_BASE_URL/releases/$version/release.json"`; assets `"$RELEASES_BASE_URL/releases/$version/$asset"`. Fallback when unavailable or `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM=false`: `https://api.github.com/repos/openai/codex/releases/latest` and `…/releases/tags/rust-v$version`, assets from `https://github.com/openai/codex/releases/download/rust-v$version/$asset`. The script itself warns "GitHub API may be unavailable or rate limited."
- Verified: `channels/latest` → `{"tag_name":"rust-v0.154.0","assets":[160 items]}`; `releases/0.154.0/release.json` same shape.
- Env knobs: `CODEX_RELEASE` (`latest` | `x.y.z[-alpha.N]`), `CODEX_NON_INTERACTIVE=1`, `CODEX_INSTALL_DIR` (default `~/.local/bin`; Windows `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`), `CODEX_HOME` (default `~/.codex`).
- Standalone layout: `$CODEX_HOME/packages/standalone/{releases/<ver>-<triple>/bin/codex, current -> …, install.lock}`. `current_installed_version()` = `"$CURRENT_LINK/bin/codex" --version` parsed with the sed above. Old releases are kept (2 here).
- Conflicting installs the script detects and offers to uninstall: brew (`/opt/homebrew/*`, `/usr/local/*` on darwin), npm/bun (launcher starting with `#!/usr/bin/env node`; path containing `.bun` → bun). Windows script: path containing `\.bun\` → bun, `node_modules` or `\npm\` → npm.

### 3.2 `codex doctor --json` (schemaVersion 1) — fields the installer can consume
- `.codexVersion` (`"0.154.0"`), `.generatedAt`, `.overallStatus` (`ok|warning|…`), `.checks.<id>.{status,summary,details,remediation}`.
- `installation.details`: `"PATH codex #1"`, `"current executable"`, `"install context"` = `standalone (unix, package …, bin …, resources …, path …)`, `"managed by npm/bun/pnpm/Vite+"` booleans.
- `runtime.provenance.details`: `version`, `"install method"`, `platform` (`linux-x86_64`), `commit` (`unknown` in the standalone build).
- `updates.status.details`: `"cached latest version"`, `"check for update on startup"`, `"last checked at"`, `"latest version probe"` (**`HTTP 403 Forbidden` on this host = GitHub API rate limit**), `"update action"` (`standalone installer`), `"version cache"` (`~/.codex/version.json`).
- Update-action strings in the binary (exhaustive): `standalone installer`, `npm install -g @openai/codex`, `bun install -g @openai/codex`, `pnpm add -g @openai/codex`, `vp install -g @openai/codex`, `brew upgrade --cask codex`, `manual or unknown`. Latest-version sources in the binary: `https://registry.npmjs.org/@openai%2fcodex`, `https://formulae.brew.sh/api/cask/codex.json`, `https://api.github.com/repos/openai/codex/releases/latest`.
- `codex doctor` takes ~1–2 s (does a live WebSocket handshake) — fine for `--check`.

### 3.3 Install-method detection matrix for the installer (Codex)

| Signal | Method | Update via |
|---|---|---|
| `readlink -f $(command -v codex)` under `$CODEX_HOME/packages/standalone/releases/` (Windows: `%USERPROFILE%\.codex\packages\standalone\current\bin\codex.exe` or launcher in `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`) | standalone | `codex update` or re-run install.sh/ps1 |
| launcher is a node shim (`#!/usr/bin/env node`), path under `$(npm root -g)` / `%APPDATA%\npm` | npm | `npm install -g @openai/codex@latest` |
| path contains `.bun` | bun | `bun install -g @openai/codex` |
| path contains `pnpm` global dir | pnpm | `pnpm add -g @openai/codex` |
| darwin and `/opt/homebrew/*` or `/usr/local/*`; `brew list --cask codex` | brew | `brew upgrade --cask codex` |
| `winget list --id OpenAI.Codex --exact` lists it | winget | `winget upgrade --id OpenAI.Codex --exact` |
| `scoop list codex` (main bucket `codex.json`, `bin\codex.exe`) | scoop | `scoop update codex` |
| `choco list --exact codex` (community pkg `codex` 0.154.0) | choco | `choco upgrade codex` |
| none of the above | manual/unknown | re-run installer (will move the older install aside) |

`codex update` only knows the first five; for winget/scoop/choco it prints `Could not detect the Codex installation method. Please update manually: https://developers.openai.com/codex/cli/` — the installer must never call `codex update` on those hosts and must route through the package manager instead. (winget/scoop/choco commands above are the managers' standard syntax; OpenAI docs do not document them.)

---

## 4. GitHub API: endpoints, limits, auth — and how to avoid it

### 4.1 Limits (docs.github.com, fetched 2026-09-17)
- Unauthenticated: **60 requests/hour per originating IP** (a fleet behind one NAT shares it).
- Authenticated with a PAT / `gh` OAuth token: **5,000/hour** per user; `GITHUB_TOKEN` in Actions: 1,000/hour/repo.
- Headers: `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-used`, `x-ratelimit-resource`, `x-ratelimit-reset` (epoch). Exhausted → HTTP 403 with body `API rate limit exceeded for <ip>…`.
- `GET https://api.github.com/rate_limit` does not count against the primary limit → use it to validate a token (`401 Bad credentials` on an invalid one, as observed here).
- Conditional requests: send `If-None-Match: "<etag>"`; a `304` "does not count against your primary rate limit if … the request was made while correctly authorized with an Authorization header" — i.e. ETag caching only helps **authenticated** callers.

### 4.2 Endpoints the installer might use (only with a validated token)
- Latest release: `GET https://api.github.com/repos/{owner}/{repo}/releases/latest` → `.tag_name`, `.assets[].{name,browser_download_url}`.
- Release by tag: `GET /repos/{owner}/{repo}/releases/tags/{tag}`.
- Tree (skills folder hash): `GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1` → `.sha`, `.tree[]{path,type,sha}`; folder hash = entry with `type=="tree"` and `path=="skills/<name>"`.
- Repo meta / stars: `GET /repos/{owner}/{repo}` → `stargazers_count`, `pushed_at`.
- Headers to send: `Authorization: Bearer $TOKEN`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: super-agent-installer`.

### 4.3 Token discovery (recommended order) and validation
```bash
gh_token() {
  local t="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  [ -z "$t" ] && command -v gh >/dev/null && t="$(gh auth token 2>/dev/null || true)"
  [ -z "$t" ] && return 1
  # validate cheaply; /rate_limit does not consume quota
  local code; code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $t" https://api.github.com/rate_limit)
  [ "$code" = 200 ] && printf '%s' "$t"
}
```
Observed on this host: `gh auth token` returned a token that GitHub rejects (`gh auth status`: "The token in keyring is invalid"). The vercel `skills` CLI deliberately does **not** call `gh auth token`; it shells out to `gh api …` so the credential never enters its process — a good pattern for the installer too (`gh api repos/o/r/git/trees/HEAD?recursive=1`).

### 4.4 API-free alternatives (default for `--check`)
| Need | API-free command | Verified result |
|---|---|---|
| latest stable release tag | `curl -sI https://github.com/<o>/<r>/releases/latest \| awk -F'/tag/' '/^location:/{print $2}' \| tr -d '\r'` | openai/codex → `rust-v0.154.0`; JuliusBrussee/caveman → `v2.7.0`; rtk-ai/rtk → `v0.49.0` |
| all tags (incl. pre-releases, `bin-v*`) | `git ls-remote --tags https://github.com/<o>/<r>.git` | caveman `bin-v1.1.7`, uv `0.12.15`, gum `v2.0.1`, jq `jq-1.8.1` |
| remote HEAD sha | `git ls-remote https://github.com/<o>/<r>.git HEAD` | caveman `c2906c62…`, vercel-labs/skills `1a6f8649…` |
| folder tree sha (skills lock) | `git clone -q --depth 1 --filter=blob:none --no-checkout <url> $d && git -C $d rev-parse HEAD:<folder>` | 0.7 s, 192 KB for caveman; equals `skillFolderHash` |
| a single file at HEAD | `git -C $d show HEAD:.claude-plugin/marketplace.json` (fetches one blob on demand) or `https://raw.githubusercontent.com/<o>/<r>/<ref>/<path>` | works; raw.githubusercontent has no REST quota |
| release feed | `https://github.com/<o>/<r>/releases.atom` | lists pre-releases too; `<title>` is the release *name* (codex `0.155.0-alpha.16` first, no `rust-v` prefix — the tag is in `<id>`/`<link>`) — filter |
| directory listing in a huge repo (winget-pkgs manifests) | `git clone -q --depth 1 --filter=tree:0 --no-checkout https://github.com/microsoft/winget-pkgs.git $d && git -C $d ls-tree --name-only HEAD:manifests/o/OpenAI/Codex \| sort -V \| tail -1` | 0.7 s clone; `0.152.0` (OpenAI.Codex), `2.1.268` (Anthropic.ClaudeCode) on 2026-09-17 |

---

## 5. `--check` (dry-run drift report) design

### 5.1 Behaviour
- Read-only: never touches `~/.claude*`, `~/.codex`, `~/.agents`, `~/.caveman`, npm globals; only writes its own cache under `${XDG_CACHE_HOME:-~/.cache}/super-agent-installer/` (probe clones, catalog JSON, ETags).
- Network budget per run: 1× downloads.claude.ai `latest`, 1× `stable` (only if channel=stable), 1× marketplace `latest`, 1× plugin-details.json (cache 24 h; also usable offline from `~/.claude/plugins/plugin-catalog-cache.json`), 1× releases.openai.com `channels/latest`, N× npm `latest` (one per npm-managed tool), 1× `git ls-remote` per third-party marketplace, 1× blobless clone per skills source repo, 1× 302-probe per GitHub-release tool. Zero `api.github.com` calls unless `--github-api` and a validated token.
- Exit codes: `0` no drift, `10` drift found, `20` probe errors (partial report), so a fleet runner (`ssh host super-agent --check --json`) can aggregate.
- `--json` emits one object per component: `{component, kind, installed, latest, status: ok|drift|unknown|absent|upstream-ahead, source_url, update_cmd, note}`.
- Windows: same probes via PowerShell (`claude --version`, `codex --version`, `Invoke-RestMethod` for the URLs, `git` for ls-remote/clone, `winget list --id …`).

### 5.2 Sample output (real values from this host, 2026-09-17 04:1x UTC)
```
super-agent-installer 0.1.0 --check   host=alexf-ubuntu (Ubuntu 26.04.1, x86_64)   github-api: not used
COMPONENT                                INSTALLED           LATEST              STATUS   UPDATE
claude-code (native, channel=latest)     2.1.273             2.1.274             DRIFT    claude update
  stable channel                         -                   2.1.267             info
  auto-updates                           enabled (protected) -                   note     autoUpdates=false ignored: autoUpdatesProtectedForNative=true; use DISABLE_AUTOUPDATER=1
codex-cli (standalone)                   0.154.0             0.154.0             ok
  codex self-check                       version.json=0.154.0 probe=HTTP 403     warn     codex polls api.github.com; ignore
marketplace claude-plugins-official      76c85b7366c8        ea0a38e1d671        DRIFT    claude plugin marketplace update claude-plugins-official
marketplace caveman (JuliusBrussee)      15581d14007f        c2906c626be1        DRIFT    claude plugin marketplace update caveman
plugin superpowers@official              6.3.0               6.3.0 (pin b36e082) ok
plugin security-guidance@official        2.0.8               2.0.8               ok       (marketplace.json entry says 2.0.7; plugin.json 2.0.8 wins)
plugin remember@official                 0.32.0              0.32.0 (pin d7c4a46) ok      upstream v0.33.0 exists (not pinned yet)
plugin code-review@official (user)       76c85b7366c8        snapshot ea0a38e1   DRIFT    catalog last_updated 2026-02-20 < installed 2026-09-16 → content unchanged; refresh only
plugin code-review@official (project)    unknown             -                   fix      reinstall: claude plugin install code-review@claude-plugins-official --scope project
plugin context7@official                 76c85b7366c8        snapshot ea0a38e1   DRIFT    claude plugin update context7@claude-plugins-official
plugin caveman@caveman                   15581d14007f        2.7.0 (@c2906c62)   DRIFT    claude plugin marketplace update caveman && claude plugin update caveman@caveman   (remote plugin.json now has version 2.7.0)
… (11 more official plugins: 1.0.0/semver ok; 8 snapshot-keyed → DRIFT)
codex plugin superpowers@openai-curated  6.3.0 (remote)      6.3.0               ok
codex plugin plugin-management           0.1.0 (cache)       0.1.0               ok
skills (vercel skills CLI, lock v3)      21 entries          2 repos probed      4 DRIFT  npx skills@latest update -g -y
  caveman                                efae5ae14e1a        02b646b008b9        DRIFT
  caveman-compress                       ed389d78eb82        1f4d964edb53        DRIFT
  caveman-help                           6c85e34cfd41        7f39fe20663e        DRIFT
  caveman-stats                          c0fb6ec46cd2        a2e477b9de0e        DRIFT
  find-skills (vercel-labs/skills)       76a98a285cb0        76a98a285cb0        ok
npm @caveman-ai/cli                      1.3.3               1.3.4               DRIFT    npm install -g @caveman-ai/cli@latest
caveman bins (~/.caveman/bin)            bin-v1.1.6          bin-v1.1.7 (pinned by cli 1.3.4) DRIFT (follows cli update)
npx cache skills                         1.5.23              1.6.0               DRIFT    npx skills@latest
tool uv                                  absent              0.12.15             absent   curl -LsSf https://astral.sh/uv/install.sh | sh
tool gum                                 absent              v2.0.1              absent
tool jq                                  1.8.1               1.8.2               DRIFT    distro upgrade (jq-1.8.2 released 2026-06-20)
tool gh                                  2.46.0              -                   ok       gh token invalid (401) → GitHub API disabled
installer                                0.1.0 (abc1234)     0.1.0               ok
Summary: 21 drift, 2 absent, 1 fix, 0 errors.  Run `super-agent update` to apply, `--dry-run` to preview.
(21 = original 20 + jq, corrected during verification.)
```

### 5.3 Drift rules (normative)
| Component | Compare | Drift when |
|---|---|---|
| claude-code | `claude --version` first token vs `…/claude-code-releases/<channel>` | semver differs (also flag installed > latest as "ahead", e.g. after `claude install <ver>`) |
| codex | `codex --version` second token vs `channels/latest .tag_name` minus `rust-v` | differs |
| official marketplace | `.gcs-sha` vs `/plugins/claude-plugins-official/latest` | differs |
| git marketplace | local `rev-parse HEAD` vs `ls-remote HEAD` (or pinned ref) | differs |
| plugin with semver | installed `version` vs catalog `version` (official, key `<name>@claude-plugins-official`) or, for git marketplaces, the resolution order applied at remote HEAD: `plugin.json version` → marketplace-entry `version` → `sha[0:12]` | differs (a sha-keyed install whose remote now has a semver is drift with latest = that semver) |
| plugin keyed by snapshot sha | installed 12-hex vs current snapshot 12-hex; **content-drift** if catalog `last_updated` > installed `lastUpdated` | differs / content-drift |
| plugin `unknown` | — | always "fix" (reinstall) |
| codex plugin | local cache dir version vs `codex plugin list --json .installed[].version` | differs or cache missing while `installed:true` |
| skills lock | `skillFolderHash` vs `git rev-parse HEAD:<folder>` at remote HEAD (or lock's pinned ref) | differs; `""` hash → skip (well-known source) |
| npm tools | `npm ls -g --json` version vs registry `latest` | differs |
| caveman bins | `.bin-manifest.json .release` vs `BINARY_RELEASE` of installed cli (consistency) and of registry-latest cli (available) | differs |

---

## 6. Popularity / activity numbers observed (dated)
From `plugin-details.json` (`generated_at` 2026-09-16T07:35:21Z, `unique_installs`): superpowers 1,112,404; frontend-design 1,245,390; code-review 476,550; context7 446,283; skill-creator 425,686; code-simplifier 371,594; playwright 352,727; claude-md-management 312,229; feature-dev 271,218; security-guidance 264,175; typescript-lsp 227,188; claude-code-setup 216,255; ralph-loop 204,151; commit-commands 181,242; pr-review-toolkit 122,935; pyright-lsp 118,299; plugin-dev 71,861; remember 59,513; gopls-lsp 44,358. `claude plugin list --json --available` exposes `installCount` for the same data. GitHub star counts were **not** collected (REST limit exhausted on this host; `unknown`).

---

## 7. Open questions
1. `codex plugin list --json` has no "latest" field and `available` is empty on this account; whether a newer remote version is exposed anywhere before it is served is unknown — treat the listing as truth.
2. ~~Docs describe … 7-char sha …~~ **Resolved by verification**: the current plugins-reference page says 12 characters and does not document any `installed_plugins.json` path or the `list --json` field set at all; the shipped 2.1.273 state file is `~/.claude/plugins/installed_plugins.json` (`"version": 2`) and `list --json` rows carry `{id,version,scope,enabled,installPath,installedAt,lastUpdated}` (21 rows here: 20 ids, `code-review` twice for user+project scope). Still recheck on each Claude release (schema is versioned; v1→v2 migration exists in the binary).
3. ~~winget `OpenAI.Codex` latest could not be read~~ **Resolved by verification** (API-free): `git clone -q --depth 1 --filter=tree:0 --no-checkout https://github.com/microsoft/winget-pkgs.git d && git -C d ls-tree --name-only HEAD:manifests/o/OpenAI/Codex | sort -V | tail -1` → `0.152.0` (0.7 s clone; trees fetched on demand). Same for `manifests/a/Anthropic/ClaudeCode` → `2.1.268`. Both winget manifests **lag** the native channels (Codex 0.154.0, Claude 2.1.274/2.1.267), so on winget-managed Windows hosts "latest" must be the winget manifest version, not the vendor channel, or every check reports unfixable drift.
4. ~~gum install/update commands were not re-fetched~~ **Resolved**: fetched from the gum README (see row 16; scoop package is `charm-gum`). jq latest corrected to 1.8.2.
5. `~/.caveman/bin` binaries expose no version; the only handle is `.bin-manifest.json` + the cli's pinned `BINARY_RELEASE`. If the user ever installs bins manually, `caveman --version .binary_release` will disagree with the manifest — report both.
6. The official marketplace `.gcs-sha` fallback for version strings appeared between 2.1.241 and 2.1.273 (exact version unknown); hosts on older Claude Code will keep producing `unknown` entries until updated.

---

## 8. Sources
Local (executed 2026-09-17): `claude --version`, `claude doctor`, `claude plugin list --json [--available]`, `claude plugin details superpowers`, `claude plugin marketplace list --json`, `codex --version`, `codex doctor --json`, `codex plugin list --json`, `codex plugin marketplace list`, `caveman --version`, `npm ls -g --json`, `git ls-remote`, blobless clone test; files `~/.claude.json`, `~/.claude/plugins/{installed_plugins.json,known_marketplaces.json,plugin-catalog-cache.json,marketplaces/*/.gcs-sha}`, `~/.codex/{version.json,packages/standalone/*}`, `~/.agents/.skill-lock.json`, `~/.caveman/bin/.bin-manifest.json`, `$(npm root -g)/@caveman-ai/cli/dist/binaries.generated.js`, `~/.npm/_npx/*/node_modules/skills/{dist/cli.mjs,README.md}`; `strings` of `~/.local/share/claude/versions/2.1.273` and `~/.codex/packages/standalone/releases/0.154.0-x86_64-unknown-linux-musl/bin/codex`.

Remote:
- https://downloads.claude.ai/claude-code-releases/latest , /stable , /2.1.274/manifest.json , /plugins/claude-plugins-official/latest (+ `<sha>.zip` HEAD)
- https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/plugin-stats/plugin-details.json
- https://claude.ai/install.sh (fetched; 260 lines)
- https://code.claude.com/docs/en/setup (install/update/channels/DISABLE_AUTOUPDATER/minimumVersion/WinGet/Homebrew/apt)
- https://code.claude.com/docs/en/discover-plugins (marketplace refresh/auto-update rules, FORCE_AUTOUPDATE_PLUGINS)
- https://code.claude.com/docs/en/plugins-reference (version management, `claude plugin update`)
- https://chatgpt.com/codex/install.sh and https://chatgpt.com/codex/install.ps1 (fetched; 1209 / 1089 lines)
- https://releases.openai.com/codex/channels/latest , /releases/0.154.0/release.json
- https://raw.githubusercontent.com/openai/codex/main/README.md (install commands, CODEX_INSTALLER_USE_RELEASES_OPENAI_COM)
- https://learn.chatgpt.com/docs/codex/cli (redirect target of developers.openai.com/codex/cli)
- https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags , …/@openai/codex/dist-tags , https://registry.npmjs.org/{@caveman-ai%2fcli,skills,ccusage,agent-browser,claude-hud}/latest
- https://formulae.brew.sh/api/cask/{claude-code,claude-code@latest,codex}.json , /api/formula/rtk.json
- https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/codex.json ; https://community.chocolatey.org/api/v2/Packages() (codex, claude-code)
- https://github.com/microsoft/winget-pkgs/tree/master/manifests/o/OpenAI/Codex , …/a/Anthropic/ClaudeCode (existence)
- https://api.github.com/rate_limit (headers), https://api.github.com/repos/JuliusBrussee/caveman/releases/latest (403 body)
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api ; https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api ; https://cli.github.com/manual/gh_auth_token
- https://raw.githubusercontent.com/jarrodwatts/claude-hud/main/{.claude-plugin/plugin.json,.claude-plugin/marketplace.json,README.md}
- https://raw.githubusercontent.com/rtk-ai/rtk/master/README.md ; https://raw.githubusercontent.com/chopratejas/headroom/main/README.md ; https://pypi.org/pypi/headroom-ai/json ; https://raw.githubusercontent.com/astral-sh/uv/main/README.md ; https://raw.githubusercontent.com/vercel-labs/agent-browser/main/README.md
- git ls-remote: openai/codex, JuliusBrussee/caveman, vercel-labs/skills, Digital-Process-Tools/claude-remember, obra/superpowers, rtk-ai/rtk, astral-sh/uv, charmbracelet/gum, jqlang/jq
- Prototype: /tmp/claude-1000/-temp-super-agent-installer/1737cab9-8dc4-4253-8b76-8c91a0a13e9f/scratchpad/drift-check.sh (read-only; produced the numbers in §5.2)

Added during verification (2026-09-17):
- https://raw.githubusercontent.com/charmbracelet/gum/main/README.md (install commands; scoop `charm-gum`)
- https://raw.githubusercontent.com/ccusage/ccusage/main/apps/ccusage/README.md (npx/bunx/pnpm dlx only) ; https://registry.npmjs.org/ccusage/latest (`bin`)
- https://github.com/jqlang/jq/releases.atom (jq 1.8.2, 2026-06-20) ; https://github.com/jqlang/jq/releases/latest (302 → jq-1.8.2)
- https://pypi.org/pypi/headroom-ai/json (`requires_python >=3.10`)
- https://raw.githubusercontent.com/JuliusBrussee/caveman/main/.claude-plugin/{plugin.json,marketplace.json} (version 2.7.0 at HEAD; none at installed commit)
- https://github.com/microsoft/winget-pkgs.git via `--filter=tree:0` partial clone (`manifests/o/OpenAI/Codex` → 0.152.0; `manifests/a/Anthropic/ClaudeCode` → 2.1.268)
- https://learn.chatgpt.com/docs/codex/cli (rendered text: install/update = install.sh)
- https://registry.npmjs.org/skills/1.6.0 tarball (`dist/cli.mjs` check/update/upgrade alias; README)
- Local: `claude plugin update --help`, `claude plugin list --help`, `claude install --help`, `claude update --help`, `codex update --help`, `codex doctor --help`, `codex plugin --help`, `codex plugin marketplace --help`

---

## Verification (skeptical fact-check, 2026-09-17, second researcher)

Method: every remote claim was re-fetched from its primary source (downloads.claude.ai, releases.openai.com, registry.npmjs.org, formulae.brew.sh, PyPI, raw.githubusercontent.com READMEs / plugin.json / marketplace.json / install scripts, docs pages rendered to text, GitHub 302 redirects, `git ls-remote`, blobless/treeless partial clones); every local claim was re-run read-only (`claude --version`, `claude doctor`, `claude plugin list --json [--available]`, `claude plugin marketplace list --json`, `claude … --help`, `codex --version`, `codex doctor --json`, `codex plugin list --json`, `codex … --help`, `caveman --version`, `strings` on both binaries, state files). GitHub REST was still at `x-ratelimit-remaining: 0` (reset epoch 1789620103) and `gh auth token` still returns a 401 token, so no api.github.com data was used.

### Confirmed unchanged (no edit needed)
- Claude Code: `/latest` 2.1.274, `/stable` 2.1.267, manifest 8 platforms; npm dist-tags `{stable:2.1.267,latest:2.1.274,next:2.1.274}`; brew casks 2.1.267 / 2.1.274; choco claude-code 2.1.236. Docs (setup page) confirm every install/pin/update command in row 1 and §2.2 character-for-character, `autoUpdatesChannel` (`latest`|`stable`), `minimumVersion`, `DISABLE_AUTOUPDATER` (background only) vs `DISABLE_UPDATES` (blocks `claude update`/`claude install` too), `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE`, `claude update` messages, WinGet id `Anthropic.ClaudeCode`, `claude doctor` being read-only. Docs additionally say package-manager installs (brew/winget/apk) report `Claude is up to date!` from `claude update`.
- Binary 2.1.273: `n.autoUpdates===!1&&(n.installMethod!=="native"||n.autoUpdatesProtectedForNative!==!0)` present; `fetchOfficialMarketplaceFromGcs` (×2), `.gcs-sha`, `Using marketplace snapshot SHA for`, `plugin-stats/plugin-details.json`, `substring(0,12)` ×8 / `substring(0,7)` ×0. `claude doctor` prints `Auto-updates: enabled` despite `autoUpdates:false` + `autoUpdatesProtectedForNative:true` in `~/.claude.json`.
- Official marketplace: `/plugins/claude-plugins-official/latest` → `ea0a38e1d671…`, local `.gcs-sha` `76c85b7366c8…`, no `.git` dir. `claude plugin list --json` keys `[enabled,id,installPath,installedAt,lastUpdated,scope,version]`; `--available` → `{installed,available}` with `available[].{description,installCount,marketplaceName,name,pluginId,source{source,url,path,ref,sha}}` (278 available). `installed_plugins.json` `"version": 2`; project-scope `code-review` = `unknown` (installed 2026-08-24), user-scope = `76c85b7366c8`; `remember` 0.32.0 with stale `gitCommitSha`. `known_marketplaces.json` `autoUpdate` unset (null) for both marketplaces. Docs (discover-plugins) confirm: official auto-update on / third-party off by default, ≤10 min random delay, named-install refresh since v2.1.232 with the 30 s / `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` / seed-dir exceptions, `FORCE_AUTOUPDATE_PLUGINS=1`.
- `claude plugin update --help` (2.1.273) = `claude plugin update [options] <plugin>` with `--accept-command <sha256>`, `--json`, `-s, --scope`, `-y, --yes`; the docs page shows the same single-`<plugin>` signature. `claude install [target]` (stable|latest|version, `--force`), `claude update|upgrade`.
- plugin-details.json: `generated_at` 2026-09-16T07:35:21Z, 297 plugins, superpowers `{version 6.3.0, sha b36e082…, last_updated 2026-08-12, unique_installs 1,112,404}`, frontend-design 1,245,390, code-review 476,550, context7 446,283; tokens per model (`claude-opus-4-7` always_on 693 for superpowers). Local cache `plugin-catalog-cache.json` `version:1`, `fetchedAt`.
- Codex: `codex --version` → `codex-cli 0.154.0`; install.sh (1209 lines) lines 5–23/323/352/360/379/382/776 match every quoted variable, URL and the sed parse; install.ps1 (1089 lines) lines 902/911/912 match the Windows paths; README lines 19/25/28–35/42/47 match the install commands and `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM=false`; `channels/latest` → `rust-v0.154.0`, 160 assets; `releases/0.154.0/release.json` 200. `codex doctor --json` schemaVersion 1, `install context` = standalone, `latest version probe` = `HTTP 403 Forbidden`, `update action` = `standalone installer`, `cached latest version` 0.154.0; `version.json` shape matches. Binary strings: exactly the 7 update-action strings, the "Could not detect the Codex installation method…" text, and the three version-source URLs. `codex plugin` subcommands = add/list/marketplace/remove (no `update`); `codex plugin marketplace` = add/list/upgrade/remove. `codex plugin list --json` shape and superpowers `installed:true` with no local cache confirmed; local cache has only plugin-management 0.1.0 and openai-templates 0.1.1. npm `@openai/codex` latest 0.154.0 / alpha 0.155.0-alpha.15; brew cask codex 0.154.0; scoop main `codex.json` 0.154.0 (`bin\codex.exe`); choco codex 0.154.0. The Codex CLI docs page (developers.openai.com/codex/cli → 308 → learn.chatgpt.com/docs/codex/cli) documents "Update Codex: `curl -fsSL https://chatgpt.com/codex/install.sh | sh`"; `codex update` exists in the binary (`Update Codex to the latest version`) but is not on that page's visible text.
- skills CLI: npx cache 1.5.23, registry 1.6.0; README lines 66–70 (and 1.6.0 tarball README) state the anonymous → env token → `gh api` → authenticated-clone order and that `gh auth token` is never executed; `dist/cli.mjs` in **both** 1.5.23 and 1.6.0 has `case "check": case "update": case "upgrade": await runUpdate(restArgs)` and no `--dry-run` (only `--json`). Lock v3, 21 skills; `git rev-parse HEAD:skills/caveman` in the local marketplace clone = `efae5ae1…` = lock `skillFolderHash`; blobless probe clone 0.9 s → remote `02b646b0…` (drift confirmed).
- caveman: `caveman --version` JSON 1.3.3 / bin-v1.1.6; `.bin-manifest.json` release bin-v1.1.6 with 6 artifacts; installed cli pins `BINARY_RELEASE = "bin-v1.1.6"`, registry 1.3.4 tarball pins `"bin-v1.1.7"`, download base `https://github.com/JuliusBrussee/caveman/releases/download`; tags `bin-v1.1.7` newest; releases/latest → `v2.7.0`.
- GitHub docs: 60/h unauthenticated (per originating IP), 5,000/h personal, 1,000/h/repo `GITHUB_TOKEN`, `/rate_limit` "does not count against your primary rate limit", headers `x-ratelimit-{limit,remaining,used,reset,resource}`; best-practices page: a 304 does not count "if … the request was made while correctly authorized with an Authorization header". `gh auth token` manual page exists ("outputs the authentication token for an account"). `gh auth status` → "The token in keyring is invalid"; `gh api rate_limit` → 401.
- 302 probes: codex `rust-v0.154.0`, caveman `v2.7.0`, rtk `v0.49.0`, uv `0.12.15`, gum `v2.0.1`, vercel-labs/skills `v1.6.0`. Registry: ccusage 20.0.20, agent-browser 0.38.1 (brew formula 0.38.1 too), claude-hud npm 1.1.0 (empty repository field → unrelated), headroom-ai 0.37.0. claude-hud plugin.json 0.8.0, marketplace entry has no version, README lines 55–56 give exactly `claude plugin marketplace add jarrodwatts/claude-hud` / `claude plugin install claude-hud@claude-hud`. rtk README lines 74/80/91/99 and install.sh (`INSTALL_DIR="${RTK_INSTALL_DIR:-$HOME/.local/bin}"`, itself uses the 302 trick first) match; agent-browser README lines 20–21/38/45 match; uv README lines 50/55/73 match; headroom README lines 91–92 match.

### Corrections applied to the body
1. **jq**: latest is `jq-1.8.2` (releases/latest 302 → `jq-1.8.2`; tag exists; releases.atom dates it 2026-06-20). Installed 1.8.1 is *behind*; the original "installed == latest stable 1.8.1; only 1.8.2rc1 exists" was wrong. Row 17, §5.2 sample and summary count (20 → 21 drift) fixed.
2. **"Docs say 7 chars"**: the current plugins-reference page says "first 12 characters" (archive digests) and "12-character content hash" (command sources) and never mentions 7; it also documents no `installed_plugins.json` path and no `list --json` field list. §2.3 and open question 2 rewritten; the "docs vs binary" discrepancy is withdrawn.
3. **gum**: install/update commands now sourced from the gum README: scoop package is `charm-gum` (not `gum`), plus `go install charm.land/gum/v2@latest`, `winget install charmbracelet.gum`, apt via `repo.charm.sh`. Row 16 and open question 4 fixed.
4. **ccusage**: README documents only `npx ccusage@latest` / `bunx ccusage` / `pnpm dlx ccusage`; `npm install -g ccusage` was reconstructed, not sourced (works because the package has a `bin`, but is undocumented). Row 10 fixed.
5. **headroom-ai**: PyPI `requires_python >=3.10`, not "python 3.13"; `--python 3.13` is the README's uv recommendation. Row 14 fixed.
6. **caveman@caveman "latest"**: remote HEAD `c2906c62…` now has `plugin.json version 2.7.0`, so post-update version = `2.7.0`, not `c2906c626be1`. §2.3 (new paragraph), §5.2 row and §5.3 rule fixed: apply the resolution order on the remote side.
7. **plugin-details.json keys** are `<name>@claude-plugins-official`; catalog `marketplace_sha` lags `/latest`; separate `installs_generated_at` (2026-09-11). Clarified in §2.3.
8. **winget versions resolved API-free**: `OpenAI.Codex` 0.152.0, `Anthropic.ClaudeCode` 2.1.268 (2026-09-17) via `--filter=tree:0` partial clone + `git ls-tree` (0.7 s). Row 2, §4.4 and open question 3 updated. Both lag the vendor channels → on winget hosts compare against the winget manifest, not the vendor channel.
9. **releases.atom**: `<title>` is the release name without the `rust-v` prefix (`0.155.0-alpha.16`); §4.4 wording fixed.
10. `claude plugin list --json` returns 21 rows on this host (20 ids; `code-review` in both user and project scope) — the "20 plugins" figure in the inventory counts ids. Noted in open question 2.

### Not refuted but downgraded
- "Docs additionally list `source`,`description` for `claude plugin list --json`" (row 5): the current page text has no field list; treat the binary's keys as the only truth. (Confidence for that side-note: low; the binary keys: high.)
- "`codex doctor` takes ~1–2 s (live WebSocket check)": timing not re-measured; the `--json` output was produced within the 60 s timeout. (medium)
- Windows standalone launcher/package paths for Codex: confirmed from install.ps1 source only, not on a Windows host. (medium)

### Items removed
None — every URL, package, script and repository referenced in the research resolved (HTTP 200 or a valid git remote) on 2026-09-17.
