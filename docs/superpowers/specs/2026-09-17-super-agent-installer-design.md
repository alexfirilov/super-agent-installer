# super-agent-installer: design spec

Date: 2026-09-17. Status: awaiting final approval. Research basis: `docs/research/CATALOG.md`, `docs/research/DESIGN-OPTIONS.md`, `docs/research/reports/`.

## 1. Goal

One command on any host (Linux, Windows, macOS) that installs Claude Code and Codex CLI through their official native installers, then provisions a chosen set of plugins, skills, MCP servers, prerequisite tools and settings for both agents, interactively (default: everything) or unattended (profiles, flags), and that updates all of it in place, including itself.

Non-goals: managing project-scope config (only user/global scope), storing secrets, replacing vendor CLIs (every install/update of an agent, plugin, MCP or skill is delegated to `claude`, `codex`, `npx skills`, `caveman`, package managers), other agents (manifest stays platform- and agent-aware so they can be added later).

## 2. Decisions (approved 2026-09-17)

| # | Decision |
|---|---|
| Architecture | Thin twin bootstrap (`install.sh`, `install.ps1`) + one TypeScript core shipped as bun-compiled binaries per OS/arch on GitHub Releases, with `npx super-agent-installer@<ver>` fallback when Node exists |
| Distribution | Public GitHub repo `super-agent-installer`; tagged releases with `SHA256SUMS`; one-liners pinned to a tag; `--self-update` |
| Windows | Bootstrap is Windows PowerShell 5.1-safe; offers PowerShell 7; bootstraps winget on Server 2022 or falls back to scoop; CMD not targeted |
| macOS | Supported now (Homebrew casks `claude-code@latest`, `codex`) |
| Claude channel | `latest` everywhere, background auto-update on; Codex updated via `--update` |
| caveman | Claude: plugin + `@caveman-ai/cli` native hooks + caveman statusline (script copied to `~/.claude/hooks/`); Codex: skills only; agent-native Codex proxy exists in the manifest but `forceOffInAll` |
| statusLine owner | caveman statusline; claude-hud selectable (conflict slot) |
| Codex MCP set | context7 (stdio, api key optional) + Playwright CLI skills + exa remote; cap 5 servers |
| Secrets | Prompt at install time only, never persisted by the installer; components reference env vars; installer prints the `export`/`setx` lines |
| Extra agents | none |
| Prune | uninstall code-review (both scopes), code-simplifier, ralph-loop, claude-code-setup; disable plugin-dev and pr-review-toolkit at user scope; keep remember |
| LSP | typescript-lsp + pyright-lsp + gopls-lsp with binaries (typescript-language-server, pyright, Go toolchain + gopls) |
| Additions in ALL | github plugin, chrome-devtools-mcp (`--slim`), hookify, cc-devops-skills (ansible/docker/k8s/terraform/bash validators+generators), linux-administration + linux-hardening + ssh-configuration (devops-security-agent-skills), powershell-windows (Windows hosts) |
| Selectable, off by default | mattpocock grill-me/handoff/tdd/to-spec, document-skills, ccusage, claude-hud, remember for Codex, exa/github for Codex, homelab set (proxmox-admin, Home Assistant, Docker MCP Gateway, kubernetes-mcp-server, Portainer, TrueNAS, Grafana, ProxmoxMCP-Plus), serena, compound-engineering, planning-with-files, context-mode, agent-browser, elements-of-style, obsidian-skills, vercel agent-skills, ui-ux-pro-max, Happy, agent-notifications |
| Instructions | Shared `instructions.md` rendered into marker blocks in `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` |
| Node | Node 24 LTS: fnm on desktops, NodeSource on root servers, winget `OpenJS.NodeJS.LTS` on Windows, brew on macOS |
| Audit gate | skills.sh audit API before every skill install: block on `fail` (Gen/Socket/Snyk), warn on `warn` and on Runlayer/ZeroLeaks; `--no-audit` |
| Profiles | all, minimal, claude-only, codex-only, work, homelab, proxmox-host, plus saved-per-host state |

## 3. Repository layout

