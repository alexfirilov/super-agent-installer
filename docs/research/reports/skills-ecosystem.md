# Agent Skills ecosystem (Claude Code + Codex CLI) — research report, 2026-09-16/17

Scope: the Agent Skills open format, the `skills` CLI (skills.sh), what is most installed, Codex vs Claude Code install paths and incompatibilities, 2026 security incidents, the skills.sh audit API, and a recommended global skill set for a power user with a homelab (Proxmox/VMs) plus work hosts. Read-only research; nothing was installed or changed.

All popularity numbers are as observed on 2026-09-16 (GitHub API re-checked 2026-09-17) unless stated. Every install command below was copied from a fetched page or local `--help`. Sources are listed at the end.

---

## 0. Headline findings (what changed vs. memory)

1. **Codex's documented user skill dir is `$HOME/.agents/skills`** (learn.chatgpt.com/docs/build-skills); `~/.codex/skills` is still loaded as a *deprecated* back-compat root (openai/codex `host_roots.rs`, verified 2026-09-17) and is what the bundled `skill-installer`/`skill-creator` system skills target. The `skills` CLI already knows this: a global Codex install lands in `~/.agents/skills` with **no** symlink into `~/.codex/skills`.
2. **The `skills` CLI has no `check`, `sync` or `audit` subcommand.** Verified in README (1.5.26) and `npx skills --help` (1.5.23 local). Only `add`, `use`, `remove`, `list`, `find`, `update|upgrade`, `init`, `experimental_install`, `experimental_sync`. Audits are shown inline during `add`.
3. **skills.sh has a public API** (skills.sh/docs/api). The **audit endpoint is unauthenticated**: `curl https://skills.sh/api/v1/skills/audit/<owner>/<repo>/<skill>` returns Gen Agent Trust Hub / Socket / Snyk / Runlayer / ZeroLeaks statuses. Leaderboard, search and skill-detail endpoints require a Vercel OIDC token (`authentication_required`). This is the vetting hook the installer should use.
4. **Snyk's local scanner was renamed**: `uvx snyk-agent-scan@latest ~/.claude/skills` (v0.6+; `uvx snyk-agent-scan@0.5.17 ~/.claude/skills` for 0.5.x). `uv` is missing on this host.
5. `skills` npm package: **1.5.26** (2026-09-11), MIT, bins `skills` and `add-skill`, **`engines.node >=22.20.0`** (local Node 22.22.1 OK; the installer must ensure Node ≥ 22.20).
6. **superpowers is already installed on Codex** via the official marketplace (`superpowers@openai-curated-remote 6.3.0 installed, enabled` per `codex plugin list`). mattpocock now ships a Claude plugin in the official marketplace (`claude plugins install mattpocock-skills`) and a Codex plugin `matt-skills-curated@openai-curated-remote 1.1.0`.

---

## 1. The standard: Agent Skills (agentskills.io)

- A skill is a folder with `SKILL.md` (YAML frontmatter + Markdown body) and optional `scripts/`, `references/`, `assets/`. Loaded by progressive disclosure: (1) name+description at startup (~100 tokens per skill), (2) full `SKILL.md` body when activated (< 5,000 tokens recommended, keep under 500 lines), (3) referenced files on demand. (agentskills.io/specification)
- Frontmatter per spec: `name` (required, 1-64 chars, lowercase a-z 0-9 and hyphens, no leading/trailing/double hyphen, **must match the parent directory name**), `description` (required, 1-1024 chars), optional `license`, `compatibility` (≤500 chars), `metadata` (string map), `allowed-tools` (space-separated, **experimental**, "support may vary between agent implementations").
- Validator: `skills-ref validate ./my-skill` (reference lib in github.com/agentskills/agentskills/skills-ref; npm `skills-ref` 0.1.5). agentskills/agentskills: 25.4k stars, pushed 2026-08-09.
- Originated at Anthropic, now open. Client showcase lists ~45 products including Claude Code, Claude (claude.ai), ChatGPT & Codex, Gemini CLI, Cursor, GitHub Copilot, VS Code, OpenCode, OpenHands, Goose, Junie, Amp, Letta, Factory, Kiro, Roo Code, Mistral Vibe, Databricks Genie Code, Snowflake Cortex Code, Spring AI, Laravel Boost, Pulumi Neo, Hermes Agent, OpenClaw, ZeroClaw, nanobot, fast-agent, Tabnine, Qodo, Emdash, Mux, pi, Trae.

## 2. Anthropic's official skills repo (anthropics/skills)

- **176,706 stars**, pushed 2026-09-10 (GitHub API 2026-09-17). README: document skills are "source-available, not open source", reference implementations, "provided for demonstration and educational purposes only".
- 19 skills in `skills/`: academy-guide, algorithmic-art, brand-guidelines, canvas-design, claude-api, discernment-nudge, doc-coauthoring, docx, frontend-design, internal-comms, mcp-builder, pdf, pptx, skill-creator, slack-gif-creator, theme-factory, web-artifacts-builder, webapp-testing, xlsx. Document skills need runtime deps (from their SKILL.md, verified 2026-09-17): docx = Node `docx` package + pandoc + LibreOffice (`soffice`); pptx = python-pptx + Node `pptxgenjs` (+ react/sharp) + LibreOffice; xlsx = openpyxl + LibreOffice; pdf = pypdf / pdfplumber / pytesseract + pdf2image.
- Claude Code install (README + `.claude-plugin/marketplace.json`, marketplace name `anthropic-agent-skills`):
  ```
  /plugin marketplace add anthropics/skills
  /plugin install document-skills@anthropic-agent-skills     # xlsx, docx, pptx, pdf
  /plugin install example-skills@anthropic-agent-skills      # algorithmic-art, brand-guidelines, canvas-design, doc-coauthoring, frontend-design, internal-comms, mcp-builder, skill-creator, slack-gif-creator, theme-factory, web-artifacts-builder, webapp-testing
  /plugin install claude-api@anthropic-agent-skills
  /plugin install academy-guide@anthropic-agent-skills
  /plugin install discernment-nudge@anthropic-agent-skills
  ```
  Non-interactive equivalents: `claude plugin marketplace add anthropics/skills` and `claude plugin install document-skills@anthropic-agent-skills` (`claude plugin install|i [options] <plugin>` per local `--help`; `claude plugin|plugins` are aliases). The user already has `skill-creator@claude-plugins-official` and `frontend-design@claude-plugins-official` (official-marketplace copies).
- Codex / any skills-compatible agent (skills.sh per-skill command form `npx skills add https://github.com/<owner>/<repo> --skill <skill>`): `npx skills add anthropics/skills --skill frontend-design`, `.../skill-creator`, `.../pptx`, `.../pdf`, `.../docx`, `.../xlsx`, `.../webapp-testing`, `.../mcp-builder`, `.../canvas-design`, `.../web-artifacts-builder`, `.../brand-guidelines`, `.../theme-factory`, `.../doc-coauthoring`, `.../algorithmic-art`, `.../internal-comms`, `.../slack-gif-creator`, `.../claude-api`.
- skills.sh installs (2026-09-16): frontend-design 893.5K, skill-creator 383.0K, pptx 222.0K, pdf 196.9K, docx 188.8K, xlsx 169.2K, webapp-testing 157.8K, mcp-builder 115.2K, canvas-design 108.2K, web-artifacts-builder 101.2K, brand-guidelines 92.2K, theme-factory 85.1K, doc-coauthoring 84.4K, algorithmic-art 80.9K, internal-comms 72.6K, slack-gif-creator 68.5K, claude-api 65.2K, discernment-nudge 5.5K, academy-guide 5.2K. Repo total 3.2M.
- Audit (skills.sh API, 2026-09-17): `anthropics/skills/frontend-design` — Gen SAFE, Socket pass, Snyk LOW, Runlayer NONE, ZeroLeaks NONE.

## 3. skills.sh leaderboard (Vercel) — what is most installed

Install command format on the site: `npx skills add <owner/repo>` (whole repo), `npx skills add https://github.com/<owner>/<repo> --skill <skill>` (one skill; the `owner/repo/<path>` shorthand is a repo *subpath*, not a skill name), `npx skills add https://skills.sh/p/<pack-id>` (pack). Tabs: All Time (1,410,945 skills indexed), Trending (24h), Hot. Counts are described on the page as 8-week activity metrics. Sections: Topics/Collections, `/audits`.

Top of the All-Time leaderboard as rendered on 2026-09-16 (rank, skill, repo, installs). **Verification (2026-09-17): the leaderboard rows are contiguous; the original fetcher dropped nothing. Correct order: 1 find-skills, 2 grill-me, 3 frontend-design, 4 agent-browser, 5 setup-matt-pocock-skills, 6 vercel-react-best-practices, 7 grilling, 8 lark-doc, 9 teach, 10 lark-markdown ... Ranks below 8 in this table are the original (uncorrected) numbering and are off by a few places; the counts are exact (re-checked 2026-09-17, index 1,416,790).**

