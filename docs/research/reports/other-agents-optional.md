# Other AI coding CLIs as OPTIONAL extras (research, 2026-09-16)

Scope: agents the "ultimate installer" could offer beside Claude Code and Codex CLI. All install commands below were copied from fetched primary sources (official docs, repo READMEs, npm registry). Star counts were scraped from github.com repo pages on 2026-09-16/17 (GitHub REST API was rate-limited for this fan-out). npm "downloads/month" = api.npmjs.org last-month window 2026-08-13..2026-09-11.

## 0. Headline findings

1. **The Agent Skills standard (`SKILL.md`, agentskills.io) has won.** Nearly every serious CLI now reads `.agents/skills/` (project) and `~/.agents/skills/` (global), and many additionally read `.claude/skills/` + `~/.claude/skills/` for Claude Code compatibility. Because the user's skills already live in `~/.agents/skills/` (skills CLI lock v3), the installer should treat `~/.agents/skills/` as the single canonical skills root and only symlink/copy for the few agents that do not read it (Qwen Code -> `~/.qwen/skills/`, Kiro -> `~/.kiro/skills/`, Cline -> `~/.cline/skills/`, Antigravity CLI -> `~/.gemini/antigravity-cli/skills/`, OpenHands -> `~/.openhands/skills/`).
2. **AGENTS.md is read natively** by Copilot CLI, OpenCode, Amp, Cursor, Kimi Code, Droid, Kiro (since 2.18.0), Crush, Goose, Cline, Vibe, Grok Build, Auggie, Warp, Antigravity CLI, Devin, Pi, OpenHands, Hermes. Gemini CLI and Qwen Code need `context.fileName` set (`["GEMINI.md","AGENTS.md"]` / `["QWEN.md","AGENTS.md"]`). Aider has no AGENTS.md support (uses `--read CONVENTIONS.md`).
3. **MCP config is NOT standardized**: every agent has its own file (table in section 3). Most use a JSON object keyed `mcpServers` (Copilot, Cursor, Gemini, Qwen, Kiro, Droid, Kimi Code, Augment, Warp, Antigravity, Devin, OpenHands, Cline), so one generator can emit the same `{"mcpServers": {...}}` block into N files. Exceptions: OpenCode (`"mcp"` key, `type: local|remote`, `command` as array), Amp (`"amp.mcpServers"`), Goose (YAML `extensions:`), Crush (`crushrc` DSL `mcp add ...`), Grok Build / Vibe / Kimi CLI (TOML `[mcp_servers.<name>]`), Hermes (`config.yaml` `mcp_servers:`). Pi has **no MCP** by design.
4. **Landscape changes since 2025 that matter for an installer**:
   - Google retired **Gemini CLI for free/Pro/Ultra (OAuth) users on 2026-06-18**; it still works with paid Gemini API keys / Code Assist Standard+Enterprise, and the repo still ships weekly (0.60.0 on 2026-09-15). The successor is **Antigravity CLI (`agy`)**, a single Go binary.
   - **Kimi CLI (Python) is being wound down in favour of Kimi Code CLI** (`kimi`, single binary, MIT).
   - **Amp's npm package moved from `@sourcegraph/amp` to `@ampcode/cli`**; the news post says the old names 'will be removed on June 15, 2026', but as of 2026-09-17 `@sourcegraph/amp` is still being published in lock-step (same version 0.0.1789607146-g57354f on both names, 103.9k vs 102.7k downloads/month) — treat `@sourcegraph/amp` as deprecated but not yet removed.
   - **Roo Code extension was shut down 2026-05-15**; **Continue** did a "final 2.0.0 release"; **Jules Tools** npm has not been published since 2025-12-16; **Aider**'s last release is 0.86.2 (2026-02-12), last commit 2026-05-22.
   - **Warp's `oz` binary is deprecated**; the agent CLI is now the `warp` binary (curl script self-updates).
   - Newcomers with huge traction: **DeepSeek Harness (`dsh`)** (repo created 2026-08-13, 226.6k stars, dev preview, web-UI first), **Hermes Agent** (Nous, 246.2k stars, general self-improving agent, native Windows), **Pi coding agent** (badlogic/pi-mono, 106.3k stars, 9.3M npm downloads/month, no MCP/no permission popups by design), **Grok Build** (xai-org/grok-build, 26.8k stars, Rust, ports of codex & opencode code inside).
5. **skills CLI (`npx skills`, vercel-labs/skills, 31.8k stars, 34.0M npm downloads/month, v1.6.0 on npm 2026-09-17 (1.5.26 was current on 2026-09-16); local install is 1.5.23)** supports **79 agent targets** (README: 'OpenCode, Claude Code, Codex, Cursor, and 75 more'; 79 `--agent` keys counted in the table on 2026-09-17). Exact `-a` names relevant here: `claude-code`, `codex`, `gemini-cli`, `github-copilot`, `cursor`, `opencode`, `amp`, `kimi-code-cli`, `qwen-code`, `droid`, `kiro-cli`, `crush`, `aider-desk` (AiderDesk GUI, NOT aider), `goose`, `cline`, `mistral-vibe`, `grok`, `augment`, `warp`, `antigravity`, `antigravity-cli`, `devin`, `windsurf`, `pi`, `openhands`, `kilo`, `roo`, `hermes-agent`, `continue`, `codebuddy`, `iflow-cli`, `junie`, `rovodev`, `zed`, `universal` (= `.agents/skills/` / `~/.config/agents/skills/`). No target exists for plain `aider`, `ollama`, `jules`, `deepseek-harness`/`dsh`, or `openclaw`... wait, `openclaw` exists (`skills/` and `~/.openclaw/skills/`). Full table in section 4.

## 1. Per-agent detail

Legend: Stars = github.com scrape 2026-09-16/17. "AGENTS.md" = reads it natively. "Skills std" = reads Agent Skills `SKILL.md` and from which dirs. "MCP" = config path.

### 1.1 Gemini CLI (google-gemini/gemini-cli) — verdict: optional (only if you have a paid Gemini API key)
- Stars 107,020. License Apache-2.0. npm `@google/gemini-cli` 0.60.0 (2026-09-15), 1.41M downloads/month. Weekly stable Tuesdays; `@preview`, `@nightly` tags.
- Install (docs/get-started/installation.mdx): `npm install -g @google/gemini-cli` ; `brew install gemini-cli` ; `sudo port install gemini-cli` ; run-once `npx @google/gemini-cli`. Windows 11 24H2+ supported, PowerShell OK (same npm command). Update: `npm install -g @google/gemini-cli@latest`.
- **Status**: Google Developers Blog "An important update: Transitioning Gemini CLI to Antigravity CLI": on 2026-06-18 Gemini CLI stopped serving Google AI Pro/Ultra and free users; it "will remain accessible via paid Gemini and Gemini Enterprise Agent Platform API keys" and Code Assist Standard/Enterprise. The OSS repo keeps releasing.
- AGENTS.md: not by default (GEMINI.md). Set `context.fileName` (string|string[]) in `~/.gemini/settings.json`, e.g. `"context": {"fileName": ["GEMINI.md","AGENTS.md"]}`.
- Skills std: yes (docs/cli/skills.md cites agentskills.io). User: `~/.gemini/skills/` or `~/.agents/skills/`; workspace: `.gemini/skills/` or `.agents/skills/` (`.agents` alias takes precedence).
- MCP: `mcpServers` in `~/.gemini/settings.json` (user) or `.gemini/settings.json` (workspace); `gemini mcp add` exists.
- skills CLI target: `gemini-cli` (project `.agents/skills/`, global `~/.gemini/skills/`).

### 1.2 Antigravity CLI (google-antigravity/antigravity-cli, binary `agy`) — verdict: recommended (Google's current terminal agent)
- Stars 2,306 (repo is docs/issues; binary is closed). Latest release tag 1.2.4 (2026-09-16). Successor of Gemini CLI; imports Gemini CLI extensions/skills/settings on first run (`agy plugin import gemini`).
- Install (README): macOS/Linux `curl -fsSL https://antigravity.google/cli/install.sh | bash` ; Windows PowerShell `irm https://antigravity.google/cli/install.ps1 | iex` ; Windows CMD `curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd`. Single compiled binary, no Node.
- AGENTS.md: yes — migration doc: "continues to parse and enforce rule constraints defined inside your active directory's GEMINI.md and AGENTS.md files" and global `~/.gemini/GEMINI.md`.
- Skills std: project `.agents/skills/`, global `~/.gemini/antigravity-cli/skills/`. Plugins: `agy plugin install /path` (plugin.json + skills/ agents/ rules/ mcp_config.json hooks.json).
- MCP: global `~/.gemini/config/mcp_config.json`, workspace `.agents/mcp_config.json`, `mcpServers` key, remote uses `serverUrl` (not `url`). `/mcp` in TUI.
- Update: the official install.sh prints "The Antigravity CLI automatically self-updates in the background during regular runs" (verified 2026-09-17; CHANGELOG also mentions the "background auto-updater"). `agy update` is reported by third-party tutorials only and is NOT in the README/CHANGELOG/docs fetched; re-running the installer is the documented fallback.
- skills CLI target: `antigravity-cli` (global `~/.gemini/antigravity-cli/skills/`); `antigravity` is the IDE (`~/.gemini/antigravity/skills/`).
- Data-use note: README says interactions data collected by default (opt-out in settings).

