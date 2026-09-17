# Security and supply-chain practices for the "ultimate AI coding agent installer"

Research date: 2026-09-16/17. Scope: an installer that (a) runs `curl | bash` / `irm | iex` for Claude Code and Codex CLI, (b) installs plugins / skills / MCP servers from GitHub, npm and skills.sh, (c) stores or references API keys, and (d) is re-run for updates on many hosts (home PC, VMs, Proxmox nodes, work hosts).

Everything below was fetched from primary sources on the research date (install scripts, manifests, GitHub advisories, vendor docs, incident write-ups). Local observations were made read-only on the reference Ubuntu 26.04 host (Claude Code 2.1.273 native, Codex CLI 0.154.0 standalone). Commands quoted as "verbatim" are copied from fetched sources; commands labeled "derived" were composed from verified inputs and were executed locally in a scratch directory to confirm they work.

---

## 0. Executive summary (what the installer must do)

1. **Both vendors now ship real verification primitives. Use them, don't just trust TLS.**
   - Claude Code: `manifest.json` (SHA-256 per platform) is signed with a **detached PGP signature** `manifest.json.sig` by key `31DD DE24 DDFA B679 F42D 7BD2 BAA9 29FF 1A7E CACE` ("Anthropic Claude Code Release Signing <security@anthropic.com>", rsa4096, created 2026-03-30). Public key at `https://downloads.claude.ai/keys/claude-code.asc`. Signatures exist for releases >= 2.1.89. The stock `install.sh`/`install.ps1` only check SHA-256 against the (unsigned-as-fetched) manifest; they do **not** verify the PGP signature. The manifest carries `"manifestSignatureEnforcement": "flag"` (meaning: signature enforcement is behind a flag, not yet mandatory). I verified the 2.1.273 signature locally: `Good signature`.
   - Codex CLI: every release publishes `codex-package_SHA256SUMS`, per-asset `sha256:` digests in `releases.openai.com/codex/releases/<ver>/release.json` (and GitHub API), and **Sigstore keyless bundles** `codex-<target>.sigstore` for the Linux musl binaries (cosign legacy bundle format; signer identity `https://github.com/openai/codex/.github/workflows/rust-release.yml@refs/tags/rust-vX.Y.Z`, issuer `https://token.actions.githubusercontent.com`). macOS binaries are code-signed and notarized (Azure Key Vault + rcodesign in the release workflow). The npm package `@openai/codex` has **SLSA v1 provenance** on npm. I verified the 0.154.0 Linux binary (and the locally installed one) with `cosign verify-blob`: `Verified OK`. Note: the `.sigstore` covers the raw `codex` binary; the `bin/codex` inside `codex-package-x86_64-unknown-linux-musl.tar.gz` is byte-identical (sha256 `3188814c...`), so post-install verification of `~/.codex/packages/standalone/current/bin/codex` works.
   - `@anthropic-ai/claude-code` on npm has registry signatures but **no provenance attestation** (`dist.attestations: null` on 2.1.273). `skills` (Vercel) 1.6.0 (npm latest on 2026-09-17; 1.5.26 at first research) and `@openai/codex` 0.154.0 both have SLSA provenance. [verified 2026-09-17: claude-code npm latest is now 2.1.274, still `dist.attestations: null`]
2. **The dominant real-world attack in 2025-26 is not the binary, it is the config and the extension ecosystem**: malicious Agent Skills (ClawHub/OpenClaw "ClawHavoc": 341 (Koi, 2026-02-02) -> 1,184 (Antiy CERT, as of 2026-02-05) malicious skills; Snyk ToxicSkills: 76 confirmed malicious of 3,984 across ClawHub + skills.sh), npm worms that **persist via `~/.claude/settings.json` hooks** (Mini Shai-Hulud, May 2026; CHAINDROP, Aug 2026, which also harvests Anthropic/Claude/Codex/OpenAI credentials), typosquats that read `~/.codex/auth.json` (`codexui-android`, May 2026), and a long run of Claude Code trust-dialog bypasses via repo-controlled `.claude/settings.json` / `.mcp.json` (CVE-2025-59536, CVE-2026-21852, CVE-2026-33068, GHSA-5hhx-v7f6-x7gv, GHSA-ff64-7w26-62rf, GHSA-5cwg-9f6j-9jvx ...). Codex had the same class (CVE-2025-61260, `.codex/config.toml` auto-load).
   - Consequence for the installer: **the settings files the installer writes are a security boundary**. Write them atomically with 0600, never merge untrusted JSON blindly, keep an allowlist of hook commands / MCP commands, and make the "update" path diff-and-confirm rather than overwrite.
3. **Skills.sh audits are advisory only.** The `skills` CLI shows Gen/Socket/Snyk/ZeroLeaks risk labels but "never blocks installation"; `-y` skips the confirmation that follows the audit table; `DISABLE_TELEMETRY=1`/`DO_NOT_TRACK=1` **also disables the audit fetch**. The audit API (`https://add-skill.vercel.sh/audit?source=owner/repo&skills=a,b`) can be queried by the installer *before* installing to gate on `critical`/`high` (undocumented endpoint; it worked on the research date). The v3 lock file `~/.agents/.skill-lock.json` stores a GitHub **tree SHA** per skill (`skillFolderHash`), which is a drift detector, not a signature.
4. **Anthropic's official marketplace is pinned**: 256 of 308 plugin entries (re-counted 2026-09-17; all 256 git-sourced entries carry a `sha`, the other 52 are local `./` paths) in `anthropics/claude-plugins-official` `marketplace.json` are git sources pinned to a 40-char `sha`; the community marketplace is "pinned to a specific commit SHA" and passes "automated validation and safety screening". Third-party marketplaces (e.g. `JuliusBrussee/caveman`) typically use `"source": "./"` (unpinned, tracks branch HEAD). Claude Code marketplace **sources** support `ref` but not `sha`; **plugin** sources support both. Pin third-party marketplaces with `owner/repo@<tag>`.
5. **Secrets**: Linux stores are plaintext-with-0600 for both tools (`~/.claude/.credentials.json`, `~/.codex/auth.json`). Codex supports `cli_auth_credentials_store = "keyring" | "auto" | "ephemeral"` (Secret Service on Linux; silently falls back to file if the keyring is unavailable, see issue #14704). Claude Code has no keyring option on Linux; use `apiKeyHelper` to pull from `op read`/`bws`/`secret-tool`/`systemd-creds` at runtime instead of persisting keys. Never write keys into `~/.claude.json`, `.mcp.json`, `settings.json` `env` blocks or `config.toml`; use `${VAR}` expansion in `.mcp.json` and `headersHelper` for MCP auth.
6. **The installer's own hygiene**: download-to-file then verify then execute (never pipe the vendor script straight into `bash` from inside your script, because a server can detect piping and serve different bytes); `set -euo pipefail`, `curl --proto '=https' --tlsv1.2 -fsSL --retry 3`; refuse to run under `sudo` (Claude's own installer does this); pin your own script to a tag + sha256 and self-update through the same verification path; `--dry-run` and `--inspect` modes; per-item trust prompts showing *what will run* (hooks, MCP commands, `command`-source plugins) with "default = everything" but critical/high-risk items opted **out**; write a machine-readable lock file of what was installed (versions, SHAs, hashes).

---

## 1. Incidents 2025-2026 (what actually happened)

