# One-shot install (v0.2) — spec delta

**Status:** Implemented (2026-09-18) — D1-D6 below are all shipped; see `docs/superpowers/plans/2026-09-18-one-shot-install.md` for the task-by-task delivery and `.superpowers/sdd/2026-09-18-one-shot-install/task-7-8-report.md` for the closing gate run.

Amends `2026-09-17-super-agent-installer-design.md`. Everything not restated here still holds.

Trigger: a real Windows 11 run of v0.1.0 left five manual follow-up steps and three failures. The goal of v0.2 is that a run finishes with nothing for the user to do afterwards: after the wizard and the sign-in step, the installer completes unattended.

## 1. Evidence from the Windows run (2026-09-18)

| Symptom | Root cause |
|---|---|
| `gopls: Executable not found in $PATH: "go"` | Go was installed by winget in the same run; `toolDirs` is a fixed list and never re-reads the Windows registry PATH that winget updates |
| `playwright-cli: Executable not found in $PATH: "playwright-cli"` | npm's global bin on Windows is `%APPDATA%\npm`, which `toolDirs` does not include |
| `hook-caveman-claude: skip — caveman CLI not found` (silent) | Same missing `%APPDATA%\npm`; the hook provider then skipped instead of failing |
| `cx-superpowers-remote: chatgpt authentication required` | No sign-in step; the remote catalog needs a ChatGPT login |
| 4 UAC prompts | Machine-scope winget installs, one elevation request each |
| 5 "Next steps" lines | Login, agent-browser, and two API keys were all deferred to the user |

## 2. Decisions (approved 2026-09-18)

| # | Decision |
|---|---|
| D1 | **Sign-in phase** runs after the wizard confirmation, immediately after the `agent` components are installed, and before secrets and every other component group. (Amended 2026-09-18 during the final review: the original text said "before ... any component work", but on a clean host the `claude`/`codex` binaries do not exist yet at that point, so both sign-ins fail with spawn ENOENT and defeat the §3 criterion. When the selection contains no `agent` component -- both already installed -- the phase runs before the first group instead.) Per selected agent: detect existing auth, else run the vendor's interactive login with inherited stdio, wait, verify. Headless fallback: `codex login --device-auth`, `claude setup-token`. On failure: warn, skip components that require that agent, continue, reflect it in the exit code. `--no-login` skips the phase. |
| D2 | **Secrets are persisted** to OS user environment variables only: Windows `[Environment]::SetEnvironmentVariable(name, value, 'User')` plus a `WM_SETTINGCHANGE` broadcast; POSIX a marked block in the shell rc. Nothing is written into `~/.claude/settings.json` or any other file that gets synced or committed. This reverses the v0.1 "prompt only, never persist" decision at the user's explicit request. `--no-persist-secrets` restores the old behaviour. |
| D3 | **Zero-UAC by default on Windows.** Prefer per-user installs: scoop for CLI tools, fnm for Node, `winget --scope user` where the package supports it. Never request elevation unless `--elevate` is passed, and then exactly once for a single batched elevated helper. When a component can only be installed machine-wide and no elevation is available, it fails with a one-line explanation, not a prompt. |
| D4 | **Key validation** happens at prompt time: Context7 key and GitHub PAT are checked against their APIs before the run continues. For the PAT, report the scopes it carries, name any missing scope the selected components need, and name scopes that exceed what is needed. A key that fails validation is re-prompted once, then may be skipped. |
| D5 | **agent-browser** installs its CLI and browser as part of the component, not as a hint. Every remaining `postInstallHint` that is a command we could run becomes an action. |
| D6 | **PATH refresh** after each tool/agent action re-reads the authoritative environment: on Windows the `HKLM\...\Session Manager\Environment` and `HKCU\Environment` PATH values plus `%APPDATA%\npm`, Go's install dir and `GOPATH\bin`; on POSIX the existing fixed list. |

## 3. Success criterion

On a clean Windows 11 host with no agents, no Node, no Go and no admin rights: one `irm … | iex`, the wizard, two sign-ins, two pasted keys, and the run ends with `Next steps:` empty except for advisory notes (restart running sessions, Codex `/hooks` trust). No `setx`, no `npm install -g`, no `claude`/`codex login` left for the user. Exit code 0.

## 4. Out of scope for v0.2

Keychain storage for secrets; machine-wide installs; auto-restarting the user's running agent sessions; Windows ARM64 binaries.
