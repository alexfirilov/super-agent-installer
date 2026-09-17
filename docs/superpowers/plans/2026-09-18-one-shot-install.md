# One-shot install (v0.2) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A run ends with nothing left for the user to do: sign-in, key persistence, agent-browser and every other former "Next step" happen inside the run, on Windows without a single UAC prompt.

**Spec:** `docs/superpowers/specs/2026-09-18-one-shot-install-delta.md` (amends the 2026-09-17 design).
**Research:** `.superpowers/research-v02.md` (auth flows, env persistence, validation endpoints, elevation, scoop).

## Global Constraints

- TypeScript strict + `noUncheckedIndexedAccess`; `.js` import suffixes; `bunx vitest run` and `bunx tsc --noEmit` clean after every task.
- Every mutating command goes through `ctx.run`; direct fs writes guarded by `!ctx.dryRun`; `--dry-run` performs no login, no key persistence, no elevation.
- Never write a secret into a file. Secrets live in OS user environment variables and in `ctx.secrets` for the run.
- Windows: no elevation unless `--elevate`. Prefer scoop / fnm / `--scope user`.
- Commit per task, conventional message, trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Facts to honour (from the research dossier, do not re-derive): `claude auth status` exits 0/1 with no API cost; `claude setup-token` prints a 1-year token to stdout and saves nothing; `CLAUDE_CODE_OAUTH_TOKEN` consumes it; `codex login` blocks on the localhost:1455 browser callback then exits; `codex login --device-auth` is the headless path; `codex login status` exits 0/1; remote Codex plugin catalogs need ChatGPT auth, not an API key; `[Environment]::SetEnvironmentVariable(n,v,'User')` broadcasts `WM_SETTINGCHANGE` itself; npm global bin on Windows is `%APPDATA%\npm`; `go install` targets `%USERPROFILE%\go\bin`; scoop refuses to run elevated; only `Git.Git` declares winget `--scope user`; Context7 has no free validation endpoint (`GET https://context7.com/api/v2/libs/search?query=react` with `Authorization: Bearer <key>` is the cheapest real check); fine-grained GitHub PATs expose no scope header.

---

### Task 1: Environment refresh that actually finds newly installed binaries

**Files:** `src/exec/path.ts`, `src/executor.ts`, `test/exec/path.test.ts`, `test/executor.test.ts`

**Interfaces:**
- `toolDirs(host, env)` gains, on Windows: `%APPDATA%\npm`, `%ProgramFiles%\Go\bin`, `%LOCALAPPDATA%\Programs\Go\bin`, `<scoop>\shims` (`%SCOOP%` or `%USERPROFILE%\scoop\shims`), `%LOCALAPPDATA%\fnm_multishells` is NOT added (transient); on POSIX: `<scoop>` n/a, add `$HOME/.local/go/bin`.
- New `readSystemPath(ctx): Promise<string[]>` — Windows only: `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`, split on `;`, drop empties. Returns `[]` off Windows or on failure.
- `refreshEnvironment` becomes async: prepends `toolDirs` **and** (Windows) any registry PATH entry missing from the current process PATH.

- [ ] **Step 1: Failing tests**

In `test/exec/path.test.ts` assert the new Windows dirs appear in `toolDirs` (with `APPDATA`, `ProgramFiles`, `SCOOP` set and unset), and that `extendPath` stays idempotent. In `test/executor.test.ts` add: a windows ctx whose fake runner answers the registry probe with `C:\Program Files\Go\bin;C:\Users\u\AppData\Roaming\npm` and assert both land in `process.env.PATH` after `refreshEnvironment`, exactly once across two calls.

- [ ] **Step 2: Run them, watch them fail**

`bunx vitest run test/exec/path.test.ts test/executor.test.ts`

- [ ] **Step 3: Implement**

Keep `refreshEnvironment(ctx)` the only caller of `readSystemPath`; make `executeGrouped`'s `refresh` hook await it. Registry read uses `readOnly: true, allowFailure: true` so dry-run still performs it.

- [ ] **Step 4: Tests pass, full suite + typecheck**
- [ ] **Step 5: Commit** `fix(exec): pick up registry PATH, npm global bin and Go bin after installs`

---

### Task 2: Interactive command mode

**Files:** `src/types.ts`, `src/exec/run.ts`, `test/exec/run.test.ts`