| # | Date | Incident | Vector | Impact on an installer like ours | Vendor/platform response | Sources |
|---|------|----------|--------|----------------------------------|--------------------------|---------|
| 1 | 2025-09 (mid) | **Shai-Hulud** npm worm (v1) | Phished maintainer accounts -> trojanized packages -> self-propagation via stolen npm tokens | Any `npm i -g` / `npx` in the installer is exposed to freshly trojanized versions | npm: trusted publishing, 2FA-bypass token deprecation, `min-release-age` (Feb 2026), npm 12 install scripts off by default (Jul 2026) | Unit42, Datadog |
| 2 | 2025-09-25 | **postmark-mcp** malicious MCP server on npm | Impersonation of Postmark's MCP; 15 clean versions, then v1.0.16 BCCs all mail to attacker (phan@giftshop.club); download count not given by Snyk (the 1,643 figure could not be re-sourced: the original Koi post now redirects) | First confirmed rogue MCP server in the wild; "build trust then rug-pull" | npm removed the package | Snyk, The Register |
| 3 | 2025-07 -> 2025-10 | **CVE-2025-59536** Claude Code hooks in `.claude/settings.json` executed before the trust dialog ("Insufficient startup warning", GHSA-ph6w-f82w-28w6, GHSA-4fgq-fpq9-mr3g, GHSA-5hhx-v7f6-x7gv) | Cloning a malicious repo and running `claude` | Project settings are attacker-controlled input | Anthropic: enhanced trust dialog; no repo hooks/MCP before trust | Check Point Research, GH advisories |
| 4 | 2025-09-24 | GHSA-2jjv-qf24-vfm4 Claude Code "Arbitrary Code Execution via Plugin Autoloading with Specific Yarn Versions" | Plugin autoload | Plugin loading paths are attack surface | Patched | GH advisories |
| 5 | 2025-10 -> 2026-01 | **CVE-2026-21852** (GHSA-jh7p-qr78-84p7): repo `.claude/settings.json` sets `ANTHROPIC_BASE_URL` -> API key exfiltrated before trust | `env` block in project settings | Never let a project `env` block override auth endpoints; keep keys out of env when possible | Anthropic: "no API requests are initiated before users confirm the trust dialog" (fix 2025-12-28) | Check Point Research |
| 6 | 2025-10 | **CVE-2025-61260** (GHSA-xrxf-jgv3-qmrm, CVSS 9.8) Codex CLI <= 0.23.0 auto-loads project `.env` and `.codex/config.toml` incl. `mcp_servers` -> RCE | Cloning a malicious repo and running `codex` | Same class as #3 for Codex | OpenAI: project `.codex/` layers (config, hooks, rules) load only for projects marked `trust_level = "trusted"` (exact absolute paths, no wildcards) | GH advisory, Codex docs |
| 7 | 2025-11-24 | **Shai-Hulud 2.0** ("The Second Coming") | 796 npm packages backdoored; preinstall via bun runtime | As #1 | As #1 | Datadog, Arctic Wolf |
| 8 | 2026-02-02 | **ClawHavoc / ClawHub**: 341 of 2,857 skills malicious (11.9%), 335 in one campaign; Antiy CERT counted 1,184 malicious packages from 12 author IDs as of 2026-02-05; later press repeats 1,184 for mid-February | SKILL.md "prerequisite" instructions telling user/agent to paste a glot.io script -> Atomic Stealer (macOS) / keylogger zip (Windows); later variants: rentry.co Base64 bash, 22 MB README padding to evade scanners, affiliate-link injection | Skills are executable instructions: a SKILL.md can tell the agent to run `curl | bash` | ClawHub: report button (>3 reports auto-hide), VirusTotal + ClawScan integration (Feb 2026); registry was "open by default" (1-week-old GitHub account) | The Hacker News, Unit42, Trend Micro |
| 9 | 2026-02-05 | **Snyk ToxicSkills**: 3,984 skills scanned (ClawHub + skills.sh); 76 confirmed malicious payloads, 534 (13.4%) with critical issues, 1,467 (36.8%) with at least one flaw | Malicious/injected SKILL.md | Applies directly to `npx skills add` | Vercel skills.sh: automated audits by Gen/Socket/Snyk shown on skill pages and in `skills@1.4.0+` install output (2026-02-17); malicious skills hidden from search/leaderboard | Snyk, Vercel changelog |
| 10 | 2026-02-06 | GHSA-ff64-7w26-62rf "Sandbox Escape via Persistent Configuration Injection in settings.json" (Claude Code) | Writing to settings.json from inside a session | Protect settings files from the agent itself (`ConfigChange` hooks; sandbox denyWrite) | Patched | GH advisories |
| 11 | 2026-03-02 | Shai-Hulud **SANDWORM_MODE** variant: enumerates CI/CD before propagating | npm | As #1 | - | Socket/Sonatype via search |
| 12 | 2026-03-18 | **CVE-2026-33068** (GHSA-mmgp-wc2j-qcv7, < 2.1.53): repo `.claude/settings.json` `permissions.defaultMode: bypassPermissions` resolved before the trust dialog -> dialog silently skipped | Project settings | The installer must never write `defaultMode: bypassPermissions` into a shared/project file; keep `skipDangerousModePermissionPrompt`-style keys in user scope only | Fixed 2.1.53 | GH advisory |
| 13 | 2026-04-03 | CVE-2026-35020/35021/35022 (Claude Code 2.1.88-2.1.91): `TERMINAL` env injection in `which.ts`; shell metachars in promptEditor; unsanitized auth-helper config executed via `execa(shell: true)` | Env vars / `apiKeyHelper` string | `apiKeyHelper` is a shell string: only the user should set it; validate before writing | Reported unpatched as of 2026-04-03 by Phoenix; not in GH advisory list (see open questions) | Phoenix Security |
| 14 | 2026-04-17 | **CVE-2026-35603** (GHSA-5cwg-9f6j-9jvx, < 2.1.75): Windows loaded `C:\ProgramData\ClaudeCode\managed-settings.json` from a non-admin-writable dir -> LPE | Managed settings path | If the installer creates managed-settings on Windows, create the dir with admin-only ACLs | Fixed 2.1.75 | GH advisory |
| 15 | 2026-04-24 | GHSA-q5hj-mxqh-vv77 trust dialog bypass via git worktree spoofing; 2026-06-25 GHSA-7835-87q9-rgvv sandbox escape via worktree path confusion | Worktrees | Update cadence matters: keep `claude update` on, or pin with a minimum version | Patched | GH advisories |
| 16 | 2026-04 -> 05-13 | **Mini Shai-Hulud** (TeamPCP): 373 malicious versions across 169 npm + 2 PyPI packages (Mistral, Guardrails, UiPath, OpenSearch clients), 518M+ cumulative downloads; **persistence by writing malicious hooks into `~/.claude/settings.json`** and `.vscode/tasks.json`; harvests 100+ credential paths incl. AI-tool tokens | npm preinstall | Your installer's *own* settings writes must be idempotent and diffed so injected hooks are visible; audit hooks on every run | CSA research note | CSA Lab Space |
| 17 | 2026-05-27 | **codexui-android** / `@friuns/codexui` typosquat (27-29k weekly downloads) exfiltrates `~/.codex/auth.json` (`access_token`, `refresh_token`, `id_token`, `account_id`) to `sentry.anyclaw[.]store`; "refresh tokens ... do not expire" | npm typosquat of Codex UI | Anything named `codex*` on npm must be allowlisted exactly (`@openai/codex` only) | CSA recommends `cli_auth_credentials_store = "keyring"` | CSA Lab Space |
| 18 | 2026-06 | CVE-2026-47751 (claude-code-action < 1.0.74, patched 1.0.74; GHSA-8q5r-mmjf-575q published 2026-05-20): PR-supplied `.mcp.json` + `enableAllProjectMcpServers` -> RCE on runner | `.mcp.json` auto-trust in CI | Never set `enableAllProjectMcpServers: true` in a file the installer ships for untrusted dirs | Fixed 1.0.78 | GH advisory, Tenable |
| 19 | 2026-08-04/06 | **CHAINDROP** (Shai-Hulud family): keyv monorepo maintainer compromised, 400+ packages; `preinstall` -> `setup.mjs` via bun; persistence via **Claude Code `SessionStart` hook in `.claude/settings.json`**, VS Code `folderOpen` task, injected GitHub workflows; collector targets Anthropic/Claude/Codex/Cursor/OpenAI/Gemini creds | npm | Same as #16; also: rotate AI credentials after any npm compromise on the host | Elastic recommends soak periods, npm >= 12 (install scripts blocked by default), 2FA, token rotation | Elastic Security Labs |
| 20 | 2025-04 -> ongoing | **MCP tool poisoning / rug pulls / tool shadowing** (Invariant Labs PoC on Cursor, Apr 2025; MCPTox benchmark, arXiv 2508.14925: 20 LLM agents evaluated, o1-mini reached 72.8% attack success; the '36.5% average' figure is not in the abstract and was dropped) | Hidden instructions in MCP tool descriptions, changed after approval | Pin MCP server versions (never `@latest` for stdio servers), prefer HTTP servers from known vendors, review tool lists after updates | Claude Code: new MCP servers require trust; Anthropic reviews connectors for its Directory but "does not security-audit or manage any MCP server" | Invariant Labs, CSA |

