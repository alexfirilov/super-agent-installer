# Platform-specific installation gotchas and building blocks (bash + PowerShell installer)

Research date: 2026-09-16/17. Scope: Linux (Debian/Ubuntu/Proxmox VE, Fedora/RHEL, Arch, Alpine, NixOS, ARM64), Windows 10/11 + Windows Server (native), macOS. All commands below were copied from fetched primary sources (listed at the end); "unknown" is written where a number could not be sourced. The two official installer scripts (`claude.ai/install.sh`, `claude.ai/install.ps1`, `chatgpt.com/codex/install.sh`, `chatgpt.com/codex/install.ps1`) were downloaded to the scratchpad and read, not executed.

---

## 0. Executive summary (what the installer design should assume)

1. **Both agents ship a first-party "native" installer for every target OS and both are self-contained binaries that do not need Node at runtime.**
   - Claude Code: `curl -fsSL https://claude.ai/install.sh | bash` (macOS/Linux/WSL), `irm https://claude.ai/install.ps1 | iex` (Windows PowerShell), `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` (CMD). Installs `~/.local/bin/claude` (symlink into `~/.local/share/claude/versions/`) / `%USERPROFILE%\.local\bin\claude.exe`. Auto-updates in background; `claude update` for manual; `claude install stable|latest|X.Y.Z`.
   - Codex CLI: `curl -fsSL https://chatgpt.com/codex/install.sh | sh` (macOS/Linux), `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"` (Windows). Installs `~/.local/bin/codex` -> `~/.codex/packages/standalone/current/bin/codex` (Linux builds are **musl static**, target `x86_64-unknown-linux-musl` / `aarch64-unknown-linux-musl`); on Windows `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` (junction into `%USERPROFILE%\.codex\packages\standalone\current`). Update with `codex update` (subcommand exists in 0.154.0) or re-run the installer. Non-interactive: `CODEX_NON_INTERACTIVE=1`; pin with `CODEX_RELEASE=x.y.z` / `--release`.
2. **winget IDs exist for both (`Anthropic.ClaudeCode`, `OpenAI.Codex`) but lag** (as of 2026-09-16: highest merged Claude manifest 2.1.268 vs 2.1.274 current on npm/CHANGELOG (2.1.273 installed locally); Codex 0.152.0 merged vs 0.154.0 current, with several version PRs still open). Use winget only as a fallback path, not the primary.
3. **Windows: target Windows PowerShell 5.1 as the floor for the bootstrap** (it is the only shell guaranteed on every Windows 10/11/Server), then optionally install PowerShell 7 (`winget install --id Microsoft.PowerShell --source winget`, MSI on Server). 5.1 gotchas: `Invoke-WebRequest` now prompts unless `-UseBasicParsing` (CVE-2025-54100 update, Dec 2025); no `ConvertFrom-Json -AsHashtable`; `ConvertTo-Json -Depth` defaults to 2 and silently truncates; UTF-8 output has a BOM; force TLS 1.2 with `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12` on older boxes; execution policy is Restricted on clients, RemoteSigned on Server, `irm|iex` bypasses it but a downloaded `.ps1` needs `-ExecutionPolicy Bypass` or `Unblock-File`.
4. **winget is not on Windows Server 2019/2022 or Server Core**; bootstrap it with `Repair-WinGetPackageManager` from the `Microsoft.WinGet.Client` PSGallery module (works in Windows Sandbox too), or fall back to direct downloads (Git, Node, uv, jq all publish standalone Windows binaries / MSIs).
5. **Linux: run the official installers as the target user, never via sudo.** Claude's `install.sh` refuses `sudo` unless `CLAUDE_INSTALL_ALLOW_SUDO=1` but is fine as plain root (Proxmox, containers). Minimal images need `curl` (or `wget`) + `ca-certificates` + `bash` (Claude) / `sh`+`tar`+`mktemp`+`sha256sum|shasum|openssl` (Codex). Alpine needs `apk add bash curl libgcc libstdc++ ripgrep` plus `USE_BUILTIN_RIPGREP=0` in settings for Claude; Codex is static musl and needs nothing extra. Both are on ARM64 (linux-arm64 / aarch64). Claude needs ~512 MB free RAM to install and AVX-capable CPU; run the installer from a small `WORKDIR` in Docker.
6. **NixOS: do not run the curl installers; print a snippet.** nixpkgs has `claude-code` (native binary, autoPatchelf, platforms x86_64-linux/aarch64-linux/aarch64-darwin, manifest 2.1.272) and `codex` (built from source, 0.154.0), and home-manager has `programs.claude-code` and `programs.codex` modules that manage settings.json / config.toml declaratively.
7. **Node/npx for MCP servers:** recommend **fnm** on desktops (single binary, native Windows support, `winget install Schniz.fnm`, `curl -fsSL https://fnm.vercel.app/install | bash`) and **NodeSource apt/rpm repo** on root-only servers (`setup_24.x` / `setup_lts.x`, needs root). nvm is Linux/macOS-only and not loaded in non-interactive shells. On native Windows, Claude Code automatically wraps `npx` stdio MCP servers in `cmd /c`; Codex resolved the `.cmd` lookup in PR #3828, so `command = "npx"` works on current versions but absolute paths + `startup_timeout_sec` are the documented workaround.
8. **Config editing:** `~/.claude/settings.json` and `~/.claude.json` are plain JSON: use `jq` (1.8.2, static single binary on every platform, `winget install jqlang.jq`) on POSIX, and `ConvertFrom-Json`/`ConvertTo-Json -Depth 100` on Windows (PS 5.1 caveats below). `~/.codex/config.toml` is TOML: **prefer the agent's own CLI (`codex mcp add`, `codex -c key=value`) and otherwise `python3 -c` with `tomllib` (read) + append-only well-formed TOML blocks**, because no single zero-dependency tool preserves TOML comments/order on all platforms: `yq` (4.53.6) reads and writes TOML but its docs still list unsupported cases; `dasel` v3 (3.11.2) marks TOML as "Generally working / unsorted maps" and removed in-place editing; `taplo` (0.10.0) is format/lint/get only (no set); `tomllib` is read-only (needs `tomli-w` to write). Note Codex issue #45432: `codex mcp add/remove` itself rewrites every `[mcp_servers.*]` entry and drops comments/unknown keys.
9. **Interactive picker:** `gum choose --no-limit` (gum 2.0.1; Linux/macOS/Windows x86_64 binaries, deb/rpm/apk, `winget install charmbracelet.gum`, ~24.4k stars) is the best cross-platform fit if you are willing to bootstrap a ~single binary; fall back to bash `select`/`read` and PowerShell `Read-Host` menus (zero deps). `Out-ConsoleGridView` needs PowerShell 7.2+ (`Install-Module Microsoft.PowerShell.ConsoleGuiTools`) and is now community-maintained. `whiptail`/`dialog` are Linux-only; `fzf -m` (0.74.4) is excellent on Linux/macOS/Windows but a second dependency.
10. **Testing:** bats-core 1.14.0 + shellcheck 0.11.0 for bash; Pester (v6 docs; `Install-Module -Name Pester -Force -SkipPublisherCheck`) + PSScriptAnalyzer (`Install-Module -Name PSScriptAnalyzer`, compatibility rules PSUseCompatibleCommands/Syntax/Types) for PowerShell; Docker matrix (ubuntu/debian/fedora/archlinux/alpine images + `--platform linux/arm64`); GitHub Actions `windows-latest` = Windows Server 2025, `windows-2022`, `ubuntu-24.04-arm`, `macos-latest` = macOS 26 arm64; Windows Sandbox (`.wsb` file, Pro/Enterprise only, no winget preinstalled).

---

## 1. Windows

### 1.1 PowerShell 5.1 vs PowerShell 7 differences that matter

| Topic | Windows PowerShell 5.1 (built in) | PowerShell 7.x (`pwsh`) | Installer implication |
|---|---|---|---|
| Detect | `$PSVersionTable.PSVersion.Major -eq 5`, `$PSVersionTable.PSEdition -eq 'Desktop'` | `PSEdition -eq 'Core'` | Branch on `$PSVersionTable.PSVersion.Major -ge 6` |
| `Invoke-WebRequest` | After the Dec 9 2025 CVE-2025-54100 update, `iwr` **prompts** "Script Execution Risk" unless `-UseBasicParsing`; also required on Server Core (no IE). Aliases `curl`/`wget` point at it, so `curl -fsSL` fails with `A parameter cannot be found that matches parameter name 'fsSL'`. | No prompt, no IE dependency | Always use `Invoke-WebRequest -UseBasicParsing`; use `curl.exe` explicitly when you mean curl. Set `$ProgressPreference = 'SilentlyContinue'` (both official installers do). |
| `Invoke-RestMethod` (`irm`) | Works; used by both official installers | Same | Fine for `irm ... | iex` bootstrap. |
| TLS | Depends on .NET/OS defaults; Anthropic docs recommend `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12` before `irm` on TLS errors | TLS 1.2+ default | Set Tls12 unconditionally in the 5.1 branch. |
| `ConvertFrom-Json -AsHashtable` | Not available (introduced PS 6.0; `OrderedHashtable` since 7.3) | Available | On 5.1 you get `PSCustomObject`; case-insensitive duplicate keys collapse, empty-string keys error. |
| `ConvertFrom-Json` comments | Errors on JSON comments | Accepts comments | `.claude.json` / settings.json are strict JSON, so fine. |
| `ConvertTo-Json -Depth` | Default 2, max 100, **silently truncates** deeper objects to strings | Default 2, warns since 7.1 | Always pass `-Depth 100`. |
| `ConvertTo-Json` escaping | `-EscapeHandling` only from 6.2; 5.1 escapes `<`,`>`,`&`,`'` as `\u003c` etc. (behaviour not documented on the page; treat as "5.1 output differs") | `-EscapeHandling Default` escapes only control chars | Expect diffs/noise when round-tripping in 5.1. |
| Key ordering | `PSCustomObject` preserves order | Same; `-AsHashtable` ordered since 7.3 | OK for both. |
| Encoding | `Out-File`/`>` write UTF-16LE; `Set-Content` writes ANSI; `-Encoding UTF8` = **UTF-8 with BOM**; `Get-Content` without BOM assumes ANSI | Default `utf8NoBOM` everywhere | Write JSON with `[System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))` to get BOM-less UTF-8 on both. Save the installer `.ps1` itself as UTF-8 **with** BOM if it contains non-ASCII (else 5.1 misreads it). |
| Execution policy | Default `Restricted` on clients, `RemoteSigned` on Server (effective when Undefined) | Same rules; on non-Windows always Unrestricted/Bypass | See 1.2. |
| `Expand-Archive`, `tar` | `Expand-Archive` present (PS 5+); `tar.exe` (bsdtar) and `curl.exe` ship in Windows 10 1803+ (Codex install.ps1 uses `tar -xzf`) | Same | Prefer `tar.exe -xzf` for tgz. |
| Junctions/symlinks | `New-Item -ItemType Junction` works unprivileged (Codex installer uses it); `-ItemType SymbolicLink` needs admin or Developer Mode | Same | Use junctions for directories. |

