# Recommendation catalog: what to install (as of 2026-09-17)

All numbers carry the date they were observed. Sources: 20 verified research reports in `docs/research/reports/` (each has a `## Verification` section listing corrections). Popularity signals: GitHub stars (HTML page counts), npm weekly downloads (api.npmjs.org), Anthropic's official plugin catalog install counts (`plugin-details.json`, installs dated 2026-09-11), skills.sh install counts, PulseMCP traffic estimates. Ranking method and the full dated snapshot: `reports/gap-7.md` and `reports/gap-7-ranking.csv`.

## 1. Does an all-in-one installer already exist?

No. Nothing installs Claude Code and Codex CLI through the vendors' native installers on Linux and Windows, then provisions plugins, skills and MCP servers for both, with an interactive default-all picker, in-place update of everything, self-update and host profiles.

Closest candidates (all scored against R1 native installs, R2 plugins+skills+MCP for both, R3 Linux+Windows, R4 picker, R5 update-all, R6 self-update, R7 profiles):

| Candidate | What it is | Stars (2026-09-17) | Fails | Use as |
|---|---|---|---|---|
| phnx-labs/agi-cli (`agents`) | Multi-harness manager: `agents add claude`, `agents setup`, `agents fleet apply`, `agents upgrade` | 21 stars, 6,985 npm dl/wk | R1 (installs harnesses via npm into isolated homes), R3 (Windows via WSL only), claims ~/.agents | design reference only |
| pivoshenko/kasetto (`kst`) | Declarative kasetto.yaml + lock; skills/MCP/instructions for 23 agents; `kst sync --update`, `kst self update`; Windows installer | 201 stars | no agent install, no plugin marketplaces, no picker | pattern reference (manifest + lock + self-update) |
| vercel-labs/skills (`npx skills`) | Cross-agent skills installer with lockfile and audits, 79 agent targets | 31,818 stars, 4.6M npm dl/wk | skills only | reuse as the skills layer |
| davila7/claude-code-templates | Claude-only component catalog | 30.8k stars | Claude only, project-scoped, telemetry | no |
| github/spec-kit | project scaffolding for Claude/Codex | 137k stars | project scaffolding, not host provisioning | no |
| mcpm.sh | MCP manager with claude-code and codex-cli clients | stale (2.15.0, May 2026) | MCP only | no |
| narze/aiupdate | update-all loop for AI CLIs | 13 stars | tiny | pattern reference |
| Nix home-manager `programs.claude-code` / `programs.codex` | declarative | n/a | Nix only | print snippet on NixOS |

Vendor "setup" tooling: `claude import codex|gemini|cursor` (config import only), Codex TUI `/import` (imports Claude Code setup incl. plugins), `claude-code-setup` plugin (read-only recommender), `codex doctor --json`. None provisions a host.

Building blocks the new script should shell out to rather than reimplement: the two official installers, `claude plugin|mcp|update`, `codex plugin|mcp|update`, `npx skills add|update`, `caveman setup`, package managers for prerequisites.

## 2. Agents

