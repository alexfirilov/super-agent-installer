# 2026-09-20 hardening pass (external review, v0.3.0 -> next)

An external architectural review of v0.2.0/v0.3.0 concluded "the engineering is ahead of the safety model" and
listed fifteen findings. Each was verified against the code before anything changed; this records the verdicts,
the fixes, and what is deliberately left.

## Verdicts

| # | Finding | Verdict | Fix |
|---|---------|---------|-----|
| 1 | uninstall removes software the installer did not install | partly fixed in v0.3.0 (`byUs`); two holes confirmed: an id with no state record bypassed the guard, and `update` promoted an adopted tool to "ours" | unknown provenance is foreign; `update` never changes provenance |
| 2 | malformed JSON read as empty, then overwritten | confirmed | `readJsonFile` throws `JsonParseError` for anything but ENOENT; corrupt state aborts the run |
| 3 | `curl \| bash` cannot run interactively | the v0.3.0 reconnect was itself broken: it redirected the shell's stdin, so a piped bash read the rest of the script from the terminal and never ran the binary; and on hosts where `/dev/tty` exists but cannot be opened, dash aborted | redirection belongs to the exec'd command, guarded by a subshell probe; real bats tests through `script(1)` and `setsid` |
| 4 | Codex settings fight over one TOML block | install side already merged (v0.3.0); uninstall side confirmed | remove only the setting's own keys |
| 5 | saved channel ignored by `update` | confirmed; `Profile.channel` was never read either | CLI flag > saved state > profile > latest |
| 6 | `update` stops after self-update; blocked steps exit 0 | confirmed | re-exec the new binary with `--no-self-update`; exit 2 on blocked |
| 7 | secrets persisted as ambient env by default | confirmed as design; the components need the variable in the environment | documented in SECURITY.md; `--no-persist-secrets` stays the opt-out |
| 8 | inconsistent pinning | confirmed: stale unused constants, `@latest` launch lines, floating npm tools | every registry package pinned; a pin is the update target; manifest test |
| 9 | backups but no restoration | confirmed for MCP entries and the status line | `previous` recorded in state; uninstall restores it, leaves user-modified values |
| 10 | `check` is presence/version only | partly: settings/MCP/statusline/instructions already compare desired vs current | documented per kind |
| 11 | kitchen-sink defaults | valid | `devops` profile added |
| 12 | `.playwright-mcp` tracked | confirmed (email + OAuth authorize URL, no token) | untracked and ignored; no history rewrite (public branch; nothing secret in it) |
| 13 | no LICENSE / SECURITY.md | confirmed | added |
| 14 | root Proxmox blast radius | confirmed | non-blocking warning on Proxmox hosts and root |
| 15A | `tar` required, unused | confirmed | removed |
| 15B | `Profile.headless` dead | confirmed | removed (ignored if present in a custom manifest) |
| 15C | unused pins | confirmed | removed |
| 15D | prerelease compare | confirmed (`alpha.10` < `alpha.2`) | SemVer section 11 compare |
| 15E | `doctor --strict` | optional | not added; `doctor` already exits 2 on a dead proxy route |

## State file changes

Schema version stays `1`. Two optional fields were added to `installed[id]`: none new for provenance (`byUs`
already existed since v0.3.0) and `previous` (the foreign value the last configure replaced). Old state files
load unchanged. Their effect on uninstall:

- v0.2.x records (no `byUs`): refused, as before; `--force` still overrides for named ids.
- v0.3.0 records: unchanged semantics, except that `update` no longer flips `byUs` to true.
- No `previous`: uninstall deletes the entry as before.

`channel` in the state file is now read back (it was only written before).

## Exit codes

`update` and `uninstall` now return `2` when a step was blocked (same contract `install` already had). Scripts
that tested for `0` keep working; scripts that treated `1` as the only failure should treat non-zero as such.

## Deferred

- Secret persistence stays on by default; making it opt-in would break every MCP server that references `${VAR}`
  until the user exports the variable by hand. Native credential stores are the better long-term answer.
- Restoration is implemented for the two resources install actually replaces (MCP entries, status line). Settings
  keys are only ever added, never replaced, so nothing else needed it yet.
- Binaries are checksummed and carry GitHub build provenance attestations; they are not OS code-signed.