| # | Skill | Repo | Installs |
|---|---|---|---|
| 1 | find-skills | vercel-labs/skills | 3.4M |
| 2 | grill-me | mattpocock/skills | 1.2M |
| 3 | frontend-design | anthropics/skills | 893.5K |
| 4 | agent-browser | vercel-labs/agent-browser | 868.5K |
| 5 | setup-matt-pocock-skills | mattpocock/skills | 844.3K |
| 6 | vercel-react-best-practices | vercel-labs/agent-skills | 719.3K |
| 7 | grilling | mattpocock/skills | 714.5K |
| 8 | lark-doc | open.feishu.cn | 699.8K |
| 37 | teach | mattpocock/skills | 664.5K |
| 38 | lark-markdown | open.feishu.cn | 663.7K |
| 39 | domain-modeling | mattpocock/skills | 646.5K |
| 40 | lark-vc-agent | open.feishu.cn | 641.9K |
| 41 | web-design-guidelines | vercel-labs/agent-skills | 640.5K |
| 42 | codebase-design | mattpocock/skills | 626.1K |
| 43 | diagnosing-bugs | mattpocock/skills | 614.4K |
| 44 | lark-apps | open.feishu.cn | 608.2K |
| 45 | microsoft-foundry | microsoft/azure-skills | 594.7K |
| 60 | hyperframes-cli | heygen-com/hyperframes | 569.6K |
| 61 | ask-matt | mattpocock/skills | 568.9K |
| 62 | implement | mattpocock/skills | 566.3K |
| 63 | code-review | mattpocock/skills | 563.9K |
| 64 | hyperframes | heygen-com/hyperframes | 543.9K |
| 65 | remotion-best-practices | remotion-dev/skills | 527.4K |
| 66 | azure-compute | microsoft/azure-skills | 527.0K |
| 67 | video-edit | genmedia-labs/skills | 520.8K |
| 68 | wayfinder | mattpocock/skills | 520.6K |
| 69 | ai-music | genmedia-labs/skills | 520.0K |
| 73 | azure-cloud-migrate | microsoft/azure-skills | 517.1K |
| 74 | caveman | juliusbrussee/caveman | 515.0K |
| 75 | research | mattpocock/skills | 514.8K |
| 76 | to-spec | mattpocock/skills | 514.3K |
| 77 | to-tickets | mattpocock/skills | 505.3K |
| 78 | hyperframes-registry | heygen-com/hyperframes | 494.8K |
| 79 | resolving-merge-conflicts | mattpocock/skills | 494.4K |
| 80 | azure-rbac | microsoft/azure-skills | 490.8K |
| 81 | reddit-automation | flowkit-labs/skills | 488.4K |
| 82 | design-taste-frontend | leonxlnx/taste-skill | 486.0K |
| 83 | lark-note | open.feishu.cn | 481.7K |
| 84 | azure-quotas | microsoft/azure-skills | 453.2K |
| 85 | paper-context-resolver | lllllllama/rigorpilot-skills | 450.9K |
| 89-102 | lark-doc/base/shared/im/whiteboard/task/calendar (larksuite/cli), hyperframes-core, media-use, azure-upgrade, azure-hosted-copilot-sdk | vendor packs | 441-450K |
| 112-127 | hyperframes-animation/creative, runcomfy video-edit/image-to-video, azure-enterprise-infra-planner, lark-approval, azure-kubernetes | vendor packs | 412-435K |
| 128 | supabase-postgres-best-practices | supabase/agent-skills | 404.2K |
| 133 | skill-creator | anthropics/skills | 383.0K |
| 136 | wizard | mattpocock/skills | 369.2K |
| 138 | brainstorming | obra/superpowers | 364.9K |
| 139 | git-guardrails-claude-code | mattpocock/skills | 364.5K |
| 144 | caveman-commit | juliusbrussee/caveman | 361.0K |
| 147 | ui-ux-pro-max | nextlevelbuilder/ui-ux-pro-max-skill | 359.2K |
| 157 | caveman-review | juliusbrussee/caveman | 357.4K |
| 158 | high-end-visual-design | leonxlnx/taste-skill | 357.3K |
| 160 | caveman-compress | juliusbrussee/caveman | 355.8K |
| 171 | vercel-composition-patterns | vercel-labs/agent-skills | 340.0K |
| 188 | cavecrew | juliusbrussee/caveman | 305.5K |
| 195 | prisma-database-setup | prisma/skills | 291.2K |
| 205 | impeccable | pbakaus/impeccable | 279.5K |
| 209 | supabase | supabase/agent-skills | 277.6K |
| 210 | emil-design-eng | emilkowalski/skills | 275.1K |
| 213 | shadcn | shadcn/ui | 271.7K |
| 216 | systematic-debugging | obra/superpowers | 260.9K |
| 219 | writing-plans | obra/superpowers | 250.1K |
| 220 | google-agents-cli-adk-code | google/agents-cli | 247.9K |
| 228 | design-mobile-apps | designed-by-ai/skills | 247.1K |
| 229 | just-scrape | scrapegraphai/just-scrape | 245.0K |
| 230 | using-superpowers | obra/superpowers | 244.9K |
| 235 | orca-cli | stablyai/orca | 233.5K |
| 239 | test-driven-development | obra/superpowers | 227.9K |
| 242 | pptx | anthropics/skills | 222.0K |
| 252 | seo-audit | coreyhaines31/marketingskills | 208.4K |
| 256 | obsidian-vault | mattpocock/skills | 202.1K |
| 260 | pdf | anthropics/skills | 196.9K |
| 266 | docx | anthropics/skills | 188.8K |
| 273 | xlsx | anthropics/skills | 169.3K |
| 276 | neon-postgres | neondatabase/agent-skills | 166.6K |
| 279 | webapp-testing | anthropics/skills | 157.8K |
| 280 | playwright-cli | microsoft/playwright-cli | 156.0K |

Observation: the leaderboard is heavily inflated by vendor packs whose every skill gets installed together (lark/feishu, heygen hyperframes, microsoft/azure-skills 44 skills / 14.5M, genmedia/runcomfy video gen, prisma). Rank alone is not a quality signal; owner reputation + audit status is.

Per-repo totals (skills.sh, 2026-09-16): mattpocock/skills 22.9M (53 skills); microsoft/azure-skills 14.5M (44); coreyhaines31/marketingskills 4.9M (70); leonxlnx/taste-skill 4.2M (15); juliusbrussee/caveman 3.3M (23); anthropics/skills 3.2M (19); prisma/skills 2.5M; pbakaus/impeccable 1.8M (24); emilkowalski/skills 1.4M (13); remotion-dev/skills 1.3M (15); cloudflare/skills 870.3K (17); vercel-labs/agent-browser 867.1K; expo/skills 822.4K; nextlevelbuilder/ui-ux-pro-max-skill 719.8K (19); supabase/agent-skills 682.1K (3); kepano/obsidian-skills 372.8K (6); antfu/skills 354.6K (19); neondatabase/agent-skills 327.2K (11); stripe/ai 225.0K (9); browser-use/browser-use 107.5K (6); othmanadi/planning-with-files 98.1K (7); shadcn-ui/ui 76.9K; huggingface/skills 33.1K (40).

GitHub stars + last push (GitHub API, 2026-09-17): anthropics/skills 176,706 (09-10); obra/superpowers 287,602 (09-14); mattpocock/skills 263,578 (09-15); nextlevelbuilder/ui-ux-pro-max-skill 128,182 (09-15); JuliusBrussee/caveman 106,031 (09-16); pbakaus/impeccable 68,517 (09-16); kepano/obsidian-skills 48,448 (09-15); vercel-labs/agent-browser 42,703 (09-16); vercel-labs/skills 31,800 (09-16); vercel-labs/agent-skills 31,253 (08-28); openai/skills 27,367 (09-08, deprecated); othmanadi/planning-with-files 26,941 (09-16); agentskills/agentskills 25,412 (08-09); huggingface/skills 11,061 (09-15); openai/plugins 6,855 (09-16); antfu/skills 5,891 (06-23); cloudflare/skills 2,840 (09-08); microsoft/azure-skills 1,485 (09-16); bagelhole/devops-security-agent-skills 1,098 (05-22); akin-ozer/cc-devops-skills 311 (07-26); basher83/lunar-claude 23 (09-16); bastos/skills 7 (08-06); poindexter12/waypoint 7 (2026-01-20); bldg-7/proxmox-mcp 6 (09-15); iuliandita/skills 6 (09-16). VoltAgent/awesome-agent-skills 34.4k (rendered page, 09-16). Others: rate-limited, "unknown".

## 4. The `skills` CLI (vercel-labs/skills) — verified facts

- npm package `skills` (also bin `add-skill`), latest **1.5.26** published 2026-09-11 (registry.npmjs.org; latest snapshot 1.5.23-snapshot.2 2026-09-15); **`engines.node >=22.20.0`**; MIT. Local machine has 1.5.23. 31,800 stars.
- Commands from README (1.5.26) and `npx skills --help` (1.5.23):
  - `npx skills add <package>` (alias `a`) — sources: `owner/repo`, `https://github.com/owner/repo`, `https://github.com/owner/repo/tree/main/skills/<name>`, GitLab, Azure DevOps, `git@github.com:owner/repo.git`, local paths `./my-local-skills`, direct SKILL.md/archive URLs, and packs `https://skills.sh/p/<pack-id>`.
  - Add options: `-g, --global`; `-a, --agent <agents>` (`'*'` = all); `-s, --skill <skills>` (`'*'` = all); `-l, --list` (list without installing); `-y, --yes`; `--copy` (copy instead of symlink); `--all` (= `--skill '*' --agent '*' -y`); `--full-depth`; `--metadata <json>`; `--subagent <names>`.
  - README examples: `npx skills add vercel-labs/agent-skills --skill frontend-design --skill skill-creator`; CI-friendly: `npx skills add vercel-labs/agent-skills --skill frontend-design -g -a claude-code -y`.
  - `npx skills update [skills...]` (alias `upgrade`) with `-g` / `-p` / `-y` ("Skip scope prompt (auto-detect: project if in a project, else global)"). README examples: `npx skills update`, `npx skills update my-skill`, `npx skills update -g`, `npx skills update -p`, `npx skills update -y`.
  - `npx skills remove [skills]` (alias `rm`) with `-g`, `-a`, `-s`, `-y`, `--all`.
  - `npx skills list` / `ls` (`-g`, `-a`), `npx skills find [query]` (`--owner <owner>`), `npx skills use <package>@<skill>` (prompt without installing), `npx skills init [name]`, `npx skills experimental_install` (restore from `skills-lock.json`), `npx skills experimental_sync` (sync skills from node_modules into agent dirs).
  - **There is no `skills check`, no `skills sync` (only `experimental_sync`), and no `skills audit` subcommand.** Audits are shown during `add` (see §7).