**Interfaces:** `RunOptions.interactive?: boolean` — spawn with `stdio: 'inherit'`, capture nothing (`stdout`/`stderr` come back empty), honour `timeoutMs`, and still respect `dryRun` (skipped unless `readOnly`). Needed so `claude auth login` / `codex login` own the terminal.

- [ ] **Step 1: Failing test** — a node child that reads stdin and exits 0; with `interactive: true` the result has empty `stdout` and `code: 0`; with dry-run it is skipped.
- [ ] **Step 2: Run, watch fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Suite + typecheck**
- [ ] **Step 5: Commit** `feat(exec): interactive run mode that inherits the terminal`

---

### Task 3: Sign-in phase

**Files:** `src/auth/agents.ts`, `src/commands/install.ts`, `src/types.ts`, `test/auth/agents.test.ts`

**Interfaces:**
```ts
export type AuthState = { agent: 'claude' | 'codex'; authenticated: boolean; mode: string | null; detail: string };
export async function detectAuth(ctx: Ctx, agent: 'claude'|'codex'): Promise<AuthState>;
export async function ensureAuth(ctx: Ctx, agents: Array<'claude'|'codex'>, opts: { headless: boolean }): Promise<AuthState[]>;
export function isHeadless(ctx: Ctx): boolean; // no DISPLAY/WAYLAND_DISPLAY on linux, or SSH_CONNECTION set, or ctx.host.isLxc
```
Behaviour per agent, in order:
1. `detectAuth`: claude → `claude auth status` (readOnly, allowFailure) exit 0 means authenticated, capture the first line as `detail`; codex → `codex login status`, same, and set `mode` to `'chatgpt'` when the output mentions ChatGPT/subscription, `'apikey'` when it mentions API key, else `null`.
2. Already authenticated → return, log `already signed in`.
3. Not authenticated and not headless → `ctx.run(['claude','auth','login'], { interactive: true, timeoutMs: 600000 })` / `['codex','login']`; then re-run `detectAuth` to verify.
4. Headless → claude: `claude setup-token` (readOnly false, capture stdout), take the last non-empty line matching `/^[A-Za-z0-9._-]{20,}$/` as the token, put it in `ctx.secrets`/`ctx.env` as `CLAUDE_CODE_OAUTH_TOKEN` (Task 5 persists it); codex: `codex login --device-auth` with `interactive: true`.
5. Still not authenticated → `ctx.log.warn`, return `authenticated: false`.

Wiring in `runInstall`: after the picker confirmation and before `promptSecrets`, when not `ctx.dryRun` and not `opts.noLogin`, call `ensureAuth` for the agents present in the selection (`claude` if any component has `agents !== 'codex'` and `claude-code` is selected or already installed; same shape for codex). Store the result on `ctx.auth` (new optional field on `Ctx`). Components that need an unauthenticated agent must not run: `codexPluginProvider` returns a skip with `blockedBy: 'codex-cli'` and the message `Codex is not signed in (remote catalog needs a ChatGPT login)` when `spec.marketplace` is reserved and `ctx.auth?.codex?.mode !== 'chatgpt'`.

- [ ] **Step 1: Failing tests** — fake runner cases: already-authenticated short-circuit; browser login then verify; headless claude captures the token into `ctx.secrets`; headless codex uses `--device-auth`; failure path warns and reports `authenticated: false`; reserved-marketplace Codex plugin skips with the ChatGPT message when `mode !== 'chatgpt'`.
- [ ] **Step 2: Run, watch fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Suite + typecheck**
- [ ] **Step 5: Commit** `feat(auth): sign both agents in during the run`

---

### Task 4: Key validation

**Files:** `src/secrets/validate.ts`, `src/commands/summary.ts`, `test/secrets/validate.test.ts`

