# GAP-FILL 8 — Component prerequisite, conflict and context-cost matrix for the picker (default = ALL)

Researched 2026-09-17 on Ubuntu 26.04 with Claude Code 2.1.273 and Codex CLI 0.154.0. Read-only against the user's real config: every plugin measurement below was made in a **throwaway `CLAUDE_CONFIG_DIR`** under the scratchpad (`gap8-throwaway/`), which was deleted afterwards (the `~/.claude`, `~/.claude.json`, `~/.codex` mtimes were checked before/after and did not change). The machine-readable manifest draft is at
`/tmp/claude-1000/-temp-super-agent-installer/1737cab9-8dc4-4253-8b76-8c91a0a13e9f/scratchpad/research/gap-8-manifest.json` (95 components; generator script `scratchpad/gap8-build-manifest.py`; raw `claude plugin details` output in `scratchpad/gap8-details.txt`).

## 0. Headline findings

1. **A literal "install everything" in the manifest would cost ~23k always-on tokens per Claude session** (sum of the Claude-side plugin+skill estimates in the manifest after the verification correction in §2.1 — was reported as ~20.3k before the throwaway numbers were rescaled; before hook-injected context and before gstack, which is unmeasured) versus ~7.9k today and ~4.5k estimator / ~7.6k real (incl. the superpowers ~1.1k and caveman ~2.0k SessionStart injections) for the manifest's default set. The picker must show a running token total and treat the default profile as "everything that is cheap and non-conflicting", not "everything".
2. **Anthropic already publishes per-plugin token costs for every official-marketplace plugin** (`plugin-details.json`; 297 plugins in the 2026-09-16T07:35Z snapshot used here, 308 in the 2026-09-17T07:36Z regeneration — see Verification; same data Claude Code caches in `~/.claude/plugins/plugin-catalog-cache.json`, 24 h TTL). The installer can read `tokens.claude-opus-4-7.always_on` for any official plugin **without installing it**. Only third-party marketplace plugins need the `claude plugin details` probe; those were measured here (table in §2).
3. **The estimator under-counts hooks.** `claude plugin details` labels hooks "harness-only — no model context cost", but superpowers' SessionStart hook cats `skills/using-superpowers/SKILL.md` (3,108 chars ≈ 1.1k tokens) into `additionalContext` on every startup/clear/compact, caveman's `caveman-activate.js` prints the filtered ruleset (measured 5,739 chars ≈ 2.0k tokens at the default `full` level — see Verification), planning-with-files re-injects plan context per turn, claude-mem injects memory. MCP tool schemas are also excluded ("resolved at runtime; not counted") — fine on Claude (tool search defers them) but **Codex has no deferral**, so every Codex MCP server is always-on.
4. **Per-skill cost model verified**: across the 248 official plugins with components the estimator gives min 25 / p25 93 / **median 149** / mean 163 / p90 283 / max 445 tokens per component (skills + agents + commands). Pure skills are cheaper: caveman ≈ 76/skill, superpowers ≈ 49/skill, compound-engineering ≈ 60/skill, mattpocock ≈ 65/skill, document-skills ≈ 190/skill. The "~100 tokens/skill" rule of thumb from the skills digest is a fair upper-middle estimate; the exact driver is frontmatter length at ≈ 2.75 chars/token (median of the catalog). The user's 24 `~/.agents/skills` (Codex-side) sum to 5,440 frontmatter chars ≈ **2.0k tokens per Codex session**, 20 of them caveman.
5. **Node 24 is the single prerequisite that removes the most failure modes**: `skills` 1.6.0 needs ≥22.20.0, `@caveman-ai/cli` 1.3.4 ≥22.13, `context-mode` ≥22.5.0, **`typescript-language-server` 6.0.0 ≥22.22.2 (this host runs 22.22.1 → `npm warn EBADENGINE`; npm 9.2 still installs because `engine-strict` is false, runtime behaviour on 22.22.1 unverified)**, `agent-browser` 0.38.1 ≥24.0.0, `chrome-devtools-mcp` 1.9.0 `^20.19||^22.12||>=23`, claude-mem ≥20.12 **and** bun ≥1.1.31 (npm registry, 2026-09-17).
6. **uv is a second-tier prerequisite** shared by serena-agent (PyPI `requires_python <3.15,>=3.11`; README `uv tool install -p 3.13 serena-agent`), headroom-ai (≥3.10), specify-cli/spec-kit (≥3.11), snyk-agent-scan (≥3.10) and claude-mem (auto-installs it). It is missing here; the manifest auto-selects `tool:uv` when any dependant is picked.
7. **Eight single-owner slots** must be encoded (§3): statusline, PreToolUse-Bash rewriter, API proxy (`ANTHROPIC_BASE_URL`/`model_provider`), tool-output compressor layer, memory (Claude), memory (Codex), Codex `notify`, Codex `hooks.json` writer; plus two "pick one primary" groups (methodology bundle, browser stack) and a "one channel per skill family per agent" duplication rule.
8. **Nine items are forced OFF even in ALL mode** (§4), each with a cited reason: caveman agent-native Codex (rewrites `model_provider`), caveman CLI shrink-hook + rtk (two `updatedInput` rewriters; JetBrains A/B shows rtk +7.6 % cost), headroom/pxpipe (custom `ANTHROPIC_BASE_URL` disables MCP tool search and Remote Control), claude-mem (hosted CMEM Pro sign-in pre-selected; 481 MB; bun+uv), all memory plugins (auto memory is on by default; ≤1), agent-browser (Node 24 floor; Snyk MEDIUM/Runlayer HIGH), plugin-dev / pr-review-toolkit (2.35k / 2.04k tokens), example-skills (duplicates frontend-design + skill-creator), mattpocock-skills plugin (1,614 tokens; `triage` Gen MEDIUM) in favour of a 4-skill cherry-pick.

## 1. Method