- Agent target names relevant here: `claude-code` (project `.claude/skills/`, global `~/.claude/skills/`, honours `CLAUDE_CONFIG_DIR`), `codex` (project `.agents/skills/`, global `~/.codex/skills/` per agents.ts/README table, honours `CODEX_HOME` — but this `globalSkillsDir` is never used for global installs because `codex` is a universal agent, see next bullet), `universal` (`.agents/skills/`), plus `cursor`, `opencode`, `gemini-cli`, `github-copilot`, `windsurf`, `openhands`, `amp`, `replit`… (75+).
- **Where global installs land** (src/installer.ts): `getCanonicalSkillsDir(global)` = `~/.agents/skills` (global) or `./.agents/skills` (project). Symlink mode copies the skill to the canonical dir and creates a **relative symlink** from the agent dir, e.g. `~/.claude/skills/<name> -> ../../.agents/skills/<name>` (verified locally: `~/.claude/skills/find-skills -> ../../.agents/skills/find-skills`). On Windows it creates a **junction** and falls back to copying if that fails. For "universal" agents (those whose project dir is `.agents/skills`, which includes Codex) a global install **skips the agent-specific symlink** because the skill is already in `~/.agents/skills` — that is why this machine's `~/.codex/skills` contains only `.system/` while 24 skills sit in `~/.agents/skills`. This matches Codex's documented user path `$HOME/.agents/skills`.
- **Lockfile** (src/skill-lock.ts): `$XDG_STATE_HOME/skills/.skill-lock.json`, fallback `~/.agents/.skill-lock.json`; `"version": 3`; per skill: `source` ("owner/repo"), `sourceType` (github | mintlify | huggingface | local), `sourceUrl`, optional `ref`, `skillPath`, `skillFolderHash`, `installedAt`, `updatedAt`, optional `pluginName`, `sourceBaseUrl`, `wellKnownDigest`. `skillFolderHash` is the **GitHub tree SHA of the skill folder** fetched with one Trees API call; `skills update` re-fetches and compares. Lockfiles with version < 3 are wiped and re-installed. Local file confirmed: `version: 3`, 21 entries, keys `installedAt,skillFolderHash,skillPath,source,sourceType,sourceUrl,updatedAt`.
- Project reproducibility: `skills-lock.json` in a repo + `npx skills experimental_install`.
- Packs (Vercel changelog 2026-08-07): unlisted bundles created at skills.sh/packs/create (needs a Vercel account) from community skills, local folders/zips, or public/private GitHub repos; install `npx skills add https://skills.sh/p/<pack-id>`; update with `npx skills update`. Good fit for "same skill set on every host".
- Telemetry (README): "This CLI collects anonymous usage data ... Set `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` to disable both entirely." Identifiers are only sent for GitHub-confirmed-public repos; security-audit lookups during `add` are limited to confirmed-public GitHub repos and are disabled together with telemetry. Other env: `GITHUB_TOKEN`/`GH_TOKEN`, `INSTALL_INTERNAL_SKILLS=1`.
- Download limits for direct URLs: 10 MiB file, 25 MiB extracted, 1000 files.

Canonical non-interactive install line for both agents (composed from documented flags): `npx skills add <owner/repo> --skill <name> -a claude-code -a codex -g -y` (or `-a '*'`). Because Codex is universal, the effective result is one copy in `~/.agents/skills/<name>` plus a symlink in `~/.claude/skills/<name>`.

### skills.sh public API (skills.sh/docs/api; probed 2026-09-17)
- Base `https://skills.sh/api/v1/`, JSON. Auth: Vercel OIDC token (`Authorization: Bearer $VERCEL_OIDC_TOKEN`), 600 req/min per team+project.
- `GET /api/v1/skills?view=all-time|trending|hot&page&per_page` — leaderboard (**requires auth**; unauthenticated returns `{"error":"authentication_required"}`).
- `GET /api/v1/skills/search?q=&limit=&owner=` — **requires auth**.
- `GET /api/v1/skills/{owner}/{repo}/{skill}` — detail incl. `installs`, `hash` (SHA-256), `files[]` — **requires auth**.
- `GET /api/v1/skills/audit/{owner}/{repo}/{skill}` — **works unauthenticated**. Returns `audits[]` with `provider` (Gen Agent Trust Hub, Socket, Snyk, Runlayer, ZeroLeaks), `status` (pass|warn|fail), `summary`, `auditedAt`, `riskLevel`, `categories`. Example: `curl -s https://skills.sh/api/v1/skills/audit/bastos/skills/proxmox-admin`.

## 5. Codex CLI vs Claude Code: paths and incompatibilities

