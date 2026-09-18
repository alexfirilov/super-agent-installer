# Real-host QA on Google Compute Engine — 2026-09-18

Ran the v0.2 installer against throwaway GCE instances to test what containers and unit tests
cannot: a non-root user on a real cloud image, a host with no `sudo`, a distro whose repos lack
half the tools, and an actual sign-in against live Claude and ChatGPT accounts.

Every instance carried `--max-run-duration` with `--instance-termination-action=DELETE`, so
nothing could outlive the session. Total spend was under $1 of the $10 ceiling.

## Matrix

| Host | Image | Scenario | Result |
|---|---|---|---|
| 1 | ubuntu-2404 | clean install, real sign-in to both agents | Codex signed in unattended; Claude found the blocker below |
| 2 | debian-12 | apt Node 18 + native Claude + a plugin installed by hand first, then the installer over the top | upgrade reconciled; second run 39 skipped, exit 0 |
| 3 | ubuntu-2404 | user with no sudo | user-space installs succeeded, root-only ones failed with one clear line each |
| 4/6 | rocky-linux-9 | clean install on a dnf host | found the Node and PATH bugs; clean after the fixes |
| 7/8 | ubuntu-2404 | verification round after the fixes | exit 0, no failures |
| 9 | windows-2022 | startup script as SYSTEM (elevated route, no winget present) | see the Windows section |

## Bugs found, all fixed with regression tests

1. **No Node or npm for any non-root Linux user** (`c6ad654`). fnm's install script hard-requires
   `unzip`, which neither the Rocky 9 nor the Ubuntu 24.04 cloud image ships. It prints
   "Not installing fnm due to missing dependencies" and on some hosts still exits 0, so the
   provider believed it had succeeded. Four to six components then failed with
   `Executable not found in $PATH: "npm"`. The docker matrix never caught this because its
   containers run as root, which takes the NodeSource/apt route instead. Fixed by installing
   `unzip` first where possible, verifying the fnm binary actually landed rather than trusting the
   exit code, and adding a no-admin fallback that unpacks the official nodejs.org build into
   `~/.local` after checking its published SHA256.

2. **Installed tools invisible to the next shell** (`67bb06e`). `node: Node installed` and
   `gopls installed` both reported success, yet a fresh login shell found neither: everything we
   install outside a package manager lands under `$HOME` and nothing put those directories on the
   user's persistent PATH. The gopls message asked the user to `export PATH=...` by hand, which is
   precisely the leftover work the one-shot criterion forbids.

3. **Headless Claude sign-in hung silently** (`d4fc87b`, `c2678fe`). `claude setup-token` renders
   its UI only to a terminal; with stdout redirected it printed nothing for 197 seconds and would
   have held the run until the ten-minute timeout. Under `script(1)` it prints the OAuth URL at
   once. Completing that flow in a browser then revealed it is a *paste-back* flow — the browser
   returns a code that must be typed into the CLI — so with no stdin it can never finish. The
   installer now refuses immediately and names the alternative instead of hanging.

4. **Rocky carries neither `ripgrep` nor `gh`** (`67bb06e`). A package-manager miss now falls back
   to the component's declared script route, and both tools gained one that installs the upstream
   release into `~/.local/bin` — which also gives an unprivileged user a route it never had.

5. **caveman asked the user to run a command we can run** (`b0d1cd4`). `caveman setup` fails on a
   fresh host with "caveman-mcp not found; run `caveman setup --install`". We run it and retry.

## Windows Server 2022

Two runs, both on the stock `windows-2022` image, which ships **no winget**.

Elevated (the startup script runs as `NT AUTHORITY\SYSTEM`): both agents installed, but every tool
failed with `Executable not found in $PATH: "winget"`, and git failing that way took every plugin
with it (`Failed to clone marketplace repository: Command 'git' not found`). The cause was a
regression introduced earlier the same day: the "already elevated, so use the admin we have"
shortcut emitted a winget command whenever the component declared a winget id, bypassing the
detected-package-manager switch. Host detection had it right -- `pkgManager` was `null`. Fixed in
`3b92984`; the shortcut was never needed, since detection already prefers winget when it exists.

Non-elevated (a limited-rights account driven by a scheduled task, after granting
`SeBatchLogonRight`): both agents installed; every tool failed with
`EPERM: operation not permitted, uv_spawn 'powershell'` while trying to bootstrap scoop. This was
**not** attributed: a non-interactive batch-logon token is not a normal desktop session, and the
failure mode differs from the elevated run's. It may well be an artifact of the test harness.
Treat the non-elevated Windows path as covered by unit tests only, and confirm it on a real
Windows 11 desktop.

Harness notes for anyone repeating this: `Invoke-WebRequest` without
`$ProgressPreference='SilentlyContinue'` turned an 86 MB download from 1 second into a hang of
nearly half an hour; `Start-Process -Credential` does not work from session 0; updating
`windows-startup-script-ps1` on an existing instance and resetting does not re-run the script,
while setting it at creation always does.

## Known limitation

Claude sign-in cannot be completed unattended on a host with no terminal. Authorising in a browser
returns a code that must be pasted into the CLI; that is the vendor's flow, not a choice of ours.
The unattended path is to export `CLAUDE_CODE_OAUTH_TOKEN` (minted by `claude setup-token` on any
machine with a terminal) before running the installer. Codex is unaffected: `codex login
--device-auth` polls for its result and needs no stdin, and completed unattended during this run.

## Verified after the fixes

On a fresh Rocky 9 and a fresh Ubuntu 24.04, a clean install exits 0 and a **new login shell**
resolves `node`, `npm`, `claude`, `codex`, `go`, `gopls`, `jq`, `rg`, `gh` and `uv`. A second run
is a no-op that also exits 0.