* Official plugins: `https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/plugin-stats/plugin-details.json` (local copy `scratchpad/plugin-details.json`, `marketplace_sha 76c85b7366c8`, `installs_generated_at 2026-09-11`), field `tokens.claude-opus-4-7.always_on` (sonnet values are ≈0.68×).
* Third-party plugins: `CLAUDE_CONFIG_DIR=<scratch> claude plugin marketplace add <repo>` + `claude plugin install <p>@<mkt> --json` (no `-y`, so any command-source install would have been refused; none were) + `claude plugin details <p>@<mkt>`. Snapshot: 2026-09-17 ~04:27 UTC. **Verification caveat (2026-09-17): in a throwaway profile with no login, `claude plugin details` cannot reach the `count_tokens` API and silently falls back to a chars÷4 heuristic (`scaleCharsToTokens`, telemetry `count_tokens_unreachable`), so the raw §2.1 numbers are ~1.45× too low versus the catalog/logged-in tokenizer; §2.1 now carries a corrected column.** Side effect: the clones + caches used 1.4 GB of the 5.6 GB `/tmp` tmpfs (claude-mem alone 481 MB, context-mode 169 MB, superpowers-chrome 135 MB) and hit the user quota; the throwaway was removed. **Installer implication: plugin caches are not small; a default-all run on a Proxmox node with a small `/tmp`/home will fail on disk, so pre-check free space.**
* Prerequisites: `https://registry.npmjs.org/<pkg>/latest` (`engines`), `https://pypi.org/pypi/<pkg>/json` (`requires_python`), the plugin manifests/`hooks.json`/`.mcp.json` inside the throwaway cache, the official LSP plugin READMEs (raw.githubusercontent.com), code.claude.com docs (statusline, sandboxing, mcp, hooks-guide), docs.claude-mem.ai/installation, and the twelve existing digests.
* Per-skill cost: distribution computed over the catalog; personal skills estimated from frontmatter (`name` + `description`) chars ÷ 2.75. The `/context` interactive check on a throwaway profile was **not** run (it needs a logged-in profile and spends API tokens; RULES forbid state-changing `claude` runs). The catalog-derived numbers come from the same estimator Claude Code uses, so they are as good as `/context` would be for the "skills" line.

## 2. Measured always-on token costs (Claude Code, claude-opus-4-7 estimator)

### 2.1 Newly measured 2026-09-17 (throwaway profile, `claude plugin details`; corrected column added by verification — the raw column is the offline fallback estimator, see Verification §V1)

| Plugin (version) | Always-on tok (raw, offline chars÷4 fallback) | **Corrected opus est. (×4÷2.76)** | Components | Hooks | MCP | Uncounted extras | Cache size |
|---|---:|---:|---|---|---|---|---|
| compound-engineering@compound-engineering-plugin 3.26.3 | ~2,110 | **~3,060** | 35 skills | 0 | 0 | — | 91 MB |
| claude-mem@thedotmack 13.25.1 | ~1,472 | **~2,130** | 20 skills | 7 (Setup, SessionStart, UserPromptSubmit, PostToolUse, PreToolUse, Stop, SessionEnd) | 1 (`mcp-search`, uncounted) | memory injected at SessionStart; worker process | **481 MB** |
| example-skills@anthropic-agent-skills (34040c9c) | ~939 | **~1,360** | 12 skills (incl. frontend-design, skill-creator duplicates) | 0 | 0 | — | small |
| document-skills@anthropic-agent-skills (34040c9c) | ~759 | **~1,100** | 4 skills (docx, pdf, pptx, xlsx) | 0 | 0 | — | small |
| planning-with-files@planning-with-files 3.18.3 | ~735 | **~1,065** | 14 skills | 6 (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact, Stop) | 0 | per-turn plan re-injection | 19 MB |
| context-mode@context-mode 1.0.169 | ~631 | **~915** | 8 skills | 6 (PreToolUse on Bash/WebFetch/Read/Grep/Agent/ctx_*, PostToolUse, PreCompact, UserPromptSubmit, SessionStart, Stop) | 1 in plugin.json (`node ${CLAUDE_PLUGIN_ROOT}/start.mjs`; details shows 0) | sandboxed-output MCP tools (11, deferred) | 169 MB |
| episodic-memory@superpowers-marketplace 1.6.0 | ~83 | **~120** | 1 skill + 1 agent | 1 (SessionStart sync) | 1 (uncounted) | — | small |
| elements-of-style@superpowers-marketplace 1.0.0 | ~65 | **~94** | 1 skill | 0 | 0 | ~12k tok on invoke | small |
| superpowers-chrome@superpowers-marketplace 3.0.5 | ~58 | **~84** | 1 skill + 1 agent | 0 | 1 (`chrome`, uncounted) | — | 135 MB |
| claude-hud@claude-hud 0.8.0 | ~0 | **0** | 2 commands (setup, configure) | 0 | 0 | statusline process only | 45 MB (node_modules) |

### 2.2 From Anthropic's catalog (`plugin-details.json`, generated 2026-09-16T07:35Z)

| Plugin | Always-on tok | Components | Notes |
|---|---:|---|---|
| plugin-dev | **2,354** | 7 skills + 3 agents + 1 cmd | heaviest on this host |
| pr-review-toolkit | **2,038** | 6 agents + 1 cmd | second heaviest |
| mattpocock-skills 1.2.3 | **1,614** | 25 skills | `triage` audited Gen warn/MEDIUM |
| chrome-devtools-mcp 1.9.0 | 809 | 7 skills + MCP (58 tools, deferred) | |
| claude-security 0.11.0 | 699 | 1 skill + 8 agents + 3 hooks | |
| superpowers 6.3.0 | 693 | 14 skills + SessionStart hook | **+~1.1k hook-injected** (using-superpowers SKILL.md) |
| hookify | 297 | 1 skill + 1 agent + 4 cmds + 4 python hooks | hooks on every tool call |
| feature-dev | 243 | 3 agents + 1 cmd | |
| claude-md-management 1.0.0 | 180 | 1 skill + 1 cmd | |
| claude-code-setup 1.0.0 | 144 | 1 skill | |
| skill-creator | 117 | 1 skill | |
| commit-commands | 108 | 3 cmds | |
| ralph-loop 1.0.0 | 89 | 3 cmds + Stop hook | |
| frontend-design | 83 | 1 skill | |
| remember 0.32.0 | 78 | 1 skill + 1 cmd + 4 hooks | |
| session-report | 75 | 1 skill | |
| code-simplifier 1.0.0 | 69 | 1 agent | |
| code-review | 25 | 1 cmd | |
| security-guidance 2.0.8 | 0 | 5 hooks (bash+python) | |
| context7, playwright, github, serena, gitlab, linear, firebase | 0 | MCP only (schemas deferred by tool search) | on Codex: all tools always-on |
| typescript-lsp, pyright-lsp, gopls-lsp, rust-analyzer-lsp, clangd-lsp, csharp-lsp, jdtls-lsp, kotlin-lsp, lua-lsp, php-lsp, swift-lsp | 0 | `lspServers` only; binary NOT installed by the plugin | |
| caveman@caveman (third-party; from `raw/plugin-details.txt`, 2026-09-16) | **1,814** | 21 skills + 3 agents + 2 hooks | + ruleset printed by `caveman-activate.js` |
| (reference) vercel 0.49.2 / huggingface-skills 1.0.28 / posthog | 3,992 / 5,111 / 30,167 | 35 / 25 / 164 skills | shows why "all official plugins" is impossible: the 297-plugin catalog sums to **433,948** always-on tokens |

