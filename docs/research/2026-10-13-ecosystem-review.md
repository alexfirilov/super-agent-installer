# 2026-10-13 review: codebase, component catalog, and ecosystem drift since v0.4.0

Scope: an honest review of the v0.4.0 codebase and `manifest.json`, followed by a survey of the Claude Code, Codex and
MCP ecosystem as of 2026-10-13, and concrete recommendations. Facts marked **[verified]** were checked directly in this
repo or against `npm view` on 2026-10-13. Ecosystem facts come from primary sources: the Claude Code CHANGELOG, the
openai/codex source at HEAD, vendor repos and READMEs, and the claude-plugins-official git log. Anything that could only
be sourced second-hand is marked *UNVERIFIED*.

---

## 1. Verdict in one paragraph

The **engineering is good**, better than most "dotfiles for agents" projects:
- a typed manifest that drives a provider/plan/execute pipeline;
- idempotent detection, with provenance-aware uninstall;
- refusal to rewrite config that does not parse;
- apt collateral-removal checks and checksummed self-update;
- 389 passing tests across Linux, macOS, Windows and Docker CI.

The **problem is not quality, it is velocity**. Three things go stale every week:
- the catalog is compiled into the binary;
- the pins are bumped by hand;
- the popularity and context-cost metadata are typed in by hand.

As a result, three weeks after release:
- 10 of 14 npm pins are behind, including a major-version jump for the caveman CLI;
- one server name is broken by the pinning commit;
- a skills CLI pin will soon write Codex skills to a deprecated path.

The **catalog has also grown into a kitchen sink**: four browser stacks, three planning frameworks, two memory
systems, and several things installed twice (once as a plugin, once as a skill). Claude Code has since shipped built-ins
that cover much of this. The highest-leverage work is:
1. automate freshness;
2. prune and deduplicate the catalog;
3. reformat and slim the code.

---

## 2. Codebase review

### 2.1 What is genuinely good

- **Architecture.** The pipeline is `manifest.json` (zod-validated) → `resolveSelection` (profiles, closure, slots)
  → `planner` (per-kind `Provider.detect/plan`) → `executeGrouped` (tool → agent → setting → plugin → mcp → skill → hook)
  → state file. Adding a component is data-only, and adding a kind is one provider file. That is the right shape.
- **Safety model.** Several mechanisms are each grounded in a real incident that is documented in comments:
  - `byUs` provenance;
  - `aptCollateral` (`apt-get -s` before remove);
  - `JsonParseError` instead of silently overwriting;
  - `previous` restore on uninstall;
  - a SHA-256-checked Node tarball;
  - `mktemp -d` for root scripts;
  - a blast-radius warning on Proxmox and root.

  The comments explain *why*, which is rare and valuable.
- **Tests and CI [verified].**
  - `tsc --noEmit` is clean under `strict` plus `noUncheckedIndexedAccess`.
  - All 51 files and 389 tests pass in about 5s.
  - bats and Pester cover the bootstrap scripts, and there is a Docker distro matrix.
  - Releases carry build-provenance attestations.
- **Honest docs.** The README's exit-code contract, the description of what `check` actually verifies, and the
  caveman-proxy explanation are all good.

### 2.2 What is holding it back