| Agent | Popularity | Linux install | Windows install | Update | Verdict |
|---|---|---|---|---|---|
| Claude Code | 145.5k stars, 11.0M npm dl/wk; native latest 2.1.274, stable 2.1.267 | `curl -fsSL https://claude.ai/install.sh \| bash` (pin: `bash -s stable` / `bash -s 2.1.89`); signed apt/dnf/apk repos for root-managed hosts | `irm https://claude.ai/install.ps1 \| iex` (pin: `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable`); CMD: `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`; winget `Anthropic.ClaudeCode` lags (2.1.268) | `claude update`; `autoUpdatesChannel` stable/latest; `DISABLE_AUTOUPDATER=1` | must-have |
| Codex CLI | 124.7k stars, 17.1M npm dl/wk; 0.154.0 (2026-09-09) | `curl -fsSL https://chatgpt.com/codex/install.sh \| CODEX_NON_INTERACTIVE=1 sh` (musl static, no root check) | `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 \| iex"`; winget `OpenAI.Codex` lags (0.152.0) and `codex update` cannot detect it | `codex update` (auto-detects standalone/npm/brew) or rerun installer | must-have |
| OpenCode | 208k stars, 9.2M npm dl/month; MIT; reads AGENTS.md, ~/.agents/skills, ~/.claude/skills; `opencode upgrade` | official script | choco/scoop; docs recommend WSL | `opencode upgrade` | optional extra (strongest OSS alternative) |
| Pi coding agent | 106k stars, 9.3M npm dl/month; no MCP by design; no permission prompts | npm | documented | `pi update --all` | optional |
| GitHub Copilot CLI | 11.2k stars, 10.6M npm dl/month; needs Copilot subscription | curl/npm | winget; PowerShell 6+ | `copilot update` | optional (if subscribed) |
| Antigravity CLI (Google, `agy`) | successor of Gemini CLI for consumer accounts (Gemini CLI OAuth cutoff 2026-06-18) | script | native PowerShell/CMD | background self-update | optional |
| Crush (Charm) | 28k stars; first-class Windows | brew/go/script | PowerShell | none | optional |
| Gemini CLI | 107k stars but paid API key only since 2026-06-18 | npm | npm | npm | optional |
| Cursor CLI, Devin CLI, Factory Droid, Amp, Auggie, Warp, Grok Build, Kimi Code, Kiro, Goose, Cline, Qwen Code, Mistral Vibe, OpenHands, Hermes, DeepSeek Harness | see `reports/other-agents-optional.md` | | | | optional, off by default |
| Aider, Continue CLI, Jules CLI, Windsurf CLI | stale, read-only, or not a local agent | | | | skip |
| Kimi CLI (legacy), Roo Code | wound down / archived | | | | deprecated |

Ollama (181k stars) is worth an optional toggle: `ollama launch claude|codex|opencode|droid|copilot` wires local models into the agents.

## 3. Claude Code plugins

Official marketplace `anthropics/claude-plugins-official`: 305 to 308 plugins (auto-registered, auto-updated). Anthropic also runs `anthropics/claude-plugins-community` (2,282 SHA-pinned, safety-screened, but pins lag upstream) and `anthropics/skills` (`anthropic-agent-skills`). Always-on token cost is real count_tokens data from Anthropic's catalog unless marked estimated.

Key finding for the picker: the 20 plugins currently installed cost about 8.0k tokens per session before hook injections. Recommended default target is 6k, warn at 8k.

### Must-have