Take-aways specific to this user's current inventory:
- The `playwright` plugin from the official marketplace runs `npx @playwright/mcp@latest` (unpinned; every session can pull a new version -> rug-pull surface). Consider a user-scope override pinned to an exact version.
- `caveman` marketplace source is `"./"` (unpinned). Add it with `claude plugin marketplace add JuliusBrussee/caveman@<tag-or-sha-ref>` or set `extraKnownMarketplaces.caveman.source.ref`.
- `~/.claude`, `~/.codex`, `~/.agents` are mode 775 on this host; `~/.codex/logs_2.sqlite`, `memories_1.sqlite`, `models_cache.json` are world-readable. Harden to 700/600 on multi-user hosts (Proxmox nodes, work hosts).
- Codex `[projects."/home/alexf"] trust_level = "trusted"` means `~/.codex/` is treated as a trusted project config when `codex` is started from `$HOME` (issue #9932); trust is exact-path, not recursive (issue #19426), so this does not auto-trust every cloned repo.
- `npm 9.2.0` (Ubuntu apt) predates `min-release-age` (npm >= 11.16) and default script blocking (npm 12.0.2 is current). The installer should prefer the vendors' native installers and, when it must use npm/npx, run with `--ignore-scripts` where possible and pin exact versions.

---

## 2. Verification primitives (with exact commands)

### 2.1 Claude Code native installer (Linux/macOS `install.sh`, Windows `install.ps1`)

Fetched and read `https://claude.ai/install.sh` (260 lines) and `install.ps1` (110 lines) on 2026-09-17. Facts:

- `set -e` (not `-u`/`pipefail`). Accepts `[stable|latest|VERSION]` validated by regex.
- **[verification note 2026-09-17] The version argument does not change what the shell script downloads.** Lines 148-149: `# Always download latest version (which has the most up-to-date installer)` / `version=$(download_file "$DOWNLOAD_BASE_URL/latest")`. The script SHA-256-verifies the *latest* binary as a bootstrap and then runs `"$binary_path" install ${TARGET:+"$TARGET"}`; the pinned version is fetched and installed by the binary's own `claude install` code (`~/.local/share/claude/versions/<ver>`), whose download verification is not visible in the script. `install.ps1` behaves the same (`$Target` defaults to `latest`, `& $binaryPath install $Target`). Consequence for the installer: after `install.sh <ver>` always re-verify `~/.local/share/claude/versions/<ver>` against the GPG-signed `manifest.json` of `<ver>` (done below), and do not describe the shell script as "verifying the pinned version".
- Refuses `sudo` unless `CLAUDE_INSTALL_ALLOW_SUDO=1` (installs into `$HOME`).
- Resolves `https://downloads.claude.ai/claude-code-releases/latest` (7-byte text; 2.1.273 on the research date, 2.1.274 on 2026-09-17), validates it looks like a version, downloads `$version/manifest.json`, extracts `platforms[<platform>].checksum` (jq or bash regex), downloads `$platform/claude` (or `claude.zst` if `zstd` present, verified against `manifest.zst.json`), verifies **SHA-256**, `chmod +x`, then runs `"$binary_path" install [target]`, deletes the download.
- **Does not download or verify `manifest.json.sig`.** So the stock path trusts the TLS channel to `downloads.claude.ai` (Google Cloud Storage). The manifest field `"manifestSignatureEnforcement": "flag"` indicates the binary may enforce signature checks behind a flag for its own auto-updates; not documented publicly.
- `install.ps1` does the same with `Invoke-RestMethod` + `Get-FileHash -Algorithm SHA256`; the docs also mention Authenticode: Windows binaries "signed by 'Anthropic, PBC'. Verify with `Get-AuthenticodeSignature .\claude.exe`"; macOS "signed by 'Anthropic PBC' and notarized by Apple. Verify with `codesign --verify --verbose ./claude`"; Linux binaries "are not individually code-signed".

Official documented verification (verbatim from `code.claude.com/docs/en/setup`):

```bash
curl -fsSL https://downloads.claude.ai/keys/claude-code.asc | gpg --import
gpg --fingerprint security@anthropic.com
# expect: 31DD DE24 DDFA B679 F42D  7BD2 BAA9 29FF 1A7E CACE
REPO=https://downloads.claude.ai/claude-code-releases
VERSION=2.1.89
curl -fsSLO "$REPO/$VERSION/manifest.json"
curl -fsSLO "$REPO/$VERSION/manifest.json.sig"
gpg --verify manifest.json.sig manifest.json
# A valid result reports `Good signature from "Anthropic Claude Code Release Signing <security@anthropic.com>"`
sha256sum claude              # Linux
shasum -a 256 claude          # macOS
(Get-FileHash claude.exe -Algorithm SHA256).Hash.ToLower()   # Windows
```

"Manifest signatures are available for releases from 2.1.89 onward." To verify an installed native binary: run the hash against `~/.local/share/claude/versions/VERSION`.

Verified locally (derived, executed 2026-09-17, temporary `GNUPGHOME`):

```
gpg: Good signature from "Anthropic Claude Code Release Signing <security@anthropic.com>"
Primary key fingerprint: 31DD DE24 DDFA B679 F42D  7BD2 BAA9 29FF 1A7E CACE
sha256sum ~/.local/share/claude/versions/2.1.273 -> 6c752e2cc7c110c9df15f26d8d134d438c5ae95dbd610efc1a308bf7f9c5f6c1  (== manifest linux-x64)
```

Recommended installer flow for Claude Code (derived; keeps the *official* installer as the executor while adding signature verification in front):

```bash
set -euo pipefail
umask 077
B=https://downloads.claude.ai/claude-code-releases
KEY_FPR=31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
export GNUPGHOME="$tmp/gnupg"; mkdir -m 700 "$GNUPGHOME"
curl --proto '=https' --tlsv1.2 -fsSL --retry 3 https://downloads.claude.ai/keys/claude-code.asc | gpg -q --import
gpg --with-colons --fingerprint | grep -q "^fpr:::::::::${KEY_FPR}:$" || { echo "unexpected signing key"; exit 1; }
ver=${CLAUDE_PIN:-$(curl --proto '=https' --tlsv1.2 -fsSL "$B/latest")}
[[ $ver =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]] || exit 1
curl --proto '=https' --tlsv1.2 -fsSL -o "$tmp/manifest.json"     "$B/$ver/manifest.json"
curl --proto '=https' --tlsv1.2 -fsSL -o "$tmp/manifest.json.sig" "$B/$ver/manifest.json.sig"
gpg --verify "$tmp/manifest.json.sig" "$tmp/manifest.json"        # hard fail if bad
# then run the official installer pinned to the version whose manifest you just verified:
curl --proto '=https' --tlsv1.2 -fsSL -o "$tmp/install.sh" https://claude.ai/install.sh
bash "$tmp/install.sh" "$ver"
# post-check: installed binary hash must equal the signed manifest's checksum
exp=$(jq -r ".platforms[\"linux-x64\"].checksum" "$tmp/manifest.json")
[ "$(sha256sum ~/.local/share/claude/versions/$ver | cut -d' ' -f1)" = "$exp" ] || { echo "binary hash mismatch"; exit 1; }
```

Other official channels (verbatim from setup docs): `brew install --cask claude-code` (stable) / `claude-code@latest`; `winget install Anthropic.ClaudeCode`; apt/dnf/apk repos signed by the same key (`https://downloads.claude.ai/keys/claude-code.asc`; apk key sha256 `395759c1f7449ef4cdef305a42e820f3c766d6090d142634ebdb049f113168b6`, confirmed locally). Windows: `irm https://claude.ai/install.ps1 | iex`; pinned: `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) 2.1.89`; CMD: `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`. Updates: `claude update`; channel `"autoUpdatesChannel": "stable"`; floor `"minimumVersion"`; `DISABLE_AUTOUPDATER=1` (keeps `claude update` working) vs `DISABLE_UPDATES` (blocks all). npm: `npm install -g @anthropic-ai/claude-code` (postinstall links a per-platform optional dependency; on npm 12 this needs `allow-scripts`).

### 2.2 Codex CLI official installer and release verification

Official commands (verbatim from `openai/codex` README): `curl -fsSL https://chatgpt.com/codex/install.sh | sh`; Windows `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`; `npm install -g @openai/codex`; `brew install --cask codex`.

Fetched `install.sh` (1,209 lines, POSIX `sh`, `set -eu`; byte-identical between `chatgpt.com/codex/install.sh` and the `rust-v0.154.0` release asset, sha256 `ba92dd27e5c06f0d3bbc58bfa4b9cfb6599cd2742fbb1f92a2765e6c07dedb5a`) and `install.ps1` (1,089 lines). Facts:

- Env/flags: `CODEX_RELEASE=<ver>` or `--release <ver>`; `CODEX_NON_INTERACTIVE=1`; `CODEX_INSTALL_DIR` (default `~/.local/bin`); `CODEX_HOME` (default `~/.codex`); `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM=0` to force GitHub.
- Resolves metadata from `https://releases.openai.com/codex/channels/latest` or `.../releases/<ver>/release.json` (falls back to GitHub API `releases/tags/rust-v<ver>`), reads per-asset `digest: sha256:...`, downloads `codex-package_SHA256SUMS` (verified against its digest), then the package archive `codex-package-<target>.tar.gz` verified against **both** the SUMS file and the metadata digest; fallback to GitHub if the OpenAI CDN copy fails verification. Installs under `~/.codex/packages/standalone/releases/<ver>-<target>` with a `current` symlink and `~/.local/bin/codex` symlink; lock file; `codex --version` post-check.
- Does **not** verify Sigstore bundles. The digests come over TLS from OpenAI/GitHub; integrity yes, origin authenticity only via TLS.
- Release workflow (`.github/workflows/rust-release.yml`): Linux `codex` and `codex-responses-api-proxy` (+ app-server, code-mode-host, bwrap) are signed with `cosign sign-blob --yes --bundle "${artifact}.sigstore"` (keyless, GitHub OIDC); macOS signed + notarized via Azure Key Vault/rcodesign; `codex-package_SHA256SUMS` generated; npm publish. GitHub release `rust-v0.154.0` (2026-09-09) shows **no "Immutable" badge** (immutable releases GA since 2025-10-28 but not enabled on openai/codex), so assets could theoretically be replaced post-publication; the Sigstore bundle + Rekor entry is the durable proof.

Verified locally (derived; cosign v3.1.3 downloaded to scratch dir, itself checksum-verified):

```bash
cosign verify-blob codex-x86_64-unknown-linux-musl \
  --bundle codex-x86_64-unknown-linux-musl.sigstore \
  --certificate-identity-regexp '^https://github\.com/openai/codex/\.github/workflows/rust-release\.yml@refs/tags/rust-v[0-9]+\.[0-9]+\.[0-9]+$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
# -> Verified OK   (also OK against ~/.codex/packages/standalone/current/bin/codex)
```

Certificate extensions observed in the bundle: repo `openai/codex`, ref `refs/tags/rust-v0.154.0`, commit `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`, workflow `rust-release`, runner `github-hosted`, Rekor logIndex `2773660716`. Bundle format is cosign's legacy `{base64Signature, cert, rekorBundle}`; `gh attestation verify` targets GitHub's attestation API (used by `actions/attest-build-provenance`), which openai/codex does not appear to use for release assets (unconfirmed, see open questions). For npm: `npm audit signatures` verifies registry signatures and provenance attestations of installed packages; `@openai/codex@0.154.0` provenance subject `pkg:npm/%40openai/codex@0.154.0`, built by `.github/workflows/rust-release.yml@refs/tags/rust-v0.154.0` on `https://github.com/actions/runner/github-hosted`.

Recommended installer flow for Codex (derived):

```bash
ver=${CODEX_PIN:-$(curl --proto '=https' --tlsv1.2 -fsSL https://releases.openai.com/codex/channels/latest | jq -r '.tag_name | sub("^rust-v";"")')}
curl --proto '=https' --tlsv1.2 -fsSL -o "$tmp/codex-install.sh" https://chatgpt.com/codex/install.sh
# optional: compare to the same-named release asset (should be identical)
curl --proto '=https' --tlsv1.2 -fsSL -o "$tmp/codex-install.release.sh" "https://github.com/openai/codex/releases/download/rust-v$ver/install.sh"
cmp -s "$tmp/codex-install.sh" "$tmp/codex-install.release.sh" || echo "WARN: chatgpt.com installer differs from release asset"
CODEX_NON_INTERACTIVE=1 CODEX_RELEASE="$ver" sh "$tmp/codex-install.sh"
# post-install Sigstore verification of the installed binary (Linux)
curl --proto '=https' --tlsv1.2 -fsSL -o "$tmp/codex.sigstore" "https://releases.openai.com/codex/releases/$ver/codex-x86_64-unknown-linux-musl.sigstore"
cosign verify-blob ~/.codex/packages/standalone/current/bin/codex --bundle "$tmp/codex.sigstore" \
  --certificate-identity "https://github.com/openai/codex/.github/workflows/rust-release.yml@refs/tags/rust-v$ver" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Updates: `codex update` (subcommand exists in 0.154.0); `check_for_update_on_startup` (default true); features `in_app_updates`. macOS: `codesign --verify --verbose "$(readlink -f "$(command -v codex)")"` and `spctl -a -vv` for notarization (standard Apple tooling; not quoted from OpenAI docs).

### 2.3 npm / npx hygiene (for `skills`, `@caveman-ai/cli`, MCP servers via `npx`)

- npm 12.0.2 is current (released 2026-07-08): **install-time lifecycle scripts of dependencies are off by default** (`allow-scripts` list; `npm approve-scripts --allow-scripts-pending` to list pending; `strict-allow-scripts=true` turns warnings into errors). `min-release-age=<days>` (default `null`) "only versions that were available more than the given number of days ago will be installed". `ignore-scripts=true` still works everywhere.
- Verify: `npm audit signatures` (registry signatures + provenance for installed packages); `npm view <pkg>@<ver> dist.attestations` before installing.
- Pin exact versions in the installer (`npm i -g skills@1.5.26`, `npx --yes @playwright/mcp@0.x.y`), never `@latest` in a stdio MCP `command`. The `@playwright/mcp@latest` in the official playwright plugin is the one unpinned item in the user's set.
- Allowlist exact package names (`@openai/codex`, `@anthropic-ai/claude-code`, `skills`, `@caveman-ai/cli`, `@playwright/mcp`); refuse anything else that "looks like" them (typosquat #17).
- Upgrade npm on Ubuntu hosts (apt npm 9.2.0 lacks all of the above): `npm install -g npm@12` via the installer (verified with `npm audit signatures` afterwards), or use `bun`/`corepack` with the same pinning rules.

### 2.4 Plugins and marketplaces (Claude Code)

- `claude plugin marketplace add <owner/repo>[@ref | #ref | ./path | https://.../marketplace.json] [--scope user|project|local] [--sparse ...]`; `claude plugin install <plugin>@<marketplace> [--scope] [--yes] [--accept-command <sha256>]`; `claude plugin update <plugin>@<marketplace>`; `claude plugin marketplace update <name>`; `claude plugin details`; `claude plugin list`.
- Pinning: plugin `source` objects support `"ref"` (branch/tag) and `"sha"` (40-char; "When both are set: the sha is the effective pin"). Marketplace sources support `ref` **not** `sha`. Official marketplace: 305 plugins; 253 git sources carry a `sha` (95 `git-subdir` + 1 `git-subdir`, 157 `url`); 52 are relative paths inside the repo (e.g. `./external_plugins/playwright`, `./plugins/security-guidance`).
- Auto-update: official marketplaces auto-update by default; third-party/local do not; `DISABLE_AUTOUPDATER=1` disables both Claude and plugin updates; `FORCE_AUTOUPDATE_PLUGINS=1` keeps plugin updates on; `command`-source plugins re-run once per session and install when the output hash changes; `headersHelper` plugins are never auto-updated.
- Trust/acceptance: `command` sources require explicit acceptance of the command string on each install/update (`--yes` or `--accept-command <sha256>` non-interactively); managed settings `disableCommandPluginSources`, `allowManagedHooksOnly`, `disableSideloadFlags`, `strictKnownMarketplaces` (allowlist; `[]` = lockdown), `blockedMarketplaces`, `pluginSuggestionMarketplaces` (note: `allowedPlugins`/`blockedPlugins` do NOT exist in the settings reference; per-plugin control is `enabledPlugins` in managed settings). Reserved names block impersonation (`claude-plugins-official`, `anthropic-plugins`, `agent-skills` ...).
- Vetting statements: official marketplace "curated by Anthropic, and inclusion is at Anthropic's discretion"; "External plugins must meet quality and security standards for approval" (README); but "Anthropic doesn't control what MCP servers, files, or other software are included in plugins and can't verify that they work as intended". Community marketplace: "passed Anthropic's automated validation and safety screening. Each plugin is pinned to a specific commit SHA".
- Not security tools despite the names: `claude plugin eval` (behavioral evals of a plugin, CI gating on score) and `/skill-doctor` (context-cost/usage stats). Do not describe them as malware screening.
- What runs before trust (permissions doc): when you trusted only a parent folder, or in `claude -p`/SDK, **hooks in settings files, the `env` block, `apiKeyHelper` and project-skill hooks are used**; `permissions.allow`, `extraKnownMarketplaces`, subagent frontmatter hooks/MCP are not; `.mcp.json` servers prompt (interactive) or **connect without asking in `claude -p`**. Therefore the installer must never invoke `claude -p` / `claude plugin ...` from inside an untrusted checkout; run from `$HOME` or a clean dir, or use `--bare` / `--setting-sources user` / `--settings '{"disableAllHooks": true}'`.
- Trust is recorded in `~/.claude.json` at `projects["<path>"].hasTrustDialogAccepted`.

### 2.5 Skills (skills.sh / `skills` CLI) and Codex skills

- Install: `npx skills add <owner/repo> --skill <name> -g -a claude-code -a codex -y` (verbatim example: `npx skills add vercel-labs/agent-skills --skill frontend-design -g -a claude-code -y`); `--json -y` for machine output; `npx skills update [-g|-p] [-y]` (`check` and `upgrade` are undocumented aliases of `update` in src/cli.ts, i.e. `npx skills check` is NOT a read-only drift check, it runs the same `runUpdate`); direct URLs limited to 10 MiB download / 25 MiB extracted / 1000 files (`SKILLS_DOWNLOAD_MAX_BYTES` etc.).
- Audit behaviour (source `src/telemetry.ts`, `src/add.ts` @ commit `e7354a26` 2026-09-16): `fetchAuditData` hits `https://add-skill.vercel.sh/audit`, 3 s timeout, "Returns null on any error or timeout - never blocks installation", only for GitHub-confirmed-public repos, disabled when `DISABLE_TELEMETRY`/`DO_NOT_TRACK` is set; results rendered as a "Security Risk Assessments" note (Gen `ath`, Socket, Snyk, ZeroLeaks; labels Critical/High/Med/Low) **after** which `Proceed with installation?` is asked unless `-y`. Comment in source: "security info is advisory only". `--json` output includes a per-skill `security` object.
- Gate before install (derived, worked on 2026-09-17): `curl -fsS "https://add-skill.vercel.sh/audit?source=JuliusBrussee/caveman&skills=caveman,caveman-commit"` -> `{"caveman":{"ath":{"risk":"safe"},"socket":{"risk":"safe","alerts":0,"score":90},"snyk":{"risk":"low"},"zeroleaks":{"risk":"safe","score":93}}, ...}`. Unknown skills return `{}`. Treat `critical`/`high` from any partner as "opt-in only, show the reason".
- Lock file: `~/.agents/.skill-lock.json` v3 with `source`, `sourceType`, `sourceUrl`, `skillPath`, `skillFolderHash` (= GitHub tree SHA for the folder; "changes when ANY file in the skill folder changes"), `installedAt`, `updatedAt`. It detects upstream drift during `skills update`; it is not a signature and does not pin what `add` fetches. For reproducibility, the installer should record `skillFolderHash` and compare after install.
- Codex: skills under `~/.codex/skills` (system skills in `.system`), features `skill_search`, `skill_mcp_dependency_install` (installs MCP deps declared by a skill), `skill_env_var_dependency_prompt`, `skip_host_skill_discovery`; `skills.config.<name>.enabled` in config.toml. Plugins: `codex plugin marketplace add <path | owner/repo[@ref] | git URL> [--ref <REF>] [--sparse <PATH>]`, `codex plugin add PLUGIN@MARKETPLACE`, `codex plugin marketplace upgrade`, `codex plugin remove`; `[[marketplaces]]` entries in config with `source`, `source_type`, `ref`, `sparse_paths`; `plugins.<name>.enabled`; `allow_managed_hooks_only = true` (only in `requirements.toml`) to ignore user/project/session hooks.

### 2.6 GitHub-side primitives

- **Immutable releases** (GA 2025-10-28): assets cannot be added/modified/deleted, tag locked, automatic release attestation. Check for the "Immutable" lock badge; openai/codex does not use it (as of rust-v0.154.0). Anthropic ships Claude Code outside GitHub Releases entirely.
- `gh attestation verify <file> --repo <owner/repo>` works only for artifacts attested through GitHub's attestation API; for cosign legacy bundles use `cosign verify-blob --bundle`.
- Pin git checkouts of marketplaces/skills to commit SHAs in your own lock file; `git -C <dir> rev-parse HEAD` after each `claude plugin marketplace update` and diff.

---

## 3. Secret handling

### 3.1 What the tools do today

| Tool | Linux | macOS | Windows | Options |
|------|-------|-------|---------|---------|
| Claude Code (claude.ai login / Console key) | `~/.claude/.credentials.json` mode 0600 (observed locally: `claudeAiOauth.{accessToken,refreshToken,...}` plaintext) | Keychain; falls back to `~/.claude/.credentials.json` 0600 when Keychain is locked (SSH) | `%USERPROFILE%\.claude\.credentials.json`, profile ACLs | `CLAUDE_CONFIG_DIR` relocates it; `apiKeyHelper` (shell string; re-run every 5 min or `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`); `ANTHROPIC_API_KEY` (one-time approval prompt), `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` (1-year token; "It does not save the token anywhere"); precedence: cloud provider > `ANTHROPIC_AUTH_TOKEN` > `ANTHROPIC_API_KEY` > `apiKeyHelper` > `CLAUDE_CODE_OAUTH_TOKEN` > profiles > `/login` |
| Claude Code MCP OAuth client secrets | "stored securely in your system keychain (macOS) or a credentials file, not in your config" | Keychain | credentials file | `--client-secret` prompts masked or reads `MCP_CLIENT_SECRET` |
| Codex CLI | `~/.codex/auth.json` 0600 (`file`, default) or Secret Service (`keyring`) | Keychain | Credential Manager | `cli_auth_credentials_store = "file" | "keyring" | "auto" | "ephemeral"`; `mcp_oauth_credentials_store = "auto" | "file" | "keyring"` (default auto); `codex login --with-api-key` (reads stdin: `printenv OPENAI_API_KEY | codex login --with-api-key`), `codex login --device-auth`, `--with-access-token`; docs: "treat `~/.codex/auth.json` like a password" |

Known Codex keyring issues: #14704 silent fallback to plaintext when keyring unavailable and stale file left on disk; `OpenOptions::mode(0o600)` applies only on create (a pre-existing 0644 file stays 0644); #20871 stale `auth.json` on Linux VMs; #28201 Windows Credential Manager payload-size transition. `auto` is the pragmatic choice on desktops; `keyring` (fail-closed) on hosts with a running Secret Service; `file` with the installer enforcing `chmod 600` on headless nodes.

### 3.2 OS stores and vault CLIs (commands)

- Linux libsecret: `secret-tool store --label='Anthropic API key' service anthropic account default` (reads the secret from stdin) / `secret-tool lookup service anthropic account default`. Needs a Secret Service (gnome-keyring/KWallet/`keepassxc`) on the session D-Bus; headless/SSH sessions usually have none (`DBUS_SESSION_BUS_ADDRESS` unset or daemon locked). `secret-tool` is **not installed** on the reference host (`libsecret-tools` package).
- Linux headless alternative with no daemon: `systemd-creds` (systemd 259 present): `systemd-creds encrypt --name=anthropic_api_key - ~/.config/agents/anthropic.cred` (stdin) and `systemd-creds decrypt ~/.config/agents/anthropic.cred -`; encrypted with the host key/TPM2 (host-bound, so a `.cred` copied to another node will not decrypt; system scope needs root unless `--user` is supported on your version, check `systemd-creds --help`).
- Windows: DPAPI via PowerShell (built-in, no module): `Get-Credential | Export-Clixml $env:APPDATA\agents\anthropic.credential` and `(Import-Clixml ...).GetNetworkCredential().Password`; "only your user account on only that computer can decrypt" (docs). `cmdkey` can store but cannot print secrets back (not usable as a helper). `Microsoft.PowerShell.SecretManagement` 1.1.2 + `SecretStore` 1.0.6: `Install-PSResource Microsoft.PowerShell.SecretManagement`, `Install-PSResource Microsoft.PowerShell.SecretStore`, `Register-SecretVault -Name SecretStore -ModuleName Microsoft.PowerShell.SecretStore -DefaultVault`, `Set-Secret -Name TestSecret -Secret "..."`, `Get-Secret -Name TestSecret -AsPlainText` - Microsoft states the modules are "feature complete and will no longer be actively developed ... repository has been archived" (still security-fixed). `pwsh` is missing on the reference host; Windows PowerShell 5.1 suffices for DPAPI.
- macOS: `security add-generic-password -a "$USER" -s anthropic-api-key -w` (prompts) and `security find-generic-password -a "$USER" -s anthropic-api-key -w` (standard Apple CLI; not vendor-quoted).
- 1Password: `op run --env-file="./prod.env" -- <cmd>` with `op://vault/item/field` references; `MY_VAR=op://vault/item/field op run --no-masking -- sh -c 'echo "$MY_VAR"'`; for `apiKeyHelper`: `"apiKeyHelper": "op read op://Private/Anthropic/credential"`.
- Bitwarden Secrets Manager: `bws run -- 'npm run start'`, `bws secret get <uuid>`, auth via `BWS_ACCESS_TOKEN`.

### 3.3 Rules for the installer

1. Never write API keys into `~/.claude.json`, `~/.claude/settings.json` `env`, `.mcp.json`, `~/.codex/config.toml`, or shell rc files. Prefer: OS/vault store + `apiKeyHelper` (Claude), `printenv OPENAI_API_KEY | codex login --with-api-key` from a vault-injected env (Codex), `${VAR}` / `${VAR:-}` expansion and `headersHelper` for MCP servers (e.g. the official context7 plugin uses `"Authorization": "${CONTEXT7_API_KEY:-}"`).
2. If a file must hold a secret (headless node): `umask 077`, write to a temp file in the same directory, `chmod 600`, `mv -f` (atomic), never `echo $KEY > file` on a shared shell with history; on Windows set an ACL for the current user only (`icacls <file> /inheritance:r /grant:r "$env:USERNAME:(R,W)"`).
3. Enforce directory modes: `chmod 700 ~/.claude ~/.codex ~/.agents` (currently 775 on the reference host) and `chmod 600` on sqlite/json files under `~/.codex`.
4. Never pass secrets as CLI arguments (visible in `ps`); use stdin or env.
5. Do not set `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL` from project-level files; the installer should refuse to import a settings fragment that contains `ANTHROPIC_BASE_URL`, `apiKeyHelper`, `awsAuthRefresh`, or `hooks` unless the user explicitly confirms each one (CVE-2026-21852 class).
6. After any npm compromise notice on a host: `/logout` + `codex logout` and rotate; CHAINDROP/Mini Shai-Hulud specifically harvest Anthropic/Claude/Codex/OpenAI tokens and refresh tokens "do not expire".
7. Keep secrets out of the installer's own lock file and logs; redact `Authorization`, `sk-ant-`, `sk-`, `ghp_` patterns in any log the installer writes.

---

## 4. Hardening checklist for the installer script itself

| # | Practice | Verdict | Concrete implementation |
|---|----------|---------|--------------------------|
| 1 | Download-then-inspect-then-execute; never `curl ... | bash` *inside* the script | must-have | `curl --proto '=https' --tlsv1.2 -fsSL --retry 3 -o "$tmp/install.sh" URL`; `--inspect` flag prints the file (or `$PAGER`) and its sha256 before running. Rationale: a server can detect piped execution (timing/`sleep` trick, PoCs since 2016) and serve different bytes. |
| 2 | Pin the *installer itself* to a git tag + sha256; self-update through the same path | must-have | Publish `install.sh` + `install.sh.sha256` (+ optional `cosign sign-blob --bundle`) on an **immutable** GitHub release; bootstrap one-liner downloads the tagged asset, checks the hash embedded in the one-liner (`echo "<sha256>  install.sh" | sha256sum -c`), then runs. `--self-update` fetches the next tag, verifies, replaces atomically. |
| 3 | Vendor-signature verification in front of vendor installers | must-have | Claude: PGP on `manifest.json` (2.1); Codex: `cosign verify-blob --bundle` on installed binary (2.2), SHA256SUMS is done by the vendor script. Fail closed; `--no-verify` only with an explicit interactive confirmation and a red warning. |
| 4 | Shell strictness | must-have | `#!/usr/bin/env bash`, `set -euo pipefail`, `IFS=$'\n\t'`, `umask 077`, `trap cleanup EXIT INT TERM`, `mktemp -d`, quote everything, `shellcheck -S style` in CI, `bash -n`. PowerShell: `Set-StrictMode -Version Latest`, `$ErrorActionPreference='Stop'`, `[Net.ServicePointManager]::SecurityProtocol = 'Tls12,Tls13'`. |
| 5 | No `sudo curl | bash`; refuse root unless asked | must-have | Mirror Claude's check: if `id -u` = 0 and `SUDO_USER` set, abort with instructions; both tools install into `$HOME`. Only the optional apt/dnf repo setup needs sudo, and it must be a separate, explicit step. |
| 6 | TLS correctness | must-have | `--proto '=https' --tlsv1.2`, never `-k/--insecure`; honour corporate CA via `SSL_CERT_FILE`/`CURL_CA_BUNDLE`/`NODE_EXTRA_CA_CERTS`; no HTTP fallbacks; validate that "latest" responses look like versions (Claude's installer does this). |
| 7 | Allowlist of sources | must-have | Hard-coded allowlist of marketplaces (`anthropics/claude-plugins-official`, `anthropics/claude-plugins-community`, `JuliusBrussee/caveman@<ref>`, ...), skills repos (`owner/repo`), npm package names (exact) and MCP server commands/URLs. Anything else requires `--allow-source <x>` and is stored in the lock file with a `user-added` tag. |
| 8 | Pin everything, record a lock file | must-have | `~/.config/agent-installer/lock.json`: Claude version + manifest checksum + sig fingerprint; Codex version + sha256 + Rekor logIndex; each plugin `name@marketplace` + resolved commit SHA (`git -C ~/.claude/plugins/marketplaces/<m> rev-parse HEAD`) + plugin `sha`; each skill + `skillFolderHash`; npm package exact versions. `--update` diffs old vs new and shows what changed before applying. |
| 9 | Settings writes are a security boundary | must-have | Merge with `jq` from a checked-in template; refuse to add hooks/MCP `command`s not in the allowlist; write with `umask 077`; back up prior file (`settings.json.bak-<ts>`); show a unified diff and require confirmation on update; never write `permissions.defaultMode: bypassPermissions` or `enableAllProjectMcpServers: true` into project/shared files; keep `skipDangerousModePermissionPrompt` user-scope only. |
| 10 | Hook/MCP integrity check on every run | recommended | Compare `hooks` and `mcpServers` in `~/.claude/settings.json`, `~/.claude.json`, `~/.codex/config.toml` against the lock file; flag anything unknown (Mini Shai-Hulud/CHAINDROP persistence pattern). Optionally install a Claude `ConfigChange` hook that logs/blocks settings edits during sessions. |
| 11 | Skill pre-screen | recommended | Query `add-skill.vercel.sh/audit` before `npx skills add`; treat `critical`/`high` as opt-in with the reason shown; grep SKILL.md and bundled scripts for `curl ... | (ba)?sh`, `base64 -d`, `rentry.co`, `glot.io`, `webhook.site`, zero-width/unicode-hidden text, `Invoke-Expression`; enforce size limits (keep the CLI's 10/25 MiB defaults). Do not set `DISABLE_TELEMETRY` for the `skills` CLI if you want audits (they share the switch). |
| 12 | npm hygiene | recommended | Upgrade to npm >= 12 on the host; `npm config set min-release-age 7` (or per-invocation `--min-release-age=7`); `--ignore-scripts` for anything that does not need scripts; exact versions; `npm audit signatures` after global installs; allowlist package names. |
| 13 | Never run the agents inside an untrusted directory during install | must-have | `cd "$HOME"` (or a fresh `mktemp -d`) before `claude plugin ...`, `claude mcp ...`, `codex plugin ...`; pass `--setting-sources user`/`--bare` for any `claude -p` you must run; never use `claude -p` to "test" a plugin in a repo you did not write. |
| 14 | Dry-run and plan output | must-have | `--dry-run` prints the full plan (URLs, versions, hashes, files to be written, commands that will run via hooks/MCP) and exits 0; `--yes` accepts the default plan only after a plan has been printed once. |
| 15 | Trust prompts: what to show | must-have | Per item: source (owner/repo@ref or npm name@version), what it installs (skills/agents/hooks/MCP/LSP: reuse `claude plugin details` / `/plugin` "Will install" data), audit labels, the exact shell command strings of hooks and stdio MCP servers, and whether it can auto-update. Default `[Y]` for official/pinned/`safe`; default `[n]` for `command`-source plugins, unpinned `@latest` MCP servers, third-party marketplaces without a ref, and any `high`/`critical` audit. Use `gum choose --no-limit` when present, fall back to `read -r`. |
| 16 | Least privilege for update channels | recommended | Claude: `"autoUpdatesChannel": "stable"` + `"minimumVersion"` on work hosts; `DISABLE_AUTOUPDATER=1` + `FORCE_AUTOUPDATE_PLUGINS=1` only if you want the installer to be the single update path. Codex: `check_for_update_on_startup = false` only when the installer manages updates. |
| 17 | Multi-user hosts (Proxmox nodes, shared VMs) | recommended | `chmod 700 ~/.claude ~/.codex ~/.agents`; on Windows never create `C:\ProgramData\ClaudeCode` without admin-only ACLs (CVE-2026-35603); do not run agents as root on nodes; prefer per-user installs. |
| 18 | Logging and secrets | must-have | Redact tokens in logs; never `set -x` around auth; write logs 0600 under `~/.local/state/agent-installer/`. |
| 19 | Reproducibility across hosts | recommended | Ship the lock file and let `install.sh --from-lock lock.json` reproduce exact versions/SHAs on a new host; `--check` verifies the installed state against the lock (binary hashes, plugin SHAs, skill tree hashes). |
| 20 | Rollback | optional | Keep the previous Claude version dir (`~/.local/share/claude/versions/<prev>` already retained) and Codex `releases/<prev>` and let `--rollback` re-point the symlinks. |

### Reference implementation sketch (derived)

```bash
#!/usr/bin/env bash
# agent-installer v0.1.0 -- bootstrap: curl -fsSLO https://github.com/<you>/agent-installer/releases/download/v0.1.0/install.sh \
#   && echo "<sha256>  install.sh" | sha256sum -c && bash install.sh --dry-run
set -euo pipefail; IFS=$'\n\t'; umask 077
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT INT TERM
[[ $(id -u) -eq 0 && -n ${SUDO_USER:-} ]] && { echo "do not run with sudo" >&2; exit 1; }
CURL=(curl --proto '=https' --tlsv1.2 -fsSL --retry 3)
cd "$HOME"   # never operate inside an untrusted repo
# 1. Claude: verify signed manifest, then run official installer pinned to that version (see 2.1)
# 2. Codex: run official installer pinned, then cosign verify-blob installed binary (see 2.2)
# 3. Marketplaces (allowlisted, pinned): claude plugin marketplace add anthropics/claude-plugins-official
#    claude plugin marketplace add JuliusBrussee/caveman@<ref>
# 4. Plugins: for p in "${PLUGINS[@]}"; do claude plugin install "$p" --scope user; done  (--yes only for allowlisted command sources)
# 5. Skills: audit-gate, then npx skills@1.6.0 add owner/repo --skill x -g -a claude-code -a codex -y --json
# 6. MCP: claude mcp add-json ... with ${VAR} refs, never literal keys; codex: [mcp_servers.*] with env refs
# 7. Write lock.json; print diff vs previous lock; chmod 700 ~/.claude ~/.codex ~/.agents
```

---

## 5. Items (per practice/tool) - see structured output for verdicts

Summarised in the tables above; the structured output lists 30+ items with verdicts (must-have / recommended / optional / skip / deprecated), install/update commands and sources.

---

## 6. Open questions

1. `manifestSignatureEnforcement: "flag"` in Claude's manifest: undocumented; unknown whether the binary's auto-updater already verifies `manifest.json.sig` and when enforcement becomes mandatory.
2. Whether openai/codex also publishes GitHub attestations (`gh attestation verify --repo openai/codex`) in addition to cosign bundles: GitHub API calls were rate-limited/unauthenticated during research; the release workflow shows `cosign sign-blob` only.
3. Codex Windows binaries: the release workflow delegates to `rust-release-windows.yml`; Authenticode signing was not confirmed from fetched sources (`Get-AuthenticodeSignature` on `codex.exe` should be checked on a Windows host).
4. CVE-2026-35020/35021/35022 (Phoenix Security write-up) do not appear in the anthropics/claude-code advisory list fetched; patch status unknown.
5. `add-skill.vercel.sh/audit` is undocumented; stability of the endpoint and rate limits unknown.
6. Codex `secret_auth_storage` feature flag (present in the user's stable-feature list and in `config-schema.json` as a boolean) has no public description in the config reference; relationship to `cli_auth_credentials_store` unclear.
7. `systemd-creds --user` availability/behaviour on Ubuntu 26.04 (systemd 259) for per-user encrypted credentials was not exercised.
8. Whether Anthropic's community marketplace "automated validation and safety screening" includes third-party scanners (Socket/Snyk) is not stated.

---

## 7. Sources (fetched 2026-09-16/17)

Vendor installers, manifests, signatures
- https://claude.ai/install.sh (read in full), https://claude.ai/install.ps1
- https://downloads.claude.ai/claude-code-releases/latest ; /2.1.273/manifest.json ; /2.1.273/manifest.json.sig ; /2.1.273/manifest.zst.json
- https://downloads.claude.ai/keys/claude-code.asc ; https://downloads.claude.ai/keys/claude-code.rsa.pub
- https://code.claude.com/docs/en/setup (Binary integrity and code signing; apt/dnf/apk; Homebrew/WinGet; versions; auto-update)
- https://chatgpt.com/codex/install.sh ; https://chatgpt.com/codex/install.ps1 ; https://github.com/openai/codex/releases/download/rust-v0.154.0/{install.sh,codex-package_SHA256SUMS,codex-x86_64-unknown-linux-musl.sigstore,codex-x86_64-unknown-linux-musl.tar.gz,codex-package-x86_64-unknown-linux-musl.tar.gz,config-schema.json}
- https://releases.openai.com/codex/channels/latest ; https://releases.openai.com/codex/releases/0.154.0/release.json
- https://raw.githubusercontent.com/openai/codex/main/README.md ; /docs/install.md ; /docs/config.md ; /.github/workflows/rust-release.yml ; /.github/actions/linux-code-sign/action.yml
- https://github.com/openai/codex/releases/tag/rust-v0.154.0 ; https://github.com/openai/codex/releases/expanded_assets/rust-v0.154.0
- https://registry.npmjs.org/@openai/codex/latest ; https://registry.npmjs.org/-/npm/v1/attestations/@openai%2fcodex@0.154.0 ; https://registry.npmjs.org/@anthropic-ai/claude-code/latest ; https://registry.npmjs.org/skills/latest ; https://registry.npmjs.org/npm/latest
- https://docs.sigstore.dev/cosign/verifying/verify/ ; cosign v3.1.3 release (`cosign-linux-amd64`, `cosign_checksums.txt`)

Docs: trust, plugins, MCP, auth, security
- https://code.claude.com/docs/en/plugin-marketplaces.md ; /discover-plugins.md ; /permissions.md ("What runs before you trust a folder") ; /security.md ; /authentication ; /mcp.md ; https://code.claude.com/docs/llms.txt
- https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json ; .../external_plugins/playwright/.mcp.json ; .../external_plugins/context7/.mcp.json ; .../README.md ; https://raw.githubusercontent.com/JuliusBrussee/caveman/main/.claude-plugin/marketplace.json
- https://learn.chatgpt.com/docs/auth (redirect of developers.openai.com/codex/auth) ; https://learn.chatgpt.com/docs/config-file/config-reference ; https://learn.chatgpt.com/docs/config-file/config-basic ; https://learn.chatgpt.com/docs/plugins ; local `codex plugin --help`, `codex plugin marketplace add --help`, `codex plugin add --help`, `codex update --help`, `codex login --help`, `codex doctor --help`
- https://github.com/vercel-labs/skills (README; src/telemetry.ts, src/add.ts, src/skill-lock.ts at commit e7354a26dea1cd74ab7969f2c67e6cdb01784bf8) ; https://vercel.com/changelog/automated-security-audits-now-available-for-skills-sh ; https://add-skill.vercel.sh/audit (live query)
- https://docs.npmjs.com/cli/v12/using-npm/config/ ; https://docs.npmjs.com/cli/v12/commands/npm-audit/ ; https://socket.dev/blog/npm-12
- https://www.1password.dev/cli/secrets-environment-variables/ ; https://bitwarden.com/help/secrets-manager-cli/ ; https://learn.microsoft.com/en-us/powershell/utility-modules/secretmanagement/get-started/using-secretstore ; https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/export-clixml?view=powershell-7.5
- https://github.blog/changelog/2025-10-28-immutable-releases-are-now-generally-available/ ; https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/immutable-releases

Advisories and incidents
- https://github.com/anthropics/claude-code/security/advisories (pages 1-3) ; GHSA-mmgp-wc2j-qcv7 (CVE-2026-33068) ; GHSA-5cwg-9f6j-9jvx (CVE-2026-35603)
- https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/ ; https://phoenix.security/claude-code-leak-to-vulnerability-three-cves-in-claude-code-cli-and-the-chain-that-connects-them/
- https://github.com/advisories/GHSA-xrxf-jgv3-qmrm (CVE-2025-61260) ; https://github.com/openai/codex/security/advisories ; https://github.com/advisories/GHSA-8q5r-mmjf-575q (CVE-2026-47751)
- https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html ; https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/ ; https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/
- https://labs.cloudsecurityalliance.org/research/csa-research-note-shai-hulud-ai-supply-chain-20260517-csa-st/ ; https://www.elastic.co/security-labs/shai-hulud-chaindrop-npm-supply-chain ; https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-developer-supply-chain-codexui-20260601/ ; https://securitylabs.datadoghq.com/articles/shai-hulud-2.0-npm-worm/
- https://snyk.io/blog/malicious-mcp-server-on-npm-postmark-mcp-harvests-emails/ ; https://www.theregister.com/security/2025/09/29/fake-postmark-mcp-npm-package-stole-emails-with-one-liner/
- https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks ; https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-ai-agent-exfiltration-2/
- https://github.com/Stijn-K/curlbash_detect (curl|bash server-side detection PoC)
- Codex GitHub issues: #14704 (keyring silent fallback), #20871, #28201, #9932 (`~/.codex` as project config from $HOME), #19426 (no recursive trust)

---

## Verification (independent fact-check, 2026-09-17)

Method: every install/verify artifact was re-fetched from the primary source with `curl` (scripts, manifests, keys, `marketplace.json`, npm registry, `releases.openai.com`) or WebFetch (GitHub pages, advisories, vendor blogs); GPG and cosign checks were re-executed in a scratch directory; `claude`/`codex --help` were run locally (no state mutated). The GitHub REST API was rate-limited (60/60 core used, `gh` token invalid), so star counts come from the GitHub HTML pages via WebFetch.

### Confirmed as written (spot list)
- `https://claude.ai/install.sh`: 260 lines, `set -e`, sudo refusal gated on `CLAUDE_INSTALL_ALLOW_SUDO`, SHA-256 from `manifest.json`/`manifest.zst.json`, no `.sig` handling, MINGW/MSYS/CYGWIN rejected. sha256 of the script on 2026-09-17: `3a68d3406cf674e17bed1733a4dcf37805e2e47d87417700007d7e1aa766a944`.
- `install.ps1`: 110 lines, `$Target = "latest"` default, `Get-FileHash -Algorithm SHA256`, `& $binaryPath install $Target`.
- Signing key: fingerprint `31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE`, rsa4096, uid "Anthropic Claude Code Release Signing <security@anthropic.com>", created 1774907248 = 2026-03-30 21:47:28 UTC. `gpg --verify` -> Good signature for both 2.1.273 (made 2026-09-15) and 2.1.274 (made 2026-09-16). Installed `~/.local/share/claude/versions/2.1.273` sha256 `6c752e2c…f6c1` == manifest linux-x64. apk key sha256 `395759c1…68b6` matches docs.
- `manifest.json` 2.1.273 contains `"manifestSignatureEnforcement": "flag"`, `commit`, `modsCommit`, `buildDate 2026-09-15T17:19:22Z`.
- Docs (`code.claude.com/docs/en/setup.md`): all one-liners, `bash -s 2.1.89`, `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) 2.1.89`, `install.cmd 2.1.89`, brew/winget, apt/dnf/apk blocks, `autoUpdatesChannel`, `minimumVersion`, `DISABLE_AUTOUPDATER` vs `DISABLE_UPDATES`, "Manifest signatures are available for releases from `2.1.89` onward", macOS "Anthropic PBC" notarized, Windows "Anthropic, PBC" Authenticode, Linux not individually signed.
- Codex `install.sh` from `chatgpt.com` and the `rust-v0.154.0` release asset are byte-identical (sha256 `ba92dd27e5c06f0d3bbc58bfa4b9cfb6599cd2742fbb1f92a2765e6c07dedb5a`), 1,209 lines, `set -eu`, env vars as listed, plus `--release VERSION` flag (`Usage: install.sh [--release VERSION]`).
- `releases.openai.com/codex/channels/latest` -> `tag_name: rust-v0.154.0`, 160 assets; `releases/0.154.0/release.json` lists `codex-x86_64-unknown-linux-musl.sigstore`, `codex-package_SHA256SUMS`, `install.sh`, `install.ps1`.
- cosign v3.1.3 `verify-blob` of `~/.codex/packages/standalone/current/bin/codex` (sha256 `3188814c…4022`) with the 0.154.0 bundle -> `Verified OK`; Rekor logIndex 2773660716.
- `.github/actions/linux-code-sign/action.yml` uses `cosign sign-blob --bundle "${artifact}.sigstore"`; `rust-release.yml` signs/notarizes macOS with rcodesign + Azure Key Vault.
- npm: `@openai/codex@0.154.0` has SLSA v1 provenance from `.github/workflows/rust-release.yml@refs/tags/rust-v0.154.0`; `@anthropic-ai/claude-code` latest (now 2.1.274) has 2 registry signatures and `dist.attestations: null`.
- npm 12: `npm@12.0.2` is latest; 12.0.0 published 2026-07-08T21:06Z, 11.16.0 on 2026-05-27. Docs: "Dependency install scripts are blocked by default. Install commands silently skip lifecycle scripts for any dependency that does not have a matching entry in `allowScripts`"; `npm approve-scripts <pkg>… | --all | --allow-scripts-pending`; `strict-allow-scripts` (default false); `min-release-age` (default null).
- Codex CLI 0.154.0 `--help`: `codex plugin marketplace add [OPTIONS] <SOURCE>` (local path, `owner/repo[@ref]`, HTTPS/SSH git URL; `--ref`, `--sparse` repeatable, `--json`), `codex plugin add <PLUGIN[@MARKETPLACE]>`, `marketplace list|upgrade|remove`, `codex update`, `codex doctor`, `codex login --with-api-key` ("Read the API key from stdin (e.g. `printenv OPENAI_API_KEY | codex login --with-api-key`)"), `--device-auth`.
- Codex docs: `cli_auth_credentials_store` = file (default) | keyring | auto (config-schema description); `mcp_oauth_credentials_store` keyring | file | auto (default); auth page quotes "Treat `~/.codex/auth.json` like a password"; `projects.<path>.trust_level` `"trusted"|"untrusted"`, untrusted projects skip project `.codex/` config/hooks/rules; `allow_managed_hooks_only = true` in `requirements.toml`.
- Claude docs: `plugin-marketplaces.md` ("When both `ref` and `sha` are set… the `sha` is the effective pin"; marketplace sources pin with `@ref`/`#ref`; `--yes` / `--accept-command <sha256>`; `strictKnownMarketplaces`, `blockedMarketplaces` incl. owner wildcards since 2.1.223, `disableCommandPluginSources`, `allowManagedHooksOnly`, `disableSideloadFlags`, `pluginSuggestionMarketplaces`), `discover-plugins.md` (community marketplace "automated validation and safety screening", "Anthropic doesn't control what MCP servers…"), `permissions.md` trust table (hooks/env/apiKeyHelper "Used" in parent-trust and `-p`; `.mcp.json` "Connected without asking" in `-p`; mitigations `--setting-sources user`, `--bare`, `--settings '{"disableAllHooks": true}'`, `disabledMcpjsonServers`), `authentication.md` (Keychain/`.credentials.json` 0600/Windows profile ACL, 5-minute helper refresh, `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`, `claude setup-token` one-year token "does not save the token anywhere", bare mode ignores `CLAUDE_CODE_OAUTH_TOKEN`), `mcp.md` (`${VAR:-default}`, `headersHelper`, `MCP_CLIENT_SECRET=… claude mcp add … --client-secret`, v2.1.196 "A cloned repository can't approve its own servers").
- Official marketplace playwright `.mcp.json`: `"command": "npx", "args": ["@playwright/mcp@latest"]`; context7 `.mcp.json` uses `"Authorization": "${CONTEXT7_API_KEY:-}"`.
- Advisories: anthropics/claude-code lists 30 advisories over 3 pages (earliest GHSA-9f65-56v6-gxw7 2025-06-23, latest 2026-06-25); GHSA-mmgp-wc2j-qcv7 = CVE-2026-33068 (<2.1.53), GHSA-5cwg-9f6j-9jvx = CVE-2026-35603 (<2.1.75), GHSA-2jjv-qf24-vfm4 (2025-09-24), GHSA-ff64-7w26-62rf (2026-02-06), GHSA-q5hj-mxqh-vv77 (2026-04-24); GHSA-xrxf-jgv3-qmrm = CVE-2025-61260, CVSS 9.8, `@openai/codex` <= 0.23.0, "Patched Versions: None" on the advisory; Check Point post confirms fix dates 2025-08-26 / 2025-09-22 / 2025-12-28 and disclosure 2026-02-25.
- Incidents: Elastic CHAINDROP (published 2026-08-06; identified 2026-08-04; "over 400 unique npm packages"; keyv; preinstall + bun v1.3.13; `SessionStart` hook running `node .claude/setup.mjs`; Anthropic/Claude/Codex/Cursor/OpenAI/Gemini creds; "Upgrade to npm 12 or later, which blocks `preinstall` hooks by default"). CSA Mini Shai-Hulud (2026-05-17; 373 package-versions, 169 npm + 2 PyPI, 518M+ downloads; hooks in `.claude/settings.json` and `.vscode/tasks.json`). CSA codexui (2026-06-01; `codexui-android`, `@friuns/codexui`; discovered 2026-05-27 by Aikido; 27-29k weekly downloads; `~/.codex/auth.json`; "refresh tokens do not expire"; recommends `cli_auth_credentials_store = "keyring"`). Snyk ToxicSkills (2026-02-05; 3,984 skills; 76 malicious; 534 = 13.4% critical; 1,467 = 36.82% flawed). THN ClawHavoc (2026-02-02; 341/2,857; 335 AMOS). Unit 42 (2026-06-23; five unblocked skills, Feb-May 2026; "22 MB of padding characters"; paste-site Base64 bash). Snyk postmark-mcp (v1.0.16 BCC to phan@giftshop.club; removed 2025-09-25). Invariant Labs TPA post dated 2025-04-01. Vercel changelog 2026-02-17 (Gen, Socket, Snyk; hidden from leaderboard/search; `skills@1.4.0`).
- skills CLI source (main, 2026-09-17): `telemetry.ts` `AUDIT_URL = 'https://add-skill.vercel.sh/audit'`, `timeoutMs = 3000`, "never blocks installation", gated on `!DISABLE_TELEMETRY && !DO_NOT_TRACK`; `add.ts` runs the audit "only after GitHub has positively confirmed that this is a public repository", `// Silently skip — security info is advisory only`, confirmation skipped when `options.yes`; `skill-lock.ts` `CURRENT_VERSION = 3`, `skillFolderHash` = GitHub tree SHA. Live probe `…/audit?source=vercel-labs/agent-skills&skills=frontend-design` -> `{"frontend-design":{}}`.
- Local host (stat only): `~/.claude ~/.codex ~/.agents` = 775; `.credentials.json`, `~/.claude.json`, `auth.json` = 600; `logs_2.sqlite`, `memories_1.sqlite` = 644, `models_cache.json` = 664; `.credentials.json` keys `claudeAiOauth.{accessToken,refreshToken,expiresAt,refreshTokenExpiresAt,scopes,subscriptionType,rateLimitTier}` (values not read). `secret-tool` absent, `systemd-creds` 259.5 present with `--user`/`--uid=` ("Such credentials may only be decrypted from the specified user's context").
- Microsoft docs: SecretManagement/SecretStore "feature complete and will no longer be actively developed… The code repository has been archived" (page dated 2026-06-22; v1.1.2 / v1.0.6); `Export-Clixml` "only exports encrypted credentials on Windows… macOS and Linux… plain text stored as a Unicode character array" (doc ms.date 2024-01-31). 1Password: `op run --env-file="./prod.env" -- aws`, `op://vault/item/field`, `MY_VAR=op://vault/item/field op run --no-masking -- sh -c 'echo "$MY_VAR"'`. Bitwarden: `bws run -- 'your-command'`, `BWS_ACCESS_TOKEN`. GitHub changelog 2025-10-28 immutable releases GA; `Stijn-K/curlbash_detect` exists (30 stars).

### Corrections made
1. **Claude install.sh does not install the pinned version itself** (see the new bullet in 2.1): it always downloads/verifies *latest* and delegates the pin to `claude install <ver>`. Item "native installer … pinned" reworded; the GPG re-check of `versions/<ver>` is what actually verifies the pinned binary.
2. `latest` is now **2.1.274** (manifest signed 2026-09-16); claude-code npm latest 2.1.274. Pinned examples keep 2.1.273 (installed) but are labeled.
3. `skills` npm latest is **1.6.0**, not 1.5.26 (both have SLSA provenance).
4. Official marketplace: **308 plugins, 256 git-sourced and all 256 SHA-pinned** (was 305/253). Community marketplace: **2,282 plugins, 2,274 with `sha`; 8 entries are not SHA-pinned** (5 local `./` paths, 3 `git-subdir` with only `ref: main`/`feat`), so the docs' "Each plugin is pinned to a specific commit SHA" is not strictly true today.
5. **`allowedPlugins` / `blockedPlugins` do not exist** in `settings-reference.md`, `plugin-marketplaces.md`, `plugins-reference.md` or `managed-settings.md`; removed from facts/items. Per-plugin managed control is `enabledPlugins` (any scope, managed wins) plus `strictKnownMarketplaces`/`blockedMarketplaces`/`disableCommandPluginSources`.
6. **`npx skills check` is not a read-only check**: `src/cli.ts` maps `check`, `update`, `upgrade` to the same `runUpdate`. Replaced with `npx skills update` and a note; drift detection must be done by the installer from `.skill-lock.json` (`skillFolderHash` vs GitHub Trees API).
7. **CVE-2026-47751 patched in claude-code-action 1.0.74** (affected `< 1.0.74`), not 1.0.78.
8. **MCPTox**: abstract says 20 LLM agents, o1-mini 72.8% ASR; the "36.5% average" is not in the abstract and was dropped.
9. **ClawHavoc counts**: THN (2026-02-02) has 341/2,857 and 335 AMOS but no 1,184; the 1,184 figure is Antiy CERT "as of February 5, 2026… 1,184 malicious skill packages… 12 author IDs". Re-attributed; confidence medium for any "by 02-16" phrasing.
10. **postmark-mcp "1,643 downloads"** is not in the Snyk post and the Koi post it came from now redirects; dropped the number, kept v1.0.16 / BCC address / 2025-09-25.
11. apt setup command corrected to the docs' exact sequence (`sudo install -d -m 0755 /etc/apt/keyrings` first, then `sudo curl -fsSL … -o /etc/apt/keyrings/claude-code.asc`, `gpg --show-keys` fingerprint check, then the `deb [signed-by=…]` line).
12. `gh attestation verify` needs **gh >= 2.49.0**; host has 2.46.0 (`unknown command "attestation"`). Added `gh release verify [<tag>] -R owner/repo` for immutable-release attestations.
13. Snyk ToxicSkills numbers upgraded to high confidence (fetched: 3,984 / 76 / 534 = 13.4% / 1,467 = 36.82%). Codex issue #14704 upgraded to high (fetched: opened 2026-03-14, open; quotes confirmed). Issue #19426 is a feature request "Support recursive trusted project roots" (2026-04-24, open) that *mentions* "exact-path trust, wildcard/global trust not working"; the documented fact (untrusted projects skip `.codex/` layers) comes from `config-basic`/`config-reference`, so the fact is re-sourced to the docs with the issue as secondary.
14. Popularity filled from GitHub HTML (2026-09-17): openai/codex 124.8k stars / 19.3k forks; vercel-labs/skills 31.8k stars / 2.7k forks. The "~669,670 skills on skills.sh (tekai.dev)" figure could not be verified on skills.sh and is replaced with "unknown".

### Facts added by the checker
- Codex **Windows binaries are signed with Azure Trusted Signing** (`.github/actions/windows-code-sign/action.yml`, "Sign Windows binaries with Azure Trusted Signing", called from `rust-release-windows.yml` step "Sign Windows binaries with Azure Trusted Signing"). Closes the open question; verify on Windows with `Get-AuthenticodeSignature codex.exe`.
- Codex installer accepts `--release VERSION` in addition to `CODEX_RELEASE`; `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM=false` forces GitHub Releases (README one-liners for both shells).
- Claude Code **reads credential variables as empty in remote MCP `url`/`headers`** (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, `HTTPS_PROXY`, `NPM_TOKEN` …), "keeps a project's `.mcp.json` or a plugin from sending your Claude Code or cloud provider credentials to a server it names"; a `:-default` on those names is ignored. Use your own variable names for MCP tokens.
- Claude Code `plugin details <name>` prints "component inventory and projected token cost"; `claude plugin marketplace update [name]` updates all when name omitted.
- `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1` lets Claude Code run `brew`/`winget` upgrades in the background; apt/dnf/apk stay manual (need sudo).
- `requiredMinimumVersion`/`requiredMaximumVersion` (managed) make Claude Code refuse to start outside a version range; `minimumVersion` only constrains updates.
- GitHub `gh release verify` exists for immutable-release attestations (asset digests), separate from `gh attestation verify`.
- `systemd-creds --user` / `--uid=` exist on systemd 259 (Ubuntu 26.04): user-scoped credentials "may only be decrypted from the specified user's context"; still untested for non-root use.
- openai/codex release page for rust-v0.154.0 shows **162 assets, no Immutable badge** (WebFetch 2026-09-17); GitHub API confirmation still blocked by rate limit.