### 1.2 Execution policy handling

- `irm https://... | iex` executes text, not a script file, so the execution policy does **not** apply (Anthropic troubleshooting page: "The policy applies to script files, so it doesn't affect the PowerShell installer `irm https://claude.ai/install.ps1 | iex`").
- Running a downloaded `.ps1`: either launch with a process-scoped policy `powershell -ExecutionPolicy Bypass -File .\installer.ps1` (the Codex docs themselves use `powershell -ExecutionPolicy ByPass -c "irm ... | iex"`), or `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` and `Unblock-File .\installer.ps1` (files downloaded by browsers carry the Zone.Identifier mark-of-the-web; files downloaded by `curl.exe`, `Invoke-RestMethod`, `Invoke-WebRequest` are **not** marked).
- Group Policy `MachinePolicy`/`UserPolicy` cannot be overridden by `-ExecutionPolicy`; detect with `Get-ExecutionPolicy -List` and tell the user.
- Server Core / Nano: RemoteSigned can fail with `AuthorizationManager check failed` because the zone check needs explorer.exe; `Bypass` or `AllSigned` avoid it.
- npm shims (`npm.ps1`, `claude.ps1`) are `.ps1` files and **do** hit the policy (`running scripts is disabled on this system`); fix with `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` or call `npm.cmd`. Native installers avoid this entirely.

### 1.3 winget availability and fallbacks

- Availability: Windows 10 1809 (build 17763)+, Windows 11, **Windows Server 2025 (Desktop Experience only)**. "`winget` isn't available on Windows Server 2022 or earlier versions." Not registered until a user has logged in once; force registration with `Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe`.
- Bootstrap where missing (Server 2019/2022, LTSC without Store, Windows Sandbox):

```powershell
$progressPreference = 'silentlyContinue'
Install-PackageProvider -Name NuGet -Force | Out-Null
Install-Module -Name Microsoft.WinGet.Client -Force -Repository PSGallery | Out-Null
Repair-WinGetPackageManager -AllUsers
```

- Non-interactive install pattern (all flags from the winget `install` docs): `winget install --id <Id> -e --source winget --accept-package-agreements --accept-source-agreements --silent --disable-interactivity` (add `--scope user` where the package supports it; some packages elevate via UAC when run non-admin).
- Fallbacks: **Scoop** (non-admin, PS 5.1+, `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` then `irm get.scoop.sh | iex`; admin variant: README recommends `irm get.scoop.sh -outfile 'install.ps1'` then `.\install.ps1 -RunAsAdmin`, and also lists `iex "& {$(irm get.scoop.sh)} -RunAsAdmin"`), **Chocolatey** (admin shell, .NET 4.8: `Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))`), or direct downloads.

### 1.4 winget package IDs (verified in microsoft/winget-pkgs on 2026-09-16)

| Need | ID | Status | Notes |
|---|---|---|---|
| Claude Code | `Anthropic.ClaudeCode` | exists, `portable` installer type, x64 + arm64 | Highest merged manifest 2.1.268 (merged 2026-09-11); PRs for 2.1.269-2.1.273 open. Docs: `winget install Anthropic.ClaudeCode`, `winget upgrade Anthropic.ClaudeCode`; no auto-update unless `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1`; upgrade may fail while claude.exe is running. |
| Codex CLI | `OpenAI.Codex` | exists, `zip` with nested portable exes (codex, command runner, windows-sandbox-setup), x64 + arm64, depends on ripgrep MSVC + VC++ redist | Highest merged 0.152.0 (merged 2026-09-11); 0.147.0/0.149.1/0.151.0/0.154.0 PRs open. |
| Git | `Git.Git` | exists (2.55.0 newest folder) | Official example: `winget install --id Git.Git -e --source winget`. Optional for Claude Code (enables Bash tool); without it Claude uses the PowerShell tool. |
| Node.js LTS | `OpenJS.NodeJS.LTS` | exists (24.19.0 newest folder) | nodejs.org lists it. Provides `npx` for MCP servers. |
| Python | `Python.Python.3.13`, `Python.Python.3.14` | exist (folders 3/0..3/14) | Only needed for python MCP servers not run via `uvx`. |
| uv | `astral-sh.uv` | exists (0.12.15 newest) | Official: `winget install --id=astral-sh.uv -e`; standalone: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`; update `uv self update`. |
| jq | `jqlang.jq` | exists | Official: `winget install jqlang.jq`; static exes `jq-windows-amd64.exe`, `jq-windows-arm64.exe` (1.8.2). |
| gum | `charmbracelet.gum` | exists (2.0.0 newest folder; upstream 2.0.1 released 2026-09-11) | `winget install charmbracelet.gum` / `scoop install charm-gum`. Windows zips are x86_64 and i386 only (no arm64 zip in 2.0.1). |
| PowerShell 7 | `Microsoft.PowerShell` | exists (7.6.6) | `winget install --id Microsoft.PowerShell --source winget` (MSIX by default since 7.6.0; `--installer-type wix` for MSI). MSI silent: `msiexec.exe /package PowerShell-7.6.6-win-x64.msi /quiet ADD_PATH=1 ...`. Installs to `C:\Program Files\PowerShell\7`, side by side with 5.1. |
| fzf | `junegunn.fzf` | exists | `winget install junegunn.fzf`. |
| shellcheck | `koalaman.shellcheck` | exists | `winget install --id koalaman.shellcheck`. |
| fnm | `Schniz.fnm` | exists | `winget install Schniz.fnm`. |
| Volta | `Volta.Volta` | exists | `winget install Volta.Volta`. |

### 1.5 PATH refresh in the same session

Both official installers write to the **User** `Path` via `[Environment]::SetEnvironmentVariable("Path", ..., "User")`; the current process does not see it. Anthropic's documented fix is to open a new terminal ("the session you installed from keeps its old PATH"). For an installer that continues in the same session, rebuild `$env:Path` from the registry after each install step:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
```

Documented locations to add manually if missing: `%USERPROFILE%\.local\bin` (Claude), `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` (Codex, from install.ps1), `~/.local/bin` (uv). Anthropic's snippet:

```powershell
$currentPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
[Environment]::SetEnvironmentVariable('PATH', "$currentPath;$env:USERPROFILE\.local\bin", 'User')
```

### 1.6 Git for Windows, long paths, Windows Terminal, Defender/SmartScreen, per-user vs admin, 32-bit

- **Git for Windows**: optional but recommended; enables Claude's Bash tool. Detection order: `CLAUDE_CODE_GIT_BASH_PATH` (must point to a file named `bash.exe`/`sh.exe`), then `git` on PATH -> `bin\bash.exe`. Settings snippet: `{"env": {"CLAUDE_CODE_GIT_BASH_PATH": "C:\\Program Files\\Git\\bin\\bash.exe"}}`. Codex on Windows uses PowerShell natively and does not require Git Bash.
- **Long paths**: `New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force` (admin; Windows 10 1607+; apps must also be `longPathAware`, so this mainly helps git/node/npm deep `node_modules`). Optional step, admin-only.
- **Windows Terminal / ConPTY**: Codex docs list "modern console support including ConPTY" as a requirement for native Windows; Claude Code supports PowerShell and CMD. Recommend Windows Terminal but do not require it.
- **Defender/SmartScreen**: Claude's Windows binary is Authenticode-signed by "Anthropic, PBC" (`Get-AuthenticodeSignature .\claude.exe`); the installer downloads into `%USERPROFILE%\.claude\downloads` and can fail with "The process cannot access the file" while AV scans; fix: `Remove-Item -Recurse -Force "$env:USERPROFILE\.claude\downloads"` and retry. Corporate revocation-check blocks (`CRYPT_E_NO_REVOCATION_CHECK`) affect `curl.exe`; use `curl --ssl-revoke-best-effort ...` for install.cmd or use the PowerShell installer (goes through .NET).
- **Per-user vs admin**: both agents install per-user, no admin needed ("You do not need to run as Administrator"). Admin is only needed for: PowerShell 7 MSI machine-wide, LongPathsEnabled, Developer Mode, Codex `elevated` sandbox setup (creates sandbox users/firewall rules), Chocolatey.
- **32-bit**: Claude refuses 32-bit processes ("Claude Code does not support 32-bit Windows"); the installer checks `[Environment]::Is64BitProcess`, so never launch from "Windows PowerShell (x86)".

### 1.7 Symlink privilege / Developer Mode (matters for the skills CLI)

