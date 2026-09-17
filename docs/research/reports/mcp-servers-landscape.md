# MCP servers landscape (as of 2026-09-16/17) for a Claude Code + Codex CLI workstation

Research for the "ultimate AI coding agent installer". Read-only research. Popularity numbers were observed on 2026-09-16 (first pass) and re-verified on 2026-09-17 (GitHub API / shields.io, api.npmjs.org, pypi.org); where the two passes differed the 2026-09-17 value is shown. Commands are copied from the fetched source named in the row; commands that were assembled from the documented CLI syntax of `claude mcp add` / `codex mcp add` (section 1) are marked **[composed]**.

Local reference environment: Claude Code 2.1.273 (native), Codex CLI 0.154.0, Node 22.22.1, npm 9.2.0, bun 1.4.2, Python 3.14.4, no `uv`, no `pwsh`, `gh` 2.46 (token currently invalid).

---

## 0. Key takeaways

1. **Both hosts have the same install surface.** stdio servers (`npx` / `uvx` / `docker run`) and remote Streamable HTTP servers with OAuth or bearer headers. Claude Code: `claude mcp add --transport http <name> <url> [--header ...]`, then `/mcp` or `claude mcp login <name>`. Codex: `codex mcp add <name> --url <url> [--bearer-token-env-var VAR]`, then `codex mcp login <name>`. Every relevant vendor now publishes a remote HTTP endpoint (GitHub, Notion, Linear, Atlassian, Slack, Sentry, Stripe, Vercel, Supabase, Figma, Cloudflare, Context7, Exa, Tavily, Firecrawl, Perplexity, AWS Knowledge, Home Assistant). Prefer remote HTTP for SaaS: no local runtime, no `npx` on Windows, OAuth handled by the host.
2. **Token overhead: Claude Code defers every MCP tool; Codex defers nothing.** Claude Code docs (fetched 2026-09-17): tool search is on by default and with `ENABLE_TOOL_SEARCH` unset "All MCP tools deferred and loaded on demand"; values `true | auto | auto:N | false`; per-server `"alwaysLoad": true` (available on all server types) opts a server out. The earlier claim that stdio servers are "always loaded" is **not** in the current doc, and this research session empirically confirms deferral for stdio servers on 2.1.273 (the local stdio servers `caveman` and `fli` show up as deferred `mcp__caveman__*` / `mcp__fli__*` placeholders). Requires Claude 4.5+ models; disabled with a non-first-party `ANTHROPIC_BASE_URL`, on Azure Foundry, or with `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`. Codex CLI has **no** tool-search or lazy loading; levers are `enabled_tools` / `disabled_tools`, `enabled = false`, `tools.<tool>.output_token_limit`, and vendor flags (`--slim`, `--read-only`, `?features=`, `X-MCP-Toolsets`). So the Codex global set must stay leaner than the Claude one.
3. **Large redundancies vs built-ins:** filesystem, git, time, fetch, desktop-commander, memory, sequential-thinking are superseded on Claude Code (Bash/Read/Edit/Glob/Grep, WebFetch/WebSearch, extended thinking, `remember` plugin). Codex: `web_search` (top-level key; `"cached"` default, `"live"` for fresh results) covers search; a keyless search+fetch MCP (Exa remote or DuckDuckGo) is still useful for Codex when arbitrary page reading is needed. Browser: Claude Code has built-in `claude --chrome` (Chrome extension + Pro/Max/Team/Enterprise login, not WSL, not API-key auth). Codex Browser Use / Computer Use / Chrome extension are Codex **app** features: the official Browser page states "Browser isn't available in Codex CLI or the Codex IDE extension" (learn.chatgpt.com/codex/browser, verified 2026-09-17); a ChatGPT/Codex desktop app for Linux now exists in preview (Ubuntu 24.04/26.04, Debian 13, Fedora 43/44, Arch; x64+ARM64; `.deb`/`.rpm`/Arch script) with the Chrome extension listed as a next step but Computer Use "not yet in the Linux preview". Issues openai/codex#22164 and #26820 ("CLI cannot acquire Chrome extension backend while Codex app UI works") corroborate: Codex **CLI** users still need Playwright MCP/CLI or chrome-devtools-mcp.
4. **Anthropic official marketplace = 305 plugins on 2026-09-17**, of which the relevant MCP-bundling ones are: `context7` (remote HTTP `https://mcp.context7.com/mcp?client=claude-code-plugin`, header `Authorization: ${CONTEXT7_API_KEY:-}`), `playwright` (`npx @playwright/mcp@latest`), `github` (remote, `Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}`), `linear` (remote), `serena` (`uvx --from git+https://github.com/oraios/serena serena start-mcp-server`), `chrome-devtools-mcp`, `exa`, `sentry`, `notion`, `figma`, `slack`, `stripe`, `supabase`, `vercel`, `grafana-mcp`, `grafana-cloud-mcp`, `atlassian`, `gitlab`, `datadog`, `browser-use`, `firecrawl`, `cloudflare`, `aws-core`, `bigquery-data-analytics`, `alloydb`, `google-cloud-storage`, `cloud-sql-postgresql`, `mongodb`, `mongodb-atlas`, `neon`, `redis-development`, `terraform`, `tavily`, `semgrep`, `zapier`, `vanta-mcp-plugin`. For Claude Code, the plugin is the maintained path (user already has `context7` and `playwright` this way). For Codex use `codex mcp add` / config.toml; Codex's own plugin marketplace has Context7 and Figma, plus OpenAI-curated Gmail/Google Drive/Slack/Notion/Figma plugins (`/plugins`; official page learn.chatgpt.com/codex/plugins: "Codex CLI also has a plugin browser for Codex environments. The IDE extension doesn't support plugins"; some are unavailable with API-key auth), which are the Codex equivalent of the claude.ai connectors.
5. **Multi-host installers exist:** `npx -y add-mcp <url> -g` (v2.4.0, 113,044 dl/wk) detects installed clients; `npx ctx7 setup --claude|--codex` (ctx7 0.5.11, 34,798 dl/wk); `stripe agent setup`; `docker mcp client connect claude-code|codex --global`; `npx -y snyk@latest mcp configure --tool=claude-cli`. Useful building blocks, but the script should write its own idempotent config for reproducibility.
6. **Windows:** stdio `npx` servers need `cmd /c npx ...` on native Windows for both hosts (chrome-devtools docs for Codex: `command = "cmd"`, `args = ["/c","npx","-y","chrome-devtools-mcp@latest"]`, `env = { SystemRoot="C:\\Windows", PROGRAMFILES="C:\\Program Files" }`, `startup_timeout_ms = 20_000`). **Claude Code bug:** `claude mcp add ... -- cmd /c npx` mangles `/c` into `C:/` (issues #4158, #20061, #36808, #46360; #46360 closed "not planned"); the current MCP doc no longer documents the wrapper at all. On Windows the installer must write the JSON itself (`claude mcp add-json <name> '{"type":"stdio","command":"cmd","args":["/c","npx","-y","<pkg>"]}'` or edit `~/.claude.json`) instead of `claude mcp add`. Caveat from #46360 itself: the reporter found that even a hand-written `cmd /c npx` entry broke stdio pipes on Windows 11 and the working fallback was `"command": "node", "args": ["<path>/node_modules/@playwright/mcp/cli.js", ...]` after `npm add -D @playwright/mcp`; so the installer should offer a `node <cli.js>` (or globally installed binary) fallback on native Windows. Remote HTTP servers need no wrapper, another reason to prefer them.
7. **Codex `[mcp_servers]` timeout keys resolved:** the config reference documents both `startup_timeout_sec` (default 10 s) and `startup_timeout_ms` ("Alias for startup_timeout_sec in milliseconds"), plus `tool_timeout_sec` (60 s), `mcp_optional_startup_grace_ms` (1000), `required`, `enabled`, `enabled_tools`, `disabled_tools`, `default_tools_approval_mode`, `tools.<tool>.approval_mode`, `tools.<tool>.output_token_limit`, `http_headers`, `env_http_headers`, `http_headers_helper`, `bearer_token_env_var`, `auth = oauth|chatgpt`, `oauth.client_id`, `oauth.callback_port`, `oauth_resource`, `scopes`, `env`, `env_vars`, `cwd`.
8. **Proxmox/homelab servers are immature:** no official Proxmox server; best candidate ProxmoxMCP-Plus (538 stars, PyPI `proxmox-mcp-plus` 0.5.18 released 2026-09-16, `uvx proxmox-mcp-plus`); canvrno/ProxmoxMCP (292 stars) has not been pushed since 2025-02-19. Home Assistant ships a **native** MCP server (HA 2025.2+, Streamable HTTP at `/api/mcp`, OAuth or long-lived token) which both hosts can consume directly as an HTTP server with a bearer header (no `mcp-proxy` needed). Kubernetes: containers/kubernetes-mcp-server (Red Hat, 2,098 stars, `--read-only`). Docker MCP Gateway v0.43.3 (2026-07-16) ships `docker-mcp-linux-{amd64,arm64}.tar.gz`, `docker-mcp-windows-{amd64,arm64}.tar.gz`, `docker-mcp-darwin-*.tar.gz` and registers itself into both hosts (`docker mcp client connect` supports claude-code, claude-desktop, cline, codex, continue, crush, cursor, gemini, goose, gordon, kiro, lmstudio, opencode, sema4, vscode, zed per docs.docker.com; flags `-g/--global`, `-p/--profile`).
9. **2026 breakouts worth noting:** chrome-devtools-mcp (52,136 stars, 1.5M dl/wk, launched late 2025), Context7 (62,095 stars, 1.13M dl/wk), Playwright CLI with skills (`@playwright/cli` 0.1.20, 675,949 dl/wk, 13k stars, a token-cheaper alternative to Playwright MCP), Serena (29,475 stars), n8n-mcp (22,903), Browser Use plugin (115k-star project), Cloudflare's 13-17 remote servers, official Slack remote MCP (GA 2026), Codex OpenAI-curated plugins (Gmail/Drive/Slack/Notion, 2026-03). Other large repos that appear in "top MCP" lists but are frameworks/products rather than servers to install here: markitdown (185k; `markitdown-mcp`), netdata (81k, ships an MCP server), mindsdb (40k), fastmcp (28k, framework), mem0 (65k).

---

## 1. Host mechanics (primary sources: code.claude.com/docs/en/mcp.md, learn.chatgpt.com config reference, local `--help`)

### 1.1 Claude Code 2.1.273

```
Usage: claude mcp add [options] <name> <commandOrUrl> [args...]
  -s, --scope <scope>          local | user | project   (default: "local")
  -t, --transport <transport>  stdio | sse | http        (default stdio; sse deprecated; ws only via JSON)
  -e, --env <env...>           -e KEY=value
  -H, --header <header...>     -H "X-Api-Key: abc123"
  --client-id / --client-secret / --callback-port   (pre-registered OAuth)
Examples from --help:
  claude mcp add --transport http sentry https://mcp.sentry.dev/mcp
  claude mcp add --transport http corridor https://app.corridor.dev/api/mcp --header "Authorization: Bearer ..."
  claude mcp add my-server -e API_KEY=xxx -- npx my-mcp-server
Other: claude mcp add-json <name> '<json>' | list | get | remove [--scope] | login <name> [--no-browser] | logout | reset-project-choices | add-from-claude-desktop (macOS/WSL only)
```

* Config: user scope = `~/.claude.json` top-level `mcpServers`; local scope = `~/.claude.json` under `projects.<path>.mcpServers`; project scope = `.mcp.json`. Precedence (highest first): managed `managedMcpServers` (v2.1.259+) > local > project > user > plugin servers > claude.ai connectors. "The entire server entry from that source is used; fields are not merged across scopes."
* `${VAR}` / `${VAR:-default}` expansion in `.mcp.json` and plugin `.mcp.json`; missing vars produce a warning. Reserved names: `workspace`, `claude-in-chrome`, `computer-use`, `Claude Preview`, `Claude Browser`.
* Tool search: default on; `ENABLE_TOOL_SEARCH` = unset/`true` (all MCP tools deferred), `auto` (defer once definitions reach 10% of context), `auto:N`, `false` (all loaded upfront). `alwaysLoad: true` per server or `"anthropic/alwaysLoad": true` per tool in `_meta`. "Claude Code doesn't impose a fixed per-server tool cap; the practical limit is your context window budget." Tool descriptions and server instructions are truncated at 2 KB. With tool search, waiting for a still-connecting server happens inside the `ToolSearch` call; without it via `WaitForMcpServers`.
* Env: `MCP_TIMEOUT` (startup ms), `MAX_MCP_OUTPUT_TOKENS` (default 25,000; warning at 10,000), `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (5 min network / 30 min stdio; v2.1.187+), `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (2 min default; `0` disables), `MCP_DISCOVERY_CACHE=1|0` (off by default since v2.1.238 unless rollout-enabled; `cached` status means tools loaded from cache and the server connects lazily), `MCP_CONNECTION_NONBLOCKING=0`. Per-server `timeout` (ms) in JSON. `headersHelper` for dynamic headers.
* Built-in browser: `claude --chrome` / `/chrome` (claude-in-chrome MCP; Chrome extension; Pro/Max/Team/Enterprise `/login`; not WSL, not API-key/Bedrock/Vertex/Foundry). Docs warn browser tools are always loaded when enabled.
* Windows: see takeaway 6 (write JSON with `command: "cmd"`, `args: ["/c","npx",...]`; do not rely on `claude mcp add` for `cmd /c`).

### 1.2 Codex CLI 0.154.0

```
Usage: codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)
  --env <KEY=VALUE>                  (stdio only)
  --url <URL>                        streamable HTTP
  --bearer-token-env-var <ENV_VAR>   (HTTP only)
  --oauth-client-id / --oauth-client-registration <auto|cimd|dcr> / --oauth-resource
  -c key=value                       config override; --enable/--disable <feature>
Other: codex mcp list | get | remove | login <name> | logout
Doc examples: codex mcp add context7 -- npx -y @upstash/context7-mcp ; codex mcp add <server-name> --url https://mcp.example.com ; codex mcp login <server-name>
```

config.toml (`~/.codex/config.toml`; project `.codex/config.toml` only in trusted projects). Keys from the config reference (learn.chatgpt.com/docs/config-file/config-reference, fetched 2026-09-17):

```toml
[mcp_servers.<id>]                 # stdio
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
cwd = "/optional/path"
env = { KEY = "value" }            # forwarded env
env_vars = ["LOCAL_TOKEN"]         # whitelist pass-through from parent env
startup_timeout_sec = 10           # default 10; startup_timeout_ms is a documented alias
tool_timeout_sec = 60              # default 60
enabled = true                     # false disables without removing
required = false                   # true = fail startup if server can't init
enabled_tools = ["a","b"]          # allow list
disabled_tools = ["c"]             # deny list applied after enabled_tools
default_tools_approval_mode = "auto"   # auto | prompt | writes | approve
[mcp_servers.<id>.tools.<tool>]
approval_mode = "prompt"
output_token_limit = 4000

[mcp_servers.<id2>]                # streamable HTTP
url = "https://mcp.example.com/mcp"
bearer_token_env_var = "MY_TOKEN"
http_headers = { "X-Header" = "value" }
env_http_headers = { "X-Auth" = "ENV_VAR_NAME" }
http_headers_helper = "cmd-that-prints-json"   # local HTTP servers only
auth = "oauth"                     # oauth (default) | chatgpt
oauth_resource = "..."
scopes = ["..."]
[mcp_servers.<id2>.oauth]
client_id = "..."
callback_port = 8080
callback_url = "..."
```

Global: `mcp_oauth_callback_port`, `mcp_oauth_callback_url`, `mcp_oauth_credentials_store = auto|file|keyring`, `mcp_optional_startup_grace_ms` (1000). No CLI flag for arbitrary headers, so Context7 API keys go into `http_headers` (or `env_http_headers`) by editing TOML. `web_search = "cached" | "indexed" | "live" | "disabled"` (top-level; `features.web_search*` are deprecated aliases). `features.skill_mcp_dependency_install` (stable, on) lets skills prompt to install missing MCP dependencies. `memories.disable_on_external_context` keeps MCP-using threads out of memory generation.

### 1.3 Directories and ecosystem size

| Directory | Size (2026-09-16) | Top by popularity |
|---|---|---|
| PulseMCP | 21,921 servers | Playwright (5.5m est. visitors/wk), Chrome DevTools 2.3m, Storybook 2.3m, Context7 1.4m, Browser Use 1.1m, Filesystem 974k, AWS Docs 252k, Sequential Thinking 203k, Memory 189k, Notion 180k, Desktop Commander 173k, n8n 154k, Exa 149k, Figma 141k, Grafana 140k, Time 138k, Supabase 133k, GitHub 128k, Linear 118k, PostgreSQL 117k, Fetch 101k, GitMCP 100k, Stripe 100k |
| Smithery | "Browse 21,192+ MCPs" | Exa 9.18k uses, Context7 5.56k uses |
| Glama | 88,324 servers | not popularity-sorted |
| mcp.so | not stated | featured list only |
| mcpmanager.ai "50 most popular" (search volume, 2026-03) | 50 | Playwright 82k, Figma 74k, GitHub 69k, Jira/Atlassian 40k, Context7 32k, Supabase 26k, Notion 23k, Serena 19k, Slack 17.7k, AWS 16k, Azure 13k, Sequential Thinking 13k, Zapier 10.8k, Linear 10.6k, Docker 10.3k, GitLab 9.7k, Obsidian 8.1k, Postgres 7.9k, Firecrawl 7.2k, Datadog 6.9k, Grafana 6.1k, ... Kubernetes 2.1k, Desktop Commander 1.9k |
| awesome-mcp.tools top-by-stars (2026-05-01) | 10 | markitdown 119k, mcp/servers 84k, netdata 78k, context7 54k, mindsdb 39k, playwright-mcp 31k, UI-TARS 29k, github-mcp-server 29k, task-master 26k, fastmcp 24k |
| Official MCP Registry | registry.modelcontextprotocol.io (repo 7.3k stars) | |
| punkpeye/awesome-mcp-servers | 95,095 stars, pushed 2026-09-15 | |
| modelcontextprotocol/servers | 90,392 stars, pushed 2026-09-03 | 7 reference servers |
| Anthropic official plugin marketplace | 305 plugins (marketplace.json, 2026-09-17) | |
| Docker MCP Catalog | docker/mcp-registry 554 stars; docker/mcp-gateway 1,567 | |

Reference servers still maintained (7): everything, fetch, filesystem, git, memory, sequential-thinking, time (npm `2026.8.31`, PyPI `2026.8.18`). **Archived (12, in modelcontextprotocol/servers-archived):** sqlite, postgres, puppeteer, brave-search, github, gitlab, slack, google-drive, google-maps, sentry, everart, aws-kb-retrieval. Their npm packages still get downloads (server-github 89,959/wk, server-slack 98,707/wk, server-postgres 78,432/wk on 2026-09-16) but must not be installed; use vendor-official replacements.

---

## 2. Server-by-server catalogue

Legend: stars = GitHub stargazers (api.github.com or shields.io, 2026-09-17); dl/wk = npm downloads last 7 days (2026-09-17); "Claude" = user-scope command; "Codex" = command or config.toml. Tool counts are from the server's own README/docs.

### 2.1 Developer core

| # | Server | Transport / auth | Popularity | Tools | Claude Code | Codex | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **Context7** (Upstash) | remote HTTP `https://mcp.context7.com/mcp`; key optional (higher limits) via header `Authorization: Bearer <key>` (context7.com/docs/resources/all-clients, verified 2026-09-17); stdio `npx -y @upstash/context7-mcp` | 62,095 stars, pushed 2026-09-16; npm 4.1.1, 1,132,952 dl/wk; PulseMCP 1.4m/wk; Smithery 5.56k uses | 2 (`resolve-library-id`, `query-docs`) | `claude mcp add --scope user --header "Authorization: Bearer YOUR_API_KEY" --transport http context7 https://mcp.context7.com/mcp` or `claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp --api-key YOUR_API_KEY`; official plugin `context7@claude-plugins-official` (remote HTTP, reads `CONTEXT7_API_KEY` env, already installed) | `codex mcp add context7 -- npx -y @upstash/context7-mcp --api-key YOUR_API_KEY`; remote: `[mcp_servers.context7]`/`url = "https://mcp.context7.com/mcp"`/`http_headers = { "Authorization" = "Bearer YOUR_API_KEY" }`; or `npx ctx7 setup --codex`; plugin: `codex plugin marketplace add upstash/context7` + `codex plugin add context7@context7-marketplace` | **must-have** (both) |
| 2 | **Playwright MCP** (Microsoft) | stdio `npx @playwright/mcp@latest`; no auth; Node 18+ | 37,180 stars, pushed 2026-09-14; npm 0.0.81, 4,633,135 dl/wk; PulseMCP #1 | 29 core; opt-in `--caps=config,network,storage,devtools,vision,pdf,testing` | `claude mcp add playwright npx @playwright/mcp@latest` (user has official `playwright` plugin: `npx @playwright/mcp@latest`) | `codex mcp add playwright npx "@playwright/mcp@latest"` or `[mcp_servers.playwright]`/`command = "npx"`/`args = ["@playwright/mcp@latest"]` | **must-have for Codex on Linux; recommended on Claude** (`--chrome` can replace it there) |
| 2b | **Playwright CLI with skills** (microsoft/playwright-cli) | CLI, not MCP; skills teach the agent the commands | 13k stars; npm `@playwright/cli` 0.1.20, 675,949 dl/wk | 0 MCP tools (CLI via Bash) | `npm install -g @playwright/cli@latest` then `playwright-cli install --skills` | same (skills dir); README positions it as more token-efficient than MCP | **recommended alternative** to Playwright MCP for Codex (no schema cost) |
| 3 | **chrome-devtools-mcp** (Google) | stdio `npx -y chrome-devtools-mcp@latest`; no auth; Node LTS + Chrome stable | 52,136 stars, pushed 2026-09-16; npm 1.9.0, 1,516,489 dl/wk; PulseMCP #2 | 58 (`--slim` for basic set) | `claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest`; official plugin `chrome-devtools-mcp` | `codex mcp add chrome-devtools -- npx chrome-devtools-mcp@latest`; Windows 11 TOML: `command = "cmd"`, `args = ["/c","npx","-y","chrome-devtools-mcp@latest"]`, `env = { SystemRoot="C:\\Windows", PROGRAMFILES="C:\\Program Files" }`, `startup_timeout_ms = 20_000` | **optional** (one browser server per host; use for perf traces/heap/Lighthouse; add `--slim`) |
| 4 | **GitHub MCP (official remote)** | remote HTTP `https://api.githubcopilot.com/mcp/`; OAuth or PAT; variants `/readonly`, `/insiders`, `/x/{toolset}` (e.g. `/x/repos`, `/x/issues`, `/x/pull_requests`, `/x/all`), headers `X-MCP-Toolsets: repos,issues`, `X-MCP-Readonly`; local `ghcr.io/github/github-mcp-server` | 32,977 stars, pushed 2026-09-16; PulseMCP 128k/wk | 60+ across 20+ toolsets; default `context, repos, issues, pull_requests, users` | `claude mcp add --transport http github https://api.githubcopilot.com/mcp/ --header "Authorization: Bearer YOUR_GITHUB_PAT"`; official plugin `github` (needs `GITHUB_PERSONAL_ACCESS_TOKEN` env) | `codex mcp add github --url https://api.githubcopilot.com/mcp/ --bearer-token-env-var GITHUB_PAT_TOKEN` or `[mcp_servers.github]`/`url = "https://api.githubcopilot.com/mcp/"`/`bearer_token_env_var = "GITHUB_PAT_TOKEN"` | **recommended** with `/readonly` or `X-MCP-Toolsets`; `gh` CLI covers writes |
| 5 | **Serena** (oraios) | stdio `serena start-mcp-server` (uv tool) or `uvx --from git+https://github.com/oraios/serena serena start-mcp-server`; no auth | 29,475 stars, pushed 2026-09-16; PyPI serena-agent 1.7.0 (2026-08-09) | LSP-backed symbol tools, 40+ languages | `uv tool install -p 3.13 serena-agent` then `serena setup claude-code` or `claude mcp add --scope user serena -- serena start-mcp-server --context claude-code --project-from-cwd`; official plugin `serena` (uvx from git) | `serena setup codex` or `[mcp_servers.serena]`/`startup_timeout_sec = 15`/`command = "serena"`/`args = ["start-mcp-server", "--project-from-cwd", "--context=codex"]` | **optional** on Claude (overlaps typescript/pyright/gopls LSP plugins); **recommended on Codex** |
| 6 | **Exa** | remote HTTP `https://mcp.exa.ai/mcp` (anonymous with rate limits; key via `?exaApiKey=`, Bearer or `x-api-key`; `?tools=`); stdio `npx -y exa-mcp-server` | 5,013 stars, pushed 2026-08-21; npm 3.4.1, 79,339 dl/wk; Smithery #1 | 2 default (`web_search_exa`, `web_fetch_exa`) + 2 optional | `claude plugin install exa@claude-plugins-official` | `codex mcp add exa --url https://mcp.exa.ai/mcp` | **recommended for Codex**, optional on Claude |
| 7 | **Tavily** | remote `https://mcp.tavily.com/mcp/?tavilyApiKey=<key>` or OAuth; stdio `npx -y tavily-mcp@latest` (TAVILY_API_KEY) | 2.4k stars; npm 0.2.22, 15,779 dl/wk | 4 | `claude mcp add --transport http tavily https://mcp.tavily.com/mcp/?tavilyApiKey=<your-api-key>`; official plugin `tavily` (skills) | `codex mcp add tavily --url "https://mcp.tavily.com/mcp/?tavilyApiKey=<key>"` **[composed]** | optional (API key) |
| 8 | **Brave Search** | stdio `npx -y @brave/brave-search-mcp-server` (BRAVE_API_KEY) or `docker run -i --rm -e BRAVE_API_KEY docker.io/mcp/brave-search` | 1.4k stars; npm 2.1.3, 10,280 dl/wk | 9 | `claude mcp add brave -e BRAVE_API_KEY=... -- npx -y @brave/brave-search-mcp-server` **[composed]** | `codex mcp add brave --env BRAVE_API_KEY=... -- npx -y @brave/brave-search-mcp-server` **[composed]** | optional |
| 9 | **Perplexity** | remote `https://api.perplexity.ai/mcp`; stdio `npx -y @perplexity-ai/mcp-server` (PERPLEXITY_API_KEY, paid) | 2.5k stars; npm 1.2.1, 30,284 dl/wk | 4 (search, ask, research, reason) | `claude mcp add perplexity --env PERPLEXITY_API_KEY="your_key_here" -- npx -y @perplexity-ai/mcp-server` | `codex mcp add perplexity --env PERPLEXITY_API_KEY="your_key_here" -- npx -y @perplexity-ai/mcp-server` (README) | optional |
| 10 | **DuckDuckGo** (nickclyde) | stdio `uvx duckduckgo-mcp-server`; keyless | 1.5k stars; PyPI 0.7.0 (2026-09-04) | search + fetch | `claude mcp add ddg-search uvx duckduckgo-mcp-server` (README) | `codex mcp add ddg-search -- uvx duckduckgo-mcp-server` **[composed]** | optional keyless fallback for Codex |
| 11 | **Firecrawl** | hosted keyless `https://mcp.firecrawl.dev/v2/mcp`; stdio `env FIRECRAWL_API_KEY=fc-YOUR_API_KEY npx -y firecrawl-mcp` | 7.5k stars; npm 3.24.0, 27,437 dl/wk | 25 with full local profile; hosted keyless `/v2/mcp` exposes only 3 (`firecrawl_scrape`, `firecrawl_search`, `firecrawl_parse`); `/v2/mcp-search` 6 read-only | official plugin `firecrawl` (skills); `claude mcp add --transport http firecrawl https://mcp.firecrawl.dev/v2/mcp` **[composed]** | `codex mcp add firecrawl --url https://mcp.firecrawl.dev/v2/mcp` **[composed]** | optional (only if crawling regularly) |
| 12 | **Sentry** | remote `https://mcp.sentry.dev/mcp`, OAuth; stdio `@sentry/mcp-server` | 854 stars; npm 0.39.0, 83,341 dl/wk | n/a | `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp` (from `claude mcp add --help`) then `/mcp`; official plugin `sentry` | `codex mcp add sentry --url https://mcp.sentry.dev/mcp` + `codex mcp login sentry` **[composed]** (Codex docs list Sentry as an example) | optional |
| 13 | **DBHub** (Bytebase) | stdio `npx -y @bytebase/dbhub --dsn ...`; Postgres/MySQL/SQL Server/MariaDB/SQLite; `--readonly` | 3,527 stars, pushed 2026-09-16; npm 1.2.5, 15,799 dl/wk | 2 default | `claude mcp add --transport stdio db -- npx -y @bytebase/dbhub --dsn "postgresql://readonly:pass@prod.db.com:5432/analytics"` (Claude docs) | `codex mcp add db -- npx -y @bytebase/dbhub --dsn "..."` **[composed]** | optional (project scope) |
| 14 | Postgres MCP Pro (crystaldba) | stdio (uvx/docker); PyPI postgres-mcp 0.3.0 (2025-05-16, stale) | 3.3k stars | index/health tuning | see repo | see repo | optional / aging |
| 15 | **Supabase** | remote `https://mcp.supabase.com/mcp?project_ref=<id>&read_only=true&features=<groups>`; OAuth DCR or PAT | 2.9k stars; npm 0.12.0, 83,962 dl/wk | 26 in 8 groups | `claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp"`; official plugin `supabase` | `codex mcp add supabase --url "https://mcp.supabase.com/mcp"` then `codex mcp login supabase` (Supabase docs); append `?read_only=true` **[composed]** | optional (project scope) |
| 16 | **Vercel** | remote `https://mcp.vercel.com`, OAuth | closed source | docs/projects/deployments | `claude mcp add --transport http vercel https://mcp.vercel.com` then `/mcp`; `npx -y add-mcp https://mcp.vercel.com -g`; official plugin `vercel` | `codex mcp add vercel --url https://mcp.vercel.com` | optional |
| 17 | **Cloudflare** | 17 remote servers (developers.cloudflare.com list), e.g. `https://mcp.cloudflare.com/mcp`, `https://docs.mcp.cloudflare.com/mcp`, `https://bindings.mcp.cloudflare.com/mcp`, `https://observability.mcp.cloudflare.com/mcp`, `https://browser.mcp.cloudflare.com/mcp`; OAuth | 4.2k stars | per server | `claude mcp add --transport http cloudflare-docs https://docs.mcp.cloudflare.com/mcp` **[composed]**; official plugin `cloudflare` | `codex mcp add cloudflare-docs --url https://docs.mcp.cloudflare.com/mcp` **[composed]** | optional |
| 18 | **Figma** | remote `https://mcp.figma.com/mcp` (OAuth); desktop `http://127.0.0.1:3845/mcp` (Dev/Full seat) | community GLips/Figma-Context-MCP 16k stars, npm figma-developer-mcp 0.13.2, 55,619 dl/wk | code/design context | `claude plugin install figma@claude-plugins-official` or `claude mcp add --scope user --transport http figma https://mcp.figma.com/mcp` (Figma docs) | `codex mcp add figma --url https://mcp.figma.com/mcp` (Figma docs) | optional |
| 19 | **Notion** | remote `https://mcp.notion.com/mcp`, OAuth (`claude mcp add --transport http notion https://mcp.notion.com/mcp` is the Claude docs example); local `@notionhq/notion-mcp-server` deprecated by Notion | 4.6k stars; npm 2.5.1, 122,532 dl/wk | n/a | as left; official plugin `notion` | `codex mcp add notion --url https://mcp.notion.com/mcp` **[composed]**; Codex OpenAI-curated Notion plugin | optional |
| 20 | **Linear** | remote `https://mcp.linear.app/mcp`, `/mcp/readonly`; OAuth 2.1 DCR or API key | closed source; PulseMCP 118k/wk | issues/projects | `claude mcp add --transport http linear-server https://mcp.linear.app/mcp`; official plugin `linear` (remote) | `codex mcp add linear --url https://mcp.linear.app/mcp` then `codex mcp login linear` | optional |
| 21 | **Atlassian (Jira/Confluence) Rovo** | remote `https://mcp.atlassian.com/v2/mcp`; OAuth 2.1 or API token | atlassian/atlassian-mcp-server 1.1k; community sooperset/mcp-atlassian 5.9k (PyPI mcp-atlassian 0.23.1, 2026-08-19; Server/DC) | n/a | `claude mcp add --transport http atlassian https://mcp.atlassian.com/v2/mcp`; official plugin `atlassian` | `codex mcp add atlassian --url https://mcp.atlassian.com/v2/mcp` (Atlassian docs) | optional |
| 22 | **Slack (official)** | remote `https://mcp.slack.com/mcp`, Streamable HTTP, confidential OAuth 2.0; **docs: "We do not support SSE-based connections or Dynamic Client Registration"**; supported clients listed: Claude.ai, Claude Code, Perplexity, Cursor (Codex not listed); admin approval; unlisted apps prohibited | slackapi/slack-mcp-plugin 132 stars | ~20+ | official plugin `slack`; `claude mcp add --transport http slack https://mcp.slack.com/mcp` **[composed]** | not in Slack's supported list; Codex: `codex plugin marketplace add slackapi/slack-skills-plugin` + `codex plugin add slack@slack` (skills only, README: "the MCP server is not yet wired into the Codex surface"), or the OpenAI-curated Slack plugin | optional; on Codex use the Codex plugin |
| 23 | **Stripe** | remote `https://mcp.stripe.com` OAuth or restricted key; `stripe agent setup` | stripe/agent-toolkit 1.8k; npm @stripe/mcp 0.3.3, 11,157 dl/wk | 10 | `claude mcp add --transport http stripe https://mcp.stripe.com/`; official plugin `stripe` | `[mcp_servers.stripe]`/`url = "https://mcp.stripe.com"` + `codex mcp login stripe`, or `bearer_token_env_var = "STRIPE_API_KEY"` | skip unless Stripe user |
| 24 | **AWS** | 60+ servers in awslabs/mcp; `uvx awslabs.aws-documentation-mcp-server@latest` (PyPI 1.2.1, 2026-09-08), `uvx awslabs.aws-api-mcp-server@latest` (1.5.5); managed remote AWS Knowledge `https://knowledge-mcp.global.api.aws` | 9.7k stars; PulseMCP AWS Docs 252k/wk | varies | official plugins `aws-core`; `claude mcp add --transport http aws-knowledge https://knowledge-mcp.global.api.aws` **[composed]** | `codex mcp add aws-knowledge --url https://knowledge-mcp.global.api.aws` **[composed]** | optional |
| 25 | **Azure** | stdio `npx -y @azure/mcp@latest server start` (`--mode namespace` (default per learn.microsoft.com; also `consolidated|all|single`), `--read-only`); `uvx --from msmcp-azure azmcp server start` (PyPI 2.0.5); `az login` | microsoft/mcp 3.7k; npm @azure/mcp 3.0.0-beta.44, 104,158 dl/wk | 45+ service areas | `claude mcp add azure -- npx -y @azure/mcp@latest server start --mode namespace --read-only` **[composed]** | `codex mcp add azure -- npx -y @azure/mcp@latest server start` **[composed]** | optional |
| 26 | **GCP** | googleapis/genai-toolbox (MCP Toolbox for Databases) 16k stars; official plugins `bigquery-data-analytics`, `alloydb`, `google-cloud-storage`, `cloud-sql-postgresql` | 16k | varies | plugins | see repo | optional |
| 27 | **Terraform** (HashiCorp) | stdio `docker run -i --rm hashicorp/terraform-mcp-server`; TFE_TOKEN optional | 1.5k stars | 25+ | `claude mcp add terraform -s user -t stdio -- docker run -i --rm hashicorp/terraform-mcp-server`; official plugin `terraform` | `codex mcp add terraform -- docker run -i --rm hashicorp/terraform-mcp-server` (README) | optional (homelab IaC) |
| 28 | **Semgrep** | stdio `uvx semgrep-mcp` (PyPI 0.9.0, 2025-09-29), docker `ghcr.io/semgrep/mcp`, hosted `https://mcp.semgrep.ai/mcp`; README: standalone repo deprecated, moved into the `semgrep` binary | 686 stars | 7 | `claude mcp add semgrep uvx semgrep-mcp`; official plugin `semgrep` | `codex mcp add semgrep -- uvx semgrep-mcp` **[composed]** | deprecated standalone; use semgrep CLI/plugin |
| 29 | **Snyk** | stdio `snyk mcp -t stdio` (npm `snyk` 1.1307.2, 515,671 dl/wk); `snyk auth` | n/a | n/a | `npx -y snyk@latest mcp configure --tool=claude-cli` (docs.snyk.io agent-security quickstart) | `[mcp_servers.snyk-security]` / `command = "npx"` / `args = ["-y", "snyk@latest", "mcp", "-t", "stdio"]` (docs.snyk.io Codex CLI guide) | optional |
| 30 | **Grafana** | stdio `uvx mcp-grafana` (PyPI 1.4.2, 2026-09-14) or `docker run --rm -i -e GRAFANA_URL -e GRAFANA_SERVICE_ACCOUNT_TOKEN grafana/mcp-grafana -t stdio`; `--disable-<category>` | 3,462 stars, pushed 2026-09-16; PulseMCP 140k/wk | 100+ (prune) | official plugins `grafana-mcp`, `grafana-cloud-mcp` | `codex mcp add grafana --env GRAFANA_URL=... --env GRAFANA_SERVICE_ACCOUNT_TOKEN=... -- uvx mcp-grafana` **[composed]** | homelab recommended if Grafana present |
| 31 | **n8n-mcp** (czlonkowski) | stdio `npx n8n-mcp` (MCP_MODE=stdio, N8N_API_URL, N8N_API_KEY); hosted dashboard.n8n-mcp.com | 22,903 stars, pushed 2026-09-16; npm 2.87.0, 77,070 dl/wk | 7 core + 21 management | `claude mcp add n8n-mcp -e MCP_MODE=stdio -e LOG_LEVEL=error -e DISABLE_CONSOLE_OUTPUT=true -- npx n8n-mcp` (docs/CLAUDE_CODE_SETUP.md) | `[mcp_servers.n8n]` / `command = "npx"` / `args = ["n8n-mcp"]` / `env = { "MCP_MODE" = "stdio", "LOG_LEVEL" = "error", "DISABLE_CONSOLE_OUTPUT" = "true" }` (docs/CODEX_SETUP.md) | homelab optional |
| 32 | **Task Master** | stdio `npx -y task-master-ai`; `claude-code/*` provider (no key) or Codex OAuth | 28,078 stars, **pushed 2026-04-28** (slowing); npm 0.43.1, 9,868 dl/wk | 36 default (~21k tokens); `TASK_MASTER_TOOLS=core` = 7 | `claude mcp add taskmaster-ai -- npx -y task-master-ai` | `codex mcp add taskmaster-ai -- npx -y task-master-ai` **[composed]** | optional (overlaps superpowers planning) |
| 33 | **Zen MCP -> PAL MCP** | `github.com/BeehiveInnovations/zen-mcp-server` 301-redirects to `pal-mcp-server`; stdio `uvx --from git+https://github.com/BeehiveInnovations/pal-mcp-server.git pal-mcp-server` (README, git only); **do not use PyPI `pal-mcp-server`**: the PyPI project (10.4.3-11.1.0, Aug-Sep 2026) has no author/URLs and does not match the repo (`pyproject.toml` version 9.8.2, last push 2025-12-15); needs GEMINI/OPENAI/OPENROUTER key or local CLIs via `clink`; `./run-server.sh` auto-configures Claude Code and Codex CLI | 11,750 stars, last push 2025-12-15 (stale) | chat, thinkdeep, planner, consensus, codereview, precommit, debug (default) | JSON in README (`bash -c "uvx --from ... pal-mcp-server"`) | n/a | optional (multi-model second opinions) |
| 34 | **Obsidian** | stdio `uvx mcp-obsidian` (PyPI 0.2.3, 2026-08-20; needs Local REST API plugin; OBSIDIAN_API_KEY/HOST) | 4.4k stars; alt cyanheads/obsidian-mcp-server 679 | 7 | `claude mcp add obsidian -e OBSIDIAN_API_KEY=... -e OBSIDIAN_HOST=... -- uvx mcp-obsidian` **[composed]** | `codex mcp add obsidian --env OBSIDIAN_API_KEY=... -- uvx mcp-obsidian` **[composed]** | optional (vault is markdown; file tools suffice) |
| 35 | **Desktop Commander** | stdio `npx -y @wonderwhy-er/desktop-commander@latest` | 9,611 stars; npm 0.2.50, 156,453 dl/wk | 20+ | `claude mcp add --scope user desktop-commander -- npx -y @wonderwhy-er/desktop-commander@latest` | n/a | **skip** (hosts already have shell + file editing) |
| 36 | **Google Workspace** (taylorwilsdon) | stdio/HTTP `uvx workspace-mcp --tool-tier core|extended|complete` (PyPI 1.26.2, 2026-09-15); own OAuth client | 3.2k stars | 120+ | `claude mcp add --transport http workspace-mcp http://localhost:8000/mcp` | HTTP mode per README | skip on both (Claude: claude.ai Gmail/Calendar/Drive connectors; Codex: OpenAI-curated Gmail/Google Drive plugins) |
| 37 | **Browser Use** | official plugin `browser-use` (browser-use/plugins) | 115k-star project; PulseMCP #5 | n/a | plugin | n/a | optional |
| 38 | **Storybook MCP** | storybookjs/mcp 270 stars; PulseMCP #3 2.3m/wk | | | see repo | see repo | optional (frontend projects) |
| 39 | **GitMCP** (idosal) | remote `https://gitmcp.io/{owner}/{repo}` | 8.4k stars; PulseMCP 100k/wk | docs per repo | `claude mcp add --transport http <repo> https://gitmcp.io/<owner>/<repo>` **[composed]** | `codex mcp add <repo> --url https://gitmcp.io/<owner>/<repo>` **[composed]** | optional (Context7 covers most) |
| 40 | GitLab | official plugin `gitlab`; community zereight/gitlab-mcp 2k | | | plugin | see repo | optional |
| 41 | MongoDB | mongodb-js/mongodb-mcp-server 1.1k; official plugins `mongodb`, `mongodb-atlas` | | | plugin | see repo | optional |
| 42 | Neon / Redis | official plugins `neon`, `redis-development` | | | plugin | see repo | optional |
| 43 | 21st.dev Magic | @21st-dev/magic 5.9k stars | UI generation | | see repo | see repo | skip |
| 44 | markitdown MCP | microsoft/markitdown 185k stars (repo), `markitdown-mcp` | doc->markdown | | see repo | see repo | optional |
| 45 | MCP Inspector | `npx @modelcontextprotocol/inspector` (11k stars, 2.7.0, 223,589 dl/wk) | debugging | | n/a | n/a | recommended as installer `doctor` helper |
| 46 | mcp-remote (geelen) | `npx mcp-remote <url>` (1.6k stars, 0.14.2, 1,556,565 dl/wk) | bridge | | not needed | not needed | skip for these hosts (native HTTP+OAuth) |
| 47 | mcp-proxy (sparfenyuk) | PyPI 0.12.0 (2026-05-14), 2.8k stars; stdio<->streamable HTTP | | | only for hosts lacking HTTP | same | homelab helper (not needed for HA on these hosts) |
| 48 | add-mcp (neon-solutions) | `npx -y add-mcp <url> -g` (2.4.0, 113,044 dl/wk) | multi-client installer | | helper | helper | recommended helper |
| 49 | ctx7 CLI | `npx ctx7 setup --claude` / `--codex` (0.5.11, 34,798 dl/wk) | Context7 installer | | helper | helper | optional helper |
| 50 | Codex OpenAI-curated plugins | Gmail, Google Drive, Slack, Notion, Figma via `/plugins` (OpenAI tab); tools exposed as `mcp__codex_apps__*` (issue #25854) | ChatGPT connectors | | n/a | `/plugins` in Codex | recommended for Codex (mirrors claude.ai connectors) |

### 2.2 Reference servers (modelcontextprotocol/servers)

| Server | Package / cmd | dl/wk | Tools | Claude | Codex | Verdict |
|---|---|---|---|---|---|---|
| sequential-thinking | `npx -y @modelcontextprotocol/server-sequential-thinking` (2026.8.31); docker `mcp/sequentialthinking` | 106,759 | 1 | `claude mcp add sequential-thinking -- npx -y @modelcontextprotocol/server-sequential-thinking` **[composed]** | `codex mcp add sequential-thinking npx -y @modelcontextprotocol/server-sequential-thinking` (README) | skip (native reasoning; user runs xhigh) |
| memory | `npx -y @modelcontextprotocol/server-memory` (MEMORY_FILE_PATH) | 104,795 | 9 | composed | composed | skip (`remember` plugin; Codex `memories`) |
| filesystem | `npx -y @modelcontextprotocol/server-filesystem <dirs>` | 613,787 | 14 | n/a | n/a | skip (built-in) |
| fetch | `uvx mcp-server-fetch` (PyPI 2026.8.18); docker `mcp/fetch` | n/a | 1 | skip (WebFetch) | `codex mcp add fetch -- uvx mcp-server-fetch` **[composed]** | optional for Codex only |
| time | `uvx mcp-server-time [--local-timezone=...]` (2026.8.18) | n/a | 2 | skip | skip | skip (`date`) |
| git | `uvx mcp-server-git --repository <path>` (2026.8.18) | n/a | 12 | skip | skip | skip (git CLI) |
| everything | test server | 214,403 | many | skip | skip | skip |

### 2.3 Homelab / infra

| # | Server | Transport / auth | Popularity | Tools | Claude | Codex | Verdict |
|---|---|---|---|---|---|---|---|
| H1 | **Docker MCP Gateway / Toolkit** | CLI plugin `docker-mcp` in `~/.docker/cli-plugins`; release v0.43.3 (2026-07-16) assets `docker-mcp-linux-amd64.tar.gz`, `docker-mcp-linux-arm64.tar.gz`, `docker-mcp-windows-{amd64,arm64}.tar.gz`, `docker-mcp-darwin-{amd64,arm64}.tar.gz`; Docker Desktop or Docker CE with `DOCKER_MCP_IN_CONTAINER=1`; `docker mcp catalog init`, `docker mcp server enable <name>`, `docker mcp secret set` | 1,567 stars, pushed 2026-09-16 | aggregates containerised servers | `docker mcp client connect claude-code --global` | `docker mcp client connect codex --global` | **recommended (homelab)** |
| H2 | **Kubernetes (containers/kubernetes-mcp-server, Red Hat)** | stdio `npx -y kubernetes-mcp-server@latest` / `uvx kubernetes-mcp-server@latest` / binary / helm; no kubectl; `--read-only`, `--disable-destructive` | 2,098 stars, pushed 2026-09-16; npm 0.0.66, 5,646 dl/wk; PyPI 0.0.66 (2026-07-31) | 8 toolsets | `claude mcp add k8s -- npx -y kubernetes-mcp-server@latest --read-only` **[composed]** | `codex mcp add k8s -- npx -y kubernetes-mcp-server@latest --read-only` **[composed]** | **recommended (homelab)** |
| H3 | Kubernetes (Flux159/mcp-server-kubernetes) | stdio `npx mcp-server-kubernetes`; needs kubectl; `ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS=true` | 1,584 stars; npm 4.1.7, 4,455 dl/wk | 40+ | `claude mcp add kubernetes -- npx mcp-server-kubernetes` | `codex mcp add kubernetes -- npx mcp-server-kubernetes` | optional alternative |
| H4 | **Proxmox: ProxmoxMCP-Plus** (RekklesNA) | stdio `uvx proxmox-mcp-plus` with `PROXMOX_MCP_CONFIG=/path/config.json` (API token); docker MCP-HTTP :8000 | 538 stars, pushed 2026-09-16; PyPI 0.5.18 (2026-09-16) | 40+ | `claude mcp add proxmox -e PROXMOX_MCP_CONFIG=/path/config.json -- uvx proxmox-mcp-plus` **[composed]** | `codex mcp add proxmox --env PROXMOX_MCP_CONFIG=/path/config.json -- uvx proxmox-mcp-plus` **[composed]** | optional (homelab); read-mostly API token |
| H5 | Proxmox: canvrno/ProxmoxMCP | stdio (Python) | 292 stars, **last push 2025-02-19** | | see repo | see repo | skip (unmaintained) |
| H6 | Proxmox: gilby125/mcp-proxmox | stdio (Node), permission levels | 52 stars | | see repo | see repo | optional |
| H7 | Proxmox long tail | antonio-mello-ai/mcp-proxmox (PyPI 1.2.2, 16 stars), ry-ops (15), cyteon (2), sergelogvinov (2), nick-holmquist (1), others | <20 stars each | | | | skip |
| H8 | **Home Assistant native MCP server** | HA `mcp_server` integration (2025.2+), Streamable HTTP at `http://<ha>:8123/api/mcp` (`/api/mcp/<api_id>`, `/api/mcp/assist`); OAuth (IndieAuth) or long-lived token; HA docs' stdio fallback: `mcp-proxy --transport=streamablehttp --stateless http://<ha>:8123/api/mcp` with `API_ACCESS_TOKEN` | home-assistant/core 91k stars | exposed Assist entities | official HA docs: `claude mcp add-json "HA" '{ "type": "http", "url": "https://<your_home_assistant_url>/api/mcp", "oauth": { "clientId": "http://localhost:12345", "callbackPort": 12345 } }' --client-secret` then `/mcp` -> Authenticate; bearer alternative `claude mcp add --transport http home-assistant http://<ha>:8123/api/mcp --header "Authorization: Bearer <long-lived-token>"` **[composed from the HA Antigravity example]** | official HA docs: root-level `mcp_oauth_callback_port = 12345` + `[mcp_servers.homeassistant]` / `url = "<your_home_assistant_url>/api/mcp"` / `auth = "oauth"` / `oauth = { client_id = "http://127.0.0.1:12345" }` then `codex mcp login homeassistant`; bearer alternative `codex mcp add home-assistant --url http://<ha>:8123/api/mcp --bearer-token-env-var HA_TOKEN` **[composed]** | **recommended (homelab)** |
| H9 | Home Assistant: voska/hass-mcp | `docker run -i --rm -e HA_URL -e HA_TOKEN voska/hass-mcp` or uvx (PyPI hass-mcp 0.6.0, 2026-08-06) | 341 stars | 20+ | `claude mcp add hass-mcp -e HA_URL=http://homeassistant.local:8123 -e HA_TOKEN=YOUR_TOKEN -- docker run -i --rm -e HA_URL -e HA_TOKEN voska/hass-mcp` | composed | optional (automations, dashboards, logs) |
| H10 | **NetBox** (netboxlabs) | stdio `uv --directory /path/to/netbox-mcp-server run netbox-mcp-server` or docker `netboxlabs/netbox-mcp-server:latest`; NETBOX_URL/NETBOX_TOKEN; read-only | 228 stars | 3 | `claude mcp add --transport stdio netbox --env NETBOX_URL=https://netbox.example.com/ --env NETBOX_TOKEN=<token> -- uv --directory /path/to/netbox-mcp-server run netbox-mcp-server` | composed | optional |
| H11 | UniFi | sirkirby/unifi-mcp (824 stars), enuno/unifi-mcp-server (259), pete-builds/mcp-unifi (22, official registry) | no official Ubiquiti server | | see repos | see repos | optional |
| H12 | SSH | fragmented (uarlouski/ssh-mcp-server 37 stars etc.; mixelpixx/SSH-MCP deprecated) | none dominant | | n/a | n/a | **skip** (Bash `ssh host cmd`) |
| H13 | Netdata | netdata/netdata 81k stars; ships an MCP server in the agent (per awesome-mcp.tools ranking; docs not fetched) | | | | | optional, verify |
| H14 | Docker direct | ckreiling/mcp-server-docker 743, QuantGeekDev/docker-mcp 503 | low | | | | skip (docker CLI; gateway instead) |
| H15 | Grafana, Terraform, n8n | rows 30, 27, 31 | | | | | |

### 2.4 claude.ai connectors, Codex plugins and built-ins

* claude.ai connectors (Claude Docs, Gmail, Google Calendar, Google Drive, Expedia, Booking.com) are attached to the account, rank below user-scope MCP, deferred by tool search, authenticated via `/mcp` or `claude mcp login`. Not portable to Codex; Codex's equivalents are the OpenAI-curated plugins (Gmail, Google Drive, Slack, Notion, Figma) installed from `/plugins`.
* `claude-in-chrome`: built-in server behind `claude --chrome`.
* Claude Code built-ins that supersede MCP: WebFetch, WebSearch, Bash, Read/Edit/Write, Glob/Grep, LSP plugins, `remember` plugin.
* Codex built-ins: `web_search`, shell/unified_exec, apps, `memories`, `browser_use`/`computer_use` (app-side; CLI/Linux unconfirmed).

---

## 3. Redundancy analysis (what NOT to install globally)

| MCP server | Superseded by | Decision |
|---|---|---|
| filesystem, desktop-commander, git, time | Claude Code Bash/Read/Edit/Glob/Grep; Codex shell | skip both |
| fetch, brave-search, tavily, perplexity, firecrawl | Claude Code WebFetch/WebSearch; Codex `web_search = "live"` | skip on Claude; on Codex keep exactly one keyless search+fetch (Exa remote) |
| sequential-thinking | native extended thinking / `model_reasoning_effort = xhigh` | skip |
| memory (knowledge graph) | `remember` plugin (Claude), Codex `memories` | skip |
| Playwright MCP + chrome-devtools-mcp both | Claude: `claude --chrome`; Codex Linux: none | Claude: keep `playwright` plugin or `--chrome`; Codex: Playwright MCP or Playwright CLI skills, chrome-devtools only for perf work |
| Serena | LSP plugins on Claude | optional on Claude, recommended on Codex |
| GitHub MCP | `gh` CLI via Bash | keep remote `/readonly` for issue/PR reading |
| Google Workspace MCP | claude.ai connectors / Codex Gmail+Drive plugins | skip on both |
| Semgrep standalone | deprecated into semgrep CLI; `security-guidance` plugin | skip |
| Task Master | superpowers planning skills | optional, `TASK_MASTER_TOOLS=core` |
| mcp-remote, mcp-proxy | native HTTP+OAuth in both hosts | skip |
| Archived reference servers | vendor remote servers | never install |

---

## 4. Recommended sets for this user

### 4.1 Global developer set (both hosts)

| Tier | Server | Claude Code (user scope) | Codex |
|---|---|---|---|
| must-have | Context7 (remote, API key) | keep official plugin `context7` (set `CONTEXT7_API_KEY` env) or `claude mcp add --scope user --header "Authorization: Bearer $CONTEXT7_API_KEY" --transport http context7 https://mcp.context7.com/mcp` | TOML remote block with `http_headers = { "Authorization" = "Bearer ..." }` or `env_http_headers`; or `npx ctx7 setup --codex` |
| must-have (Codex) / recommended (Claude) | Playwright MCP (or Playwright CLI skills) | plugin `playwright` (already) | `codex mcp add playwright npx "@playwright/mcp@latest"`; or `npm install -g @playwright/cli@latest && playwright-cli install --skills` |
| recommended | GitHub remote read-only | `claude mcp add --transport http github https://api.githubcopilot.com/mcp/readonly --header "Authorization: Bearer $GITHUB_PAT"` **[composed from documented /readonly URL]** | `codex mcp add github --url https://api.githubcopilot.com/mcp/readonly --bearer-token-env-var GITHUB_PAT_TOKEN` **[composed]** |
| recommended (Codex only) | Exa remote | plugin `exa@claude-plugins-official` (optional) | `codex mcp add exa --url https://mcp.exa.ai/mcp` |
| recommended (Codex) / optional (Claude) | Serena | plugin `serena` or `uv tool install -p 3.13 serena-agent` + documented add | documented TOML with `--context=codex` |
| optional | chrome-devtools-mcp (`--slim`) | `claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest` | `codex mcp add chrome-devtools -- npx chrome-devtools-mcp@latest` |
| optional (project scope) | DBHub, Supabase, Sentry, Vercel, Linear, Notion, Atlassian, Slack, Figma, Cloudflare, AWS Knowledge, Azure | remote HTTP + OAuth | `codex mcp add <name> --url ...` + `codex mcp login` |
| optional | PAL (ex-Zen), Task Master (core) | as documented | as documented |
| skip | filesystem, git, time, fetch, memory, sequential-thinking, desktop-commander, mcp-remote, archived servers, SSH servers, Google Workspace | | |

### 4.2 Homelab / infra set (opt-in profile)

| Tier | Server | Notes |
|---|---|---|
| recommended | Docker MCP Gateway (`docker mcp client connect claude-code --global`, `... codex --global`) | Linux: v0.43.3 `docker-mcp-linux-amd64.tar.gz` into `~/.docker/cli-plugins`; `docker mcp catalog init`; enable servers; `docker mcp secret set` |
| recommended | Kubernetes: containers/kubernetes-mcp-server `--read-only` | no kubectl dependency |
| recommended | Home Assistant native MCP (`/api/mcp`) as a direct HTTP server with bearer token | official, no third-party code, no proxy |
| optional | Proxmox: ProxmoxMCP-Plus (`uvx proxmox-mcp-plus`) | only actively maintained option; limited API token |
| optional | Grafana (`uvx mcp-grafana`, prune with `--disable-*`) | if Grafana present |
| optional | n8n-mcp, NetBox (read-only), UniFi (sirkirby/unifi-mcp), Terraform MCP, Netdata | only if the service exists |
| skip | SSH MCP servers, direct docker MCPs | Bash + ssh/docker CLI |

### 4.3 Token-budget guidance

* Claude Code: keep tool search on (default); avoid `alwaysLoad`; check `/context`. Approximate tool counts: Playwright 29 core, chrome-devtools 58 (`--slim` less), Firecrawl 25, Task Master 36 (~21k tokens per README) or 7 with `TASK_MASTER_TOOLS=core`, Grafana 100+, Google Workspace 120+, GitHub 60+ (limit with toolsets), Context7 2, Exa 2, DBHub 2.
* Codex: no deferral; keep the global set to roughly 4-5 servers / under ~60 tools. Use `enabled_tools`/`disabled_tools`, `tools.<tool>.output_token_limit`, `--slim`, `--read-only`, `?features=`, `X-MCP-Toolsets`, `TASK_MASTER_TOOLS=core`, `--tool-tier core`.

### 4.4 Installer script implications

1. Two writers: Claude = `claude mcp add --scope user ...` on Linux/macOS, `claude mcp add-json <name> '<json>'` everywhere `cmd /c` is needed (Windows parser bug) or when a plugin already provides the server (skip); Codex = `codex mcp add` for simple cases, direct TOML merge into `~/.codex/config.toml` when `http_headers`/`env_http_headers`/`enabled_tools` are needed. Idempotency: `claude mcp get <name>` / `codex mcp get <name>` before add; remove-then-add to update.
2. Secrets: read from env or `~/.config/agent-installer/secrets.env`; pass via `--header`/`-e` (Claude) and `bearer_token_env_var` / `env_http_headers` / `env_vars` (Codex) so keys never land in config files. Claude plugins read `${VAR:-}` from the environment (`CONTEXT7_API_KEY`, `GITHUB_PERSONAL_ACCESS_TOKEN`).
3. Windows: wrap stdio `npx` in `cmd /c` for both hosts via JSON/TOML (never via `claude mcp add`); prefer remote HTTP; `uvx` requires `uv` (missing here); `docker run` requires Docker.
4. Update: remote servers need nothing; `npx -y pkg@latest` resolves latest; `uv tool upgrade serena-agent`; `docker mcp catalog update`; plugin updates via `claude plugin update` / `codex plugin`.
5. Doctor: `claude mcp list`, `codex mcp list`, optional `npx @modelcontextprotocol/inspector`.

---

## 5. Open questions

1. PAL MCP: **resolved 2026-09-17** - the PyPI `pal-mcp-server` project (10.x-11.x, no author/URLs) does not correspond to the repo (pyproject 9.8.2, README installs from git only); the project is stale since 2025-12-15. Remaining question: whether the PyPI name is squatted or an unlisted maintainer upload.
2. Codex CLI on Linux: **resolved** - official Browser page: "Browser isn't available in Codex CLI or the Codex IDE extension"; a Linux desktop app preview exists (Ubuntu 24.04/26.04, Debian 13, Fedora 43/44, Arch) without Computer Use. Remaining: whether the Chrome extension actually works from the Linux app.
3. Codex OpenAI-curated Gmail/Google Drive/Slack/Notion/Figma plugins: **confirmed by learn.chatgpt.com/codex/plugins** ("Codex CLI also has a plugin browser"); still verify on this machine that they appear under `/plugins` on Linux with ChatGPT login (not API key).
4. Slack official server on Codex: Slack docs list Claude.ai, Claude Code, Perplexity, Cursor and forbid DCR; Codex would need a pre-registered `--oauth-client-id`, which Slack does not publish.
5. Home Assistant: official HA docs now document OAuth setups for both Claude Code (`claude mcp add-json ... --client-secret`) and Codex (`auth = "oauth"`, `mcp_oauth_callback_port`); the bearer-token variant remains composed/untested.
6. Exact tool counts for Linear, Atlassian, Notion, Sentry remote servers are not published on the fetched pages.
7. `claude mcp add` Windows `/c` parser bug: confirm whether it is fixed in 2.1.273 (issues were closed "not planned").

---

## 6. Sources

Fetched 2026-09-16 (first pass) and 2026-09-17 (re-verification):

* Claude Code: https://code.claude.com/docs/en/mcp (and `.md`), https://code.claude.com/docs/en/env-vars.md, https://code.claude.com/docs/en/setup.md, https://code.claude.com/docs/en/chrome, https://code.claude.com/docs/en/agent-sdk/tool-search; issues https://github.com/anthropics/claude-code/issues/46360, /20061, /36808, /4158, /9594, /40314; local `claude mcp add --help`
* Codex: https://learn.chatgpt.com/docs/config-file/config-reference (redirect of developers.openai.com/codex/config-reference), https://learn.chatgpt.com/docs/extend/mcp?surface=cli, https://learn.chatgpt.com/use-cases/use-your-computer-with-codex; issues https://github.com/openai/codex/issues/26820, /25100, /22164, /25854, /22826; local `codex mcp add --help`
* https://raw.githubusercontent.com/modelcontextprotocol/servers/main/README.md and src/* READMEs
* https://www.pulsemcp.com/servers ; https://smithery.ai/ ; https://glama.ai/mcp/servers ; https://mcp.so/ ; https://mcpmanager.ai/blog/most-popular-mcp-servers/ ; https://awesome-mcp.tools/blog/top-mcp-servers-2026
* https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json and external_plugins/{context7,playwright,github,linear,serena}/.mcp.json
* Context7: upstash/context7 README, https://context7.com/docs/clients/claude-code, https://context7.com/docs/clients/codex
* Playwright: https://raw.githubusercontent.com/microsoft/playwright-mcp/main/README.md ; https://raw.githubusercontent.com/microsoft/playwright-cli/main/README.md
* chrome-devtools-mcp README, docs/tool-reference.md, https://raw.githubusercontent.com/ChromeDevTools/chrome-devtools-mcp/main/docs/client-configurations.md
* GitHub: github/github-mcp-server README, https://raw.githubusercontent.com/github/github-mcp-server/main/docs/remote-server.md, docs/installation-guides/install-claude.md, install-codex.md
* Serena: https://oraios.github.io/serena/02-usage/030_clients.html
* Docker: docker/mcp-gateway README, https://github.com/docker/mcp-gateway/releases (v0.43.3 assets), https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/, https://docs.docker.com/reference/cli/docker/mcp/client/connect/
* Kubernetes: Flux159/mcp-server-kubernetes README ; containers/kubernetes-mcp-server README
* Home Assistant: https://www.home-assistant.io/integrations/mcp_server/ ; voska/hass-mcp README
* Proxmox: RekklesNA/ProxmoxMCP-Plus README ; GitHub search results for the long tail
* Slack: https://docs.slack.dev/ai/mcp-server/
* Vendors: linear.app/docs/mcp ; support.atlassian.com Rovo MCP ; developers.cloudflare.com MCP servers ; vercel.com/docs/agent-resources/vercel-mcp ; supabase.com/docs/guides/getting-started/mcp ; developers.figma.com + help.figma.com ; docs.stripe.com/mcp ; mcp.sentry.dev ; developers.notion.com/docs/get-started-with-mcp ; awslabs/mcp README ; learn.microsoft.com Azure MCP + microsoft/mcp README ; hashicorp/terraform-mcp-server README ; semgrep/mcp README ; docs.snyk.io ; grafana/mcp-grafana README ; czlonkowski/n8n-mcp README ; bytebase/dbhub README ; exa-labs/exa-mcp-server README ; tavily-ai/tavily-mcp README ; brave/brave-search-mcp-server README ; ppl-ai/modelcontextprotocol README ; firecrawl/firecrawl-mcp-server README ; BeehiveInnovations/pal-mcp-server README ; eyaltoledano/claude-task-master README ; wonderwhy-er/DesktopCommanderMCP README ; MarkusPfundstein/mcp-obsidian README ; netboxlabs/netbox-mcp-server README ; taylorwilsdon/google_workspace_mcp README
* Popularity: api.github.com/repos/<owner>/<repo> (stars, pushed_at, 2026-09-17), img.shields.io/github/stars/<repo>.json, api.npmjs.org/downloads/point/last-week/<pkg>, registry.npmjs.org/<pkg>/latest, pypi.org/pypi/<pkg>/json (all 2026-09-17)
* Added by verification pass (2026-09-17): https://context7.com/docs/resources/all-clients ; https://learn.chatgpt.com/codex/browser ; https://learn.chatgpt.com/codex/plugins ; https://learn.chatgpt.com/codex/linux/linux-app ; https://learn.chatgpt.com/codex/chrome-extension ; https://raw.githubusercontent.com/BeehiveInnovations/pal-mcp-server/main/pyproject.toml ; https://pypi.org/pypi/pal-mcp-server/json ; https://raw.githubusercontent.com/czlonkowski/n8n-mcp/main/docs/CLAUDE_CODE_SETUP.md and CODEX_SETUP.md ; https://raw.githubusercontent.com/slackapi/slack-mcp-plugin/main/README.md and .mcp.json ; https://docs.snyk.io/agent-security/agentic-security-with-snyk-studio/quickstart-guides/claude-code-guide and codex-cli-guide ; https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/ ; https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/ ; https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/ ; https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/tools/ ; https://github.com/docker/mcp-gateway/releases.atom ; https://raw.githubusercontent.com/voska/hass-mcp/master/README.md ; https://raw.githubusercontent.com/microsoft/mcp/main/servers/Azure.Mcp.Server/README.md
* Secondary (flagged): mcpservers.org Slack page, growthmethod.com, dev.to Docker gateway on Linux, blog.ianhsiao.me Slack DCR workaround, usecarly.com / adam.holter.com Codex plugins posts, codex.danielvaughan.com Codex-for-Chrome post, GitHub search summaries for UniFi/SSH servers

---

## Verification (skeptical fact-check, 2026-09-17, second reviewer)

Method: every repo re-checked via GitHub (api.github.com hit its unauthenticated rate limit mid-run; img.shields.io `github/stars` and `github/last-commit` used as the fallback, values agree with the first pass), every npm package via `registry.npmjs.org/<pkg>/latest` + `api.npmjs.org/downloads/point/last-week/<pkg>`, every PyPI package via `pypi.org/pypi/<pkg>/json`, every install command against the raw README / official docs page named below, host mechanics against `code.claude.com/docs/en/mcp.md`, `learn.chatgpt.com/docs/config-file/config-reference`, `learn.chatgpt.com/docs/extend/mcp?surface=cli`, and local `claude mcp add --help` (2.1.273) / `codex mcp add --help` (0.154.0).

### Confirmed unchanged
* All 68 GitHub repos exist; stars and last-commit ages match the report (context7 62k, playwright-mcp 37k, chrome-devtools-mcp 52k, github-mcp-server 33k, serena 29k, servers 90k, awesome-mcp-servers 95k, n8n-mcp 23k, task-master 28k/april, pal-mcp-server 12k/December 2025, desktop-commander 9.6k, exa 5k, dbhub 3.5k, mcp-grafana 3.5k, mcp-gateway 1.6k, kubernetes-mcp-server 2.1k, ProxmoxMCP-Plus 538, canvrno/ProxmoxMCP 292/February 2025, and the long tail).
* All npm versions/downloads (34 packages) and PyPI versions/dates (21 packages) match exactly.
* Claude Code MCP doc: precedence list (managed > local > project > user > plugin > claude.ai connectors), `ENABLE_TOOL_SEARCH` table text, `alwaysLoad` "available on all server types", 2KB truncation, `MAX_MCP_OUTPUT_TOKENS` 25,000, reserved names; no Windows `cmd /c` guidance anywhere in mcp.md, setup.md or troubleshooting.md.
* Codex config reference: `startup_timeout_sec` (10 s), `startup_timeout_ms` ("Alias for `startup_timeout_sec` in milliseconds"), `tool_timeout_sec` (60 s), `enabled`, `required`, `enabled_tools`, `disabled_tools`, `default_tools_approval_mode`, `tools.<tool>.output_token_limit`, `http_headers`, `env_http_headers`, `http_headers_helper`, `bearer_token_env_var`, `auth`, `oauth.*`, `scopes`, `oauth_resource`, `env`, `env_vars`, `cwd`, `mcp_optional_startup_grace_ms` (1000); `web_search = disabled|cached|indexed|live` default `cached`; no tool-search / lazy-loading text on either Codex page.
* marketplace.json: 305 plugins; all 36 named plugins present; `external_plugins/{context7,playwright,github,linear,serena}/.mcp.json` contents match verbatim.
* chrome-devtools-mcp: 58 tools in docs/tool-reference.md; Windows 11 Codex TOML verbatim; `claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest`; `codex mcp add chrome-devtools -- npx chrome-devtools-mcp@latest`; `code --add-mcp ...` all verbatim.
* Playwright MCP README: 29 core tools (25 core automation + `browser_tabs` + opt-in groups; README states caps `config,network,storage,devtools,vision,pdf,testing`), `claude mcp add playwright npx @playwright/mcp@latest`, `codex mcp add playwright npx "@playwright/mcp@latest"`, and the "Playwright MCP vs Playwright CLI" section recommending CLI+SKILLS for coding agents. Playwright CLI README: `npm install -g @playwright/cli@latest`, `playwright-cli install --skills`.
* GitHub: remote-server.md documents `/readonly`, `/insiders`, `/x/{toolset}` (single toolset only), `X-MCP-Toolsets`, `X-MCP-Readonly`, `X-MCP-Insiders`; install-codex.md has `codex mcp add github --url https://api.githubcopilot.com/mcp/ --bearer-token-env-var GITHUB_PAT_TOKEN` verbatim; Claude command is verbatim from code.claude.com mcp.md (GitHub's own install-claude.md prefers `claude mcp add-json github '{"type":"http","url":"https://api.githubcopilot.com/mcp","headers":{"Authorization":"Bearer YOUR_GITHUB_PAT"}}'`).
* Exa (`codex mcp add exa --url https://mcp.exa.ai/mcp`), Tavily (Claude command), Stripe (Claude command, Codex TOML + `codex mcp login stripe`, `stripe agent setup`, 10 tools), Vercel (`claude mcp add --transport http vercel https://mcp.vercel.com`, `codex mcp add vercel --url https://mcp.vercel.com`, `npx -y add-mcp https://mcp.vercel.com -g`, last_updated 2026-08-13, Codex CLI in supported-client list), Linear (`claude mcp add --transport http linear-server https://mcp.linear.app/mcp`, `codex mcp add linear --url https://mcp.linear.app/mcp`, `codex mcp login linear`, `/mcp/readonly`), Notion (`claude mcp add --transport http notion https://mcp.notion.com/mcp`; open-source server "no longer actively maintained"), Atlassian (`https://mcp.atlassian.com/v2/mcp`, v1 deprecated, auto-migrates 2027-03-01), Slack (`https://mcp.slack.com/mcp`, no SSE/DCR, clients Claude.ai/Claude Code/Perplexity/Cursor), DBHub (Claude docs), Desktop Commander (both commands verbatim in README), Task Master (`claude mcp add taskmaster-ai -- npx -y task-master-ai`, 36 tools ~21,000 tokens, `core` 7), Terraform (both commands), Semgrep (repo banner: deprecated, moved into `semgrep` binary), Grafana (`uvx mcp-grafana`, docker command, `--disable-<category>`), kubernetes-mcp-server (`--read-only`, `--disable-destructive`, 8 toolsets: config, core, helm, kcp, kiali, kubevirt, netobserv, tekton), Flux159 (both commands verbatim), NetBox (verbatim), hass-mcp (verbatim; README lives on `master`, `main` 404s), ProxmoxMCP-Plus (`uvx proxmox-mcp-plus`; both `PROXMOX_MCP_CONFIG` file mode and `PROXMOX_HOST/USER/TOKEN_NAME/TOKEN_VALUE` env mode are documented), docker/mcp-gateway v0.43.3 (2026-07-16, six `docker-mcp-{linux,windows,darwin}-{amd64,arm64}.tar.gz` assets; newest tag), Home Assistant (`/api/mcp`, Streamable HTTP, introduced 2025.2), Claude in Chrome doc (not WSL, Pro/Max/Team/Enterprise `/login`, not API key, "browser tools are always loaded"), PulseMCP (21,921 servers; top 5 Playwright 5.5m, Chrome DevTools 2.3m, Storybook 2.3m, Context7 1.4m, Browser Use 1.1m), zen-mcp-server -> pal-mcp-server redirect (HTTP 200 at pal URL after redirect), all cited GitHub issues exist with the titles claimed.

### Corrections made (body edited)
1. **Context7 Claude command**: context7.com/docs/resources/all-clients now gives `claude mcp add --scope user --header "Authorization: Bearer YOUR_API_KEY" --transport http context7 https://mcp.context7.com/mcp` (and stdio `claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp --api-key YOUR_API_KEY`); the `CONTEXT7_API_KEY:` header form is no longer documented. README now leads with `npx ctx7 setup` (`--cursor`, `--claude`, `--opencode`; Codex page: `npx ctx7 setup --codex`).
2. **PAL MCP**: PyPI `pal-mcp-server` (versions 10.4.3-11.1.0 uploaded 2026-08-12..2026-09-08) has no author, home page or project URLs, while the GitHub repo's `pyproject.toml` is at 9.8.2 and its README installs only from `git+https://github.com/BeehiveInnovations/pal-mcp-server.git`. Treat the PyPI package as unverified/possibly unrelated; removed `uvx pal-mcp-server (PyPI)` as an install path; last activity is the GitHub push 2025-12-15. Open question resolved in the negative (no rename found).
3. **n8n-mcp**: report's `claude mcp add n8n-mcp npx n8n-mcp --mcp-mode stdio` is not in the docs. Documented: `claude mcp add n8n-mcp -e MCP_MODE=stdio -e LOG_LEVEL=error -e DISABLE_CONSOLE_OUTPUT=true -- npx n8n-mcp`; Codex TOML `[mcp_servers.n8n]` with `env = { "MCP_MODE" = "stdio", ... }`.
4. **DuckDuckGo**: README documents `claude mcp add ddg-search uvx duckduckgo-mcp-server`; replaced the composed command.
5. **Firecrawl tool count**: 25 only for the full local profile; hosted keyless `https://mcp.firecrawl.dev/v2/mcp` exposes 3 tools, `/v2/mcp-search` 6.
6. **Supabase / Atlassian / Figma / Perplexity / Terraform Codex commands** are documented verbatim by the vendors (`codex mcp add supabase --url "https://mcp.supabase.com/mcp"` + `codex mcp login supabase`; `codex mcp add atlassian --url https://mcp.atlassian.com/v2/mcp`; `codex mcp add figma --url https://mcp.figma.com/mcp`; `codex mcp add perplexity --env PERPLEXITY_API_KEY="your_key_here" -- npx -y @perplexity-ai/mcp-server`; `codex mcp add terraform -- docker run -i --rm hashicorp/terraform-mcp-server`); "[composed]" tags removed. Figma also documents `claude mcp add --scope user --transport http figma https://mcp.figma.com/mcp`.
7. **Home Assistant**: the HA integration page now has official Claude Code and Codex sections (OAuth with `clientId` = local callback URL, `claude mcp add-json "HA" '{...}' --client-secret`; Codex `mcp_oauth_callback_port = 12345` + `[mcp_servers.homeassistant]` `auth = "oauth"` `oauth = { client_id = "http://127.0.0.1:12345" }` + `codex mcp login homeassistant`). The bearer-token HTTP variant is kept as a composed alternative (HA's Antigravity example uses `"Authorization": "Bearer ${HOMEASSISTANT_TOKEN}"`).
8. **Snyk**: docs URL corrected to `https://docs.snyk.io/agent-security/agentic-security-with-snyk-studio/quickstart-guides/claude-code-guide` (the `integrations/snyk-cli/...` path 404s); Codex has its own guide with `[mcp_servers.snyk-security]` / `command = "npx"` / `args = ["-y", "snyk@latest", "mcp", "-t", "stdio"]`; `snyk mcp configure` documents only `--tool=claude-cli`.
9. **Slack on Codex**: slackapi/slack-mcp-plugin README documents `codex plugin marketplace add slackapi/slack-skills-plugin` + `codex plugin add slack@slack`, but "Codex support currently ships the skills only; the MCP server is not yet wired into the Codex surface".
10. **Windows `/c` issue**: #46360 (closed not planned) also reports that a hand-corrected `cmd /c npx` entry breaks stdio pipes; its working solution is `"command": "node", "args": ["<path>/node_modules/@playwright/mcp/cli.js", ...]`. The "edit ~/.claude.json with cmd /c" workaround is therefore only partially supported by that source; Google's chrome-devtools docs still recommend `cmd /c` for Codex on Windows 11.
11. **Codex CLI browser**: upgraded from issue-based (medium) to primary-doc (high): "Browser isn't available in Codex CLI or the Codex IDE extension" (learn.chatgpt.com/codex/browser). The claim "no Linux desktop app" is outdated: learn.chatgpt.com/codex/linux/linux-app documents a Linux preview app (Ubuntu 24.04/26.04, Debian 13, Fedora 43/44, Arch; `sudo apt install ./chatgpt_amd64.deb`, `sudo dnf install ./chatgpt.x86_64.rpm`, Arch `install-arch.sh`); Computer Use "not yet in the Linux preview"; Chrome extension listed as a next step.
12. **Codex OpenAI-curated plugins**: upgraded from low to high; learn.chatgpt.com/codex/plugins names Gmail, Google Drive, Slack, Notion, Figma; "Codex CLI also has a plugin browser for Codex environments. The IDE extension doesn't support plugins"; some plugins unavailable with API-key auth. Local `codex plugin` has `add|list|marketplace|remove` (0.154.0).
13. **Serena**: docs now provide `serena setup claude-code` / `serena setup codex` one-liners in addition to the manual commands; `serena init` after `uv tool install -p 3.13 serena-agent`.
14. **Cloudflare**: developers.cloudflare.com lists 17 remote servers (was "13-17"); Claude install is `/plugin marketplace add cloudflare/skills`.
15. **Docker MCP Gateway**: the README currently shows `docker mcp client connect claude-code --profile dev-tools --global`; the plain `--global` form and the client list (incl. `codex`) come from docs.docker.com/reference/cli/docker/mcp/client/connect/.
16. **Azure MCP**: `--mode namespace` is now the documented default (`namespace|consolidated|all|single`), `--read-only` confirmed (learn.microsoft.com).
17. **Sentry**: mcp.sentry.dev documents `https://mcp.sentry.dev/mcp/{organizationSlug}/{projectSlug}` for scoping; base `https://mcp.sentry.dev/mcp` remains the Claude docs example; no tool count published.
18. **Tavily Codex**, **Brave**, **GitMCP**, **Obsidian**, **Cloudflare docs**, **AWS Knowledge**, **Azure**, **DBHub Codex**, **kubernetes-mcp-server** commands remain composed (no vendor `codex mcp add` text found) and stay tagged.

### Not verifiable / downgraded
* PulseMCP numbers are "estimated weekly visitors" by a third party (medium).
* Tool counts for Linear, Atlassian, Notion, Sentry remote servers still unpublished.
* n8n-mcp / Proxmox / Grafana tool counts are README self-reports.
* Playwright CLI `last_activity`: shields.io reports last commit "last monday" (~2026-09-14); GitHub API unavailable at check time (rate limit).