### 1.3 GitHub Copilot CLI (github/copilot-cli) — verdict: recommended (if user has Copilot subscription)
- Stars 11,175. npm `@github/copilot` 1.0.85 (2026-09-16), 10.6M downloads/month; GitHub release v1.0.86-2 (2026-09-17; v1.0.86-1 on 2026-09-16). Requires Copilot subscription; Node 22+ for npm path; Windows needs PowerShell v6+.
- Install (docs.github.com install-copilot-cli): `curl -fsSL https://gh.io/copilot-install | bash` ; `wget -qO- https://gh.io/copilot-install | bash` ; `npm install -g @github/copilot` ; `brew install --cask copilot-cli` ; Windows `winget install GitHub.Copilot`. Prerelease: `@prerelease`, `GitHub.Copilot.Prerelease`, `copilot-cli@prerelease`. Script honors `PREFIX`, `VERSION`.
- Update: `copilot update`.
- AGENTS.md: yes ("Agent files such as AGENTS.md", plus `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`).
- Skills std: project `.github/skills`, `.claude/skills`, `.agents/skills`; personal `~/.copilot/skills`, `~/.agents/skills`. `/skills list|info|add|reload|remove`.
- MCP: `~/.copilot/mcp-config.json` (COPILOT_HOME overrides); `copilot mcp` non-interactive. Plugins: `copilot plugin` (marketplaces). LSP: `~/.copilot/lsp-config.json`.
- skills CLI target: `github-copilot` (global `~/.copilot/skills/`).

### 1.4 Cursor CLI (binary `agent`) — verdict: optional (closed source; needs Cursor plan)
- Closed source; stars n/a. Version unknown (auto-updates).
- Install (cursor.com/docs/cli/installation): macOS/Linux/WSL `curl https://cursor.com/install -fsS | bash` ; native Windows PowerShell `irm 'https://cursor.com/install?win32=true' | iex`. Verify `agent --version`; update `agent update` (auto-update on by default). May need `~/.local/bin` on PATH.
- AGENTS.md: yes (project root + nested; alternative to `.cursor/rules`).
- Skills std: project `.agents/skills/`, `.cursor/skills/`, `.claude/skills/`, `.codex/skills/`; user `~/.agents/skills/`, `~/.cursor/skills/`, `~/.claude/skills/`, `~/.codex/skills/`.
- MCP: `.cursor/mcp.json` (project) / `~/.cursor/mcp.json` (global); CLI shares editor config; `agent mcp list|list-tools|enable|disable|login`, `--approve-mcps`.
- skills CLI target: `cursor` (global `~/.cursor/skills/`).

### 1.5 OpenCode (anomalyco/opencode, formerly sst/opencode) — verdict: must-have (top OSS agent, model-agnostic, Ollama-friendly)
- Stars 207,908. MIT. npm `opencode-ai` 1.18.31 (2026-09-14), 9.23M downloads/month. GitHub release v1.18.31 (2026-09-14).
- Install (opencode.ai/docs): `curl -fsSL https://opencode.ai/install | bash` ; `npm install -g opencode-ai` ; `bun install -g opencode-ai` ; `pnpm install -g opencode-ai` ; `brew install anomalyco/tap/opencode` (README also shows `brew install opencode`) ; Arch `sudo pacman -S opencode` / `paru -S opencode-bin` ; Windows `scoop install opencode` / `choco install opencode` ; `mise use -g github:anomalyco/opencode` ; Docker `ghcr.io/anomalyco/opencode`. Update: `opencode upgrade`.
- AGENTS.md: yes (`/init` creates it).
- Skills std: yes (Agent Skills spec). Project `.opencode/skills/`, `.claude/skills/`, `.agents/skills/`; global `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/`.
- MCP: `"mcp"` key in `opencode.json`/`opencode.jsonc` (project) or `~/.config/opencode/opencode.json`; `type: "local"` with `command: [..]` array + `environment`, or `type: "remote"` with `url` + `headers`. NOTE: different shape from `mcpServers`.
- Ollama: `ollama launch opencode` is an official Ollama integration.
- skills CLI target: `opencode` (global `~/.config/opencode/skills/`).

### 1.6 Amp (Sourcegraph spin-out ampcode.com) — verdict: optional (paid, closed source, WSL-only on Windows)
- Closed source (github.com/sourcegraph/amp 404). npm `@ampcode/cli` 0.0.1789588847-gf375db (2026-09-16), ~103k downloads/month; `@sourcegraph/amp` is a rename shim ("Renamed to @ampcode/cli"; the post said removal on 2026-06-15, but on 2026-09-17 it was still published at the same version as `@ampcode/cli`).
- Install (ampcode.com/docs/cli): `curl -fsSL https://ampcode.com/install.sh | bash`. "supports macOS, Linux, and Windows through WSL". Update: `amp update` (background auto-update). Version: `amp version`.
- AGENTS.md: yes (also `AGENT.md`, `CLAUDE.md` fallbacks; `~/.config/AGENTS.md`, `~/.config/amp/AGENTS.md`, `/etc/ampcode/AGENTS.md`, `%ProgramData%\ampcode\AGENTS.md`).
- Skills std: precedence `~/.config/agents/skills/`, `~/.agents/skills/`, `~/.config/amp/skills/`, `.agents/skills/`, `.claude/skills/`, `~/.claude/skills/`, `~/.claude/plugins/cache/`, `amp.skills.path`. `amp skill add <source>`, `amp skills list`.
- MCP: `~/.config/amp/settings.json` / `.amp/settings.json`, key `"amp.mcpServers"`; `amp mcp add context7 -- npx -y @upstash/context7-mcp`.
- skills CLI target: `amp` (= `.agents/skills/`, global `~/.config/agents/skills/`).

### 1.7 Kimi CLI (MoonshotAI/kimi-cli, Python) — verdict: deprecated (superseded)
- Stars 11,382. Apache-2.0. PyPI `kimi-cli` 1.50.0 (2026-09-01). README: "Kimi CLI is evolving into Kimi Code CLI ... This project will be gradually wound down".
- Install: `uv tool install kimi-cli` ; `pip install kimi-cli`. MCP: `kimi mcp add --transport http|stdio ...`, `--mcp-config-file mcp.json`. Skills: `~/.kimi/skills/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.config/agents/skills/`, `~/.agents/skills/`; project `.kimi/skills/`, `.claude/skills/`, `.codex/skills/`, `.agents/skills/`.

### 1.8 Kimi Code CLI (MoonshotAI/kimi-code, binary `kimi`) — verdict: optional (good if you use Kimi models; native Windows)
- Stars 7,412. MIT. npm `@moonshot-ai/kimi-code` 0.43.1 (2026-09-15), 148k downloads/month. Release 2026-09-15.
- Install (README): `curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash` ; Windows PowerShell `irm https://code.kimi.com/kimi-code/install.ps1 | iex` (needs Git for Windows; `KIMI_SHELL_PATH` for custom bash.exe) ; `npm install -g @moonshot-ai/kimi-code`. Update: `kimi upgrade` or `npm install -g @moonshot-ai/kimi-code@latest`.
- AGENTS.md: yes (`${agents_md}`; global `~/.kimi-code/AGENTS.md`, `~/.agents/AGENTS.md`; project `AGENTS.md`, `.kimi-code/AGENTS.md`).
- Skills std: user `~/.kimi-code/skills/` (`$KIMI_CODE_HOME/skills/`) and `~/.agents/skills/`; project `.kimi-code/skills/`, `.agents/skills/`; `extra_skill_dirs` in config.toml.
- MCP: `~/.kimi-code/mcp.json` (user) / `.kimi-code/mcp.json` (project), `mcpServers` key; `/mcp-config` conversational. Config `~/.kimi-code/config.toml`.
- skills CLI target: `kimi-code-cli` (= `.agents/skills/`, `~/.agents/skills/`).

### 1.9 Qwen Code (QwenLM/qwen-code, binary `qwen`) — verdict: optional (Gemini-CLI fork lineage; strong OSS; native Windows)
- Stars 27,901. npm `@qwen-code/qwen-code` 0.24.0 (2026-09-16), 275k downloads/month. Release v0.24.0 (2026-09-16).
- Install (README): Linux/macOS `curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash` ; Windows `irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex` ; `npm install -g @qwen-code/qwen-code@latest` (Node 22+) ; `brew install qwen-code`. Also Desktop app.
- AGENTS.md: not by default (QWEN.md); `context.fileName` string|array in settings.
- Skills std: `SKILL.md` format; personal `~/.qwen/skills/`, project `.qwen/skills/` (docs do not list `.agents/skills`). Built-in Auto-Skills.
- MCP: `mcpServers` in `~/.qwen/settings.json` / `.qwen/settings.json`; `qwen mcp add --scope user --transport http ...`.
- skills CLI target: `qwen-code` (`.qwen/skills/`, `~/.qwen/skills/`).