- Unprivileged symlink creation requires **Developer Mode** (Windows 10 build 14972+; `SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE`). Enabling it needs admin: `reg add "HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /t REG_DWORD /f /v "AllowDevelopmentWithoutDevLicense" /d "1"`.
- The skills CLI (`npx skills add ... -g -y --agent claude-code codex`) defaults to symlinking from each agent dir to `~/.agents/skills`; `--copy` "Copy files instead of symlinking to agent directories" (README wording; the "use when symlinks aren't supported" clause is not in the README). Reports that it falls back to copying on EPERM are unverified. Open issue #1199: `skills update` re-installs `--copy` skills as symlinks. Recommendation: on Windows pass `--copy` explicitly (or enable Developer Mode first) and re-pass `--copy` on updates; on Linux/macOS use default symlinks.
- Directory **junctions** need no privilege; Codex's own installer uses `New-Item -ItemType Junction`.

### 1.8 `npx` inside MCP configs on Windows

- Claude Code: the current MCP doc (fetched 2026-09-17) contains **no** statement that `claude mcp add` auto-wraps `npx` with `cmd /c`; the only trace is CHANGELOG 2.1.119 "Windows: removed false-positive 'Windows requires cmd /c wrapper' MCP config warning", and issue #20061 (closed, not planned) reports that `claude mcp add` does not auto-wrap and that running it from Git Bash mangles `/c` into `C:/` (MSYS path conversion). Safe rule: on native Windows write the explicit form `"command": "cmd", "args": ["/c", "npx", "-y", "..."]` (via `claude mcp add-json` or direct `~/.claude.json` edit) and run `claude mcp add` from PowerShell/CMD, not Git Bash.
- Codex is Rust; `std::process::Command` does not use PATHEXT, so `command = "npx"` historically failed with "program not found". PR #3828 "resolve Windows MCP server execution for script-based tools" (merged 2025-11-16 into main) added `.cmd/.bat` resolution. Documented workarounds still valid: absolute path to `npx.cmd`, or `command = "cmd"`, `args = ["/c", "npx", ...]`, and raise `mcp_servers.<id>.startup_timeout_sec` (default 10 s).

### 1.9 Codex native Windows status (2026-09)

- Native Windows is supported: official `install.ps1`, x64 and arm64 `*-pc-windows-msvc` binaries, `codex-windows-sandbox-setup.exe`, a native sandbox (`[windows] sandbox = "elevated"` preferred, or `"unelevated"`), requirements "Windows 11 (recommended) or Windows 10 v1809+", "winget must be available", ConPTY. WSL remains an alternative "if a project already depends on Linux tooling".
- Install path: `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` (junction to `%USERPROFILE%\.codex\packages\standalone\current`), overridable with `CODEX_INSTALL_DIR`, `CODEX_HOME`. The PS installer targets `RuntimeInformation.OSArchitecture` (needs .NET 4.7.1+, present on Windows 10 1809+), uses `Invoke-WebRequest -UseBasicParsing`, `tar -xzf`, `Get-FileHash`, and writes User PATH.

---

## 2. Linux

### 2.1 Package manager detection matrix