| Plugin | Installs (2026-09-11) / stars | Always-on tokens | Install (Claude) | Codex equivalent | Why |
|---|---|---|---|---|---|
| superpowers | 1,112,404 installs; 287.6k stars; 3.2M skills.sh | 693 + ~1.1k SessionStart hook | `claude plugin install superpowers@claude-plugins-official` | already installed 6.3.0 as `superpowers@openai-curated-remote`; git route `codex plugin add superpowers@<marketplace>` | Most-installed methodology bundle: brainstorm, plan, TDD, debug, review, worktrees |
| caveman | 106k stars; 3.3M skills.sh; v2.7.0 (2026-09-15) | 1,814 + ~2.0k SessionStart ruleset | `claude plugin marketplace add JuliusBrussee/caveman && claude plugin install caveman@caveman` | `npx skills add JuliusBrussee/caveman --skill '*' -a codex -g -y`; or `codex plugin marketplace add JuliusBrussee/caveman && codex plugin add caveman@caveman` (verified exit 0) | Token saver you already use; JetBrains measured 8.5% fewer output tokens, proxy 33% input; owns statusLine |
| security-guidance | 241,800 installs | 0 (hooks) | `claude plugin install security-guidance@claude-plugins-official` | n/a (review calls Claude API) | 5 hooks review every edit for common vulnerabilities at zero context cost |
| context7 | 417,801 installs; 62.1k stars; 1.13M npm dl/wk | 0 (deferred) | `claude plugin install context7@claude-plugins-official` | `codex mcp add context7 -- npx -y @upstash/context7-mcp --api-key KEY` or HTTP table with bearer header | Current library docs |
| commit-commands | 171,244 installs | 108 | `claude plugin install commit-commands@claude-plugins-official` | n/a | commit / commit-push-pr / clean_gone |
| LSP plugins for languages you use (typescript-lsp 212,522; pyright-lsp 109,778; gopls-lsp 41,639; rust-analyzer-lsp 35,933) | | 0 | `claude plugin install typescript-lsp@claude-plugins-official` etc. | n/a | Diagnostics after every edit. The plugin does NOT install the language server binary: the installer must add `typescript-language-server`, `pyright`, `gopls`, `rust-analyzer`. On native Windows typescript-lsp hits a .cmd-shim spawn bug (#59925); pyright works via pip |

### Recommended

| Plugin | Installs / stars | Tokens | Install | Codex | Why |
|---|---|---|---|---|---|
| frontend-design | 1,245,390 installs (#1 official) | 83 | `claude plugin install frontend-design@claude-plugins-official` | `npx skills add anthropics/skills --skill frontend-design -a codex -g -y` | Distinctive UI output |
| skill-creator | 385,083 | 117 | `claude plugin install skill-creator@claude-plugins-official` | Codex ships a system `$skill-creator` | Author and eval skills |
| feature-dev | 256,017 | 243 | `claude plugin install feature-dev@claude-plugins-official` | n/a | Explore/architect/review agents |
| claude-md-management | 287,247 | 180 | `claude plugin install claude-md-management@claude-plugins-official` | n/a | Overlaps `/doctor` trims partly |
| github (remote MCP) | 344,375 installs; 33k stars | 0 (deferred) | `claude plugin install github@claude-plugins-official` with `GITHUB_PERSONAL_ACCESS_TOKEN` | `codex mcp add github --url https://api.githubcopilot.com/mcp/readonly --bearer-token-env-var GITHUB_PAT_TOKEN` | Promoted by ranking (#8 official); prefer `/readonly`, `gh` handles writes |
| chrome-devtools-mcp | 117,775 installs; 52k stars; 1.5M npm dl/wk | 809 (58 tools; use `--slim`) | `claude plugin install chrome-devtools-mcp@claude-plugins-official` | `codex mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest` | Perf/network/heap debugging; pick one browser server per host |
| playwright | 319,887 installs; 37k stars; 4.6M npm dl/wk | 0 on Claude (deferred), ~27 tools on Codex | `claude plugin install playwright@claude-plugins-official` | `codex mcp add playwright npx "@playwright/mcp@latest"`; better: `npm i -g @playwright/cli@latest && playwright-cli install --skills` (no schema cost) | Only reliable browser automation for Codex CLI |
| hookify | 60,376 | 297 | `claude plugin install hookify@claude-plugins-official` | n/a | Hooks from natural language |
| mattpocock skills (cherry-pick grill-me, handoff, tdd, to-spec) | 264k stars; 23M skills.sh; plugin 45,070 installs | 1,614 as full plugin; ~320 for 4 skills | `npx skills add mattpocock/skills --skill grill-me --skill handoff --skill tdd --skill to-spec -a claude-code -a codex -g -y` | same command | Never install all 54 globally |
| document-skills (docx/pdf/pptx/xlsx) | 169k to 222k installs each | ~1,100 est. | `claude plugin marketplace add anthropics/skills && claude plugin install document-skills@anthropic-agent-skills` | `npx skills add anthropics/skills --skill docx --skill pdf --skill pptx --skill xlsx -a codex -g -y` | Office docs; heavy deps (LibreOffice, pandoc, python libs) |
| ccusage | 18.6k stars; 20.0.21 | 0 | `npx ccusage@latest` (statusline: `bun x ccusage statusline`) | `ccusage codex daily` | Cost reports |
| claude-hud | 28.1k stars | 0 | `claude plugin marketplace add jarrodwatts/claude-hud && claude plugin install claude-hud@claude-hud` | n/a | Richest statusline; conflicts with caveman statusLine (one owner) |

### Optional (off by default in ALL)

code-review plugin (438k installs but built-in `/code-review` and `/ultrareview` cover it; you have it installed twice, user and project scope), code-simplifier (built-in `/simplify`), ralph-loop (built-in `/goal` and `/loop`), claude-code-setup, plugin-dev (2,354 tokens, only when authoring plugins), pr-review-toolkit (2,038 tokens), remember (78 tokens, cheapest memory plugin, Codex manifest exists), episodic-memory (search past Claude and Codex sessions), compound-engineering (25k stars, ~3k tokens est., overlaps superpowers, native Codex plugin), gstack (133k stars, heavy, Bun), planning-with-files (27k stars, per-turn re-injection), context-mode (23k stars, overlaps caveman proxy), claude-mem (94k stars, installer defaults to hosted paid provider, no Codex), serena (29k stars, needs uv; more useful on Codex which lacks LSP), elements-of-style, superpowers-chrome, ui-ux-pro-max (128k stars), beads issue tracker, wshobson/agents domain plugins, last30days, claude-security, session-report, obsidian-skills, cloudflare/expo/stripe/supabase/huggingface vendor plugins.

### Skip or deprecated

BMAD, everything-claude-code (260k stars but 68 agents/292 skills), ruflo/claude-flow, oh-my-claudecode, claude-code-plugins-plus, superpowers-dev (must never co-install with superpowers), demo marketplace in anthropics/claude-code, explanatory/learning output styles, get-shit-done (archived), claude-task-master (stale), claude-code-spec-workflow (stale).

## 4. Skills (Agent Skills standard, work in both agents)

Install layer: `npx skills add <owner/repo> --skill <name> -a claude-code -a codex -g -y`. One canonical copy lands in `~/.agents/skills` (Codex reads it natively), Claude gets a symlink in `~/.claude/skills` (junction on Windows, copy fallback with `--copy`). Lock file `~/.agents/.skill-lock.json` v3; `npx skills update -g -y` updates everything. Pre-install gate: `GET https://skills.sh/api/v1/skills/audit/{owner}/{repo}/{skill}` (unauthenticated; Gen, Socket, Snyk, Runlayer, ZeroLeaks). Local scanner: `uvx snyk-agent-scan@latest ~/.agents/skills`.

| Skill / pack | Installs / stars (2026-09-17) | Verdict | Notes |
|---|---|---|---|
| find-skills (vercel-labs/skills) | 3.4M (#1) | must-have | already installed |
| superpowers skills | via plugin | must-have | do not double-install via skills CLI when plugin present |
| caveman skills (23) | 3.3M | must-have | via plugin or skills CLI, not both; consider `skillOverrides` for unused caveman-* |
| frontend-design, skill-creator, mcp-builder, webapp-testing (anthropics/skills) | 893k / 383k / 115k / 158k | must-have / recommended | |
| document-skills docx/pdf/pptx/xlsx | 169k to 222k | recommended | heavy deps |
| mattpocock: grill-me, handoff, tdd, to-spec | grill-me 1.2M | recommended | cherry-pick; skip `triage` (Gen+Snyk MEDIUM); name collision: mattpocock ships a `caveman` skill |
| vercel-labs/agent-skills (react-best-practices 719k, web-design-guidelines 640k, composition-patterns 340k) | 31k stars | recommended for web work | `frontend-design` no longer exists there, use `web-design-guidelines` |
| agent-browser | 868k; 42.7k stars | recommended | needs Node 24 and a binary; Runlayer HIGH advisory |
| kepano/obsidian-skills | 372k; 48k stars | recommended if you use Obsidian | all audits pass |
| proxmox-admin (bastos/skills) | 706; 7 stars | recommended for Proxmox hosts | tiny repo, pin hash; clean audits |
| cc-devops-skills (ansible/docker/k8s/terraform/bash generators+validators) | 17.6k total | recommended for infra | review scripts first (Runlayer HIGH: runs linters) |
| Playwright CLI skills (`playwright-cli install --skills`) | 675k npm dl/wk | recommended for Codex | zero MCP schema cost |
| devops-security-agent-skills (linux-administration, hardening, ssh) | 1.1k stars | optional | cherry-pick |
| lunar-claude (proxmox-infrastructure, ansible-proxmox) | 23 stars | optional | |
| iuliandita/skills (debian-ubuntu, networking, virtualization) | 6 stars | optional | |
| powershell-windows (from claude-code-templates), powershell-expert | 456 / 78 | optional for Windows hosts | |
| ui-ux-pro-max, impeccable, design-taste-frontend, emilkowalski/skills | 128k / 68k / 88k / 38k stars | optional design | |
| cloudflare, expo, stripe, supabase, prisma, neon, remotion, shadcn, huggingface, antfu | vendor packs | optional, per stack | |
| marketingskills, last30days, just-scrape | | optional | |
| pentest packs (zebbern, crazymarky) | | optional, project scope only, never global on work hosts | |
| azure-skills (44), google/agents-cli, mega-collections (antigravity-awesome-skills 1,803 skills, claude-code-templates 863) | | skip globally | inflate leaderboard; cherry-pick single skills only |
| notebooklm-skill, nlm-cli-skill, openai/skills catalog | archived / deprecated | deprecated | |

## 5. MCP servers

Mechanics: Claude Code defers all MCP tool schemas (tool search on by default) so remote servers cost ~0 context; Codex has no tool search, so every Codex MCP server costs its full schema each turn (cap at about 5). Prefer remote HTTP servers; on native Windows write stdio servers as `cmd /c npx ...` (via `claude mcp add-json` or TOML) with a `node <path>/cli.js` fallback.

Claude user scope: `claude mcp add --scope user --transport http <name> <url> [--header "Authorization: Bearer ..."]`; stdio: `claude mcp add --scope user <name> -e K=V -- npx -y <pkg>`. Same-name add fails (exit 1): upsert is `claude mcp remove -s user <name> || true` then add. Codex: `codex mcp add <name> --url <url> --bearer-token-env-var VAR` or `codex mcp add <name> --env K=V -- <cmd>`; `codex mcp add` silently overwrites the whole table; `--url` without a bearer var may start an OAuth browser flow.

### Developer set

| Server | Popularity | Claude | Codex | Verdict |
|---|---|---|---|---|
| Context7 | 62k stars; 1.13M npm dl/wk | official plugin (HTTP, deferred) | `codex mcp add context7 -- npx -y @upstash/context7-mcp --api-key KEY` | must-have both |
| Playwright MCP | 37k stars; 4.6M npm dl/wk; PulseMCP #1 | official plugin | `codex mcp add playwright npx "@playwright/mcp@latest"` or Playwright CLI skills | must-have Codex, recommended Claude |
| GitHub (remote) | 33k stars; 344k plugin installs | official plugin (`GITHUB_PERSONAL_ACCESS_TOKEN`) | `codex mcp add github --url https://api.githubcopilot.com/mcp/readonly --bearer-token-env-var GITHUB_PAT_TOKEN` | recommended |
| chrome-devtools-mcp | 52k stars; 1.5M npm dl/wk | official plugin | `codex mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest` | recommended (one browser server per host) |
| Exa (remote, keyless) | 5k stars | `claude plugin install exa@claude-plugins-official` | `codex mcp add exa --url https://mcp.exa.ai/mcp` | recommended for Codex (Claude has WebSearch) |
| Serena | 29k stars | `uv tool install -p 3.13 serena-agent && serena setup claude-code` | `serena setup codex` | recommended Codex, optional Claude |
| Microsoft Learn (remote) | 1.9k stars | `claude plugin install microsoft-docs@claude-plugins-official` | `codex mcp add "microsoft-learn" --url "https://learn.microsoft.com/api/mcp"` | recommended if Windows/PowerShell/Azure work |
| Docker MCP Gateway | 1.6k stars | `docker mcp client connect claude-code --global` | `docker mcp client connect codex --global` | recommended when Docker present |
| Atlassian, Linear, Notion, Sentry, Slack, Figma, Vercel, Supabase, Cloudflare, AWS, Azure, GCP, Stripe, Firecrawl, Tavily, Perplexity, DBHub, MongoDB, GitLab | vendor remotes | plugin or `claude mcp add --transport http` | `codex mcp add --url` + `codex mcp login` | optional, project scope |
| filesystem, git, time, fetch, memory, sequential-thinking, desktop-commander, mcp-remote, Google Workspace MCP, Brave, PAL/Zen, Task Master, Semgrep MCP, archived reference servers | | | | skip (built-ins or claude.ai connectors cover them; some deprecated) |

### Homelab / infra set

| Server | Popularity | Claude | Codex | Verdict |
|---|---|---|---|---|
| Home Assistant native MCP | HA 91k stars; integration on 4.2% of installs | `claude mcp add-json "HA" '{"type":"http","url":"https://<ha>/api/mcp","oauth":{"clientId":"http://localhost:12345","callbackPort":12345}}' --client-secret` | TOML: `mcp_oauth_callback_port = 12345`, `[mcp_servers.homeassistant] url=... auth="oauth"` then `codex mcp login homeassistant` | recommended |
| Kubernetes (containers/kubernetes-mcp-server) | 2.1k stars | `claude mcp add k8s -- npx -y kubernetes-mcp-server@latest --read-only` | same | recommended if k8s |
| Grafana | 3.5k stars; 227k PyPI dl/wk | `claude plugin install grafana-mcp@claude-plugins-official` | `codex mcp add grafana --env GRAFANA_URL=... --env GRAFANA_SERVICE_ACCOUNT_TOKEN=... -- uvx mcp-grafana` | recommended if Grafana |
| Portainer (official) | 231 stars | `claude mcp add portainer -e PORTAINER_URL=... -e PORTAINER_API_KEY=... -- uvx --from "mcp-portainer~=2.45.0" mcp-portainer` | `--env` form | recommended if Portainer |
| TrueNAS (official Go binary) | 81 stars | release binary + `claude mcp add truenas -- truenas-mcp --truenas-url <ip> --api-key <key>` | same | recommended if TrueNAS |
| ProxmoxMCP-Plus | 538 stars; PyPI 0.5.18 (2026-09-16) | `claude mcp add proxmox -e PROXMOX_HOST=... -e PROXMOX_USER=root@pam -e PROXMOX_TOKEN_NAME=... -e PROXMOX_TOKEN_VALUE=... -- uvx proxmox-mcp-plus` | `--env` form | optional (only maintained Proxmox server; immature; use a limited API token) |
| n8n-mcp | 23k stars | `claude mcp add n8n-mcp -e MCP_MODE=stdio -e LOG_LEVEL=error -e DISABLE_CONSOLE_OUTPUT=true -- npx n8n-mcp` | TOML | optional |
| Tailscale (HexSleeves) | 132 stars | `claude mcp add tailscale -e TAILSCALE_API_KEY=... -e TAILSCALE_TAILNET=- -- npx -y @hexsleeves/tailscale-mcp-server` | `--env` form | optional (no official server) |
| NetBox, UniFi, OPNsense, pfSense, Netdata, Terraform, Ansible dev-tools | small | see reports | | optional |
| SSH MCPs, direct Docker MCPs, Proxmox long tail (<60 stars), canvrno/ProxmoxMCP (dead since 2025-02) | | | | skip |

## 6. Token-efficiency, memory, orchestration, notifications, cost

| Tool | Popularity | Install | Verdict | Notes |
|---|---|---|---|---|
| caveman (plugin + `@caveman-ai/cli`) | 106k stars; CLI 1.3.4 (node >=22.13) | `npm i -g @caveman-ai/cli && caveman setup --agent-native claude`; Codex: `caveman setup --agent-native codex` | must-have (plugin); agent-native Codex OFF by default | Codex agent-native rewrites `model_provider` to a caveman gateway and adds a shrink hook unless `think.shrink` is off; caveman docs: Codex hooks disabled on Windows |
| rtk (Rust Token Killer) | 80.8k stars; v0.49.0 | `curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh \| sh`; `winget install rtk-ai.rtk`; `rtk init -g`, `rtk init -g --codex` | optional, OFF in ALL | Same slot as caveman shrink-hook (one PreToolUse Bash rewriter); JetBrains: +7.6% cost at low effort |
| headroom | 72.5k stars | `uv tool install --python 3.13 "headroom-ai[all]"`; `headroom wrap claude` | optional, OFF | proxy slot |
| context-mode | 23k stars | `npm i -g context-mode` + marketplace | optional | overlaps caveman |
| Claude auto memory (built-in) | | on by default | must-have | `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` to disable |
| Codex memories | | `[features] memories = true` | recommended opt-in | off by default |
| remember / claude-mem / episodic-memory | 172 / 94k / 478 stars | see section 3 | optional, pick at most one | memory slot |
| ccusage | 18.6k stars | `npx ccusage@latest` | recommended | statusline option |
| claude-hud / ccstatusline / caveman statusline | 28k / 12.9k stars | see section 3 | one statusLine owner | default choice needed (question) |
| Happy (mobile remote) | 23.8k stars | `npm i -g happy`; `happy claude` / `happy codex` | recommended optional | |
| ccmanager, claude-squad | 1.2k / 8.5k stars | npm / brew | optional | built-in `claude --bg`, `claude agents`, Codex multi_agent cover most |
| vibe-kanban | 28k stars | | deprecated (Bloop shut down 2026-04-10) | |
| agent-notifications (777genius) | 812 stars | pinned setup.sh one-liner, `--product both` | recommended (Linux/macOS; Git Bash on Windows) | native toast runtime |
| claude-code-notify-powershell (soulee-dev) | 93 stars | PowerShell | recommended for native Windows | |
| spec-kit (`specify-cli`) | 137k stars | `uv tool install specify-cli` | optional | project scaffolding |

## 7. Prerequisite tools

| Tool | Linux | Windows (winget id, newest manifest 2026-09-17) | Why |
|---|---|---|---|
| git | distro pkg | `Git.Git` 2.55.0.3 (Git Bash optional for Claude since 2.1.120; needed by caveman plugin hooks and agent-notifications) | |
| Node.js LTS (>=22.20 for skills CLI; 24 for agent-browser) | fnm on desktops (`curl -fsSL https://fnm.vercel.app/install \| bash`), NodeSource on root servers | `OpenJS.NodeJS.LTS` 24.19.0 | npx MCP servers, skills CLI, caveman CLI, ccusage |
| uv | `curl -LsSf https://astral.sh/uv/install.sh \| sh` | `astral-sh.uv` 0.12.15 | serena, grafana, portainer, proxmox MCPs, snyk-agent-scan, headroom, spec-kit |
| jq | distro pkg (host has 1.8.1; latest 1.8.2) | `jqlang.jq` 1.8.2 | settings.json merges |
| yq (mikefarah) | binary | `MikeFarah.yq` 4.53.6 | TOML edits of config.toml (comment-preserving) |
| ripgrep | distro pkg | `BurntSushi.ripgrep.MSVC` 15.2.0 | Claude on Alpine; rtk |
| gum | Releases / apt repo.charm.sh | `charmbracelet.gum` 2.0.0 | only if the picker is gum-based |
| PowerShell 7 | n/a | `Microsoft.PowerShell` 7.6.6 (`--installer-type wix` for MSI on Server) | avoids PS 5.1 gotchas; optional |
| bubblewrap (+socat) | `apt install bubblewrap socat` | n/a | Codex sandbox (bundled bwrap exists), Claude bash sandbox |
| gh | distro / GitHub apt repo (host 2.46.0; upstream 2.101.0) | `GitHub.cli` | attestation verify needs >=2.49 |
| Language servers | `npm i -g typescript-language-server typescript`, `npm i -g pyright` or `pip install pyright`, `go install golang.org/x/tools/gopls@latest`, `rustup component add rust-analyzer` | same | for LSP plugins |

## 8. Conflicts and single-owner slots (from gap-8)

| Slot | Candidates | Recommended default |
|---|---|---|
| statusLine (one `statusLine` in settings.json) | caveman statusline (current), claude-hud, ccstatusline, ccusage | decision needed |
| PreToolUse Bash rewriter | caveman shrink-hook, rtk, headroom | at most one; default caveman shrink (already active) |
| API proxy / model_provider | caveman agent-native, headroom, pxpipe | none (a non-first-party base URL disables tool search and Remote Control) |
| Memory | Claude auto memory (built-in), remember, claude-mem, episodic-memory, cavemem | built-in only |
| Methodology bundle | superpowers, compound-engineering, BMAD, gstack, planning-with-files, ECC | superpowers |
| Browser automation | playwright, chrome-devtools, agent-browser, superpowers-chrome, claude --chrome | playwright (Claude may add --chrome) |
| Codex notify / hooks.json writer | caveman, TokenTracker, agent-notifications, context-mode | one owner |
| Codex MCP count | | cap 5 (no tool search on Codex) |

Forced OFF even in ALL: caveman agent-native codex, rtk and caveman shrink together, headroom/pxpipe, claude-mem (hosted provider pre-selected), all memory plugins, agent-browser (Node 24, Runlayer HIGH), plugin-dev, pr-review-toolkit, full mattpocock plugin, example-skills, compound-engineering/gstack/planning-with-files, more than 5 Codex MCP servers, any skill with a Gen/Snyk/Socket `fail` audit.

## 9. Your current inventory: keep / update / replace / remove

| Item | Installed | Latest (2026-09-17) | Action |
|---|---|---|---|
| Claude Code | 2.1.273 native (auto-updated to 2.1.274 during research) | latest 2.1.274, stable 2.1.267 | keep; `autoUpdates:false` in ~/.claude.json is a legacy key ignored by native installs (use `DISABLE_AUTOUPDATER=1` or `autoUpdatesChannel`) |
| Codex CLI | 0.154.0 standalone | 0.154.0 | keep |
| caveman plugin | 2.6.0 (15581d1) | 2.7.0 | update (third-party marketplace: no auto-update) |
| @caveman-ai/cli | 1.3.3, root-owned via sudo npm | 1.3.4 (honours CLAUDE_CONFIG_DIR/CODEX_HOME) | update; fix npm prefix ownership |
| superpowers | 6.3.0 | 6.3.0 | keep |
| security-guidance | 2.0.8 | 2.0.8 | keep |
| remember | 0.32.0 | 0.33.0 | optional: update or remove (built-in auto memory covers it) |
| typescript-lsp, pyright-lsp, gopls-lsp | installed, but no language server binaries present | | install binaries or remove (currently dead weight) |
| code-review plugin | installed twice (user + project scope) | | dedupe; optional vs built-in `/code-review` |
| code-simplifier, ralph-loop, claude-code-setup | | | optional; redundant with built-ins `/simplify`, `/goal`, `/loop`, `/init` |
| plugin-dev, pr-review-toolkit | 2,354 + 2,038 tokens always-on | | disable globally, enable per project |
| context7, playwright, frontend-design, skill-creator, feature-dev, claude-md-management, commit-commands | current | | keep |
| skills CLI | 1.5.23 | 1.6.0 (node >=22.20) | update |
| ~/.agents/skills (24) | caveman family, find-skills, personal job-search skills | | keep; personal ones stay out of the manifest |
| Codex MCP servers | none | | gap: add context7, playwright (or Playwright CLI skills) |
| Codex plugins | superpowers 6.3.0, openai-templates, sites, plugin-management (remote) | | keep |
| node / npm | 22.22.1 / 9.2.0 (distro packages) | Node 24 LTS; npm 12 blocks install scripts by default | consider fnm + Node 24 |
| gh | 2.46.0 | 2.101.0 | update (attestation verify needs 2.49+); keyring token currently invalid |
| jq | 1.8.1 | 1.8.2 | update |
| uv, gum, pwsh | missing | | install uv (needed by serena/grafana/proxmox MCPs) |
| statusLine | `bash "$(ls -td ~/.claude/plugins/cache/caveman/caveman/*/ \| head -1)src/hooks/caveman-statusline.sh"` | | fragile glob; installer should copy the script to ~/.claude/hooks/ |
| hooks | caveman-proxy native-hook on 10 events + shrink-hook | 1.3.4 emits the same 10 (12 for Codex) | regenerate per host with `caveman setup --agent-native claude` |

## 10. Codex parity map (from gap-1)

Codex 0.154.0 reads `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json`, so `codex plugin marketplace add anthropics/claude-plugins-official` exposes all 308 official plugins to Codex. Verified installs (exit 0): caveman, context7, playwright, commit-commands, security-guidance, frontend-design, hookify, typescript-lsp, feature-dev, claude-md-management, skill-creator, mattpocock-skills, serena, github, remember. Plugin `.mcp.json` servers appear in `codex mcp list`. Unverified: whether Claude-format hooks (`${CLAUDE_PLUGIN_ROOT}`) and `agents/*.md` actually run inside Codex sessions. Codex also has a built-in `/import` (TUI) that imports Claude Code config, skills, plugins, MCP servers and hooks.

| Claude item | Codex route |
|---|---|
| superpowers | already installed (`superpowers@openai-curated-remote`, needs ChatGPT login) or git marketplace |
| caveman | `npx skills add JuliusBrussee/caveman --skill '*' -a codex -g -y` (skills) + optional `caveman setup --agent-native codex` (proxy; OFF by default) |
| context7 | `codex mcp add context7 -- npx -y @upstash/context7-mcp --api-key KEY` |
| playwright | `codex mcp add playwright npx "@playwright/mcp@latest"` or Playwright CLI skills |
| frontend-design, skill-creator, document skills, mcp-builder | `npx skills add anthropics/skills --skill <name> -a codex -g -y` |
| mattpocock skills | skills CLI |
| security-guidance | no equivalent (calls Claude API) |
| LSP plugins | no equivalent; Serena fills the gap on Codex |
| remember | `codex plugin marketplace add Digital-Process-Tools/claude-remember && codex plugin add remember@remember-dev` |
| compound-engineering, context-mode, BMAD, elements-of-style | native `codex plugin marketplace add <repo>` manifests |
| claude.ai connectors (Gmail, Drive, Calendar) | OpenAI-curated Gmail/Google Drive/Slack/Notion/Figma plugins via `/plugins` (ChatGPT login) |
| memory | `[features] memories = true` |
| Codex plugin update | no `codex plugin update`: `codex plugin marketplace upgrade` then `codex plugin add` again (re-copies from snapshot) |