### 2.3 Per-skill cost model (verified from the catalog)

| Statistic (tokens per component, opus estimator, 248 plugins) | Value |
|---|---:|
| min / p25 / median / mean / p75 / p90 / max | 25 / 93 / 149 / 163 / 214 / 283 / 445 |
| chars of `name`+`description` per token (median) | 2.75 |
| skill frontmatter chars: median / mean / p90 | 418 / 470 / 856 |
| sonnet ÷ opus ratio (median) | 0.68 |

Personal skills on this host (`~/.agents/skills`, loaded natively by Codex; only `find-skills` is linked into `~/.claude/skills`): 24 skills, 5,440 chars ≈ **1,978 tokens/Codex session** (avg 82/skill; `find-skills` 121, `caveman-learn` 119, `job-application-assistant` 119, `caveman-help` 49). The claimed "~100 tokens/skill" is therefore slightly high for terse authors (caveman, superpowers ≈ 50-90) and low for Anthropic's document skills (≈190).

### 2.4 Budget of the manifest's default profile (Claude side)

superpowers 693 + caveman 1,814 + commit-commands 108 + skill-creator 117 + frontend-design 83 + document-skills ~1,100 (corrected; raw 759) + elements-of-style ~94 (raw 65) + find-skills 121 + mattpocock cherry-pick (4 skills) ~320 = **~4,450 estimator tokens** (was 4,080 before the §2.1 correction), + ~1.1k superpowers hook + ~2.0k caveman ruleset (measured) ≈ **~7.6k real** (target ≤ 6k estimator, warn at 8k; the caveman ruleset alone is the largest single default item). Today's 20-plugin install is ~7.9k estimator + the same hidden extras. Everything else in the manifest is opt-in with its cost displayed. Codex default profile ≈ 3.9k (superpowers 690 est., caveman skills ~1.5k, document skills ~1,100 (corrected), frontend-design 83, mattpocock cherry-pick ~320, find-skills 121) + full tool schemas of context7 (2 tools) and playwright (~27 default tools per the playwright-mcp README 2026-09-17; 73 with every `--caps` group).

## 3. Conflict groups (single-owner slots and pick-one groups)

| Slot | Members | Max | Default in ALL | Rule / evidence |
|---|---|---|---|---|
| **statusline** (Claude) | plugin:claude-hud, statusline:caveman-badge, cli:ccstatusline, statusline:ccusage | 1 | claude-hud (respect existing owner on `update`; merge the caveman badge snippet into whichever wins) | `settings.json` has one `statusLine` object (docs statusline; user or project settings). Windows: commands run through Git Bash if installed, else PowerShell; use forward slashes; `.ps1` via `powershell -NoProfile -File`. caveman "does not overwrite" an existing statusLine. |
| **bash-rewriter** (Claude PreToolUse `updatedInput` on Bash) | cli:caveman-cli-shrink-hook, cli:rtk, headroom-desktop `headroom-rtk-rewrite.sh`, token-optimizer | 1 | none | hooks-guide: "When multiple PreToolUse hooks return updatedInput … the last one to finish takes effect. Since hooks run in parallel, the order is non-deterministic. Avoid having more than one hook modify the same tool's input." |
| **api-proxy** | cli:caveman-cli (agent-native claude/codex → `model_provider = "caveman"`), cli:headroom (`ANTHROPIC_BASE_URL`), cli:pxpipe, tamp, claude-code-router | 1 | none | docs mcp: "Configurations without tool search include a custom ANTHROPIC_BASE_URL, ENABLE_TOOL_SEARCH=false…"; Remote Control unavailable behind non-`api.anthropic.com` hosts (≥2.1.196); Codex `model_provider` is a single key and caveman strips/rewrites its marker blocks. |
| **tool-output-compressor** | plugin:context-mode, cli:caveman-cli (proxy), cli:rtk, cli:headroom | 1 | none | same layer (token-efficiency digest 1.8: "pick one"); context-mode adds PreToolUse hooks on Bash/Read/Grep/WebFetch/Agent. |
| **memory (Claude)** | plugin:remember, plugin:claude-mem, plugin:episodic-memory, cavemem (part of caveman CLI) | 1 | none (built-in auto memory stays on) | each injects at SessionStart; auto memory loads MEMORY.md (first 200 lines/25 KB) every session; three stores are already active on this host (auto memory + remember + cavemem). |
| **memory (Codex)** | setting:codex.memories (`[features] memories = true`), cavemem via agent-native | 1 | codex.memories | native, off by default on 0.154.0 |
| **codex-notify** | setting:codex.notify (installer template), cli:tokentracker, cli:agent-notifications | 1 | installer template | `notify` is one top-level TOML key; TokenTracker and agent-notifications both write it (token-efficiency digest 6). |
| **codex-hooks-writer** (`~/.codex/hooks.json`) | installer's declarative merge, caveman agent-native codex, context-mode manual fallback, agent-notifications, planning-with-files (skills route copies `.codex/hooks`) | 1 | installer merge | each tool rewrites the file with its own merge/marker logic; every new/changed hook is untrusted until `/hooks` → trust. Plugin-bundled hooks (context-mode, remember, planning-with-files, claude-mem Codex plugins) bypass the file — prefer those routes. |
| **claude-notify** | setting:claude.notification-hook, cli:agent-notifications | 1 (soft) | installer template | hooks merge, but two Notification hooks = double toasts. |
| **methodology-primary** | plugin:superpowers, plugin:compound-engineering (2,110), plugin:gstack (unmeasured, est. 3-5k), plugin:planning-with-files (735), BMAD, ECC | 1 primary | superpowers | overlapping brainstorm/plan/TDD/review skill descriptions → wrong-skill triggering + tokens (plugins digest 5). `superpowers-dev`: "YOU MUST UNINSTALL OTHER VERSIONS". |
| **browser-automation** | plugin:playwright, plugin:chrome-devtools-mcp (809 + 58 tools), plugin:superpowers-chrome (BETA), cli:agent-browser (Node 24), gstack browser | 1 per agent | playwright | duplicated tool sets; on Codex every tool is always-on. |
| **skill-channel duplication** | e.g. caveman: plugin:caveman (Claude) vs `npx skills add … -a claude-code`; superpowers plugin vs `npx skills add obra/superpowers`; document-skills plugin vs skills CLI `-a claude-code`; example-skills vs frontend-design/skill-creator plugins; caveman Codex: skills route vs `codex plugin add caveman@caveman` | 1 channel per family per agent | plugin on Claude, skills CLI on Codex | duplicate `/name` (Claude) and `$name` (Codex) entries, double cost (skills digest 5.7). |
| **built-in overlaps** | code-review plugin vs `/code-review`; code-simplifier vs `/simplify`; ralph-loop vs `/loop`,`/goal`; claude-security vs `/security-review`; serena vs LSP plugins (Claude); GitHub MCP vs `gh` | n/a | built-in | plugins digest 5 |
| **Codex plugin route** | `<name>@openai-curated-remote` (ChatGPT login only, server-side state) vs git marketplace (`codex plugin marketplace add owner/repo` + `codex plugin add name@mkt`, works with API keys) | 1 per plugin | remote when `codex login status` = ChatGPT, else git-mkt | gap-1: remote catalog empty under API-key/no auth; `openai-curated` snapshot reserved and frozen. |