### 1.10 Factory Droid (`droid`) — verdict: optional (paid; very complete skills/MCP/AGENTS.md story; native Windows)
- Closed source (Factory-AI/factory repo 23 stars is samples). npm `droid` 0.221.0 (2026-09-17; 0.220.0 was current on 2026-09-16), 52k downloads/month.
- Install (docs.factory.ai quickstart): macOS/Linux `curl -fsSL https://app.factory.ai/cli | sh` ; `brew install --cask droid` ; Windows `irm https://app.factory.ai/cli/windows | iex` ; `npm install -g droid`. Linux needs `xdg-utils`.
- AGENTS.md: yes ("AGENTS.md and compatible names").
- Skills std: project `.factory/skills/`, personal `~/.factory/skills/`, compatibility `.agents/skills/**`, `.agent/skills/**`, `~/.agents/skills/**`, `~/.agent/skills/**`, plugins, built-in.
- MCP: `~/.factory/mcp.json` (user), `.factory/mcp.json` (folder/project); `droid mcp add <name> <urlOrCommand...> --type stdio|http|sse`, `droid mcp list|remove|permissions`. Settings `~/.factory/settings.json` (`%USERPROFILE%\.factory\settings.json`).
- Update: not found in fetched docs (open question; npm path = reinstall).
- Ollama: `ollama launch droid` official integration.
- skills CLI target: `droid` (global `~/.factory/skills/`).

### 1.11 Kiro CLI (AWS, `kiro-cli`) — verdict: optional (AWS ecosystem; native Windows 11)
- Closed source; kirodotdev/Kiro (issues repo) 4,305 stars. Changelog latest 2.21.4 (2026-09-11). Requires Kiro account (free tier exists per site; Kiro Web needs paid).
- Install (kiro.dev/docs/getting-started/installation): `curl -fsSL https://cli.kiro.dev/install | bash` ; Windows PowerShell `irm 'https://cli.kiro.dev/install.ps1' | iex` ; Linux alternatives: `wget https://desktop-release.q.us-east-1.amazonaws.com/latest/kiro-cli.deb` then `sudo apt-get install -f`; `wget https://desktop-release.q.us-east-1.amazonaws.com/latest/kiro-cli.appimage`; rpm repo `sudo curl --proto '=https' --tlsv1.2 -sSf https://prod.download.cli.kiro.dev/rpm/kiro-cli.repo -o /etc/yum.repos.d/kiro-cli.repo`; zip `curl --proto '=https' --tlsv1.2 -sSf 'https://desktop-release.q.us-east-1.amazonaws.com/latest/kirocli-x86_64-linux.zip' -o 'kirocli.zip'` (also aarch64 and -musl). Supported: macOS, Windows 11 (PowerShell), Linux glibc 2.34+ or musl. Homebrew is NOT supported.
- Update: auto-updates in background; `kiro-cli update` "reports when a new version is available but does not install it".
- AGENTS.md: yes since 2.18.0 (2026-08-12): loads from anywhere in workspace tree.
- Skills std: "Kiro supports the Agent Skills standard"; `.kiro/skills/`, `~/.kiro/skills/`; custom agents need `"resources": ["skill://.kiro/skills/**/SKILL.md"]`.
- MCP: `.kiro/settings/mcp.json`, `~/.kiro/settings/mcp.json`, `mcpServers`; `/mcp add`.
- skills CLI target: `kiro-cli` (`.kiro/skills/`, `~/.kiro/skills/`).

### 1.12 Crush (charmbracelet/crush) — verdict: recommended (OSS, Go, native Windows, model-agnostic incl. Ollama)
- Stars 28,134. npm `@charmland/crush` 0.95.0 (2026-09-16), 46k downloads/month. Release v0.95.0 (2026-09-16).
- Install (README): `brew install charmbracelet/tap/crush` ; `npm install -g @charmland/crush` ; `yay -S crush-bin` ; `nix run github:numtide/nix-ai-tools#crush` ; `pkg install crush` ; Windows `winget install charmbracelet.crush` or `scoop bucket add charm https://github.com/charmbracelet/scoop-bucket.git` + `scoop install crush` ; Debian/Ubuntu apt repo (`curl -fsSL https://repo.charm.sh/apt/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/charm.gpg` ... `sudo apt update && sudo apt install crush`) ; yum repo ; `go install github.com/charmbracelet/crush@latest`. "first-class support ... macOS, Linux, Windows (PowerShell and WSL), Android, FreeBSD...".
- AGENTS.md: yes (`/init` writes `AGENTS.md`; global `~/.config/AGENTS.md` + `~/.config/crush/CRUSH.md`).
- Skills std: yes (agentskills.io). Global `$CRUSH_SKILLS_DIR`, `~/.config/agents/skills/`, `~/.config/crush/skills/`, `~/.agents/skills/`, `~/.claude/skills/`, Windows `%LOCALAPPDATA%\agents\skills\`, `%LOCALAPPDATA%\crush\skills\`; project `.agents/skills`, `.crush/skills`, `.claude/skills`, `.cursor/skills`.
- MCP: `crushrc` DSL (`./.crushrc`, `./crushrc`, `~/.config/crush/crushrc`, Windows `%USERPROFILE%\.config\crush\crushrc`): `mcp add github --type http --url https://api.github.com/mcp/ --header Authorization "Bearer $GH_PAT"`; old JSON `crush.json` deprecated. Ollama: `provider add ollama --type ollama --base-url "http://localhost:11434/v1"`.
- skills CLI target: `crush` (`.crush/skills/`, `~/.config/crush/skills/`).

### 1.13 Aider (Aider-AI/aider) — verdict: skip (stale; no AGENTS.md/skills/MCP)
- Stars 49,002. PyPI `aider-chat` 0.86.2 (2026-02-12); last commit 2026-05-22. 6.8M lifetime pip installs (README badge).
- Install (aider.chat/docs/install): `python -m pip install aider-install` then `aider-install` ; `curl -LsSf https://aider.chat/install.sh | sh` ; Windows `powershell -ExecutionPolicy ByPass -c "irm https://aider.chat/install.ps1 | iex"` ; `uv tool install --force --python python3.12 --with pip aider-chat@latest` ; `pipx install aider-chat`.
- AGENTS.md: no (use `aider --read CONVENTIONS.md` / `.aider.conf.yml` `read:`). Skills: no. MCP: not in docs. skills CLI: only `aider-desk` (a different GUI project).

### 1.14 Goose (aaif-goose/goose, formerly block/goose) — verdict: optional (OSS, Rust, MCP-native; Windows via PS script)
- Stars 54,362. Apache-2.0. Release v1.50.1 (2026-09-14). Moved to Agentic AI Foundation (`aaif-goose`).
- Install (goose-docs.ai installation): `curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash` ; Windows PowerShell `Invoke-WebRequest -Uri "https://raw.githubusercontent.com/aaif-goose/goose/main/download_cli.ps1" -OutFile "download_cli.ps1"; .\download_cli.ps1` ; `brew install block-goose-cli`. Update: `goose update`.
- AGENTS.md: yes ("goose looks for AGENTS.md then .goosehints files by default"; `CONTEXT_FILE_NAMES` env).
- Skills std: `~/.agents/skills/`, `.agents/skills/` recommended; also `.goose/skills/`, `.claude/skills/`, `~/.claude/skills/`, `~/.config/goose/skills/`.
- MCP: YAML `extensions:` in `~/.config/goose/config.yaml` (Windows `%APPDATA%\Block\goose\config\config.yaml`), `type: stdio|streamable_http|builtin|platform` (`cmd`, `args`, `envs`, `uri`, `headers`).
- skills CLI target: `goose` (`.goose/skills/`, `~/.config/goose/skills/`).