| # | Issue | Evidence | Impact |
|---|---|---|---|
| 1 | **Manifest compiled into the binary** | `src/context.ts` imports `../manifest.json` | Every pin bump or catalog change needs a binary release. This is the structural reason the project "hasn't been updated". |
| 2 | **No freshness automation** | No Renovate or Dependabot. `popularity.observedAt` and `contextCostTokens` are hand-entered (67 and 39 entries, all from 2026-09-17). | Pins and metadata rot weekly (see §2.3). |
| 3 | **Inconsistent pinning** | npm/uvx/go are pinned. Claude plugins track marketplace HEAD, skills track repo HEAD, and there are curl-pipe-to-shell scripts (fnm, NodeSource, scoop, vendor installers). | The "a given release installs a known set" claim in the README is only true for about a third of the components. |
| 4 | **`skills update -g` is global** | `src/providers/skill.ts` runs `npx skills update -g -y` | It also updates skills the user installed by hand, outside the installer's ownership model. |
| 5 | **Pin bump broke an id [verified]** | Commit 848d6fe changed `mcp-n8n-claude` `spec.name` from `n8n-mcp` to `n8n-mcp@2.87.0` | Every future bump registers a new MCP server and orphans the old one. Hosts upgraded from v0.3.0 already have both. Tool names and permission rules carry the version. |
| 6 | **Code density** | 235 KB in 3.1k lines; 138 lines over 200 chars; `parseCli` is a single 982-char line. No formatter or linter is configured. | Diffs are hard to review, and AI agents editing it make collateral mistakes. |
| 7 | **Types declared twice** | `src/types.ts` interfaces mirror the zod schema in `src/manifest/schema.ts` | Drift risk. `z.infer` would remove about 100 lines. |
| 8 | **Per-agent duplication in the manifest** | `mcp-k8s-claude`/`-codex`, `mcp-ha-*`, `mcp-proxmox-*` and `mcp-tailscale-*` each carry their own copy of the pin. context7, exa, GitHub, chrome-devtools and MS Learn are a *plugin* on Claude but a raw MCP on Codex. | Two places to bump. 95 components where about 70 would do. |
| 9 | **Three selection mechanisms** | `defaultSelected`/`forceOffInAll`, profile `include`/`exclude`, and per-component `profiles` overrides. `PROFILE_NAMES` is hard-coded in `types.ts`. | Hard to predict what a profile installs, and adding a profile requires a code change. |
| 10 | **caveman-specific code paths** | `hook.ts` regexes caveman's internal `caveman-proxy … native-hook claude` and undoes its `ANTHROPIC_BASE_URL` write. The statusline provider enum is `'caveman' \| 'claude-hud'`. | This fights a fast-moving third-party tool (CLI 1.3.4 → 2.1.0, repo v3.2.0). It will break silently on its next rewrite. |
| 11 | **2 MB of generated docs** | A 4,641-line plan, a 3,273-line `gap-8-manifest.json`, and a hand-maintained `CATALOG.md` that duplicates the manifest | Stale on arrival, and it misleads future agents that read the repo. |
| 12 | Hidden module-level caches | `WeakMap<Ctx,…>` in claude-plugin, codex-plugin, skill and tool | Works, but the state is invisible. Put it on `ctx` (`ctx.cache`). |
| 13 | Self-update trust | `SHA256SUMS` is fetched from the same release as the binary | Integrity only, not authenticity. The attestation already exists; verify it with `gh attestation verify` when `gh` is present. |

### 2.3 Pin drift after 3 weeks [verified, `npm view`, 2026-10-13]

