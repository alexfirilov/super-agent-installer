# Catalog reset and freshness (v0.5.0)

## Why

The installer's engine is sound, but its catalog grew to 95 components, most of them unused, and hosts do not stay
current: `check` cannot see stale skills or plugins, re-running install changes nothing, and the run-time catalog fetch
has never been released. The owner wants a small personal catalog and the latest version of everything it installs.

## Decisions

Owner's decisions:

- Remove profiles entirely, including `--profile`.
- No homelab components and no Roblox component.
- `skill-creator` is on by default.
- Remove Playwright MCP, chrome-devtools and GitHub MCP. `playwright-cli` and `gh` cover those needs.
- Drop the components in the agreed drop list.
- Work order: fix CI and Windows tests, fix freshness and retirement, prune the catalog, release v0.5.0.
- mattpocock and commit-commands are on by default. Drop ccusage and claude-hud.

Builder's calls, made on the owner's questions and open to veto before release:

- Cut caveman completely: CLI, hooks, proxy route, status line, plugin and skills. Add one terseness line to
  `instructions.md` instead.
- Keep Codex memories on.
- Replace the Context7 plugin with a direct MCP entry on `https://mcp.context7.com/mcp`, which works without auth.
- Set `ENABLE_STOP_REVIEW=0` for `security-guidance`.
- Drop plugin-dev, happy and Serena.
- Retire components no tier listed: feature-dev, claude-md-management, exa, microsoft-docs, grafana, obsidian,
  elements-of-style, vercel agent-skills.
- npm, PyPI and Go packages keep the 3-day cooldown. `--cooldown 0` gets the newest. Skills and plugins have none.

## Catalog

On by default: Claude Code, Codex, git, node, jq, ripgrep, gh, PowerShell 7, bubblewrap, TypeScript and Pyright language
servers with their LSP plugins, `playwright-cli`, superpowers (both agents), `security-guidance`, `frontend-design` (both
agents), `skill-creator`, Context7 (both agents), mattpocock (`grill-me`, `grilling`, `handoff`, `writing-for-agents`,
`improve-codebase-architecture`, and the `codebase-design` and `domain-modeling` skills it calls), commit-commands, Codex memories, Windows git symlinks, global instructions.

Off by default: uv, Go and gopls with its LSP plugin, and the two headless-host settings.

Codex ships its own `skill-creator` in `~/.codex/skills/.system`, so the catalog installs that one on Claude only.

## Freshness

- `install` and `update` both refresh installed skills and plugins. Re-running install is no longer a no-op.
- The skills CLI version is resolved like any registry package, instead of a pin only a release can move.
- Skills update by name (`skills update <names> -g`), so skills the user added by hand are left alone.
- Skill updates pass the same skills.sh audit gate as first installs. A failed audit keeps the current version.
- `DISABLE_TELEMETRY=1` is set for skills CLI calls only. It must not be set globally, because Claude Code withholds its
  sign-in from plugin hooks in a session that has it, which would silently skip `security-guidance` reviews.
- `check` reports skills from `skills check -g`. Claude plugins declare no comparable upstream version, so they report
  `unknown` rather than a false `ok`; `update` still refreshes them through `claude plugin update`.

## Retirement

A component dropped from `components` used to be skipped silently, leaving it installed and unmanaged. The catalog gets a
`retired` list with the same shape, plus an optional `replacedBy`.

- `install` and `update` remove a retired component before installing anything, if the host's saved selection has it.
- Tools and agents are removed only when the state proves this installer installed them (`byUs`). Removing an OS package
  can take its reverse dependencies with it. Anything else the installer managed is agent configuration that is cheap to
  reinstall, so being in the saved selection is enough.
- `replacedBy` moves a saved selection to the successor, so a host keeps the capability.
- A failed removal stays in the saved selection and is retried on the next run.
- `--only` retires nothing, because it installs no successor. Skills a live component also owns are left in place.
- `check` lists retired components still awaiting removal as `outdated`.
- Hook and caveman status-line code stays for this release, because retirement needs it. Remove it in the next release,
  together with the `retired` entries, once hosts have converged.

## Non-goals

Reformatting the code, deriving types from zod, signing the catalog, and archiving the generated docs. These are real
problems from the review, but none is needed for this reset.