```
super-agent-installer/
  install.sh                 # bootstrap (POSIX sh + bash), Linux/macOS/WSL
  install.ps1                # bootstrap, Windows PowerShell 5.1+ and pwsh
  manifest.json              # components, slots, profiles (data only)
  instructions.md            # shared global agent instructions (marker block)
  src/                       # TypeScript core (bun runtime for build, node-compatible)
    cli.ts                   # entry: arg parsing, command dispatch
    detect/                  # os, arch, root, package manager, node, uv, git, agents, AVX, bwrap, existing plugins/mcp/skills
    manifest/                # schema, loader, validation, profile resolution, conflict/slot solver, token budget
    picker/                  # @clack/prompts flows
    providers/               # one module per kind: agent-claude, agent-codex, claude-plugin, codex-plugin, skill, mcp-claude, mcp-codex, tool, setting, instructions
    config/                  # settings.json merge (jq-free, in-process), TOML marker blocks + codex CLI writers, backups
    update/                  # version probes, drift report, update-all sequence, self-update
    state/                   # state.json read/write
    audit/                   # skills.sh audit client
    exec/                    # child process runner with logging, dry-run, timeouts, lock detection
    ui/                      # log formatting, summary tables
  test/                      # vitest unit tests; bats + Pester for bootstraps; docker matrix scripts
  scripts/                   # build (bun build --compile per target), release (SHA256SUMS), matrix runners
  docs/
```

## 4. Bootstrap contract (install.sh / install.ps1)