**Interfaces:**
```ts
export type KeyCheck = { ok: boolean; summary: string; warnings: string[] };
export async function validateSecret(ctx: Ctx, env: string, value: string): Promise<KeyCheck>;
```
- `CONTEXT7_API_KEY`: `GET https://context7.com/api/v2/libs/search?query=react` with `Authorization: Bearer <value>`; 200 → ok; 401 → invalid; 403 → `ok:false` "key rejected (restricted)"; anything else → `ok: true` with a warning that validation was inconclusive (never block on a network failure).
- `GITHUB_PERSONAL_ACCESS_TOKEN` / `GITHUB_PAT_TOKEN`: `GET https://api.github.com/user` with `Authorization: Bearer <value>`. 401 → invalid. 200 → read `x-oauth-scopes`: header present → classic PAT, list the scopes; missing/empty → fine-grained PAT, say so and note that GitHub exposes no scope introspection for them. Warn when a needed scope is absent (`repo` or `public_repo` for the github plugin) and when an over-broad scope is present (`delete_repo`, `admin:org`, `admin:enterprise`, `site_admin`).
- Unknown env name → `{ ok: true, summary: 'no validator' }`.

`promptSecrets` calls `validateSecret` after each entry: print the summary and the warnings; on `ok:false`, re-prompt once, then accept-and-warn or skip on empty. Skip validation entirely under `ctx.yes` or `ctx.dryRun`.

- [ ] **Step 1: Failing tests** with a stubbed `fetch`: valid classic PAT with `repo` (ok, no warnings); classic PAT with `delete_repo` (warns over-broad); classic PAT missing `repo` (warns missing); fine-grained (ok, says no introspection); 401 (not ok); network throw (ok with inconclusive warning); Context7 200/401/403; unknown env.
- [ ] **Step 2: Run, watch fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Suite + typecheck**
- [ ] **Step 5: Commit** `feat(secrets): validate pasted keys and report PAT scopes`

---

### Task 5: Persist secrets to OS user environment

**Files:** `src/secrets/persist.ts`, `src/commands/install.ts`, `src/commands/summary.ts`, `src/cli.ts`, `test/secrets/persist.test.ts`

**Interfaces:**
```ts
export async function persistSecrets(ctx: Ctx, vars: Map<string,string>): Promise<{ persisted: string[]; failed: Array<{name:string;reason:string}> }>;
```
- Windows: per var `ctx.run(['powershell.exe','-NoProfile','-Command', "[Environment]::SetEnvironmentVariable('<name>', $env:SAI_SECRET_VALUE, 'User')"], { env: { SAI_SECRET_VALUE: value } })` — the value goes through the child's environment, never the command line, so it stays out of logs and process listings. Reject values over 1024 chars with a clear reason.
- POSIX: one marked block in `~/.profile` (and `~/.zshrc` when it exists) containing `export NAME='value'` with single quotes and `'\''` escaping, written through the existing marker-block + atomic-write helpers, file mode forced to 0600 when we create it.
- Never runs under `--dry-run` or `--no-persist-secrets`; logs the names only, never the values.

Wiring: after `promptSecrets` and after `ensureAuth` (so a captured `CLAUDE_CODE_OAUTH_TOKEN` is included), persist everything in `ctx.secrets`. `postInstallHints` stops printing `setx`/`export` lines for anything successfully persisted, and instead prints one line: `persisted to your user environment: NAME, NAME (open a new terminal for other apps to see them)`. Failures keep the old manual hint. New flag `--no-persist-secrets` in `parseCli`.

- [ ] **Step 1: Failing tests** — windows ctx records the powershell call and asserts the value is passed via env not argv; posix writes a 0600 marker block into a temp HOME and is idempotent; over-long value fails with a reason; dry-run persists nothing; hints show the persisted line instead of `setx`.
- [ ] **Step 2: Run, watch fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Suite + typecheck**
- [ ] **Step 5: Commit** `feat(secrets): persist keys to the user environment`

---

### Task 6: Zero-UAC Windows installs

**Files:** `src/detect/host.ts`, `src/providers/tool.ts`, `manifest.json`, `src/cli.ts`, `test/providers/tool.test.ts`, `test/detect/host.test.ts`