| Distro family | Detect | PM | Prereqs for the two installers | Node (root path) | Notes |
|---|---|---|---|---|---|
| Debian/Ubuntu/**Proxmox VE 9.x (Debian 13 Trixie)** | `/etc/os-release` `ID`/`ID_LIKE` contains `debian`; `command -v apt-get` | `apt-get` | `apt-get install -y curl ca-certificates bash git` (fresh Debian may lack `curl`, `gnupg`) | NodeSource: `curl -fsSL https://deb.nodesource.com/setup_24.x -o nodesource_setup.sh && bash nodesource_setup.sh && apt-get install -y nodejs` (or `setup_lts.x`); arches amd64/arm64/armhf | PVE ships as root without `sudo`; wrap privilege with `if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi`. Claude also offers a signed apt repo (`deb [signed-by=/etc/apt/keyrings/claude-code.asc] https://downloads.claude.ai/claude-code/apt/stable stable main`, package `claude-code`, key fingerprint `31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE`) which does **not** auto-update. |
| Fedora/RHEL/Rocky/Alma | `ID_LIKE` contains `rhel|fedora`; `command -v dnf || command -v yum` | `dnf`/`yum` | `dnf install -y curl ca-certificates bash git` | NodeSource rpm: `curl -fsSL https://rpm.nodesource.com/setup_24.x -o nodesource_setup.sh && bash nodesource_setup.sh && yum install nodejs` (x86_64/arm64; Fedora 29+, RHEL 8-9, AL2023) | Claude dnf repo: `/etc/yum.repos.d/claude-code.repo` with `baseurl=https://downloads.claude.ai/claude-code/rpm/stable`, `gpgkey=https://downloads.claude.ai/keys/claude-code.asc`, then `dnf install claude-code`. gum: `dnf install gum` (Fedora/EPEL 10) or Charm yum repo. |
| Arch | `ID=arch`; `command -v pacman` | `pacman -S --noconfirm` | `pacman -S --needed curl ca-certificates bash git` | `pacman -S nodejs npm` (distro pkg) or fnm | `pacman -S gum`, `pacman -S jq`, `pacman -S fzf`, `pacman -S shellcheck`. |
| openSUSE | `ID_LIKE` contains `suse`; `command -v zypper` | `zypper -n install` | `zypper -n install curl ca-certificates bash git` | fnm/NodeSource not offered for SUSE in NodeSource docs; use distro `nodejs22` or fnm | Charm yum repo works for gum; `zypper install jq`. |
| Alpine (musl) | `ID=alpine`; `command -v apk` | `apk add` | Claude: `apk add bash curl libgcc libstdc++ ripgrep` (ripgrep is in `community`; `echo "https://dl-cdn.alpinelinux.org/alpine/v3.22/community" >> /etc/apk/repositories`), then settings `{"env": {"USE_BUILTIN_RIPGREP": "0"}}`. Codex: static musl, only needs `sh curl tar`. | `apk add nodejs npm` (musl builds); nvm needs `nvm install -s` (compile) | Claude apk repo: `wget -O /etc/apk/keys/claude-code.rsa.pub https://downloads.claude.ai/keys/claude-code.rsa.pub; echo "https://downloads.claude.ai/claude-code/apk/stable" >> /etc/apk/repositories; apk add claude-code` (key sha256 `395759c1f7449ef4cdef305a42e820f3c766d6090d142634ebdb049f113168b6`). Both agents ship `linux-*-musl` builds; Claude's installer detects musl via `/lib/libc.musl-*.so.1` or `ldd /bin/ls`. |
| NixOS | `ID=nixos`; `command -v nix-env` | nix | n/a | n/a | Bail out and print snippet (2.4). |
| Generic/unknown | none matched | manual | check `curl|wget`, `bash`, `tar`, `ca-certificates` | fnm | Print what is missing and exit non-zero. |

### 2.2 Root vs sudo, minimal images, Docker

- Claude `install.sh` (bash, `set -e`) hard-refuses `sudo` from a normal user: "Error: do not run this installer with sudo." unless `CLAUDE_INSTALL_ALLOW_SUDO=1`. Plain root (`id -u` = 0 with no `SUDO_USER`) is allowed, so Proxmox root works. Everything lands in `$HOME`; never run the agent installers with sudo, only the distro package steps.
- Claude needs `curl` **or** `wget`, `bash`, `sha256sum`/`shasum`; uses `jq` if present (pure-bash fallback otherwise) and `zstd` if present (falls back to the uncompressed binary). Codex `install.sh` is POSIX `sh`, needs `curl` or `wget`, `tar`, `mktemp`, and `sha256sum`/`shasum`/`openssl`; it uses `flock` when available for its install lock.
- Docker/OOM: install needs ~512 MB free RAM; use `WORKDIR /tmp` before `RUN curl -fsSL https://claude.ai/install.sh | bash` (installing from `/` scans the whole filesystem). On tiny VPS add a 2 GB swapfile (`fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile; swapon /swapfile`).
- `Raw mode is not supported` during piped install is fixed in Claude 2.1.246+ (only recurs with `forceRemoteSettingsRefresh` managed settings).
- CPU: Claude's native binary needs AVX (`grep -m1 -ow avx /proc/cpuinfo`); pre-2013 CPUs and hypervisors that hide AVX fail with `Illegal instruction` (issue #50384). Proxmox VMs with CPU type `kvm64` hide AVX; use `host` or `x86-64-v3`. WSL1 is broken for the native binary (`Exec format error`, issue #38788); convert with `wsl --set-version <Distro> 2`.
- Claude's launcher `~/.local/bin/claude` is a symlink the auto-updater manages; if you replace it with your own wrapper, updates still install under `versions/` but keep every version on disk.

### 2.3 ARM64 / Raspberry Pi

- Claude Code: `linux-arm64` and `linux-arm64-musl` in the manifest and npm optional deps; Homebrew on Apple Silicon; requirements "x64 or ARM64 processor, 4 GB+ RAM". No 32-bit ARM (armv7) build, so Raspberry Pi OS must be 64-bit.
- Codex: `codex-aarch64-unknown-linux-musl.tar.gz` (static), `codex-aarch64-apple-darwin`, `codex-aarch64-pc-windows-msvc`. No armv7.
- Helpers: gum has arm64/armv7/armv6 tarballs, deb/rpm/apk; jq has `jq-linux-arm64`, `armhf`, `armel`; yq `yq_linux_arm64`/`arm`; dasel `dasel_linux_arm64`/`arm32`; taplo `taplo-linux-aarch64`/`armv7`; shellcheck `linux.aarch64`; NodeSource has arm64 + armhf for Debian/Ubuntu.

### 2.4 NixOS

Recommendation: detect `ID=nixos` (or `/etc/NIXOS`), **do not** run `curl | bash` (no FHS, no `/lib64/ld-linux-x86-64.so.2` for Claude's dynamically linked binary; Codex is static and would technically run but ignores Nix conventions), print and exit 0 with a snippet:

- nixpkgs `claude-code` (`pkgs/by-name/cl/claude-code`): fetches the zstd binary from `downloads.claude.ai/claude-code-releases`, `autoPatchelf`, wraps ripgrep/procps/bubblewrap/socat; `meta.platforms = aarch64-darwin, aarch64-linux, x86_64-linux` (no x86_64-darwin); manifest currently 2.1.272.
- nixpkgs `codex` (`pkgs/by-name/co/codex`): `version = "0.154.0"`, `rustPlatform.buildRustPackage` from source, `platforms = lib.platforms.unix`.
- home-manager: `programs.claude-code.{enable, package, configDir, settings -> ~/.claude/settings.json, context -> ~/.claude/CLAUDE.md, mcpServers, lspServers, plugins, skills -> ~/.claude/skills/, agents, commands, rules, hooks, marketplaces -> ~/.claude/plugins/known_marketplaces.json, outputStyles}` and `programs.codex.{enable, package, settings -> config.toml, context -> AGENTS.md, contextOverride, profiles, plugins, marketplaces, skills, hooks, rules, enableMcpIntegration}`.
- Snippet to print (home-manager):

```nix
programs.claude-code = { enable = true; settings = { autoUpdatesChannel = "stable"; }; };
programs.codex = { enable = true; settings = { model = "gpt-6-astra"; }; };
```

Note: on NixOS Claude's auto-updater cannot update a store path; users update via `nix flake update`/channel bumps, so set `DISABLE_AUTOUPDATER=1` there.

### 2.5 Node.js installation options (for `npx` MCP servers)

| Option | Root & non-root | Gives `npx` in PATH for MCP subprocesses? | Windows | Verdict |
|---|---|---|---|---|
| **fnm** (`curl -fsSL https://fnm.vercel.app/install | bash`; `brew install fnm`; `winget install Schniz.fnm`; then `eval "$(fnm env --use-on-cd)"` in profile; `fnm install --lts; fnm default lts-latest`) | yes, per-user | Only in shells that sourced `fnm env`; MCP servers spawned by claude/codex inherit the parent shell env, so fine from an interactive shell. For services/cron use a full path or `fnm exec`. | native | **recommended** for desktops/dev hosts (26.9k stars, single binary). |
| **NodeSource repo** (`setup_lts.x`/`setup_24.x` + `sudo -E bash nodesource_setup.sh` + `sudo apt install -y nodejs` / `sudo yum install -y nodejs`; DEV_README examples use `setup_lts.x`, `setup_23.x`, `setup_22.x`, `setup_20.x`; `setup_24.x` and `setup_26.x` URLs exist, HTTP 200) | needs root; system-wide `/usr/bin/node` `npx` | yes, always on PATH | n/a | **recommended** for root-only servers/Proxmox/containers. Debian 10+/Ubuntu 20.04+, RHEL 8-9, Fedora 29+, AL2023. |
| distro package (`apt install nodejs npm`, `apk add nodejs npm`, `pacman -S nodejs npm`, `dnf install nodejs`) | root | yes | n/a | acceptable when version >= 22 (Claude npm package requires Node 22+; `skills` CLI requires Node >= 22.20.0). Debian 13 ships old Node; check `node -v`. |
| nvm (`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash`; `nvm install --lts`) | per-user | **no** in non-interactive shells ("none of the regular profile files are sourced") | README: "nvm also supports Windows in some cases" (WSL, Git Bash/MSYS, Cygwin); native Windows alternatives (nvm-windows) are neither supported nor developed by nvm | optional / detect-only. Alpine: README documents `apk add` build deps + `nvm install -s` (compile), though its table lists prebuilt `linux-x64-musl` binaries for v24.20.0+/v26.8.0+. |
| Volta (`curl https://get.volta.sh | bash`; `winget install Volta.Volta`; `volta install node`) | per-user `~/.volta` | yes via shims | native | optional. |
| `winget install OpenJS.NodeJS.LTS` / nodejs.org MSI | machine-wide (UAC) | yes | native | **recommended on Windows** when fnm is not wanted. |
| Bun (`bun x` / `bunx`) | per-user | only if configs use `bunx` | native | skip for MCP compatibility; most MCP docs assume `npx`. |

### 2.6 uv / uvx for Python MCP servers

- `curl -LsSf https://astral.sh/uv/install.sh | sh` (or `wget -qO- https://astral.sh/uv/install.sh | sh`); Windows `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`; `winget install --id=astral-sh.uv -e`; `brew install uv`; `pipx install uv`; update `uv self update`; installs to `~/.local/bin` (`$HOME\.local\bin` on Windows). Works for root and non-root; provides `uvx` so python MCP servers need no system Python.

### 2.7 Headless OAuth on SSH hosts

- **Claude Code**: on SSH/WSL2/containers the browser can't reach the local callback, so the browser shows a code; paste it at `Paste code here if prompted`. Press `c` to copy the URL, or run `claude auth login` which prints the URL and reads the pasted code from stdin (options `--claudeai`, `--console`, `--sso`, `--email`). For fully unattended hosts: `claude setup-token` on a machine with a browser, then `export CLAUDE_CODE_OAUTH_TOKEN=your-token` on the headless host (1-year token; Pro/Max/Team/Enterprise only; not read in `--bare` mode). Credentials: Linux `~/.claude/.credentials.json` (0600), macOS Keychain (falls back to the file when the Keychain is locked over SSH), Windows `%USERPROFILE%\.claude\.credentials.json`. `claude auth status` to verify.
- **Codex**: `codex login --device-auth` (preferred for headless; enter a one-time code in any browser); or `ssh -L 1455:localhost:1455 user@remote` then normal `codex login`; or `printenv OPENAI_API_KEY | codex login --with-api-key`; enterprise `printenv CODEX_ACCESS_TOKEN | codex login --with-access-token`; fallback copy `~/.codex/auth.json`. `codex login status` to verify; `cli_auth_credentials_store = "keyring" | "file" | "auto" | "ephemeral"` in config.toml.

### 2.8 Proxies and corporate CAs

- Claude Code: `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` (lower-case also), no SOCKS; `NODE_EXTRA_CA_CERTS=/path/to/ca-cert.pem`; `CLAUDE_CODE_CERT_STORE=bundled,system` (default; native installer reads OS store); mTLS via `CLAUDE_CODE_CLIENT_CERT/KEY`. All can live in the `env` block of `~/.claude/settings.json`, which is the only way they reach background agents/supervisor. Install-time: `curl --cacert /path/to/corporate-ca.pem -fsSL https://claude.ai/install.sh | bash`; on Windows the .ps1 uses the Windows cert store. Hosts to allow-list: `api.anthropic.com`, `claude.ai`, `claude.com`, `platform.claude.com`, `downloads.claude.ai` (installer/updates), `storage.googleapis.com` (plugin metadata), `registry.npmjs.org` (plugins, npx MCP), `raw.githubusercontent.com` (changelog; also plugin marketplaces on GitHub).
- Codex installer: `https://releases.openai.com/codex` primary, GitHub releases (`github.com/openai/codex/releases/download/rust-v<ver>/...`, `api.github.com`) fallback (`CODEX_INSTALLER_USE_RELEASES_OPENAI_COM`). Proxy/CA env for Codex runtime was not in fetched docs (open question).
- Generic: `SSL_CERT_FILE` for curl/openssl-based tools, `NODE_EXTRA_CA_CERTS` for node/npx MCP servers, `UV_NATIVE_TLS`/`SSL_CERT_FILE` for uv (not verified here).

### 2.9 systemd user services, locale

- Not needed: both CLIs are interactive TUIs; Claude's background-agent supervisor starts on demand. Skip.
- Locale: TUIs render box-drawing/emoji; ensure a UTF-8 locale (`LANG=C.UTF-8` is available on Debian/Ubuntu/Alpine/Fedora without `locales` packages). Minimal Debian containers default to `POSIX`; export `LANG=C.UTF-8 LC_ALL=C.UTF-8` in the wrapper. On Windows, run `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)` / `chcp 65001` for gum/emoji output in 5.1.

---

## 3. macOS

- Requirements: Claude macOS 13.0+ (older fails with `dyld: Symbol not found ... libicucore`); Homebrew itself now requires macOS Sequoia 15+ on supported hardware plus Command Line Tools (`xcode-select --install`).
- Homebrew prefixes: `/opt/homebrew` (Apple Silicon), `/usr/local` (Intel), `/home/linuxbrew/.linuxbrew` (Linux); add `eval "$(<prefix>/bin/brew shellenv)"` to the profile; unattended install with `NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`.
- Casks: `brew install --cask claude-code` (stable channel) or `claude-code@latest`; `brew install --cask codex`; neither auto-updates (`brew upgrade claude-code`; or `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1`). Codex's install.sh detects an existing brew/npm codex and offers `brew uninstall --cask codex` / `npm uninstall -g @openai/codex`.
- Apple Silicon / Rosetta: both `install.sh` scripts detect a shell running under Rosetta (`x86_64` + `sysctl.proc_translated`) and download the arm64 binary. Claude has no `x86_64-darwin` in nixpkgs but does in its own manifest.
- Quarantine: the official installers download with curl (no `com.apple.quarantine` attribute) and Claude's binary is notarized ("signed by Anthropic PBC and notarized by Apple; `codesign --verify --verbose ./claude`"), so no `xattr -d com.apple.quarantine` is needed for the native paths. Only manually downloaded release tarballs opened via Finder may need it.
- Keychain: Claude stores credentials in the login Keychain; over SSH the Keychain is locked and Claude falls back to `~/.claude/.credentials.json`.
- macOS `sha256`: `shasum -a 256` (both installers handle it).

---

## 4. Structured-config editing (idempotent merges)

Targets: `~/.claude/settings.json` (JSON), `~/.claude.json` (JSON, large, contains MCP servers, OAuth state, per-project state), `~/.codex/config.toml` (TOML with comments, `[mcp_servers.<name>]` tables, `[projects."<path>"]`, `[features]`, `[windows]`).

| Tool | Formats | Write TOML? | Single static binary? | Windows | Latest (date) | Verdict |
|---|---|---|---|---|---|---|
| **jq** | JSON | no | yes ("standalone executables", C, no runtime deps); `jq-linux-amd64/arm64`, `jq-macos-arm64`, `jq-windows-amd64/arm64.exe` | `winget install jqlang.jq`, choco, scoop | 1.8.2 (2026-06-20) | **must-have** for JSON on POSIX; `jq -S '. * $patch'` deep merge, `--arg`, `--argjson`; write to temp + `mv`. |
| PowerShell `ConvertFrom-Json`/`ConvertTo-Json` | JSON | no | built in | 5.1 & 7 | n/a | **recommended on Windows** (zero deps) with `-Depth 100`, write BOM-less UTF-8 via `[IO.File]::WriteAllText`; accept 5.1 escaping noise; add a `-AsHashtable` branch for 7. |
| **yq** (mikefarah) | YAML/JSON/TOML/XML/CSV/props | yes: "Encode and decode to and from TOML", `yq -o toml '.' file`, in-place `-i` | yes (Go); `yq_linux_amd64/arm64`, `yq_darwin_*`, `yq_windows_amd64/arm64.exe` | yes | v4.53.6 (2026-08-20) | **optional**: TOML docs still show "yq can't do this one yet" for some table forms; test against a real `config.toml` before trusting round-trips (comments/ordering). |
| **dasel** v3 | JSON/YAML/TOML/XML/CSV/HCL/INI/KDL | TOML listed as "Generally working" with caveat "Unsorted maps" | yes; `dasel_linux_amd64/arm64/arm32`, `dasel_darwin_*`, `dasel_windows_amd64.exe` | scoop (`scoop bucket add extras; scoop install dasel`), no winget in docs | v3.11.2 (2026-06-27) | **skip** for TOML in-place: v3 "removed built-in file editing" (pattern `dasel -i json --root 'a.b = "x"' < f > f.tmp && mv f.tmp f`), new query language, unordered TOML maps. |
| **taplo** | TOML | no (`fmt`, `check`/lint, `get`, `lsp`, `completions`; no set) | yes (Rust); linux x86_64/aarch64/armv7/riscv64, darwin x86_64/aarch64, windows x86_64/aarch64/x86 | binaries; `cargo install taplo-cli --locked`, `npm i -g @taplo/cli` | 0.10.0 (2025-05-23) | **optional**: use `taplo check` to validate `config.toml` after edits; `taplo get -f config.toml 'mcp_servers.*'` for reads. |
| python3 `tomllib` | TOML read | no ("This module does not support writing TOML"; recommends `tomli-w`) | needs Python 3.11+ | Python.Python.3.x | stdlib | **recommended** for *reading/validating* TOML where python3 exists (Ubuntu/Fedora/Arch/macOS yes; Alpine/Proxmox minimal maybe not; Windows only if Python installed). |
| tomli-w / tomlq (yq-python) | TOML write | yes, but drops comments | pip | pip | n/a | **skip**: extra pip dependency, comment loss. |
| Node one-liner (`node -e` with `JSON.parse`/`JSON.stringify`) | JSON | no | needs Node (which the installer installs anyway for npx) | yes | n/a | **optional** fallback for JSON when jq is missing (e.g. Windows without winget). Do not use for TOML (no stdlib TOML writer). |
| Agent CLIs (`claude mcp add --scope user ...`, `claude mcp add-json`, `codex mcp add <name> --env K=V -- cmd args`, `codex mcp add <name> --url ...`, `codex -c key=value`) | agent-native | yes | built in | yes | Claude 2.1.273 / Codex 0.154.0 | **must-have** as the first choice: they know the on-disk schema and the Windows `cmd /c` rule. Caveat: Codex issue #45432 (open): `codex mcp add/remove` rewrites every `[mcp_servers.*]` entry and drops comments/unknown keys. |

**Recommended least-dependency approach**

1. Back up first: `cp -a FILE FILE.bak.$(date +%Y%m%dT%H%M%S)` / `Copy-Item FILE "FILE.bak.$(Get-Date -Format yyyyMMddTHHmmss)"`; keep the last N.
2. JSON (`settings.json`, `.claude.json`): POSIX -> `jq` (install via distro pkg, Homebrew, or the static release binary into `~/.local/bin`); Windows -> built-in `ConvertFrom-Json`/`ConvertTo-Json -Depth 100`. Deep-merge a small patch object; never rewrite `.claude.json` wholesale from a template (it holds OAuth/account state). Write to a temp file in the same directory, validate (`jq -e . tmp` / `ConvertFrom-Json`), then atomic rename. Prefer `claude mcp add`/`claude plugin ...` over touching `.claude.json`.
3. TOML (`config.toml`): use `codex mcp add`/`codex -c` where possible; for other keys, implement a tiny "managed block" strategy: append `# >>> installer >>> ... # <<< installer <<<` sections with well-formed tables (same idea Codex's own installer uses for PATH in shell profiles), and validate afterwards with `python3 -c 'import tomllib,sys; tomllib.load(open(sys.argv[1],"rb"))' config.toml` or `taplo check`. Do not depend on yq/dasel for TOML writes unless you ship the binary and test round-trips.

---

## 5. Cross-platform interactive TUI building blocks

| Building block | Platforms | Bootstrap cost | Multi-select | Pros | Cons | Verdict |
|---|---|---|---|---|---|---|
| **gum** (charmbracelet) 2.0.1, ~24.4k stars (2026-09-16) | Linux x86_64/arm64/armv7/armv6/i386 (tar.gz, deb, rpm, apk), macOS x86_64/arm64, Windows x86_64/i386 zip, FreeBSD | one ~10 MB binary; `brew install gum`, `pacman -S gum`, `dnf install gum`, Charm apt/yum repos, `winget install charmbracelet.gum`, `scoop install charm-gum`, `nix-env -iA nixpkgs.gum`, or download `gum_2.0.1_<OS>_<arch>.tar.gz` | `gum choose --no-limit --header "..."`, `gum filter --no-limit`, `gum confirm`, `gum input`, `gum spin -- cmd` | same UX in bash and PowerShell (gum is a normal exe), selected items on stdout | extra download; no Windows arm64 zip; needs a real TTY (fails in non-interactive CI unless you skip) | **recommended** default picker with automatic fallback |
| **fzf** 0.74.4 | Linux/macOS/Windows (`winget install junegunn.fzf`, `scoop`, `choco`, `apt/dnf/pacman/apk install fzf`, `brew install fzf`) | one binary | `fzf -m` (TAB to toggle) | ubiquitous on dev boxes, fast | search-oriented UX, less "menu"-like; second dependency | optional (use if already installed) |
| **whiptail / dialog** | Linux only (`whiptail` from `libnewt`, preinstalled on Debian/Ubuntu; `dialog` pkg elsewhere) | usually present on Debian; absent on Alpine/Arch minimal | `--checklist` | zero download on Debian/Proxmox | Linux-only, ncurses look, awkward output parsing | optional Linux fallback |
| **bash `select` / `read -p`** | any bash | none | roll your own (numbered toggles) | zero deps, works over SSH | manual UI code | **must-have** fallback |
| **PowerShell `Read-Host` / `$host.UI.PromptForChoice` / `Out-GridView`** | 5.1 & 7 (Out-GridView is Windows GUI only, not on Server Core) | none | PromptForChoice single; custom loop for multi | zero deps | GUI Out-GridView not headless | **must-have** fallback |
| **Out-ConsoleGridView** (`Install-Module Microsoft.PowerShell.ConsoleGuiTools`) | PowerShell 7.2+ on Windows/Linux/macOS | PSGallery module install | `-OutputMode Multiple` | nice TUI grid | not on 5.1; v0.7.7 is the last PowerShell-team release, now community fork `tui-cs/PSTui` | optional |

Design: `pick()` abstraction -> gum if `command -v gum` (or `Get-Command gum`) and stdin is a TTY -> else fzf -> else built-in menu; `--yes/--all`/`CI=1` skips the picker and selects defaults.

---

## 6. Testing the installer

| Layer | Tool | Install | Use |
|---|---|---|---|
| Bash lint | shellcheck 0.11.0 | `apt install shellcheck`, `dnf install ShellCheck`, `pacman -S shellcheck`, `apk add shellcheck`, `brew install shellcheck`, `winget install --id koalaman.shellcheck`, or `https://github.com/koalaman/shellcheck/releases/download/stable/shellcheck-stable.linux.x86_64.tar.xz` (aarch64, darwin, windows zip also) | `shellcheck -s bash install.sh`; in CI `docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable install.sh` |
| Bash unit tests | bats-core 1.14.0 (2026-07-21; note `run` now honours `set -e`, empty suite errors unless `--allow-empty-suite`) | `brew install bats-core`, `npm install -g bats`, `git clone https://github.com/bats-core/bats-core.git && ./install.sh /usr/local`, Windows Git Bash `./install.sh $HOME` | `bats test/`; `docker run -it -v "${PWD}:/code" bats/bats:latest test` |
| PowerShell lint | PSScriptAnalyzer | `Install-Module -Name PSScriptAnalyzer` (Windows PowerShell 5.x and 7 supported) | `Invoke-ScriptAnalyzer -Path .\install.ps1 -Recurse` with a settings file enabling `PSUseCompatibleCommands`, `PSUseCompatibleSyntax`, `PSUseCompatibleTypes` targeting 5.1 + 7.x profiles |
| PowerShell tests | Pester (v6 docs; requires Windows PowerShell 5.1 or PowerShell 7.4+) | `Install-Module -Name Pester -Force -SkipPublisherCheck` (needed because Windows ships Pester 3.4.0 with a different cert); later `Update-Module -Name Pester` | `Invoke-Pester -Path .\tests` in both `powershell.exe` and `pwsh.exe` |
| Distro matrix | Docker | official images `ubuntu:24.04`, `debian:13`, `fedora:latest`, `archlinux:latest`, `alpine:3.22`, `rockylinux:9`; `--platform linux/arm64` via QEMU/binfmt for ARM64 | `docker run --rm -it -v "$PWD:/w" -w /w <image> bash -c 'apt-get update && apt-get install -y curl ca-certificates && ./install.sh --dry-run'`; test both root and a created non-root user; mind the ~512 MB RAM need and `WORKDIR` hang note |
| Windows CI | GitHub Actions hosted runners | labels `windows-latest` (= Windows Server 2025), `windows-2025`, `windows-2022`; `ubuntu-latest` (24.04), `ubuntu-24.04-arm`; `macos-latest` (macOS 26 arm64), `macos-15` (x64 and arm64); `macos-14` deprecated | run the .ps1 under both `powershell` (5.1) and `pwsh` shells (`shell: powershell` vs `shell: pwsh`); Server 2025 has winget with Desktop Experience but hosted runners may not have it registered, so exercise the `Repair-WinGetPackageManager` path |
| Windows manual/e2e | Windows Sandbox | Pro/Enterprise/Education only (not Home); disposable; **no winget or Store preinstalled** (bootstrap via `Repair-WinGetPackageManager`) | `.wsb` file with `<MappedFolders>` for the repo and `<LogonCommand>` running `powershell -ExecutionPolicy Bypass -File C:\Users\WDAGUtilityAccount\Desktop\repo\install.ps1`; validates the clean-machine + PS 5.1 + no-winget path |
| Idempotence | re-run the installer twice in every matrix cell and diff `~/.claude/settings.json`, `~/.claude.json` (minus volatile keys), `~/.codex/config.toml` | | assert zero diff on second run |

---

## 7. Command reference (verbatim, sourced)

Claude Code
```bash
curl -fsSL https://claude.ai/install.sh | bash
curl -fsSL https://claude.ai/install.sh | bash -s stable
curl -fsSL https://claude.ai/install.sh | bash -s 2.1.89
brew install --cask claude-code
npm install -g @anthropic-ai/claude-code      # Node 22+; native binary via optional deps
claude update
claude doctor
claude --version
claude setup-token
claude auth login
claude mcp add --transport http hubspot --scope user https://mcp.hubspot.com/anthropic
claude mcp add --env AIRTABLE_API_KEY=YOUR_KEY --transport stdio airtable -- npx -y airtable-mcp-server
claude mcp add-json weather-api '{"type":"http","url":"https://api.weather.com/mcp","headers":{"Authorization":"Bearer token"}}'
rm -f ~/.local/bin/claude; rm -rf ~/.local/share/claude   # uninstall native
```
```powershell
irm https://claude.ai/install.ps1 | iex
& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable
& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) 2.1.89
winget install Anthropic.ClaudeCode
winget upgrade Anthropic.ClaudeCode
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
Remove-Item -Path "$env:USERPROFILE\.local\bin\claude.exe" -Force
Remove-Item -Path "$env:USERPROFILE\.local\share\claude" -Recurse -Force
```
```batch
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd
curl --ssl-revoke-best-effort -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd
```

Codex CLI
```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
CODEX_NON_INTERACTIVE=1 sh install.sh --release 0.154.0     # from downloaded script; env CODEX_RELEASE also works
npm install -g @openai/codex
brew install --cask codex
codex update
codex doctor
codex login --device-auth
printenv OPENAI_API_KEY | codex login --with-api-key
ssh -L 1455:localhost:1455 user@remote
codex mcp add <server-name> --env VAR1=VALUE1 --env VAR2=VALUE2 -- <stdio server-command>
codex mcp add <server-name> --url https://example.com/mcp
codex -c model="o3"
```
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
winget install OpenAI.Codex   # lags; ID verified
```

Prereqs / helpers
```bash
apk add bash curl libgcc libstdc++ ripgrep                      # Alpine for Claude
echo "https://dl-cdn.alpinelinux.org/alpine/v3.22/community" >> /etc/apk/repositories
curl -fsSL https://deb.nodesource.com/setup_lts.x -o nodesource_setup.sh && sudo -E bash nodesource_setup.sh && sudo apt install -y nodejs   # README form; setup_24.x also exists
curl -fsSL https://rpm.nodesource.com/setup_23.x -o nodesource_setup.sh && sudo -E bash nodesource_setup.sh && sudo yum install -y nodejs   # README form; rpm setup_24.x also exists
curl -fsSL https://fnm.vercel.app/install | bash ; eval "$(fnm env --use-on-cd)" ; fnm install --lts
curl -LsSf https://astral.sh/uv/install.sh | sh ; uv self update
brew install gum ; pacman -S gum ; dnf install gum
sudo mkdir -p /etc/apt/keyrings && curl -fsSL https://repo.charm.sh/apt/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/charm.gpg && echo "deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *" | sudo tee /etc/apt/sources.list.d/charm.list && sudo apt update && sudo apt install gum
cat foods.txt | gum choose --no-limit --header "Grocery Shopping"
gum confirm && rm file.txt || echo "File not removed"
sudo apt-get install jq ; sudo dnf install jq ; sudo pacman -S jq ; brew install jq
curl -fsSL https://github.com/tamasfe/taplo/releases/latest/download/taplo-linux-x86_64.gz | gzip -d - | install -m 755 /dev/stdin /usr/local/bin/taplo
dasel -i json --root 'settings.theme = "dark"' < config.json > config.json.tmp && mv config.json.tmp config.json
yq -o toml '.' sample.yml
npx skills add <source> -g -y --agent claude-code codex --copy
NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
```powershell
winget install --id Git.Git -e --source winget
winget install --id Microsoft.PowerShell --source winget
winget install --id=astral-sh.uv -e
winget install jqlang.jq
winget install charmbracelet.gum
winget install Schniz.fnm
winget install junegunn.fzf
winget install --id koalaman.shellcheck
Install-Module -Name Microsoft.WinGet.Client -Force -Repository PSGallery; Repair-WinGetPackageManager -AllUsers
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser; irm get.scoop.sh | iex
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
reg add "HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /t REG_DWORD /f /v "AllowDevelopmentWithoutDevLicense" /d "1"
Install-Module -Name PSScriptAnalyzer ; Install-Module -Name Pester -Force -SkipPublisherCheck
Install-Module Microsoft.PowerShell.ConsoleGuiTools
wsl --install ; wsl --set-version <DistroName> 2
```

---

## 8. Open questions

- Codex runtime proxy / custom CA environment variables were not found in the fetched docs (only the installer's URL fallback). Verify `HTTPS_PROXY` honoured by the Rust client and whether there is a `SSL_CERT_FILE`-style override.
- Codex's exact minimum PowerShell version for `install.ps1` is not stated; the script uses only 5.1-compatible constructs (`RuntimeInformation.OSArchitecture`, `Get-FileHash`, `tar`), so 5.1 on Windows 10 1809+ should work but was not executed here.
- Whether `winget upgrade` for `OpenAI.Codex` cleanly replaces a standalone (`install.ps1`) install, or creates a second `codex` on PATH (the .sh installer detects brew/npm conflicts; winget is not in its list).
- How the `skills` CLI behaves on Windows when Developer Mode is off and `--copy` is not passed (fallback-to-copy is reported by third parties, not verified in the README).
- yq TOML round-trip fidelity (comments, `[projects."path"]` quoted keys, arrays of tables) on real `~/.codex/config.toml` needs an empirical test before use.
- PR #3828 merged 2025-11-16 (verified); the exact Codex release that first shipped it and whether `command = "npx"` is now reliable without `cmd /c` remain open.

---

## 9. Sources (fetched 2026-09-16/17)

- https://code.claude.com/docs/en/setup (system requirements, native/WinGet/brew/apt/dnf/apk/npm installs, updates, uninstall)
- https://code.claude.com/docs/en/troubleshoot-install (Windows/Linux/macOS errors, PATH, execution policy, TLS12, proxies, OOM, Docker, AVX, WSL1, musl)
- https://code.claude.com/docs/en/network-config (proxy, CA, mTLS, allow-list hosts)
- https://code.claude.com/docs/en/authentication (`claude setup-token`, `CLAUDE_CODE_OAUTH_TOKEN`, credential storage, headless code paste)
- https://code.claude.com/docs/en/mcp (`claude mcp add`, scopes, env expansion; NOTE: no `cmd /c` auto-wrap statement in the current page)
- https://claude.ai/install.sh and https://claude.ai/install.ps1 (downloaded, read)
- https://registry.npmjs.org/@anthropic-ai/claude-code/latest (2.1.274 on 2026-09-17, node >=22, optional deps incl. musl/arm64/win32-arm64)
- https://github.com/openai/codex (README install commands), https://github.com/openai/codex/releases/expanded_assets/rust-v0.154.0 (assets, 2026-09-09), https://chatgpt.com/codex/install.sh and install.ps1 (downloaded, read), https://registry.npmjs.org/@openai/codex/latest (0.154.0, node >=16)
- https://learn.chatgpt.com/docs/codex/cli, https://learn.chatgpt.com/docs/auth, https://learn.chatgpt.com/docs/windows/windows-sandbox, https://learn.chatgpt.com/docs/extend/mcp?surface=cli, https://learn.chatgpt.com/docs/config-file/config-reference (redirect targets of developers.openai.com/codex/*)
- https://itecsonline.com/post/how-to-install-codex-cli-on-windows-2026-guide (CODEX_NON_INTERACTIVE, install path) - secondary
- https://github.com/openai/codex/pull/3828, https://github.com/openai/codex/issues/45432 (open, filed 2026-09-14 against 0.154.0), community search results on Windows npx MCP
- https://github.com/microsoft/winget-pkgs manifests: a/Anthropic/ClaudeCode, o/OpenAI/Codex (+0.152.0 installer.yaml), c/charmbracelet/gum, g/Git/Git, o/OpenJS/NodeJS/LTS, a/astral-sh/uv, p/Python/Python/3; PR searches for Anthropic.ClaudeCode and OpenAI.Codex
- https://learn.microsoft.com/en-us/windows/package-manager/winget/ and /winget/install (availability, Repair-WinGetPackageManager, flags)
- https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows (winget/MSI/MSIX, Server notes)
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/convertfrom-json, /convertto-json, /invoke-webrequest?view=powershell-5.1 (CVE-2025-54100 prompt), about_character_encoding
- https://support.microsoft.com/kb/5074596 (Invoke-WebRequest prompt)
- https://learn.microsoft.com/en-us/windows/advanced-settings/developer-mode (registry/PowerShell enable), https://blogs.windows.com/windowsdeveloper/2016/12/02/symlinks-windows-10/
- https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation (LongPathsEnabled)
- https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/ (editions, no winget)
- https://learn.microsoft.com/en-us/windows/wsl/install, /basic-commands
- https://github.com/ScoopInstaller/Install (README), https://chocolatey.org/install
- https://raw.githubusercontent.com/vercel-labs/skills/main/README.md, https://github.com/vercel-labs/skills (31.8k stars), https://github.com/vercel-labs/skills/issues?q=is%3Aissue+windows+symlink, https://registry.npmjs.org/skills/latest (1.5.26, node >=22.20.0), npm downloads API (skills 4.62M/wk, @openai/codex 17.1M/wk, @anthropic-ai/claude-code 11.0M/wk for 2026-09-05..11)
- https://raw.githubusercontent.com/charmbracelet/gum/main/README.md, https://github.com/charmbracelet/gum (24.4k stars), https://github.com/charmbracelet/gum/releases/expanded_assets/v2.0.1 (2026-09-11)
- https://raw.githubusercontent.com/junegunn/fzf/master/README.md, https://github.com/junegunn/fzf/releases/latest (v0.74.4, 2026-09-12)
- https://raw.githubusercontent.com/PowerShell/ConsoleGuiTools/main/README.md
- https://jqlang.org/download/, https://github.com/jqlang/jq/releases/expanded_assets/jq-1.8.2 (2026-06-20)
- https://github.com/mikefarah/yq/blob/master/pkg/yqlib/doc/usage/toml.md, https://github.com/mikefarah/yq/releases/expanded_assets/v4.53.6 (2026-08-20), https://mikefarah.gitbook.io/yq/usage/toml
- https://daseldocs.tomwright.me/ (llms.txt, editing-files-in-place, read-write-formats, installation), https://github.com/TomWright/dasel/releases/expanded_assets/v3.11.2 (2026-06-27), README
- https://taplo.tamasfe.dev/cli/introduction.html, /cli/installation/binary.html, /cli/usage/validation.html, https://github.com/tamasfe/taplo/releases/expanded_assets/0.10.0 (2025-05-23)
- https://docs.python.org/3/library/tomllib.html
- https://docs.astral.sh/uv/getting-started/installation/
- https://raw.githubusercontent.com/nodesource/distributions/master/DEV_README.md, https://nodejs.org/en/download (LTS v24.21.0, current v26.9.0), https://github.com/Schniz/fnm (26.9k stars), https://docs.volta.sh/guide/getting-started, https://github.com/nvm-sh/nvm (v0.40.7)
- https://docs.brew.sh/Installation
- https://pve.proxmox.com/wiki/Roadmap (PVE 9.2 on Debian 13)
- nixpkgs: pkgs/by-name/cl/claude-code/{package.nix,manifest.zst.json} (2.1.272), pkgs/by-name/co/codex/package.nix (0.154.0); home-manager modules/programs/claude-code/default.nix, modules/programs/codex/default.nix
- https://bats-core.readthedocs.io/en/stable/installation.html, https://github.com/bats-core/bats-core/releases/latest (v1.14.0)
- https://raw.githubusercontent.com/koalaman/shellcheck/master/README.md, https://github.com/koalaman/shellcheck/releases/latest (v0.11.0)
- https://raw.githubusercontent.com/PowerShell/PSScriptAnalyzer/main/README.md, https://pester.dev/docs/introduction/installation
- https://github.com/actions/runner-images/blob/main/README.md
- Local read-only checks: `codex --help`, `codex update --help`, `codex mcp add --help`, `codex login --help` (0.154.0), `claude --help`, `claude auth login --help`, `claude mcp add --help`, `claude install --help` (2.1.273); `readlink -f ~/.local/bin/codex` -> `~/.codex/packages/standalone/releases/0.154.0-x86_64-unknown-linux-musl/bin/codex`.

---

## Verification (skeptical fact-check, 2026-09-17)

Method: every fact and item above was re-checked against a freshly fetched primary source (curl of the raw docs/README/manifest/registry JSON, WebFetch of rendered Microsoft Learn pages, local `--help` of the installed `claude` 2.1.273 and `codex` 0.154.0). The four installer scripts were re-downloaded to the scratchpad and read, not executed. GitHub REST API rate-limited after ~15 calls; remaining star counts were scraped from the repo HTML pages (`aria-label="N users starred"`). Nothing was installed or modified.

### Corrections made to the body

| # | Claim as written | Finding | Source that decided it |
|---|---|---|---|
| 1 | Claude Code "2.1.273 current" | npm `latest` is **2.1.274** and CHANGELOG.md head is `## 2.1.274` (2026-09-17). 2.1.273 is what is installed locally. winget lag is therefore 2.1.268 vs 2.1.274. | https://registry.npmjs.org/@anthropic-ai/claude-code/latest, https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md |
| 2 | `skills` CLI "1.5.26" | npm `latest` is **1.6.0** (node >=22.20.0, bins `skills` and `add-skill`); GitHub release v1.6.0 2026-09-16. | https://registry.npmjs.org/skills/latest, https://github.com/vercel-labs/skills/releases/latest |
| 3 | "Claude Code docs: automatically wraps stdio `npx` servers with `cmd /c` on Windows" | **Not in the current MCP doc** (116 KB page fetched 2026-09-17 has zero occurrences of `cmd /c`). Only evidence: CHANGELOG 2.1.119 removed the *warning* "Windows requires 'cmd /c' wrapper"; issue #20061 (closed, not planned) says `claude mcp add` does not auto-wrap and Git Bash mangles `/c` to `C:/`. Downgraded to medium and reworded to "write the explicit `cmd /c` form". | https://code.claude.com/docs/en/mcp, CHANGELOG.md line "2.1.119", https://github.com/anthropics/claude-code/issues/20061 |
| 4 | skills `--copy` quote "…Use when symlinks aren't supported" | README option table says only "Copy files instead of symlinking to agent directories". Extra clause removed. | https://raw.githubusercontent.com/vercel-labs/skills/main/README.md |
| 5 | NodeSource `setup_24.x … sudo bash nodesource_setup.sh && sudo apt-get install nodejs` | DEV_README examples are `curl -fsSL https://deb.nodesource.com/setup_lts.x -o nodesource_setup.sh`, `sudo -E bash nodesource_setup.sh`, `sudo apt install -y nodejs` (rpm: `setup_23.x`, `sudo yum install -y nodejs`). `setup_24.x`/`setup_26.x` URLs do exist (HTTP 200, script sets `NODE_VERSION="24.x"`) but are not the README's example. Commands replaced with README form. | https://raw.githubusercontent.com/nodesource/distributions/master/DEV_README.md, https://deb.nodesource.com/setup_24.x |
| 6 | nvm "does not support Windows" | README actually says "nvm also supports Windows in some cases" (WSL, Git Bash/MSYS, Cygwin) and names nvm-windows as an unsupported alternative. Also README now lists prebuilt `linux-x64-musl` binaries for v24.20.0+/v26.8.0+, so `-s` is not always required on Alpine. | https://github.com/nvm-sh/nvm/blob/master/README.md |
| 7 | Scoop admin one-liner `iex "& {$(irm get.scoop.sh)} -RunAsAdmin"` | Present in README, but README's recommended admin path is `irm get.scoop.sh -outfile 'install.ps1'` then `.\install.ps1 -RunAsAdmin`. Both now listed. | https://github.com/ScoopInstaller/Install/blob/master/README.md |
| 8 | Chocolatey one-liner | Official page includes `[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072;` between the two statements; command fixed character-for-character. | https://chocolatey.org/install (input `value=` attribute) |
| 9 | Codex PR #3828 "date not verified" | Merged 2025-11-16 (`dylan-hurd-oai merged commit f828cd2 into openai:main`). | https://github.com/openai/codex/pull/3828 |
| 10 | Issue #45432 sourced from a search URL | Direct URL verified: open, filed 2026-09-14 against codex-cli 0.154.0 / Windows 11, no maintainer reply. | https://github.com/openai/codex/issues/45432 |
| 11 | Developer-Mode `reg add` attributed to the 2016 symlinks blog | The blog has no registry command (it documents build 14972 and `SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE` 0x2). The `reg add "HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /t REG_DWORD /f /v "AllowDevelopmentWithoutDevLicense" /d "1"` command is on the Microsoft Learn developer-mode page (ms.date 2025-11-12). | https://learn.microsoft.com/en-us/windows/advanced-settings/developer-mode |
| 12 | PSScriptAnalyzer compat rules | `UseCompatibleCommands`, `UseCompatibleSyntax`, `UseCompatibleTypes` exist but are **Disabled by default** (must be enabled in a settings file); `UseCompatibleCmdlets` is always enabled. README install line is `Install-Module -Name PSScriptAnalyzer`. | https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/readme |
| 13 | Codex stars "~125k (unverified)" | GitHub API: openai/codex 124,786 stars, pushed 2026-09-17; anthropics/claude-code 145,588. | https://api.github.com/repos/openai/codex |

### Confirmed unchanged (spot list)

- Claude install commands, pin forms (`bash -s stable`, `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable`, `install.cmd stable`), system requirements, Alpine packages + `USE_BUILTIN_RIPGREP`, apt/dnf/apk repo lines, fingerprint `31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE`, apk key sha256, `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE`, winget lock note: all verbatim in https://code.claude.com/docs/en/setup.
- install.sh sudo refusal (`CLAUDE_INSTALL_ALLOW_SUDO=1`), curl|wget, musl detection, optional jq/zstd; install.ps1 `Is64BitProcess`, ARM64 pick, `%USERPROFILE%\.claude\downloads`, manifest checksum: re-read from freshly downloaded scripts.
- troubleshoot-install: execution-policy/npm shim fix, `Tls12` line, `--ssl-revoke-best-effort`, User PATH snippet, 512 MB / exit 137, `WORKDIR /tmp`, AVX (#50384), WSL1 (#38788), `CLAUDE_CODE_GIT_BASH_PATH` and bash.exe/sh.exe naming, "Windows PowerShell (x86)" warning.
- network-config allow-list hosts, no SOCKS, `CLAUDE_CODE_CERT_STORE` values, settings.json `env` for background supervisor. authentication: `claude setup-token` one-year token, not read in `--bare`, credentials paths, Keychain fallback. `claude auth login|logout|status` exist (cli-reference + local `claude auth --help`).
- Codex README install lines (`curl -fsSL https://chatgpt.com/codex/install.sh | sh`, `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`, `npm install -g @openai/codex`, `brew install --cask codex`); install.sh env vars/requirements/musl targets/`# >>> Codex installer >>>`; install.ps1 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`, junction, `RuntimeInformation.OSArchitecture`, `-UseBasicParsing`, `tar -xzf`, `Get-FileHash`, User Path update.
- rust-v0.154.0 is still `releases/latest` (published 2026-09-09T22:35Z); asset list confirmed (incl. `install.sh`, `install.ps1`, `codex-package_SHA256SUMS`, `codex-windows-sandbox-setup-*`, npm tgz for 6 platforms).
- learn.chatgpt.com auth (device-auth, port 1455, `--with-api-key`, `--with-access-token`, `cli_auth_credentials_store`), windows-sandbox (`[windows] sandbox = "elevated"|"unelevated"`, Win10 1809+, winget, ConPTY), config reference (`startup_timeout_sec` default 10 s, `trust_level`), MCP CLI (`codex mcp add context7 -- npx -y @upstash/context7-mcp`, `--url`). Local `codex --help` lists `update`, `doctor`, `mcp`, `plugin`, `login --device-auth`.
- winget-pkgs: `Anthropic.ClaudeCode` newest dir 2.1.268 (portable, x64+arm64, ReleaseDate 2026-09-10); `OpenAI.Codex` newest dir 0.152.0 (zip/portable, deps `BurntSushi.ripgrep.MSVC`, `Microsoft.VCRedist.2015+`). IDs and newest versions: `Git.Git` 2.55.0.3, `OpenJS.NodeJS.LTS` 24.19.0, `Python.Python.3.13` 3.13.15, `Python.Python.3.14` 3.14.7, `astral-sh.uv` 0.12.15, `jqlang.jq` 1.8.2, `charmbracelet.gum` 2.0.0, `Microsoft.PowerShell` 7.6.6.0, `Schniz.fnm` 1.39.0, `junegunn.fzf` 0.74.4, `koalaman.shellcheck` 0.11.0, `Volta.Volta` 2.0.2, `Microsoft.WindowsTerminal` 1.24.11911.0, `MikeFarah.yq` 4.53.6 (the last two were open questions; now verified).
- Microsoft Learn: winget availability text ("only supported on Windows 10 version 1809 (build 17763) or later", "`winget` isn't available on Windows Server 2022 or earlier versions. Windows Server 2025 includes `winget` for Windows Server with Desktop Experience only"), Sandbox bootstrap block, `winget install` option table, PowerShell 7 install (MSIX default since 7.6.0, `--installer-type wix`, MSI silent params; **new:** "Beginning with the PowerShell 7.7.0 release, there is no MSI package available"), execution policies (Undefined -> Restricted on clients / RemoteSigned on Server; curl.exe/irm/iwr do not add MOTW; Server Core zone-check failure), Invoke-WebRequest CVE-2025-54100 prompt text and "There is no way to bypass this prompt without using the UseBasicParsing parameter", ConvertFrom-Json (`-AsHashtable` 6.0, OrderedHashtable 7.3, 5.1 errors on comments, `-Depth` 1024 since 6.2), ConvertTo-Json (`-Depth` default 2 max 100, warning since 7.1, `-EscapeHandling` 6.2), character encoding (Out-File/`>` UTF-16LE, Set-Content ANSI, `UTF8` = with BOM, v6+ utf8NoBOM, save scripts as UTF-8-BOM), long paths PowerShell line (1607+, longPathAware), Windows Sandbox editions (Pro/Enterprise/Education; "not supported on Windows Home edition").
- Tooling: uv install lines incl. `winget install --id=astral-sh.uv -e`, `scoop install main/uv`, `uv self update`; jq 1.8.2 assets (adds riscv64/s390x/ppc64el/mips, `jq-windows-arm64.exe`); yq 4.53.6 assets incl. `yq_windows_arm64.exe`, TOML doc still has "yq can't do this one yet" (2 places); dasel v3 "built-in file editing was removed", TOML "Generally working. Unsorted maps.", scoop `extras`, `go install …/v3/cmd/dasel@master`; taplo 0.10.0 (validation/formatting/querying only, binary one-liner verbatim, windows aarch64 assets exist); tomllib "This module does not support writing TOML"; gum 2.0.1 assets (Windows x86_64/i386 only, no Windows arm64), README install lines and `gum choose --no-limit`; fzf 0.74.4 (README says `winget install fzf`, id `junegunn.fzf` verified in winget-pkgs); ConsoleGuiTools 0.7.7 final, PS 7.2+, PSTui fork; Homebrew install line, `NONINTERACTIVE=1`, prefixes, macOS 15-27 supported; Proxmox VE 9.2 released 21 May 2026 (arm64 05 Aug 2026), "Based on Debian Trixie (13)"; nixpkgs claude-code manifest 2.1.272 / codex 0.154.0; home-manager `options.nix` option names for both modules (claude-code also has `enableMcpIntegration`, `finalPackage`, `rulesDir`, `agentsDir`, `commandsDir`, `hooksDir`); bats 1.14.0 changelog (`run` honors `set -e`, empty suite errors, `--allow-empty-suite`); shellcheck README lines; Pester 5.1 / 7.4+ and `-SkipPublisherCheck`; runner-images table (`windows-latest` = Server 2025, `macos-latest` = macOS 26 arm64, macOS 14 deprecated, `ubuntu-24.04-arm`); WSL `wsl --install`, Win10 2004+.
- npm weekly downloads 2026-09-05..11 unchanged: codex 17,149,232; claude-code 10,994,666; skills 4,621,540.

### New facts found while checking

- Claude `install.ps1` calls `Invoke-WebRequest -Uri … -OutFile …` **without** `-UseBasicParsing`; Codex `install.ps1` always passes `-UseBasicParsing`. On a CVE-2025-54100-patched Windows PowerShell 5.1 the Claude installer may therefore hit the "Script Execution Risk" prompt (KB5074596 warns automated scripts "could hang"); prefer `install.cmd` (curl.exe based) or run the installer under `pwsh` on such hosts, and test before relying on it.
- Codex install.sh also installs `codex-code-mode-host` next to `codex` in `BIN_DIR`, and honours `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM=false` to force GitHub Releases (README + script).
- `@openai/codex` npm package declares `engines.node >=16` (0.154.0); `@anthropic-ai/claude-code` 2.1.274 declares `>=22.0.0`.
- PowerShell 7.7.0+ ships MSIX only (no MSI); 7.6 is the current LTS. Windows Server installs should pin 7.6.x MSI if MSI is required.
- Node.js dist index: latest LTS v24.21.0, current v26.9.0 (2026-09-17), consistent with the download page.
- Stars (2026-09-17): fzf 83,032; nvm 95,099; uv 89,888; shellcheck 40,045; jq 35,609; skills 31,818; fnm 26,873; gum 24,383; yq 15,969; winget-pkgs 11,086; dasel 8,034; bats-core 6,265; taplo 2,391; ConsoleGuiTools 953.
- Claude Code CHANGELOG 2.1.274 adds `CLAUDE_CODE_MCP_STARTUP_WAIT_MS` (bounds the first non-interactive turn's wait for MCP servers).

### Items removed

None. Every item's URL resolved (HTTP 200) and the underlying repo/package/doc exists. Two items have weak source URLs rather than wrong ones: "whiptail / dialog" (cited the Claude setup page; Debian package page https://packages.debian.org/trixie/whiptail confirmed HTTP 200) and "Built-in menus" (cites the execution-policy page). Both kept with the caveat noted.