Responsibilities, in order: parse `--version <tag>` (default: the tag baked into the script), detect OS/arch (linux-x64, linux-arm64, linux-x64-musl, darwin-x64, darwin-arm64, windows-x64, windows-arm64), ensure `curl` or `wget` and `tar` (Linux: install via apt/dnf/apk/pacman/zypper if root or sudo available, else abort with instructions), download `super-agent-installer-<target>` and `SHA256SUMS` from `https://github.com/<owner>/super-agent-installer/releases/download/<tag>/`, verify the checksum (`sha256sum`/`shasum -a 256`/`Get-FileHash`), install to `~/.local/bin/super-agent-installer` (Windows `%LOCALAPPDATA%\super-agent-installer\bin\`), add to PATH (shell rc marker block / User PATH), then `exec` it with all remaining arguments. If the binary download fails and Node >= 22 is present, fall back to `npx --yes super-agent-installer@<ver>`. Never uses `Invoke-WebRequest` without `-UseBasicParsing`; sets TLS 1.2; writes files UTF-8 without BOM; refuses `sudo`-from-user like Claude's installer (root itself is allowed).

Size target: under 200 lines each. No business logic.

## 5. Core CLI

```
super-agent-installer [install]   interactive install (default when a TTY is present)
  --profile <all|minimal|claude-only|codex-only|work|homelab|proxmox-host>
  --only <id,...>  --skip <id,...>  --yes  --dry-run  --json  --log-file <path>
  --no-audit  --no-self-update  --channel <latest|stable>  --from-state
super-agent-installer update      update everything selected on this host (state.json), including itself
super-agent-installer check       drift report only (installed vs latest per component), exit 2 when drift
super-agent-installer uninstall [id...]   remove selected components (agents last, with confirmation)
super-agent-installer list        show manifest with verdicts, token cost, selection status
super-agent-installer doctor      run detections + claude doctor + codex doctor --json + probes (AVX, bwrap, MCP health)
super-agent-installer self-update
```

No TTY and no `--yes`: exit 3 with `Unable to run interactively. Run with --yes [--profile <name>]`.

## 6. Manifest

`manifest.json` is the single source of truth. Each component:

```
id, name, kind (agent|claude-plugin|codex-plugin|skill|mcp|tool|setting|hook|statusline|instructions),
agents ["claude"|"codex"|"both"], platforms ["linux","windows","darwin"], archNotes,
prerequisites [ids], dependsOn [ids], conflictsWith [ids], slot (statusline|bash-rewriter|api-proxy|memory|methodology|browser|codex-notify|codex-hooks-writer),
defaultSelected, forceOffInAll, profiles {name: true|false} overrides,
contextCostTokens {claude: n, codex: n} (from Anthropic catalog or measured),
popularity {stars, installs, downloads, observedAt},
install {linux: [cmd], windows: [cmd], darwin: [cmd]} per agent where relevant,
update {..}, uninstall {..}, versionProbe {installed: cmd|file|json-path, latest: url|npm|channel},
secrets [{env, prompt, required}], audit {owner, repo, skill}, postInstallHint, source (url), verdict
```

Kinds map to providers. A provider knows how to detect, install, update, uninstall and probe versions for its kind, and how to be idempotent (see section 8).

Slots: exactly one selected component per slot; the picker resolves conflicts before execution. Token budget: sum of `contextCostTokens.claude` for selected items is shown live; target 6k, warning above 8k.

Initial component list (exact):

Agents: `claude-code` (native installer; Debian/Proxmox root: signed apt repo; macOS brew cask `claude-code@latest`), `codex-cli` (native installer with `CODEX_NON_INTERACTIVE=1`; macOS brew cask; conflicting npm/bun/brew installs removed after confirmation).

Prerequisite tools: `git`, `node` (Node 24 LTS via fnm / NodeSource / winget / brew), `uv`, `jq`, `yq`, `ripgrep`, `gh`, `bubblewrap+socat` (Linux, optional), `powershell-7` (Windows, optional), `go` (when gopls selected), `typescript-language-server`, `pyright`, `gopls`, `libreoffice+pandoc` (only when document-skills selected), `@caveman-ai/cli`, `@playwright/cli`.

Claude plugins (official marketplace unless noted): superpowers, caveman (marketplace `JuliusBrussee/caveman`), security-guidance, context7, commit-commands, typescript-lsp, pyright-lsp, gopls-lsp, frontend-design, skill-creator, feature-dev, claude-md-management, github, chrome-devtools-mcp, hookify, playwright, remember (installed; optional), claude-hud (marketplace `jarrodwatts/claude-hud`; slot statusline; optional), mattpocock-skills (optional; default route is the 4 cherry-picked skills instead), document-skills (marketplace `anthropics/skills`; optional), serena (optional), compound-engineering / planning-with-files / context-mode / elements-of-style / superpowers-chrome / obsidian-skills / ui-ux-pro-max (optional), plugin-dev and pr-review-toolkit (installed but `disable` at user scope), code-review / code-simplifier / ralph-loop / claude-code-setup (uninstall when present, `--keep` to retain).

Skills (via `npx skills add ... -a claude-code -a codex -g -y`, audit-gated): find-skills; caveman skills for Codex only (`-a codex`, since Claude has the plugin); cc-devops-skills (ansible-generator, ansible-validator, dockerfile-generator, dockerfile-validator, k8s-generator, k8s-validator, helm-*, terraform-generator, terraform-validator, bash-script-generator, bash-script-validator); devops-security-agent-skills (linux-administration, linux-hardening, ssh-configuration); powershell-windows (Windows hosts only); optional: mattpocock grill-me/handoff/tdd/to-spec, anthropics/skills frontend-design + skill-creator + mcp-builder + webapp-testing for Codex, vercel-labs/agent-skills, kepano/obsidian-skills, proxmox-admin, lunar-claude proxmox-infrastructure, agent-browser, Playwright CLI skills (`playwright-cli install --skills`, default ON for Codex).

MCP servers: Claude side comes through plugins (context7, playwright, github, chrome-devtools-mcp). Codex side: context7 (stdio npx, `--api-key` when provided), exa (`--url https://mcp.exa.ai/mcp`), optional github readonly (`--bearer-token-env-var GITHUB_PAT_TOKEN`), optional chrome-devtools, optional serena. Homelab (optional, both agents): Home Assistant native (OAuth), Docker MCP Gateway (`docker mcp client connect claude-code|codex --global`), kubernetes-mcp-server `--read-only`, Portainer, TrueNAS, Grafana, ProxmoxMCP-Plus, n8n-mcp, Tailscale.

Settings: Claude `autoUpdatesChannel=latest`, `env.DISABLE_AUTOUPDATER` unset, `statusLine` (caveman script at `~/.claude/hooks/caveman-statusline.sh` / `.ps1`), caveman native hooks (generated by `caveman setup --agent-native claude`), `attribution` untouched, `model` untouched unless `--model`; Codex `[features] memories = true` (opt-in toggle), `[projects."<home>"] trust_level = "trusted"` (opt-in), `cli_auth_credentials_store` untouched; Windows: `git config --global core.symlinks true` offered; skills CLI `--copy` fallback when Developer Mode is absent.

Instructions: marker block `<!-- super-agent-installer:start -->` ... `<!-- super-agent-installer:end -->` in `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` from `instructions.md` (Codex 32 KiB cap respected).

Profiles: `all` = every `defaultSelected` item; `minimal` = agents, superpowers, caveman, context7, find-skills, node; `claude-only` / `codex-only` = agent filter; `work` = all minus proxies, pentest, homelab, personal skills, github readonly, plus prompts for `HTTPS_PROXY`/`NODE_EXTRA_CA_CERTS`; `homelab` = all plus the homelab set; `proxmox-host` = claude via apt repo (stable channel override allowed), codex standalone, no browser MCPs/plugins, no LSP, headless auth seeding, AVX and bwrap checks, root-safe Node (NodeSource).

## 7. Interactive flow

1. Detect and print a host summary (OS, arch, root/sudo, package manager, Node, uv, git, existing agent versions, existing plugins/skills/MCPs, AVX, bwrap, free disk on the config filesystem; warn when a `claude` session is running).
2. Choose profile (default `all`; `saved` when state.json exists).
3. Per category multiselect pre-filled from the profile: Agents, Prerequisites, Claude plugins, Skills, MCP servers, Settings and hooks. Each row shows verdict, popularity, token cost, and platform warnings. Live footer: selected count, Claude always-on token total, Codex MCP count.
4. Conflict resolution prompts for any slot with more than one selection; prerequisite auto-add with confirmation.
5. Secrets: for each selected component with `secrets`, prompt (masked, skippable). Values are used for the current run only (for example `codex login --with-api-key` from stdin, `codex mcp add --api-key`) and otherwise turned into printed `export` / `setx` instructions. Nothing is written by the installer.
6. Plan preview: table of actions (install/update/skip/uninstall, from-version, to-version, command). `--dry-run` stops here.
7. Execute with per-step status, retries for network steps, and a log file. Failures do not abort unrelated steps; exit code reflects any failure.
8. Post-install: login instructions (`claude` first run, `codex login` or device auth), Codex `/hooks` trust reminder, restart note, drift summary, `state.json` written.

## 8. Provider rules (idempotency, verified in gap-2)

- Claude marketplace: `claude plugin marketplace add <src>` (idempotent). Before plugin work: `claude plugin marketplace update`.
- Claude plugin install: `claude plugin install <p>@<m> --scope user --json` (already-installed is exit 0). Update: loop `claude plugin update <p>@<m> --json`. Disable: `claude plugin disable`; uninstall: `claude plugin uninstall` at each scope where present.
- Claude MCP (only for non-plugin servers): `claude mcp remove -s user <name>` (ignore failure) then `claude mcp add -s user ...`; secrets only via env-var references, never literal headers.
- Codex marketplace: `codex plugin marketplace add <src> --json`; update: `codex plugin marketplace upgrade --json` then `codex plugin add <p>@<m> --json` again.
- Codex MCP: read existing table first; if identical, skip; else `codex mcp add` (with `--bearer-token-env-var` for HTTP servers to avoid the OAuth flow) and re-apply extra keys (`startup_timeout_sec`, `enabled_tools`) through the TOML writer; validate with `codex doctor --json` config.load.
- Skills: audit check, then `npx -y skills@<pinned> add <owner/repo> --skill <name> -g -a <agents> -y [--copy]`; update: `npx -y skills@<pinned> update -g -y`.
- Agents: install when absent; `claude update` / `codex update` when present; when a package manager owns the agent (winget/brew/apt), print or run the package-manager command; detect the Claude update lock and warn.
- caveman: `npm i -g @caveman-ai/cli@<pinned>` (user prefix, never sudo), `caveman setup --agent-native claude` (idempotent, replace-not-accumulate), statusline script copy.
- Settings JSON: read, merge in memory (deep merge, hook dedupe by command string), write to temp in the same directory, rename, keep mode 0600, backup to `~/.config/super-agent-installer/backups/<file>.<timestamp>`. `~/.claude.json` is never edited except to seed onboarding/trust keys when the file does not exist and the profile is headless.
- TOML: Codex CLI writers for their keys; marker block (`# >>> super-agent-installer >>>` / `# <<< super-agent-installer <<<`) for other keys; refuse on half markers or foreign markers; validate by running `codex mcp list` (exit code) or `codex doctor --json`.

## 9. Update and drift

Version probes per component (from gap-3): `claude --version` vs `https://downloads.claude.ai/claude-code-releases/latest|stable`; `codex --version` vs `https://releases.openai.com/codex/channels/latest`; plugins via `claude plugin list --json` vs marketplace catalog (`plugin-details.json` for official, marketplace.json for others); Codex plugins via `codex plugin list --json`; skills via `~/.agents/.skill-lock.json` hash vs GitHub tree (delegated to `npx skills update`); npm tools via `npm view <pkg> version`; uv/gh/jq via their `--version` and GitHub release redirects; winget-managed items compared against the winget manifest, not the vendor channel. `check` prints a table and exits 2 on drift. `update` runs the verified sequence: self-update, marketplaces, plugins, MCP upserts, skills, agents, caveman, tools, instructions block, drift report.

## 10. Self-update

`self-update` fetches `https://api.github.com/repos/<owner>/super-agent-installer/releases/latest` (fallback: the `latest` redirect), compares tags, downloads the binary + `SHA256SUMS`, verifies, replaces the executable atomically (Windows: rename running exe, place new, schedule delete). `--no-self-update` skips; `update` calls it first.

## 11. Security

Bootstrap pinned to a tag with sha256 in the one-liner docs; `set -euo pipefail`, `umask 077`; binaries and installers downloaded to a temp file and hash-verified before execution; agent installers run exactly as vendors document; allowlisted plugin/skill sources in the manifest (extra sources need `--allow-source`); skills audit gate; `npm` calls with `--ignore-scripts` where possible and a user prefix; no secrets on disk; config dirs chmod 700 offered; `--dry-run` everywhere; no telemetry.

## 12. Platform matrix

| Platform | Agents | Notes |
|---|---|---|
| Ubuntu/Debian (desktop) | native installers | fnm Node; bubblewrap optional |
| Debian 13 Proxmox host (root) | Claude via apt repo; Codex standalone | NodeSource Node; AVX check; no browser components |
| Unprivileged LXC | both | requires `nesting=1`; else Codex `sandbox_mode` guidance |
| Fedora/RHEL, Arch, openSUSE | native installers | package manager detection |
| Alpine | Claude needs `bash curl libgcc libstdc++ ripgrep` + `USE_BUILTIN_RIPGREP=0`; Codex musl build | |
| ARM64 Linux | both | |
| NixOS | abort with home-manager snippet | |
| Windows 10/11 native | both | PS 5.1 bootstrap; winget or scoop; `cmd /c` MCP wrapping; typescript-lsp warning; skills `--copy` fallback |
| Windows Server 2019/2022 | both | winget bootstrap or scoop; PS7 offer |
| WSL2 | Linux path | Claude `--chrome` unavailable |
| macOS (Apple Silicon, Intel) | brew casks | Homebrew required |

## 13. Testing

Unit: vitest for manifest validation, slot solver, token budget, JSON merge, TOML marker block, version comparison, command planning (mock exec). Bootstrap: shellcheck + bats (Linux/macOS), PSScriptAnalyzer + Pester under `powershell` 5.1 and `pwsh`. Integration: Docker matrix (debian:13, ubuntu:24.04, alpine:3.21, fedora:42, archlinux, arm64) running `install --yes --profile minimal` with throwaway `CLAUDE_CONFIG_DIR`/`CODEX_HOME`/`HOME`, then `check` and `update`; GitHub Actions on ubuntu-latest, ubuntu-24.04-arm, windows-latest, windows-2022, macos-latest. Real-host smoke on this machine with `--dry-run` before any real run.

## 14. Open items to confirm during implementation (not blocking)

Whether Claude-format plugin hooks run under Codex when the official marketplace is added to Codex (if not, Codex gets skills/MCP only from those plugins); whether `claude mcp add ... npx` auto-wraps on native Windows in current builds; typescript-language-server .cmd shim status on Windows; `codex plugin add <x>@openai-curated-remote` rerun semantics with ChatGPT login.