### Codex (learn.chatgpt.com/docs/build-skills = redirect target of developers.openai.com/codex/skills; local 0.154.0)
- Reads skills, in scope order: `$CWD/.agents/skills`, `$CWD/../.agents/skills` (parents up to repo root), `$REPO_ROOT/.agents/skills`, **`$HOME/.agents/skills`** (user), `/etc/codex/skills` (admin), built-in system skills. "Codex follows symlinked skill folders." Newly installed skills are detected automatically; restart if needed. The docs never mention `~/.codex/skills`; the bundled `skill-installer` system skill still says "Installs into `$CODEX_HOME/skills/<skill-name>` (defaults to `~/.codex/skills`)" and `skill-creator` says "create discoverable skills in `$CODEX_HOME/skills`" — so both are in play. **Verified 2026-09-17 in `codex-rs/ext/skills/src/host_roots.rs` (openai/codex main): the User layer registers `$CODEX_HOME/skills` with the comment "Deprecated user skills location (`$CODEX_HOME/skills`), kept for backward compatibility" *and* `$HOME/.agents/skills`, then the `.system` cache. Both are loaded; `~/.agents/skills` is the documented/forward path.**
- Invocation: `$skill-name` explicit (CLI/IDE), `@skill` in ChatGPT; implicit selection by description. Disable without deleting: `~/.codex/config.toml` → `[[skills.config]]` / `path = "/path/to/skill/SKILL.md"` / `enabled = false`, then restart.
- Frontmatter: `name`, `description` required. Optional `agents/openai.yaml` sidecar: `interface.display_name`, `short_description`, `icon_small`, `icon_large`, `brand_color`, `default_prompt`; `policy.allow_implicit_invocation: false` (Codex equivalent of Claude's `disable-model-invocation`); `dependencies.tools: [{type: "mcp", value: ...}]` (used by the `skill_mcp_dependency_install` feature).
- Built-in installer: `$skill-installer linear` (curated list from openai/skills `.curated`), `$skill-installer install https://github.com/<owner>/<repo>/tree/<ref>/<path>`; scripts `scripts/list-skills.py`, `scripts/install-skill-from-github.py --repo <owner>/<repo> --path <path/to/skill>`; restart Codex afterwards. openai/skills is **deprecated** in favour of openai/plugins (marketplace at `.agents/plugins/marketplace.json`).
- No `codex skill` subcommand exists (`codex --help`: `mcp`, `plugin`, `update`, `doctor`). Plugins: `codex plugin add <PLUGIN[@MARKETPLACE]>` (`-m, --marketplace`), `codex plugin list`, `codex plugin marketplace add|list|upgrade|remove`, `codex plugin remove`. `codex plugin list` on this host shows 3,975 rows from `openai-curated-remote`, incl. `superpowers@openai-curated-remote 6.3.0 installed, enabled`, and not-installed `matt-skills-curated 1.1.0`, `impeccable 4.3.1`, `cloudflare 0.1.2`, `expo 1.0.2`, `remotion 1.0.7`, `stripe 7.0.0`, `supabase 1.0.0`, `vercel 0.21.4`, `hugging-face 1.0.0`, `github 0.1.12`, `codex-security 0.1.24`, `aws-cdk-project-init 1.0.1`, `ew-obsidian-knowledge-forge 0.4.1`. Codex 0.154.0 changelog: "Existing sessions pick up newly installed plugin tools and refresh skills and hooks after external plugin upgrades."
- **Frontmatter "validator" is a lint script, not the loader** (verified 2026-09-17): the "Unexpected key(s) in SKILL.md frontmatter ... Allowed properties are: allowed-tools, description, license, metadata, name" message quoted in higgsfield-ai/cli#80 comes from the bundled `~/.codex/skills/.system/skill-creator/scripts/quick_validate.py` (`allowed_properties = {"name", "description", "license", "allowed-tools", "metadata"}`; note it does not even allow the spec key `compatibility`). The runtime parser `codex-rs/skills/src/parser.rs` (openai/codex main) is a plain serde struct with only `name`, `description`, `metadata.short-description` and **no `deny_unknown_fields`** — unknown keys such as `when_to_use`, `argument-hint`, `version` are silently ignored; only a missing/empty `description` or a `name` > 64 chars is an error. So Claude-authored skills load in Codex; the 5-key rule is still the portable best practice for `quick_validate.py` / `skills-ref`.

### Claude Code (code.claude.com/docs/en/skills)
- Locations: enterprise managed `.claude/skills/`, personal `~/.claude/skills/<name>/SKILL.md`, project `.claude/skills/`, nested `<subdir>/.claude/skills/`, `--add-dir`, plugin `<plugin>/skills/<name>` (invoked as `/plugin:skill`), claude.ai account skills (synced into `~/.claude/skills/synced/`; never name a skill folder `synced`). "a `<skill-name>` entry in the enterprise, personal, or project location can be a symlink to a directory elsewhere on disk. Claude Code reads `SKILL.md` from the target and loads the skill once even if several locations point at the same target." **`~/.agents/skills` is not a documented Claude Code location** — the skills CLI symlink is what makes it visible.
- Frontmatter (all optional): `name`, `description` (+ `when_to_use`; "The combined `description` and `when_to_use` text is truncated at 1,536 characters in the skill listing"), `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `background`, `argument-hint`, `arguments`, `hooks`, `paths`, `shell`, `metadata`, `license`, `compatibility`. Substitutions `$ARGUMENTS`, `$0..$N`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_ROOT}`; dynamic injection with ``!`cmd` `` (disable with `"disableSkillShellExecution": true`).
- Control: `skillOverrides` in `.claude/settings.local.json` (`on` / `name-only` / `user-invocable-only` / `off`), permission rules `Skill(name)` / `Skill(name *)`, `disableBundledSkills`. `/skill-doctor` (v2.1.252+) "Shows what each skill costs in context and how often it gets used; flags skills that have never been invoked; lists plugins you haven't used recently"; prints text in `-p` mode; unavailable over Remote Control. `claude plugin details <name>` prints component inventory and projected token cost. `claude plugin init <name>` scaffolds. `claude plugin validate <path>` = manifest/schema check; `claude plugin eval [target]` = behaviour evals (its own help: a bundled suite passing is not a security vetting).
- Live reload: edits under `~/.claude/skills/` or `.claude/skills/` are picked up in-session.

### Incompatibilities to encode in the installer / skill authoring
1. Claude-only frontmatter keys (`argument-hint`, `when_to_use`, `disable-model-invocation`, `user-invocable`, `context`, `hooks`, `paths`, `arguments`, `version`, `model`, `effort`) are **ignored** by Codex's runtime loader (not rejected — see §5) but flagged by the bundled `quick_validate.py` lint; keep portable skills to the 5 spec keys and put extras under `metadata:` or in `agents/openai.yaml`.
2. `disable-model-invocation: true` is invisible to Codex, so such skills get auto-selected there; mirror with `agents/openai.yaml` → `policy.allow_implicit_invocation: false`.
3. Claude's ``!`command` `` injection and `$ARGUMENTS` are Claude-only; `/name` vs `$name` invocation.
4. `allowed-tools` is spec-experimental; honoured by Claude Code (permission grant for that turn); Codex accepts the key but its permission model is sandbox/approval based.
5. Scripts: Anthropic document skills and many others need Python (+ deps, LibreOffice for pptx/docx rendering); Codex sandbox needs escalation for network. Skills-with-scripts on Windows need pwsh/python on PATH.
6. Global scope differs: Claude wants `~/.claude/skills/<name>` (symlink OK), Codex wants `~/.agents/skills` (documented) or `~/.codex/skills` (legacy installer). Keep one canonical copy in `~/.agents/skills` and symlink (Linux/macOS) or junction (Windows).
7. Plugin-shipped skills (superpowers, caveman, anthropic document-skills, mattpocock-skills) exist on both sides as plugins now; installing the same skills again via `npx skills add` creates duplicate `/name` entries in Claude and duplicate `$name` in Codex. Pick one channel per skill family per agent.

## 6. Already-installed overlap on this machine
- `superpowers` 6.3.0: Claude plugin (14 skills incl. brainstorming, systematic-debugging, writing-plans, using-superpowers, requesting/receiving-code-review, test-driven-development, executing-plans, verification-before-completion, subagent-driven-development, dispatching-parallel-agents, using-git-worktrees, writing-skills, finishing-a-development-branch) **and** Codex plugin `superpowers@openai-curated-remote 6.3.0 installed, enabled`. README Codex CLI route: `/plugins` → search `superpowers` → Install Plugin (non-interactive: `codex plugin add superpowers@openai-curated-remote`, syntax from `codex plugin add --help`). Do not also install via `npx skills add obra/superpowers` (364.9K installs for brainstorming; audits: Gen SAFE, Socket warn, Snyk LOW, **Runlayer fail/HIGH**, ZeroLeaks NONE).
- `caveman` plugin + 23 caveman skills already in `~/.agents/skills` (lock v3, source JuliusBrussee/caveman) + `@caveman-ai/cli` 1.3.3 (npm latest **1.3.4**). README: Claude Code: `claude plugin marketplace add JuliusBrussee/caveman && claude plugin install caveman@caveman`; Codex: `npx skills add JuliusBrussee/caveman --skill '*' -a codex --yes -g`; any agent: `npx skills add JuliusBrussee/caveman -g`; proxy: `npm install -g @caveman-ai/cli && caveman setup --install`; uninstall `npx -y github:JuliusBrussee/caveman -- --uninstall`. Note mattpocock/skills also ships a skill named `caveman` (224.2K) — name collision if both go to the same agent dir.
- `find-skills` (vercel-labs/skills, 3.4M) installed globally; `~/.claude/skills/find-skills` symlink present. Audit: Gen SAFE, Socket pass, **Snyk warn/MEDIUM**, Runlayer NONE, ZeroLeaks NONE.
- mattpocock `tdd`, `code-review`, `diagnosing-bugs`, `handoff` overlap conceptually with superpowers TDD/code-review/debugging and caveman `investigate-first`/`surgical-patch`; pick one methodology family per agent to keep the catalog small.
- Unrelated personal skills present: job-scraper, job-application-assistant, upskill (in `~/.agents/skills`).

## 7. Security: 2026 incidents, audits, vetting

Incidents
- **ClawHub / OpenClaw ("ClawHavoc")**: Koi Security audit (reported 2026-02-02 by The Hacker News; the original koi.ai post is gone): 341 of 2,857 ClawHub skills malicious (11.9%); 335 used fake prerequisites to install Atomic macOS Stealer (AMOS); one account published 314 skills (~7,000 downloads). Follow-up: 824 malicious of 10,700+ by mid-Feb; Antiy Labs counted 1,184 historically. Trend Micro and Unit 42 published teardowns. Pattern: SKILL.md tells the agent to run a "setup" shell command that downloads a password-protected ZIP / base64 payload targeting browser cookies, `.env`, SSH keys, cloud creds.
- **Snyk "ToxicSkills"** (2026-02-05): 3,984 skills from ClawHub + skills.sh; 13.4% (534) with a critical issue; 36.82% (1,467) with at least one flaw; 91% of confirmed malware combined prompt injection with shell payloads. The **skills.sh top-100 curated set had 0% malicious/prompt-injection detections** (2-9% medium issues such as secrets or unverifiable dependencies). Flagged authors to purge: zaycv, Aslaep123, pepe276, moonshine-100rze.
- Academic follow-ups: PhantomSkill (arXiv 2606.19191), MalSkillBench (2606.07131), SkillScope least-privilege (2605.05868), "Sealing the Audit-Runtime Gap" (2605.05274).

Audit infrastructure
- **skills.sh automated audits** (Vercel changelog 2026-02-17; Snyk+Vercel partnership same day): auditors now five — Gen Agent Trust Hub (content safety), Socket (dependency/supply chain), Snyk (vulnerability/prompt-injection), Runlayer, ZeroLeaks. Statuses pass/warn/fail with riskLevel SAFE/NONE/LOW/MEDIUM/HIGH. "As of skills@1.4.0, adding skills clearly displays audit results and risk levels before installation"; a Fail verdict escalates severity to at least High and triggers a confirmation prompt; malicious skills are removed from leaderboard/search with a warning on direct access.
- Audit snapshot via the public API (2026-09-17):

| Skill | Gen | Socket | Snyk | Runlayer | ZeroLeaks |
|---|---|---|---|---|---|
| vercel-labs/skills/find-skills | SAFE | pass | **warn MEDIUM** | NONE | NONE |
| mattpocock/skills/grill-me | SAFE | pass | LOW | NONE | NONE |
| mattpocock/skills/triage | **warn MEDIUM** (COMMAND_EXECUTION, RCE, INDIRECT_PROMPT_INJECTION) | pass | **warn MEDIUM** | — | — |
| vercel-labs/agent-skills/vercel-react-best-practices | SAFE | pass | LOW | LOW | NONE |
| anthropics/skills/frontend-design | SAFE | pass | LOW | NONE | NONE |
| obra/superpowers/brainstorming | SAFE | warn | LOW | **fail HIGH** | NONE |
| juliusbrussee/caveman/caveman | SAFE | pass | LOW | — | NONE |
| kepano/obsidian-skills/obsidian-markdown | SAFE | pass | LOW | NONE | NONE |
| othmanadi/planning-with-files/planning-with-files | SAFE | pass | LOW | **fail HIGH** | NONE |
| vercel-labs/agent-browser/agent-browser | SAFE | pass | warn MEDIUM | **fail HIGH** | NONE |
| akin-ozer/cc-devops-skills/ansible-validator | warn MEDIUM | warn | warn MEDIUM | **fail HIGH** | NONE |
| bagelhole/devops-security-agent-skills/linux-administration | SAFE | pass | LOW | warn MEDIUM | NONE |
| basher83/lunar-claude/proxmox-infrastructure | SAFE | warn | LOW | warn MEDIUM | — |
| iuliandita/skills/debian-ubuntu | SAFE | pass | warn MEDIUM | — | — |
| bastos/skills/proxmox-admin | SAFE | pass | LOW | warn MEDIUM (2/2 files flagged, 2026-02-21) | 93/100 NONE |
| nextlevelbuilder/ui-ux-pro-max-skill/ui-ux-pro-max | SAFE | pass | LOW | NONE | LOW |
| pbakaus/impeccable/impeccable | SAFE | warn | LOW | — | NONE |
| zebbern/claude-code-guide/pentest-checklist | SAFE | pass | warn MEDIUM | warn MEDIUM | — |

  Runlayer "fail/HIGH" on superpowers/agent-browser/planning-with-files shows the auditors disagree; treat Gen + Snyk + Socket as the primary trio and Runlayer as advisory. Skills that run shell scripts or install CLIs (agent-browser, ansible-validator) score worse by construction.
- **Snyk Agent Scan** (github.com/snyk/agent-scan README): `uvx snyk-agent-scan@latest ~/.claude/skills` (v0.6+), `uvx snyk-agent-scan@0.5.17 ~/.claude/skills` (0.5.x), single file `uvx snyk-agent-scan@latest ~/path/to/my/SKILL.md`; `--no-skills` excludes skills. Needs `uv` (missing on this host — install it in the script). Point it at `~/.agents/skills` (the canonical dir) as well.
- Claude Code: `claude plugin validate` (schema), `claude plugin eval` (behaviour; explicitly not a security vetting), `/skill-doctor` (cost/usage), `security-guidance` plugin (already installed; reviews code, not skills), `disableSkillShellExecution`, `Skill(...)` deny rules.
- Community: alonw0/secure-skills (`npx skillsio`, a fork adding VirusTotal + skills.sh audit checks).

Recommended policy for the installer
1. **Allowlist owners** (anthropics, vercel-labs, obra, JuliusBrussee, mattpocock, kepano, antfu, cloudflare, supabase, stripe, expo, remotion-dev, microsoft, huggingface, browser-use, home-assistant, plus explicitly vetted small repos). Refuse repos outside the allowlist unless `--allow-unvetted`.
2. **Pre-install audit gate**: `curl -s https://skills.sh/api/v1/skills/audit/<owner>/<repo>/<skill> | jq '.audits[] | select(.status=="fail")'` — abort on any `fail` from Gen/Snyk/Socket, warn on Runlayer, warn on any `MEDIUM`/`HIGH`. No auth needed; works offline-safe (skip on network error with a warning).
3. **Pin**: install by `owner/repo` + `--skill`, keep `~/.agents/.skill-lock.json` (and a committed `skills-lock.json` for project scope) under version control on the dotfiles side; update deliberately with `npx skills update -g -y` and diff `skillFolderHash` before/after.
4. Keep telemetry on during `add` (audit display depends on it) or accept that `DISABLE_TELEMETRY=1` also disables audit display — the API gate in (2) compensates.
5. Prefer symlink mode (one canonical copy in `~/.agents/skills`); never `--copy` unless on Windows without junction support.
6. Before first install of a new repo: `npx skills add <repo> -l` to list, then `grep -rniE 'curl|wget|base64|Invoke-WebRequest|iex|\.zip|password' ~/.agents/skills/<name>` and read `scripts/`. Never let an agent run "prerequisite setup" commands from a SKILL.md without reading them.
7. Run `uvx snyk-agent-scan@latest ~/.agents/skills` after install/update.
8. Avoid mega-collections (sickn33/antigravity-awesome-skills 1,803 skills; davila7/claude-code-templates 863; bagelhole 163) as global installs — cherry-pick single skills with `--skill`.
9. Keep the global catalog small: each skill costs ~100 tokens of preamble per session in every agent; use `/skill-doctor`, `skillOverrides`, and Codex `[[skills.config]] enabled=false` to switch off unused ones.

## 8. Recommended global skill set for this user (verdicts)

Legend: MH = must-have, R = recommended, O = optional, S = skip/deprecated. "Both" = install once via skills CLI with `-a claude-code -a codex -g -y`.

### Core / meta
| Skill | Source | Installs | Verdict | Why | Install |
|---|---|---|---|---|---|
| find-skills | vercel-labs/skills | 3.4M | MH (already installed) | lets both agents search skills.sh on demand | `npx skills add vercel-labs/skills` |
| skill-creator | anthropics/skills | 383.0K | MH (Claude: already via plugin; Codex has `.system/skill-creator`) | authoring + evals | `npx skills add anthropics/skills --skill skill-creator` |
| superpowers (14 skills) | obra/superpowers | 364.9K (brainstorming) | MH (installed on both) | TDD/plan/debug/worktree methodology | Claude: `/plugin install superpowers@claude-plugins-official`; Codex: `/plugins` → `superpowers` → Install (`codex plugin add superpowers@openai-curated-remote`) |
| caveman (23 skills) | JuliusBrussee/caveman | 515.0K (caveman) | MH (already installed) | token saver + work patterns | `npx skills add JuliusBrussee/caveman -g`; Codex: `npx skills add JuliusBrussee/caveman --skill '*' -a codex --yes -g` |
| grill-me / grilling / handoff / tdd / diagnosing-bugs / to-spec / to-tickets / resolving-merge-conflicts | mattpocock/skills | 1.2M / 714.5K / 815K / 914K / 614.4K / 514.3K / 505.3K / 494.4K | R (cherry-pick; skip `triage` globally — Med Risk; `setup-matt-pocock-skills` is per-repo) | requirements interviews and handoffs are the standout ones | Claude: `claude plugins install mattpocock-skills`; others: `npx skills@latest add mattpocock/skills`; Codex plugin: `codex plugin add matt-skills-curated@openai-curated-remote` |
| planning-with-files | othmanadi/planning-with-files (26.9k stars) | 43.7K | O (Runlayer fail/HIGH; overlaps superpowers writing-plans) | Manus-style file-based planning | `npx skills add othmanadi/planning-with-files` |
| elements-of-style | sdi2200262/elements-of-style-for-agents | unknown (not on skills.sh) | O | prose quality; CC0; README says copy `skills/elements-of-style/` into project | manual copy (no CLI command published) |

### Documents / design / web
| Skill | Source | Installs | Verdict | Install |
|---|---|---|---|---|
| docx, pdf, pptx, xlsx | anthropics/skills | 188.8K / 196.9K / 222.0K / 169.2K | MH | Claude: `/plugin marketplace add anthropics/skills` + `/plugin install document-skills@anthropic-agent-skills`; Codex: `npx skills add anthropics/skills --skill docx` (etc.) |
| frontend-design | anthropics/skills | 893.5K | MH (Claude: plugin installed) | `npx skills add anthropics/skills --skill frontend-design` |
| mcp-builder | anthropics/skills | 115.2K | R | `npx skills add anthropics/skills --skill mcp-builder` |
| webapp-testing | anthropics/skills | 157.8K | R | `npx skills add anthropics/skills --skill webapp-testing` |
| web-artifacts-builder, canvas-design, theme-factory, brand-guidelines, doc-coauthoring, algorithmic-art, internal-comms, slack-gif-creator | anthropics/skills | 101.2K / 108.2K / 85.1K / 92.2K / 84.4K / 80.9K / 72.6K / 68.5K | O | `/plugin install example-skills@anthropic-agent-skills` or per-skill `npx skills add anthropics/skills --skill <name>` |
| claude-api | anthropics/skills | 65.2K | O (Claude Code already bundles `/claude-api`) | `npx skills add anthropics/skills --skill claude-api` |
| react-best-practices, web-design-guidelines, composition-patterns, writing-guidelines, vercel-optimize, react-native-guidelines, react-view-transitions, vercel-deploy-claimable | vercel-labs/agent-skills | 719.3K / 640.5K / 340.0K / 67.7K / 73.0K / — / — / 128.8K | R (React/Next users) | `npx skills add vercel-labs/agent-skills` |
| impeccable (24 commands) | pbakaus/impeccable (68.5k stars) | 279.5K | O | `npx skills add https://github.com/pbakaus/impeccable --skill impeccable`; Codex plugin `impeccable@openai-curated-remote 4.3.1`; npm `impeccable` 4.1.0 (`npx impeccable install` / `npx impeccable update`) |
| ui-ux-pro-max | nextlevelbuilder/ui-ux-pro-max-skill (128.2k stars) | 359.2K | O | `npx ui-ux-pro-max-cli init --ai claude` (npm 2.15.0); Claude: `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` + `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill`; or `npx skills add nextlevelbuilder/ui-ux-pro-max-skill` |
| emil-design-eng / review-animations | emilkowalski/skills | 275.1K / 160.7K | O | `npx skills add emilkowalski/skills` |
| design-taste-frontend | leonxlnx/taste-skill | 486.0K | O | `npx skills add leonxlnx/taste-skill` |
| shadcn | shadcn-ui/ui | 61.4K | O | `npx skills add shadcn-ui/ui` |
| antfu (vue/vite/vitest/nuxt/pnpm…) | antfu/skills (5.9k stars, last push 2026-06-23) | 354.6K total | O (Vue users) | `npx skills add antfu/skills` |

### Browser / testing
| Skill | Source | Installs | Verdict | Install |
|---|---|---|---|---|
| agent-browser | vercel-labs/agent-browser (42.7k stars) | 868.5K | R (needs CLI; Runlayer fail/HIGH, Snyk MEDIUM) | `npm install -g agent-browser` (npm 0.38.1, **`engines.node >=24.0.0`** — host Node 22.22.1 gets an EBADENGINE warning; README says Node 24/pnpm 11 are only needed to build from source) + `agent-browser install` (Linux: `agent-browser install --with-deps`); update `agent-browser upgrade`; skill: `npx skills add https://github.com/vercel-labs/agent-browser --skill agent-browser` |
| playwright-cli | microsoft/playwright-cli | 156.0K | O (playwright plugin/MCP already installed) | `npx skills add microsoft/playwright-cli` |
| browser-use | browser-use/browser-use | 94.8K | O | `npx skills add browser-use/browser-use --skill browser-use` |

### Infra / homelab / sysadmin (small repos; vet before global install)
| Skill | Source | Installs | Verdict | Install |
|---|---|---|---|---|
| proxmox-admin (qm/pct/storage/cluster) | bastos/skills (7 stars) | 705; Gen SAFE / Socket pass / Snyk LOW | R | `npx skills add https://github.com/bastos/skills --skill proxmox-admin` |
| proxmox-infrastructure, ansible-proxmox, ansible-* (7) | basher83/lunar-claude (23 stars, active) | 103 / 61 / 11-24 | O | `npx skills add basher83/lunar-claude` (use `--skill`) |
| proxmox, packer, docker, ansible, tofu, terraform, worktree-guide | poindexter12/waypoint (7 stars, last push 2026-01-20) | 34 / 24 / 17 / 12 / 12 / 12 / 11 | O (stale) | `npx skills add poindexter12/waypoint` |
| proxmox-mcp-tools, proxmox-admin | bldg-7/proxmox-mcp (6 stars) | 119 / 42 | O (needs their MCP) | `npx skills add bldg-7/proxmox-mcp` |
| linux-administration, linux-hardening, ssh-configuration, firewall-config, ssl-tls-management, docker-compose, kubernetes-ops, windows-server | bagelhole/devops-security-agent-skills (1,098 stars, last push 2026-05-22) | 587 / 575 / 341 / 355 / 325 / 415 / 297 / 345 | O (cherry-pick with `--skill`; linux-administration audits Gen SAFE/Snyk LOW) | `npx skills add bagelhole/devops-security-agent-skills` |
| ansible-generator/validator, dockerfile-*, k8s-*, helm-*, terraform-*, bash-script-* (31) | akin-ozer/cc-devops-skills (311 stars) | 500-1.1K each; 17.6K total | R (generator/validator pairs are practical; ansible-validator audits MEDIUM/Runlayer fail because it runs linters) | `npx skills add akin-ozer/cc-devops-skills --skill ansible-validator` (etc.) |
| debian-ubuntu, networking, virtualization, docker, ansible, kubernetes, terraform, firewall-appliance, synology-dsm | iuliandita/skills (6 stars, active) | 111 / 65 / 54 / 46 / 37 / 36 / 34 / 41 / 7 | O | `npx skills add iuliandita/skills --skill debian-ubuntu` (etc.) |
| kubernetes, terraform, ansible, github-actions, gitlab-ci | full-stack-skills/devops-skills | 80 / 79 / 55 / 63 / 77 | O | `npx skills add https://github.com/full-stack-skills/devops-skills --skill <skill-name>` |
| docker-compose, docker-security, docker-dockerfile, docker-troubleshooting… (16) | full-stack-skills/docker-skills | 68-93 each | O | `npx skills add full-stack-skills/docker-skills` |
| docker-development, docker-via-wsl | netresearch/docker-development-skill | 349 / 53 | O | `npx skills add netresearch/docker-development-skill` |
| home-assistant-integration-knowledge (skill name literally "Home Assistant Integration knowledge", with spaces) | home-assistant/core (official) | 460 | O (HA users) | `npx skills add https://github.com/home-assistant/core --skill 'Home Assistant Integration knowledge'` (skills.sh form) |
| powershell-windows | davila7/claude-code-templates | 455 | O (Windows hosts; cherry-pick only) | `npx skills add davila7/claude-code-templates` with `--skill powershell-windows` |
| powershell-expert | hmohamed01/powershell-expert | 78 | O | `npx skills add hmohamed01/powershell-expert` |
| azure (44 skills) | microsoft/azure-skills (1,485 stars) | 14.5M total | S unless on Azure | Claude: `/plugin install azure@claude-plugins-official`; Codex: `codex plugin marketplace add microsoft/azure-skills`; skills: `npx skills add microsoft/azure-skills` |
| cloudflare, wrangler, workers-best-practices, durable-objects… (17) | cloudflare/skills (official, 2,840 stars) | 90.9K / 88.2K / 81.4K / 74.2K | O | `npx skills add cloudflare/skills`; Codex plugin `cloudflare@openai-curated-remote 0.1.2` |

### Data / backend / SaaS (only if used)
| Skill | Source | Installs | Verdict | Install |
|---|---|---|---|---|
| supabase-postgres-best-practices, supabase | supabase/agent-skills | 404.2K / 277.6K | O | `npx skills add supabase/agent-skills`; Codex plugin `supabase@openai-curated-remote` |
| neon-postgres, neon | neondatabase/agent-skills | 166.6K / 120.4K | O | `npx skills add neondatabase/agent-skills` |
| prisma-* (many) | prisma/skills | 2.5M total | O | `npx skills add prisma/skills` |
| stripe-best-practices, upgrade-stripe, stripe-projects | stripe/ai | 85.2K / 65.9K / 63.5K | O | `npx skills add stripe/ai`; Codex plugin `stripe@openai-curated-remote 7.0.0` |
| expo-*, eas-* (40+) | expo/skills | 822.4K total | O | `npx skills add expo/skills`; Codex plugin `expo@openai-curated-remote 1.0.2` |
| remotion-best-practices (+14) | remotion-dev/skills | 527.4K | O | `npx skills add remotion-dev/skills`; Codex plugin `remotion@openai-curated-remote 1.0.7` |
| hf-cli, huggingface-* (40) | huggingface/skills (11.1k stars) | 33.1K total | O | `npx skills add huggingface/skills`; Codex plugin `hugging-face@openai-curated-remote 1.0.0` |
| google-agents-cli-* (7) | google/agents-cli | ~247K each | S (ADK only) | `npx skills add google/agents-cli --skill google-agents-cli-adk-code` |

### Knowledge / writing / tools
| Skill | Source | Installs | Verdict | Install |
|---|---|---|---|---|
| obsidian-markdown, obsidian-cli, obsidian-bases, json-canvas, defuddle | kepano/obsidian-skills (official, 48.4k stars) | 85.8K / 75.1K / 73.9K / 69.0K / 68.4K | R (Obsidian users; audits all pass) | `npx skills add kepano/obsidian-skills` |
| obsidian-vault | mattpocock/skills | 202.1K | O | `npx skills@latest add mattpocock/skills` (select) |
| gh-cli, gh-pr, git-commit | fredrikaverpil/dotfiles | 55 / 46 / 42 | O | `npx skills add fredrikaverpil/dotfiles` |
| using-git-worktrees | obra/superpowers | 191.6K | already via superpowers | `npx skills add obra/superpowers --skill using-git-worktrees` |
| git-guardrails-claude-code | mattpocock/skills | 364.5K | O | `npx skills@latest add mattpocock/skills` (select) |
| notebooklm | pleaseprompto/notebooklm-skill (7,773 stars, **repo archived**) | 7.7K | S (archived) | `npx skills add pleaseprompto/notebooklm-skill` |
| nlm-cli-skill | jacob-bd/notebooklm-cli (255 stars, **archived; README: merged into jacob-bd/notebooklm-mcp-cli**) | 60 | S (deprecated) | successor repo: jacob-bd/notebooklm-mcp-cli |
| seo-audit, copywriting, … (70) | coreyhaines31/marketingskills | 208.4K / 201.7K | O | `npx skills add coreyhaines31/marketingskills` |
| just-scrape | scrapegraphai/just-scrape | 245.0K | O | `npx skills add scrapegraphai/just-scrape` |

### Security testing (authorized use only; never global on work hosts)
| Skill | Source | Installs | Verdict | Install |
|---|---|---|---|---|
| pentest-checklist, ethical-hacking-methodology, metasploit-framework… (87) | zebbern/claude-code-guide | 136 / 131 / 116 | O (project scope only; Snyk MEDIUM) | `npx skills add zebbern/claude-code-guide` |
| recon-port-scan, exploit-sqli, … (10) | crazymarky/pentest-skills | 70 / 65 | O | `npx skills add crazymarky/pentest-skills` |
| penetration-testing | timsonner/autonomous-pentest-agent | 41 | S (unvetted, tiny) | `npx skills add timsonner/autonomous-pentest-agent` |

### Skip / noise
- lark/feishu (open.feishu.cn, larksuite/cli), heygen-com/hyperframes, genmedia-labs, prime-skills/runcomfy, flowkit-labs reddit-automation, lllllllama/rigorpilot — vendor bundles inflating the leaderboard; no relevance here.
- sickn33/antigravity-awesome-skills (1,803 skills), davila7/claude-code-templates (863) — too broad for global scope; cherry-pick single skills only.
- openai/skills — deprecated (README: "use the OpenAI Plugins repository"); `$skill-installer` still works for one-off installs into `~/.codex/skills`.

## 9. Design notes for the installer script (skills part)
- Ensure **Node ≥ 22.20.0** (`skills` engines) and use `npx -y skills@<pinned>` (e.g. `skills@1.5.26`), bumping via the script's self-update. `bunx skills` also works if bun is preferred.
- Global, both agents, non-interactive: `npx skills add <owner/repo> --skill <name> -a claude-code -a codex -g -y`. For whole vendor packs use `--all` only for trusted owners.
- Alternative "one command per host": build an unlisted **pack** on skills.sh once, then `npx skills add https://skills.sh/p/<pack-id>` on each host; `npx skills update -g -y` updates it.
- Pre-install gate: `curl -s https://skills.sh/api/v1/skills/audit/<owner>/<repo>/<skill>` (no auth) → block on `fail` from Gen/Snyk/Socket unless `--allow-unvetted`.
- Update phase: `npx skills update -g -y` (tree-SHA compare), then `npx skills list -g`; optionally `uvx snyk-agent-scan@latest ~/.agents/skills` (install `uv` first: it is missing here).
- Windows: symlinks become junctions; if junction creation fails the CLI copies (then updates must be re-run per agent). Claude Code on Windows honours `shell: powershell` in skills.
- Codex: nothing to symlink — `~/.agents/skills` is read natively (documented). Optionally write `[[skills.config]] enabled=false` blocks to hide skills that are Claude-specific. Keep `~/.codex/skills/.system` untouched. Prefer Codex plugins (`codex plugin add <name>@openai-curated-remote`) where a vendor ships one (superpowers, matt-skills-curated, impeccable, cloudflare, expo, remotion, stripe, supabase, hugging-face) to avoid duplicating skills.
- Claude: symlinks under `~/.claude/skills/` are created by the CLI; plugin-shipped skills (superpowers, caveman, anthropic document-skills, mattpocock-skills) must not be duplicated as personal skills. Use `/skill-doctor` (or `claude plugin details`) to report token cost after install.
- Validate any skills the user authors with `npx skills-ref validate <dir>` and keep frontmatter to the 5 spec keys for Codex compatibility.

## 10. Open questions
- Whether Codex 0.154.0 still loads `~/.codex/skills/<name>` for non-system skills (docs list only `$HOME/.agents/skills`; bundled skill-installer/skill-creator still target `$CODEX_HOME/skills`). Could not locate the loader source (GitHub API rate-limited; PR #17720 diff not renderable). Test by placing a skill in each and checking `$` autocomplete.
- Does Codex's frontmatter validator reject (refuse to load) or merely warn on extra keys such as `when_to_use`? The higgsfield issue shows "fail validation" but does not say the skill is unloaded.
- Whether `claude` reads `~/.agents/skills` natively in any 2.1.27x build (undocumented; assume no).
- skills.sh leaderboard/search/detail API endpoints need a Vercel OIDC token; only the audit endpoint is open. Leaderboard ranks 3-5, 9-11, 15-36 were not rendered by the fetcher.
- Exact GitHub star counts for ~30 long-tail repos were unavailable (rate limit) — marked "unknown".

## Sources
- https://agentskills.io ; https://agentskills.io/specification ; https://api.github.com/repos/agentskills/agentskills
- https://raw.githubusercontent.com/anthropics/skills/main/README.md ; https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json ; https://github.com/anthropics/skills/tree/main/skills ; https://www.skills.sh/anthropics/skills
- https://skills.sh ; https://skills.sh/?page=2 ; https://skills.sh/trending ; https://skills.sh/audits ; https://skills.sh/docs ; https://skills.sh/docs/cli ; https://skills.sh/docs/api ; https://skills.sh/api/v1/skills/audit/... (probed 2026-09-17)
- https://raw.githubusercontent.com/vercel-labs/skills/main/README.md ; https://github.com/vercel-labs/skills ; https://raw.githubusercontent.com/vercel-labs/skills/main/src/skill-lock.ts ; .../src/agents.ts ; .../src/installer.ts ; https://registry.npmjs.org/skills/latest ; https://registry.npmjs.org/skills ; local `npx skills --help` (1.5.23) and `~/.agents/.skill-lock.json`
- https://vercel.com/changelog/skill-packs-are-now-available ; https://vercel.com/changelog/automated-security-audits-now-available-for-skills-sh ; https://snyk.io/blog/snyk-vercel-securing-agent-skill-ecosystem/ ; https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/ ; https://raw.githubusercontent.com/snyk/agent-scan/main/README.md
- https://learn.chatgpt.com/docs/build-skills (redirect target of developers.openai.com/codex/skills) ; https://learn.chatgpt.com/docs/changelog?type=codex-cli ; https://raw.githubusercontent.com/openai/skills/main/README.md ; local `~/.codex/skills/.system/{skill-installer,skill-creator}/SKILL.md` ; https://github.com/openai/skills ; https://github.com/openai/plugins ; https://raw.githubusercontent.com/openai/plugins/main/README.md ; https://github.com/openai/codex/pull/17720 ; https://github.com/higgsfield-ai/cli/issues/80 ; https://codex.danielvaughan.com/2026/05/31/codex-cli-vercel-skills-cli-npx-skills-open-agent-skills-ecosystem/ ; local `codex --help`, `codex plugin add --help`, `codex plugin marketplace --help`, `codex plugin list`
- https://code.claude.com/docs/en/skills ; local `claude plugin --help`, `claude plugin install --help`
- https://raw.githubusercontent.com/mattpocock/skills/main/README.md ; https://raw.githubusercontent.com/obra/superpowers/main/README.md ; https://raw.githubusercontent.com/JuliusBrussee/caveman/main/README.md ; https://raw.githubusercontent.com/vercel-labs/agent-skills/main/README.md
- ~~https://www.koi.ai/blog/clawhavoc-...~~ (now 301-redirects to a Palo Alto Networks product page, 2026-09-17; numbers re-confirmed from The Hacker News 2026-02-02) ; https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html ; https://www.esecurityplanet.com/threats/hundreds-of-malicious-skills-found-in-openclaws-clawhub/ ; https://www.trendmicro.com/en_us/research/26/b/openclaw-skills-used-to-distribute-atomic-macos-stealer.html ; https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/ ; https://labs.snyk.io/experiments/skill-scan/ ; https://github.com/alonw0/secure-skills ; https://www.marktechpost.com/2026/09/11/anthropic-adds-plugin-evals-to-claude-code-6-grader-types-a-no-plugin-baseline-and-a-ci-gate-for-skills/
- GitHub API `https://api.github.com/repos/<owner>/<repo>` (2026-09-17) for stars/pushed_at; npm registry for skills, skills-ref, @caveman-ai/cli, agent-browser, impeccable, ui-ux-pro-max-cli
- Repo/skills.sh pages: vercel-labs/agent-skills, mattpocock/skills, obra/superpowers, JuliusBrussee/caveman, antfu/skills, kepano/obsidian-skills, pbakaus/impeccable, nextlevelbuilder/ui-ux-pro-max-skill, microsoft/azure-skills, vercel-labs/agent-browser, cloudflare/skills, huggingface/skills, expo/skills, browser-use/browser-use, remotion-dev/skills, supabase/agent-skills, neondatabase/agent-skills, prisma/skills, stripe/ai, coreyhaines31/marketingskills, emilkowalski/skills, leonxlnx/taste-skill, shadcn-ui/ui, google/agents-cli, othmanadi/planning-with-files, microsoft/playwright-cli, fredrikaverpil/dotfiles, bastos/skills/proxmox-admin, basher83/lunar-claude, poindexter12/waypoint, bldg-7/proxmox-mcp, bagelhole/devops-security-agent-skills, akin-ozer/cc-devops-skills, iuliandita/skills, full-stack-skills/devops-skills, full-stack-skills/docker-skills, netresearch/docker-development-skill, home-assistant/core, davila7/claude-code-templates, hmohamed01/powershell-expert, zebbern/claude-code-guide, crazymarky/pentest-skills, timsonner/autonomous-pentest-agent, pleaseprompto/notebooklm-skill, jacob-bd/notebooklm-cli, VoltAgent/awesome-agent-skills, sdi2200262/elements-of-style-for-agents (README)

---

## Verification (skeptical fact-check, 2026-09-17)

Method: every repo re-fetched (GitHub HTML `stargazerCount` because the API was rate-limited from this IP and the `gh` token is stale), every npm/PyPI package re-read from the registry JSON, every install command re-read from the raw README / marketplace.json / CLI `--help`, the skills CLI source (`src/installer.ts`, `src/agents.ts`, `src/source-parser.ts`, `src/skills.ts`, `src/skill-lock.ts`), the Codex source (`codex-rs/ext/skills/src/host_roots.rs`, `codex-rs/skills/src/parser.rs`), the Codex docs (learn.chatgpt.com/docs/build-skills), the Claude docs (code.claude.com/docs/en/skills), the skills.sh audit API (9 skills probed), the skills.sh leaderboard and 45 per-skill pages. Nothing was installed or changed.

### Corrections made to the body
1. **`owner/repo/<skill>` shorthand was wrong** for every repo that keeps skills under `skills/` (anthropics, obra, akin-ozer, iuliandita, google, browser-use, full-stack-skills, pbakaus). `src/source-parser.ts` treats the third segment as a *subpath* (`owner/repo/path/to/skill`) and `discoverSkills()` searches only under that path; `anthropics/skills/frontend-design` resolves to `<repo>/frontend-design`, which does not exist. Rewritten to `npx skills add <owner/repo> --skill <name>` (the form skills.sh prints is `npx skills add https://github.com/<owner>/<repo> --skill <name>`; `owner/repo@skill` also works). bastos/skills keeps skills at repo root, so its URL form was already right.
2. **Codex frontmatter "rejection" was overstated.** The "Allowed properties are: allowed-tools, description, license, metadata, name" message is from the bundled lint script `skill-creator/scripts/quick_validate.py`; the runtime parser (`codex-rs/skills/src/parser.rs`) ignores unknown keys. Open question 2 resolved: extra keys are ignored at load time, only flagged by the lint. (`compatibility`, a spec key, is also missing from the lint's allow-list.)
3. **Codex still loads `~/.codex/skills`** as a deprecated back-compat root in addition to `~/.agents/skills` (`host_roots.rs`, comment "Deprecated user skills location (`$CODEX_HOME/skills`), kept for backward compatibility"). Open question 1 resolved; no defensive symlink needed, and nothing in `~/.codex/skills` will be missed.
4. **skills CLI README's Supported Agents table lists Codex global path as `~/.codex/skills/`**, which looks like it contradicts the report. It does not: `isUniversalAgent()` is true for any agent whose `skillsDir === '.agents/skills'` (Codex qualifies), and `installSkill()` returns after copying to `~/.agents/skills` for global installs of universal agents, so `globalSkillsDir` is never used. Confirmed locally (`~/.codex/skills` = only `.system`, 24 skills + lock v3 in `~/.agents`). Nuance added to §4.
5. **Leaderboard rank numbers** were off (rows are contiguous; nothing was lazy-loaded). Corrected: 3 frontend-design, 4 agent-browser, 5 setup-matt-pocock-skills, 6 vercel-react-best-practices, 7 grilling, 8 lark-doc. Counts unchanged (all re-matched exactly on 2026-09-17; index now 1,416,790).
6. **agent-browser**: npm `engines.node >=24.0.0` (host has 22.22.1 → EBADENGINE warning; README says Node 24/pnpm 11 only for source builds). Update command is `agent-browser upgrade`, not `npm install -g agent-browser@latest`.
7. **caveman Claude route**: README's non-interactive line is `claude plugin marketplace add JuliusBrussee/caveman && claude plugin install caveman@caveman`.
8. **Document-skill dependencies** corrected from the SKILL.md files: docx uses the Node `docx` package + pandoc + LibreOffice (not python-docx); pptx python-pptx + pptxgenjs + LibreOffice; xlsx openpyxl + LibreOffice; pdf pypdf/pdfplumber/pytesseract.
9. **pleaseprompto/notebooklm-skill is archived**; **jacob-bd/notebooklm-cli is archived and its README says it was merged into jacob-bd/notebooklm-mcp-cli** → both downgraded to skip/deprecated.
10. **Koi.ai ClawHavoc URL is dead** (301 to a Palo Alto Networks product page). Numbers (2,857 audited / 341 malicious / 335 AMOS / Koi Security) re-confirmed from The Hacker News, 2026-02-02.
11. **Vercel audit changelog (2026-02-17)** names only Gen, Socket, Snyk; Runlayer and ZeroLeaks appear only in the live API. The "Fail escalates to High and prompts" sentence is not on that page → confidence downgraded to medium for that part; the "as of skills@1.4.0 ... before installation" quote is verbatim.
12. **home-assistant/core**: the 460-install skill is literally named "Home Assistant Integration knowledge" (spaces; not spec-compliant, must be quoted): `npx skills add https://github.com/home-assistant/core --skill 'Home Assistant Integration knowledge'`. The `ha-integration-knowledge` skill has 72.
13. **zebbern pentest-checklist**: skills.sh shows 136 on the repo listing but 58 on the skill page (site inconsistency); recorded as such.

### Facts added while checking
- Official Claude marketplace (`anthropics/claude-plugins-official`, 305 plugins on 2026-09-17) contains `cloudflare`, `expo`, `stripe`, `supabase`, `huggingface-skills`, `azure`, `mattpocock-skills`, `superpowers`, `frontend-design`, `skill-creator` → for Claude prefer `claude plugin install <name>@claude-plugins-official` over duplicate `npx skills add` for those vendors.
- Codex marketplace naming: `codex plugin marketplace list` shows `openai-curated` (root `~/.codex/.tmp/plugins`); `codex plugin list` labels entries `@openai-curated-remote` ("Remote catalog"); vendor READMEs (expo, stripe) write `codex plugin add expo@openai-curated` / `codex plugin add stripe@openai-curated`. cloudflare's README uses its own marketplace: `codex plugin marketplace add cloudflare/skills && codex plugin add cloudflare@cloudflare`.
- kepano/obsidian-skills README: Claude `/plugin marketplace add kepano/obsidian-skills` + `/plugin install obsidian@obsidian-skills`; skills CLI `npx skills add https://github.com/kepano/obsidian-skills`.
- planning-with-files (default branch `master`): `/plugin marketplace add OthmanAdi/planning-with-files` + `/plugin install planning-with-files@planning-with-files`; `npx skills add OthmanAdi/planning-with-files --skill planning-with-files -g`; README notes `npx skills add` lands in `~/.agents/skills/`.
- impeccable README preferred path: `npx impeccable install` (`--providers=claude,codex,... --scope=project|global`), `npx impeccable update`; Claude: `/plugin marketplace add pbakaus/impeccable`; npm `impeccable` 4.1.0 engines node >=22.18.0.
- ui-ux-pro-max-cli 2.15.0: bin is `uipro` (`npm install -g ui-ux-pro-max-cli && uipro init --ai claude|codex`); `npx ui-ux-pro-max-cli init --ai claude` is also in the README.
- antfu README uses `pnpx skills add antfu/skills --skill='*' -g`; supabase `npx skills add supabase/agent-skills --skill supabase-postgres-best-practices`; prisma `npx skills add prisma/skills --skill prisma-cli`; coreyhaines31 `npx skills add coreyhaines31/marketingskills --skill cro copywriting`; just-scrape `npx skills add https://github.com/ScrapeGraphAI/just-scrape --skill just-scrape`; stripe skills route `npx skills add https://docs.stripe.com` (well-known) and Codex `codex plugin add stripe@openai-curated`; expo `npx skills@latest add expo/skills --skill '*'` / `/plugin install expo@claude-plugins-official` / `codex plugin add expo@openai-curated`; microsoft/playwright-cli CLI `npm install -g @playwright/cli@latest`.
- snyk-agent-scan: PyPI latest 0.6.3; README: "We don't publish an npm package for Agent Scan" (uvx or standalone binary only). GitHub 3,057 stars.
- `@caveman-ai/cli` 1.3.4 (engines node >=22.13, bins `caveman`/`cave`); npm `skills` 1.5.26 published 2026-09-11T23:01Z, dist-tag `snapshot` 1.5.23-snapshot.2; `skillsio` (alonw0/secure-skills) 1.1.3 on npm.
- Stars filled in for repos previously "unknown" (GitHub HTML, 2026-09-17): emilkowalski/skills 38,307; leonxlnx/taste-skill 87,681; shadcn-ui/ui 124,043; microsoft/playwright-cli 13,345; browser-use/browser-use 114,834; supabase/agent-skills 2,622; neondatabase/agent-skills 89; prisma/skills 57; stripe/ai 1,821; expo/skills 2,536; remotion-dev/skills 4,594; google/agents-cli 5,944; fredrikaverpil/dotfiles 261; pleaseprompto/notebooklm-skill 7,773 (archived); jacob-bd/notebooklm-cli 255 (archived); coreyhaines31/marketingskills 50,605; scrapegraphai/just-scrape 59; zebbern/claude-code-guide 4,624; crazymarky/pentest-skills 310; timsonner/autonomous-pentest-agent 1; full-stack-skills/devops-skills 1; full-stack-skills/docker-skills 3; netresearch/docker-development-skill 22; davila7/claude-code-templates 30,761; hmohamed01/powershell-expert 47; sickn33/antigravity-awesome-skills 46,501; sdi2200262/elements-of-style-for-agents 19; VoltAgent/awesome-agent-skills 34,447; snyk/agent-scan 3,057. Previously reported counts re-confirmed within ±10 (anthropics 176,707; obra 287,604; mattpocock 263,584; caveman 106,036; vercel-labs/skills 31,801; agent-skills 31,253; agent-browser 42,704; planning-with-files 26,939; openai/skills 27,367; impeccable 68,520; ui-ux-pro-max 128,185; kepano 48,449; antfu 5,891; huggingface 11,061; cloudflare 2,840; azure 1,485; bagelhole 1,098; akin-ozer 311; lunar-claude 23; bastos 7; waypoint 7; bldg-7 6; iuliandita 6; agentskills 25,412).
- Frontmatter of the most popular skills (anthropics docx, superpowers brainstorming, caveman) uses only `name`/`description`(/`license`) — already Codex-lint-clean.

### Confirmed unchanged
Codex loading order + symlink sentence + `[[skills.config]]` + `agents/openai.yaml` sections (learn.chatgpt.com/docs/build-skills); Claude symlink sentence, 1,536-char truncation, `/skill-doctor` v2.1.252+, `skillOverrides` values, `disableSkillShellExecution`, no `.agents` mention (code.claude.com/docs/en/skills); skills README command set (no `check`/`sync`/`audit`; `experimental_install`/`experimental_sync` exist), `-g/-a/-s/-l/-y/--copy/--all`, CI example line, `DISABLE_TELEMETRY`/`DO_NOT_TRACK` text; lockfile v3 / XDG path / tree-SHA hash; junction on win32 with copy fallback; audit API auth behaviour (leaderboard/search/detail → `authentication_required`, audit → open) and all nine audit rows; anthropics marketplace.json plugin groups; mattpocock README (`claude plugins install mattpocock-skills`, `npx skills@latest add mattpocock/skills`, Codex plugin "on the roadmap"); superpowers README routes; caveman README routes; openai/skills deprecation banner; `$skill-installer` commands; `codex plugin add <PLUGIN[@MARKETPLACE]>` syntax; `codex plugin list` rows; vercel-labs/agent-skills skill list; Snyk ToxicSkills numbers (3,984 / 13.4% = 534 / 36.82% / top-100 0% / 91%); packs changelog (2026-08-07, unlisted, `npx skills add https://skills.sh/p/<pack-id>`, `npx skills update`); skills-ref 0.1.5.