## 4. Forced-OFF even in "ALL" (with cited reason)

| Item | Reason (source) |
|---|---|
| cli:caveman-cli agent-native **codex** | writes `model_provider = "caveman"` + `[model_providers.caveman]` + `[mcp_servers.caveman]` + `~/.codex/hooks.json`; all Codex traffic goes through the local gateway; conflicts with any corporate provider (token-efficiency 1.5). Linux/macOS only (Codex hooks disabled on Windows). |
| cli:caveman-cli-shrink-hook and cli:rtk | both are PreToolUse Bash `updatedInput` rewriters → non-deterministic when stacked (hooks-guide); rtk: JetBrains July 2026 A/B "median +7.6 % more expensive per task (p=0.004)" at low effort, +0.1 % at high. |
| cli:headroom, cli:pxpipe (and tamp/CCR) | custom `ANTHROPIC_BASE_URL` pointing at a non-first-party host = MCP tool search auto-disabled (all MCP schemas load up-front, can cost more than saved; docs mcp "Configure tool search" — `ENABLE_TOOL_SEARCH=true` can force it back on only if the proxy forwards `tool_reference` blocks) and no Remote Control (docs remote-control, ≥2.1.196, verified 2026-09-17); pxpipe README admits silent confabulations on hex strings. |
| plugin:claude-mem | installer pre-selects the hosted "CMEM Pro / claude-mem observer" via OAuth to cmem.ai (opt out with `--provider claude` or `CLAUDE_MEM_ONLINE_OPTIN=false`); needs Node ≥20.12 **and** bun ≥1.1.31, auto-installs bun + uv; 481 MB cache; 7 hooks + worker; 1,472 tok; overlaps auto memory (docs.claude-mem.ai/installation, fetched 2026-09-17; npm engines; throwaway measurement). |
| plugin:remember, plugin:episodic-memory (memory slot) | ≤1 memory plugin; built-in auto memory on by default (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` to disable). `remember` remains the cheapest choice (78 tok) if the user opts in; on `update` an already-installed memory plugin is kept. |
| cli:agent-browser + skill:agent-browser | `engines.node >=24.0.0` (host 22.22.1); skills.sh audit Snyk warn/MEDIUM + Runlayer fail/HIGH (advisory); playwright already covers browsing. |
| plugin:plugin-dev, plugin:pr-review-toolkit | 2,354 and 2,038 always-on tokens; use `claude plugin enable/disable` per project. |
| plugin:mattpocock-skills (plugin form) | 1,614 tok for 25 skills; `triage` Gen warn/MEDIUM (COMMAND_EXECUTION, RCE, INDIRECT_PROMPT_INJECTION). Default profile cherry-picks grill-me/handoff/tdd/to-spec via skills CLI (~320 tok). |
| plugin:example-skills | 939 tok and duplicates frontend-design + skill-creator already installed as official plugins. |
| plugin:compound-engineering, plugin:gstack, plugin:planning-with-files, BMAD, ECC | methodology slot already owned by superpowers; CE 2,110 tok; gstack needs Bun + bundled Chromium and self-updates hourly outside the installer lock; planning-with-files Runlayer fail/HIGH + per-turn re-injection. |
| plugin:hookify | 4 python hooks on every PreToolUse/PostToolUse/Stop/UserPromptSubmit + 297 tok; no Codex consumer. |
| plugin:github / mcp:github-readonly | needs a PAT secret; 60+ tools always-on on Codex; `gh` CLI is the default path. |
| Codex MCP set > 5 servers | no tool-search deferral on Codex (mcp digest 4.3). |
| Any skill whose skills.sh audit returns `fail` from Gen/Snyk/Socket | abort; Runlayer `fail` and any MEDIUM/HIGH → warn + opt-in (skills digest 9; `curl -s https://skills.sh/api/v1/skills/audit/<owner>/<repo>/<skill>`). |

## 5. Prerequisite matrix (verified 2026-09-17)

| Prerequisite | Needed by | Evidence |
|---|---|---|
| **Node ≥ 24** (recommended floor) | skills 1.6.0 (`>=22.20.0`), @caveman-ai/cli 1.3.4 (`>=22.13`), context-mode 1.0.169 (`>=22.5.0`), typescript-language-server 6.0.0 (`>=22.22.2` — host 22.22.1 fails), agent-browser 0.38.1 (`>=24.0.0`, `pnpm>=11`), chrome-devtools-mcp 1.9.0 (`^20.19.0 || ^22.12.0 || >=23`), claude-mem (`>=20.12.0`), @upstash/context7-mcp 4.1.1 (`>=20.18.1`), tokentracker-cli (`>=20`), @playwright/mcp 0.0.81 (`>=18`), claude-hud (`>=18.0.0` from the GitHub repo `package.json` — the npm package named `claude-hud` is an unrelated project; README: Windows Node only, no Bun), pyright 1.1.414 (`>=14`), ccstatusline (`>=14`), ccusage (no engines) | `https://registry.npmjs.org/<pkg>/latest` |
| **bun ≥ 1.1.31** | claude-mem (hard engines), gstack | npm engines; gstack README |
| **uv** (Python ≥3.10/3.11) | serena-agent 1.7.0 (`<3.15,>=3.11`; `uv tool install -p 3.13 serena-agent`), headroom-ai 0.37.0 (`>=3.10`), specify-cli 1.0.7 (`>=3.11`), snyk-agent-scan 0.6.3 (`>=3.10`), claude-mem (auto-installs) | PyPI JSON; oraios/serena README |
| **python3** on PATH | hookify (`python3 …/hooks/*.py`), security-guidance (`bash sg-python.sh …/*.py`), planning-with-files Codex hooks (`python3 .codex/hooks/run_sh.py`), Codex hook examples | plugin `hooks/hooks.json` files |
| **Git Bash** (Windows) | Claude command hooks/statusline (`bash` scripts, `sed`, `$(…)` in caveman plugin.json), security-guidance bash wrapper, caveman-statusline.sh, agent-notifications installer; else write exec-form `node`/`powershell` hooks and `.ps1` statusline | docs statusline Windows section; gap-4 §3 |
| **bubblewrap + socat** (Linux/WSL2) | Claude sandboxed Bash (`sudo apt-get install bubblewrap socat`; optional seccomp `npm install -g @anthropic-ai/sandbox-runtime`; Ubuntu 24.04+ AppArmor userns profile); Codex sandbox (`bwrap`, bundled fallback; AppArmor note) — native Windows: Claude sandbox unsupported, Codex uses Windows sandbox | code.claude.com/docs/en/sandboxing; learn.chatgpt.com/docs/sandboxing |
| **Go** | gopls-lsp (`go install golang.org/x/tools/gopls@latest`) — missing here | plugins/gopls-lsp/README.md |
| **rustup** | rust-analyzer-lsp (`rustup component add rust-analyzer`) | plugins/rust-analyzer-lsp/README.md |
| **npm globals** | typescript-lsp: `npm install -g typescript-language-server typescript`; pyright-lsp: `npm install -g pyright` or `pip install pyright` / `pipx install pyright` (Windows: pip for a real .exe; npm `.cmd` shim bug) | LSP READMEs; gap-4 §1.10 |
| **gh** (authenticated) | commit-commands PR flow, code-review `--comment`, GitHub without MCP; keyring token invalid on this host | local-inventory-audit 6 |
| **ChatGPT login** | any `<name>@openai-curated-remote` Codex plugin (superpowers remote, compound-engineering remote, github connector, codex-security); API-key hosts must use git marketplaces | gap-1 §1-5 |
| **Secrets** | `CONTEXT7_API_KEY` (optional), `GITHUB_PERSONAL_ACCESS_TOKEN` (github plugin/MCP), claude-mem provider keys | plugin `.mcp.json` `${VAR}` refs |
| **Disk** | plugin caches: claude-mem 481 MB, thedotmack marketplace clone 275 MB, context-mode 169 MB, superpowers-chrome 135 MB, compound-engineering 91 MB, chrome-devtools-mcp 63 MB, claude-hud 45 MB, mattpocock 27 MB; a default-all run blew a 5.6 GB tmpfs quota here | `du -sh` in throwaway cache |
| **Chrome/Chromium** | chrome-devtools-mcp, superpowers-chrome, gstack; playwright downloads its own browsers (`npx playwright install`) | plugin READMEs |

## 6. Manifest schema (devcontainer-feature.json style) and excerpt

Every component in `gap-8-manifest.json` has: `id` (namespaced `agent:|tool:|marketplace:|plugin:|codex-plugin:|skill:|mcp:|setting:|cli:|statusline:`), `kind`, `name`, `agents` (`["claude"]|["codex"]|["both"]`), `platforms`, `prerequisites[]` (human strings incl. `tool:` refs), `dependsOn[]` (hard DAG), `conflictsWith[]`, `slot` (single-owner group or null), `defaultSelected`, `contextCostTokens` (Claude opus estimator; `null` = unknown), `contextCostSource`, `contextCostNote` (uncounted extras / audit), `install` (map keyed by `*|sh|ps1|linux|darwin|windows|claude|codex|json|toml`), `updateCommand`, `versionProbe`, `verdict`, `why`, `source`, and optionally `forceOffInAll` + `forceOffReason`. Top-level `slots{}` declares `max`, `default`, `rule`; `budget{}` declares the 6k default / 8k warn thresholds and the Codex MCP cap.

```jsonc
{
  "id": "plugin:claude-mem", "kind": "plugin", "name": "claude-mem@thedotmack", "agents": ["claude"],
  "platforms": ["linux","darwin","windows"],
  "prerequisites": ["tool:node>=20.12", "tool:bun", "tool:uv"],
  "dependsOn": ["agent:claude", "marketplace:thedotmack"],
  "conflictsWith": ["plugin:remember", "plugin:episodic-memory"],
  "slot": "memory", "defaultSelected": false, "forceOffInAll": true,
  "forceOffReason": "hosted provider opt-out required; heavy; overlaps auto memory (docs.claude-mem.ai/installation, fetched 2026-09-17)",
  "contextCostTokens": 1472, "contextCostSource": "claude plugin details in throwaway CLAUDE_CONFIG_DIR, Claude Code 2.1.273, 2026-09-17",
  "install": {"claude": "claude plugin install claude-mem@thedotmack --scope user --json"},
  "updateCommand": "claude plugin update claude-mem@thedotmack",
  "versionProbe": "claude plugin list --json | jq '.[]|select(.id==\"claude-mem@thedotmack\")|.version'"
}
```

Picker rules derived from the manifest: (1) start from the `all` profile = every component with `defaultSelected: true`; (2) show `forceOffInAll` items unchecked with their reason; (3) enforce `slots` (radio groups) and `conflictsWith` (uncheck the other side with a notice); (4) auto-check `dependsOn` and resolve `tool:` prerequisites (node version compare, uv, go, rustup, git-bash, bubblewrap) — a component whose prerequisite cannot be satisfied on the host is shown disabled with the reason (e.g. typescript-lsp on Node 22.22.1, gopls-lsp without Go, sandbox on native Windows); (5) keep a running Claude always-on total (estimator + a fixed +1.1k for superpowers' hook) and a Codex MCP-server counter; (6) on `update`, existing slot owners win over defaults.

## 7. Exact commands used (copied from sources)

* Official catalog: `curl -fsS https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/plugin-stats/plugin-details.json | jq '.plugins["<id>@claude-plugins-official"].tokens'`
* Local probe: `claude plugin details <name>[@marketplace]` (2.1.273; needs the marketplace clone present — after I deleted the official clone the official plugins reported "not found"; to load one from disk the flag is global: `claude --plugin-dir <path> plugin details <name>` — `claude plugin details --plugin-dir` errors "unknown option" on 2.1.274; there is no `--json` on `details`)
* Enable/disable without uninstall: `claude plugin enable <plugin>` / `claude plugin disable <plugin>`
* Third-party refresh: `claude plugin marketplace update <name>` then `claude plugin update <plugin>@<name>`
* Skills: `npx -y skills@1.6.0 add <owner/repo> --skill <name> -g -a claude-code -a codex -y`; `npx skills update -g -y`; `npx skills list`; audit `curl -s https://skills.sh/api/v1/skills/audit/<owner>/<repo>/<skill>`
* Codex: `codex plugin add <name>@<marketplace> --json`; `codex plugin marketplace add <owner/repo>`; `codex plugin marketplace upgrade --json`; `codex mcp add context7 --url https://mcp.context7.com/mcp`; `codex mcp add playwright npx "@playwright/mcp@latest"`; `codex login status`
* Prereqs: `sudo apt-get install bubblewrap socat`; `npm install -g @anthropic-ai/sandbox-runtime`; `npm install -g typescript-language-server typescript`; `npm install -g pyright`; `go install golang.org/x/tools/gopls@latest`; `rustup component add rust-analyzer`; `uv tool install -p 3.13 serena-agent`; `uv tool install --python 3.13 "headroom-ai[all]"`; `uv tool install specify-cli`; `uvx snyk-agent-scan@latest ~/.agents/skills`
* Token savers (opt-in): `npm install -g @caveman-ai/cli && caveman setup --install`; `caveman setup --agent-native claude`; `caveman tools config set think.shrink off`; rtk `curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh` then `rtk init -g`
* claude-mem non-hosted: `npx claude-mem install --provider claude` or `CLAUDE_MEM_ONLINE_OPTIN=false`

## 8. Open questions

1. `claude plugin details` reports context-mode "MCP servers (0)" although `plugin.json` declares `mcpServers` inline; claude-mem's `.mcp.json` is counted. Whether inline `mcpServers` is loaded at runtime was not exercised.
2. gstack's always-on cost is unmeasured (clone-based install into `~/.claude/skills`, not a marketplace plugin); estimate 3-5k from 64 skills.
3. Codex-side per-plugin costs are estimates (same SKILL.md files); Codex has no `plugin details` equivalent. `/status` in the TUI would show the real number.
4. The `/context` cross-check on a throwaway profile was not run (needs login + API spend).
5. Whether Claude's `enabledPlugins` toggling (vs uninstall) also drops the plugin's MCP servers from the prompt cache without a restart — docs say enable/disable invalidates the cache; batch changes between sessions.
6. Disk-quota behaviour: `/tmp` tmpfs with `usrquota` on this host; the installer should `df` the plugin cache location before a default-all run.

## Sources

* https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/plugin-stats/plugin-details.json (local copy `scratchpad/plugin-details.json`, generated 2026-09-16T07:35Z)
* Local: `claude plugin details` (2.1.273) in throwaway `CLAUDE_CONFIG_DIR` (2026-09-17; `scratchpad/gap8-details.txt`); `claude plugin --help`, `claude plugin install --help`, `claude plugin marketplace add --help`; `codex plugin --help` (0.154.0); plugin manifests, `hooks/hooks.json`, `.mcp.json`, `package.json` inside the throwaway cache; `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/hooks/session-start`; `~/.claude/plugins/cache/caveman/caveman/15581d14007f/src/hooks/caveman-activate.js`; `~/.agents/skills/*/SKILL.md`; `~/.agents/.skill-lock.json`
* npm registry `…/latest`: skills, agent-browser, @caveman-ai/cli, ccusage, ccstatusline, context-mode, claude-mem, @playwright/mcp, chrome-devtools-mcp, typescript-language-server, pyright, @upstash/context7-mcp, tokentracker-cli (2026-09-17)
* PyPI JSON: serena-agent, headroom-ai, specify-cli, snyk-agent-scan, claude-monitor (2026-09-17)
* https://raw.githubusercontent.com/oraios/serena/main/README.md ; https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/{gopls-lsp,typescript-lsp,pyright-lsp,rust-analyzer-lsp}/README.md ; https://raw.githubusercontent.com/jarrodwatts/claude-hud/main/README.md
* https://code.claude.com/docs/en/statusline ; https://code.claude.com/docs/en/sandboxing ; https://code.claude.com/docs/en/mcp (tool search) ; https://code.claude.com/docs/en/hooks-guide (updatedInput note, local copy `scratchpad/cc-hooks-guide.md` line 963) ; https://learn.chatgpt.com/docs/sandboxing (local `scratchpad/sandboxing.md`)
* https://docs.claude-mem.ai/installation (fetched 2026-09-17)
* Digests in this folder: claude-plugins-landscape.md, token-efficiency-and-workflow-tools.md, skills-ecosystem.md, mcp-servers-landscape.md, security-supply-chain.md, codex-cli-install.md, claude-code-install.md, local-inventory-audit.md, installer-architecture-options.md, platform-specifics.md, gap-1.md, gap-3.md, gap-4.md

## Verification

Fact-checked 2026-09-17 (afternoon UTC) by re-fetching every primary source and re-running the cheap local probes in fresh throwaway dirs (`CLAUDE_CONFIG_DIR`/`CODEX_HOME`/`HOME` under the scratchpad, deleted afterwards; `~/.claude`, `~/.claude.json`, `~/.codex`, `~/.agents` untouched). The host's Claude Code auto-updated to **2.1.274** between the original research and this pass (report measurements were on 2.1.273). Pre-verification copy: `gap-8.md.pre-verify`.

### V1. Major correction — the §2.1 throwaway numbers were the offline fallback estimator

* `claude plugin details` (2.1.274 binary, `computePluginTokenCost`) builds the always-on text (`plugin:skill` name + description) and calls the Claude **`count_tokens` API** for the model list (`[rt()]` = current model). Only when that call returns a value does it print real tokenizer counts (telemetry `cli_plugin_details`). When the API is unreachable — which is exactly the case in a throwaway `CLAUDE_CONFIG_DIR` with no login — it falls back to `scaleCharsToTokens(chars, chars, undefined, 4)` = **chars ÷ 4** and logs `count_tokens_unreachable`. Nothing in the output says which path was used.
* Reproduced: installing the cached official `frontend-design` and `superpowers` into a throwaway profile via a local marketplace and running `claude plugin details` gives **59** and **584** tokens, versus **83** and **693** in Anthropic's catalog (= the logged-in `count_tokens` numbers; the 2026-09-16 real-profile run in `raw/plugin-details.txt` also gave 690/80). Same for `claude --plugin-dir` loads from cache: remember 53 vs 78, plugin-dev 1,704 vs 2,354, caveman 1,244 vs 1,814. Ratios 1.19–1.47, median catalog chars/token 2.76 (259 plugins with components, 2026-09-17 catalog) → correction factor **×4÷2.76 ≈ ×1.45**. The model setting (`settings.model`, `--model`, `ANTHROPIC_MODEL`) does not change the fallback number.
* Consequence: every §2.1 "Always-on" value measured in the throwaway (compound-engineering, claude-mem, example-skills, document-skills, planning-with-files, context-mode, episodic-memory, elements-of-style, superpowers-chrome) was **~30 % low**. §2.1 now has a corrected column; §0.1, §2.4 and the manifest sums were updated (default profile ~4,450 estimator tokens instead of 4,080; full Claude-side manifest ≈ 23k instead of 20.3k). The caveman 1,814 and all catalog values were already real counts and are unchanged. `gap-8-manifest.json` still carries the raw values for the nine throwaway-measured plugins — the generator must apply the ×1.45 correction (or re-measure in a logged-in profile) before the manifest is used for budgeting.
* Installer implication: never trust `claude plugin details` output from a non-logged-in profile; prefer the catalog for official plugins, and for third-party plugins run `details` in the user's real (logged-in) profile after install, or scale chars÷2.76.

### V2. Other corrections to the body

| # | Claim in report | Finding | Fix applied |
|---|---|---|---|
| 1 | `--plugin-dir <path>` loads a plugin for `claude plugin details` | The option is global: `claude --plugin-dir <path> plugin details <name>` works; `claude plugin details <name> --plugin-dir <path>` → `error: unknown option '--plugin-dir'`. `details` has no `--json` either (`error: unknown option '--json'`). | §7 line rewritten |
| 2 | Catalog: 297 plugins, total 433,948 tokens, `generated_at` 2026-09-16T07:35Z | Correct for the snapshot used. The live file regenerated at **2026-09-17T07:36:36Z**: **308 plugins, total 448,644**, `marketplace_sha ea0a38e1d671…`. All plugins cited in §2.2 have identical token values; only `remember` moved to 0.33.0 (78 tokens unchanged). `~/.claude/plugins/plugin-catalog-cache.json` (fetchedAt 2026-09-17T04:08Z) still holds the 09-16 snapshot, consistent with the 24 h TTL. | §0.2 wording |
| 3 | Per-component stats 25/93/149/163/214/283/445 over 248 plugins | Recomputed on the 09-17 catalog: 259 plugins, **25/93/152/165/214/284/445**, chars/token median 2.76, sonnet/opus 0.68. Within rounding. | none |
| 4 | claude-hud engines `node>=18.0.0` listed under "npm registry" evidence | Comes from the GitHub repo `package.json` (0.8.0). The npm package `claude-hud` (1.1.0, 2026-03-10, no `engines`) is an **unrelated** status-line project. README Requirements: Claude Code v1.0.80+, macOS/Linux Node 18+ or Bun, Windows Node 18+. | §5 row annotated |
| 5 | ccusage 20.0.20 (2026-08-15) | npm latest is **20.0.21**, published 2026-09-17T12:24Z (after the report); still no `engines`. | JSON item updated |
| 6 | typescript-language-server ≥22.22.2 "fails"/"EBADENGINE" on Node 22.22.1 | npm 9.2.0 on this host has `engine-strict=false`, so `npm install -g` prints `npm warn EBADENGINE` and proceeds; whether 6.0.0 runs on 22.22.1 was not tested. | §0.5 wording |
| 7 | Custom `ANTHROPIC_BASE_URL` disables MCP tool search | Docs (mcp, "Configure tool search"): disabled when the URL points to a non-first-party host "since most proxies don't forward `tool_reference` blocks"; **`ENABLE_TOOL_SEARCH` set explicitly overrides that fallback**. Remote Control unavailability behind a non-`api.anthropic.com` host confirmed (remote-control doc, ≥2.1.196). | §4 row nuanced |
| 8 | caveman ruleset injection "uncounted" | Measured: running `caveman-activate.js` (cache 15581d14007f) with a fake SessionStart payload in a throwaway HOME/CLAUDE_CONFIG_DIR prints **5,739 chars ≈ 2.0k tokens** (level `full`, plus a statusline-setup nudge when no `statusLine` is configured). `caveman/SKILL.md` is 7,022 chars; the hook filters it to the active level. | §0.3, §2.4 |
| 9 | episodic-memory Codex install `npm install -g github:obra/episodic-memory && codex plugin marketplace add /path/to/episodic-memory` | Reconstructed. README/docs/CODEX.md route: clone, `npm run build`, `codex features enable plugin_hooks`, `codex plugin marketplace add /path/to/episodic-memory`, then install/enable from the `/plugins` TUI (marketplace "Episodic Memory Dev") and trust the hook in `/hooks`; needs codex-cli ≥0.130.0. `npm install -g github:obra/episodic-memory` is the opencode/npm-package route. | JSON item updated |
| 10 | mattpocock `triage` Gen warn/MEDIUM | skills.sh audit (2026-09-17): Gen **and Snyk** warn/MEDIUM; superpowers `brainstorming` additionally has Socket `warn` (Gen SAFE, Snyk LOW, Runlayer fail/HIGH). Others as reported. | JSON fact updated |
| 11 | playwright "~29 tools always-on on Codex" | playwright-mcp README (2026-09-17): 25 core + 1 tab tool (+ browser-install) by default ≈ 27; 73 tools with every `--caps` group. | §2.4 |
| 12 | 24 `~/.agents/skills`, 5,440 frontmatter chars ≈ 1,978 tokens | Recount (name + collapsed description): 24 skills, 5,269 chars ≈ 1.9k at 2.75 chars/token — within 3 %. Codex uses a different tokenizer, so treat as ±20 %. | none |
| 13 | "Nine items forced OFF even in ALL" (§0.8) vs §4 table (13 rows) | The manifest marks `forceOffInAll: true` on only **5** components (claude-mem, caveman-cli, rtk, headroom, pxpipe); the remaining §4 rows are just `defaultSelected: false`. Generator/manifest inconsistency, not a factual error; flagged for the manifest author. | none (noted) |
| 14 | spec-kit `specify init <project> --integration claude`, `specify integration install codex`, `specify self upgrade` | Confirmed: README example `specify init my-project --integration copilot`; integrations reference lists keys `claude` and `codex` and `specify integration install <key>`; upgrade page `specify self upgrade`. | none |

### V3. Confirmed unchanged (primary sources re-fetched 2026-09-17)

* npm `engines` (registry `/latest`): skills 1.6.0 `>=22.20.0`; @caveman-ai/cli 1.3.4 `>=22.13`; context-mode 1.0.169 `>=22.5.0`; typescript-language-server 6.0.0 `>=22.22.2`; agent-browser 0.38.1 `node >=24.0.0, pnpm >=11.0.0`; chrome-devtools-mcp 1.9.0 `^20.19.0 || ^22.12.0 || >=23`; claude-mem 13.25.1 `bun >=1.1.31, node >=20.12.0`; @upstash/context7-mcp 4.1.1 `>=20.18.1`; tokentracker-cli 0.97.2 `>=20`; @playwright/mcp 0.0.81 `>=18`; pyright 1.1.414 `>=14.0.0`; ccstatusline 2.2.29 `>=14.0.0`; pxpipe-proxy 0.13.2 `>=20.19`; @anthropic-ai/sandbox-runtime 0.0.76 `>=20.11.0`.
* PyPI `requires_python`: serena-agent 1.7.0 `<3.15,>=3.11` (2026-08-09); headroom-ai 0.37.0 `>=3.10`; specify-cli 1.0.7 `>=3.11` (2026-09-15); snyk-agent-scan 0.6.3 `>=3.10` (2026-09-10); claude-monitor 4.0.0 `>=3.9`.
* READMEs: serena `uv tool install -p 3.13 serena-agent`, `serena setup codex`, `claude mcp add --scope user serena -- serena start-mcp-server --context claude-code --project-from-cwd` (oraios.github.io clients page); LSP plugins `go install golang.org/x/tools/gopls@latest`, `npm install -g typescript-language-server typescript`, `npm install -g pyright` / `pip install pyright` / `pipx install pyright`, `rustup component add rust-analyzer`; rtk `curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh`, `rtk init -g`, `rtk init -g --codex`, `brew install rtk`; headroom `uv tool install --python 3.13 "headroom-ai[all]"`, `headroom wrap claude`, `headroom unwrap <tool>`, `headroom update`; gstack clone+`./setup`, `./setup --host codex`, Bun v1.0+, once-per-hour silent auto-update check; agent-notifications commit-pinned `setup.sh` (a512deb5…) with `-s -- --product both`; uv `curl -LsSf https://astral.sh/uv/install.sh | sh`, `winget install --id=astral-sh.uv -e`, `uv self update`; caveman `npx skills add JuliusBrussee/caveman --skill '*' -a codex --yes -g` (README line 145), install.sh prints "Existing statusline detected — caveman badge NOT added"; claude-hud `claude plugin marketplace add jarrodwatts/claude-hud`, `claude plugin install claude-hud@claude-hud`, `/claude-hud:setup`, `refreshInterval`, `CLAUDE_HUD_DISABLE=1`; playwright `codex mcp add playwright npx "@playwright/mcp@latest"` (README line 146; also executed successfully in a throwaway `CODEX_HOME`, writes `[mcp_servers.playwright] command="npx" args=["@playwright/mcp@latest"]`).
* Docs: statusline (single `statusLine` object, `padding`, `refreshInterval` min 1; Windows → Git Bash if installed else PowerShell; forward slashes; `powershell -NoProfile -File C:/Users/username/.claude/statusline.ps1`); sandboxing (macOS/Linux/WSL2 only; `sudo apt-get install bubblewrap socat` / `sudo dnf install bubblewrap socat`; optional `npm install -g @anthropic-ai/sandbox-runtime`; Ubuntu 24.04+ AppArmor `bwrap` userns profile); hooks-guide line 963 (multiple PreToolUse `updatedInput` → last to finish wins, non-deterministic, avoid); memory (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; MEMORY.md first 200 lines / 25 KB); Codex memories doc (`[features] memories = true`, "off by default"); docs.claude-mem.ai/installation (CMEM Pro pre-selected via cmem.ai OAuth, `--provider claude`, Node 20+, Bun ≥1.0 and uv auto-installed, `npm install -g claude-mem` = SDK only, Codex CLI listed as host); `CLAUDE_MEM_ONLINE_OPTIN=false` is in the GitHub README (line 155), not on the installation page.
* CLI surfaces: `claude plugin install` has `--scope`, `--json`, `-y`, `--accept-command`, `--config`; `claude plugin list --json` emits `id`/`version`/`scope`/`enabled`/`installPath` (manifest `versionProbe` jq is valid); `claude plugin update <plugin>` ("restart required"); `claude plugin marketplace add|list|remove|update`; `codex plugin add|list|marketplace|remove` (`add` has `--json`, `-m/--marketplace`), `codex plugin marketplace add|list|upgrade|remove`, `codex mcp add <NAME> (--url <URL> | -- <COMMAND>...)` with `--bearer-token-env-var`, `codex login status`; skills 1.6.0 `add` flags `-g`, `-a`, `-s/--skill`, `-y`, `--copy`, `--all`; `update -g -y`.
* superpowers 6.3.0 hook: `hooks/hooks.json` SessionStart matcher `startup|clear|compact` → `run-hook.cmd session-start`, which cats `skills/using-superpowers/SKILL.md` (3,108 bytes) into `hookSpecificOutput.additionalContext`. hookify hooks: `python3 "${CLAUDE_PLUGIN_ROOT}/hooks/{pretooluse,posttooluse,stop,userpromptsubmit}.py"`, no matcher. security-guidance: `bash sg-python.sh …` on SessionStart/UserPromptSubmit/PostToolUse(×8)/Stop/SubagentStop. context-mode `plugin.json` declares inline `mcpServers.context-mode = node ${CLAUDE_PLUGIN_ROOT}/start.mjs` (open question 1 stands: `details` counts only `.mcp.json`). superpowers-marketplace still lists `superpowers-dev 0.0.2026021001` with "YOU MUST UNINSTALL OTHER VERSIONS".
* JetBrains rtk A/B (blog.jetbrains.com, July 2026): Claude Code 2.1.201, claude-sonnet-5, 86 SkillsBench tasks, "+7.6% more expensive at low reasoning effort (p=0.004)", high effort ≈ +0.1 %. Confirmed.

### V4. Not re-verified (carried from digests, dated there)

GitHub star counts and claude.com install counts (GitHub API returned 403 rate-limit during this pass); `unique_installs` come from the catalog (`installs_generated_at 2026-09-11`); Windows-specific behaviour (Codex hooks disabled on Windows, npm `.cmd` shim bug) from gap-4; "Codex hooks.json writers" behaviours from token-efficiency digest; agent-native caveman codex TOML edits from CLI 1.3.3 dist (1.3.4 dist contains the same `agent-native`/`shrink-hook` strings). gstack always-on cost remains unmeasured.

### V5. Removed / downgraded

* Nothing removed outright. Downgraded: the raw §2.1 numbers (now labelled as fallback estimator; corrected column authoritative); the "~5.5k real" default budget (now ~7.6k real, because the caveman injection is 2.0k not "small"); the episodic-memory Codex install command (documented route is TUI-based; no verified non-interactive `codex plugin add` for it).