**Interfaces:**
- `HostInfo.isElevated: boolean | null` (Windows: the `WindowsPrincipal.IsInRole(Administrator)` probe; `null` off Windows).
- `Ctx.elevate: boolean` from a new `--elevate` flag (default false).
- `toolProvider` on Windows, when `!ctx.elevate`: prefer in order `packages.scoop` (bootstrapping scoop first if absent), then `winget --scope user` **only** for packages known to support it (`Git.Git`), then `packages.npm`, then the script route. A component whose only Windows route is a machine-scope winget package fails with `needs admin: rerun with --elevate, or install <id> yourself` rather than triggering UAC.
- `ensureScoop(ctx)`: probe `scoop --version`; if absent run `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm get.scoop.sh | iex"`; refuse when `ctx.host.isElevated` is true (scoop rejects elevation) and say so.
- Manifest: add `scoop` entries so the Windows default set is admin-free — `jq` (`jq`), `ripgrep` (`ripgrep`), `gh` (`gh`), `go` (`go`), `uv` (`uv`), `powershell-7` (`pwsh`), and Node keeps `strategy: node` but its Windows branch switches from `winget OpenJS.NodeJS.LTS` to fnm (`scoop install fnm` then `fnm install 24 && fnm default 24`, mirroring POSIX).

- [ ] **Step 1: Failing tests** — windows non-elevated with scoop present installs `scoop install jq`; scoop absent bootstraps it first; Git uses `winget --scope user`; a machine-only package fails with the `--elevate` message and never calls winget; `--elevate` restores today's winget path; `detectHost` reports `isElevated`.
- [ ] **Step 2: Run, watch fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Suite + typecheck, and `bunx vitest run test/manifest` for the manifest edits**
- [ ] **Step 5: Commit** `feat(tool): install per-user on Windows so no run needs UAC`

---

### Task 7: No hint that could have been an action

**Files:** `manifest.json`, `src/providers/skill.ts`, `src/commands/summary.ts`, `test/providers/skill.test.ts`, `test/manifest/real-manifest.test.ts`

**Interfaces:** `SkillSpec.postInstall?: string[][]` — argv run after a successful skill install (same shape as `ToolSpec.postInstall` but platform-independent). `sk-agent-browser` gains `prerequisites: ['node']`, `postInstall: [["npm","install","-g","agent-browser"],["agent-browser","install"]]`, and loses its `postInstallHint`. Sweep every remaining `postInstallHint` in the manifest: if it is a command we can run, turn it into `postInstall`; if it is advisory (Codex `/hooks` trust, `claude-hud` setup slash command), keep it and make sure `postInstallHints` labels it `advisory:`. `real-manifest.test.ts` asserts no `postInstallHint` starts with `npm `, `npx `, or `curl `.

- [ ] **Step 1: Failing tests** — skill provider runs `postInstall` argv in order after install and fails the action when one exits non-zero; manifest test rejects command-shaped hints.
- [ ] **Step 2: Run, watch fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Suite + typecheck**
- [ ] **Step 5: Commit** `feat(skill): run post-install commands instead of printing them`

---

### Task 8: Docs, flags and the Windows dry-run proof

**Files:** `README.md`, `docs/superpowers/specs/2026-09-18-one-shot-install-delta.md` (status line), `scripts/docker-matrix.sh`

- [ ] **Step 1:** README: document `--no-login`, `--no-persist-secrets`, `--elevate`; describe the sign-in phase and that keys are persisted to the user environment; drop the stale "secrets are never persisted" sentence.
- [ ] **Step 2:** `scripts/docker-matrix.sh` runs the minimal profile with `--no-login` (containers have no browser) and asserts the summary contains no `Next steps:` entry that starts with `npm `, `setx `, `run \`claude\`` or `run \`codex\``.
- [ ] **Step 3:** Run the full gates: `bunx vitest run`, `bunx tsc --noEmit`, `shellcheck install.sh scripts/*.sh`, `bats test/bootstrap/install.bats`, Pester, `bash scripts/build.sh`, `DOCKER="sudo -n docker" bash scripts/docker-matrix.sh`.
- [ ] **Step 4:** Read-only sanity on this Linux host: `bun run src/cli.ts install --yes --profile all --dry-run | tail -40` (no login, no persistence, plan unchanged apart from the new agent-browser post-install rows).
- [ ] **Step 5: Commit** `docs: one-shot install flags and behaviour`

---

## Self-review notes

- Spec coverage: D1→T2+T3, D2→T5, D3→T6, D4→T4, D5→T7, D6→T1; evidence table rows map to T1 (three PATH failures) and T3 (ChatGPT auth).
- Deliberately out: keychain storage, machine-wide installs, restarting the user's sessions, Windows ARM64.
- The one thing the user still does: click through two browser sign-ins and paste two keys, inside the wizard. Everything after the last prompt is unattended.