### 1.15 Cline CLI (cline/cline, npm `cline`) — verdict: optional
- Stars 68,347. npm `cline` 3.0.62 (2026-09-15), 384k downloads/month.
- Install (docs.cline.bot/cli/overview): `npm i -g cline` (equivalent `npm install -g cline`), then `cline auth`. Update: `cline update`. Windows: config path `C:\Users\USERNAME\.cline\skills\` documented, so native Windows works.
- AGENTS.md: yes (`AGENTS.md`, `~/.agents/AGENTS.md`; primary `.clinerules/`).
- Skills std: project `.cline/skills/`, `.clinerules/skills/`, `.claude/skills/`; global `~/.cline/skills/`. (Docs do NOT list `.agents/skills`, but skills CLI maps `cline` to `.agents/skills/` — discrepancy, verify.)
- MCP: `~/.cline/data/settings/cline_mcp_settings.json`; `cline mcp`.
- skills CLI target: `cline`.

### 1.16 Mistral Vibe (mistralai/mistral-vibe, binary `vibe`) — verdict: optional (Python/uv; Windows "works" but UNIX targeted)
- Stars 4,958. PyPI `mistral-vibe` 2.25.4 (2026-09-12). Release v2.25.4.
- Install (README): `curl -LsSf https://mistral.ai/vibe/install.sh | bash` ; Windows: install uv (`powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`) then `uv tool install mistral-vibe` ; `pip install mistral-vibe`. Update: `uv tool upgrade mistral-vibe` / `brew upgrade mistral-vibe`; `vibe --check-upgrade`.
- AGENTS.md: yes (`~/.vibe/AGENTS.md`, project tree, trusted folders only).
- Skills std: "follows the Agent Skills specification"; `.agents/skills/`, `.vibe/skills/`, `~/.vibe/skills/`, `~/.agents/skills/`, `skill_paths` in config.toml.
- MCP: `mcp_servers` section in `~/.vibe/config.toml`; `vibe mcp add <name> --url ... --transport streamable-http --api-key-env ...`.
- skills CLI target: `mistral-vibe` (`.vibe/skills/`, `~/.vibe/skills/`).

