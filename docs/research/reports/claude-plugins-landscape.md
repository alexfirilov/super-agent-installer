# Claude Code plugins and marketplaces landscape (as of 2026-09-16; fact-checked 2026-09-17)

Research for the "ultimate AI coding agent installer". Read-only; every number carries the date observed (2026-09-16 unless stated). Sources are listed in section 8; raw fetched files are in `research/raw/` next to this file (official-marketplace.json, community-marketplace.json, sp-marketplace.json, codex-marketplace.json, kw-marketplace.json, per-project READMEs, `plugin-details.txt` = local `claude plugin details` output, `gh-api-2.txt` = exact GitHub API counts, `shields-stats.txt` = shields.io badge counts).

This is the completed version of an interrupted first pass. Everything from the first pass was kept only where it was traceable to a fetched source; doubtful items were re-verified (see "Corrections" in section 0).

## 0. Key takeaways

1. **The official marketplace (`claude-plugins-official`) has 305 plugins** (re-fetched `.claude-plugin/marketplace.json` 2026-09-17; 302 on 2026-09-16, +clay, +intuit-quickbooks, +zocks-advisor): **38 Anthropic-authored** under `./plugins/` (author "Anthropic"; the first pass said 53, which was wrong), **14 repo-hosted partner plugins** under `./external_plugins/` (asana, context7, discord, fakechat, firebase, github, gitlab, imessage, laravel-boost, linear, playwright, serena, telegram, terraform) and **253 URL-sourced entries** pinned to a git SHA (superpowers, remember, mattpocock-skills and the vendor catalog: Google 14, SAP 9, AWS 7, Pendo 5, ...). Categories (2026-09-17): development 123, productivity 61, database 39, monitoring 21, security 18, deployment 9, design 8, learning 3, automation 3, testing 2, location 2, migration 1, math 1, none 14. Claude Code registers this marketplace automatically on first interactive start and auto-updates it (docs `discover-plugins`).
2. **Anthropic runs three more marketplaces**: `claude-community` (`anthropics/claude-plugins-community`, 2,282 plugins, each pinned to a commit SHA, nightly sync from Anthropic's review pipeline, automated safety screening; add with `claude plugin marketplace add anthropics/claude-plugins-community`, install with `claude plugin install <name>@claude-community`), `knowledge-work-plugins` (`anthropics/knowledge-work-plugins`, 110 role/vendor plugins, 24k stars, mostly Cowork-oriented), and `anthropic-agent-skills` (`anthropics/skills`). The community marketplace already contains `superpowers`, `caveman`, `claude-mem`, `context-mode`, `claude-hud`, `remember` and dozens of statusline/memory plugins, so an installer can use ONE vetted marketplace for most third-party plugins. Caveat: because entries are SHA-pinned, the community copy lags upstream (caveman pinned at `3098342` vs upstream HEAD `c2906c62` on 2026-09-16; superpowers pinned at `44c9b2d6` vs `b36e0829`). For plugins that move fast (caveman), the author marketplace + `claude plugin marketplace update <name>` is more current.
3. **Claude Code reports each plugin's context cost locally**: `claude plugin details <name>` prints the component inventory and "Projected token cost / Always-on". On this machine the 20 installed plugins add roughly **8.0k always-on tokens per session**; the most expensive are `plugin-dev` (~2,351 tok), `pr-review-toolkit` (~2,035), `caveman` (~1,814), `superpowers` (~690), `feature-dev` (~240), `claude-md-management` (~177), `claude-code-setup` (~141), `skill-creator` (~114), `commit-commands` (~105), `ralph-loop` (~86), `frontend-design` (~80), `remember` (~75), `code-simplifier` (~66), `code-review` (~22). Hooks, MCP servers and LSP servers cost ~0 always-on ("harness-only, no model context cost"). The `/plugin` Discover pane shows a "Context cost" estimate for not-yet-installed plugins; `/skill-doctor` (CHANGELOG) and the Installed tab's "Not used recently" list identify dead weight.
4. **Several installed plugins overlap Claude Code built-ins** (2.1.273, verified against CHANGELOG + docs): `code-review` plugin vs bundled `/code-review [level] [--fix|--comment]` and `/ultrareview`; `code-simplifier` vs bundled `/simplify`; `remember`/`claude-mem`/`episodic-memory` vs built-in auto memory (`~/.claude/projects/<project>/memory/MEMORY.md`, on by default, first 200 lines/25KB loaded every session); `ralph-loop` vs built-in `/goal` and `/loop`; `claude-code-setup`/`claude-md-management` partly vs `/doctor` CLAUDE.md trims (v2.1.206+) and `CLAUDE_CODE_NEW_INIT=1 /init`; `/import` (v2.1.213+) migrates another agent's AGENTS.md/MCP/skills into Claude Code; `serena` vs the LSP plugins.
5. **Popularity signals (2026-09-16)**. claude.com/plugins install counts: frontend-design 1,134,112; superpowers 1,009,371; code-review 438,525; context7 417,801; skill-creator 385,083; code-simplifier 346,763; playwright 319,887; github 319,381; claude-md-management 287,247; feature-dev 256,017; security-guidance 241,800; vercel 227,688; typescript-lsp 212,522; ralph-loop 196,527; claude-code-setup 195,067; commit-commands 171,244; figma 167,556; supabase 118,617; pr-review-toolkit 114,856; pyright-lsp 109,778; serena 89,147; plugin-dev 67,663; hookify 60,376; remember 51,442; session-report 11,694; claude-security 8,580; mattpocock-skills 1,745. Exact GitHub API stars (2026-09-16): superpowers 287,602; gstack 133,358; caveman 106,031; claude-mem 94,051; wshobson/agents 39,739; compound-engineering 25,115; context-mode 23,223; episodic-memory 478. shields.io (rounded, 2026-09-16): mattpocock/skills 263k, everything-claude-code 260k, anthropics/skills 177k, anthropics/claude-code 145k, ui-ux-pro-max 128k, awesome-claude-skills 75k, claude-flow 73k, get-shit-done 65k (archived), last30days-skill 62k, context7 62k, awesome-claude-code 54.2k, BMAD 53k, chrome-devtools-mcp 52k, agent-browser 43k, oh-my-claudecode 39k, playwright-mcp 37k, claude-plugins-official 36k, vercel-labs/skills 32k, claude-code-templates 31k, serena 29k, claude-hud 28k, claude-task-master 28k, beads 27k, planning-with-files 26.9k, knowledge-work-plugins 24k, ccusage 19k, ccstatusline 13k, openai/plugins 6.8k, claude-plugins-community 4.1k, spec-workflow 3.9k, claude-code-plugins-plus 2.8k, PRPs-agentic-eng 2.2k, superpowers-marketplace 1.3k, the-elements-of-style 575, episodic-memory 478, private-journal-mcp 449, superpowers-lab 428, superpowers-chrome 354, claude-remember 172, superpowers-developing-for-claude-code 141, double-shot-latte 115, claude-session-driver 109.
6. **Codex availability**: `superpowers` ships in OpenAI's curated Codex marketplace (`openai/plugins`, 65 plugins; source `./plugins/superpowers`, products CODEX). `compound-engineering`, `context-mode`, `remember`, `episodic-memory`, `ECC`, `BMAD`, `elements-of-style` have native Codex plugin manifests (`codex plugin marketplace add <owner/repo>` then `codex plugin add <name>@<marketplace>`). `caveman`, `mattpocock/skills`, `wshobson/agents`, `BMAD`, `planning-with-files`, `last30days` install into Codex via `npx skills add ... -a codex`. `gstack` has `./setup --host codex`. `oh-my-claudecode` has a twin `oh-my-codex`. `beads` has `bd setup codex`.
7. **Corrections vs the first pass**: (a) `obra/elements-of-style` and `mvanhorn/cc-plugins` do not exist (GitHub 404). elements-of-style's real repo is `obra/the-elements-of-style` (575 stars) and the reliable install is `/plugin install elements-of-style@superpowers-marketplace`; its auto-generated docs point at a non-existent `obra/elements-of-style` marketplace. mvanhorn's relevant project is `mvanhorn/last30days-skill` (62k stars). (b) awesome-claude-code mentions superpowers, caveman, compound-engineering, gstack, ccstatusline, claude-hud and ccusage, but NOT claude-mem, context-mode, ECC, mattpocock, BMAD, wshobson, oh-my-claudecode, planning-with-files or beads. (c) caveman upstream HEAD moved again during research (eae856e9 -> c2906c62); the installed copy `15581d14` (2026-09-14) is behind, confirming third-party marketplaces do not auto-update. (d) planning-with-files' default branch is `master` (README fetched fine from GitHub; its raw `main` URL 404s).

## 1. Official marketplace: `anthropics/claude-plugins-official`

Source: https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json and README (fetched 2026-09-16). README notes: internal plugins live in `/plugins`, partner plugins in `/external_plugins`; install with `/plugin install {plugin-name}@claude-plugins-official`; plugin `name` slugs are immutable (a `renames` map migrates old slugs); skill-bundle plugins can use `strict: false` + `skills: [...]`.

### 1a. Non-interactive CLI (verified locally, `claude plugin --help`, 2.1.273)

```
claude plugin marketplace add <owner/repo | git URL | path | marketplace.json URL>
claude plugin marketplace list
claude plugin marketplace update [name]        # updates ALL marketplaces if no name
claude plugin marketplace remove <name>        # WARNING: uninstalls that marketplace's plugins
claude plugin install <name>@<marketplace> [--scope user|project|local] [-y] [--json] [--config key=value]
claude plugin update <name>@<marketplace>      # restart or /reload-plugins to apply
claude plugin uninstall <name>@<marketplace> [--scope ...]
claude plugin enable|disable <name>@<marketplace>
claude plugin list [--json] [--available]      # --available lists marketplace catalogs (needs --json)
claude plugin details <name>                   # inventory + projected token cost
claude plugin prune                            # remove auto-installed deps no longer needed
claude plugin validate <path> ; claude plugin eval <target> ; claude plugin init <name>
```

Docs (`discover-plugins`, 2026-09-16): `claude plugin install <name>@<marketplace>` refreshes that marketplace first (v2.1.232+), even when auto-update is off; plain `claude plugin install <name>` reads the cached catalog only. `claude-plugins-official` (and most Anthropic marketplaces) auto-update by default; **third-party and local marketplaces have auto-update disabled by default** (toggle per marketplace in `/plugin` > Marketplaces, or `"autoUpdate": true` in `extraKnownMarketplaces`). `DISABLE_AUTOUPDATER=1` freezes the CLI and plugins; add `FORCE_AUTOUPDATE_PLUGINS=1` to keep plugin auto-update. Installs from the shell load next session or after `/reload-plugins` (`--force` if it warns about the prompt cache). LSP plugins do NOT install the language-server binary (table in section 5).

### 1b. Anthropic-authored plugins (38 under `./plugins/`, plus the 14 `./external_plugins/` bundles) with install status on this machine

Always-on token cost from `claude plugin details <name>` run locally (only resolvable for installed plugins). Installs = claude.com/plugins count on 2026-09-16.

| Plugin | Category | What it adds | Always-on tok | Installs (claude.com) | Installed here? | Verdict |
|---|---|---|---|---|---|---|
| superpowers (external, obra) | development | 14 skills, SessionStart hook | ~690 | 1,009,371 | yes 6.3.0 (= upstream HEAD b36e0829) | must-have |
| frontend-design | development | 1 skill | ~80 | 1,134,112 | yes | recommended |
| code-review | productivity | 1 skill (multi-agent confidence-scored PR review) | ~22 | 438,525 | yes (installed TWICE: project scope 2026-08-24 + user scope) | optional (overlaps bundled `/code-review`, `/ultrareview`) |
| context7 | development | 1 hosted MCP (mcp.context7.com) | ~0 | 417,801 | yes | must-have |
| skill-creator | development | 1 skill | ~114 | 385,083 | yes | recommended |
| code-simplifier | productivity | 1 agent | ~66 | 346,763 | yes | optional (overlaps bundled `/simplify`) |
| playwright | testing | 1 MCP (`npx @playwright/mcp@latest`) | ~0 | 319,887 | yes | recommended |
| github | productivity | official GitHub MCP server | unknown | 319,381 | no | optional (gh CLI already works) |
| claude-md-management | productivity | 2 skills | ~177 | 287,247 | yes | recommended |
| feature-dev | development | 1 skill + 3 agents | ~240 | 256,017 | yes | recommended |
| security-guidance | security | 5 hooks, 0 skills | ~0 | 241,800 | yes 2.0.8 | must-have |
| typescript-lsp | development | LSP (needs `typescript-language-server`) | ~0 | 212,522 | yes | must-have (per language) |
| ralph-loop | development | 3 skills + Stop hook | ~86 | 196,527 | yes | optional (built-in `/goal`, `/loop`) |
| claude-code-setup | productivity | 1 skill | ~141 | 195,067 | yes | optional (one-shot) |
| commit-commands | productivity | 3 skills | ~105 | 171,244 | yes | recommended |
| pr-review-toolkit | productivity | 1 skill + 6 agents | ~2,035 | 114,856 | yes | optional (second-highest always-on cost; enable per project) |
| pyright-lsp | development | LSP (needs `pyright-langserver`) | ~0 | 109,778 | yes | must-have (per language) |
| serena | development | MCP (needs uv) | unknown | 89,147 | no | optional (overlaps LSP plugins) |
| plugin-dev | development | 8 skills + 3 agents | ~2,351 | 67,663 | yes | optional (most expensive always-on; enable only when authoring plugins) |
| hookify | productivity | `/hookify` skill: markdown-defined hooks in `.claude/hookify.*.local.md`, no restart | unknown | 60,376 | no | recommended |
| remember (external, DPT) | - | 2 skills + 4 hooks (Haiku summaries) | ~75 | 51,442 | yes 0.32.0 | optional (choose ONE memory system) |
| session-report | productivity | HTML session usage report from `~/.claude/projects` transcripts | unknown | 11,694 | no | optional |
| claude-security | security | deep scan + adversarial patch review, effort tiers | unknown | 8,580 | no | optional |
| gopls-lsp | development | LSP (needs `gopls`) | ~0 | unknown | yes | must-have if Go |
| rust-analyzer-lsp, clangd-lsp, csharp-lsp, jdtls-lsp, kotlin-lsp, lua-lsp, php-lsp, ruby-lsp, swift-lsp | development | LSP (binary required) | ~0 | unknown | no | per-language |
| agent-sdk-dev | development | Claude Agent SDK kit | unknown | unknown | no | optional |
| mcp-server-dev | development | skills for building MCP servers | unknown | unknown | no | optional |
| mcp-tunnels | development | Anthropic MCP tunnel to private servers | unknown | unknown | no | skip |
| code-modernization | development | COBOL/legacy modernization workflow | unknown | unknown | no | skip |
| explanatory-output-style, learning-output-style | learning | output styles | unknown | unknown | no | skip |
| playground | development | single-file HTML explorers | unknown | unknown | no | optional |
| project-artifact | productivity | living status page | unknown | unknown | no | optional |
| receipts | productivity | personal impact report | unknown | unknown | no | optional |
| math-olympiad | math | competition math | unknown | unknown | no | skip |
| discord, telegram, imessage, fakechat | productivity | messaging bridges (channels) | unknown | unknown | no | optional |
| asana, linear, gitlab, firebase, laravel-boost, terraform | integrations | bundled MCP | unknown | unknown | no | per need |
| cwc-makers | productivity | Cardputer onboarding | unknown | unknown | no | skip |

The other ~249 entries are vendor integrations (Google, SAP, AWS, Pendo, Shopify, Oracle, Grafana, Atlassian, Stripe, Supabase, Vercel, Figma, Notion, Slack, Sentry, Datadog, MongoDB, Neon, Redis, Cloudflare, Railway, Render, Semgrep, Prisma, Expo, Unity, Unreal, Hugging Face, NVIDIA, AMD, Qdrant, DuckDB...). Notable non-vendor entries: `superpowers`, `remember`, `mattpocock-skills` (21 skills; Codex via `npx skills@latest add mattpocock/skills`). The complete 302-row table (name | category | author | description) is in Appendix A.

## 2. Anthropic's other marketplaces

| Marketplace | Add command | Contents | Notes |
|---|---|---|---|
| `claude-community` (anthropics/claude-plugins-community) | `claude plugin marketplace add anthropics/claude-plugins-community` then `claude plugin install <plugin-name>@claude-community` | 2,282 plugins, SHA-pinned, nightly sync, automated safety screening; PRs auto-closed (submit via clau.de/plugin-directory-submission) | Contains superpowers (sha 44c9b2d6), caveman (sha 30983423), claude-mem, context-mode, claude-hud, remember, ~15 statusline plugins, ~20 memory plugins. 4.1k stars. Third-party marketplaces have auto-update OFF by default. |
| `knowledge-work-plugins` (anthropics/knowledge-work-plugins) | `claude plugin marketplace add anthropics/knowledge-work-plugins` then e.g. `claude plugin install sales@knowledge-work-plugins` (verified in its README 2026-09-17) | 110 plugins: productivity, engineering, design, sales, finance, legal, data, security-guidance, figma, datadog, grafana, prisma, zapier, hubspot... | 24k stars; Cowork/knowledge-work oriented; mostly duplicates of official-marketplace vendor entries. Optional. |
| `anthropic-agent-skills` (anthropics/skills) | `/plugin marketplace add anthropics/skills` | document-skills (xlsx, docx, pptx, pdf), example-skills (12), claude-api, academy-guide, discernment-nudge | 177k stars; 3.2M skills.sh installs; document-skills = 172.7k downloads on claude-plugins.dev. |
| `claude-code-plugins` demo (anthropics/claude-code) | `/plugin marketplace add anthropics/claude-code` | 13 demo plugins (agent-sdk-dev, code-review, commit-commands, feature-dev, frontend-design, hookify, plugin-dev, pr-review-toolkit, ralph-wiggum, security-guidance, output styles, claude-opus-4-5-migration) | Superseded by the official marketplace; skip. |
| OpenAI `openai-curated` (openai/plugins) | preconfigured in Codex (`/plugins` browser) | 65 plugins incl. superpowers, github, figma, notion, linear, slack, stripe, vercel, supabase, sentry, datadog, cloudflare, expo, plugin-eval, codex-security | 6.8k stars. Codex CLI: `codex plugin marketplace add|list|upgrade|remove`, `codex plugin add|list|remove` (from `codex plugin --help` locally, 0.154.0). |

## 3. Third-party marketplaces and plugins (notable)

Stars: exact GitHub API where marked "(API)", otherwise shields.io badge on 2026-09-16; skills.sh installs from skills.sh pages on 2026-09-16.

### 3.1 Workflow / methodology bundles (pick ONE primary)

| Plugin | Repo | Stars | Last push | Adds | Always-on tok | Codex | Install (Claude) | Verdict |
|---|---|---|---|---|---|---|---|---|
| superpowers 6.3.0 | obra/superpowers | 287,602 (API) | 2026-09-14 | 14 skills, SessionStart hook | ~690 (measured) | yes: in `openai/plugins` curated marketplace (`/plugins` in Codex, search "superpowers") | `claude plugin install superpowers@claude-plugins-official` (or `/plugin marketplace add obra/superpowers-marketplace` + `/plugin install superpowers@superpowers-marketplace`) | must-have |
| compound-engineering 3.26.3 | EveryInc/compound-engineering-plugin | 25,115 (API) | 2026-09-16 | 35 skills (ce-brainstorm, ce-plan, ce-work, ce-review, ce-compound, lfg...), 14 hosts | unknown (35 skills => est. 1.5-3k) | yes native: `codex plugin marketplace add EveryInc/compound-engineering-plugin` + `codex plugin add compound-engineering@compound-engineering-plugin`; skills invoked as `$ce-plan` | `/plugin marketplace add EveryInc/compound-engineering-plugin` + `/plugin install compound-engineering@compound-engineering-plugin` | optional; heavy overlap with superpowers (brainstorm/plan/review/TDD). 8.9k downloads on claude-plugins.dev; 119k skills.sh installs; listed in awesome-claude-code. |
| gstack | garrytan/gstack | 133,358 (API) | 2026-09-16 | 23 tools / 64 skills (office-hours, autoplan, review, ship, qa, browse, cso, codex...), own browser, Bun required | unknown; ships `gstack-context-bill` to audit its own cost | yes: `./setup --host codex` -> `~/.codex/skills/gstack-*/` | `git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup` (self-updates hourly) | optional; heavy (Bun + bundled browser + 30+ skills), overlaps superpowers/CE and playwright; listed in awesome-claude-code |
| mattpocock-skills | mattpocock/skills | 263k | yesterday (2026-09-15) | 21 skills (grill-me, tdd, to-spec, code-review, wizard...) | unknown | via `npx skills@latest add mattpocock/skills` (native Codex plugin "on roadmap") | `/plugin install mattpocock-skills` (official marketplace; 1,745 installs) | recommended (22.9M skills.sh installs; grill-me 1.2M) |
| everything-claude-code (ECC) 2.2.1 | affaan-m/ECC (GitHub redirects `affaan-m/everything-claude-code` -> `affaan-m/ECC`) | 260,228 (API 2026-09-17) | 2026-09-15 | 68 agents, 292 skills, 94 command shims, hooks, rules | claims skills-first/on-demand; unknown | yes, README path: `npx ecc-universal@2.2.1 install --guided --harness codex` (the repo also ships `.agents/plugins/marketplace.json` named `ecc` with plugin `ecc`, but the README does NOT document `codex plugin marketplace add`/`codex plugin add` for it; README warns: do not stack Codex sync + Codex marketplace plugin) | `npx ecc-universal@2.2.1 setup` (installs `ecc@ecc`); native: `/plugin marketplace add https://github.com/affaan-m/ECC` + `/plugin install ecc@ecc` | skip/optional: kitchen sink; overlaps everything |
| wshobson claude-code-workflows 1.7.1 | wshobson/agents | 39,739 (API) | 2026-09-14 | 94 plugins, 202 agents, 183 skills, 105 commands | per plugin | `npx codex-marketplace add wshobson/agents`; skills via `npx skills add wshobson/agents --skill <name>` | `/plugin marketplace add wshobson/agents` + `/plugin install python-development` (etc.) | optional: install 1-3 domain plugins only (2.2M skills.sh installs) |
| BMAD-METHOD 6.12.0 (npm) | bmad-code-org/BMAD-METHOD | 53,108 (API 2026-09-17) | 2026-09-16 | agents + workflows; marketplace `bmad` ships `bmad-method` + `bmad-toolbox` (both 6.13.0-next) | unknown | `codex plugin marketplace add bmad-code-org/bmad-plugins`, then install `bmad-method` and/or `bmad-toolbox` from the `bmad` marketplace; or `npx skills add bmad-code-org/BMAD-METHOD` | `/plugin marketplace add bmad-code-org/bmad-plugins` then install `bmad-method` / `bmad-toolbox` (README: "For either marketplace, install bmad-method ... and bmad-toolbox"); or `npx skills add bmad-code-org/BMAD-METHOD`; update `npx skills update` | skip unless doing full agile-AI method; conflicts with superpowers/CE |
| oh-my-claudecode 5.4.0 (marketplace name `omc`) | Yeachan-Heo/oh-my-claudecode | 39,202 (API 2026-09-17) | 2026-09-16 | multi-agent orchestration, model routing, `omc` CLI | unknown | twin project `oh-my-codex` | `/plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode` + `/plugin install oh-my-claudecode`; `npm i -g oh-my-claude-sisyphus@latest` | optional |
| ruflo / claude-flow | ruvnet/ruflo (GitHub redirects `ruvnet/claude-flow`) | 72,636 (API 2026-09-17) | 2026-09-16 | swarms, 100+ agents, RAG memory | unknown | Codex plugin (`@claude-flow/codex`) | `/plugin marketplace add ruvnet/ruflo` + `/plugin install ruflo-core@ruflo` | skip (enterprise swarm harness) |
| prp-core | Wirasm/prp (GitHub redirects `Wirasm/PRPs-agentic-eng`; default branch `development`) | 2,246 (API 2026-09-17) | 2026-09-08 | PRD/plan/implement/review skills | unknown | no | `/plugin marketplace add Wirasm/PRPs-agentic-eng` + `/plugin install prp-core@prp-marketplace` | optional |
| claude-code-plugins-plus ("Tons of Skills" v4.33.0) | jeremylongshore/tons-of-skills-marketplace (GitHub redirects both `claude-code-plugins-plus` and the README slug `claude-code-plugins`) | 2,770 (API 2026-09-17) | 2026-09-16 | 434 plugins | per plugin | claims harness-free | `/plugin marketplace add jeremylongshore/claude-code-plugins` | skip (bulk catalog) |
| planning-with-files | OthmanAdi/planning-with-files | 26.9k (GitHub page) | active (426 commits, branch `master`) | file-based planning skill; hooks on SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/PreCompact/Stop; per-turn re-injection; completion gate | unknown (per-turn re-injection => non-trivial) | yes: `.codex/hooks.json` native hooks | `/plugin marketplace add OthmanAdi/planning-with-files` + `/plugin install planning-with-files@planning-with-files`; or `npx skills add OthmanAdi/planning-with-files --skill planning-with-files -g` | optional (overlaps superpowers writing-plans/executing-plans) |
| last30days | mvanhorn/last30days-skill | 62k | today | research skill (Reddit/X/YouTube/HN/web synthesis) | unknown | `npx skills add mvanhorn/last30days-skill -g -a codex` | `/plugin marketplace add mvanhorn/last30days-skill` + `/plugin install last30days`; update `claude plugin update last30days@last30days-skill` | optional (research, not coding) |
| get-shit-done (GSD) | gsd-build/get-shit-done | 64,517 (API) | 2026-05-31, `archived: true` (API 2026-09-17) | README is a redirect to open-gsd/gsd-core (9,525 stars, branch `next`, pushed 2026-09-16) | - | - | - | deprecated (successor not evaluated) |
| claude-task-master | eyaltoledano/claude-task-master | 28k | April 2026 | task manager MCP | unknown | unknown | - | optional/stale |
| claude-code-spec-workflow | Pimzino/claude-code-spec-workflow | 3.9k | Sep 2025 | spec workflow | - | - | - | deprecated (no commits for a year) |

### 3.2 Token savers / context managers

| Plugin | Repo | Stars | Adds | Always-on tok | Codex | Install | Verdict |
|---|---|---|---|---|---|---|---|
| caveman 2.7.0 | JuliusBrussee/caveman | 106,031 (API), pushed 2026-09-16 | 21 skills, 3 agents, SessionStart+UserPromptSubmit hooks; separate proxy CLI `@caveman-ai/cli` 1.3.4 (`caveman claude`/`caveman codex`, hooks, statusline) | ~1,814 (measured) | yes: `npx skills add JuliusBrussee/caveman --skill '*' -a codex --yes -g`; proxy `caveman codex` | `claude plugin marketplace add JuliusBrussee/caveman && claude plugin install caveman@caveman`; skill-only `npx skills add JuliusBrussee/caveman -g`; proxy `npm install -g @caveman-ai/cli && caveman setup --install`; uninstall `npx -y github:JuliusBrussee/caveman -- --uninstall` | must-have (user already runs it). Installed sha 15581d14 (2026-09-14) is behind upstream HEAD c2906c62 -> installer must run `claude plugin marketplace update caveman` + `claude plugin update caveman@caveman`. README: JetBrains A/B 8.5% fewer output tokens with no quality change; proxy benchmark -33% input tokens. 3.3M skills.sh installs; listed in awesome-claude-code. |
| context-mode 1.0.169 | mksglu/context-mode | 23,223 (API), pushed 2026-09-16 | MCP (11 sandbox tools, FTS5 KB) + hooks + routing skill; 17 hosts | unknown (MCP tools deferred by tool search) | yes: `codex plugin marketplace add mksglu/context-mode` (+ enable plugin hooks) | `/plugin marketplace add mksglu/context-mode` + `/plugin install context-mode@context-mode`; requires `npm install -g context-mode` (plugin's MCP server runs the global binary); or `claude mcp add context-mode -- npx -y context-mode` | optional: complements caveman (sandboxes tool OUTPUT vs caveman shrinking what the model writes/reads via proxy) but the caveman proxy already shrinks reads -> overlap; 12.4k skills.sh installs |
| claude-mem 13.25.1 | thedotmack/claude-mem | 94,051 (API), pushed 2026-09-16 | 5 hooks (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd), 4 MCP tools, worker service, injects context at SessionStart | unknown | **no** (fact-check 2026-09-17: README has zero mentions of Codex; `--ide` targets shown are grok-bot, opencode, antigravity) | `/plugin marketplace add thedotmack/claude-mem` + `/plugin install claude-mem` (marketplace name is `thedotmack`, so qualified id = `claude-mem@thedotmack`); or `npx claude-mem install` (NOT `npm install -g claude-mem`, that is the SDK). Caveat: the installer now asks for a browser sign-in (email magic link) to the hosted "claude-mem observer" (30-day trial, then subscription or fallback to your Anthropic plan); non-interactive installs pass `--provider ...` or set `CLAUDE_MEM_ONLINE_OPTIN=false`. | optional; one memory system only. Also in claude-community. 86.2k skills.sh installs. |
| remember 0.32.0 installed (upstream plugin.json 0.33.0; official marketplace pins sha a5cc87c3 vs HEAD 4520b98b, 2026-09-17) | Digital-Process-Tools/claude-remember | 172, pushed 2026-09-16 | 2 skills + 4 hooks, Haiku summaries (<$0.01/session) | ~75 (measured) | yes: README says `codex plugin marketplace add Digital-Process-Tools/claude-remember` + `codex plugin install remember` (observed by its author on codex-cli 0.150.1), **but Codex CLI 0.154.0 has no `install` subcommand** (`codex plugin install --help` -> "unrecognized subcommand 'install'"); the 0.154.0 CLI form is `codex plugin add <PLUGIN[@MARKETPLACE]>` and the repo's Codex marketplace manifest is named `remember-dev`, so use `codex plugin add remember@remember-dev` (derived from CLI help + manifest, not executed) | `claude plugin install remember@claude-plugins-official` (or `/plugin marketplace add Digital-Process-Tools/claude-marketplace` + `/plugin install remember@dpt-plugins`) | optional: cheapest memory plugin (75 tok) and in official marketplace; still duplicates auto memory |
| episodic-memory 1.6.0 | obra/episodic-memory | 478 (API), pushed 2026-09-10 | MCP (semantic search over Claude Code/Codex/Cursor/opencode transcripts) + 1 agent | low | yes: `.codex-plugin/plugin.json` (README: requires codex-cli 0.130.0+); `codex features enable plugin_hooks` + `codex plugin marketplace add /path/to/episodic-memory`; `npm install -g github:obra/episodic-memory` (all verified in README 2026-09-17) | `/plugin install episodic-memory@superpowers-marketplace` | optional (best "search past sessions" tool; indexes both Claude and Codex sessions) |
| agent-memory, ember-memory, munin-memory, memory-bank, memory-toolkit, notion-memory, ix-memory, claude-memory... | claude-community | unknown | assorted memory plugins | unknown | unknown | `claude plugin install <name>@claude-community` | skip (long tail) |

### 3.3 Status lines / observability (only ONE `statusLine` can be active; caveman currently owns it)

| Tool | Repo | Stars | Type | Install | Verdict |
|---|---|---|---|---|---|
| claude-hud 0.8.0 | jarrodwatts/claude-hud | 28k (Aug 2026) | plugin statusline (context %, tools, agents, todos, cost) | `claude plugin marketplace add jarrodwatts/claude-hud && claude plugin install claude-hud@claude-hud` then `/claude-hud:setup` | optional (conflicts with caveman statusline); listed in awesome-claude-code |
| ccstatusline 2.2.29 | sirmalloc/ccstatusline | 13k (yesterday) | npm TUI-configured statusline; settings `"command": "npx -y ccstatusline@latest"` | `npx -y ccstatusline@latest` (TUI), or pinned `npx -y ccstatusline@2.2.27` | optional; listed in awesome-claude-code |
| ccusage 20.0.20 | ccusage/ccusage (GitHub redirects `ryoppippi/ccusage`; monorepo, package README at apps/ccusage) | 18,587 (API 2026-09-17) | CLI cost/usage analyzer from local JSONL | `npx ccusage@latest` (or `bunx ccusage`) | recommended tool (not a plugin); listed in awesome-claude-code |
| session-report | official | - | HTML session report | `claude plugin install session-report@claude-plugins-official` | optional |
| CCometixLine, claude-powerline, claude-statusbar, cc-probeline, cc-costline, ccvitals, goccc, claude-code-status-bar, TermaGITchi | awesome-claude-code / claude-community | unknown | statuslines | various | skip |

### 3.4 Superpowers marketplace extras (obra/superpowers-marketplace 1.0.13, 1.3k stars; manifest fetched 2026-09-16)

`/plugin marketplace add obra/superpowers-marketplace` then `/plugin install <name>@superpowers-marketplace`:

| Plugin | Version | Source repo | Stars | Notes |
|---|---|---|---|---|
| superpowers | 6.3.0 | obra/superpowers | 287,602 | same as official |
| superpowers-chrome | 3.0.5 | obra/superpowers-chrome | 354 | Chrome DevTools Protocol "browsing" skill; skill mode + MCP mode. No Codex install instructions in README (only a `codex exec -c "mcp_servers.superpowers-chrome.enabled=true" ...` smoke test) |
| elements-of-style | 1.0.0 | obra/the-elements-of-style | 575 | 1 skill `writing-clearly-and-concisely` + ~12,000-token reference loaded only on invoke; Codex: native skill via `/plugins` (no hooks). Its generated docs cite a non-existent `obra/elements-of-style` marketplace; use this marketplace. |
| episodic-memory | 1.6.0 | obra/episodic-memory | 478 | see 3.2 |
| superpowers-lab | 0.5.0 | obra/superpowers-lab | 428 | tmux automation, experimental |
| superpowers-developing-for-claude-code | 0.3.1 | obra/superpowers-developing-for-claude-code | 141 | last commit Dec 2025; overlaps official plugin-dev |
| superpowers-dev | 0.0.2026021001 | obra/superpowers#dev | - | "YOU MUST UNINSTALL OTHER VERSIONS" - never co-install |
| claude-session-driver | 4.0.0 | obra/claude-session-driver | 109 | drive other Claude sessions via tmux |
| private-journal-mcp | 2.0.1 | obra/private-journal-mcp | 449 | journaling MCP with semantic search |
| double-shot-latte | 1.2.0 | obra/double-shot-latte | 115 | auto-continue on "Would you like me to continue?" |

Verdict: all optional; superpowers-chrome only if not using playwright/gstack browser; elements-of-style is a cheap, useful add for anyone who cares about prose.

### 3.5 Design / UI

| Plugin | Stars | Install | Verdict |
|---|---|---|---|
| frontend-design (official) | - (1.13M installs) | `claude plugin install frontend-design@claude-plugins-official` | recommended |
| ui-ux-pro-max | 128k | `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` + `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill`; Codex: `npm install -g ui-ux-pro-max-cli` + `uipro init --ai codex` | optional |
| anthropics/skills example-skills (canvas-design, theme-factory, web-artifacts-builder...) | 177k | `/plugin marketplace add anthropics/skills` + `/plugin install example-skills@anthropic-agent-skills` | optional |

### 3.6 Skills infrastructure and adjacent tools

| Tool | Stars / installs | Notes |
|---|---|---|
| skills CLI (`skills` npm 1.5.26, vercel-labs/skills) | 32k stars; skills.sh directory 1,410,945 skills; find-skills 3.4M installs | `npx skills add <owner/repo> [--skill <name>] [-a claude-code|codex] [-g]`, `npx skills update`. Cross-agent skill installs for anything without a Codex plugin. |
| find-skills (vercel-labs) | 3.4M installs | already at `~/.claude/skills/find-skills` |
| agent-browser (vercel-labs) | 43k stars; 868.5k installs | alternative to playwright MCP |
| chrome-devtools-mcp | 52k stars | alternative browser MCP |
| beads (`bd`) 1.3.0 | 27,218 (API 2026-09-17) | README primary: `curl -fsSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh \| bash` or `brew install beads`; Node: `npm install -g @beads/bd`; then `bd setup claude`, `bd setup codex` (`bd setup --list`) | optional issue tracker for agents |
| davila7/claude-code-templates | 31k | templates CLI | optional |
| awesome-claude-code (hesreallyhim) | 54.2k | curated list; endorses superpowers, compound-engineering, gstack, caveman, ccstatusline, claude-hud, ccusage; also lists CCPM, SuperClaude, Ralph variants, planning tools | ranking signal |

## 4. Directories and ranking signals

- **claude.com/plugins** (official catalog): shows install counts and "Anthropic verified" badge (superpowers is NOT badge-verified though listed). Top 20 in section 0.
- **claudemarketplaces.com** (2026-09-16 banner): 23,600+ skills, 2,700+ marketplaces, 12,800+ MCP servers; ranks marketplaces by GitHub stars (f/prompts.chat 157.6K, affaan-m/everything-claude-code 141.9K, obra/superpowers 137K, anthropics/skills 111.4K, anthropics/claude-code 109.7K, ui-ux-pro-max 59.6K, upstash/context7 51.8K, awesome-claude-skills 51.5K, gsd-build/get-shit-done 48.3K, thedotmack/claude-mem 45.7K, ... wshobson/agents 33K, claude-plugins-official 29.9K, claude-hud 27.5K, beads 26.5K, oh-my-claudecode 24.9K). Its star numbers lag GitHub by weeks. Skill installs shown: find-skills 3,020,000+, grill-me 896,500+, caveman 443,200+, systematic-debugging 229,100+.
- **claude-plugins.dev**: community registry with download counts: document-skills 172.7k, frontend-design/code-review/feature-dev 143.5k, compound-engineering 8.9k (2026-09-16).
- **skills.sh** (Vercel) leaderboard 2026-09-16: find-skills 3.4M, grill-me 1.2M, frontend-design (anthropics/skills) 893.5K, agent-browser 868.5K, setup-matt-pocock-skills 844.3K, vercel-react-best-practices 719.3K; repo totals: mattpocock/skills 22.9M, caveman 3.3M, superpowers 3.2M, anthropics/skills 3.2M, wshobson/agents 2.2M, ECC 845.8K, compound-engineering 119K, claude-mem 86.2K, gstack 41.9K, context-mode 12.4K.
- **GitHub stars**: exact via api.github.com for 8 repos (`raw/gh-api-2.txt`); the rest via shields.io badges (rounded) because the anonymous API quota (60/h) was exhausted from this host and `gh` has an invalid token.
- **awesome-claude-code** (54.2k stars) editorial picks (see 3.6).
- **Local**: `claude plugin details <name>` (token cost), `/skill-doctor` (unused skills + their context cost), `/plugin` Installed tab "Not used recently" (unused >=2 weeks over >=10 sessions), `/plugin` Stats tab.

## 5. Conflicts, overlaps, redundancy with built-ins (Claude Code 2.1.273)

| Topic | Finding (source) | Recommendation |
|---|---|---|
| Methodology bundles | superpowers, compound-engineering, BMAD, ECC, gstack, mattpocock-skills, planning-with-files all teach brainstorm/plan/TDD/review; overlapping skill descriptions -> wrong-skill triggering and extra always-on tokens | Keep superpowers as primary (in both official Claude and Codex marketplaces); add mattpocock-skills (light); CE/gstack/BMAD/ECC/planning-with-files opt-in only |
| Memory | Built-in auto memory (docs `memory`: on by default, `~/.claude/projects/<project>/memory/MEMORY.md`, first 200 lines/25KB loaded each session, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` to disable) + remember + claude-mem + episodic-memory each inject at SessionStart | Max one plugin; remember (75 tok, official) or episodic-memory (search, covers Codex too); disable if auto memory suffices |
| Token savers | caveman (skill+proxy) vs context-mode (sandboxed tool output); caveman proxy already shrinks reads | Keep caveman; context-mode optional |
| Status line | settings.json has ONE `statusLine`; caveman-statusline currently set via `ls -td` glob into plugin cache | Installer must offer a picker: caveman / claude-hud / ccstatusline |
| Code review | bundled `/code-review [level]` with `--fix`/`--comment`, `/ultrareview` (cloud, `--post`); `code-review` plugin adds a different confidence-scored skill; `pr-review-toolkit` adds 6 agents (~2k tok) | Make `code-review` + `pr-review-toolkit` optional; note `code-review` is installed twice (project + user scope) -> dedupe |
| Simplify | bundled `/simplify` = cleanup-only review + apply (CHANGELOG) | `code-simplifier` plugin optional/redundant |
| Security | bundled `/security-review` (on demand) vs `security-guidance` (hooks on every edit/Stop, 0 tok) | Keep security-guidance; claude-security optional |
| Loops | bundled `/goal`, `/loop`, `/schedule`, background agents | ralph-loop optional |
| LSP | Built-in LSP tool is inactive until an LSP plugin is installed; the plugin does NOT install the binary (docs table: clangd, csharp-ls, gopls, jdtls, kotlin-language-server, lua-language-server, intelephense, pyright-langserver, rust-analyzer, sourcekit-lsp, typescript-language-server); no LSP in cloud sessions | Installer should install language server binaries first, then the matching plugins |
| Setup / CLAUDE.md | `/doctor` proposes CLAUDE.md trims (v2.1.206+); `CLAUDE_CODE_NEW_INIT=1 /init`; `/import` (v2.1.213+) copies AGENTS.md/MCP/commands/subagents/skills from another agent | claude-code-setup / claude-md-management optional |
| Serena vs LSP | serena MCP (symbol-level tools, needs uv) duplicates LSP plugins | optional |
| plugin-dev / skill-creator | plugin-dev costs ~2.35k tok always-on | enable per project only |
| Stale third-party plugins | third-party marketplaces do not auto-update (docs); caveman is already behind HEAD; community marketplace is SHA-pinned and lags too | installer `update` path: `claude plugin marketplace update` (all) then `claude plugin update <name>@<mp>` for each third-party plugin, then `/reload-plugins`; or enable per-marketplace auto-update in `known_marketplaces.json` / `extraKnownMarketplaces.autoUpdate` |
| Prompt cache | enabling/disabling a plugin or reloading MCP plugins invalidates the prompt cache (docs) | batch plugin changes; run installer between sessions |

## 6. Recommended global set for this power user

**Must-have (user scope, every host):** superpowers@claude-plugins-official; caveman@caveman (+ `@caveman-ai/cli` proxy if desired); security-guidance; context7; per-language LSP plugins (typescript-lsp, pyright-lsp, gopls-lsp; add rust-analyzer-lsp when needed) with their binaries; commit-commands; skills CLI (`npx skills`) + find-skills.

**Recommended:** frontend-design; skill-creator; feature-dev; claude-md-management; hookify; playwright (or agent-browser); mattpocock-skills; anthropic-agent-skills document-skills; ccusage (tool); marketplace `anthropics/claude-plugins-community` registered (for one-stop vetted third-party installs); elements-of-style (cheap).

**Optional (picker, default off or per-project):** remember OR episodic-memory OR claude-mem (one); context-mode; compound-engineering; gstack; claude-hud OR ccstatusline (statusline picker); pr-review-toolkit; plugin-dev; code-review plugin; code-simplifier; ralph-loop; claude-code-setup; session-report; claude-security; github MCP plugin; serena; superpowers-chrome; wshobson domain plugins; ui-ux-pro-max; oh-my-claudecode; beads; PRPs; planning-with-files; last30days; knowledge-work-plugins.

**Skip:** ECC (kitchen sink), BMAD, ruflo/claude-flow, claude-code-plugins-plus, demo marketplace, output-style plugins, mcp-tunnels, code-modernization, math-olympiad, superpowers-dev, superpowers-developing-for-claude-code (stale, overlaps plugin-dev). **Deprecated:** get-shit-done (archived), Pimzino spec-workflow (no commits since 2025-09), claude-task-master (stale since April 2026).

**Codex mirror for the same set:** superpowers (curated marketplace `/plugins`), caveman (`npx skills add JuliusBrussee/caveman --skill '*' -a codex --yes -g`), mattpocock (`npx skills@latest add mattpocock/skills`), context7/playwright (Codex MCP via `codex mcp add`, covered by the MCP researcher), compound-engineering / context-mode / remember / episodic-memory / BMAD / elements-of-style via `codex plugin marketplace add ...` + `codex plugin add <plugin>@<marketplace>` (Codex 0.154.0 has `add`, not `install`), ECC via `npx ecc-universal@2.2.1 install --guided --harness codex`, gstack `./setup --host codex`, beads `bd setup codex`, planning-with-files `npx skills add OthmanAdi/planning-with-files --skill planning-with-files -g` (has `.codex/hooks.json`).

## 7. Open questions

- Per-plugin always-on token cost for non-installed plugins (compound-engineering, gstack, context-mode, claude-mem, hookify, github, planning-with-files) could not be measured; `claude plugin details` only resolves installed plugins. The `/plugin` Discover pane shows a "Context cost" estimate that the installer could surface.
- claude.com/plugins pages 2-4 were not enumerable (WebFetch returned page 1 for `?page=2`).
- Exact GitHub star counts were only obtained for 8 repos; the rest are shields.io rounded values.
- (RESOLVED 2026-09-17) The Codex curated marketplace superpowers copy is 6.3.0 (`plugins/superpowers/.codex-plugin/plugin.json` in openai/plugins).
- (RESOLVED 2026-09-17) knowledge-work-plugins README confirms `claude plugin marketplace add anthropics/knowledge-work-plugins` and `claude plugin install <name>@knowledge-work-plugins`.

## 8. Sources (fetched 2026-09-16)

- https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json ; README.md ; plugins/hookify/README.md
- https://raw.githubusercontent.com/anthropics/claude-plugins-community/main/.claude-plugin/marketplace.json ; README.md
- https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/.claude-plugin/marketplace.json
- https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json
- https://raw.githubusercontent.com/anthropics/claude-code/main/.claude-plugin/marketplace.json ; CHANGELOG.md (2.1.273)
- https://code.claude.com/docs/en/discover-plugins ; /memory ; /plugins ; /skills ; /features-overview ; /commands
- https://claude.com/plugins and https://claude.com/plugins/<name> (install counts)
- https://api.github.com/repos/<owner>/<repo> for obra/superpowers, JuliusBrussee/caveman, EveryInc/compound-engineering-plugin, wshobson/agents, thedotmack/claude-mem, mksglu/context-mode, garrytan/gstack, obra/episodic-memory; https://img.shields.io/github/stars/<owner>/<repo>.json and last-commit badges for the rest
- https://github.com/hesreallyhim/awesome-claude-code ; https://github.com/OthmanAdi/planning-with-files (HTML pages)
- https://raw.githubusercontent.com/obra/superpowers/main/README.md ; https://raw.githubusercontent.com/obra/superpowers-marketplace/main/.claude-plugin/marketplace.json ; https://raw.githubusercontent.com/obra/the-elements-of-style/main/README.md and docs/install/{claude-code,codex}.md ; https://raw.githubusercontent.com/obra/episodic-memory/main/README.md
- https://raw.githubusercontent.com/JuliusBrussee/caveman/main/README.md ; .claude-plugin/marketplace.json ; https://registry.npmjs.org/@caveman-ai/cli/latest
- https://raw.githubusercontent.com/EveryInc/compound-engineering-plugin/main/README.md ; .claude-plugin/marketplace.json
- https://raw.githubusercontent.com/wshobson/agents/main/README.md ; .claude-plugin/marketplace.json
- https://raw.githubusercontent.com/thedotmack/claude-mem/main/README.md ; https://registry.npmjs.org/claude-mem/latest
- https://raw.githubusercontent.com/mksglu/context-mode/main/README.md ; https://registry.npmjs.org/context-mode/latest
- https://raw.githubusercontent.com/garrytan/gstack/main/README.md
- https://raw.githubusercontent.com/Digital-Process-Tools/claude-remember/main/README.md
- https://raw.githubusercontent.com/jarrodwatts/claude-hud/main/README.md ; https://raw.githubusercontent.com/sirmalloc/ccstatusline/main/README.md ; https://registry.npmjs.org/ccstatusline/latest ; https://registry.npmjs.org/ccusage/latest
- https://raw.githubusercontent.com/Wirasm/PRPs-agentic-eng/main/README.md ; https://raw.githubusercontent.com/jeremylongshore/claude-code-plugins-plus/main/README.md ; https://raw.githubusercontent.com/bmad-code-org/BMAD-METHOD/main/README.md ; https://registry.npmjs.org/bmad-method/latest
- https://raw.githubusercontent.com/affaan-m/everything-claude-code/main/README.md ; https://raw.githubusercontent.com/mattpocock/skills/main/README.md ; https://raw.githubusercontent.com/Yeachan-Heo/oh-my-claudecode/main/README.md ; https://raw.githubusercontent.com/gastownhall/beads/main/README.md ; https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/README.md ; https://raw.githubusercontent.com/ruvnet/claude-flow/main/README.md ; https://raw.githubusercontent.com/gsd-build/get-shit-done/main/README.md ; https://raw.githubusercontent.com/mvanhorn/last30days-skill/main/README.md
- https://raw.githubusercontent.com/hesreallyhim/awesome-claude-code/main/README.md
- https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json
- https://registry.npmjs.org/skills/latest
- https://skills.sh/ and https://skills.sh/<owner>/<repo> ; https://claudemarketplaces.com/ ; https://claude-plugins.dev/
- Local (read-only): `claude plugin --help`, `claude plugin install --help`, `claude plugin marketplace --help`, `claude plugin details <name>` (cached in raw/plugin-details.txt), `~/.claude/plugins/installed_plugins.json`, `~/.claude/plugins/known_marketplaces.json`, `codex plugin --help`, `git ls-remote` HEADs

## Verification (skeptical fact-check, 2026-09-17)

Method: every marketplace.json, plugin.json, README, docs page, npm `latest` and GitHub API record cited above was re-fetched on 2026-09-17 (raw files in `../verify/`; `gh-api-verify.txt` = exact API stats, `stars-html.txt` = star counts scraped from repo pages while the anonymous API quota was exhausted). Install commands were diffed character-by-character against the fetched source. Local CLI facts were re-checked with `claude plugin ... --help` (2.1.273) and `codex plugin ... --help` (0.154.0) without mutating anything.

### Corrections made in the body

| # | Claim in first pass | Finding | Source |
|---|---|---|---|
| 1 | Official marketplace = 302 plugins, "53 Anthropic-authored under ./plugins" | 305 plugins on 2026-09-17 (+clay, +intuit-quickbooks, +zocks-advisor). Only **38** entries are Anthropic-authored under `./plugins/`; 14 more are repo-hosted under `./external_plugins/`; 253 are URL-sourced SHA-pinned entries. Category "productivity" is 61, not 58. | raw marketplace.json (jq counts) |
| 2 | remember Codex install `codex plugin install remember` | README really says that (observed on codex-cli 0.150.1), but Codex 0.154.0 rejects it: `codex plugin install --help` -> "unrecognized subcommand 'install'". CLI has `codex plugin add <PLUGIN[@MARKETPLACE]>`; the repo's `.agents/plugins/marketplace.json` is named `remember-dev`. Corrected to `codex plugin add remember@remember-dev` (derived, not executed; medium confidence). Upstream plugin.json is now 0.33.0. | local `codex plugin add --help`; raw manifest |
| 3 | claude-mem "README lists Codex among IDEs" | False: zero occurrences of "codex" in the README. `--ide` examples are grok-bot, opencode, antigravity. Marketplace name is `thedotmack` (not `claude-mem`), so update = `claude plugin marketplace update thedotmack && claude plugin update claude-mem@thedotmack`. New caveat: `npx claude-mem install` now prompts for a browser sign-in to a hosted memory service (30-day trial); `--provider` / `CLAUDE_MEM_ONLINE_OPTIN=false` for non-interactive. | raw README + marketplace.json |
| 4 | ECC Codex install `codex plugin marketplace add affaan-m/ECC && codex plugin add ecc@ecc`, update `codex plugin marketplace upgrade ecc` | Not in the README (0 matches for "codex plugin"). README's Codex path is `npx ecc-universal@2.2.1 install --guided --harness codex`; it explicitly warns "Avoid: Codex sync + Codex marketplace plugin". The repo does ship `.agents/plugins/marketplace.json` (`ecc`/`ecc`) so the native form is plausible but undocumented -> replaced with the README command; canonical repo is now `affaan-m/ECC` (GitHub redirect). | raw README, manifest, API |
| 5 | oh-my-claudecode update `claude plugin marketplace update oh-my-claudecode` | Marketplace name in its manifest is `omc`. | raw marketplace.json |
| 6 | BMAD install = marketplace add only | README: after adding `bmad-code-org/bmad-plugins`, install `bmad-method` and/or `bmad-toolbox` (marketplace name `bmad`, both 6.13.0-next). | raw README + manifest |
| 7 | superpowers-chrome Codex "unknown" | README has no Codex install path, only a `codex exec -c "mcp_servers.superpowers-chrome.enabled=true"` smoke test -> n/a. | raw README |
| 8 | ccusage install `npx ccusage`, repo ryoppippi/ccusage | Repo moved to `ccusage/ccusage` (monorepo); package README says `npx ccusage@latest` / `bunx ccusage`. | API redirect, apps/ccusage/README.md |
| 9 | beads install `npm install -g @beads/bd` | README's primary install is the curl script or `brew install beads`; npm is the "Node.js users" alternative. `@beads/bd` latest 1.3.0. | raw README, npm |
| 10 | GSD "archived" | Confirmed `archived: true` via API (pushed 2026-05-31); successor `open-gsd/gsd-core` (9,525 stars, branch `next`). | API |
| 11 | Repo names | GitHub redirects: `ruvnet/claude-flow` -> `ruvnet/ruflo`; `Wirasm/PRPs-agentic-eng` -> `Wirasm/prp` (default branch `development`); `jeremylongshore/claude-code-plugins-plus` -> `jeremylongshore/tons-of-skills-marketplace`; old slugs still work. | API 301s |
| 12 | `claude plugin install ... [-y]` "non-interactive" | `-y, --yes` = "Accept the displayed marketplace-declared command" (only relevant to `command`-source plugins); `--scope` defaults to user. Docs: `claude plugin update` says "restart required to apply". | local `--help`, docs |
| 13 | shields.io rounded stars | Replaced with exact counts (API/HTML, 2026-09-17): mattpocock/skills 263,585; ECC 260,228; anthropics/skills 176,707; anthropics/claude-code 145,473; ui-ux-pro-max 128,185; ruflo 72,636; GSD 64,517; last30days 62,153; context7 62,096; awesome-claude-code 54,175; BMAD 53,108; oh-my-claudecode 39,202; wshobson 39,740; playwright-mcp 37,181; claude-plugins-official 36,430; vercel-labs/skills 31,801; serena 29,478; claude-hud 28,095; task-master 28,078; beads 27,218; planning-with-files 26,939; knowledge-work-plugins 24,271; ccusage 18,587; ccstatusline 12,906; openai/plugins 6,855; community 4,153; spec-workflow 3,857; ccpp 2,770; prp 2,246; superpowers-marketplace 1,262. Day-over-day drift for the 8 API repos is <10 stars. | `verify/gh-api-verify.txt`, `stars-html.txt` |
| 14 | Open questions: openai/plugins superpowers version; knowledge-work add command | Resolved: 6.3.0 (`plugins/superpowers/.codex-plugin/plugin.json`); README confirms `claude plugin marketplace add anthropics/knowledge-work-plugins` + `claude plugin install sales@knowledge-work-plugins`. | raw files |

### Confirmed unchanged (spot list)
- Docs `discover-plugins`: auto-update defaults, `DISABLE_AUTOUPDATER` + `FORCE_AUTOUPDATE_PLUGINS=1`, v2.1.232 refresh-on-named-install, LSP binary table (11 rows), `/reload-plugins --force`, "Not used recently" (2 weeks / 10 sessions). Docs `memory`: auto memory on by default, `~/.claude/projects/<project>/memory/MEMORY.md`, 200 lines / 25KB, `autoMemoryEnabled`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `/import` v2.1.213+, `/doctor` trims v2.1.206+, `CLAUDE_CODE_NEW_INIT=1`.
- CHANGELOG (2.1.273 head): `/simplify` cleanup-only, `/code-review --fix|--comment`, `/ultrareview --post`, `/skill-doctor`, `/goal`, `/loop`.
- Community marketplace: 2,282 entries; README commands verbatim; pins superpowers 44c9b2d6 / caveman 30983423 vs upstream HEADs b36e0829 / c2906c62 (still drifting; claude-mem d768ba36 vs d8bc9755, context-mode 37dc25b9 vs 5bca2948, claude-hud 6f065f20 vs 939eb664, remember dd59077e vs 4520b98b).
- Install commands verbatim in source: caveman (all 5), superpowers (official + superpowers-marketplace + Codex `/plugins`), compound-engineering (README uses short `/plugin install compound-engineering`; the `@compound-engineering-plugin` form is valid per docs), context-mode (Claude/Codex/mcp add/npm -g), claude-hud (both forms + `/claude-hud:setup`), ccstatusline (`npx -y ccstatusline@latest`), gstack (clone + `./setup`, `--host codex`), planning-with-files, last30days (README's Codex form is `npx skills add mvanhorn/last30days-skill -g`; `-a codex` is a documented skills flag), mattpocock, anthropics/skills, wshobson (`npx codex-marketplace add wshobson/agents`; npm codex-marketplace 0.2.1), ui-ux-pro-max (`uipro init --ai codex` line 278), oh-my-claudecode, PRPs, claude-code-plugins-plus (README slug `jeremylongshore/claude-code-plugins` is an intentional frozen redirect), ruflo, elements-of-style (its docs/install/claude-code.md still points at non-existent `obra/elements-of-style`; Codex manifest name `elements-of-style-dev`), episodic-memory, skills CLI (`-a/--agent`, `-g/--global`, `-y/--yes`, `npx skills update`).
- Popularity: claude.com/plugins page-1 counts identical to 2026-09-16 (superpowers 1,009,371, not badge-verified); skills.sh totals caveman 3.3M, superpowers 3.2M, mattpocock 22.9M; directory total now 1,416,790 skills; claudemarketplaces.com banner unchanged (updated 2026-09-16).
- npm latest: skills 1.5.26, ccusage 20.0.20, ccstatusline 2.2.29, context-mode 1.0.169, claude-mem 13.25.1, @caveman-ai/cli 1.3.4, ui-ux-pro-max-cli 2.15.0, oh-my-claude-sisyphus 5.4.0, bmad-method 6.12.0, ecc-universal 2.2.1, planning-with-files 3.18.3.
- Local: `installed_plugins.json` shows code-review@claude-plugins-official twice (project 2026-08-24 + user 2026-09-14) and caveman at 15581d14; `claude plugin details` token costs match `raw/plugin-details.txt`.

### Facts discovered during the check (added)
- Official `github` plugin is a hosted HTTP MCP (`https://api.githubcopilot.com/mcp/`) that needs `GITHUB_PERSONAL_ACCESS_TOKEN` in the environment; `context7` plugin sends optional `CONTEXT7_API_KEY`; `serena` plugin runs `uvx --from git+https://github.com/oraios/serena serena start-mcp-server` (uv required, missing on this host); `playwright` runs `npx @playwright/mcp@latest`.
- claude.com install counts for plugins previously "unknown": agent-sdk-dev 66,631; explanatory-output-style 64,377; playground 64,198; learning-output-style 42,241; csharp-lsp 43,741; gopls-lsp 41,639; rust-analyzer-lsp 35,933; mcp-server-dev 33,959; jdtls-lsp 33,734; php-lsp 32,856; discord 32,323; clangd-lsp 29,851; firebase 26,168; telegram 100,332; chrome-devtools 102,569; greptile 56,611; linear 48,038; gitlab 40,805; sentry 38,810.
- Docs: plugin auto-update runs after session start with a random delay of up to 10 minutes; `claude plugin install` (shell) defaults to user scope; `/plugin install name` without marketplace refreshes only auto-updating marketplaces and only on a miss; plugins synced from claude.ai appear in terminal sessions on v2.1.273+.
- `security-guidance`: marketplace.json says 2.0.7 while the plugin's plugin.json says 2.0.8 (installed 2.0.8).
- Codex CLI 0.154.0 plugin surface (local help): `codex plugin add|list|remove`, `codex plugin marketplace add|list|upgrade|remove`, `codex features list|enable|disable`; only `openai-curated` is registered locally.

## Appendix A. All 302 (as of 2026-09-16; 305 on 2026-09-17, see Verification) plugins in claude-plugins-official (name | category | author | description)

Generated from the fetched marketplace.json on 2026-09-16; descriptions truncated to 150 chars. "third-party" = entry has no author field.

| name | category | author | description |
|---|---|---|---|
| 42crunch-api-security-testing | security | 42Crunch | Automate API security directly in Claude Code with 42Crunch - automatically audit OpenAPI specs, detect vulnerabilities aligned with OWASP API Securit |
| adobe-for-creativity | design | Adobe | Harness Adobe's creative AI-powered tools to edit images, automate design workflows, and bring creative visions to life — from background removal to v |
| agent-sdk-dev | development | Anthropic | Development kit for working with the Claude Agent SDK |
| agentforce-adlc | development | third-party | Agentforce Agent Development Life Cycle — author, discover, scaffold, deploy, test, and optimize .agent files |
| ai-plugins | - | third-party | Set up endorctl and use Endor Labs to scan, prioritize, and fix security risks across your software supply chain |
| aikido | - | third-party | Aikido Security scanning for Claude Code — SAST, secrets, and IaC vulnerability detection powered by the Aikido MCP server. |
| airtable | productivity | Airtable | Airtable is the database and operations layer for your agents — whether running product, marketing, sales, ops, HR, or a custom business app. It combi |
| airwallex-agentos | productivity | Airwallex | Bring Airwallex's global financial infrastructure to Claude. Orchestrate actions across your account in plain language, e.g., set up invoices from a P |
| airwallex-dev | development | Airwallex | Build Airwallex payment integrations in your own codebase. Generates the checkout, card-element, onboarding, and subscription-billing code for an Airw |
| aiven | database | Aiven | Easily deploy managed PostgreSQL (pg), Kafka, OpenSearch, Clickhouse and other databases, streaming and apps. Free tier available, up and running in m |
| alloydb | database | Google LLC | Create, connect, and interact with an AlloyDB for PostgreSQL database and data. |
| alloydb-omni | database | Google LLC | Create, connect, and interact with an AlloyDB Omni database and data. |
| altimate-code | database | AltimateAI | Delegates dbt and warehouse work to altimate-code, a specialized CLI agent with 100+ purpose-built data tools (SQL analysis, column-level lineage, dbt |
| amazon-location-service | location | third-party | Guide developers through adding maps, places search, geocoding, routing, and other geospatial features with Amazon Location Service, including authent |
| amd-skills | development | AMD | AMD's verified Agent Skills in one plugin: route image/audio through local AI on Ryzen AI, serve LLMs on AMD Instinct GPUs with vLLM, and analyze GPU  |
| amplitude | monitoring | third-party | Use Amplitude as an expert analyst — instrument Amplitude, discover product opportunities, analyze charts, create dashboards, manage experiments, and  |
| apollo | productivity | Apollo.io | Prospect, enrich leads, load outreach sequences, and query sales analytics with Apollo.io — one-click MCP server integration for Claude Code and Cowor |
| apollo-skills | development | Apollo GraphQL | Apollo GraphQL agent skills for Claude Code — Apollo Client, Server, Federation, Connectors, Router, Rover CLI, iOS, Kotlin, and the Apollo MCP server |
| appwrite | development | Appwrite | Appwrite tools for Claude Code, including SDK skills, Appwrite MCP servers, and deployment commands. |
| asana | productivity | Anthropic | Asana project management integration. Connects Claude Code to Asana's V2 MCP server to create and manage tasks, search projects, update assignments, a |
| astronomer-data-agents | development | third-party | Data engineering for Apache Airflow and Astronomer. Author DAGs with best practices, debug pipeline failures, trace data lineage, profile tables, migr |
| atlan | - | third-party | Atlan data catalog plugin for Claude Code. Search, explore, govern, and manage your data assets through natural language. Powered by the Atlan MCP ser |
| atlassian | productivity | third-party | Connect to Atlassian products including Jira and Confluence. Search and create issues, access documentation, manage sprints, and integrate your develo |
| atlassian-twg-cli | productivity | Atlassian | Teamwork Graph CLI is Atlassian's agent-first interface to your entire work context: Jira issues, Confluence pages, Bitbucket PRs, along with your con |
| atomic-agents | development | third-party | Comprehensive development workflow for building AI agents with the Atomic Agents framework. Includes specialized agents for schema design, architectur |
| auth0 | security | Auth0 | Enterprise-grade auth, easy to implement. Add login, SSO, MFA, and access control to any app with framework-aware guidance. |
| aws-agents | development | Amazon Web Services | Build, deploy, and operate AI agents on AWS. Skills for scaffolding agents with Amazon Bedrock AgentCore, connecting tools, memory, policies, evaluati |
| aws-agents-for-devsecops | development | Amazon Web Services | Investigate incidents, review code and execute UAT for release readiness, scan code for vulnerabilities, and run penetration tests with AWS DevOps Age |
| aws-amplify | development | third-party | Build full-stack apps with AWS Amplify Gen 2 using guided workflows for authentication, data models, storage, GraphQL APIs, and Lambda functions. |
| aws-core | development | Amazon Web Services | Build, deploy, and operate applications on AWS. Skills to author infrastructure-as-code, use core services, and complete common tasks. |
| aws-data-analytics | development | Amazon Web Services | Data lake, analytics, and ETL workflows with S3 Tables, AWS Glue, and Athena. |
| aws-serverless | development | third-party | Design, build, deploy, test, and debug serverless applications with AWS Serverless services. |
| aws-startup-advisor | development | Amazon Web Services | Personalized architecture, cost, security, and migration guidance for startups. From day-one account setup and security baselines to production-ready  |
| aws-transform | migration | Amazon Web Services | Migrate, modernize, and upgrade codebases to AWS. Transforms .NET Framework to .NET 8/10, mainframe COBOL to Java, VMware VMs to EC2, SQL Server to Au |
| azure | deployment | third-party | Transform Claude into an Azure expert. This plugin integrates the Azure MCP server and specialized Azure skills to move beyond generic advice. It enab |
| azure-cosmos-db-assistant | database | third-party | Expert assistant for Azure Cosmos DB — data modeling, query optimization, performance tuning, and best practices. |
| azure-sql-developer | database | Microsoft | Agent skills for Azure SQL Developer, the Azure SQL Database engine running locally in a container. Teaches your agent to run the engine, connect, mig |
| base44 | development | third-party | Build and deploy Base44 full-stack apps with CLI project management and JavaScript/TypeScript SDK development skills |
| bigdata-com | database | RavenPack | Official Bigdata.com plugin providing financial research, analytics, and intelligence tools powered by Bigdata MCP. |
| bigquery-data-analytics | database | Google LLC | Connect, query, and generate data insights for BigQuery datasets and data. |
| boltz | development | Boltz | Predict structures, screen molecules and proteins, and design binders with Boltz from Claude Code. |
| blackrock-advisor-center-plugin | productivity | BlackRock Advisor Center | BlackRock Advisor Center 360° skills for financial advisors: portfolio review, opportunity and fund-health checks, guided benchmark selection, guided  |
| box | productivity | third-party | Work with your Box content directly from Claude Code — search files, organize folders, collaborate with your team, and use Box AI to answer questions, |
| brightdata-plugin | - | third-party | Web scraping, Google search, structured data extraction, and MCP server integration powered by Bright Data. Includes 7 skills: scrape any webpage as m |
| browser-use | automation | Browser Use | Give Claude a real browser — your Chrome or a Browser Use Cloud browser. Use it whenever a task involves a website or web app: browsing, scraping and  |
| buildkite | development | Buildkite | Official Buildkite skills for Claude Code, Cursor, and other AI coding agents — pipelines, migration, preflight, agent runtime, CLI, and API |
| canva | design | Canva | Create, edit, review, resize, and brand-check Canva designs with the Canva MCP server. |
| carbone-skill | productivity | Carbone | Official Carbone skill — complete templating language reference covering tags, loops, conditions, formatters, aggregators, and all output formats (DOC |
| carta-cap-table | productivity | Carta Engineering | Carta Cap Table plugin — skills and hooks for querying cap tables, grants, SAFEs, 409A valuations, waterfall scenarios, and more |
| carta-crm | productivity | Carta Engineering | Manage the Carta CRM conversationally — search, add, update, and enrich investors, companies, contacts, deals, notes, and fundraisings via the Carta C |
| carta-investors | productivity | Carta Engineering | Carta Investors plugin — skills for querying investor data, performance benchmarks, regulatory reporting, AGM deck generation, brand extraction, and m |
| catalyst-by-zoho | development | Catalyst by Zoho | Official Claude Code plugin for Catalyst by Zoho — full-stack serverless cloud platform. With Skills that covers all services, SDKs, CLI, architecture |
| cds-mcp | development | SAP SE | AI-assisted development of SAP Cloud Application Programming Model (CAP) projects. Search CDS models and CAP documentation. |
| chrome-devtools-mcp | development | third-party | Control and inspect a live Chrome browser from your coding agent. Record performance traces, analyze network requests, check console messages with sou |
| circle-skills | development | Circle | Ship stablecoin apps faster. Best-practice skills for USDC payments, cross-chain transfers, wallets, and smart contracts — plus Circle's MCP server fo |
| circleback | productivity | third-party | Circleback conversational context integration. Search and access meetings, emails, calendar events, and more. |
| ckeditor | development | CKEditor (CKSource) | Install, configure, and integrate CKEditor 5 (free and premium) in any JavaScript project. |
| clangd-lsp | development | Anthropic | C/C++ language server (clangd) for code intelligence |
| claude-code-setup | productivity | Anthropic | Analyze codebases and recommend tailored Claude Code automations such as hooks, skills, MCP servers, and subagents. |
| claude-md-management | productivity | Anthropic | Tools to maintain and improve CLAUDE.md files - audit quality, capture session learnings, and keep project memory current. |
| claude-security | security | Anthropic | Deep vulnerability scanning of your own code, run entirely inside your Claude Code session at a chosen effort tier, with every finding challenged befo |
| clickhouse | database | ClickHouse | Connect Claude to your ClickHouse Cloud databases. Browse organizations, services, databases, and table schemas. Run read-only SQL queries against you |
| clickhouse-best-practices | database | ClickHouse Inc | 28 best practice rules for ClickHouse schema design, query optimization, and data ingestion — prioritized by impact |
| cloud-sql-mysql | database | Google LLC | Connect and interact with a Cloud SQL for MySQL database and data. |
| cloud-sql-postgresql | database | Google LLC | Create, connect, and interact with a Cloud SQL for PostgreSQL database and data. |
| cloud-sql-sqlserver | database | Google LLC | Connect to Cloud SQL for SQL Server |
| cloudflare | deployment | third-party | Skills for the Cloudflare developer platform: Workers, Durable Objects, Agents SDK, MCP servers, Wrangler CLI, and web performance. |
| cloudinary | - | third-party | Use Cloudinary directly in Claude. Manage assets, apply transformations, optimize media, and more through natural conversation. |
| cockroachdb | database | Cockroach Labs | Connect Claude Code directly to your CockroachDB clusters for hands-on database work — explore schemas, write optimized SQL, debug queries, and manage |
| code-modernization | development | Anthropic | Modernize legacy codebases (COBOL, legacy Java/C++, monolith web apps) with a structured preflight / assess / map / extract-rules / brief / reimagine  |
| code-review | productivity | Anthropic | Automated code review for pull requests using multiple specialized agents with confidence-based scoring to filter false positives |
| code-simplifier | productivity | Anthropic | Agent that simplifies and refines code for clarity, consistency, and maintainability while preserving functionality. Focuses on recently modified code |
| coderabbit | productivity | third-party | Your code review partner. CodeRabbit provides external validation using a specialized AI architecture and 40+ integrated static analyzers—offering a d |
| codspeed | development | CodSpeed | CodSpeed is the all-in-one performance testing toolkit. Dive into benchmarking results, flamegraphs, and performance comparisons — give Claude granula |
| commit-commands | productivity | Anthropic | Commands for git commit workflows including commit, push, and PR creation |
| confidence | development | Spotify Confidence | Access Confidence feature flags, experiments, and migration tools directly from Claude Code. |
| context7 | development | Anthropic | Upstash Context7 MCP server for up-to-date documentation lookup. Connects to Context7's hosted remote MCP server (https://mcp.context7.com/mcp) — no l |
| convex | database | Convex | Official Convex plugin for Claude Code with bundled Convex skills, the convex-expert subagent for code-writing, a runtime-error monitor, and MCP acces |
| crowdsec | security | CrowdSec | Operational skill for installing, configuring, operating, and debugging CrowdSec (cscli, LAPI/CAPI, hub, bouncers, WAF/AppSec) across bare-metal, Dock |
| crowdstrike-falcon-foundry | security | CrowdStrike | CrowdStrike Falcon Foundry development skills for building cybersecurity applications on the Falcon platform. Includes UI development, collections, fu |
| crowdstrike-falcon-fusion | security | CrowdStrike | CrowdStrike Falcon Fusion skills for authoring, deploying, and executing Fusion workflows. Includes live action discovery, YAML authoring with schema  |
| csharp-lsp | development | Anthropic | C# language server for code intelligence |
| cwc-makers | productivity | Anthropic | Onboard a Code-with-Claude Makers Cardputer with one /maker-setup command — clones the build-with-claude repo, flashes UIFlow firmware, and installs t |
| dash0 | monitoring | Dash0 | OpenTelemetry observability for Claude Code sessions. Captures tool calls, LLM invocations, token usage, and errors as OTel traces. Send telemetry to  |
| data | development | third-party | Data engineering for Apache Airflow and Astronomer. Author DAGs with best practices, debug pipeline failures, trace data lineage, profile tables, migr |
| data-agent-kit-starter-pack | development | Google LLC | This plugin provides a specialized suite of skills for data engineers and database practitioners working on Google Cloud. It acts as an expert assista |
| data-engineering | - | third-party | Data engineering plugin - warehouse exploration, pipeline authoring, Airflow integration |
| databases-on-aws | database | third-party | Expert database guidance for the AWS database portfolio. Design schemas, execute queries, handle migrations, and choose the right database for your wo |
| databricks | database | Databricks | Databricks skills for the CLI, Apps, Lakebase, Model Serving, Lakeflow Jobs, Spark Declarative Pipelines, Declarative Automation Bundles (DABs), and c |
| datadog | monitoring | Datadog | Use Datadog directly in Claude Code through a preconfigured Datadog MCP server. Query logs, metrics, traces, dashboards, and more through natural conv |
| datahub-skills | database | DataHub | DataHub development and interaction toolkit with connector planning, PR review, catalog search, metadata enrichment, lineage tracing, data quality man |
| dataproc | database | Google LLC | Manage Dataproc clusters and jobs. |
| datarobot-agent-skills | development | DataRobot | DataRobot skills for AI/ML workflows — model training, deployment, predictions, feature engineering, monitoring, explainability, data preparation, App |
| dataverse | database | third-party | Agent skills for building on, analyzing, and managing Microsoft Dataverse — with Dataverse MCP, PAC CLI, and Python SDK. |
| deepeval | development | Confident AI | Skills for adding DeepEval evaluations, tracing, datasets, Confident AI reports, and iterative improvement loops to AI applications. |
| deploy-on-aws | deployment | third-party | Deploy applications to AWS with architecture recommendations, cost estimates, and IaC deployment. |
| desktop-commander | productivity | Desktop Commander | MCP server for terminal commands, process management, and file operations across text, code, PDF, DOCX, Excel, images, and structured data. |
| discord | productivity | Anthropic | Discord messaging bridge with built-in access control. Manage pairing, allowlists, and policy via /discord:access. |
| dominodatalab | development | Domino Data Lab | Full Domino Data Lab platform support — workspaces, jobs, model deployment, experiment tracking, GenAI tracing, Spark/Ray/Dask, and app deployment for |
| dropbox | productivity | Dropbox | The Dropbox plugin for Claude connects your Dropbox files directly to Claude, so you can search, organize, save generated content, and create sharing  |
| duckdb-skills | database | DuckDB Foundation | DuckDB-powered skills for Claude Code: read any data file, attach and query DuckDB databases, search DuckDB/DuckLake docs, search past session logs, a |
| duende-skills | security | Duende Software | Duende development skills and agents for Claude Code — covering OAuth/OIDC protocols, IdentityServer, token management, ASP.NET Core authentication/au |
| exa | productivity | Exa | Exa AI web search, deep research, and content extraction. Provides MCP tools and research skills for comprehensive web search, people discovery, compa |
| explanatory-output-style | learning | Anthropic | Adds educational insights about implementation choices and codebase patterns (mimics the deprecated Explanatory output style) |
| expo | development | third-party | Official Expo skills for building, deploying, upgrading, and debugging React Native apps with Expo. Covers UI development with Expo Router, SwiftUI an |
| fakechat | development | Anthropic | Localhost web chat for testing the channel notification flow. No tokens, no access control, no third-party service. |
| fastly-agent-toolkit | - | third-party | Fastly development tools and platform skills |
| feature-dev | development | Anthropic | Comprehensive feature development workflow with specialized agents for codebase exploration, architecture design, and quality review |
| fiftyone | - | third-party | Build high-quality datasets and computer vision models. Visualize datasets, analyze models, find duplicates, run inference, evaluate predictions, and  |
| figma | design | third-party | Figma design platform integration. Access design files, extract component information, read design tokens, and translate designs into code. Bridge the |
| firebase | database | Anthropic | Google Firebase MCP integration. Manage Firestore databases, authentication, cloud functions, hosting, and storage. Build and manage your Firebase bac |
| firecrawl | development | third-party | Web scraping and crawling powered by Firecrawl. Turn any website into clean, LLM-ready markdown or structured data. Scrape single pages, crawl entire  |
| firestore-native | database | Google LLC | Connect and interact with Firestore databases, collections, and documents. |
| forge-skills | development | Atlassian | Forge-focused skills and MCP configuration for Atlassian Forge: scaffold and deploy apps (forge create, templates, dev spaces), build Teamwork Graph c |
| frontend-design | development | Anthropic | Create distinctive, production-grade frontend interfaces with high design quality. Generates creative, polished code that avoids generic AI aesthetics |
| fullstory | monitoring | Fullstory | Connect Claude to Fullstory to query behavioral analytics, session replays, and customer experience insights. |
| gc-ai | productivity | GC AI | Work in your GC AI legal knowledge base from Claude: upload documents, run review playbooks, and ask questions grounded in your own files, all as you. |
| github | productivity | Anthropic | Official GitHub MCP server for repository management. Create issues, manage pull requests, review code, search repositories, and interact with GitHub' |
| gitkraken | development | GitKraken | Gives Claude access to your real Git and project context: commits, branches, pull requests, and issues across every repo you work in. Works with GitHu |
| gitlab | productivity | Anthropic | GitLab DevOps platform integration. Manage repositories, merge requests, CI/CD pipelines, issues, and wikis. Full access to GitLab's comprehensive Dev |
| google-cloud-storage | deployment | Google LLC | Official Google Cloud Storage (GCS) plugin. Manage buckets and objects, transfer data, and configure MCP, FUSE, IAM, security, lifecycle rules, signed |
| gopls-lsp | development | Anthropic | Go language server for code intelligence and refactoring |
| grafana-assistant | monitoring | Grafana | Skills and rules for developing and using the Grafana Assistant app and CLI. |
| grafana-cloud-mcp | monitoring | Grafana | Hosted MCP server for AI-assisted Grafana Cloud observability — no local installation required. |
| grafana-mcp | monitoring | Grafana | MCP server for AI-assisted Grafana dashboard, datasource, alerting, and incident management. |
| greptile | development | Greptile | AI code review agent for GitHub and GitLab. View and resolve Greptile's PR review comments, run reviews on your working branch, and search your organi |
| growthbook | testing | GrowthBook | A suite of agent skills for the full GrowthBook feature flag and experimentation lifecycle. |
| honeycomb | monitoring | Honeycomb | Skills, agents, and workflows for Honeycomb observability — query patterns, production investigations, SLOs, OpenTelemetry instrumentation, and Beelin |
| hookify | productivity | Anthropic | Easily create custom hooks to prevent unwanted behaviors by analyzing conversation patterns or from explicit instructions. Define rules via simple mar |
| hostinger | deployment | Hostinger | Deploy, manage and monitor Hostinger services — Websites, Domains, Ecommerce, Email Marketing, Subscriptions & Payments, and VPS. Authenticate via bro |
| huggingface-skills | development | third-party | Build, train, evaluate, and use open source AI models, datasets, and spaces. |
| hunter | productivity | Hunter.io | Find and verify professional email addresses, search contacts by domain, and enrich company data -- directly in Claude. |
| hyperframes | design | HeyGen | HyperFrames by HeyGen. Write HTML, render video. Compositions, GSAP and runtime adapter animations, captions, voiceovers, audio-reactive visuals, and  |
| idmp-plugin | development | TaosData | TDengine IDMP plugin with packaged skills for discovery, schema inspection, and safe operational workflows. |
| imessage | productivity | Anthropic | iMessage messaging bridge with built-in access control. Reads chat.db directly, sends via AppleScript. Manage pairing, allowlists, and policy via /ime |
| informatica-for-claude-platform | database | Informatica | Governed catalog discovery for Informatica Intelligent Data Management Cloud (CDGC): find tables, columns, files, glossary terms and policies across t |
| intercom | productivity | third-party | Intercom integration for Claude Code. Search conversations, analyze customer support patterns, look up contacts and companies, and install the Interco |
| jdtls-lsp | development | Anthropic | Java language server (Eclipse JDT.LS) for code intelligence |
| jfrog | security | JFrog Ltd. | Use the JFrog Platform from Claude Code: Artifactory repos and artifacts, security findings and exposures, Catalog package safety and downloads, workf |
| knowledge-catalog | database | Google LLC | Connect to Knowledge Catalog to discover, manage, monitor, and govern data and AI artifacts across your data platform |
| kotlin-lsp | development | Anthropic | Kotlin language server for code intelligence |
| langfuse-observability | monitoring | Langfuse | Langfuse observability plugin for Claude Code — captures and exports traces, spans, and session telemetry from Claude Code to Langfuse for LLM monitor |
| laravel-boost | development | Anthropic | Laravel development toolkit MCP server. Provides intelligent assistance for Laravel applications including Artisan commands, Eloquent queries, routing |
| learn-with-coursera | learning | Coursera | Turn any learning intent into a personalized Coursera experience. Asks three quick questions (topic, familiarity, preferred format), searches Coursera |
| learning-output-style | learning | Anthropic | Interactive learning mode that requests meaningful code contributions at decision points (mimics the unshipped Learning output style) |
| legalzoom | productivity | third-party | Attorney guidance and legal tools for business and personal needs. AI-powered document review identifies critical risks and important clauses, advises |
| linear | productivity | Anthropic | Linear issue tracking integration. Create issues, manage projects, update statuses, search across workspaces, and streamline your software development |
| liquid-lsp | development | Shopify | LSP integration for Shopify Liquid templates via the Shopify CLI theme language server. |
| liquid-skills | development | Shopify | Liquid language fundamentals, CSS/JS/HTML coding standards, and WCAG accessibility patterns for Shopify themes |
| logfire | monitoring | Pydantic | Add Logfire observability to Python applications with auto-instrumentation for FastAPI, httpx, asyncpg, SQLAlchemy, and more |
| logrocket | monitoring | LogRocket | Connect Claude Code to LogRocket to query session replays, metrics, issues, and user behavior using natural language. |
| looker | database | Google LLC | Connect to Looker and interact with your data using LookML. |
| lovable | development | Lovable | Build, iterate on, deploy, and manage Lovable apps from Claude Code. Bundles the official Lovable MCP server (remote, OAuth 2.1) and adds focused comm |
| lua-lsp | development | Anthropic | Lua language server for code intelligence |
| lumen | development | Ory Corp | Precise local semantic code search via MCP. Indexes your codebase with Go AST parsing, embeds with Ollama or LM Studio, and exposes vector search to C |
| lusha | productivity | Lusha | Prospect, enrich, and build call-ready lead lists using Lusha's B2B intelligence platform — verified phone numbers, company signals, and lookalike tar |
| mapbox | location | Mapbox | Mapbox skills and MCP servers for building location-aware applications with AI. Includes geospatial tools, style management, and patterns for web, iOS |
| math-olympiad | math | Anthropic | Solve competition math (IMO, Putnam, USAMO) with adversarial verification that catches what self-verification misses. Fresh-context verifiers attack p |
| mattpocock-skills | development | Matt Pocock | Matt Pocock's agent skills for real engineering — grilling, spec/ticket flows, TDD, code review, domain modelling and more. Plug-and-play, not vibe co |
| mcp-apps | development | Anthropic / Model Context Protocol | Skills for creating MCP Apps with the MCP Apps SDK |
| mcp-server-dev | development | Anthropic | Skills for designing and building MCP servers that work seamlessly with Claude. Guides you through deployment models (remote HTTP, MCPB, local), tool  |
| mcp-tunnels | development | Anthropic | Connect Claude to a private MCP server through an Anthropic MCP tunnel. The /create-docker-mcp-tunnel command drives the Docker Compose quickstart end |
| mercadopago | development | Mercado Pago Developer Experience | Mercado Pago full-product integration toolkit. One agent routes to four orchestration skills (mp-integrate wizard, mp-webhooks, mp-test-setup, mp-revi |
| mergify | development | Mergify | Skills for the Mergify CLI: manage merge queues, stacked pull requests, Test Insights (flaky tests, quarantine), merge protections, and Mergify config |
| microsoft-docs | development | third-party | Access official Microsoft documentation, API references, and code samples for Azure, .NET, Windows, and more. |
| migration-to-aws | development | Amazon Web Services | Plan a migration from Google Cloud Platform (and OpenAI/Gemini AI workloads) to AWS. Analyzes your Infrastructure-as-Code files, app code, and GCP bil |
| mintlify | development | third-party | Build beautiful documentation sites with Mintlify. Convert non-markdown files into properly formatted MDX pages, add and modify content with correct c |
| miro | design | Miro | Secure access to Miro boards. Enables AI to read board context, create diagrams, and generate code with enterprise-grade security. |
| modern-web-guidance | development | Google Chrome | Keep your coding agent up to date with the latest web best practices |
| mlflow | monitoring | MLflow Team | Skills for tracing, evaluating, and improving AI agents with MLflow. Supports the full agent improvement loop: instrument → trace → evaluate → iterate |
| monday-crm | productivity | monday.com | Run your monday CRM in plain language. Build a pipeline from scratch, start the day with a ranked deal briefing, spin up a forecast dashboard, audit b |
| mongodb | database | third-party | Official Claude plugin for MongoDB (MCP Server + Skills). Connect to databases, explore data, manage collections, optimize queries, generate reliable  |
| mongodb-atlas | database | MongoDB | Connect to MongoDB Atlas clusters only through the Atlas Managed MCP Server. Sign in with your Atlas account to explore data, manage collections, opti |
| neon | database | third-party | Manage your Neon projects and databases with the neon-postgres agent skill and the Neon MCP Server. |
| netlify-skills | development | third-party | Netlify platform skills for Claude Code — functions, edge functions, blobs, database, image CDN, forms, config, CLI, frameworks, caching, AI gateway,  |
| netsuite-ai-companion | productivity | Oracle NetSuite | Guides AI assistants that use the NetSuite AI Connector: tool-selection order, output formatting, NetSuite domain knowledge, multi-subsidiary and curr |
| netsuite-finance-analyst | productivity | Oracle NetSuite | Director-level finance analysis on live NetSuite data: financial reporting, period close, variance, aging and reconciliation reviews, cash reporting,  |
| netsuite-suitecloud | development | Oracle NetSuite | Develop NetSuite SuiteCloud solutions with SuiteScript, SDF, and best practices: SuiteScript records and upgrades, SDF objects, roles and permissions, |
| newrelic | monitoring | New Relic | New Relic observability intelligence for Claude Code. Investigate APM performance, analyze cloud costs, debug Kubernetes, write NRQL queries, and resp |
| nightvision | - | third-party | Skills for working with NightVision, a DAST and API Discovery platform that finds exploitable vulnerabilities in web applications and REST APIs |
| nimble | - | third-party | Nimble web data toolkit — search, extract, map, crawl the web and work with structured data agents |
| noibu | monitoring | Noibu | Built for ecommerce, the Noibu plugin bridges the gap between customer experience and revenue by connecting Claude directly to your store's session, e |
| notion | productivity | third-party | Notion workspace integration. Search pages, create and update documents, manage databases, and access your team's knowledge base directly from Claude  |
| nvidia-skills | development | NVIDIA | Find the right NVIDIA skill for GPU acceleration, CUDA, AI agents, data loading, training, inference, robotics, Physical AI, Omniverse, simulation, an |
| oracle-ai-data-platform-workbench-databricks-migrator | development | Oracle | Drive the Oracle AI Data Platform (AIDP) Databricks Migration Toolkit in natural language. Plans and executes automated Databricks → AIDP migrations o |
| oracle-ai-data-platform-workbench-engineer-agent | development | Oracle | Oracle AI Data Platform (AIDP) Workbench engineer agent for Claude Code — a 37-skill agent that operates the full Spark/Delta lakehouse in natural lan |
| oracle-ai-data-platform-workbench-spark-connectors | development | Oracle | Oracle AI Data Platform Workbench Spark connectors for Claude Code. 18 connector skills covering every data source workbench customers commonly need:  |
| oracledb | database | Google LLC | Connect, query, and interact with Oracle Databases and their data. |
| outputai | development | Output.ai | Output.ai workflow development toolkit for Claude Code. Adds 5 specialist agents (planner, builder, debugger, prompt writer, quality reviewer), 40+ sl |
| pagerduty | monitoring | third-party | Enhance code quality and security through PagerDuty risk scoring and incident correlation. Score pre-commit diffs against historical incident data and |
| paypal | development | PayPal | PayPal development plugin for Claude — integrate payments, subscriptions, invoices, disputes, and more using PayPal's APIs and MCP server |
| pendo-analytics | productivity | Pendo | Bring Pendo product analytics into Claude Code: account health, feature adoption, session replay lookup and triage, feedback analysis, and data-inform |
| pendo-guides | productivity | Pendo | Create production-ready Pendo in-app guides (walkthroughs, announcements, alerts, polls, promotions) as HTML/CSS/JS from a short intake conversation,  |
| pendo-orchestrate | productivity | Pendo | Create, configure and edit draft Pendo Orchestrate email journeys, including multi-email and conditional split flows, via the Pendo connector. Journey |
| php-lsp | development | Anthropic | PHP language server (Intelephense) for code intelligence |
| pigment | productivity | Pigment | Analyze business data and build custom Pigment models, metrics, and boards through natural language. |
| pinecone | database | third-party | Pinecone vector database integration. Streamline your Pinecone development with powerful tools for managing vector indexes, querying data, and rapid p |
| pixeltable | development | Pixeltable | Build multimodal AI applications with Pixeltable -- tables, computed columns, embedding search, UDFs, tool-calling agents, and 25+ AI provider integra |
| planetscale | database | third-party | An authenticated hosted MCP server that accesses your PlanetScale organizations, databases, branches, schema, and Insights data. Query against your da |
| playground | development | Anthropic | Creates interactive HTML playgrounds — self-contained single-file explorers with visual controls, live preview, and prompt output with copy button. In |
| playwright | testing | Anthropic | Browser automation and end-to-end testing MCP server by Microsoft. Enables Claude to interact with web pages, take screenshots, fill forms, click elem |
| plugin-dev | development | Anthropic | Comprehensive toolkit for developing Claude Code plugins. Includes 7 expert skills covering hooks, MCP integration, commands, agents, and best practic |
| posthog | monitoring | third-party | Access PostHog analytics, feature flags, experiments, error tracking, and insights directly from Claude Code. |
| postiz | - | third-party | Social media automation CLI for scheduling posts, managing integrations, uploading media, and tracking analytics across 28+ platforms including X, Lin |
| postman | development | third-party | Full API lifecycle management for Claude Code. Sync collections, generate client code, discover APIs, run tests, create mocks, publish docs, and audit |
| pr-review-toolkit | productivity | Anthropic | Comprehensive PR review agents specializing in comments, tests, error handling, type design, code quality, and code simplification |
| preset-cli-skills | development | Preset | Preset CLI skills for explicit shell, scripting, and CI/CD workflows driven by the `sup` CLI (PyPI package `superset-sup`). Use only for CLI workflows |
| prisma | - | third-party | Prisma MCP integration for Postgres database management, schema migrations, SQL queries, and connection string management. Provision Prisma Postgres d |
| project-artifact | productivity | Anthropic | Generate and publish a living project status page — overview & success criteria, the workstream sequence, and next steps — as a shareable claude.ai ar |
| pydantic-ai | development | third-party | Write accurate Pydantic AI code from the start. Up-to-date patterns, decision trees, and common gotchas for agents, tools, structured output, streamin |
| pyright-lsp | development | Anthropic | Python language server (Pyright) for type checking and code intelligence |
| qdrant-skills | database | Qdrant | Agent skills for Qdrant vector search covering scaling, performance optimization, search quality, monitoring, deployment, model migration, version upg |
| qodo | development | Qodo | Qodo setup, code intelligence, and review workflows. |
| qodo-standards | development | Qodo | Optional Qodo rules discovery and standards administration workflows. |
| qt-development-skills | development | Qt Group | Agentic engineering skills for Qt software development — Qt C++/QML code review, QML coding, and Qt C++/QML code documentation. |
| quarkus-agent | development | Quarkus | MCP server for AI coding agents to create, manage, and interact with Quarkus applications. Provides tools for project scaffolding, dev mode lifecycle, |
| railway | deployment | third-party | Deploy and manage apps, databases, and infrastructure on Railway. Covers project setup, deploys, environment configuration, networking, troubleshootin |
| ralph-loop | development | Anthropic | Interactive self-referential AI loops for iterative development, implementing the Ralph Wiggum technique. Claude works on the same task repeatedly, se |
| rc | development | third-party | Configure RevenueCat projects, apps, products, entitlements, and offerings directly from Claude Code. Manage your in-app purchase backend without leav |
| receipts | productivity | Anthropic | A personal Claude Code impact report for justifying your usage to a manager or a self-review: what you shipped, which projects it went to, and each pr |
| redis-development | database | Redis | Redis development best practices — data structures, query engine, vector search, caching, and performance optimization |
| remember | - | third-party | Continuous memory for Claude Code. Extracts, summarizes, and compresses conversations into tiered daily logs. Claude remembers what you did yesterday. |
| render | deployment | Render | Deploy, debug, and monitor applications on Render. Includes skills, an agent, slash commands, and a render.yaml validation hook. |
| resend | development | Resend | Agent skills for working with Resend to send and receive emails — email API integration, agent inbox, CLI, React Email components, and deliverability  |
| revenuecat | development | third-party | Configure RevenueCat projects, apps, products, entitlements, and offerings directly from Claude Code. Manage your in-app purchase backend without leav |
| rill | development | Rill Data | Skills for developing and querying projects in the Rill business intelligence platform |
| rootly | monitoring | Rootly | Full-lifecycle incident management: deploy safety, incident response, on-call management, and retrospectives. |
| ruby-lsp | development | Anthropic | Ruby language server for code intelligence and analysis |
| runway-api | design | Runway | Video generation at scale. Generate videos, images, and audio with Runway's API — batch ad campaigns, product videos, multishot stories, and creative  |
| rust-analyzer-lsp | development | Anthropic | Rust language server for code intelligence and analysis |
| sagemaker-ai | development | third-party | Build, train, and deploy AI models with deep AWS AI/ML expertise brought directly into your coding assistants, covering the surface area of Amazon Sag |
| salesforce-development | development | Salesforce | Build Salesforce apps and agents using these core building blocks: metadata, Apex, deploy/retrieve, security, reporting, and generated installed-versu |
| sanity | development | Sanity | Sanity content platform integration with MCP server, agent skills, and slash commands. Query and author content, build and optimize GROQ queries, desi |
| sap-cds-mcp | development | SAP SE | AI-assisted development of SAP Cloud Application Programming Model (CAP) projects. Search CDS models and CAP documentation. |
| sap-fiori-mcp-server | development | SAP SE | MCP server for SAP Fiori development tools for Claude Code. Build and modify SAP Fiori applications with AI assistance. |
| sap-hana-cli | database | SAP SE | 150+ SAP HANA database tools for AI assistants. Query tables, import/export data, profile data quality, compare schemas, manage backups, monitor perfo |
| sap-mdk-server | development | SAP SE | MCP server for SAP Mobile Development Kit (MDK). Build and modify MDK applications with AI assistance — schema lookups, action validation, rule editin |
| save-to-spotify | productivity | Spotify | Create polished audio episodes with TTS narration, rich timelines, cover images, and save them to Spotify via the save-to-spotify CLI. |
| scandit-sdk | development | Scandit | AI agent skills for integrating the Scandit Data Capture SDK — product selection, documentation, and implementation guides for barcode scanning, ID ca |
| security-guidance | security | Anthropic | Security review for Claude-generated code. Pattern-based warnings on edits, LLM-powered diff review on Stop, and an agentic commit reviewer that catch |
| semgrep | security | third-party | Semgrep catches security vulnerabilities in real-time and guides Claude to write secure code from the start. |
| sentry | monitoring | third-party | Sentry error monitoring integration. Access error reports, analyze stack traces, search issues by fingerprint, and debug production errors directly fr |
| sentry-cli | monitoring | Sentry | Skills for using the Sentry CLI to interact with Sentry from the command line |
| serena | development | Anthropic | Semantic code analysis MCP server providing intelligent code understanding, refactoring suggestions, and codebase navigation through language server p |
| servicenow-sdk | development | ServiceNow | Create, edit, and deploy ServiceNow applications with the Fluent SDK effortlessly through Claude AI. |
| session-report | productivity | Anthropic | Generate an explorable HTML report of Claude Code session usage — tokens, cache efficiency, subagents, skills, and the most expensive prompts — from l |
| setup-agent-analytics | development | Pendo | Detect AI agents in your codebase and instrument them with Pendo Agent Analytics via the best-fit path: Python SDK, TypeScript SDK, client-side trackA |
| setup-mcp-agent-analytics | development | Pendo | Detect an MCP server's language (Python, TypeScript or Go) and instrument it with the matching Pendo SDK so MCP tool calls flow into Pendo Agent Analy |
| shippo | productivity | Shippo | Shippo connects you to USPS, UPS, FedEx, DHL, and 40+ carriers, so you can handle a shipment end to end right inside Claude. Compare live rates and pi |
| shopify-ai-toolkit | development | Shopify | Shopify's AI Toolkit provides 18 development skills for building on the Shopify platform, covering documentation search, API schema access, GraphQL an |
| skill-creator | development | Anthropic | Create new skills, improve existing skills, and measure skill performance. Use when users want to create a skill from scratch, update or optimize an e |
| slack | productivity | third-party | Slack workspace integration. Search messages, access channels, read threads, and stay connected with your team's communications while coding. Find rel |
| snowflake-cortex-code | development | Snowflake | Automatically route Snowflake prompts from Claude Code to Cortex Code for execution. Provides slash commands for code review and task delegation, plus |
| sonarqube | security | SonarSource | Automatically enforce SonarQube code quality and security in the agent coding loop — 7,000+ rules, secrets scanning, agentic analysis, and quality gat |
| sonatype-guide | security | third-party | Sonatype Guide MCP server for software supply chain intelligence and dependency security. Analyze dependencies for vulnerabilities, get secure version |
| sourcegraph | development | third-party | Code search and understanding across codebases. Search, read, and trace references across repositories; analyze refactor impact; investigate incidents |
| spanner | database | Google LLC | Connect and interact with Spanner data using natural language. |
| spotify-ads-api | productivity | third-party | Manage Spotify ad campaigns with natural language. Create campaigns, ad sets, ads, pull reports, and handle OAuth — all through conversation. |
| stackhawk-hawkscan | security | StackHawk | Configure, run, and interpret HawkScan DAST results inside Claude Code. Generates stackhawk.yml configs, runs scans via CLI or Docker, and transforms  |
| stackhawk-api | security | StackHawk | Query the StackHawk platform API for security posture reporting, findings analysis, and app management. Guides agents through authentication, data ret |
| streaming-skills-plugin | development | Confluent | Skills for streaming application developers, covering Kafka and Flink client libraries and Schema Registry |
| stripe | development | third-party | Stripe development plugin for Claude |
| sumup | development | third-party | SumUp payment integrations across terminal and online checkout flows. Build Android and iOS POS apps with SumUp card readers, online checkout with ser |
| supabase | database | third-party | Supabase MCP integration for database operations, authentication, storage, and real-time subscriptions. Manage your Supabase projects, run SQL queries |
| superdesign | design | Superdesign dev, Inc. | Design or redesign frontend UI and marketing graphics on the Superdesign infinite canvas. Reads your codebase for context, sets up a design system, an |
| superpowers | development | third-party | Superpowers teaches Claude brainstorming, subagent driven development with built in code review, systematic debugging, and red/green TDD. Additionally |
| swift-lsp | development | Anthropic | Swift language server (SourceKit-LSP) for code intelligence |
| synthflow | automation | Synthflow | Connects Claude Code to the Synthflow AI voice-agent platform through its hosted MCP server, with skills for reviewing calls and auditing agent prompt |
| tavily | development | Tavily Team | Build AI applications with real-time web data using Tavily's search, extract, crawl, and research APIs. |
| teamcity-cli | development | JetBrains | Agent skill for interacting with TeamCity CI/CD using the teamcity CLI. Enables Claude to explore builds, view logs, start jobs, manage queues, agents |
| telegram | productivity | Anthropic | Telegram messaging bridge with built-in access control. Manage pairing, allowlists, and policy via /telegram:access. |
| terraform | development | Anthropic | The Terraform MCP Server provides seamless integration with Terraform ecosystem, enabling advanced automation and interaction capabilities for Infrast |
| togetherai-skills | development | Together AI | Agent Skills for Together AI platform — inference, training, embeddings, audio, video, images, function calling, and infrastructure. Covers serverless |
| twilio-developer-kit | development | Twilio | Twilio Skills provide procedural knowledge for AI coding agents — which APIs to use, in what order, and what to avoid. Covers SMS, Voice, WhatsApp, Ve |
| typescript-lsp | development | Anthropic | TypeScript/JavaScript language server for enhanced code intelligence |
| ui-theme-designer | design | SAP SE | Plugin for coding agents working with UI theme designer. Bundles two skills: how-to and conceptual answers about UI theme designer on BTP, and questio |
| ui5 | development | SAP SE | SAPUI5 / OpenUI5 plugin for coding agents. Create and validate UI5 projects, access API documentation, run UI5 linter, get development guidelines and  |
| ui5-modernization | development | SAP SE | Complete UI5 modernization toolkit with workflow and specialized fix patterns for modernizing SAPUI5/OpenUI5 applications. |
| ui5-typescript-conversion | development | SAP SE | SAPUI5 / OpenUI5 plugin for coding agents. Convert JavaScript based UI5 projects to TypeScript. |
| unity | development | Unity Technologies | Unity's official plugin for Claude Code, with curated skills for game development, monetization, and performance optimization. |
| unreal-engine-skills-for-claude-code | development | Epic Games | Control Unreal Editor directly from Claude Code via MCP. Hundreds of tools exposed via Unreal's ToolsetRegistry across 30+ toolsets: actors, blueprint |
| valtown | deployment | Val Town | Build and deploy on Val Town. Bundles the Val Town MCP server and platform skills (HTTP vals, cron/intervals, SQLite, email, OAuth, React UI, third-pa |
| vanta | security | Vanta | The Vanta plugin connects Claude Code to Vanta's security and compliance platform through the Vanta MCP server. It combines Vanta's test-specific reme |
| vanta-mcp-plugin | security | Vanta | The Vanta plugin connects Claude Code to Vanta's security and compliance platform through the Vanta MCP server. It combines Vanta's test-specific reme |
| vercel | deployment | third-party | Vercel deployment platform integration. Manage deployments, check build status, access logs, configure domains, and control your frontend infrastructu |
| vibe-prospecting | productivity | vibeprospecting.ai | Vibe Prospecting connects Claude to live B2B company and contact data so users can search, match, enrich, filter, and export prospects at scale. It tu |
| vsql-extension-builder | database | VillageSQL | Builds a VillageSQL extension for MySQL end-to-end through a 7-phase persona-driven workflow. Commonly used to port PostgreSQL extensions to MySQL. |
| windsor-ai | productivity | Windsor.ai | Connect Claude Code to 325+ business data sources via Windsor.ai. Query marketing, sales, CRM, ecommerce, finance, and analytics data from Google Ads, |
| wix | development | third-party | Build, manage, and deploy Wix sites and apps. CLI development skills for dashboard extensions, backend APIs, site widgets, and service plugins with th |
| build-with-wordpress | - | third-party | Craft production-grade WordPress sites and applications. Everything from themes and plugins to commerce and deployment. |
| workos | security | WorkOS | WorkOS integration skills for AuthKit, SSO, Directory Sync, RBAC, Vault, Audit Logs, migrations, and API references. |
| youdotcom-agent-skills | productivity | You.com | You.com agent skills for web search, research with citations, and content extraction. Guided integrations for Vercel AI SDK, Claude Agent SDK, OpenAI  |
| zapier | productivity | third-party | Connect 8,000+ apps to your AI workflow. Discover, enable, and execute Zapier actions directly from your client. |
| zilliz | database | Zilliz | Zilliz Cloud management plugin with 14 skills covering cluster lifecycle, collection schema, vector search, index tuning, bulk import, RBAC, backups,  |
| zoom-plugin | development | third-party | Claude plugin for planning, building, and debugging Zoom integrations across REST APIs, SDKs, webhooks, bots, and MCP workflows. |
| zoominfo | productivity | ZoomInfo | Search companies and contacts, enrich leads, find lookalikes, and get AI-ranked contact recommendations. Pre-built skills chain multiple ZoomInfo tool |
| zscaler | security | Zscaler | Manage Zscaler cloud security platform including ZPA (private access), ZIA (internet access), ZDX (digital experience), ZCC (client connector), EASM ( |
| langfuse | monitoring | Langfuse | Skills for working with Langfuse, the open-source LLM engineering platform for tracing, prompt management, and evaluation. |
| zyte-web-data | automation | Zyte | Web scraping skills for Claude Code powered by the Zyte API — scrape sites, generate and run Scrapy spiders, define extraction schemas, and ship to Sc |
| activecampaign | productivity | ActiveCampaign | Marketing automation, CRM, and email marketing powered by ActiveCampaign. Manage contacts, campaigns, automations, deals, and get AI-powered marketing |
| hubspot-sales | productivity | HubSpot | Run your HubSpot sales workflow directly from Claude. Adds skills that cover the full sales day: import contacts and deals into HubSpot, get a priorit |
| dynatrace | monitoring | Dynatrace | Dynatrace observability skills: DQL query patterns, application and infrastructure monitoring, log analysis, problem investigation, and incident respo |