| Package | Pinned | Latest | Note |
|---|---|---|---|
| @caveman-ai/cli | 1.3.4 | **2.1.0** | Major version. `setup --agent-native` still exists, plus a new `hooks` verb. Retest before bumping. |
| @upstash/context7-mcp | 4.1.1 | 4.3.0 | |
| chrome-devtools-mcp | 1.9.0 | 1.10.1 | |
| n8n-mcp | 2.87.0 | 2.92.1 | Also fix the name (§2.2 #5). |
| agent-browser | 0.38.1 | 0.39.0 | |
| @playwright/cli | 0.1.21 | 0.1.22 | |
| ccusage | 20.0.23 | 20.0.30 | |
| happy | 1.2.4 | 1.2.5 | |
| typescript-language-server | 6.0.0 | 6.0.2 | |
| skills (`SKILLS_CLI`) | 1.6.0 | **1.7.2** | 1.7.x writes Codex global skills to `~/.agents/skills`. 1.6.0 writes to `~/.codex/skills`, which Codex now marks *deprecated*. The lock path can also live at `$XDG_STATE_HOME/skills/`, but the installer hard-codes `~/.agents/.skill-lock.json`. |
| proxmox-mcp-plus (PyPI) | 0.5.18 | 0.6.2 | HTTP auth tightened. Read the changelog first. |
| kubernetes-mcp-server, pyright, tailscale-mcp | – | current | |

---

## 3. What changed in the ecosystem since v0.4.0 (2026-09-20)

### 3.1 Claude Code (v2.1.271 → v2.1.296)

- **Claude Mods (2.1.287, Oct 1).** Plugins can now ship in-process JS/TS that draws panes, adds instant commands,
  and rewrites or auto-approves tool calls. Mods are **on by default and not sandboxed**. This is the biggest new trust
  surface, and it is where status lines and HUDs are heading.
- **Interactive sessions start in auto mode** unless `permissions.defaultMode` is set (2.1.284, Sep 28). Safety
  that used to rely on prompts should now come from deny rules, sandboxing or `onFailure:"block"` hooks.
- **Native AGENTS.md** is read when a project has no CLAUDE.md (2.1.277).
- **claude.ai skills and plugins sync into the CLI** (2.1.275). This may duplicate `document-skills` and
  `skill-creator`: check `/skills` for double entries.
- **Context-cost tooling:** `/skill-doctor` (unused skills and their cost), `/doctor prompt-audit`, and the official
  `session-report` plugin. The installer's hand-typed `contextCostTokens` can be replaced by measurement.
- **MCP tool search is on by default.** Only names load upfront. The description cap went from 2,048 to 4,096
  characters in 2.1.296. As a result, the "Codex MCP count" warning and most per-MCP token budgeting matter much less
  now.
- **Plugin supply-chain hardening:** npm sources are fetched with `--ignore-scripts`, git-backed npm sources are refused,
  and reserved marketplace names are enforced. Also new: `claude plugin install --marketplace <src>` (2.1.292) and
  `claude plugin configure`.
- **No change to LSP:** the `*-lsp` plugins plus language-server binaries are still the documented route.

### 3.2 Codex CLI (0.147 → 0.162.1, about 2 releases a week)

- **Feature flags:** `memories` is stable but **off by default**, so `set-codex-memories` is still useful. `hooks`
  is stable and **on by default**. `tool_search` was removed as a flag because it is always on, so MCP tools are always
  deferred.
- **Plugins** read `.claude-plugin/marketplace.json` too, so Claude-format marketplaces now work in Codex.
  `openai-curated` is git-synced from `openai/plugins` and **includes superpowers**. The `openai-curated-remote` route
  (which needs a ChatGPT login and shows as BLOCKED otherwise) is probably unnecessary. Use `superpowers@openai-curated`,
  or `codex plugin marketplace add obra/superpowers`. *UNVERIFIED whether install prompts for auth.*
- **Skills:** the user root is `~/.agents/skills`, and `$CODEX_HOME/skills` is deprecated (see the skills CLI pin
  above).
- **MCP:** `codex mcp login` can now do a pasted-callback flow with no browser, which is useful for Home Assistant
  OAuth on headless hosts. `mcp_oauth_callback_url` is new. Per-server `default_tools_approval_mode`,
  `enabled_tools`/`disabled_tools` are available.
- Named **permission profiles** (`[permissions]`) now exist alongside `sandbox_mode`.

### 3.3 MCP itself

- **Spec 2026-07-28** is current:
  - stateless core with no `initialize` handshake;
  - HTTP+SSE deprecated;
  - OAuth Dynamic Client Registration deprecated in favour of Client ID Metadata Documents (CIMD);
  - MCP Apps, Tasks and Enterprise Managed Authorization moved into extensions.

  Claude Code speaks it. Codex: *UNVERIFIED*.
- **Vendors now steer coding agents away from MCP and toward CLI + skills.** Playwright's README says so outright.
  Context7 ships a `ctx7` CLI+skills mode. GitHub, Cloudflare and Docker are moving to "code mode".
- **Consensus:**
  - use a CLI when the model already knows it and auth is local (`gh`, `kubectl`, `docker`, `playwright-cli`);
  - use **remote OAuth MCP** for hosted services (Home Assistant, Sentry, Cloudflare, Linear, clouds);
  - output size is now the main remaining token cost, not tool schemas.
- **Security:**
  - Invariant `mcp-scan` is now **Snyk `agent-scan`**, which hashes tool definitions to detect rug pulls.
  - Grafana MCP had two CVEs (CVSS 8.6 and 9.1, both fixed in current versions).
  - n8n-mcp had about 10 GHSAs, mostly in HTTP/multi-tenant mode.
  - `mcp-remote` has an unfixed CVE, so use native HTTP transports.

### 3.4 Cross-harness

- **The installer could adopt rulesync instead of reimplementing.** rulesync (v33, very active) generates rules, MCP,
  skills, hooks and permissions for about 40 harnesses. `docker mcp client connect` registers servers across about 9
  harnesses.
- **Harnesses worth targeting next:** OpenCode, GitHub Copilot CLI and Cursor CLI, because all of them read
  `.agents/skills` and `AGENTS.md`. Gemini CLI was sunset for individuals in favour of Antigravity CLI (*UNVERIFIED
  detail*).

---

## 4. Catalog review: keep, change, drop, add

### 4.1 Redundant or overlapping (prune these)

| Overlap | Recommendation |
|---|---|
| **Four browser stacks:** playwright MCP plugin, playwright-cli, agent-browser, chrome-devtools-mcp | Default to **playwright-cli + its skill**, as Microsoft now recommends for coding agents. Keep chrome-devtools-mcp as an optional *debugging* tool (perf traces, network) in `--slim` mode with `--no-usage-statistics`. Drop the playwright MCP plugin. Make agent-browser an alternative in the same `browser` slot, not an addition. |
| **Three planning frameworks:** superpowers, compound-engineering, planning-with-files | Keep **superpowers**: v7.0.0 (Oct 9), about 298k stars, and now in the official marketplace. Leave the other two off by default, in the same `methodology` slot. Built-in `/goal`, `/loop` and agent teams cover more every month. |
| **Two memory systems:** `remember` plugin plus native auto memory (on by default) | **Drop `remember` from defaults.** It makes extra Haiku calls and auto-pushes `~/.remember` to a git remote if its parent directory is a repo. |
| **Installed twice:** mattpocock (plugin + skills), caveman (plugin + Codex skill), obsidian (plugin + skill) | Use the plugin on Claude and the skill on Codex only. Enforce this with a `conflictsWith` check that understands agent targets, or one component that has per-agent routes (§5.3). |
| **serena** alongside 3 LSP plugins | serena's README now says *"Do not install Serena via an MCP or plugin marketplace"*: use `uv tool install -p 3.13 serena-agent` then `serena init`. Keep it optional and Codex-leaning, since Codex has no LSP. |
| **happy** | Partly redundant with native Claude Remote Control and Codex remote control. Keep it optional and off by default. |
| **claude-md-management** | Overlaps `/init`, `/doctor prompt-audit` and auto memory. Make it optional. |

### 4.2 Change in place

- **security-guidance is now 2.0.13 and runs an Opus LLM review of the diff on every Stop.** That is a real token
  cost on a must-have default. Ship it with `ENABLE_STOP_REVIEW=0` (a setting component), or swap it for on-demand
  `claude-security`.
- **caveman:** it is now a product, with a local proxy in front of your subscription, **telemetry on by default**, and a
  commercial "Caveman Cloud". Independent tests put its savings at about 4–5% of session tokens; it withdrew its 75%
  claim in v1.9.1. Recommendations:
  - demote it from must-have;
  - run `caveman telemetry off` as a post-install step;
  - keep the hooks-only design;
  - pin the plugin's marketplace ref.

  This would let §2.2 #10 shrink.
- **Proxmox MCP:**
  - change the default `PROXMOX_USER=root@pam` to a dedicated PVE user with a scoped role;
  - bump to 0.6.x after reading its HTTP-auth changes.
- **Home Assistant:**
  - matches the current docs; mcp-proxy is no longer needed;
  - warn when `HA_URL` is `http://` and the target is Claude Code, since the docs say Claude Code connects over HTTPS
    only;
  - use Codex's new pasted-callback `mcp login` on headless hosts.
- **n8n:**
  - fix the name;
  - n8n now has a **built-in instance MCP server** (2.13+, beta, OAuth/token), so add it as the official route and keep
    `czlonkowski/n8n-mcp` + `n8n-skills` as the richer optional pairing.
- **superpowers on Codex:** switch from `openai-curated-remote` to `openai-curated` or the repo's own marketplace, so it
  is not BLOCKED without a ChatGPT login.
- **grafana-mcp:** require a version with both CVE fixes (≥ 2.0.x is fine).

### 4.3 Stale sources: replace

These skill packs had no commits in 2–5 months:

| Pack | Last commit |
|---|---|
| bagelhole/devops-security-agent-skills | May |
| akin-ozer/cc-devops-skills | Jul |
| basher83/lunar-claude | Jul |
| bastos/skills (proxmox-admin) | Aug |
| vercel-labs/agent-skills | Aug |

Most have only hundreds of installs. Replace them with:
- **trailofbits/skills**, for security, Linux hardening and audits. It is actively maintained by a reputable firm.
- **hashicorp/agent-skills**, if you do IaC.
- For Proxmox: there is no good skill. Keep the MCP (least-privilege token) and write **your own small `proxmox`
  skill** in this repo (`pvesh`, `qm`, `pct` patterns plus your conventions). That is more valuable than a stranger's
  7-star pack.

### 4.4 Worth adding (ranked for agentic coding plus homelab)

1. **`session-report` plugin (official)** and a `doctor` hint to run `/skill-doctor`. These measure what this large
   install actually costs and what goes unused, which closes the loop on pruning.
2. **trailofbits/skills** (see above).
3. **homeassistant-ai/skills** (`home-assistant-best-practices`), which fixes common agent mistakes in HA configs.
   *UNVERIFIED whether the org is official.*
4. **Cloudflare remote MCP** (`mcp.cloudflare.com/mcp`, OAuth, code mode covers about 2,500 endpoints in roughly 1k
   tokens), if you run DNS, tunnels or Zero Trust on Cloudflare.
5. **Sentry remote MCP** (`mcp.sentry.dev/mcp`, OAuth), for debugging loops if you use Sentry.
6. **MCP Toolbox for Databases** (`googleapis/genai-toolbox`) for self-hosted Postgres and others. The reference
   `server-postgres` is archived and `crystaldba/postgres-mcp` is stale.
7. **n8n built-in MCP** plus **n8n-skills** (see above).
8. **Snyk `agent-scan`** as an opt-in `doctor --scan-mcp` check that detects tool-definition changes after install.
9. **The `blast-radius`-style guard** for the proxmox-host profile: a hook or mod that holds `rm -rf`, `qm destroy` and
   force-push for confirmation. This matters more now that auto mode is the default.
10. Optional, if used: Linear remote MCP (read-only `/mcp/readonly`), Terraform MCP, AWS/GCP managed MCP, crowdsec.

**Skip:**
- `claude-mem` (duplicates auto memory);
- `wshobson/agents` and `everything-claude-code` (huge context cost);
- `desktop-commander` (duplicates built-ins);
- `context-mode`: ELv2 licence, no npm release since June, and deferred tool loading removed most of its benefit;
- Tailscale: there is no official MCP; the `tailscale` CLI is enough unless you buy Aperture.

---

## 5. Recommended changes to the code (ordered by leverage)

### 5.1 Make freshness automatic (fixes the root cause)

1. **Decouple the catalog from the binary.** The binary keeps a bundled manifest as a fallback but fetches
   `manifest.json` from the release (or a `catalog` tag) on `update`. Verify it with the same SHA256SUMS and attestation
   as the binary. A catalog change then no longer needs a new binary, and `update` picks it up.
2. **Renovate** with a regex manager over `manifest.json` (`"pkg@x.y.z"`, `==x.y.z` for uvx, `@vX.Y.Z` for go) and
   `src/pins.ts`. Bump PRs then appear automatically and CI validates them. Group them weekly, and keep major versions
   such as caveman 2.x as separate PRs.
3. **A weekly scheduled workflow** (`catalog-refresh.yml`) that:
   - refreshes `popularity` from npm, GitHub and the skills.sh API;
   - checks every `marketplaceSource` and skill repo for last-commit age, flagging anything idle for 90+ days;
   - checks that every Claude plugin still exists in its marketplace's `marketplace.json`;
   - opens a PR.

   A Claude Code GitHub Action can write the summary ("superpowers 7.0.0 shipped, security-guidance now runs a Stop
   review").
4. **Pin plugins and skills by git ref**, where the CLIs allow it:
   - marketplace `source` with a `#ref`;
   - `npx skills add owner/repo#<sha>`.

   Let Renovate's git-refs manager bump them. Replace the global `skills update -g` with per-component re-adds at the
   pinned ref.

### 5.2 Slim the code

1. Add **Biome** (format and lint), run it once, and enforce it in CI. On its own this makes the 982-char lines
   reviewable.
2. Derive types from zod: `export type Component = z.infer<typeof component>`, and delete the parallel interfaces in
   `types.ts`.
3. Make profiles data-only. Remove `PROFILE_NAMES` from code and validate `--profile` against `manifest.profiles`. Pick
   **one** selection mechanism:
   - profile `include`/`exclude` over a base set;
   - drop either the per-component `profiles` overrides or `forceOffInAll`.
4. Move the WeakMap caches onto `ctx.cache`.
5. Generate `CATALOG.md` from the manifest in `scripts/` (`bun run catalog`). Move `docs/superpowers/plans`,
   `docs/research/reports/gap-*` and `gap-8-manifest.json` into an `archive/` folder, or delete them; git history keeps
   them.

### 5.3 Collapse per-agent duplication in the manifest

Allow one component to target both agents, with per-agent routes:

```jsonc
{ "id": "mcp-k8s", "agents": "both", "spec": { "kind": "mcp", "name": "k8s", "transport": "stdio",
  "command": "npx", "args": ["-y", "kubernetes-mcp-server@0.0.67", "--read-only"],
  "claude": { "via": "mcp" }, "codex": { "extra": { "default_tools_approval_mode": "writes" } } } }
```

Do the same for "plugin on Claude, skill on Codex" pairs, such as caveman and mattpocock:

```jsonc
{ "id": "caveman", "routes": { "claude": { "kind": "claude-plugin", ... }, "codex": { "kind": "skill", ... } } }
```

This removes about 20 components and every duplicated pin, and it makes "installed twice" impossible by construction.

### 5.4 Small fixes (one PR)

- `mcp-n8n-claude`: set `spec.name` back to `n8n-mcp`. Add a manifest test asserting that no `spec.name` contains `@`
  or a version. Add a one-time migration that removes a stale `n8n-mcp@2.87.0` entry.
- Bump the pins in §2.3, except caveman 2.x and `SKILLS_CLI` 1.7.x, which each need their own tested PR:
  - caveman: retest `setup --agent-native`;
  - skills: the Codex path moves, so handle the lock at `$XDG_STATE_HOME/skills/` and detection and uninstall from both
    paths.
- Proxmox `PROXMOX_USER` default: drop `root@pam` and ask for the user.
- Warn when Home Assistant uses `http://` with a Claude target.
- Add a `security-guidance` companion setting `ENABLE_STOP_REVIEW=0` (opt-in to the review instead).
- Run `caveman telemetry off` and `skills` with `DISABLE_TELEMETRY=1`. chrome-devtools gets `--no-usage-statistics`.
- `doctor`: check `permissions.defaultMode` (auto mode is now the default) and list installed mods.

### 5.5 Later, if you want multi-harness

Don't hand-write a third and fourth MCP and instructions writer. Either:
- emit a `.rulesync/` source of truth and shell out to `rulesync`; or
- use `docker mcp client connect` for MCP registration.

Keep this installer's value where it is unique: host bootstrap, auth, secrets, provenance and safe uninstall.

---

## 6. Suggested default set after pruning (the `all` profile)

| Area | Default on | Optional |
|---|---|---|
| **Methodology** | superpowers | compound-engineering, planning-with-files, mattpocock |
| **Code intelligence** | ts/pyright/gopls LSP plugins | serena (via `uv tool`) |
| **Docs and search** | context7 (or `ctx7` CLI+skills) | exa, microsoft-docs |
| **Browser** | playwright-cli + skill | chrome-devtools-mcp (`--slim`), agent-browser |
| **Git and GitHub** | `gh` CLI, commit-commands | GitHub remote MCP (read-only) |
| **Security** | trailofbits/skills, security-guidance (Stop review off) | claude-security |
| **Workflow helpers** | frontend-design, skill-creator, hookify, feature-dev | claude-hud, document-skills, ui-ux-pro-max |
| **Token, usage and cost** | ccusage, session-report | caveman (hooks only, telemetry off) |
| **Homelab** (homelab profile) | HA remote MCP + HA skill, k8s read-only, Proxmox MCP (scoped token), own `proxmox` skill | n8n built-in MCP + n8n-skills, Cloudflare, Grafana |
| **Remove/disable** (keep as is) | – | code-review, code-simplifier, ralph-loop, claude-code-setup, plugin-dev, pr-review-toolkit |
| **Drop** | – | playwright MCP plugin, remember, context-mode, cc-devops-skills, bagelhole, bastos, lunar-claude, vercel agent-skills |