### 1.17 Grok Build (xai-org/grok-build, binary `grok`) — verdict: optional (xAI; Rust; native Windows; Claude/Cursor compat layers)
- Stars 26,797. Apache-2.0 first-party (vendored codex/opencode ports under their licenses). Last commit 2026-09-15 ("Synced from monorepo").
- Install (README): `curl -fsSL https://x.ai/cli/install.sh | bash` (macOS/Linux/Git Bash) ; Windows PowerShell `irm https://x.ai/cli/install.ps1 | iex`. Update: `grok update`.
- AGENTS.md: yes (`AGENTS.md`, `Agents.md`, `CLAUDE.md`, `Claude.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `~/.claude/`), folder trust required.
- Skills std: `./.grok/skills/`, `<repo>/.grok/skills/`, `~/.grok/skills/`, `~/.claude/skills/`, `./.claude/skills/`, `~/.cursor/skills/`, `./.cursor/skills/`, plus `.agents/skills/` at each tier. Toggle via `[compat.claude]`/`[compat.cursor]` in `~/.grok/config.toml`.
- MCP: `[mcp_servers.<name>]` in `~/.grok/config.toml` (or repo `.grok/config.toml`); `requirements.toml`/`managed_config.toml` for org control.
- Ollama/custom: `[model.my-model]` in `~/.grok/config.toml` (Windows `%USERPROFILE%\.grok\config.toml`).
- skills CLI target: `grok` (`.grok/skills/`, `~/.grok/skills/`).

### 1.18 Augment Auggie (`auggie`) — verdict: optional (paid; Windows WSL only)
- Repo augmentcode/auggie 280 stars (issues/docs). npm `@augmentcode/auggie` 0.36.0 (2026-08-21), 124k downloads/month.
- Install: `npm install -g @augmentcode/auggie` (Node 20+; "MacOS, Windows WSL, Linux"). Update: auto-updates in interactive mode.
- AGENTS.md: yes (also CLAUDE.md, `.augment/rules/`, `~/.augment/rules/`).
- Skills std (agentskills.io): `~/.augment/skills/`, `.augment/skills/`, `~/.claude/skills/`, `.claude/skills/`, `~/.agents/skills/`, `.agents/skills/`.
- MCP: `~/.augment/settings.json` `mcpServers`; `auggie mcp add <name>`; `--mcp-config` override.
- skills CLI target: `augment` (`.augment/skills/`, `~/.augment/skills/`).

### 1.19 Warp Agent CLI (binary `warp`, ex-`oz`) — verdict: optional (Warp account; native Windows)
- Closed source. `oz` binary deprecated in favour of `warp` (oz commands supported through end of Sept 2026 per third-party summary; official docs now only document `warp`).
- Install (docs.warp.dev/agents/cli/quickstart): `curl -fsSL https://app.warp.dev/download/agent-cli | bash` ; Windows `Invoke-RestMethod "https://app.warp.dev/download/agent-cli.ps1" | Invoke-Expression` ; `brew install --cask warp-agent-cli`. Update: curl install self-updates; brew `brew upgrade --cask warp-agent-cli`.
- AGENTS.md: yes (`AGENTS.md` or `WARP.md`; global `~/.agents/AGENTS.md`).
- Skills std: `.agents/skills/`, `~/.agents/skills/`; `/skills`.
- MCP: JSON `mcpServers` file; macOS `~/.warp_cli/.mcp.json`; settings `~/.warp_cli/settings.toml` (macOS), `~/.config/warp-terminal/cli/settings.toml` (Linux), `%LOCALAPPDATA%\warp\Warp\config\cli\settings.toml` (Windows). `/mcp` shows the path.
- skills CLI target: `warp` (= `.agents/skills/`, `~/.agents/skills/`).

### 1.20 Devin CLI / "Devin for Terminal" (Cognition; also the Windsurf CLI) — verdict: optional (paid subscription; native Windows)
- Closed source. Windsurf has no separate CLI: docs.windsurf.com "Devin Local Agent: Use the same agent harness as Devin CLI directly inside Windsurf"; Devin Desktop bundles the CLI for "Legacy Windsurf Enterprise".
- Install (docs.devin.ai/cli): `curl -fsSL https://cli.devin.ai/install.sh | bash` ; `brew install --cask devin-cli` ; Windows PowerShell `irm https://static.devin.ai/cli/setup.ps1 | iex` (PowerShell only). Update: `devin update` ("Check for updates and optionally install them"; `devin update --force`), or `/update [--force]` in-app; brew `brew upgrade --cask devin-cli`.
- AGENTS.md: yes (`AGENTS.md`/`AGENT.md`/`CLAUDE.md`; global `~/.config/devin/AGENTS.md`, `%APPDATA%\devin\AGENTS.md`; also `~/.claude/CLAUDE.md`; `AGENTS.local.md`).
- Skills std: "We support the .agents skills standards"; `.agents/skills/`, `.devin/skills/`, `.windsurf/skills/`, `~/.agents/skills/`, `~/.config/devin/skills/`, `~/.codeium/<channel>/skills/`.
- MCP: `~/.config/devin/mcp_config.json` (`%APPDATA%\devin\mcp_config.json`), `.devin/mcp_config.json`, `.devin/mcp_config.local.json`; `devin mcp add -s user|project <name> <URL>`, `devin mcp login|enable|disable`.
- skills CLI targets: `devin` (`.devin/skills/`, `~/.config/devin/skills/`), `windsurf` (`.windsurf/skills/`, `~/.codeium/windsurf/skills/`).

### 1.21 Jules Tools (google-labs-code/jules-tools, npm `@google/jules`) — verdict: skip
- Install (Jules changelog 2025-10-02): `npm install -g @google/jules`. npm 0.1.42 last published 2025-12-16 (8.0k downloads/month); Jules changelog last entry 2026-03-09 (model update), CLI section last 2025-11-10. It is a client for the async cloud agent, not a local coding agent. No AGENTS.md/skills/MCP CLI story found. No skills CLI target.

### 1.22 Pi coding agent (badlogic/pi-mono, npm `@earendil-works/pi-coding-agent`) — verdict: recommended (minimal, extensible, huge adoption)
- Stars 106,289. MIT. npm 0.85.1 (2026-09-05), **9.34M downloads/month**.
- Install (README): `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` ; `curl -fsSL https://pi.dev/install.sh | sh`. Windows: supported (docs/windows.md; Windows Terminal notes). Update: `pi update` (`--all`, `--extensions`, `--models`).
- AGENTS.md: yes (`AGENTS.md` or `CLAUDE.md`; `~/.pi/agent/AGENTS.md`; `AGENTS.override.md`).
- Skills std: `~/.pi/agent/skills/`, `~/.agents/skills/`, `.pi/skills/`, `.agents/skills/`.
- MCP: **none by design** ("No MCP. Build CLI tools with READMEs ... or build an extension"). Settings `~/.pi/agent/settings.json`, `.pi/settings.json`. Telemetry ping on install (opt-out `PI_TELEMETRY=0`).
- skills CLI target: `pi` (`.pi/skills/`, `~/.pi/agent/skills/`).

### 1.23 OpenHands CLI (OpenHands/OpenHands, PyPI `openhands`) — verdict: optional (WSL only on Windows)
- Stars 88,176. PyPI `openhands` 1.16.0 (2026-05-08); Agent Canvas image 1.19.0.
- Repo moved: `All-Hands-AI/OpenHands` now redirects to `OpenHands/OpenHands` (88.2k stars, MIT, 2026-09-17).
- Install (docs.openhands.dev CLI installation): `uv tool install openhands --python 3.12` ; upgrade `uv tool upgrade openhands --python 3.12` ; binary `curl -fsSL https://install.openhands.dev/install.sh | sh`. "Windows users: All commands below should be run inside the WSL terminal".
- AGENTS.md: yes (auto-finds AGENTS.md, CLAUDE.md, GEMINI.md at workspace root).
- Skills: `.agents/skills/` (project), `~/.openhands/skills/installed/` (marketplace installs).
- MCP: `~/.openhands/mcp.json`, `mcpServers`.
- skills CLI target: `openhands` (`.openhands/skills/`, `~/.openhands/skills/`).

### 1.24 Kilo Code CLI (Kilo-Org/kilocode, npm `@kilocode/cli`, binary `kilo`) — verdict: optional (OpenCode fork, native Windows)
- Stars 27,333. npm 7.7.2 (2026-09-15), 130k downloads/month.
- Install (README): `npm install -g @kilocode/cli` ; `curl -fsSL https://kilo.ai/cli/install | bash` ; `pnpm add -g @kilocode/cli` ; `bun add -g @kilocode/cli` ; `brew install Kilo-Org/tap/kilo` ; `paru -S kilo-bin`. Update: `kilo upgrade`.
- AGENTS.md: yes (`/init`). Config `~/.config/kilo/kilo.jsonc` (legacy `~/.config/opencode/`), MCP inside `kilo.jsonc`. "a fork of OpenCode". Skills dirs: not fetched (assume OpenCode-like; skills CLI uses `.agents/skills/`, `~/.kilo/skills/`).

### 1.25 Roo Code — verdict: deprecated
- README: "The Roo Code Extension was shut down on May 15th" (2026); points to ZooCode fork and Cline. skills CLI still lists `roo`.

### 1.26 Hermes Agent (NousResearch/hermes-agent) — verdict: optional (general self-improving agent, not coding-only; native Windows)
- Stars 246,188. MIT. Release v2026.9.14 (2026-09-14).
- Install (README): `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash` ; Windows native `iex (irm https://hermes-agent.nousresearch.com/install.ps1)` (installs uv, Python 3.11, Node, ripgrep, ffmpeg, MinGit under `%LOCALAPPDATA%\hermes`). Update: `hermes update`.
- AGENTS.md: yes (also `.hermes.md`/`HERMES.md`, `CLAUDE.md`, `SOUL.md`). Skills: `~/.hermes/skills/` is the only default; `~/.agents/skills/` is read ONLY if listed under `skills.external_dirs` in `~/.hermes/config.yaml` (docs: External Skill Directories). Installer must write that config key. MCP: `mcp_servers` in `~/.hermes/config.yaml`.
- skills CLI target: `hermes-agent` (`.hermes/skills/`, `~/.hermes/skills/`).

### 1.27 DeepSeek Harness (deepseek-ai/deepseek-harness, `dsh`) — verdict: optional/watch (dev preview, breaking changes promised)
- Stars 226,582 (repo created 2026-08-13). MIT. npm `@deepseek-ai/dsh` 0.1.5-rc.1 (2026-09-10), 1.91M downloads/month; release dsh-v0.1.6-alpha.1 (2026-09-15).
- Run (README): `npx @deepseek-ai/dsh web` (Web UI at 127.0.0.1:3080). Ollama docs: `npm install -g @deepseek-ai/dsh@latest`, `ollama launch dsh`. "everything-is-a-plugin" (Cordis). Repo has `.agents/`, `.claude/`, `AGENTS.md`, `CLAUDE.md` symlink. Skills/MCP config paths: not documented in README (open question). No skills CLI target yet.

### 1.28 Ollama (ollama/ollama) — verdict: recommended as the local-model backend (not an agent)
- Stars 181,202 (2026-09-17); latest release v0.34.2 (2026-09-15). Install (README): Linux/macOS `curl -fsSL https://ollama.com/install.sh | sh` ; Windows `irm https://ollama.com/install.ps1 | iex` (or OllamaSetup.exe). `ollama launch claude|codex|copilot|dsh|droid|opencode|openclaw` wires local models into those agents (config under `~/.ollama/launch/<agent>/`).

### 1.29 Long tail (sourced only to the extent shown)
- **Continue CLI** (`npm i -g @continuedev/cli`, `cn`) 1.5.47 (2026-06-18), 12.5k downloads/month; README: "Final 2.0.0 Release" -> skip. Stars 35,937.
- **CodeBuddy Code** (Tencent) `@tencent-ai/codebuddy-code` 2.151.0 (2026-09-14), 289k downloads/month; skills CLI `codebuddy`. Not evaluated further.
- **Junie CLI** (JetBrains) `@jetbrains/junie-cli` 1468.30.0 (2026-04-27); skills CLI `junie`. Not evaluated.
- **iFlow CLI** `@iflow-ai/iflow-cli` 0.5.19 (2026-04-25); skills CLI `iflow-cli`.
- **OpenClaw** npm `openclaw` 2026.9.4 (2026-09-11): multi-channel AI gateway/assistant (Ollama `ollama launch openclaw`); skills CLI `openclaw`. Not a coding CLI.
- **Zed** is an editor (ACP host for Claude Code/Codex/Devin/OpenHands), skills CLI `zed`; **Windsurf** = see Devin.

## 2. Install command matrix (copy-paste, verbatim from sources)

| Agent | Linux | Windows native | Update |
|---|---|---|---|
| Gemini CLI | `npm install -g @google/gemini-cli` / `brew install gemini-cli` | `npm install -g @google/gemini-cli` | `npm install -g @google/gemini-cli@latest` |
| Antigravity CLI | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` | `irm https://antigravity.google/cli/install.ps1 \| iex` | background self-update (install.sh statement); re-run installer to force |
| Copilot CLI | `curl -fsSL https://gh.io/copilot-install \| bash` / `npm install -g @github/copilot` / `brew install --cask copilot-cli` | `winget install GitHub.Copilot` / npm | `copilot update` |
| Cursor CLI | `curl https://cursor.com/install -fsS \| bash` | `irm 'https://cursor.com/install?win32=true' \| iex` | `agent update` |
| OpenCode | `curl -fsSL https://opencode.ai/install \| bash` / `npm install -g opencode-ai` / `brew install anomalyco/tap/opencode` / `sudo pacman -S opencode` | `scoop install opencode` / `choco install opencode` / npm | `opencode upgrade` |
| Amp | `curl -fsSL https://ampcode.com/install.sh \| bash` (npm `@ampcode/cli`) | WSL only | `amp update` |
| Kimi Code CLI | `curl -fsSL https://code.kimi.com/kimi-code/install.sh \| bash` / `npm install -g @moonshot-ai/kimi-code` | `irm https://code.kimi.com/kimi-code/install.ps1 \| iex` | `kimi upgrade` |
| Kimi CLI (legacy) | `uv tool install kimi-cli` / `pip install kimi-cli` | same (uv) | `uv tool upgrade kimi-cli` (generic) |
| Qwen Code | `curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh \| bash` / `npm install -g @qwen-code/qwen-code@latest` / `brew install qwen-code` | `irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 \| iex` | npm `@latest` |
| Droid | `curl -fsSL https://app.factory.ai/cli \| sh` / `npm install -g droid` / `brew install --cask droid` | `irm https://app.factory.ai/cli/windows \| iex` | `droid update` ("Manually update the CLI to latest version"); standalone installs auto-update unless `FACTORY_DROID_AUTO_UPDATE_ENABLED=false` |
| Kiro CLI | `curl -fsSL https://cli.kiro.dev/install \| bash` (+ .deb/.appimage/rpm/zip) | `irm 'https://cli.kiro.dev/install.ps1' \| iex` | auto; `kiro-cli update` only reports |
| Crush | `brew install charmbracelet/tap/crush` / `npm install -g @charmland/crush` / apt+yum repos / `go install github.com/charmbracelet/crush@latest` | `winget install charmbracelet.crush` / scoop | via package manager |
| Aider | `curl -LsSf https://aider.chat/install.sh \| sh` / `python -m pip install aider-install && aider-install` / `uv tool install --force --python python3.12 --with pip aider-chat@latest` | `powershell -ExecutionPolicy ByPass -c "irm https://aider.chat/install.ps1 \| iex"` | re-run installer |
| Goose | `curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh \| bash` / `brew install block-goose-cli` | `Invoke-WebRequest -Uri "https://raw.githubusercontent.com/aaif-goose/goose/main/download_cli.ps1" -OutFile "download_cli.ps1"; .\download_cli.ps1` | `goose update` |
| Cline CLI | `npm install -g cline` | same | `cline update` |
| Mistral Vibe | `curl -LsSf https://mistral.ai/vibe/install.sh \| bash` / `uv tool install mistral-vibe` / `pip install mistral-vibe` | install uv then `uv tool install mistral-vibe` | `uv tool upgrade mistral-vibe` |
| Grok Build | `curl -fsSL https://x.ai/cli/install.sh \| bash` | `irm https://x.ai/cli/install.ps1 \| iex` | `grok update` |
| Auggie | `npm install -g @augmentcode/auggie` | WSL only | auto |
| Warp Agent CLI | `curl -fsSL https://app.warp.dev/download/agent-cli \| bash` / `brew install --cask warp-agent-cli` | `Invoke-RestMethod "https://app.warp.dev/download/agent-cli.ps1" \| Invoke-Expression` | self-updates / `brew upgrade --cask warp-agent-cli` |
| Devin CLI | `curl -fsSL https://cli.devin.ai/install.sh \| bash` / `brew install --cask devin-cli` | `irm https://static.devin.ai/cli/setup.ps1 \| iex` | `devin update` (or `/update`) / `brew upgrade --cask devin-cli` |
| Pi | `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` / `curl -fsSL https://pi.dev/install.sh \| sh` | npm | `pi update` |
| OpenHands CLI | `uv tool install openhands --python 3.12` / `curl -fsSL https://install.openhands.dev/install.sh \| sh` | WSL only | `uv tool upgrade openhands --python 3.12` |
| Kilo CLI | `npm install -g @kilocode/cli` / `curl -fsSL https://kilo.ai/cli/install \| bash` / `brew install Kilo-Org/tap/kilo` / `paru -S kilo-bin` | npm | `kilo upgrade` |
| Hermes Agent | `curl -fsSL https://hermes-agent.nousresearch.com/install.sh \| bash` | `iex (irm https://hermes-agent.nousresearch.com/install.ps1)` | `hermes update` |
| DeepSeek Harness | `npm install -g @deepseek-ai/dsh@latest` (Ollama docs) / `npx @deepseek-ai/dsh web` | npm | npm `@latest` |
| Ollama | `curl -fsSL https://ollama.com/install.sh \| sh` | `irm https://ollama.com/install.ps1 \| iex` | re-run installer |
| skills CLI | `npx skills ...` (no install) | same | n/a (npx) ; `npx skills update` updates skills |

## 3. Config-surface matrix

| Agent | AGENTS.md | Reads `~/.agents/skills/`? | Other global skill dirs | MCP file (global) | MCP shape |
|---|---|---|---|---|---|
| Gemini CLI | via `context.fileName` | yes | `~/.gemini/skills/` | `~/.gemini/settings.json` | `mcpServers` |
| Antigravity CLI | yes (+GEMINI.md) | unknown (project `.agents/skills` yes) | `~/.gemini/antigravity-cli/skills/` | `~/.gemini/config/mcp_config.json` | `mcpServers` (`serverUrl`) |
| Copilot CLI | yes | yes | `~/.copilot/skills` | `~/.copilot/mcp-config.json` | `mcpServers` |
| Cursor CLI | yes | yes | `~/.cursor/skills`, `~/.claude/skills`, `~/.codex/skills` | `~/.cursor/mcp.json` | `mcpServers` |
| OpenCode | yes | yes | `~/.config/opencode/skills`, `~/.claude/skills` | `~/.config/opencode/opencode.json` | `mcp` (local/remote) |
| Amp | yes (+AGENT.md, CLAUDE.md) | yes | `~/.config/agents/skills`, `~/.config/amp/skills`, `~/.claude/skills`, `~/.claude/plugins/cache/` | `~/.config/amp/settings.json` | `amp.mcpServers` |
| Kimi Code CLI | yes | yes | `~/.kimi-code/skills` | `~/.kimi-code/mcp.json` | `mcpServers` |
| Qwen Code | via `context.fileName` | no (docs) | `~/.qwen/skills` | `~/.qwen/settings.json` | `mcpServers` |
| Droid | yes | yes (+`~/.agent/skills`) | `~/.factory/skills` | `~/.factory/mcp.json` | `mcpServers` (droid mcp add) |
| Kiro CLI | yes (2.18+) | no | `~/.kiro/skills` | `~/.kiro/settings/mcp.json` | `mcpServers` |
| Crush | yes | yes | `~/.config/agents/skills`, `~/.config/crush/skills`, `~/.claude/skills` | `~/.config/crush/crushrc` | DSL `mcp add` |
| Aider | no | no | none | none documented | n/a |
| Goose | yes | yes | `~/.config/goose/skills`, `~/.claude/skills` | `~/.config/goose/config.yaml` | YAML `extensions` |
| Cline CLI | yes | not in docs | `~/.cline/skills` | `~/.cline/data/settings/cline_mcp_settings.json` | `mcpServers` |
| Mistral Vibe | yes | yes | `~/.vibe/skills` | `~/.vibe/config.toml` | TOML `mcp_servers` |
| Grok Build | yes (+CLAUDE.md) | tier scan (likely) | `~/.grok/skills`, `~/.claude/skills`, `~/.cursor/skills` | `~/.grok/config.toml` | TOML `[mcp_servers.x]` |
| Auggie | yes | yes | `~/.augment/skills`, `~/.claude/skills` | `~/.augment/settings.json` | `mcpServers` |
| Warp CLI | yes (+WARP.md) | yes | — | `~/.warp_cli/.mcp.json` (macOS; Linux/Win path shown by `/mcp`) | `mcpServers` |
| Devin CLI | yes (+CLAUDE.md) | yes | `~/.config/devin/skills`, `~/.codeium/<ch>/skills` | `~/.config/devin/mcp_config.json` | `mcpServers` |
| Pi | yes (+CLAUDE.md) | yes | `~/.pi/agent/skills` | none (no MCP) | n/a |
| OpenHands | yes | project only | `~/.openhands/skills/installed` | `~/.openhands/mcp.json` | `mcpServers` |
| Kilo CLI | yes | unverified | `~/.kilo/skills` (skills CLI) | `~/.config/kilo/kilo.jsonc` | OpenCode-style (unverified) |
| Hermes | yes | only via `skills.external_dirs` in config.yaml | `~/.hermes/skills` | `~/.hermes/config.yaml` | YAML `mcp_servers` |

## 4. skills CLI (`npx skills`) target names (from vercel-labs/skills README, fetched 2026-09-16)

`-a <agent>` accepts (79 keys, verified 2026-09-17): aider-desk, amp, replit, universal, antigravity, antigravity-cli, astrbot, autohand-code, augment, bob, claude-code, openclaw, cline, dexto, kimi-code-cli, loaf, sarvam-code, warp, zed, codearts-agent, codebuddy, codemaker, codestudio, codex, command-code, continue, cortex, crush, cursor, deepagents, devin, droid, eve, firebender, forgecode, fx, gemini-cli, github-copilot, goose, grok, hermes-agent, inference-sh, jazz, junie, iflow-cli, kilo, kimchi, kiro-cli, kode, lingma, mcpjam, minimax-code, mistral-vibe, moxby, mux, opencode, openhands, ona, pi, posit-assistant, qoder, qoder-cn, qwen-code, reasonix, rovodev, roo, tabnine-cli, terramind, tinycloud, trae, trae-cn, windsurf, zcode, zencoder, zenflow, neovate, pochi, promptscript, adal.

Global paths that matter for this installer (from the same table): claude-code `~/.claude/skills/`; codex `~/.codex/skills/`; gemini-cli `~/.gemini/skills/`; github-copilot `~/.copilot/skills/`; cursor `~/.cursor/skills/`; opencode `~/.config/opencode/skills/`; amp/universal `~/.config/agents/skills/`; kimi-code-cli/cline/warp/zed `~/.agents/skills/`; qwen-code `~/.qwen/skills/`; droid `~/.factory/skills/`; kiro-cli `~/.kiro/skills/`; crush `~/.config/crush/skills/`; goose `~/.config/goose/skills/`; mistral-vibe `~/.vibe/skills/`; grok `~/.grok/skills/`; augment `~/.augment/skills/`; antigravity-cli `~/.gemini/antigravity-cli/skills/`; devin `~/.config/devin/skills/`; windsurf `~/.codeium/windsurf/skills/`; pi `~/.pi/agent/skills/`; openhands `~/.openhands/skills/`; kilo `~/.kilo/skills/`; hermes-agent `~/.hermes/skills/`.

Useful flags: `-g` global, `-a <agents...>` (or `'*'`), `-s <skills...>` (or `'*'`), `-y`, `--copy` (instead of symlink), `--all`; `npx skills update [-g|-p] [-y]`; `npx skills list`; `npx skills remove --all`. The CLI auto-detects installed agents. Local version on this machine: 1.5.23 (npm latest 1.5.26).

## 5. Recommendations for the installer picker

- **Tier A (offer by default, off unless chosen)**: OpenCode (must-have OSS), Crush, Pi, Copilot CLI (if Copilot), Antigravity CLI (if Google). Each has native Windows install, self-update, AGENTS.md, `~/.agents/skills` (Antigravity: symlink), and JSON MCP.
- **Tier B (optional, paid or niche)**: Cursor CLI, Droid, Devin CLI, Warp Agent CLI, Kiro CLI, Kimi Code CLI, Qwen Code, Grok Build, Goose, Cline CLI, Mistral Vibe, Auggie (WSL), Amp (WSL), Kilo CLI, Hermes Agent, DeepSeek Harness (preview).
- **Skip / do not offer**: Aider (stale, no standards), Jules Tools (stale, cloud client), Roo Code (shut down), Continue (final release), Kimi CLI legacy, Gemini CLI unless the user has a paid API key.
- Provide **Ollama** as a backend option and use `ollama launch <agent>` for claude/codex/copilot/opencode/droid/dsh.
- Implement one MCP source-of-truth (`mcpServers` JSON) and adapters: OpenCode (`mcp`, array command), Amp (`amp.mcpServers`), Goose (YAML), Crush (`crushrc`), Vibe/Grok (TOML), Hermes (YAML).
- Implement AGENTS.md bootstrap: for Gemini CLI/Qwen Code write `context.fileName` array; others read it natively.

## 6. Sources (fetched)
- https://raw.githubusercontent.com/vercel-labs/skills/main/README.md ; https://github.com/vercel-labs/skills ; registry.npmjs.org/skills
- Gemini CLI: https://github.com/google-gemini/gemini-cli ; raw docs get-started/installation.mdx, cli/skills.md, cli/settings.md, reference/configuration.md, tools/mcp-server.md, cli/tutorials/memory-management.md ; https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/ ; registry.npmjs.org/@google/gemini-cli
- Antigravity CLI: https://github.com/google-antigravity/antigravity-cli (README, releases) ; https://antigravity.google/docs/cli/overview ; /docs/cli/plugins/ ; /docs/cli/mcp/ ; /docs/cli/gcli-migration
- Copilot CLI: https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli ; .../reference/copilot-cli-reference/cli-command-reference ; .../copilot-cli/customize-copilot/add-skills ; .../copilot-cli/use-copilot-cli/overview ; https://github.com/github/copilot-cli ; registry.npmjs.org/@github/copilot
- Cursor: https://cursor.com/docs/cli/installation ; /docs/cli/mcp ; /docs/context/skills ; /docs/context/rules ; /docs/context/mcp
- OpenCode: https://opencode.ai/docs/ ; /docs/skills/ ; /docs/mcp-servers/ ; https://github.com/anomalyco/opencode ; registry.npmjs.org/opencode-ai
- Amp: https://ampcode.com/docs/cli ; /docs/customize/skills ; /docs/customize/mcp ; /docs/customize/agents-md ; /news/npm-package-changes ; registry.npmjs.org/@ampcode/cli, @sourcegraph/amp
- Kimi: https://github.com/MoonshotAI/kimi-cli (README, docs/en/customization/skills.md) ; https://github.com/MoonshotAI/kimi-code (README, docs/en/customization/skills.md, mcp.md, agents.md) ; https://moonshotai.github.io/kimi-code/en/guides/getting-started ; pypi kimi-cli ; npm @moonshot-ai/kimi-code
- Qwen Code: https://github.com/QwenLM/qwen-code (README, docs/users/features/skills.md, mcp.md, docs/users/configuration/settings.md) ; npm @qwen-code/qwen-code
- Droid: https://docs.factory.ai/cli/getting-started/quickstart ; /cli/configuration/skills ; /cli/configuration/mcp ; /cli/configuration/agents-md ; /cli/configuration/settings ; npm droid
- Kiro: https://kiro.dev/docs/getting-started/installation/ ; /docs/skills/ ; /docs/mcp/configuration/ ; /changelog/cli/ ; https://github.com/kirodotdev/Kiro
- Crush: https://github.com/charmbracelet/crush (README, releases) ; npm @charmland/crush
- Aider: https://github.com/Aider-AI/aider (README, commits) ; https://aider.chat/docs/install.html ; /docs/usage/conventions.html ; pypi aider-chat
- Goose: https://github.com/aaif-goose/goose (README, releases) ; https://goose-docs.ai/docs/getting-started/installation ; /docs/guides/context-engineering/using-skills/ ; /using-goosehints/ ; /docs/guides/config-files/
- Cline: https://docs.cline.bot/getting-started/installing-cline.md ; /getting-started/config.md ; /customization/skills.md ; /customization/cline-rules.md ; /cli/cli-reference.md ; https://github.com/cline/cline ; npm cline
- Vibe: https://github.com/mistralai/mistral-vibe (README, releases) ; pypi mistral-vibe
- Grok Build: https://github.com/xai-org/grok-build (README, commits, crates/codegen/xai-grok-pager/docs/user-guide/{README,01,07,08,12}.md) ; https://docs.x.ai/build/overview
- Augment: https://docs.augmentcode.com/cli/setup-auggie/install-auggie-cli ; /cli/skills.md ; /cli/rules.md ; /cli/integrations.md ; https://github.com/augmentcode/auggie ; npm @augmentcode/auggie
- Warp: https://docs.warp.dev/agents/cli/quickstart/ ; https://docs.warp.dev/_llms-txt/warp-agent-cli.txt ; https://docs.warp.dev/getting-started/getting-started-with-warp
- Devin/Windsurf: https://docs.devin.ai/cli ; /cli/extensibility/{index,configuration,skills,mcp,rules}.md ; /cli/extensibility/mcp/configuration.md ; /cli/essential-commands.md ; /work-with-devin/devin-cli.md ; https://docs.windsurf.com/llms.txt
- Jules: registry.npmjs.org/@google/jules ; https://jules.google/docs/changelog/
- Pi: https://github.com/badlogic/pi-mono (README, packages/coding-agent/README.md) ; npm @earendil-works/pi-coding-agent
- OpenHands: https://github.com/OpenHands/OpenHands (README) ; https://docs.openhands.dev/openhands/usage/cli/installation.md ; /cli/mcp-servers.md ; /sdk/guides/skill.md ; pypi openhands
- Kilo: https://github.com/Kilo-Org/kilocode (README, releases) ; https://kilo.ai/docs/code-with-ai/platforms/cli ; npm @kilocode/cli
- Roo: https://github.com/RooCodeInc/Roo-Code (README) ; Continue: https://github.com/continuedev/continue (README) ; npm @continuedev/cli
- Hermes: https://github.com/NousResearch/hermes-agent (README, releases) ; https://hermes-agent.nousresearch.com/docs/user-guide/{features/skills,features/mcp,configuration}
- DeepSeek Harness: https://github.com/deepseek-ai/deepseek-harness (page JSON payload, releases) ; https://docs.ollama.com/integrations/deepseek-harness ; npm @deepseek-ai/dsh
- Ollama: https://github.com/ollama/ollama (README)
- npm downloads: https://api.npmjs.org/downloads/point/last-month/<pkg>

## Verification (skeptical fact-check pass, 2026-09-17)

Method: every repo re-queried via `api.github.com/repos/<owner>/<repo>` (unauthenticated, 60/h budget; four repos fell over the limit and were re-checked via the github.com HTML page); every npm package via `registry.npmjs.org/<pkg>` + `api.npmjs.org/downloads/point/last-month/<pkg>`; every PyPI package via `pypi.org/pypi/<pkg>/json`; every install/update command re-fetched from the cited official page (raw README, docs page, or install script). Nothing was installed or run; only `curl`/`jq`/`python3` reads and WebFetch.

### Confirmed as written (no change)
- Stars (2026-09-17, GitHub API): opencode 207,958; crush 28,139; copilot-cli 11,177; antigravity-cli 2,305; gemini-cli 107,022; kimi-code 7,416; kimi-cli 11,383; qwen-code 27,907; goose 54,366; cline 68,416; mistral-vibe 4,960; grok-build 26,804; auggie 280; kilocode 27,334; hermes-agent 246,247; deepseek-harness 226,865 (created 2026-08-13); ollama 181,202; aider 49,009 (pushed 2026-05-22); Roo-Code 24,305 (**archived=true**, pushed 2026-05-15); continue 35,938; vercel-labs/skills 31,818. HTML page counts: pi-mono 106.4k; OpenHands 88.2k; kirodotdev/Kiro 4.3k (issues-only tracker); Factory-AI/factory 23. All within ±0.1% of the researcher's 2026-09-16 numbers.
- npm latest/publish dates (2026-09-17): opencode-ai 1.18.31 (09-14); @charmland/crush 0.95.0 (09-16); @earendil-works/pi-coding-agent 0.85.1 (09-05); @google/gemini-cli 0.60.0 (09-15); @moonshot-ai/kimi-code 0.43.1 (09-15); @qwen-code/qwen-code 0.24.0 (09-16); cline 3.0.62 (09-15); @augmentcode/auggie 0.36.0 (08-21); @kilocode/cli 7.7.2 (09-15); @deepseek-ai/dsh 0.1.5-rc.1 (09-10); @google/jules 0.1.42 (2025-12-16); @continuedev/cli 1.5.47 (06-18); @tencent-ai/codebuddy-code 2.151.0 (09-14). Download counts all match the 2026-08-13..09-11 window.
- PyPI: openhands 1.16.0 (2026-05-08); aider-chat 0.86.2 (2026-02-12); kimi-cli 1.50.0 (2026-09-01); mistral-vibe 2.25.4 (2026-09-12).
- Install commands verified character-for-character against source: OpenCode (all 11 methods + `opencode upgrade [target] --method`), Crush (all), Pi (`npm install -g --ignore-scripts ...`, `curl -fsSL https://pi.dev/install.sh | sh`, `pi update --all`), Copilot (curl/wget/npm/brew/winget; `copilot update`), Antigravity (sh/ps1/cmd), Cursor (`curl https://cursor.com/install -fsS | bash`, `irm 'https://cursor.com/install?win32=true' | iex`, `agent update`), Droid (4 methods), Kiro (`curl -fsSL https://cli.kiro.dev/install | bash`, `irm 'https://cli.kiro.dev/install.ps1' | iex`, deb/appimage wget URLs, "Homebrew ... is not supported", "`kiro-cli update` reports when a new version is available but does not install it", background auto-update), Kimi Code (curl/irm/npm, `kimi upgrade`, Git for Windows requirement), Qwen (4 methods, Node 22+), Amp (`curl -fsSL https://ampcode.com/install.sh | bash`, `amp update`, WSL-only on Windows, `amp mcp add <server-name> -- <command> [args]` / `amp mcp add <server-name> <url>`), Goose (curl/brew/ps1, `goose update`), Cline (`npm i -g cline`, `cline update`), Vibe (curl/uv/pip, `uv tool upgrade mistral-vibe` / `brew upgrade mistral-vibe`), Grok (`curl -fsSL https://x.ai/cli/install.sh | bash`, `irm https://x.ai/cli/install.ps1 | iex`, `grok update`), Auggie (`npm install -g @augmentcode/auggie`, Node 20+, MacOS/Windows WSL/Linux, auto-update), Warp (curl/Invoke-RestMethod/brew cask; auto-update; MCP paths for all 3 OSes), Devin (curl/brew/irm), OpenHands (uv/curl, WSL), Kilo (npm/curl/brew/paru, `kilo upgrade`), Hermes (curl/iex, `hermes update`), dsh (`npx @deepseek-ai/dsh web`; Ollama page: `npm install -g @deepseek-ai/dsh@latest`, `ollama launch dsh`), Ollama (curl/irm), Aider (all 6), Continue (`npm i -g @continuedev/cli`).
- Skills/AGENTS.md/MCP path claims re-confirmed from the cited docs for: Gemini, Antigravity (plugins + mcp + gcli-migration pages), Copilot (add-skills, overview, command reference), Cursor, OpenCode, Amp (skills precedence, agents-md, mcp), Kimi Code, Qwen (skills + settings + mcp docs), Droid (skills), Kiro (docs/skills: `.kiro/skills/`, `~/.kiro/skills/`, no `~/.agents/skills`; changelog 2.18.0 2026-08-12 AGENTS.md, 2.21.4 2026-09-11), Crush, Goose (using-skills page: `~/.agents/skills/` primary, `.goose/skills/`, `.claude/skills/`, `~/.claude/skills/`; hints: "AGENTS.md then .goosehints" via CONTEXT_FILE_NAMES), Cline (rules page: `AGENTS.md`, `~/.agents/AGENTS.md`; skills: `.cline/skills/`, `.clinerules/skills/`, `.claude/skills/`, `~/.cline/skills/`), Vibe, Grok (08-skills.md lists `~/.agents/skills/` explicitly at user tier — resolves the open question), Auggie (skills, integrations.md `~/.augment/settings.json` `mcpServers`, `auggie mcp add <name> [options]`, rules.md AGENTS.md+CLAUDE.md), Warp, Devin (skills table includes `~/.agents/skills/`; mcp/configuration.md; rules.md), Pi, OpenHands (`~/.openhands/mcp.json`), Windsurf (llms.txt "Devin Local Agent" line), Jules changelog (last entry 2026-03-09), Roo README (shut down May 15th; ZooCode + Cline), Continue README ("final 2.0.0 release"; repo "no longer actively maintained and is read-only").
- Gemini transition blog: exact quote confirmed — "On June 18, 2026, Gemini CLI and Gemini Code Assist IDE extensions will stop serving requests for Google AI Pro and Ultra, as well as those using it free of charge"; Standard/Enterprise licences and paid API keys unchanged.

### Corrections made (source that decided it)
1. **skills CLI target count 78 -> 79** and **npm 1.5.26 -> 1.6.0 (2026-09-17)**. README line 6: "Supports OpenCode, Claude Code, Codex, Cursor, and 75 more"; 79 `--agent` keys counted in the raw table. All `-a` names claimed by the researcher exist in the table.
2. **Amp `@sourcegraph/amp` "alias until 2026-06-15 (already past)"** -> still published on 2026-09-17 at the identical version as `@ampcode/cli` (registry.npmjs.org). The June date is the announced plan, not observed reality.
3. **Antigravity CLI update "not documented"** -> install.sh literally prints "The Antigravity CLI automatically self-updates in the background during regular runs"; CHANGELOG references the "background auto-updater". `agy update` appears only in third-party blogs (not in README/CHANGELOG/docs) — left as medium-confidence note, not a command.
4. **Droid update "not documented"** -> `droid update` ("Manually update the CLI to latest version") + auto-update, opt-out `FACTORY_DROID_AUTO_UPDATE_ENABLED=false` (docs.factory.ai/reference/cli-reference). npm droid is now 0.221.0 (2026-09-17). `droid mcp add <name> <urlOrCommand> --type stdio|http|sse` re-confirmed (reference examples: `droid mcp add api https://api.example.com/mcp --type http`, `droid mcp add gh "gh-mcp" --type stdio --env GH_TOKEN=$GH_TOKEN`).
5. **Devin update "/update in-app"** -> top-level `devin update` / `devin update --force` exists (docs.devin.ai/cli/reference/commands.md); `/update [--force]` also exists as a slash command. Both kept.
6. **Hermes reads `~/.agents/skills`** -> only when `skills.external_dirs: [~/.agents/skills]` is set in `~/.hermes/config.yaml` (website/docs/user-guide/features/skills.md "External Skill Directories"). Default is `~/.hermes/skills/` only. Section 3 table updated.
7. **Copilot latest release** v1.0.86-1 -> v1.0.86-2 (2026-09-17). npm still 1.0.85.
8. **OpenHands repo** `All-Hands-AI/OpenHands` -> redirects to `OpenHands/OpenHands` (org rename); item URL updated in JSON.
9. **Cline install** normalised to the documented `npm i -g cline` (cli/overview.md); `cline update` confirmed in cli-reference.md.
10. **Jules install** `npm i @google/jules` -> `npm install -g @google/jules` (Jules changelog 2025-10-02 entry).
11. **OpenCode "native Windows"** qualified: docs say "For the best experience on Windows, we recommend using WSL" and "Support for installing OpenCode on Windows using Bun is currently in progress", while still listing `choco install opencode` / `scoop install opencode`. Verdict unchanged (must-have) but platform note now says "Windows via choco/scoop (WSL recommended by docs)".
12. **DeepSeek Harness README** is on branch `master`, not `main` (raw main URL 404s). Releases: v0.1.6-alpha.1 (2026-09-15), v0.1.5-rc.2 and rc.1 (2026-09-10), all pre-releases. README contains no skills/MCP/AGENTS.md path docs (open question stands).
13. **Ollama last_activity** filled in: v0.34.2 (2026-09-15).
14. **Roo Code**: GitHub API shows `archived: true` — stronger evidence than the README for "deprecated".
15. **Hermes release naming**: GitHub release is "Hermes Agent v0.21.3 (v2026.9.14)" on 2026-09-14 — the tag is v2026.9.14 as stated, but the semantic version is 0.21.3.

### Could not confirm (confidence lowered, kept)
- Vibe "Windows via uv" instructions: README line 25 says "Mistral Vibe works on Windows, but we officially support and target UNIX environments" and has a Windows section; the exact `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"` line is the standard uv installer, not quoted from the Vibe README — marked medium.
- Kilo skills directories still not documented on the fetched page (only `~/.config/kilo/kilo.json[c]`); the skills CLI maps `kilo` to `.agents/skills/` + `~/.kilo/skills/`.
- Cursor / Warp version numbers: closed source, none published on the fetched pages.
- CodeBuddy: npm metadata points to `https://cnb.cool/codebuddy/codebuddy-code` (not GitHub); install command is from the npm listing only.

### Removed
- None. Every repo/package/doc URL cited resolved (after the two path fixes above: OpenHands org rename and dsh `master` branch).
