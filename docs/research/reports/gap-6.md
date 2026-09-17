# GAP-FILL 6 — Homelab / infra angle: Proxmox host, unprivileged LXC, VMs, Docker, fleet rollout with pre-seeded auth

Research date: 2026-09-17. Local reference host: Ubuntu 26.04 (itself a KVM guest), Claude Code 2.1.273/2.1.274, Codex CLI 0.154.0 (standalone installer, `x86_64-unknown-linux-musl`), Docker 29.1.3, bubblewrap 0.11.1.

Method: primary docs fetched as Markdown (`learn.chatgpt.com/docs/*.md`, `code.claude.com/docs/en/*.md`), raw installer scripts (`https://claude.ai/install.sh`, `https://chatgpt.com/codex/install.sh`), Codex Rust sources on `openai/codex@main`, Proxmox `pve-container` source, and **empirical tests in throwaway Docker containers** (`debian:13`, both agents installed as root). Nothing on the host was modified. GitHub API was rate-limited from this IP, so stars come from scraped repo pages and last-commit dates from `commits/main.atom` feeds (all dated 2026-09-17).

---

## 0. TL;DR for the installer design

1. **Codex sandbox = bubblewrap + unprivileged user namespaces.** Codex 0.154 ships its own static `codex-resources/bwrap` and prefers a system `bwrap` on PATH. It runs a startup probe against the **system** bwrap (`bwrap --unshare-user --unshare-net --ro-bind / / /bin/true`; when no `bwrap` is on PATH it prints a different "could not find bubblewrap ... will use the bundled bubblewrap" warning and does not probe the bundled one); on probe failure it only prints `warning: Codex's Linux sandbox uses bubblewrap and needs access to create user namespaces.` and then *every sandboxed shell command fails* and gets escalated as an approval ("retry without sandbox"). `codex doctor --json` reports `sandbox.helpers: ok` even where bwrap cannot work (verified in default Docker), so the installer must run its own probe.
2. **Default Docker: broken** (seccomp + AppArmor block `unshare(CLONE_NEWUSER)`). `--security-opt seccomp=unconfined --security-opt apparmor=unconfined` lets user namespaces work but `/proc` mount fails; Codex's auto `--no-proc` fallback only matches the string `/newroot/proc` while Debian 13's bwrap 0.12.0 prints `on /proc` (openai/codex#44329) so **with the distro bwrap installed the sandbox still fails; removing `/usr/bin/bwrap` so Codex uses its bundled bwrap makes it work** in unconfined Docker; `--privileged` works either way.
3. **Documented escape hatch** is `sandbox_mode = "danger-full-access"` (+ `approval_policy = "never"`) or CLI `--sandbox danger-full-access` / `--dangerously-bypass-approvals-and-sandbox`. `CODEX_SANDBOX` / `CODEX_SANDBOX_NETWORK_DISABLED` are **outputs** Codex sets for child processes (`core/src/spawn.rs`), not inputs.
4. **Proxmox unprivileged LXC**: `features: nesting=1` is what makes pve-container emit `lxc.apparmor.allow_nesting = 1` + `lxc.apparmor.raw = allow userns,`; without it the generated profile carries `deny mount -> /proc/` and no `userns` rule. So: `pct set <id> --features nesting=1` (keyctl=1 too if Docker inside) is the minimum for Codex's sandbox inside an LXC; otherwise ship the profile `sandbox_mode="danger-full-access"` (the container is the boundary). Not tested on a real PVE node (no PVE here) — the installer should probe.
5. **Claude Code**: no sandbox by default (opt-in `sandbox.enabled`); when enabled and bwrap can't start it warns and runs unsandboxed unless `sandbox.failIfUnavailable`. For containers there is `sandbox.enableWeakerNestedSandbox: true`. **`--dangerously-skip-permissions` is refused as root** (`cannot be used with root/sudo privileges`); undocumented `IS_SANDBOX=1` env skips that check (observed). Prefer `--permission-mode auto` or a non-root user.
6. **CPU**: Claude Code native binary needs **AVX** (docs: "no native-binary workaround", issue #50384 closed-not-planned). Proxmox default web-UI CPU type `x86-64-v2-AES` has **no AVX**; `x86-64-v3` (adds `+avx,+avx2,...`) or `host` do. Codex is a musl static binary; no AVX requirement documented.
7. **Root**: Claude `install.sh` refuses only `sudo`-from-user (`SUDO_USER` set) unless `CLAUDE_INSTALL_ALLOW_SUDO=1`; plain root (pct exec, containers) is explicitly fine. Codex `install.sh` has no root check, and `CODEX_NON_INTERACTIVE=1` (or no TTY) answers all prompts "no". `npx skills add ... -g -a claude-code codex -y` works as root (verified). Both installers land in `$HOME/.local/bin`; for a Proxmox host prefer the signed **apt repo** for Claude Code (`sudo apt install claude-code`, updates via apt).
8. **Pre-seeding**: Codex: copy `~/.codex/auth.json` (0600) + `cli_auth_credentials_store = "file"` + `[projects."<dir>"] trust_level = "trusted"`; or `codex login --device-auth`; or `CODEX_API_KEY`. Claude: `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` env (1-year, subscription); seeding `~/.claude.json` with `{"hasCompletedOnboarding": true, "projects": {"<dir>": {"hasTrustDialogAccepted": true}}}` **verified** to skip the theme wizard and the trust dialog on first interactive launch. `claude -p` never shows the trust dialog (documented) and exits 1 with `Not logged in · Please run /login` when no credential is present (no hang).
9. **Fleet**: `pct exec <vmid> -- bash -lc '...'`, `pct push` for files (`--perms 0600`), `qm guest exec <vmid> --pass-stdin 1 --timeout 0 -- bash -c '...'` (needs qemu-guest-agent), cloud-init `runcmd` (once-per-instance, `/bin/sh`), Ansible `ansible.builtin.shell` with `creates:`.

---

## 1. Codex Linux sandbox: requirements, behaviour when unavailable, escape hatches

### 1.1 What the docs say (learn.chatgpt.com/docs/sandboxing.md, fetched 2026-09-17)

> On **Linux and WSL2**, install `bubblewrap` with your package manager first: `sudo apt install bubblewrap` / `sudo dnf install bubblewrap`
>
> Codex uses the first `bwrap` executable it finds on `PATH`. If no `bwrap` executable is available, Codex falls back to a bundled helper, but that helper requires support for unprivileged user namespace creation. Installing the distribution package that provides `bwrap` keeps this setup reliable.
>
> Codex surfaces a startup warning when `bwrap` is missing or when the helper can't create the needed user namespace. On distributions that restrict this AppArmor setting, prefer loading the `bwrap` AppArmor profile so `bwrap` can keep working without disabling the restriction globally.

Ubuntu 24.04 fix (verbatim from the doc):
```bash
sudo apt update
sudo apt install apparmor-profiles apparmor-utils
sudo install -m 0644 \
  /usr/share/apparmor/extra-profiles/bwrap-userns-restrict \
  /etc/apparmor.d/bwrap-userns-restrict
sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict
```
Global fallback: `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`.
Ubuntu 25.04+: the `bwrap-userns-restrict` profile ships in the `apparmor` package at `/etc/apparmor.d/bwrap-userns-restrict` (present on this Ubuntu 26.04 host; the probe passes here even with `kernel.apparmor_restrict_unprivileged_userns = 1`).

Sandbox modes (same doc): `read-only`, `workspace-write` (default for local work), `danger-full-access` ("runs without sandbox restrictions. This removes the filesystem and network boundaries"). "Full access means using `sandbox_mode = "danger-full-access"` together with `approval_policy = "never"`." `approval_policy = "untrusted"` is retired.

Non-interactive doc (`non-interactive-mode.md`): "By default, `codex exec` runs in a read-only sandbox" — `codex exec --sandbox workspace-write "<task>"`, `codex exec --sandbox danger-full-access "<task>"` ("only in a controlled environment (for example, an isolated CI runner or container)"); `--full-auto` is deprecated; `--skip-git-repo-check` needed outside a git repo; `--ignore-user-config`, `--ignore-rules` exist.

### 1.2 What the source says (openai/codex@main, fetched 2026-09-17)

`codex-rs/linux-sandbox/README.md`:
- "On Linux, Codex prefers the first `bwrap` found on `PATH` outside the current working directory whenever it is available. ... If `bwrap` is missing, the helper falls back to the bundled `codex-resources/bwrap` binary shipped with Codex."
- "If bubblewrap cannot create user namespaces, Codex surfaces a startup warning instead of waiting for a runtime sandbox failure."
- "WSL1 is not supported for bubblewrap sandboxing"
- "Filesystem-restricted execution requires bubblewrap. The legacy Landlock option is rejected for these policies because it cannot isolate app-server Unix sockets. Disable `features.use_legacy_landlock` when upgrading." (i.e. **Landlock is no longer a fallback**.)
- "the helper explicitly isolates the user namespace via `--unshare-user` and the PID namespace via `--unshare-pid`" ... "it mounts a fresh `/proc` via `--proc /proc` by default, but you can skip this in restrictive container environments with `--no-proc`."
- Filesystem is `--ro-bind / /` by default, writable roots layered with `--bind`, `.git`/`.codex` re-applied read-only; seccomp network filter + `PR_SET_NO_NEW_PRIVS` in-process.

`codex-rs/sandboxing/src/bwrap.rs` — the startup probe and exact strings:
```rust
const MISSING_BWRAP_WARNING: &str = concat!(
    "Codex could not find bubblewrap on PATH. ",
    "Install bubblewrap with your OS package manager. ", ...
    "Codex will use the bundled bubblewrap in the meantime.");
const USER_NAMESPACE_WARNING: &str =
    "Codex's Linux sandbox uses bubblewrap and needs access to create user namespaces.";
const USER_NAMESPACE_FAILURES: [&str; 4] = [
    "loopback: Failed RTM_NEWADDR",
    "loopback: Failed RTM_NEWLINK",
    "setting up uid map: Permission denied",
    "No permissions to create a new namespace",
];
// probe = bwrap --unshare-user --unshare-net --ro-bind / / /bin/true   (500 ms timeout)
```
The warning is only computed when the permission profile requires the platform sandbox (`should_require_platform_sandbox`), i.e. not under `danger-full-access`.

`codex-rs/linux-sandbox/src/launcher.rs`: `BubblewrapLauncher::{System, Bundled, Unavailable}`; `Unavailable` panics with "bubblewrap is unavailable: no system bwrap was found on PATH and no bundled codex-resources/bwrap binary was found next to the Codex executable". System bwrap must advertise `--as-pid-1` and `--perms`; pre-0.9.0 builds fall back to a no-`--argv0` path.

`codex-rs/linux-sandbox/src/linux_run_main.rs`: `run_bwrap_with_proc_fallback` runs a preflight (`/bin/true` under bwrap with `--proc /proc`), and if `is_proc_mount_failure()` matches it retries with `mount_proc=false`. The matcher is:
```rust
fn is_proc_mount_failure(stderr: &str) -> bool {
    stderr.contains("Can't mount proc")
        && stderr.contains("/newroot/proc")
        && (stderr.contains("Invalid argument")
            || stderr.contains("Operation not permitted")
            || stderr.contains("Permission denied"))
}
```
Debian 13 / Fedora 44 bubblewrap **0.12.0 prints `bwrap: Can't mount proc on /proc: Operation not permitted`** (no `/newroot`), so the fallback never fires — openai/codex issue #44329 (opened 2026-09-09, Podman/Fedora 44, Codex 0.153.4, no maintainer reply at fetch time). Reproduced below in Docker.

`codex-rs/core/src/spawn.rs`:
```rust
pub const CODEX_SANDBOX_NETWORK_DISABLED_ENV_VAR: &str = "CODEX_SANDBOX_NETWORK_DISABLED";
/// Should be set when the process is spawned under a sandbox. Currently, the value is "seatbelt" for macOS ...
pub const CODEX_SANDBOX_ENV_VAR: &str = "CODEX_SANDBOX";
...
if !network_sandbox_policy.is_enabled() { cmd.env(CODEX_SANDBOX_NETWORK_DISABLED_ENV_VAR, "1"); }
```
→ **These are signals Codex sets for the child command, not user-facing escape hatches.** (Verified: inside `codex sandbox -- sh -c 'echo $CODEX_SANDBOX_NETWORK_DISABLED'` prints `1` on Linux; `CODEX_SANDBOX` is empty on Linux.)

`codex-rs/config` reference (`config-reference.md`): `sandbox_mode`, `approval_policy` (`on-request` | `never` | granular), `sandbox_workspace_write.writable_roots`, `network_access`, `projects.<path>.trust_level` (`"trusted"` | `"untrusted"`: "Untrusted projects skip project-scoped `.codex/` layers, including project-local config, hooks, and rules"), `cli_auth_credentials_store` (`file | keyring | auto | ephemeral`), `features.hooks`, `allow_managed_hooks_only`, `notice.hide_full_access_warning`.

CLI flags (from `codex --help` / `codex exec --help` 0.154.0, local):
- `-s, --sandbox <read-only|workspace-write|danger-full-access>`
- `-a, --ask-for-approval <on-request|never>`
- `--dangerously-bypass-approvals-and-sandbox` — "Skip all confirmation prompts and execute commands without sandboxing. EXTREMELY DANGEROUS. Intended solely for running in environments that are externally sandboxed"
- `--dangerously-bypass-hook-trust` — "Run enabled hooks without requiring persisted hook trust for this invocation. DANGEROUS."
- `--skip-git-repo-check`, `-C/--cd <DIR>`, `-c key=value` config overrides
- `codex sandbox [COMMAND]...` — "Run commands within a Codex-provided sandbox" (great preflight primitive)
- `codex doctor [--json] [--summary]` — "Diagnose local Codex installation, config, auth, and runtime health"

### 1.3 What `codex doctor --json` reports (local + container, 0.154.0)

Schema: `{schemaVersion, generatedAt, overallStatus, codexVersion, checks{...}}`. Relevant check ids: `auth.credentials`, `installation`, `runtime.provenance`, `sandbox.helpers`, `updates.status`, `network.provider_reachability`, `mcp.config`, `git.environment`, `system.disk`.

`sandbox.helpers` on this host: `status: ok`, summary "sandbox configuration is readable", details `{"approval policy":"OnRequest","codex-linux-sandbox helper":"~/.codex/tmp/arg0/.../codex-linux-sandbox","filesystem sandbox":"restricted","network sandbox":"restricted",...}`.
**In a default Docker container where bwrap cannot create a user namespace, `sandbox.helpers` is still `ok`** (only `auth.credentials` failed, `overallStatus: fail`). Conclusion: `codex doctor` does **not** probe user-namespace capability. The installer must run the bwrap probe itself (or `codex sandbox -- /bin/true`).

`installation.details` also tells you the install method: `"install context":"standalone (unix, package ~/.codex/packages/standalone/releases/0.154.0-x86_64-unknown-linux-musl, ...)"`, `"managed by npm":"false"` → this machine's Codex is the **standalone installer**, not npm (answers the inventory's "npm? unknown").

### 1.4 Empirical matrix (Docker 29.1.3 on Ubuntu 26.04 host, image `debian:13` + `apt install bubblewrap` (0.12.0) + both installers as root)

Probe = `bwrap --unshare-user --unshare-net --ro-bind / / /bin/true` (Codex's own probe); `codex sandbox -- sh -c 'echo ok'` = the real thing.

| Environment | bwrap probe | `codex sandbox` (system bwrap 0.12.0 on PATH) | `codex sandbox` (system bwrap removed → bundled) |
|---|---|---|---|
| `docker run` (defaults) | `bwrap: No permissions to create a new namespace, likely because the kernel does not allow non-privileged user namespaces.` exit 1 | same error, exit 1 (also with `-s danger-full-access` on `codex sandbox`) | not tested (same kernel block) |
| `--security-opt seccomp=unconfined` | `Failed to make / slave: Permission denied` | — | — |
| `--security-opt apparmor=unconfined` | `No permissions to create a new namespace` | — | — |
| `--cap-add SYS_ADMIN` | `Failed to make / slave: Permission denied` | — | — |
| `seccomp=unconfined` + `apparmor=unconfined` | userns probe **OK**; `--proc /proc` → `Can't mount proc on /proc: Operation not permitted` | **FAIL** `bwrap: Can't mount proc on /proc: Operation not permitted` (fallback matcher misses, #44329) | **FAIL** `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` |
| `seccomp=unconfined` + `apparmor=unconfined` + `--cap-add SYS_ADMIN --cap-add NET_ADMIN` | OK | **FAIL** (proc mount, #44329) | **OK** (`SANDBOX-OK uid=0 NET=1`, `/etc` read-only) |
| `--privileged` | OK, proc OK | **OK** | **OK** |

Also: `codex exec --skip-git-repo-check "say hi"` in default Docker prints `warning: Codex's Linux sandbox uses bubblewrap and needs access to create user namespaces.` and continues (then 401 because no auth). So the warning is non-fatal; failures surface per-command.

Practical rule for the installer's Docker/LXC profile:
- If probe fails → write `sandbox_mode = "danger-full-access"` + `approval_policy = "never"` **only if** the user opted into "container is the boundary"; otherwise leave `workspace-write` and warn that every shell call will ask to run unsandboxed.
- If probe passes but `--proc` preflight fails and `/usr/bin/bwrap --version` ≥ 0.12 → advise removing/renaming the distro bwrap so Codex's bundled static bwrap (which prints `/newroot/proc`) is used, until #44329 is fixed. (Codex's own docs recommend installing the distro package, so treat this as a temporary workaround and re-test on upgrade.)

### 1.5 Proxmox LXC specifics (pve-container `src/PVE/LXC.pm` @HEAD, fetched 2026-09-17)

`make_apparmor_config`:
```perl
my $raw = "lxc.apparmor.profile = generated\n";
$raw .= "lxc.apparmor.raw = allow mqueue,\n";
if ($features->{nesting}) {
    $raw .= "lxc.apparmor.allow_nesting = 1\n";
    $raw .= "lxc.apparmor.raw = allow userns,\n";
} else {
    $raw .= "lxc.apparmor.raw = deny mount -> /proc/,\n";
    $raw .= "lxc.apparmor.raw = deny mount -> /sys/,\n";
}
```
Comment in the same file: `lxc.apparmor.allow_nesting` "adds proc and sysfs mounts to /dev/.lxc/{proc,sys}. These do not have lxcfs mounted over them, because that would prevent the container from mounting new instances of them for nested containers." Unprivileged CTs also get `lxc.mount.auto = sys:mixed` unless `force_rw_sys=1`, and keyctl is `errno 38` unless `keyctl=1`.

Proxmox docs (`pve-docs/chapter-pct.html`): `nesting=<boolean> (default = 0)` "Allow nesting. Best used with unprivileged containers with additional id mapping. Note that this will expose procfs and sysfs contents of the host to the guest. This is also required by systemd to isolate services." `keyctl=<boolean> (default = 0)` "For unprivileged containers only: Allow the use of the keyctl() system call. This is required to use docker inside a container." `unprivileged` is the default for new CTs; `lxc.apparmor.profile = unconfined` in `/etc/pve/lxc/CTID.conf` disables AppArmor ("not recommended for production use"). LXC man page: `lxc.apparmor.allow_nesting` "When generated apparmor profiles are used, they will contain the necessary changes to allow creating a nested container."

Community evidence: flatpak/bwrap inside unprivileged PVE CTs needs nesting and sometimes `lxc.mount.auto: sys:mixed proc:rw` (Proxmox forum thread 181245, 2026-02-28, PVE 9); unresolved LXC-forum thread 18871 (2024) with `bwrap: cannot open /proc/sys/user/max_user_namespaces: Read-only file system` (proc:mixed remounts `/proc/sys` RO — bwrap only reads that file, so this is cosmetic).

**Expected** (untested here — no PVE node available): unprivileged CT + `nesting=1` → user namespace creation and `--proc` mount allowed (clean proc at `/dev/.lxc/proc` satisfies the kernel's "fully visible proc" rule) → Codex sandbox works; without `nesting=1` → probe fails → same failure mode as default Docker. Privileged CT: same, plus nesting still required for the AppArmor `userns` rule. **The installer must probe rather than assume.**

Proxmox host itself (Debian 13, root): bwrap as real root is unaffected by the unprivileged-userns AppArmor restriction; expected to work. Debian 13's `bubblewrap` is 0.12.0 (observed in `debian:13`), so the `/newroot/proc` matcher issue only matters where `/proc` cannot be mounted.

### 1.6 Suggested preflight snippet (installer)
```bash
codex_sandbox_probe() {
  local bw; bw="$(command -v bwrap || echo "$HOME/.codex/packages/standalone/current/codex-resources/bwrap")"
  [ -x "$bw" ] || { echo "no bwrap"; return 2; }
  if ! timeout 5 "$bw" --unshare-user --unshare-net --ro-bind / / /bin/true 2>/tmp/bw.err; then
    echo "userns: $(head -1 /tmp/bw.err)"; return 1; fi
  if ! timeout 5 "$bw" --unshare-user --unshare-pid --ro-bind / / --proc /proc /bin/true 2>/tmp/bw.err; then
    echo "proc: $(head -1 /tmp/bw.err)"; return 3; fi
  command -v codex >/dev/null && timeout 20 codex sandbox -- /bin/true </dev/null
}
```
Return 1 → offer `danger-full-access` profile / `pct set --features nesting=1` hint; return 3 with distro bwrap ≥0.12 → hint about #44329.

---

## 2. Claude Code CPU / AVX and Proxmox CPU types

`code.claude.com/docs/en/setup.md` (2026-09-17) System requirements: macOS 13.0+, Windows 10 1809+/Server 2019+, Ubuntu 20.04+, Debian 10+, Alpine 3.19+; "**Hardware**: 4 GB+ RAM, x64 or ARM64 processor"; ripgrep usually bundled. **No AVX statement on setup.md.**

`troubleshoot-install.md` → "### `Illegal instruction`":
> **Missing AVX instruction set.** If your architecture is correct but you still see `Illegal instruction`, your CPU likely lacks AVX or another instruction the binary requires. This affects roughly pre-2013 Intel and AMD processors, and virtual machines where the hypervisor does not pass AVX through to the guest.
> On a VPS or VM, run `grep -m1 -ow avx /proc/cpuinfo`; an empty result means AVX is not available to the guest.
> There is no native-binary workaround; track [issue #50384](https://github.com/anthropics/claude-code/issues/50384) for status ... Alternative install methods download the same native binary and won't resolve either cause.

Issue #50384: "[BUG] Illegal instruction crash on CPUs without AVX after 2.1.112 (native binary regression)", opened 2026-04-18, **closed as not planned** (stale). Regression introduced in 2.1.113 (switch to native binary). Reporter CPU: AMD A4-3310MX (no AVX) in Docker.

Proxmox `pve-docs/chapter-qm.html` CPU Type (fetched 2026-09-17):

| Proxmox CPU type | Host requirement | Flags added vs previous level | AVX exposed to guest? | Claude Code native binary |
|---|---|---|---|---|
| `kvm64` (backend default, e.g. `qm create` via CLI without `--cpu`) | any x86_64 | baseline only | **No** | crashes `Illegal instruction` |
| `x86-64-v2` | Intel ≥ Nehalem / AMD ≥ Opteron_G3 | `+cx16 +lahf-lm +popcnt +pni +sse4.1 +sse4.2 +ssse3` | **No** | crashes |
| `x86-64-v2-AES` (**web-UI default for new VMs**) | Intel ≥ Westmere / AMD ≥ Opteron_G4 | `+aes` | **No** | crashes |
| `x86-64-v3` | Intel ≥ Haswell / AMD ≥ EPYC | `+avx +avx2 +bmi1 +bmi2 +f16c +fma +movbe +xsave` | **Yes** | works |
| `x86-64-v4` | Intel ≥ Skylake / AMD ≥ EPYC v4 Genoa (docs wording) | `+avx512f +avx512bw +avx512cd +avx512dq +avx512vl` | Yes | works |
| `host` | same as host | all host flags ("exactly the same CPU flags as your host system") | if host has it | works; breaks live migration across dissimilar hosts ("If the CPU flags passed to the guest are missing, the QEMU process will stop") |

Fix for an existing VM: `qm set <vmid> --cpu x86-64-v3` (or `host`) then full stop/start (a reboot from inside the guest is not enough to change the CPU model — Proxmox applies hardware changes on next cold start). Installer preflight: `grep -m1 -ow avx /proc/cpuinfo || warn "Claude Code native binary requires AVX (docs: troubleshoot-install#illegal-instruction); set Proxmox CPU type x86-64-v3 or host"`. LXC containers see the host CPU directly, so the issue is VM-only.

Codex: standalone binaries are `x86_64-unknown-linux-musl` / `aarch64-unknown-linux-musl` static builds; no documented CPU-feature requirement (didn't find any; untested on a no-AVX CPU).

Memory: Claude installer prints "Claude Code needs roughly 512MB of free memory to install" on exit 137; docs say 4 GB+ RAM. "Install hangs in Docker: installing as root into `/` can cause hangs. Set a working directory before running the installer" (`WORKDIR /tmp` then `curl -fsSL https://claude.ai/install.sh | bash`).

---

## 3. Running as root (Proxmox host, LXC, Docker)

### 3.1 Claude Code `install.sh` (fetched from https://claude.ai/install.sh, 260 lines)
```bash
# Refuse to run under sudo from a regular user's shell. ... Plain root with no sudo
# (containers, CI, root-only systems) is unaffected by this check.
if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ] && [ -z "${CLAUDE_INSTALL_ALLOW_SUDO:-}" ]; then
    echo "Error: do not run this installer with sudo." >&2
    ...
    echo "    curl -fsSL https://claude.ai/install.sh | sudo CLAUDE_INSTALL_ALLOW_SUDO=1 bash" >&2
    exit 1
fi
```
- Accepts one positional arg: `stable|latest|<VERSION>` → `curl -fsSL https://claude.ai/install.sh | bash -s -- stable`.
- Downloads `https://downloads.claude.ai/claude-code-releases/{latest,<ver>/manifest.json,<ver>/<platform>/claude[.zst]}`, verifies SHA-256, detects musl via `/lib/libc.musl-*.so.1` or `ldd /bin/ls`, then runs `"$binary_path" install [target]` (the binary sets up `~/.local/bin/claude` and shell integration). Needs `bash`, `curl`; uses `jq`/`zstd` if present.
- **Verified**: `curl -fsSL https://claude.ai/install.sh | bash` as plain root in `debian:13` (Docker) installs 2.1.274 to `/root/.local/bin/claude` with no prompt. Fresh `~/.claude.json` contained `"installMethod": "native", "autoUpdates": false` (observed in the container; cause not documented).
- Docs also offer a **signed apt/dnf/apk repo** (stable channel ~1 week behind): key `https://downloads.claude.ai/keys/claude-code.asc` (fingerprint `31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE`), `deb [signed-by=/etc/apt/keyrings/claude-code.asc] https://downloads.claude.ai/claude-code/apt/stable stable main`, `sudo apt install claude-code`, upgrade with `sudo apt update && sudo apt upgrade claude-code`. "Package manager installations do not auto-update through Claude Code." This is the natural choice for a Proxmox host (system-wide, root-managed, apt-updated) and for LXC templates.
- `--dangerously-skip-permissions` as root → `--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons` (exit 1, verified). Docs (`permission-modes.md`): "The check is skipped automatically inside a recognized sandbox. To run autonomously in a container, use the dev container configuration, which runs Claude Code as a non-root user." **Observed (undocumented)**: `IS_SANDBOX=1 claude --dangerously-skip-permissions -p hi` proceeds as root (went on to the API 401). Safer documented alternative for unattended root runs: `--permission-mode auto` (needs supported model) or create a non-root user in the CT/VM.

### 3.2 Codex `install.sh` (fetched from https://chatgpt.com/codex/install.sh, 1209 lines, POSIX sh)
- Env: `CODEX_RELEASE` (default `latest`), `CODEX_NON_INTERACTIVE` ("Set to 1, true, or yes to skip prompts"), `CODEX_INSTALL_DIR` (default `~/.local/bin`), `CODEX_HOME` (default `~/.codex`; standalone cache at `$CODEX_HOME/packages/standalone/{releases,current}`), `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM` (0 → GitHub Releases instead of `https://releases.openai.com/codex`).
- **No root/sudo check at all.** Prompts (`prompt_yes_no`: "Uninstall the existing brew/npm-managed Codex now?", "Start Codex now?") return "no" when `CODEX_NON_INTERACTIVE` is set, and also when neither `/dev/tty` nor a tty stdin is available. Unattended form from the env-vars doc: `curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh`.
- Linux targets: `x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`; package asset `codex-package-<target>.tar.gz` + `codex-package_SHA256SUMS`; the package includes `codex-resources/bwrap` (chmod 0755) and `codex-resources/rg`. Adds `$BIN_DIR` to a shell profile if needed. Conflict detection for brew/npm installs.
- **Verified**: as root in `debian:13` → `Codex CLI 0.154.0 installed successfully.` into `/root/.local/bin/codex`, `/root/.codex/packages/standalone/releases/0.154.0-x86_64-unknown-linux-musl`. `codex doctor` `installation: ok`.

### 3.3 npm global installs as root
- Claude docs (`setup.md`): "Do NOT use `sudo npm install -g` as this can lead to permission issues and security risks." npm route requires Node 22+ (EBADENGINE warning otherwise) and optional deps enabled; it installs the same native binary via `@anthropic-ai/claude-code-linux-x64` etc. Prefer the native installer or apt repo on hosts.
- Plain root `npm i -g <pkg>` in `debian:13` (npm 9.2.0 from apt) works, global root `/usr/local/lib/node_modules` (verified with a trivial package).
- `npx -y skills@latest add vercel-labs/skills --skill find-skills -g -a claude-code codex -y` as root in the container: **works**, output `✓ ~/.agents/skills/find-skills  universal: Codex  symlinked: Claude Code`; creates `/root/.agents/skills/find-skills`, `/root/.agents/.skill-lock.json`, symlink `/root/.claude/skills/find-skills -> ../../.agents/skills/find-skills`. skills 1.6.0 prints `EBADENGINE` on Node 20 but runs. Flags from README: `-g/--global`, `-a/--agent <agents...>`, `-s/--skill`, `-y/--yes`, `--all`, `--copy`; `npx skills update [-g|-p]` to update. Note `vercel-labs/agent-skills` does **not** contain `find-skills` (first attempt exit 1); `vercel-labs/skills` does.

---

## 4. Headless pre-seeding recipes (exact file contents)

### 4.1 Codex

Documented options (`auth.md`, "Login on headless devices"):
1. **Device code (beta, preferred)**: enable "device code login" in ChatGPT security settings (or workspace permissions), then `codex login --device-auth`, open the link, enter the one-time code. Interactive but browserless — fine over `ssh`/`pct enter`, not for unattended runs.
2. **Copy the auth cache**: on a browser machine `codex login`, then
   ```bash
   ssh user@remote 'mkdir -p ~/.codex && cat > ~/.codex/auth.json' < ~/.codex/auth.json
   # Docker variant from the doc:
   CONTAINER_HOME=$(docker exec MY_CONTAINER printenv HOME)
   docker exec MY_CONTAINER mkdir -p "$CONTAINER_HOME/.codex"
   docker cp ~/.codex/auth.json MY_CONTAINER:"$CONTAINER_HOME/.codex/auth.json"
   ```
   "Treat `~/.codex/auth.json` like a password". Requires file-backed storage: `cli_auth_credentials_store = "file"` in `config.toml` (values: `file` = `auth.json` under `CODEX_HOME`; `keyring`; `auto`; `ephemeral`). Local file is mode `0600`; keys observed: `OPENAI_API_KEY`, `auth_mode`, `last_refresh`, `tokens{access_token,account_id,id_token,refresh_token}`. `ci-cd-auth.md`: Codex refreshes when `last_refresh` is older than ~8 days and writes the file back; "only one machine or serialized job stream will use a given `auth.json` copy" — so **don't fan one auth.json out to N nodes that run concurrently** (use device-auth per node, or an API key).
3. **SSH port-forward the callback**: `ssh -L 1455:localhost:1455 user@remote` then `codex login` in that session.
4. **API key / access token**: `printenv OPENAI_API_KEY | codex login --with-api-key`; `printenv CODEX_ACCESS_TOKEN | codex login --with-access-token`; or per-invocation `CODEX_API_KEY=<key> codex exec --json "..."` ("Set it inline rather than job-wide when running repository-controlled code").

Seed files (per node, as the user that will run codex):
```toml
# ~/.codex/config.toml
model = "gpt-6-astra"
model_reasoning_effort = "xhigh"
cli_auth_credentials_store = "file"

# default for interactive use on trusted homelab boxes; `codex exec` still defaults to read-only unless -s given
sandbox_mode = "workspace-write"
approval_policy = "on-request"

[projects."/root"]
trust_level = "trusted"
[projects."/srv"]
trust_level = "trusted"
```
```toml
# ~/.codex/yolo.config.toml  — profile for "the container/VM is the boundary" hosts; select with `codex --profile yolo`
# (Codex 0.154: profiles are separate files `$CODEX_HOME/<name>.config.toml` with top-level keys;
#  docs: "don't nest them under [profiles.profile-name]")
sandbox_mode = "danger-full-access"
approval_policy = "never"
```
```bash
install -d -m 0700 ~/.codex
install -m 0600 /path/to/auth.json ~/.codex/auth.json
```
Hooks: non-managed hooks "must be reviewed and trusted before they run"; trust is recorded against the hook hash via `/hooks` in the TUI; for automation use `--dangerously-bypass-hook-trust` per invocation ("Intended only for automation that already vets hook sources"). There is no documented file to pre-seed hook trust (it lives in Codex's SQLite state) — open question; managed hooks via `requirements.toml`/`hooks.managed_dir` are "trusted by policy".

Smoke test: `codex login status` (prints `Not logged in`, exit 1 when unseeded — verified), `codex exec --skip-git-repo-check -s read-only "say hi" </dev/null` (no prompts; in default Docker it printed the userns warning and then 401 without auth — verified). **Always redirect stdin from `/dev/null`**: when stdin is a non-tty pipe that stays open, `codex exec` prints `Reading additional input from stdin...` and blocks (re-verified on the host: hung past a 60 s timeout; with `</dev/null` it exited 1 after `401 Unauthorized` + 5 reconnect attempts in <25 s). Interactive first run: docs say "Codex may also start in `read-only` until you explicitly trust the working directory (for example, via an onboarding prompt or `/permissions`)" → seeding `[projects."<dir>"] trust_level = "trusted"` removes that (TUI test via `script` was inconclusive because the TUI waits on terminal-capability queries; not verified end-to-end).

### 4.2 Claude Code

- `claude setup-token` → "generate a one-year OAuth token ... prints the token to the terminal after you approve access in the browser. It does not save the token anywhere; copy it and set it as the `CLAUDE_CODE_OAUTH_TOKEN` environment variable" (requires Pro/Max/Team/Enterprise; "can only make model requests, so it can't establish Remote Control sessions or fetch claude.ai connectors. MCP servers you configure locally still work"). Precedence: bearer/`ANTHROPIC_AUTH_TOKEN` > `ANTHROPIC_API_KEY` > `apiKeyHelper` > `CLAUDE_CODE_OAUTH_TOKEN` > stored login. `--bare` mode does **not** read `CLAUDE_CODE_OAUTH_TOKEN` (use `ANTHROPIC_API_KEY`/`apiKeyHelper` there).
- Stored login on Linux lives in `~/.claude/.credentials.json` (0600; `{"claudeAiOauth":{accessToken,refreshToken,expiresAt,...}}`); `~/.claude.json` holds "OAuth account, personal MCP servers, and per-project trust" (`devcontainer.md`), so persisting `~/.claude` alone does not keep a login — set `CLAUDE_CONFIG_DIR` to a persisted dir to keep `.claude.json` with it. Copying `.credentials.json` between hosts is not a documented method; `setup-token` is.
- Trust: "A `-p` session shows no workspace trust dialog and no per-server approval prompt" (`headless.md`), and "Without `--bare`, a `-p` session runs the hooks in a project's `.claude/settings.json` and connects the servers in its `.mcp.json`, even in a folder you've never trusted".
- `~/.claude.json` keys `hasCompletedOnboarding` (top level) and `projects.<abs path>.hasTrustDialogAccepted` exist in the real file but are **undocumented** (settings-reference documents only 7 global-config keys; `claude-directory.md` says "The `projects` key tracks per-project state like trust-dialog acceptance").

**Verified in `debian:13` container, Claude Code 2.1.274, pseudo-TTY via `script`:**

| `~/.claude.json` seeded with | env | First interactive screen |
|---|---|---|
| (fresh) | `CLAUDE_CODE_OAUTH_TOKEN=<bogus>` | "Welcome to Claude Code ... Let's get started. Choose the text style..." (theme wizard) |
| `{"hasCompletedOnboarding": true}` | same | Trust dialog: "Quick safety check: Is this a project you created or one you trust? ... ❯ No, exit / Yes, I trust this folder" |
| `{"hasCompletedOnboarding": true, "projects": {"/tmp/proj": {"hasTrustDialogAccepted": true}}}` | same | Straight to the prompt (`Sonnet 5 · Claude API`), plus a `Remote managed settings failed to load (401)` notice because the token was bogus |
| same as above | no token | Straight to the prompt with `Not logged in · Run /login` in the status bar (no wizard) |

Seed files:
```bash
install -d -m 0700 ~/.claude
cat > ~/.claude.json <<'EOF'
{
  "hasCompletedOnboarding": true,
  "theme": "dark",
  "projects": {
    "/root": { "hasTrustDialogAccepted": true },
    "/srv":  { "hasTrustDialogAccepted": true }
  }
}
EOF
chmod 600 ~/.claude.json
cat > ~/.claude/settings.json <<'EOF'
{ "autoUpdatesChannel": "stable",
  "env": { "CLAUDE_CODE_OAUTH_TOKEN": "<paste from claude setup-token>" } }
EOF
chmod 600 ~/.claude/settings.json
```
(`env` block in settings is documented as a place `CLAUDE_CODE_OAUTH_TOKEN` can live: "until you remove it from your shell profile or the `env` block of a settings file". Merging into an existing `~/.claude.json` must be done with `jq` — Claude rewrites the file and keeps 5 backups in `~/.claude/backups/`.)

Smoke test: `claude -p 'say hi'` → without a credential exits 1 with `Not logged in · Please run /login` (verified, no hang); with a bad OAuth token exits 1 with `Failed to authenticate. API Error: 401 OAuth access token is invalid.`; with a bad `ANTHROPIC_API_KEY` it kept retrying past a 60 s timeout (exit 124) — so the installer's smoke test should use a timeout.

---

## 5. Fleet mechanics (Proxmox pct / qm, cloud-init, Ansible)

Sources: `pve-docs/pct.1.html`, `pve-docs/qm.1.html`, `docs.cloud-init.io/en/latest/reference/modules.html`, `docs.ansible.com .../shell_module.html` (all fetched 2026-09-17).

- `pct exec <vmid> [<extra-args>] [OPTIONS]` — "Launch a command inside the specified container", `--keep-env` default 1 but the man page warns "This option will disabled by default with PVE 9. If you rely on a preserved environment, please use this option to be future-proof" → pass `--keep-env 1` explicitly (or set env inside the `bash -lc` string, as in the examples below). `pct enter <vmid>` interactive shell. `pct push <vmid> <file> <destination> [--user] [--group] [--perms <octal>]`, `pct pull`. `pct set <vmid> --features [keyctl=<1|0>][,nesting=<1|0>][,fuse=<1|0>][,mknod=<1|0>][,mount=<fstype;...>]`, `pct create <vmid> <ostemplate> --unprivileged 1 --features nesting=1 ...`, `pct start <vmid>`.
- `qm guest exec <vmid> [<extra-args>] [OPTIONS]` — "Executes the given command through the guest agent" (needs `qemu-guest-agent` in the VM and `agent: 1`); `--pass-stdin` (default 0, forwards STDIN up to 1 MiB), `--synchronous` (default 1), `--timeout` (default 30 s, 0 disables). `qm guest exec-status <vmid> <pid>` for async runs. `qm guest cmd <vmid> ping|get-osinfo|...`.
- cloud-init `runcmd`: "Run arbitrary commands at a rc.local-like time-frame with output to the console"; a string item "will be interpreted by sh", a list item is executed "as if passed to execve(3)"; "The runcmd module only writes the script to be run later. The module that actually runs the script is scripts_user in the Final boot stage"; frequency **once-per-instance**. `write_files` supports `owner` (default `root:root`), `permissions` (octal string '0###', default 0o644), `defer` (boolean, default false).
- Ansible `ansible.builtin.shell`: `creates:` "A filename, when it already exists, this step will not be run."; `removes:`, `chdir:`, `executable:`.

Examples (assumes the installer is published at `https://example.invalid/agents.sh` and supports `-y --profile <name>`; adjust):
```bash
# LXC: enable nesting (needed for Codex's bwrap sandbox) and run non-interactively as root
pct set 101 --features nesting=1,keyctl=1 && pct reboot 101
pct push 101 ~/.codex/auth.json /root/.codex/auth.json --perms 0600   # after: pct exec 101 -- mkdir -p /root/.codex
pct exec 101 --keep-env 1 -- bash -lc 'export CODEX_NON_INTERACTIVE=1 CLAUDE_CODE_OAUTH_TOKEN=...; curl -fsSL https://example.invalid/agents.sh | bash -s -- -y --profile lxc'

# VM via guest agent (long install → disable timeout, or run async and poll exec-status)
qm guest exec 201 --timeout 0 -- bash -c 'curl -fsSL https://example.invalid/agents.sh | CODEX_NON_INTERACTIVE=1 bash -s -- -y --profile vm'
qm guest exec 201 --pass-stdin 1 -- bash -c 'install -d -m700 /root/.codex && cat > /root/.codex/auth.json && chmod 600 /root/.codex/auth.json' < ~/.codex/auth.json
PID=$(qm guest exec 201 --synchronous 0 -- bash -c '...' | jq .pid); qm guest exec-status 201 $PID

# cloud-init (Proxmox: qm set 201 --cicustom "user=local:snippets/agents.yaml")
#cloud-config
write_files:
- path: /root/.codex/config.toml
  permissions: '0600'
  content: |
    cli_auth_credentials_store = "file"
    [projects."/root"]
    trust_level = "trusted"
runcmd:
- [sh, -c, "curl -fsSL https://example.invalid/agents.sh | CODEX_NON_INTERACTIVE=1 bash -s -- -y --profile vm"]

# Ansible
- name: Install AI agents (idempotent)
  ansible.builtin.shell: curl -fsSL https://example.invalid/agents.sh | CODEX_NON_INTERACTIVE=1 bash -s -- -y --profile {{ agent_profile }}
  args: { creates: "{{ ansible_env.HOME }}/.local/bin/codex" }
- name: Seed Codex auth
  ansible.builtin.copy: { src: files/auth.json, dest: "{{ ansible_env.HOME }}/.codex/auth.json", mode: "0600" }
```
Notes: `pct exec` has no TTY → Codex installer auto-answers "no" (still set `CODEX_NON_INTERACTIVE=1` for clarity); Claude installer needs `bash`, `curl` (Debian 13 CT templates lack `curl`: `apt-get install -y curl ca-certificates` first). `qm guest exec` output is JSON (`out-data`, `exitcode`). For "update the fleet" runs the same command with `-y --update` (Claude: `claude update` or `apt upgrade claude-code`; Codex: `codex update` / re-run installer; skills: `npx skills update -g -y`).

---

## 6. Compatibility table (both agents)

| Target | Claude Code 2.1.27x | Codex CLI 0.154 | Notes / installer profile |
|---|---|---|---|
| **Proxmox VE host** (Debian 13, root, no sudo) | Native installer as plain root OK (no `SUDO_USER`) or apt repo (preferred: system-wide, apt-updated). Needs `curl`, `bash`. `--dangerously-skip-permissions` refused as root → use `--permission-mode auto` or a service user. Sandboxed Bash tool (opt-in) needs `bubblewrap socat`. | Standalone installer as root OK (`CODEX_NON_INTERACTIVE=1`). bwrap as real root: userns creation not restricted; distro `bubblewrap` 0.12.0 available. Expected to sandbox normally (untested on PVE). | profile `proxmox`: apt-install Claude, standalone Codex, seed auth, `trust_level` for `/root`. Don't install Docker-based MCPs on the hypervisor. |
| **Unprivileged LXC, `nesting=0`** (PVE default features) | Runs. Sandboxed Bash tool would fail → warns and runs unsandboxed (default `failIfUnavailable=false`). | Installs; startup warning `needs access to create user namespaces`; every shell call fails in-sandbox → approval prompts. Use `sandbox_mode="danger-full-access"` + `approval_policy="never"` if the CT is the boundary. | Recommend `pct set <id> --features nesting=1` instead. |
| **Unprivileged LXC, `nesting=1`** (+`keyctl=1` if Docker inside) | Runs; Bash sandbox expected to work (AppArmor `allow userns`, clean proc at `/dev/.lxc/proc`). If `Can't mount proc` → `sandbox.enableWeakerNestedSandbox: true`. | Expected to sandbox normally (pve-container emits `lxc.apparmor.allow_nesting=1` + `allow userns`). **Unverified here** — installer probe decides. | profile `lxc` |
| **Privileged LXC** | as host root | same as unprivileged+nesting (still set `nesting=1` for the AppArmor rules) | avoid; PVE docs call privileged CTs unsafe |
| **KVM VM, CPU `kvm64` / `x86-64-v2(-AES)`** | **`Illegal instruction`** (no AVX) — no workaround; set CPU `x86-64-v3` or `host`. | OK (musl static; no AVX requirement documented). | preflight `grep -ow avx /proc/cpuinfo` |
| **KVM VM, CPU `x86-64-v3` / `host`** | OK; behaves like bare metal (Ubuntu 24.04+ guests: load bwrap AppArmor profile for the Bash sandbox). | OK; on Ubuntu 24.04 guests apply the `bwrap-userns-restrict` recipe. | profile `vm` |
| **Docker, default seccomp/AppArmor** | Runs; Bash sandbox can't start (warns). Root refusal of `--dangerously-skip-permissions` (undocumented `IS_SANDBOX=1` bypass). | Installs; sandbox **fails** (`No permissions to create a new namespace`). Use `danger-full-access`/`--dangerously-bypass-approvals-and-sandbox` (docs: "environments that are externally sandboxed"). | profile `docker-nosandbox` |
| **Docker, `--security-opt seccomp=unconfined --security-opt apparmor=unconfined --cap-add SYS_ADMIN --cap-add NET_ADMIN`** | Bash sandbox: `/proc` mount fails → set `enableWeakerNestedSandbox: true` (documented). | Works **only with the bundled bwrap** (remove `/usr/bin/bwrap` 0.12.x; #44329). | profile `docker-sandbox` |
| **Docker `--privileged`** | works | works (system or bundled bwrap) | |
| **WSL2 / WSL1** | WSL2 OK; WSL1 unsupported for sandbox. | WSL2 OK; WSL1 rejected for sandboxed commands. | |

---

## 7. Homelab MCP servers / skills not previously evaluated (numbers observed 2026-09-17)

| Item | What | Maintainer | Popularity | Last activity | Install (Claude Code / Codex) | Verdict |
|---|---|---|---|---|---|---|
| **Microsoft Learn MCP** `https://learn.microsoft.com/api/mcp` | Official remote Streamable-HTTP MCP for Microsoft docs; no key. Repo also ships `@microsoft/learn-cli` + skills. | Microsoft (MicrosoftDocs/mcp) | 1,892 stars | 2026-09-10 | Claude: `/plugin install microsoft-docs@claude-plugins-official` (entry exists in `anthropics/claude-plugins-official` marketplace.json, source `https://github.com/MicrosoftDocs/mcp.git`); Codex: `codex mcp add "microsoft-learn" --url "https://learn.microsoft.com/api/mcp"`; CLI skill: `npx @microsoft/learn-cli` then `mslearn setup --cli --claude --codex` | recommended (only if you touch Windows/Azure/.NET; zero cost when idle since remote) |
| **Portainer MCP** | Official Portainer MCP server (Go/Python `mcp-portainer` on PyPI 2.45.1 2026-09-02); read-only mode available; server minor must match Portainer minor (2.41–2.45). | Portainer (portainer/portainer-mcp) | 231 stars | 2026-09-02 | `claude mcp add portainer -e PORTAINER_URL=https://portainer.example.com -e PORTAINER_API_KEY=ptr_xxx -- uvx --from "mcp-portainer~=2.45.0" mcp-portainer` (needs `uv`); team mode: Docker image `portainer/portainer-mcp` behind TLS + `claude mcp add portainer --transport http https://mcp.example.com:17717/mcp --header "Authorization: Bearer <gate-token>"`; Codex: `codex mcp add portainer --env PORTAINER_URL=https://portainer.example.com --env PORTAINER_API_KEY=ptr_xxx -- uvx --from "mcp-portainer~=2.45.0" mcp-portainer` (`--env <KEY=VALUE>` is the stdio env flag in `codex mcp add --help` 0.154.0; there is no `-e` short form) | recommended for Portainer users; pin `~=` to your Portainer minor |
| **TrueNAS MCP** | Official iXsystems Go binary; stdio; talks to TrueNAS WebSocket API over `wss://` only (API keys are revoked if used over `ws://`). | truenas/truenas-mcp | 81 stars | 2026-07-22 | Download release binary → `sudo cp truenas-mcp-linux-amd64 /usr/local/bin/truenas-mcp && sudo chmod +x /usr/local/bin/truenas-mcp`; `claude mcp add truenas -- truenas-mcp --truenas-url 192.168.0.31 --api-key your-api-key-here` | recommended if you run TrueNAS SCALE/CE; no npm/pip (installer must fetch GitHub release asset) |
| **Tailscale MCP (HexSleeves)** | Community; CLI + REST API; read-only by default, `TAILSCALE_ALLOWED_TOOL_RISK=write` to enable writes; OAuth client or API key. | HexSleeves | 132 stars; npm `@hexsleeves/tailscale-mcp-server` 1.3.4, 394 dl/wk (re-checked 2026-09-17; 415 earlier the same day — rolling window) | 2026-07-27 | `claude mcp add tailscale -e TAILSCALE_API_KEY=tskey-api-... -e TAILSCALE_TAILNET=- -- npx -y @hexsleeves/tailscale-mcp-server` | optional (no official Tailscale MCP exists: `tailscale/tailscale-mcp*` → 404) |
| **Tailscale MCP (tailscale-mcp org, Rust)** | Community; drives local `tailscale` CLI + control-plane API; `tailscale-mcp setup claude-code` prints config; `diagnose` subcommand. | tailscale-mcp/tailscale-mcp | 9 stars; npm `@tailscale-mcp/tailscale-mcp` 1.3.1, 1,354 dl/wk | 2026-09-07 | `npx -y @tailscale-mcp/tailscale-mcp` (downloads SHA256-verified release binary) or `docker run -i --rm -e TAILSCALE_API_KEY ghcr.io/tailscale-mcp/tailscale-mcp`; config `{"command":"npx","args":["-y","@tailscale-mcp/tailscale-mcp"],"env":{"TAILSCALE_MCP_ALLOW_WRITE":"true"}}` | optional; newer but tiny user base |
| **OPNsense MCP (vespo92)** | Community "IaC proxy" for OPNsense; API key/secret + optional SSH. | vespo92/OPNSenseMCP | 83 stars; npm `opnsense-mcp-server` 0.11.0, 118 dl/wk | 2026-07-21 | `npm install -g opnsense-mcp-server`; env `OPNSENSE_HOST`, `OPNSENSE_API_KEY`, `OPNSENSE_API_SECRET`, `OPNSENSE_VERIFY_SSL` (README shows a `bun run src/index.ts` config too) | optional; has write tools — scope the API key |
| **pfSense MCP (night4me)** | Community; 97 typed read-only tools via pfREST; writes opt-in via setup wizard. | night4me/pfsense-mcp-server | 8 stars; PyPI 1.1.0 2026-08-30 | 2026-09-13 | `pipx install pfsense-mcp-server && pfsense-mcp-security setup` (wizard prints the client config) | optional / niche |
| **Ansible MCP (official, dev-tools)** | `@ansible/ansible-mcp-server` from ansible/vscode-ansible monorepo: "Ansible Development Tools MCP server with linting, workspace access, and expert prompts" — playbook authoring/lint, **not** a remote-execution runner. | Ansible (Red Hat) | vscode-ansible 486 stars; npm 26.6.0, 200 dl/wk | 2026-09-16 (monorepo) | `claude mcp add ansible -- npx -y @ansible/ansible-mcp-server --stdio` (CLI usage from `src/cli.ts`: `ansible-mcp-server --stdio`; `--ws` disabled in this build); needs `ansible-lint` in PATH | optional; for writing playbooks, not for fleet ops |
| **Proxmox MCP** (context) | `canvrno/ProxmoxMCP` 292 stars but last commit 2025-02-19 (stale); `GethosTheWalrus/proxmox-mcp` 193 stars, last 2026-09-13, PyPI `proxmox-mcp-server` 1.4.2 (2026-09-13); npm `@bldg-7/proxmox-mcp` 1.3.0 (2026-09-15, 69 dl/wk). | community | see left | see left | (covered by another gap; prefer the actively maintained one) | optional |

---

## 8. Open questions

1. Codex sandbox inside an **unprivileged Proxmox LXC with `nesting=1`** is inferred from pve-container source (`allow userns`, `allow_nesting`); not executed on a PVE node. Verify with `codex sandbox -- /bin/true` on PVE 9.
2. Whether PVE 9's kernel sets `kernel.apparmor_restrict_unprivileged_userns=1` by default on the host (Ubuntu-derived kernel; irrelevant for root on the host, relevant for non-root users on the host).
3. openai/codex#44329 (proc-mount fallback matcher) — no maintainer response yet; re-test when Codex > 0.154.
4. Codex hook-trust persistence: no documented file to pre-seed; only `--dangerously-bypass-hook-trust` or managed hooks.
5. Claude `IS_SANDBOX=1` root bypass is observed, not documented — may change.
6. Fresh root install wrote `"autoUpdates": false` to `~/.claude.json` in Docker — cause not documented (root? container?); the fleet updater should not rely on background auto-update anyway.
7. Codex TUI trust prompt vs `[projects] trust_level` seeding was not verified end-to-end (TUI didn't render under `script`).
8. ~~`codex mcp add ... -e KEY=VAL` syntax~~ — RESOLVED by verification: `codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)` with `--env <KEY=VALUE>` (stdio only, repeatable) and `--bearer-token-env-var <ENV_VAR>` (HTTP only).

---

## 9. Sources (all fetched 2026-09-17)

- https://learn.chatgpt.com/docs/sandboxing.md
- https://learn.chatgpt.com/docs/config-file/config-reference.md
- https://learn.chatgpt.com/docs/config-file/environment-variables.md
- https://learn.chatgpt.com/docs/auth.md ; https://learn.chatgpt.com/docs/auth/ci-cd-auth.md
- https://learn.chatgpt.com/docs/non-interactive-mode.md ; https://learn.chatgpt.com/docs/hooks.md ; https://learn.chatgpt.com/docs/agent-approvals-security.md ; https://learn.chatgpt.com/docs/config-file/config-basic.md
- https://chatgpt.com/codex/install.sh (raw)
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/linux-sandbox/README.md ; .../linux-sandbox/src/{launcher.rs,linux_run_main.rs,bundled_bwrap.rs} ; .../sandboxing/src/bwrap.rs ; .../core/src/spawn.rs
- https://github.com/openai/codex/issues/19285 ; https://github.com/openai/codex/issues/44329
- https://code.claude.com/docs/en/setup.md ; troubleshoot-install.md ; authentication.md ; headless.md ; settings-reference.md ; claude-directory.md ; devcontainer.md ; env-vars.md ; permission-modes.md ; sandboxing.md ; sandbox-environments.md ; cli-reference.md
- https://claude.ai/install.sh (raw)
- https://github.com/anthropics/claude-code/issues/50384
- https://pve.proxmox.com/pve-docs/chapter-qm.html ; chapter-pct.html ; pct.1.html ; qm.1.html
- https://git.proxmox.com/?p=pve-container.git;a=blob_plain;f=src/PVE/LXC.pm;hb=HEAD
- https://linuxcontainers.org/lxc/manpages/man5/lxc.container.conf.5.html
- https://forum.proxmox.com/threads/...-flatpaks-in-unprivileged-lxc-containers.181245/ ; https://discuss.linuxcontainers.org/t/bwrap-and-flatpaks-inside-proxmox-8-lxc/18871
- https://docs.cloud-init.io/en/latest/reference/modules.html ; https://docs.ansible.com/ansible/latest/collections/ansible/builtin/shell_module.html (redirects to https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/shell_module.html)
- https://raw.githubusercontent.com/vercel-labs/skills/main/README.md ; https://registry.npmjs.org/skills/latest (1.6.0)
- https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json
- https://raw.githubusercontent.com/{portainer/portainer-mcp,truenas/truenas-mcp,MicrosoftDocs/mcp,HexSleeves/tailscale-mcp,tailscale-mcp/tailscale-mcp,vespo92/OPNSenseMCP,night4me/pfsense-mcp-server}/main/README.md ; GitHub repo pages + `commits/main.atom` ; npm search API ; PyPI JSON
- Local read-only checks: `codex --help`, `codex exec --help`, `codex login --help`, `codex sandbox --help`, `codex doctor --json`, `~/.codex/packages/standalone/current/codex-resources/bwrap --version` ("bubblewrap built for Codex", static-pie), file modes of `~/.codex/auth.json`, `~/.claude.json`, `~/.claude/.credentials.json` (all 0600).
- Throwaway Docker tests: images `gap6-deb13` (debian:13 + bubblewrap 0.12.0) and `gap6-agents` (+ Codex 0.154.0 + Claude Code 2.1.274 installed as root); outputs quoted inline above.

---

## Verification (skeptical fact-check, 2026-09-17)

Method: every doc page, raw installer and Rust source cited above was re-fetched (curl, HTTP 200 checked); every cheap local probe was re-run in throwaway `CODEX_HOME` / `CLAUDE_CONFIG_DIR` directories on this Ubuntu 26.04 host (Codex 0.154.0, Claude Code 2.1.274); GitHub star counts were re-scraped from repo pages, npm/PyPI versions and weekly downloads re-queried from the registries. **Not re-run:** the Docker matrix (§1.4) and the root-only tests (§3) — the Docker socket is not reachable from this session (`permission denied ... /var/run/docker.sock`) and the session is not root. Those rows stand as originally observed and are marked "not re-verified" below.

### Confirmed (primary source re-fetched, matches the body)
- Codex `sandboxing.md`: bubblewrap prerequisite, "first `bwrap` executable it finds on `PATH`", bundled helper "requires support for unprivileged user namespace creation", startup warning, Ubuntu 24.04 `bwrap-userns-restrict` recipe (verbatim), Ubuntu 25.04 note, `sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, three sandbox modes, "Full access means using `sandbox_mode = "danger-full-access"` together with `approval_policy = "never"`", `untrusted` retired.
- `codex-rs/sandboxing/src/bwrap.rs`: `USER_NAMESPACE_WARNING`, the 4 `USER_NAMESPACE_FAILURES` strings, probe argv `--unshare-user --unshare-net --ro-bind / / /bin/true`, `SYSTEM_BWRAP_PROBE_TIMEOUT = 500 ms`, gated by `should_require_platform_sandbox`.
- `linux-sandbox/README.md`, `launcher.rs` (System/Bundled/Unavailable, panic text, `--as-pid-1` + `--perms` capability probe via `bwrap --help`, `--argv0` since bubblewrap 0.9.0), `core/src/spawn.rs` (`CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED` set on the child; re-verified locally: `codex sandbox -- sh -c 'echo $CODEX_SANDBOX_NETWORK_DISABLED'` → `1`, `/etc` read-only).
- openai/codex#44329: open, opened 2026-09-09, Podman on Fedora 44, Codex 0.153.4, bubblewrap 0.12.0, error `bwrap: Can't mount proc on /proc: Operation not permitted`, no maintainer reply, 0 comments (WebFetch 2026-09-17).
- anthropics/claude-code#50384: "[BUG] Illegal instruction crash on CPUs without AVX after 2.1.112 (native binary regression)", opened 2026-04-18, closed as not planned (stale), regression at 2.1.113, CPU AMD A4-3310MX in Docker.
- Claude `setup.md` (requirements list, "4 GB+ RAM, x64 or ARM64 processor", no AVX mention, apt repo commands + fingerprint `31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE`, "Package manager installations do not auto-update through Claude Code", "Do NOT use `sudo npm install -g`"); `troubleshoot-install.md` (AVX paragraph, `grep -m1 -ow avx /proc/cpuinfo`, "no native-binary workaround", 512MB, "Install hangs in Docker" → `WORKDIR /tmp`); `authentication.md` (setup-token text, precedence list 1–7 as quoted, `--bare` does not read `CLAUDE_CODE_OAUTH_TOKEN`, Linux creds in `~/.claude/.credentials.json` 0600, `CLAUDE_CONFIG_DIR` relocates it); `headless.md` (no trust dialog / no per-server approval under `-p`; hooks and `.mcp.json` still run without `--bare`); `permission-modes.md` + `sandboxing.md` (root refusal text, "skipped automatically inside a recognized sandbox", dev container as non-root); `sandboxing.md` (bubblewrap + socat, warn-and-run-unsandboxed default, `failIfUnavailable`, `enableWeakerNestedSandbox` with `Can't mount proc on /newroot/proc` example, Ubuntu 24.04 AppArmor profile, WSL1 unsupported); `settings-reference.md` (exactly 7 `Global config` keys: autoConnectIde, autoInstallIdeExtension, copyOnSelect, diffTool, externalEditorContext, permissionExplainerEnabled, teammateDefaultModel — `hasCompletedOnboarding`/`hasTrustDialogAccepted` absent); `claude-directory.md` ("The `projects` key tracks per-project state like trust-dialog acceptance"); `devcontainer.md` (`~/.claude.json` holds OAuth account, personal MCP servers, per-project trust; mount + `CLAUDE_CONFIG_DIR`); `env-vars.md` has no `IS_SANDBOX` entry (bypass remains undocumented).
- `https://claude.ai/install.sh` (260 lines): sudo check at line 20 exactly as quoted, `[stable|latest|VERSION]` usage, manifest/zst/musl logic, `"$binary_path" install ${TARGET:+"$TARGET"}`.
- `https://chatgpt.com/codex/install.sh` (1209 lines): `CODEX_RELEASE`, `CODEX_NON_INTERACTIVE` (1/true/yes → `prompt_yes_no` returns "no"; also "no" when neither `/dev/tty` nor tty stdin), `CODEX_INSTALL_DIR`, `CODEX_HOME`, `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM`, `--release VERSION` flag, targets `x86_64/aarch64-unknown-linux-musl`, asset `codex-package-<target>.tar.gz` + `codex-package_SHA256SUMS`, bundled `codex-resources/bwrap` chmod 0755, **no `id -u`/`EUID`/`SUDO_USER` check anywhere**.
- Codex `environment-variables.md`, `auth.md` (device-auth beta + enable in security settings, `ssh ... cat > ~/.codex/auth.json`, `scp`, docker `printenv HOME`/`docker cp`, `-L 1455:localhost:1455`, `--with-api-key`/`--with-access-token`), `ci-cd-auth.md` ("older than about 8 days", "only one machine or serialized job stream will use a given `auth.json` copy"), `config-reference.md` (`projects.<path>.trust_level` text verbatim, `cli_auth_credentials_store` values, `allow_managed_hooks_only`, `hooks.managed_dir`, `notice.hide_full_access_warning`), `hooks.md` (trust by hash, `/hooks`, managed hooks "trusted by policy", `--dangerously-bypass-hook-trust`), `non-interactive-mode.md` (read-only default, both `--sandbox` examples, `--full-auto` deprecated, `--ignore-user-config`, `--ignore-rules`, `--skip-git-repo-check`), `agent-approvals-security.md` line 268 (the "start in `read-only` until you explicitly trust the working directory" sentence — this is the source, not `sandboxing.md`).
- Local CLI help (0.154.0): `-s/--sandbox`, `-a/--ask-for-approval`, `--dangerously-bypass-approvals-and-sandbox` text, `--dangerously-bypass-hook-trust`, `--skip-git-repo-check`, `-C/--cd`, `-c key=value`, `codex sandbox`, `codex doctor [--json] [--summary]`, `codex login [--with-api-key|--with-access-token|--device-auth] [status]`, `codex update`.
- `codex doctor --json` schema `{schemaVersion, generatedAt, overallStatus, codexVersion, checks{...}}`; check ids (20): app_server.status, auth.credentials, config.load, git.environment, installation, mcp.config, network.env, network.provider_reachability, network.websocket_reachability, runtime.provenance, runtime.search, sandbox.helpers, security.endpoint, state.paths, state.rollout_db_parity, system.disk, system.environment, terminal.env, terminal.title, updates.status. `sandbox.helpers` details keys match the body. (Run with a throwaway `CODEX_HOME`, `installation.install context` reads `other (package ...)` rather than `standalone (...)` — the install-method string depends on the real `CODEX_HOME`, so the installer must run doctor against the real one.)
- Local bwrap: host `/usr/bin/bwrap` 0.11.1, `kernel.apparmor_restrict_unprivileged_userns = 1`, `/etc/apparmor.d/bwrap-userns-restrict` present, userns probe **and** `--proc /proc` preflight both pass; bundled `~/.codex/packages/standalone/current/codex-resources/bwrap --version` → `bubblewrap built for Codex`; AVX present.
- Claude seeding (§4.2 table) **reproduced on the host** with `CLAUDE_CONFIG_DIR=$(mktemp -d)` + `script` pseudo-TTY: fresh → theme wizard; `{"hasCompletedOnboarding": true}` → trust dialog ("Quick safety check ... ❯ No, exit / Yes, I trust this folder"); + `projects.<dir>.hasTrustDialogAccepted: true` → straight to the prompt (`Sonnet 5 · Claude API`, plus the 401 "Remote managed settings failed to load" notice with a bogus token). `claude -p 'say hi'` with no credential → `Not logged in · Please run /login`, exit 1; bogus `CLAUDE_CODE_OAUTH_TOKEN` → `Failed to authenticate. API Error: 401 OAuth access token is invalid.`, exit 1; bogus `ANTHROPIC_API_KEY` → still running at 45 s (exit 124 from `timeout`). `claude --help` lists `setup-token`, `--permission-mode <mode>`, `--dangerously-skip-permissions`, `--bare`, `update|upgrade` (and a newer `--allow-dangerously-skip-permissions`).
- pve-container `LXC.pm` (3513 lines @HEAD): `make_apparmor_config` at line 636 emits exactly the quoted `allow_nesting` / `allow userns,` vs `deny mount -> /proc/`, `/sys/` branches (lines 663–671), `lxc.mount.auto = sys:mixed` unless `force_rw_sys` (758–761), keyctl `errno 38` (540). `chapter-pct.html`: `nesting`/`keyctl` descriptions verbatim, `unprivileged` "For creation, the default is 1", `lxc.apparmor.profile = unconfined` "not recommended for production use". `pct.1.html`: `pct exec/enter/push/set/create/reboot` ("Applies pending changes"), `--perms` octal. `qm.1.html`: `qm guest exec` `--pass-stdin` (1 MiB), `--synchronous` (default 1), `--timeout` (default 30, 0 disables), `qm guest exec-status <vmid> <pid>`, `qm agent` alias.
- `chapter-qm.html` CPU table: backend default `kvm64`, UI default `x86-64-v2-AES` (Westmere / Opteron_G4), v2/v2-AES/v3/v4 flag lists exactly as in §2, `host` = "exactly the same CPU flags as your host system", "If the CPU flags passed to the guest are missing, the QEMU process will stop".
- Proxmox forum thread 181245 (2026-02-28, mentions `sys:mixed proc:rw` and nesting) and LXC-forum thread 18871 (`max_user_namespaces: Read-only file system`) exist with the quoted content; `lxc.container.conf(5)` page 200.
- `vercel-labs/skills` README flags (`-g`, `-a <agents...>`, `-s <skills...>`, `-y`, `--all`, `--copy`, `npx skills update [-g|-p]`), npm `skills` 1.6.0 (engines `node >=22.20.0` → explains the EBADENGINE on Node 20); `anthropics/claude-plugins-official` marketplace.json entry `microsoft-docs` (source url `https://github.com/MicrosoftDocs/mcp.git`, category development).
- MCP table: all repo URLs 200; stars re-scraped 2026-09-17 and identical (MicrosoftDocs/mcp 1,892; portainer-mcp 231; truenas-mcp 81; HexSleeves 132; tailscale-mcp 9; OPNSenseMCP 83; pfsense-mcp-server 8; vscode-ansible 486; GethosTheWalrus/proxmox-mcp 193; canvrno/ProxmoxMCP 292; `tailscale/tailscale-mcp*` 404). npm: `@hexsleeves/tailscale-mcp-server` 1.3.4 (2026-07-25), `@tailscale-mcp/tailscale-mcp` 1.3.1 (2026-09-07, 1,354 dl/wk), `opnsense-mcp-server` 0.11.0 (2026-04-08, 118 dl/wk), `@ansible/ansible-mcp-server` 26.6.0 (2026-06-01, 200 dl/wk), `@bldg-7/proxmox-mcp` 1.3.0 (2026-09-15, 69 dl/wk), `@microsoft/learn-cli` 1.0.0 (2026-09-10). PyPI: `mcp-portainer` 2.45.1 (2026-09-02), `pfsense-mcp-server` 1.1.0 (2026-08-30), `proxmox-mcp-server` 1.4.2 (2026-09-13). README commands re-read: Portainer `claude mcp add portainer -e PORTAINER_URL=... -e PORTAINER_API_KEY=... -- uvx --from "mcp-portainer~=2.45.0" mcp-portainer`, minor-match rule (2.41–2.45 table), HTTP mode `PORTAINER_MCP_AUTH_TOKEN` required, port 17717; TrueNAS `sudo cp truenas-mcp-linux-amd64 /usr/local/bin/truenas-mcp && sudo chmod +x ...`, `claude mcp add truenas -- truenas-mcp --truenas-url 192.168.0.31 --api-key your-api-key-here`, "`ws://` ... TrueNAS will revoke API keys used over unencrypted connections"; Microsoft README table row `codex mcp add "microsoft-learn" --url "https://learn.microsoft.com/api/mcp"`, `mslearn setup --cli --claude --codex`, `?maxTokenBudget=2000`; HexSleeves `claude mcp add tailscale -e TAILSCALE_API_KEY=tskey-api-... -e TAILSCALE_TAILNET=- -- npx -y @hexsleeves/tailscale-mcp-server`, `TAILSCALE_ALLOWED_TOOL_RISK=write`, Node.js 20+; tailscale-mcp `npx -y @tailscale-mcp/tailscale-mcp` (SHA256SUMS check), `docker run -i --rm -e TAILSCALE_API_KEY ghcr.io/tailscale-mcp/tailscale-mcp`, `brew trust ... && brew install tailscale-mcp/tap/tailscale-mcp`, `cargo install tailscale-mcp`, `tailscale-mcp setup claude-code`, `diagnose`, `TAILSCALE_MCP_ALLOW_WRITE`; OPNsense `npm install -g opnsense-mcp-server` + the 4 env vars + `bun run`; pfSense `pipx install pfsense-mcp-server` / `pfsense-mcp-security setup`, "97 tools: 95 pfSense READ tools + 2 documentation guidance tools", read-only default; Ansible `src/cli.ts`: `--stdio`, `--ws` → "WebSocket mode is not available in this build".

### Corrected in the body
1. **Codex profiles**: `[profiles.yolo]` inside `config.toml` was wrong for 0.154. `codex --help`: `-p, --profile <CONFIG_PROFILE_V2>  Layer $CODEX_HOME/<name>.config.toml on top of the base user config`; `config-advanced.md#profiles`: "Create a separate TOML file for each profile. Use top-level config keys in the profile file; don't nest them under `[profiles.profile-name]`." Seed recipe now writes `~/.codex/yolo.config.toml`.
2. **`codex mcp add` env syntax** (open question 8 resolved): `Usage: codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)`, `--env <KEY=VALUE>` ("Only valid with stdio servers"), `--bearer-token-env-var <ENV_VAR>` (HTTP only), `--oauth-*` options. No `-e` short form. Portainer row fixed.
3. **`is_proc_mount_failure`** has a third clause (`Invalid argument` | `Operation not permitted` | `Permission denied`); the `/newroot/proc` substring requirement — the actual cause of #44329 — is unchanged.
4. **Startup probe scope**: the userns probe is only executed against a *system* bwrap; with no bwrap on PATH Codex prints `Codex could not find bubblewrap on PATH. Install bubblewrap with your OS package manager. ... Codex will use the bundled bubblewrap in the meantime.` and never probes the bundled binary (so a "needs access to create user namespaces" warning implies a system bwrap was found). There is also a separate `WSL1_BWRAP_WARNING`.
5. **Proxmox `x86-64-v4`** host requirement wording is "Intel CPU >= Skylake, AMD CPU >= EPYC v4 Genoa" (not "Skylake-SP").
6. **cloud-init `runcmd`** quotes were paraphrases; replaced with the current page's text ("rc.local-like time-frame", string → `sh`, list → `execve(3)`, actually run by `scripts_user` in the Final stage). `write_files` defaults added.
7. **`pct exec --keep-env`**: man page says the default "will disabled by default with PVE 9" → examples now pass `--keep-env 1` explicitly / set env inside the command string.
8. **`codex exec` smoke test needs `</dev/null`**: with an open non-tty stdin it prints `Reading additional input from stdin...` and blocks (hung past 60 s here); with stdin closed it fails fast (401 ×5 reconnects, exit 1).
9. HexSleeves weekly downloads 394 at re-check (415 earlier the same day); Ansible docs URL now redirects to `docs.ansible.com/projects/ansible/...`.
10. Fresh `~/.claude.json` written by `claude -p` on this host (2.1.274, non-root) contains only `firstStartTime/firstStartVersion/machineID/…MigrationComplete/migrationVersion/userID` — **no** `installMethod`/`autoUpdates` keys. So the `"installMethod": "native", "autoUpdates": false` observed in Docker came from the `claude install` step of `install.sh`, not from first launch (cause still undocumented; open question 6 stands).

### Not re-verified (kept, flagged)
- The Docker matrix in §1.4 (default / unconfined / `--cap-add` / `--privileged` rows, "remove `/usr/bin/bwrap` → bundled works") and the root-only observations (`--dangerously-skip-permissions` refusal as root, `IS_SANDBOX=1` bypass, root `npm -g` / `npx skills` runs, `"autoUpdates": false`): Docker socket not reachable and session not root. Mechanism-level claims behind them (matcher string, probe argv, `SUDO_USER` check, no root check in Codex installer) were all confirmed from source, so the rows are plausible but remain single-observation.
- All Proxmox LXC/host behaviour remains inference from `LXC.pm` + docs (no PVE node).

### Removed
- Nothing removed outright; the `[profiles.yolo]` TOML block was replaced (see Corrected 1).
