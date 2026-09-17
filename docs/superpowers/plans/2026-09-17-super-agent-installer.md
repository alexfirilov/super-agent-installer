# super-agent-installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `super-agent-installer`: thin `install.sh`/`install.ps1` bootstraps plus a TypeScript core that installs Claude Code and Codex CLI via their official installers, provisions plugins/skills/MCP servers/tools/settings for both agents from a data-only manifest with profiles and an interactive default-all picker, and updates everything in place including itself.

**Architecture:** Data-only `manifest.json` (components, slots, profiles) is resolved against a detected host into a selection; kind-specific providers turn each selected component into idempotent actions (detect, plan, execute) that shell out to vendor CLIs (`claude`, `codex`, `npx skills`, `caveman`, package managers). A planner orders actions, an executor runs them (continue-on-failure, dry-run, logging), and a state file drives `update`/`check`. Bootstraps only download, verify and exec the compiled core.

**Tech Stack:** TypeScript (ESM, strict), Bun 1.4 for `bun build --compile` targets and as dev runtime, Node 22+ compatible at runtime (npx fallback), `@clack/prompts` picker, `zod` manifest validation, `smol-toml` TOML parsing, `vitest` tests, `bats-core` + `shellcheck` for `install.sh`, `Pester` + `PSScriptAnalyzer` for `install.ps1`, GitHub Actions matrix.

**Spec:** `docs/superpowers/specs/2026-09-17-super-agent-installer-design.md`

## Global Constraints

- Node runtime floor: `>=22.20.0` (skills CLI 1.6.0 requirement); build with Bun `>=1.4`.
- Windows bootstrap must run on Windows PowerShell 5.1: always `-UseBasicParsing`, set `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`, write files with `[IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($false))`, no `ConvertFrom-Json -AsHashtable`, no ternary, no `??`.
- Linux bootstrap must be POSIX-sh compatible in its first lines and may re-exec under bash; `set -eu`; refuse `sudo`-from-user (SUDO_USER set) unless `SAI_ALLOW_SUDO=1`; plain root allowed.
- The installer never writes a secret to disk. Secrets are prompted per run and either consumed by a command's stdin/args for that run or turned into printed `export`/`setx` instructions.
- Every mutating command goes through the Runner so `--dry-run` can skip it; read-only probes pass `readOnly: true`.
- Config files: backup before write, merge in memory, write temp in the same directory, rename, preserve mode 0600 and LF endings.
- Pinned third-party versions live in `src/pins.ts`: `SKILLS_CLI = "1.6.0"`, `CAVEMAN_CLI = "1.3.4"`, `PLAYWRIGHT_CLI = "0.1.20"`, `NODE_MAJOR = 24`.
- Idempotency rules from spec section 8 are mandatory: Claude MCP upsert = remove then add; Codex MCP compare-then-add with `--bearer-token-env-var` for HTTP; Codex plugin update = marketplace upgrade + re-add; Claude plugin update loop over `claude plugin list --json`.
- Exit codes: 0 success, 1 any action failed, 2 drift found (`check`), 3 no TTY without `--yes`, 4 unsupported platform.
- Commits: conventional commit messages; commit after every task.

## File structure

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | project config |
| `src/types.ts` | all shared types (manifest, host, ctx, provider, action) |
| `src/pins.ts` | pinned versions |
| `src/manifest/schema.ts` | zod schema, `loadManifest(path)` |
| `src/manifest/resolve.ts` | profile + platform + flags -> `Selection`; slot conflicts; prerequisite closure; token totals |
| `src/exec/run.ts` | `createRunner({dryRun, log})` spawn wrapper |
| `src/ui/log.ts` | logger (console + file), `table()` |
| `src/version/compare.ts` | `compareVersions`, `normalizeVersion` |
| `src/version/latest.ts` | remote latest probes (Claude channels, Codex channel, npm, GitHub release) |
| `src/detect/host.ts` | `detectHost()` |
| `src/detect/tools.ts` | `probeVersion(runner, argv, regex)` |
| `src/detect/agents.ts` | `detectClaude(ctx)`, `detectCodex(ctx)` |
| `src/config/paths.ts` | `resolvePaths(host, env)` |
| `src/config/json.ts` | `readJsonFile`, `writeJsonAtomic`, `backupFile`, `mergeClaudeSettings` |
| `src/config/markers.ts` | `setMarkerBlock`, `removeMarkerBlock` for `#` and `<!-- -->` marker styles |
| `src/config/toml.ts` | `readToml`, `getTable`, `writeTomlMarkerBlock` (uses markers + smol-toml stringify) |
| `src/audit/skills-audit.ts` | `auditSkill(owner, repo, skill, fetchFn)` |
| `src/providers/types.ts` | `Provider` interface, `Action` helpers |
| `src/providers/registry.ts` | `getProvider(kind)` |
| `src/providers/agent-claude.ts`, `agent-codex.ts`, `tool.ts`, `claude-plugin.ts`, `codex-plugin.ts`, `skill.ts`, `mcp-claude.ts`, `mcp-codex.ts`, `setting.ts`, `hook.ts`, `statusline.ts`, `instructions.ts` | one provider per kind |
| `src/planner.ts` | `buildPlan(selection, ctx, mode)` ordered actions |
| `src/executor.ts` | `executePlan(plan, ctx)` |
| `src/state/state.ts` | `readState`, `writeState` |
| `src/update/drift.ts` | `driftReport(ctx, manifest, state)` |
| `src/update/self-update.ts` | `selfUpdate(ctx, currentVersion)` |
| `src/picker/flow.ts` | interactive flow |
| `src/commands/*.ts` | `install`, `update`, `check`, `uninstall`, `list`, `doctor`, `selfUpdate` |
| `src/cli.ts` | arg parsing (`node:util` parseArgs), dispatch, exit codes |
| `manifest.json` | component data |
| `instructions.md` | shared global instructions |
| `install.sh`, `install.ps1` | bootstraps |
| `scripts/build.sh`, `scripts/release.sh`, `scripts/docker-matrix.sh` | build/release/test scripts |
| `.github/workflows/ci.yml`, `.github/workflows/release.yml` | CI |
| `test/**` | vitest tests mirror `src/**`; `test/bootstrap/*.bats`, `test/bootstrap/*.Tests.ps1` |

---

### Task 1: Project scaffold and shared types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/types.ts`, `src/pins.ts`
- Test: `test/types.test.ts`

**Interfaces:**
- Produces: every type below; later tasks import from `../src/types.js`.

- [ ] **Step 1: Create package.json, tsconfig, vitest config, .gitignore**

`package.json`:
```json
{
  "name": "super-agent-installer",
  "version": "0.1.0",
  "description": "Install and update Claude Code, Codex CLI, plugins, skills and MCP servers on Linux, Windows and macOS",
  "type": "module",
  "license": "MIT",
  "bin": { "super-agent-installer": "dist/cli.js" },
  "engines": { "node": ">=22.20.0" },
  "scripts": {
    "build": "bun build ./src/cli.ts --target=node --outfile=dist/cli.js",
    "compile": "bash scripts/build.sh",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint:sh": "shellcheck install.sh scripts/*.sh",
    "start": "bun run src/cli.ts"
  },
  "dependencies": {
    "@clack/prompts": "^1.8.1",
    "smol-toml": "^1.6.0",
    "zod": "^4.3.0"
  },
  "devDependencies": {
    "@types/node": "^22.22.0",
    "typescript": "^5.10.0",
    "vitest": "^4.1.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 20000 } });
```

`.gitignore`:
```
node_modules/
dist/
release/
*.log
.DS_Store
```

- [ ] **Step 2: Install dependencies**

Run: `cd /temp/super-agent-installer && bun install`
Expected: `bun.lock` created, no errors. (If a dependency version does not resolve, run `bun add <pkg>@latest` for that package and keep the resolved version.)

- [ ] **Step 3: Write the failing type test**

`test/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { Component, Manifest } from '../src/types.js';
import { KINDS, SLOTS, PROFILE_NAMES } from '../src/types.js';

describe('types', () => {
  it('exports kind, slot and profile constants', () => {
    expect(KINDS).toContain('claude-plugin');
    expect(SLOTS).toContain('statusline');
    expect(PROFILE_NAMES).toEqual(['all', 'minimal', 'claude-only', 'codex-only', 'work', 'homelab', 'proxmox-host']);
  });
  it('accepts a minimal component literal', () => {
    const c: Component = {
      id: 'cp-superpowers', name: 'superpowers', kind: 'claude-plugin', agents: 'claude',
      platforms: ['linux', 'windows', 'darwin'], description: 'x', verdict: 'must-have',
      defaultSelected: true, spec: { kind: 'claude-plugin', marketplace: 'claude-plugins-official', plugin: 'superpowers' },
    };
    const m: Manifest = { version: 1, profiles: {}, components: [c] };
    expect(m.components[0]?.id).toBe('cp-superpowers');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bunx vitest run test/types.test.ts`
Expected: FAIL, cannot find module `../src/types.js`.

- [ ] **Step 5: Write src/types.ts and src/pins.ts**

`src/pins.ts`:
```ts
export const SKILLS_CLI = '1.6.0';
export const CAVEMAN_CLI = '1.3.4';
export const PLAYWRIGHT_CLI = '0.1.20';
export const NODE_MAJOR = 24;
export const OFFICIAL_MARKETPLACE = 'claude-plugins-official';
export const OFFICIAL_MARKETPLACE_SOURCE = 'anthropics/claude-plugins-official';
export const REPO = 'alexfirilov/super-agent-installer';
```

`src/types.ts`:
```ts
export const PLATFORMS = ['linux', 'windows', 'darwin'] as const;
export type Platform = (typeof PLATFORMS)[number];
export type Arch = 'x64' | 'arm64';
export type AgentTarget = 'claude' | 'codex' | 'both';
export const KINDS = ['agent', 'claude-plugin', 'codex-plugin', 'skill', 'mcp', 'tool', 'setting', 'hook', 'statusline', 'instructions'] as const;
export type Kind = (typeof KINDS)[number];
export const SLOTS = ['statusline', 'bash-rewriter', 'api-proxy', 'memory', 'methodology', 'browser', 'codex-notify', 'codex-hooks-writer'] as const;
export type Slot = (typeof SLOTS)[number];
export const PROFILE_NAMES = ['all', 'minimal', 'claude-only', 'codex-only', 'work', 'homelab', 'proxmox-host'] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];
export type Verdict = 'must-have' | 'recommended' | 'optional';
export type Channel = 'latest' | 'stable';

export interface AgentSpec { kind: 'agent'; agent: 'claude' | 'codex' }
export interface ClaudePluginSpec { kind: 'claude-plugin'; marketplace: string; marketplaceSource?: string; plugin: string; action?: 'install' | 'disable' | 'uninstall' }
export interface CodexPluginSpec { kind: 'codex-plugin'; marketplace: string; marketplaceSource: string; plugin: string }
export interface SkillSpec { kind: 'skill'; repo: string; skills: string[] | '*'; targets: Array<'claude-code' | 'codex'> }
export interface McpSpec {
  kind: 'mcp'; target: 'claude' | 'codex'; name: string; transport: 'http' | 'stdio';
  url?: string; bearerEnv?: string; command?: string; args?: string[]; env?: Record<string, string>;
  secretEnv?: string[]; extra?: Record<string, unknown>; oauth?: { clientId: string; callbackPort: number };
}
export interface ToolPackages {
  apt?: string; dnf?: string; apk?: string; pacman?: string; zypper?: string; brew?: string; winget?: string; scoop?: string;
  npm?: string; go?: string; uvTool?: string; script?: Partial<Record<Platform, string>>;
}
export interface ToolSpec { kind: 'tool'; probe: string[]; versionRegex?: string; packages: ToolPackages; latest?: { npm?: string; github?: string }; postInstall?: Partial<Record<Platform, string[][]>>; strategy?: 'node' }
export interface SettingSpec { kind: 'setting'; target: 'claude' | 'codex'; claudeSettings?: Record<string, unknown>; codexToml?: Record<string, unknown>; codexFeatures?: Record<string, boolean>; windowsGitConfig?: Record<string, string> }
export interface HookSpec { kind: 'hook'; provider: 'caveman'; agent: 'claude' | 'codex' }
export interface StatuslineSpec { kind: 'statusline'; provider: 'caveman' | 'claude-hud' }
export interface InstructionsSpec { kind: 'instructions'; source: string }
export type Spec = AgentSpec | ClaudePluginSpec | CodexPluginSpec | SkillSpec | McpSpec | ToolSpec | SettingSpec | HookSpec | StatuslineSpec | InstructionsSpec;

export interface Component {
  id: string; name: string; kind: Kind; agents: AgentTarget; platforms: Platform[]; description: string; verdict: Verdict;
  defaultSelected: boolean; forceOffInAll?: boolean; profiles?: Partial<Record<ProfileName, boolean>>;
  prerequisites?: string[]; dependsOn?: string[]; conflictsWith?: string[]; slot?: Slot;
  contextCostTokens?: { claude?: number; codex?: number };
  popularity?: { stars?: number; installs?: number; downloadsWeekly?: number; observedAt: string };
  secrets?: Array<{ env: string; prompt: string; required: boolean }>;
  audit?: Array<{ owner: string; repo: string; skill: string }>;
  postInstallHint?: string; source?: string; spec: Spec;
}
export interface Profile { description: string; base: 'all' | 'none'; include?: string[]; exclude?: string[]; agentFilter?: 'claude' | 'codex'; channel?: Channel; headless?: boolean }
export interface Manifest { version: 1; profiles: Partial<Record<ProfileName, Profile>>; components: Component[] }

export type PkgManager = 'apt' | 'dnf' | 'yum' | 'pacman' | 'zypper' | 'apk' | 'brew' | 'winget' | 'scoop' | 'choco' | 'nix' | null;
export interface HostInfo {
  platform: Platform; arch: Arch; isRoot: boolean; hasSudo: boolean; pkgManager: PkgManager; isWsl: boolean; isProxmoxHost: boolean;
  isLxc: boolean; isNixOS: boolean; isMusl: boolean; hasAvx: boolean | null; hasBwrap: boolean; home: string; diskFreeMb: number | null;
  claudeRunning: boolean; windowsDeveloperMode: boolean | null; osRelease: Record<string, string>;
}
export interface Paths { claudeConfigDir: string; claudeSettings: string; claudeJson: string; claudeMd: string; claudeHooksDir: string; codexHome: string; codexConfig: string; codexHooks: string; codexAgentsMd: string; agentsSkillsDir: string; stateDir: string; stateFile: string; backupsDir: string; logFile: string }

export interface RunOptions { cwd?: string; env?: Record<string, string>; input?: string; timeoutMs?: number; readOnly?: boolean; allowFailure?: boolean; shell?: boolean }
export interface RunResult { code: number; stdout: string; stderr: string; skipped: boolean }
export type Runner = (argv: string[], opts?: RunOptions) => Promise<RunResult>;
export interface Logger { info(msg: string): void; warn(msg: string): void; error(msg: string): void; debug(msg: string): void; step(msg: string): void }

export interface Ctx {
  host: HostInfo; paths: Paths; run: Runner; log: Logger; dryRun: boolean; yes: boolean; noAudit: boolean; channel: Channel;
  secrets: Map<string, string>; fetch: typeof fetch; env: Record<string, string | undefined>; manifest: Manifest;
}
export interface Installed { version: string | null; details?: Record<string, unknown> }
export type Op = 'install' | 'update' | 'skip' | 'uninstall' | 'disable' | 'configure';
export interface ActionResult { ok: boolean; message: string; changed: boolean }
export interface Action { id: string; componentId: string; op: Op; description: string; from?: string | null; to?: string | null; run: (ctx: Ctx) => Promise<ActionResult> }
export type Mode = 'install' | 'update' | 'uninstall';
export interface Provider { kind: Kind; detect(c: Component, ctx: Ctx): Promise<Installed | null>; latest?(c: Component, ctx: Ctx): Promise<string | null>; plan(c: Component, ctx: Ctx, installed: Installed | null, mode: Mode): Promise<Action[]> }
export interface Selection { profile: ProfileName | 'saved'; components: Component[]; excluded: Array<{ id: string; reason: string }>; tokenTotals: { claude: number; codex: number }; codexMcpCount: number }
export interface StepRecord { componentId: string; op: Op; ok: boolean; changed: boolean; message: string; from?: string | null; to?: string | null }
export interface HostState { version: 1; installerVersion: string; profile: ProfileName | 'saved'; selectedIds: string[]; channel: Channel; installed: Record<string, { version: string | null; at: string }>; lastRun: string }
```

- [ ] **Step 6: Run test and typecheck**

Run: `bunx vitest run test/types.test.ts && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore bun.lock src/types.ts src/pins.ts test/types.test.ts
git commit -m "chore: scaffold project with shared types and pins"
```

---

### Task 2: Manifest schema and loader

**Files:**
- Create: `src/manifest/schema.ts`
- Test: `test/manifest/schema.test.ts`

**Interfaces:**
- Produces: `loadManifest(path: string): Promise<Manifest>`, `parseManifest(json: unknown): Manifest` (throws `ManifestError` with `.issues: string[]`), `manifestSchema` (zod).

- [ ] **Step 1: Write the failing tests**

`test/manifest/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseManifest, ManifestError } from '../../src/manifest/schema.js';

const base = { version: 1, profiles: { all: { description: 'everything', base: 'all' } }, components: [] as unknown[] };
const plugin = { id: 'cp-x', name: 'x', kind: 'claude-plugin', agents: 'claude', platforms: ['linux'], description: 'd', verdict: 'optional', defaultSelected: false, spec: { kind: 'claude-plugin', marketplace: 'm', plugin: 'x' } };

describe('parseManifest', () => {
  it('parses a valid manifest', () => {
    const m = parseManifest({ ...base, components: [plugin] });
    expect(m.components).toHaveLength(1);
  });
  it('rejects duplicate ids', () => {
    expect(() => parseManifest({ ...base, components: [plugin, plugin] })).toThrow(ManifestError);
    try { parseManifest({ ...base, components: [plugin, plugin] }); } catch (e) { expect((e as ManifestError).issues[0]).toMatch(/duplicate id cp-x/); }
  });
  it('rejects unknown dependsOn / prerequisites / conflictsWith ids', () => {
    expect(() => parseManifest({ ...base, components: [{ ...plugin, dependsOn: ['nope'] }] })).toThrow(/unknown id nope/);
  });
  it('rejects spec.kind that does not match kind', () => {
    expect(() => parseManifest({ ...base, components: [{ ...plugin, kind: 'skill' }] })).toThrow(/spec.kind/);
  });
  it('rejects a codex-only component whose spec targets claude', () => {
    const mcp = { ...plugin, id: 'mcp-a', kind: 'mcp', agents: 'codex', spec: { kind: 'mcp', target: 'claude', name: 'a', transport: 'http', url: 'https://x' } };
    expect(() => parseManifest({ ...base, components: [mcp] })).toThrow(/agents/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/manifest/schema.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement schema.ts**

```ts
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { KINDS, PLATFORMS, PROFILE_NAMES, SLOTS, type Manifest } from '../types.js';

export class ManifestError extends Error { constructor(public issues: string[]) { super(`Invalid manifest:\n- ${issues.join('\n- ')}`); } }

const platform = z.enum(PLATFORMS);
const agentSpec = z.object({ kind: z.literal('agent'), agent: z.enum(['claude', 'codex']) });
const claudePluginSpec = z.object({ kind: z.literal('claude-plugin'), marketplace: z.string(), marketplaceSource: z.string().optional(), plugin: z.string(), action: z.enum(['install', 'disable', 'uninstall']).optional() });
const codexPluginSpec = z.object({ kind: z.literal('codex-plugin'), marketplace: z.string(), marketplaceSource: z.string(), plugin: z.string() });
const skillSpec = z.object({ kind: z.literal('skill'), repo: z.string(), skills: z.union([z.array(z.string()).min(1), z.literal('*')]), targets: z.array(z.enum(['claude-code', 'codex'])).min(1) });
const mcpSpec = z.object({ kind: z.literal('mcp'), target: z.enum(['claude', 'codex']), name: z.string(), transport: z.enum(['http', 'stdio']), url: z.string().optional(), bearerEnv: z.string().optional(), command: z.string().optional(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional(), secretEnv: z.array(z.string()).optional(), extra: z.record(z.string(), z.unknown()).optional(), oauth: z.object({ clientId: z.string(), callbackPort: z.number() }).optional() })
  .refine((s) => (s.transport === 'http' ? !!s.url : !!s.command), { message: 'http needs url, stdio needs command' });
const toolSpec = z.object({ kind: z.literal('tool'), probe: z.array(z.string()).min(1), versionRegex: z.string().optional(), packages: z.object({ apt: z.string().optional(), dnf: z.string().optional(), apk: z.string().optional(), pacman: z.string().optional(), zypper: z.string().optional(), brew: z.string().optional(), winget: z.string().optional(), scoop: z.string().optional(), npm: z.string().optional(), go: z.string().optional(), uvTool: z.string().optional(), script: z.object({ linux: z.string().optional(), windows: z.string().optional(), darwin: z.string().optional() }).optional() }), latest: z.object({ npm: z.string().optional(), github: z.string().optional() }).optional(), postInstall: z.object({ linux: z.array(z.array(z.string())).optional(), windows: z.array(z.array(z.string())).optional(), darwin: z.array(z.array(z.string())).optional() }).optional(), strategy: z.literal('node').optional() });
const settingSpec = z.object({ kind: z.literal('setting'), target: z.enum(['claude', 'codex']), claudeSettings: z.record(z.string(), z.unknown()).optional(), codexToml: z.record(z.string(), z.unknown()).optional(), codexFeatures: z.record(z.string(), z.boolean()).optional(), windowsGitConfig: z.record(z.string(), z.string()).optional() });
const hookSpec = z.object({ kind: z.literal('hook'), provider: z.literal('caveman'), agent: z.enum(['claude', 'codex']) });
const statuslineSpec = z.object({ kind: z.literal('statusline'), provider: z.enum(['caveman', 'claude-hud']) });
const instructionsSpec = z.object({ kind: z.literal('instructions'), source: z.string() });
const spec = z.discriminatedUnion('kind', [agentSpec, claudePluginSpec, codexPluginSpec, skillSpec, mcpSpec, toolSpec, settingSpec, hookSpec, statuslineSpec, instructionsSpec]);

const component = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), kind: z.enum(KINDS), agents: z.enum(['claude', 'codex', 'both']), platforms: z.array(platform).min(1),
  description: z.string(), verdict: z.enum(['must-have', 'recommended', 'optional']), defaultSelected: z.boolean(), forceOffInAll: z.boolean().optional(),
  profiles: z.partialRecord(z.enum(PROFILE_NAMES), z.boolean()).optional(), prerequisites: z.array(z.string()).optional(), dependsOn: z.array(z.string()).optional(),
  conflictsWith: z.array(z.string()).optional(), slot: z.enum(SLOTS).optional(), contextCostTokens: z.object({ claude: z.number().optional(), codex: z.number().optional() }).optional(),
  popularity: z.object({ stars: z.number().optional(), installs: z.number().optional(), downloadsWeekly: z.number().optional(), observedAt: z.string() }).optional(),
  secrets: z.array(z.object({ env: z.string(), prompt: z.string(), required: z.boolean() })).optional(),
  audit: z.array(z.object({ owner: z.string(), repo: z.string(), skill: z.string() })).optional(), postInstallHint: z.string().optional(), source: z.string().optional(), spec,
});
const profile = z.object({ description: z.string(), base: z.enum(['all', 'none']), include: z.array(z.string()).optional(), exclude: z.array(z.string()).optional(), agentFilter: z.enum(['claude', 'codex']).optional(), channel: z.enum(['latest', 'stable']).optional(), headless: z.boolean().optional() });
export const manifestSchema = z.object({ version: z.literal(1), profiles: z.partialRecord(z.enum(PROFILE_NAMES), profile), components: z.array(component) });
// zod 4: z.record with an enum key is exhaustive; partialRecord allows a subset of profiles. If discriminatedUnion rejects the refined mcpSpec, drop the .refine and add the http/stdio check to the manual issues loop below.

export function parseManifest(json: unknown): Manifest {
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) throw new ManifestError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  const m = parsed.data as Manifest;
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const c of m.components) { if (ids.has(c.id)) issues.push(`duplicate id ${c.id}`); ids.add(c.id); }
  for (const c of m.components) {
    if (c.spec.kind !== c.kind) issues.push(`${c.id}: spec.kind ${c.spec.kind} does not match kind ${c.kind}`);
    for (const ref of [...(c.dependsOn ?? []), ...(c.prerequisites ?? []), ...(c.conflictsWith ?? [])]) if (!ids.has(ref)) issues.push(`${c.id}: unknown id ${ref}`);
    const t = 'target' in c.spec ? c.spec.target : 'agent' in c.spec ? c.spec.agent : undefined;
    if (t && c.agents !== 'both' && c.agents !== t) issues.push(`${c.id}: agents=${c.agents} but spec targets ${t}`);
  }
  for (const [name, p] of Object.entries(m.profiles)) for (const ref of [...(p?.include ?? []), ...(p?.exclude ?? [])]) if (!ids.has(ref)) issues.push(`profile ${name}: unknown id ${ref}`);
  if (issues.length) throw new ManifestError(issues);
  return m;
}
export async function loadManifest(path: string): Promise<Manifest> { return parseManifest(JSON.parse(await readFile(path, 'utf8'))); }
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/manifest/schema.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/manifest/schema.ts test/manifest/schema.test.ts
git commit -m "feat(manifest): zod schema and loader with cross-reference validation"
```

---

### Task 3: Version comparison and remote latest probes

**Files:**
- Create: `src/version/compare.ts`, `src/version/latest.ts`
- Test: `test/version/compare.test.ts`, `test/version/latest.test.ts`

**Interfaces:**
- Produces: `normalizeVersion(s: string): string | null` (extracts `X.Y.Z[-pre]` from text like `2.1.273 (Claude Code)`, `codex-cli 0.154.0`, `rust-v0.154.0`), `compareVersions(a, b): -1|0|1`, `isNewer(latest, installed): boolean`; `latestClaude(fetch, channel)`, `latestCodex(fetch)`, `latestNpm(fetch, pkg)`, `latestGithubRelease(fetch, ownerRepo)` (all return `string | null`, never throw).

- [ ] **Step 1: Write failing tests**

`test/version/compare.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeVersion, compareVersions, isNewer } from '../../src/version/compare.js';
describe('normalizeVersion', () => {
  it('extracts versions from CLI output', () => {
    expect(normalizeVersion('2.1.273 (Claude Code)')).toBe('2.1.273');
    expect(normalizeVersion('codex-cli 0.154.0')).toBe('0.154.0');
    expect(normalizeVersion('rust-v0.154.0')).toBe('0.154.0');
    expect(normalizeVersion('v1.6.0')).toBe('1.6.0');
    expect(normalizeVersion('0.155.0-alpha.16')).toBe('0.155.0-alpha.16');
    expect(normalizeVersion('no version here')).toBeNull();
  });
});
describe('compareVersions', () => {
  it('orders numerically and treats prerelease as lower', () => {
    expect(compareVersions('2.1.274', '2.1.273')).toBe(1);
    expect(compareVersions('0.154.0', '0.155.0-alpha.1')).toBe(-1);
    expect(compareVersions('0.155.0-alpha.1', '0.155.0')).toBe(-1);
    expect(compareVersions('1.6.0', '1.6.0')).toBe(0);
    expect(isNewer('2.1.274', '2.1.273')).toBe(true);
    expect(isNewer('2.1.273', null)).toBe(true);
    expect(isNewer(null, '2.1.273')).toBe(false);
  });
});
```

`test/version/latest.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { latestClaude, latestCodex, latestNpm, latestGithubRelease } from '../../src/version/latest.js';
const mk = (map: Record<string, { status: number; body?: string; location?: string }>) => (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url); const r = map[u]; if (!r) return new Response('nf', { status: 404 });
  return new Response(r.body ?? '', { status: r.status, headers: r.location ? { location: r.location } : {} });
}) as unknown as typeof fetch;
describe('latest probes', () => {
  it('reads Claude channels', async () => {
    const f = mk({ 'https://downloads.claude.ai/claude-code-releases/latest': { status: 200, body: '2.1.274\n' }, 'https://downloads.claude.ai/claude-code-releases/stable': { status: 200, body: '2.1.267' } });
    expect(await latestClaude(f, 'latest')).toBe('2.1.274');
    expect(await latestClaude(f, 'stable')).toBe('2.1.267');
  });
  it('reads Codex channel json', async () => {
    const f = mk({ 'https://releases.openai.com/codex/channels/latest': { status: 200, body: JSON.stringify({ tag_name: 'rust-v0.154.0' }) } });
    expect(await latestCodex(f)).toBe('0.154.0');
  });
  it('reads npm dist-tags', async () => {
    const f = mk({ 'https://registry.npmjs.org/@caveman-ai%2Fcli/latest': { status: 200, body: JSON.stringify({ version: '1.3.4' }) } });
    expect(await latestNpm(f, '@caveman-ai/cli')).toBe('1.3.4');
  });
  it('reads GitHub release tag from the redirect target without the API', async () => {
    const f = mk({ 'https://github.com/rtk-ai/rtk/releases/latest': { status: 302, location: 'https://github.com/rtk-ai/rtk/releases/tag/v0.49.0' } });
    expect(await latestGithubRelease(f, 'rtk-ai/rtk')).toBe('0.49.0');
  });
  it('returns null on network failure', async () => {
    const f = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await latestClaude(f, 'latest')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/version`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/version/compare.ts`:
```ts
const RE = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;
export function normalizeVersion(s: string | null | undefined): string | null { if (!s) return null; const m = RE.exec(s); return m ? m[0] : null; }
function parts(v: string): { nums: number[]; pre: string | null } { const m = RE.exec(v); if (!m) return { nums: [0, 0, 0], pre: null }; return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null }; }
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < 3; i++) { const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0); if (d !== 0) return d < 0 ? -1 : 1; }
  if (pa.pre === pb.pre) return 0; if (pa.pre === null) return 1; if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
}
export function isNewer(latest: string | null, installed: string | null): boolean {
  if (!latest) return false; if (!installed) return true; return compareVersions(latest, installed) === 1;
}
```

`src/version/latest.ts`:
```ts
import { normalizeVersion } from './compare.js';
type F = typeof fetch;
async function text(f: F, url: string): Promise<string | null> { try { const r = await f(url, { redirect: 'follow' }); if (!r.ok) return null; return await r.text(); } catch { return null; } }
export async function latestClaude(f: F, channel: 'latest' | 'stable'): Promise<string | null> { return normalizeVersion(await text(f, `https://downloads.claude.ai/claude-code-releases/${channel}`)); }
export async function latestCodex(f: F): Promise<string | null> {
  const t = await text(f, 'https://releases.openai.com/codex/channels/latest'); if (!t) return null;
  try { return normalizeVersion((JSON.parse(t) as { tag_name?: string }).tag_name ?? ''); } catch { return null; }
}
export async function latestNpm(f: F, pkg: string): Promise<string | null> {
  const t = await text(f, `https://registry.npmjs.org/${pkg.replace('/', '%2F')}/latest`); if (!t) return null;
  try { return normalizeVersion((JSON.parse(t) as { version?: string }).version ?? ''); } catch { return null; }
}
export async function latestGithubRelease(f: F, ownerRepo: string): Promise<string | null> {
  try {
    const r = await f(`https://github.com/${ownerRepo}/releases/latest`, { redirect: 'manual' });
    const loc = r.headers.get('location') ?? (r.url !== `https://github.com/${ownerRepo}/releases/latest` ? r.url : '');
    return normalizeVersion(loc.split('/').pop() ?? '');
  } catch { return null; }
}
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/version`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/version test/version
git commit -m "feat(version): version parsing/comparison and remote latest probes"
```

---

### Task 4: Runner (process execution with dry-run) and logger

**Files:**
- Create: `src/exec/run.ts`, `src/ui/log.ts`
- Test: `test/exec/run.test.ts`, `test/ui/log.test.ts`

**Interfaces:**
- Produces: `createRunner(opts: { dryRun: boolean; log: Logger; env?: Record<string,string|undefined> }): Runner`; `createLogger(opts: { file?: string; verbose?: boolean; json?: boolean }): Logger & { lines: string[] }`; `table(rows: string[][], header: string[]): string`; `quoteArgv(argv: string[]): string` (display only).

- [ ] **Step 1: Write failing tests**

`test/exec/run.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createRunner, quoteArgv } from '../../src/exec/run.js';
import { createLogger } from '../../src/ui/log.js';
const node = process.execPath;
describe('runner', () => {
  it('captures stdout, stderr and exit code', async () => {
    const run = createRunner({ dryRun: false, log: createLogger({}) });
    const r = await run([node, '-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'], { allowFailure: true });
    expect(r).toMatchObject({ code: 3, stdout: 'out', stderr: 'err', skipped: false });
  });
  it('throws on non-zero exit unless allowFailure', async () => {
    const run = createRunner({ dryRun: false, log: createLogger({}) });
    await expect(run([node, '-e', 'process.exit(2)'])).rejects.toThrow(/exit 2/);
  });
  it('skips mutating commands in dry-run but runs readOnly ones', async () => {
    const log = createLogger({});
    const run = createRunner({ dryRun: true, log });
    const skipped = await run([node, '-e', 'process.stdout.write("x")']);
    expect(skipped).toMatchObject({ code: 0, stdout: '', skipped: true });
    const ran = await run([node, '-e', 'process.stdout.write("x")'], { readOnly: true });
    expect(ran.stdout).toBe('x');
    expect(log.lines.some((l) => l.includes('[dry-run]'))).toBe(true);
  });
  it('passes stdin input and env', async () => {
    const run = createRunner({ dryRun: false, log: createLogger({}) });
    const r = await run([node, '-e', 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(d+process.env.SAI_T))'], { input: 'hi', env: { SAI_T: '!' } });
    expect(r.stdout).toBe('hi!');
  });
  it('times out', async () => {
    const run = createRunner({ dryRun: false, log: createLogger({}) });
    await expect(run([node, '-e', 'setTimeout(()=>{},5000)'], { timeoutMs: 200 })).rejects.toThrow(/timed out/);
  });
  it('quotes argv for display', () => { expect(quoteArgv(['a', 'b c', "d'e"])).toBe(`a 'b c' 'd'\\''e'`); });
});
```

`test/ui/log.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger, table } from '../../src/ui/log.js';
describe('logger', () => {
  it('writes to file and keeps lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const file = join(dir, 'x.log');
    const log = createLogger({ file });
    log.info('hello'); log.warn('careful'); log.debug('hidden');
    expect(log.lines).toEqual(expect.arrayContaining([expect.stringContaining('hello'), expect.stringContaining('careful')]));
    expect(readFileSync(file, 'utf8')).toContain('hidden');
  });
  it('renders a table with padded columns', () => {
    const t = table([['a', 'bbb'], ['cc', 'd']], ['H1', 'H2']);
    expect(t.split('\n')[0]).toBe('H1  H2 ');
    expect(t.split('\n')[1]).toBe('a   bbb');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/exec test/ui`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/ui/log.ts`:
```ts
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from '../types.js';
export interface LoggerOptions { file?: string; verbose?: boolean; json?: boolean; quiet?: boolean }
export function createLogger(o: LoggerOptions): Logger & { lines: string[] } {
  const lines: string[] = [];
  if (o.file) mkdirSync(dirname(o.file), { recursive: true });
  const emit = (level: string, msg: string, show: boolean) => {
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${msg}`;
    if (o.file) appendFileSync(o.file, line + '\n');
    if (show) { lines.push(line); if (!o.quiet && !o.json) (level === 'ERROR' || level === 'WARN' ? console.error : console.log)(level === 'INFO' ? msg : `${level}: ${msg}`); }
  };
  return { lines, info: (m) => emit('INFO', m, true), warn: (m) => emit('WARN', m, true), error: (m) => emit('ERROR', m, true), debug: (m) => emit('DEBUG', m, !!o.verbose), step: (m) => emit('STEP', m, true) };
}
export function table(rows: string[][], header: string[]): string {
  const all = [header, ...rows]; const w = header.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
  return all.map((r) => r.map((c, i) => c.padEnd(w[i] ?? 0)).join('  ')).join('\n');
}
```

`src/exec/run.ts`:
```ts
import { spawn } from 'node:child_process';
import type { Logger, Runner, RunOptions, RunResult } from '../types.js';
export function quoteArgv(argv: string[]): string { return argv.map((a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' '); }
export class RunError extends Error { constructor(msg: string, public result: RunResult) { super(msg); } }
export function createRunner(o: { dryRun: boolean; log: Logger; env?: Record<string, string | undefined> }): Runner {
  return async (argv: string[], opts: RunOptions = {}): Promise<RunResult> => {
    const shown = quoteArgv(argv);
    if (o.dryRun && !opts.readOnly) { o.log.info(`[dry-run] ${shown}`); return { code: 0, stdout: '', stderr: '', skipped: true }; }
    o.log.debug(`$ ${shown}`);
    const [cmd, ...args] = argv; if (!cmd) throw new Error('empty argv');
    return await new Promise<RunResult>((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...o.env, ...opts.env }, shell: opts.shell ?? false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '', stderr = '', done = false;
      const timer = opts.timeoutMs ? setTimeout(() => { if (!done) { child.kill(); reject(new RunError(`command timed out after ${opts.timeoutMs}ms: ${shown}`, { code: -1, stdout, stderr, skipped: false })); } }, opts.timeoutMs) : null;
      child.stdout.on('data', (d) => (stdout += d)); child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (e) => { done = true; if (timer) clearTimeout(timer); reject(new RunError(`failed to start ${shown}: ${e.message}`, { code: -1, stdout, stderr, skipped: false })); });
      child.on('close', (code) => {
        done = true; if (timer) clearTimeout(timer);
        const result: RunResult = { code: code ?? -1, stdout, stderr, skipped: false };
        if (result.code !== 0 && !opts.allowFailure) reject(new RunError(`${shown} failed with exit ${result.code}: ${stderr.trim().split('\n').pop() ?? ''}`, result)); else resolve(result);
      });
      if (opts.input !== undefined) child.stdin.write(opts.input); child.stdin.end();
    });
  };
}
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/exec test/ui`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/exec src/ui test/exec test/ui
git commit -m "feat(exec): process runner with dry-run and logger/table helpers"
```

---

### Task 5: Host detection and paths

**Files:**
- Create: `src/detect/host.ts`, `src/config/paths.ts`
- Test: `test/detect/host.test.ts`, `test/config/paths.test.ts`

**Interfaces:**
- Produces: `detectHost(deps: HostDeps): Promise<HostInfo>` where `HostDeps = { platform: NodeJS.Platform; arch: string; env: Record<string,string|undefined>; readFile(p): Promise<string|null>; exists(p): Promise<boolean>; which(cmd): Promise<boolean>; run: Runner; homedir: string }` (injectable for tests) and `defaultHostDeps(run)`; `resolvePaths(host: HostInfo, env): Paths`.

- [ ] **Step 1: Write failing tests**

`test/detect/host.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { detectHost, type HostDeps } from '../../src/detect/host.js';
function deps(over: Partial<HostDeps> & { files?: Record<string, string>; bins?: string[]; uid?: number; ps?: string }): HostDeps {
  const files = over.files ?? {}; const bins = new Set(over.bins ?? []);
  return {
    platform: 'linux', arch: 'x64', env: {}, homedir: '/home/u', uid: over.uid ?? 1000,
    readFile: async (p) => files[p] ?? null, exists: async (p) => p in files, which: async (c) => bins.has(c),
    run: async (argv) => ({ code: 0, stdout: argv[0] === 'ps' ? (over.ps ?? '') : argv[0] === 'df' ? 'Filesystem 1M-blocks Used Available Use% Mounted\n/dev/x 1000 500 12345 50% /home\n' : '', stderr: '', skipped: false }),
    ...over,
  };
}
describe('detectHost', () => {
  it('detects Proxmox host as root with apt and AVX', async () => {
    const h = await detectHost(deps({ uid: 0, bins: ['apt-get', 'pveversion'], files: { '/etc/os-release': 'ID=debian\nVERSION_ID="13"\n', '/proc/cpuinfo': 'flags : fpu avx avx2\n', '/etc/pve/.version': '{}' } }));
    expect(h).toMatchObject({ platform: 'linux', isRoot: true, pkgManager: 'apt', isProxmoxHost: true, hasAvx: true, osRelease: { ID: 'debian' } });
  });
  it('detects LXC, WSL, musl and missing AVX', async () => {
    const h = await detectHost(deps({ bins: ['apk', 'sudo'], files: { '/etc/os-release': 'ID=alpine\n', '/proc/cpuinfo': 'flags : fpu sse\n', '/proc/1/environ': 'container=lxc\0', '/proc/version': 'Linux version 5.15 microsoft-standard-WSL2', '/lib/ld-musl-x86_64.so.1': '' } }));
    expect(h).toMatchObject({ isLxc: true, isWsl: true, isMusl: true, hasAvx: false, pkgManager: 'apk', hasSudo: true, isRoot: false });
  });
  it('detects a running claude session and disk space', async () => {
    const h = await detectHost(deps({ ps: '1234 claude\n', files: { '/proc/cpuinfo': 'avx' } }));
    expect(h.claudeRunning).toBe(true); expect(h.diskFreeMb).toBe(12345);
  });
  it('maps windows and darwin', async () => {
    const w = await detectHost(deps({ platform: 'win32', arch: 'arm64', bins: ['winget'], env: { USERPROFILE: 'C:\\Users\\u' } }));
    expect(w).toMatchObject({ platform: 'windows', arch: 'arm64', pkgManager: 'winget', hasAvx: null });
    const d = await detectHost(deps({ platform: 'darwin', bins: ['brew'] }));
    expect(d).toMatchObject({ platform: 'darwin', pkgManager: 'brew' });
  });
});
```

`test/config/paths.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolvePaths } from '../../src/config/paths.js';
import type { HostInfo } from '../../src/types.js';
const base = { platform: 'linux', arch: 'x64', isRoot: false, hasSudo: true, pkgManager: 'apt', isWsl: false, isProxmoxHost: false, isLxc: false, isNixOS: false, isMusl: false, hasAvx: true, hasBwrap: true, home: '/home/u', diskFreeMb: 1, claudeRunning: false, windowsDeveloperMode: null, osRelease: {} } as HostInfo;
describe('resolvePaths', () => {
  it('uses defaults on linux', () => {
    const p = resolvePaths(base, {});
    expect(p.claudeSettings).toBe('/home/u/.claude/settings.json');
    expect(p.claudeJson).toBe('/home/u/.claude.json');
    expect(p.codexConfig).toBe('/home/u/.codex/config.toml');
    expect(p.agentsSkillsDir).toBe('/home/u/.agents/skills');
    expect(p.stateFile).toBe('/home/u/.config/super-agent-installer/state.json');
  });
  it('honours CLAUDE_CONFIG_DIR and CODEX_HOME', () => {
    const p = resolvePaths(base, { CLAUDE_CONFIG_DIR: '/tmp/cc', CODEX_HOME: '/tmp/cx' });
    expect(p.claudeSettings).toBe('/tmp/cc/settings.json'); expect(p.claudeJson).toBe('/tmp/cc/.claude.json'); expect(p.codexHooks).toBe('/tmp/cx/hooks.json');
  });
  it('uses APPDATA on windows', () => {
    const p = resolvePaths({ ...base, platform: 'windows', home: 'C:\\Users\\u' }, { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' });
    expect(p.stateFile).toBe('C:\\Users\\u\\AppData\\Roaming\\super-agent-installer\\state.json');
    expect(p.claudeSettings).toBe('C:\\Users\\u\\.claude\\settings.json');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/detect test/config/paths.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/detect/host.ts`:
```ts
import { readFile as fsReadFile, access } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import type { HostInfo, PkgManager, Platform, Runner } from '../types.js';
export interface HostDeps { platform: NodeJS.Platform; arch: string; env: Record<string, string | undefined>; homedir: string; uid: number; readFile(p: string): Promise<string | null>; exists(p: string): Promise<boolean>; which(cmd: string): Promise<boolean>; run: Runner }
export function defaultHostDeps(run: Runner): HostDeps {
  const which = async (cmd: string) => { const r = await run(process.platform === 'win32' ? ['where.exe', cmd] : ['sh', '-c', `command -v ${cmd}`], { readOnly: true, allowFailure: true }); return r.code === 0; };
  return { platform: process.platform, arch: process.arch, env: process.env, homedir: homedir(), uid: process.platform === 'win32' ? 1000 : userInfo().uid, readFile: async (p) => { try { return await fsReadFile(p, 'utf8'); } catch { return null; } }, exists: async (p) => { try { await access(p); return true; } catch { return false; } }, which, run };
}
function parseOsRelease(t: string | null): Record<string, string> { const o: Record<string, string> = {}; for (const line of (t ?? '').split('\n')) { const m = /^([A-Z_]+)=("?)(.*)\2$/.exec(line.trim()); if (m && m[1] && m[3] !== undefined) o[m[1]] = m[3]; } return o; }
export async function detectHost(d: HostDeps): Promise<HostInfo> {
  const platform: Platform = d.platform === 'win32' ? 'windows' : d.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = d.arch === 'arm64' || d.arch === 'aarch64' ? 'arm64' : 'x64';
  const home = platform === 'windows' ? (d.env.USERPROFILE ?? d.homedir) : d.homedir;
  const has = async (...c: string[]) => { for (const x of c) if (await d.which(x)) return true; return false; };
  let pkgManager: PkgManager = null;
  if (platform === 'linux') { for (const [bin, pm] of [['apt-get', 'apt'], ['dnf', 'dnf'], ['yum', 'yum'], ['pacman', 'pacman'], ['zypper', 'zypper'], ['apk', 'apk'], ['nix-env', 'nix']] as const) if (await d.which(bin)) { pkgManager = pm; break; } }
  else if (platform === 'darwin') pkgManager = (await d.which('brew')) ? 'brew' : null;
  else pkgManager = (await d.which('winget')) ? 'winget' : (await d.which('scoop')) ? 'scoop' : (await d.which('choco')) ? 'choco' : null;
  const osRelease = platform === 'linux' ? parseOsRelease(await d.readFile('/etc/os-release')) : {};
  const cpuinfo = platform === 'linux' ? await d.readFile('/proc/cpuinfo') : null;
  const hasAvx = platform === 'linux' ? (cpuinfo ? /\bavx\b/.test(cpuinfo) : null) : null;
  const environ = platform === 'linux' ? await d.readFile('/proc/1/environ') : null;
  const version = platform === 'linux' ? await d.readFile('/proc/version') : null;
  const isRoot = platform !== 'windows' && d.uid === 0;
  const psOut = platform === 'windows' ? (await d.run(['tasklist.exe', '/FI', 'IMAGENAME eq claude.exe', '/NH'], { readOnly: true, allowFailure: true })).stdout : (await d.run(['ps', '-eo', 'pid,comm'], { readOnly: true, allowFailure: true })).stdout;
  const claudeRunning = /(^|\s)claude(\.exe)?(\s|$)/m.test(psOut);
  let diskFreeMb: number | null = null;
  if (platform !== 'windows') { const df = await d.run(['df', '-m', home], { readOnly: true, allowFailure: true }); const line = df.stdout.trim().split('\n').pop() ?? ''; const cols = line.split(/\s+/); const n = Number(cols[3]); diskFreeMb = Number.isFinite(n) ? n : null; }
  else { const r = await d.run(['powershell.exe', '-NoProfile', '-Command', `(Get-PSDrive -Name ($env:USERPROFILE.Substring(0,1))).Free / 1MB`], { readOnly: true, allowFailure: true }); const n = Number(r.stdout.trim()); diskFreeMb = Number.isFinite(n) ? Math.floor(n) : null; }
  let windowsDeveloperMode: boolean | null = null;
  if (platform === 'windows') { const r = await d.run(['reg.exe', 'query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock', '/v', 'AllowDevelopmentWithoutDevLicense'], { readOnly: true, allowFailure: true }); windowsDeveloperMode = r.code === 0 ? /0x1/.test(r.stdout) : false; }
  return {
    platform, arch, isRoot, hasSudo: platform !== 'windows' && !isRoot && (await d.which('sudo')), pkgManager,
    isWsl: /microsoft/i.test(version ?? '') || !!d.env.WSL_DISTRO_NAME, isProxmoxHost: platform === 'linux' && ((await d.which('pveversion')) || (await d.exists('/etc/pve/.version'))),
    isLxc: /container=lxc/.test(environ ?? ''), isNixOS: osRelease.ID === 'nixos', isMusl: platform === 'linux' && ((await d.exists('/lib/ld-musl-x86_64.so.1')) || (await d.exists('/lib/ld-musl-aarch64.so.1'))),
    hasAvx, hasBwrap: platform === 'linux' && (await has('bwrap')), home, diskFreeMb, claudeRunning, windowsDeveloperMode, osRelease,
  };
}
```

`src/config/paths.ts`:
```ts
import { join } from 'node:path';
import type { HostInfo, Paths } from '../types.js';
export function resolvePaths(host: HostInfo, env: Record<string, string | undefined>): Paths {
  const j = host.platform === 'windows' ? (...p: string[]) => p.join('\\') : (...p: string[]) => join(...p);
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR ?? j(host.home, '.claude');
  const claudeJson = env.CLAUDE_CONFIG_DIR ? j(env.CLAUDE_CONFIG_DIR, '.claude.json') : j(host.home, '.claude.json');
  const codexHome = env.CODEX_HOME ?? j(host.home, '.codex');
  const stateDir = host.platform === 'windows' ? j(env.APPDATA ?? j(host.home, 'AppData', 'Roaming'), 'super-agent-installer') : j(env.XDG_CONFIG_HOME ?? j(host.home, '.config'), 'super-agent-installer');
  return {
    claudeConfigDir, claudeSettings: j(claudeConfigDir, 'settings.json'), claudeJson, claudeMd: j(claudeConfigDir, 'CLAUDE.md'), claudeHooksDir: j(claudeConfigDir, 'hooks'),
    codexHome, codexConfig: j(codexHome, 'config.toml'), codexHooks: j(codexHome, 'hooks.json'), codexAgentsMd: j(codexHome, 'AGENTS.md'), agentsSkillsDir: j(host.home, '.agents', 'skills'),
    stateDir, stateFile: j(stateDir, 'state.json'), backupsDir: j(stateDir, 'backups'), logFile: j(stateDir, 'last-run.log'),
  };
}
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/detect test/config/paths.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/detect/host.ts src/config/paths.ts test/detect/host.test.ts test/config/paths.test.ts
git commit -m "feat(detect): host detection (platform, root, pkg manager, AVX, LXC, WSL) and config paths"
```

---

### Task 6: Tool version probes and agent state detection

**Files:**
- Create: `src/detect/tools.ts`, `src/detect/agents.ts`
- Test: `test/detect/tools.test.ts`, `test/detect/agents.test.ts`

**Interfaces:**
- Produces: `probeVersion(run, argv, regex?): Promise<string|null>` (null when the command is missing or fails); `detectClaude(ctx): Promise<ClaudeState>` with `ClaudeState = { installed: boolean; version: string|null; plugins: Array<{id: string; version: string; scope: string; enabled: boolean}>; marketplaces: string[]; mcp: Record<string, unknown>; settings: Record<string, unknown> }`; `detectCodex(ctx): Promise<CodexState>` with `CodexState = { installed: boolean; version: string|null; plugins: Array<{id: string; version: string|null}>; marketplaces: string[]; mcp: Record<string, Record<string, unknown>>; config: Record<string, unknown> }`.
- Consumes: `Runner`, `readJsonFile` (Task 7; until then use `JSON.parse(readFile)` inline), `readToml` (Task 8). To avoid forward dependencies, this task reads files with `node:fs/promises` and parses TOML with `smol-toml` directly.

- [ ] **Step 1: Write failing tests**

`test/detect/tools.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { probeVersion } from '../../src/detect/tools.js';
import type { Runner } from '../../src/types.js';
const fake = (out: Record<string, string | Error>): Runner => async (argv) => { const v = out[argv.join(' ')]; if (v instanceof Error) throw v; if (v === undefined) return { code: 127, stdout: '', stderr: 'not found', skipped: false }; return { code: 0, stdout: v, stderr: '', skipped: false }; };
describe('probeVersion', () => {
  it('returns normalized version', async () => { expect(await probeVersion(fake({ 'claude --version': '2.1.273 (Claude Code)\n' }), ['claude', '--version'])).toBe('2.1.273'); });
  it('returns null when missing or throwing', async () => {
    expect(await probeVersion(fake({}), ['nope', '--version'])).toBeNull();
    expect(await probeVersion(fake({ 'x --version': new Error('ENOENT') }), ['x', '--version'])).toBeNull();
  });
  it('applies a custom regex', async () => { expect(await probeVersion(fake({ 'go version': 'go version go1.27.0 linux/amd64' }), ['go', 'version'], 'go(\\d+\\.\\d+\\.\\d+)')).toBe('1.27.0'); });
});
```

`test/detect/agents.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectClaude, detectCodex } from '../../src/detect/agents.js';
import { makeTestCtx } from '../helpers/ctx.js';
describe('detectClaude', () => {
  it('parses plugin list, marketplaces, mcp and settings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); mkdirSync(join(dir, 'plugins'), { recursive: true });
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'a@m': true }, statusLine: { type: 'command', command: 'x' } }));
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { fli: { type: 'stdio', command: 'fli-mcp' } } }));
    writeFileSync(join(dir, 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'claude-plugins-official': {}, caveman: {} }));
    const ctx = makeTestCtx({ env: { CLAUDE_CONFIG_DIR: dir }, responses: { 'claude --version': '2.1.274 (Claude Code)', 'claude plugin list --json': JSON.stringify([{ id: 'superpowers@claude-plugins-official', version: '6.3.0', scope: 'user', enabled: true }]) } });
    const s = await detectClaude(ctx);
    expect(s).toMatchObject({ installed: true, version: '2.1.274', marketplaces: ['claude-plugins-official', 'caveman'] });
    expect(s.plugins[0]).toMatchObject({ id: 'superpowers@claude-plugins-official', version: '6.3.0' });
    expect(s.mcp).toHaveProperty('fli'); expect(s.settings).toHaveProperty('statusLine');
  });
  it('reports not installed when claude is missing', async () => {
    const ctx = makeTestCtx({ responses: {} });
    expect((await detectClaude(ctx)).installed).toBe(false);
  });
});
describe('detectCodex', () => {
  it('parses config.toml, plugin list and mcp list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-'));
    writeFileSync(join(dir, 'config.toml'), 'model = "gpt-5.6-sol"\n[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]\n[marketplaces.caveman]\nsource_type = "git"\n');
    const ctx = makeTestCtx({ env: { CODEX_HOME: dir }, responses: { 'codex --version': 'codex-cli 0.154.0', 'codex plugin list --json': JSON.stringify({ installed: [{ pluginId: 'superpowers@openai-curated-remote', version: '6.3.0' }], available: [] }), 'codex mcp list --json': JSON.stringify([{ name: 'context7', transport: { type: 'stdio', command: 'npx' } }]) } });
    const s = await detectCodex(ctx);
    expect(s).toMatchObject({ installed: true, version: '0.154.0', marketplaces: ['caveman'] });
    expect(s.plugins[0]).toMatchObject({ id: 'superpowers@openai-curated-remote', version: '6.3.0' });
    expect(s.mcp.context7).toMatchObject({ command: 'npx' }); expect(s.config.model).toBe('gpt-5.6-sol');
  });
});
```

`test/helpers/ctx.ts` (shared test helper, created here):
```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Ctx, HostInfo, Manifest, Runner } from '../../src/types.js';
import { resolvePaths } from '../../src/config/paths.js';
import { createLogger } from '../../src/ui/log.js';
export interface FakeOpts { responses?: Record<string, string | { code: number; stdout?: string; stderr?: string }>; env?: Record<string, string>; host?: Partial<HostInfo>; dryRun?: boolean; manifest?: Manifest; fetch?: typeof fetch; secrets?: Record<string, string> }
export function makeTestCtx(o: FakeOpts = {}): Ctx & { calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (argv, opts = {}) => {
    calls.push(argv); const key = argv.join(' '); const r = o.responses?.[key];
    // unknown read-only probes behave like a missing command (127); unknown mutating commands succeed silently so providers can be tested without listing every side-effect command
    if (r === undefined) return opts.readOnly ? { code: 127, stdout: '', stderr: `no fake response for: ${key}`, skipped: false } : { code: 0, stdout: '', stderr: '', skipped: false };
    const res = typeof r === 'string' ? { code: 0, stdout: r, stderr: '', skipped: false } : { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '', skipped: false };
    if (res.code !== 0 && !opts.allowFailure) throw new Error(`${key} failed with exit ${res.code}`);
    return res;
  };
  const home = mkdtempSync(join(tmpdir(), 'sai-home-'));
  const host: HostInfo = { platform: 'linux', arch: 'x64', isRoot: false, hasSudo: true, pkgManager: 'apt', isWsl: false, isProxmoxHost: false, isLxc: false, isNixOS: false, isMusl: false, hasAvx: true, hasBwrap: true, home, diskFreeMb: 100000, claudeRunning: false, windowsDeveloperMode: null, osRelease: { ID: 'ubuntu' }, ...o.host };
  const env = { ...o.env };
  return { calls, host, paths: resolvePaths(host, env), run, log: createLogger({ quiet: true }), dryRun: o.dryRun ?? false, yes: true, noAudit: false, channel: 'latest', secrets: new Map(Object.entries(o.secrets ?? {})), fetch: o.fetch ?? (globalThis.fetch as typeof fetch), env, manifest: o.manifest ?? { version: 1, profiles: {}, components: [] } };
}
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/detect/tools.test.ts test/detect/agents.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/detect/tools.ts`:
```ts
import { normalizeVersion } from '../version/compare.js';
import type { Runner } from '../types.js';
export async function probeVersion(run: Runner, argv: string[], regex?: string): Promise<string | null> {
  try {
    const r = await run(argv, { readOnly: true, allowFailure: true, timeoutMs: 15000 });
    if (r.code !== 0) return null;
    const text = `${r.stdout}\n${r.stderr}`;
    if (regex) { const m = new RegExp(regex).exec(text); return m ? (m[1] ?? m[0]) : null; }
    return normalizeVersion(text);
  } catch { return null; }
}
```

`src/detect/agents.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { Ctx } from '../types.js';
import { probeVersion } from './tools.js';
export interface ClaudeState { installed: boolean; version: string | null; plugins: Array<{ id: string; version: string; scope: string; enabled: boolean }>; marketplaces: string[]; mcp: Record<string, unknown>; settings: Record<string, unknown> }
export interface CodexState { installed: boolean; version: string | null; plugins: Array<{ id: string; version: string | null }>; marketplaces: string[]; mcp: Record<string, Record<string, unknown>>; config: Record<string, unknown> }
async function readJson(p: string): Promise<Record<string, unknown>> { try { return JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>; } catch { return {}; } }
function lastJsonLine(s: string): unknown { const lines = s.trim().split('\n').filter((l) => l.trim().startsWith('{') || l.trim().startsWith('[')); const last = lines.pop(); if (!last) return null; try { return JSON.parse(last); } catch { return null; } }
export async function detectClaude(ctx: Ctx): Promise<ClaudeState> {
  const version = await probeVersion(ctx.run, ['claude', '--version']);
  const settings = await readJson(ctx.paths.claudeSettings);
  const claudeJson = await readJson(ctx.paths.claudeJson);
  const known = await readJson(join(ctx.paths.claudeConfigDir, 'plugins', 'known_marketplaces.json'));
  let plugins: ClaudeState['plugins'] = [];
  if (version) { const r = await ctx.run(['claude', 'plugin', 'list', '--json'], { readOnly: true, allowFailure: true, timeoutMs: 60000 }); const j = lastJsonLine(r.stdout); if (Array.isArray(j)) plugins = j as ClaudeState['plugins']; }
  return { installed: !!version, version, plugins, marketplaces: Object.keys(known), mcp: (claudeJson.mcpServers as Record<string, unknown>) ?? {}, settings };
}
export async function detectCodex(ctx: Ctx): Promise<CodexState> {
  const version = await probeVersion(ctx.run, ['codex', '--version']);
  let config: Record<string, unknown> = {};
  try { config = parseToml(await readFile(ctx.paths.codexConfig, 'utf8')) as Record<string, unknown>; } catch { config = {}; }
  let plugins: CodexState['plugins'] = []; let mcp: CodexState['mcp'] = {};
  if (version) {
    const p = await ctx.run(['codex', 'plugin', 'list', '--json'], { readOnly: true, allowFailure: true, timeoutMs: 60000 }); const pj = lastJsonLine(p.stdout) as { installed?: Array<{ pluginId: string; version?: string }> } | null;
    plugins = (pj?.installed ?? []).map((x) => ({ id: x.pluginId, version: x.version ?? null }));
    const m = await ctx.run(['codex', 'mcp', 'list', '--json'], { readOnly: true, allowFailure: true, timeoutMs: 60000 }); const mj = lastJsonLine(m.stdout);
    if (Array.isArray(mj)) for (const s of mj as Array<{ name: string }>) mcp[s.name] = ((config.mcp_servers as Record<string, Record<string, unknown>>) ?? {})[s.name] ?? {};
  }
  if (!Object.keys(mcp).length) mcp = (config.mcp_servers as CodexState['mcp']) ?? {};
  return { installed: !!version, version, plugins, marketplaces: Object.keys((config.marketplaces as Record<string, unknown>) ?? {}), mcp, config };
}
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/detect`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/detect test/detect test/helpers
git commit -m "feat(detect): tool version probes and Claude/Codex state detection"
```

---

### Task 7: JSON config writes and Claude settings merge

**Files:**
- Create: `src/config/json.ts`
- Test: `test/config/json.test.ts`

**Interfaces:**
- Produces: `readJsonFile<T>(path): Promise<T | null>`, `backupFile(path, backupsDir): Promise<string | null>`, `writeJsonAtomic(path, value, opts?: { mode?: number }): Promise<void>` (preserves existing mode, defaults 0o600, LF, trailing newline), `mergeClaudeSettings(existing, patch): Record<string, unknown>` (deep merge objects; arrays replaced except `hooks.<Event>` which are concatenated and deduped by `JSON.stringify` of each handler; `null` in patch deletes a key).

- [ ] **Step 1: Write failing tests**

`test/config/json.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, statSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { readJsonFile, backupFile, writeJsonAtomic, mergeClaudeSettings } from '../../src/config/json.js';
describe('json config', () => {
  it('backs up then writes atomically preserving mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const f = join(dir, 'settings.json'); writeFileSync(f, '{"a":1}'); chmodSync(f, 0o600);
    const b = await backupFile(f, join(dir, 'backups'));
    expect(b && readFileSync(b, 'utf8')).toBe('{"a":1}');
    await writeJsonAtomic(f, { a: 2 });
    expect(readFileSync(f, 'utf8')).toBe('{\n  "a": 2\n}\n');
    if (platform() !== 'win32') expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).filter((n) => n.startsWith('.settings.json.'))).toHaveLength(0);
  });
  it('returns null for missing or invalid json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); expect(await readJsonFile(join(dir, 'x.json'))).toBeNull();
    writeFileSync(join(dir, 'bad.json'), '{'); expect(await readJsonFile(join(dir, 'bad.json'))).toBeNull();
  });
  it('backup of a missing file returns null', async () => { expect(await backupFile('/nonexistent/x.json', tmpdir())).toBeNull(); });
});
describe('mergeClaudeSettings', () => {
  const hook = (cmd: string) => ({ hooks: [{ type: 'command', command: cmd }] });
  it('deep merges, dedupes hooks, deletes on null', () => {
    const existing = { model: 'opus', env: { A: '1' }, hooks: { PreToolUse: [hook('x')] }, statusLine: { type: 'command', command: 'old' } };
    const out = mergeClaudeSettings(existing, { env: { B: '2' }, hooks: { PreToolUse: [hook('x'), hook('y')], Stop: [hook('z')] }, statusLine: null, autoUpdatesChannel: 'latest' });
    expect(out).toEqual({ model: 'opus', env: { A: '1', B: '2' }, hooks: { PreToolUse: [hook('x'), hook('y')], Stop: [hook('z')] }, autoUpdatesChannel: 'latest' });
  });
  it('replaces non-hook arrays and is idempotent', () => {
    const a = mergeClaudeSettings({ permissions: { allow: ['a'] } }, { permissions: { allow: ['b'] } });
    expect(a).toEqual({ permissions: { allow: ['b'] } });
    const once = mergeClaudeSettings({}, { hooks: { Stop: [hook('z')] } }); expect(mergeClaudeSettings(once, { hooks: { Stop: [hook('z')] } })).toEqual(once);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/config/json.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/config/json.ts`:
```ts
import { readFile, writeFile, rename, mkdir, copyFile, stat, chmod, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
export async function readJsonFile<T = Record<string, unknown>>(path: string): Promise<T | null> { try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return null; } }
export async function backupFile(path: string, backupsDir: string): Promise<string | null> {
  try { await stat(path); } catch { return null; }
  await mkdir(backupsDir, { recursive: true });
  const dest = join(backupsDir, `${basename(path)}.${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await copyFile(path, dest); return dest;
}
export async function writeJsonAtomic(path: string, value: unknown, opts: { mode?: number } = {}): Promise<void> {
  let mode = opts.mode ?? 0o600; try { mode = (await stat(path)).mode & 0o777; } catch { /* new file */ }
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try { await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode }); if (process.platform !== 'win32') await chmod(tmp, mode); await rename(tmp, path); }
  catch (e) { try { await unlink(tmp); } catch { /* ignore */ } throw e; }
}
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
export function mergeClaudeSettings(existing: Obj, patch: Obj): Obj {
  const out: Obj = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) { delete out[k]; continue; }
    if (k === 'hooks' && isObj(v)) {
      const hooks: Obj = { ...(isObj(out.hooks) ? out.hooks : {}) };
      for (const [event, handlers] of Object.entries(v)) {
        const cur = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []; const seen = new Set(cur.map((h) => JSON.stringify(h)));
        for (const h of (Array.isArray(handlers) ? handlers : [])) { const key = JSON.stringify(h); if (!seen.has(key)) { cur.push(h); seen.add(key); } }
        hooks[event] = cur;
      }
      out.hooks = hooks; continue;
    }
    out[k] = isObj(v) && isObj(out[k]) ? mergeClaudeSettings(out[k] as Obj, v) : v;
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/config/json.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config/json.ts test/config/json.test.ts
git commit -m "feat(config): atomic JSON writes with backups and hook-aware settings merge"
```

---

### Task 8: Marker blocks and TOML helpers

**Files:**
- Create: `src/config/markers.ts`, `src/config/toml.ts`
- Test: `test/config/markers.test.ts`, `test/config/toml.test.ts`

**Interfaces:**
- Produces: `MARKER_STYLES = { hash: { start: '# >>> super-agent-installer >>>', end: '# <<< super-agent-installer <<<' }, html: { start: '<!-- super-agent-installer:start -->', end: '<!-- super-agent-installer:end -->' } }`; `setMarkerBlock(text: string, block: string, style: 'hash'|'html'): string` (inserts at end with a blank line, or replaces the existing block; throws `MarkerError` on half markers); `removeMarkerBlock(text, style): string`; `readToml(path): Promise<Record<string,unknown>>` (empty object when missing; throws `TomlError` when unparsable); `tomlTableEquals(a, b): boolean`; `writeTomlMarkerBlock(path, keys: Record<string, unknown>, backupsDir): Promise<{ changed: boolean }>` (serializes `keys` with smol-toml `stringify`, places inside the hash marker block, validates the whole file parses, atomic write).

- [ ] **Step 1: Write failing tests**

`test/config/markers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { setMarkerBlock, removeMarkerBlock, MarkerError, MARKER_STYLES } from '../../src/config/markers.js';
describe('marker blocks', () => {
  it('appends a block to text without one', () => {
    const out = setMarkerBlock('user line\n', 'managed', 'html');
    expect(out).toBe(`user line\n\n${MARKER_STYLES.html.start}\nmanaged\n${MARKER_STYLES.html.end}\n`);
  });
  it('replaces an existing block and keeps surrounding text', () => {
    const t = `a\n${MARKER_STYLES.hash.start}\nold\n${MARKER_STYLES.hash.end}\nb\n`;
    expect(setMarkerBlock(t, 'new', 'hash')).toBe(`a\n${MARKER_STYLES.hash.start}\nnew\n${MARKER_STYLES.hash.end}\nb\n`);
    expect(setMarkerBlock(setMarkerBlock(t, 'new', 'hash'), 'new', 'hash')).toBe(setMarkerBlock(t, 'new', 'hash'));
  });
  it('removes a block', () => { expect(removeMarkerBlock(`a\n${MARKER_STYLES.hash.start}\nx\n${MARKER_STYLES.hash.end}\nb\n`, 'hash')).toBe('a\nb\n'); });
  it('throws on half markers', () => { expect(() => setMarkerBlock(`${MARKER_STYLES.hash.start}\nx\n`, 'y', 'hash')).toThrow(MarkerError); });
  it('handles CRLF input by normalizing to LF', () => { expect(setMarkerBlock('a\r\n', 'x', 'html')).not.toContain('\r'); });
});
```

`test/config/toml.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readToml, writeTomlMarkerBlock, tomlTableEquals, TomlError } from '../../src/config/toml.js';
describe('toml', () => {
  it('reads missing file as empty and throws on invalid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-'));
    expect(await readToml(join(dir, 'none.toml'))).toEqual({});
    writeFileSync(join(dir, 'bad.toml'), '[a\n'); await expect(readToml(join(dir, 'bad.toml'))).rejects.toThrow(TomlError);
  });
  it('writes a marker block of top-level keys and keeps user content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const f = join(dir, 'config.toml');
    writeFileSync(f, 'model = "gpt-5.6-sol"\n# user comment\n[projects."/home/u"]\ntrust_level = "trusted"\n');
    const r1 = await writeTomlMarkerBlock(f, { features: { memories: true } }, join(dir, 'b'));
    expect(r1.changed).toBe(true);
    const text = readFileSync(f, 'utf8');
    expect(text).toContain('# user comment'); expect(text).toContain('# >>> super-agent-installer >>>'); expect(text).toContain('[features]\nmemories = true');
    expect((await readToml(f)) as { features: { memories: boolean } }).toMatchObject({ features: { memories: true }, model: 'gpt-5.6-sol' });
    const r2 = await writeTomlMarkerBlock(f, { features: { memories: true } }, join(dir, 'b')); expect(r2.changed).toBe(false);
  });
  it('refuses to write when the result does not parse', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const f = join(dir, 'c.toml'); writeFileSync(f, '[features]\nmemories = false\n');
    await expect(writeTomlMarkerBlock(f, { features: { memories: true } }, join(dir, 'b'))).rejects.toThrow(/duplicate|redefine|parse/i);
    expect(readFileSync(f, 'utf8')).toBe('[features]\nmemories = false\n');
  });
  it('compares tables ignoring key order', () => { expect(tomlTableEquals({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true); expect(tomlTableEquals({ a: 1 }, { a: 2 })).toBe(false); });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/config/markers.test.ts test/config/toml.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/config/markers.ts`:
```ts
export const MARKER_STYLES = { hash: { start: '# >>> super-agent-installer >>>', end: '# <<< super-agent-installer <<<' }, html: { start: '<!-- super-agent-installer:start -->', end: '<!-- super-agent-installer:end -->' } } as const;
export type MarkerStyle = keyof typeof MARKER_STYLES;
export class MarkerError extends Error {}
function locate(lines: string[], style: MarkerStyle): { s: number; e: number } | null {
  const { start, end } = MARKER_STYLES[style]; const s = lines.indexOf(start); const e = lines.indexOf(end);
  if (s === -1 && e === -1) return null;
  if (s === -1 || e === -1 || e < s) throw new MarkerError(`half or misordered marker block (${start} / ${end}); fix the file manually`);
  if (lines.indexOf(start, s + 1) !== -1 || lines.indexOf(end, e + 1) !== -1) throw new MarkerError('more than one marker block found; fix the file manually');
  return { s, e };
}
export function setMarkerBlock(text: string, block: string, style: MarkerStyle): string {
  const { start, end } = MARKER_STYLES[style]; const lines = text.replace(/\r\n/g, '\n').split('\n'); if (lines[lines.length - 1] === '') lines.pop();
  const body = [start, ...block.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'), end];
  const loc = locate(lines, style);
  const out = loc ? [...lines.slice(0, loc.s), ...body, ...lines.slice(loc.e + 1)] : [...lines, ...(lines.length ? [''] : []), ...body];
  return out.join('\n') + '\n';
}
export function removeMarkerBlock(text: string, style: MarkerStyle): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n'); if (lines[lines.length - 1] === '') lines.pop();
  const loc = locate(lines, style); if (!loc) return lines.join('\n') + (lines.length ? '\n' : '');
  const start = loc.s > 0 && lines[loc.s - 1] === '' ? loc.s - 1 : loc.s; // also drop the blank separator line we inserted
  const out = [...lines.slice(0, start), ...lines.slice(loc.e + 1)]; return out.join('\n') + (out.length ? '\n' : '');
}
```

`src/config/toml.ts`:
```ts
import { readFile, writeFile, rename, mkdir, stat, chmod, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { parse, stringify } from 'smol-toml';
import { setMarkerBlock } from './markers.js';
import { backupFile } from './json.js';
export class TomlError extends Error {}
export async function readToml(path: string): Promise<Record<string, unknown>> {
  let text: string; try { text = await readFile(path, 'utf8'); } catch { return {}; }
  try { return parse(text) as Record<string, unknown>; } catch (e) { throw new TomlError(`cannot parse ${path}: ${(e as Error).message}`); }
}
export function tomlTableEquals(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => (Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, val]) => [k, norm(val)])) : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}
export async function writeTomlMarkerBlock(path: string, keys: Record<string, unknown>, backupsDir: string): Promise<{ changed: boolean }> {
  let text = ''; try { text = await readFile(path, 'utf8'); } catch { text = ''; }
  const next = setMarkerBlock(text, stringify(keys).trim(), 'hash');
  if (next === text.replace(/\r\n/g, '\n')) return { changed: false };
  try { parse(next); } catch (e) { throw new TomlError(`refusing to write ${path}: merged file does not parse (${(e as Error).message}). A key inside the managed block probably duplicates one outside it.`); }
  await backupFile(path, backupsDir);
  let mode = 0o600; try { mode = (await stat(path)).mode & 0o777; } catch { /* new */ }
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try { await writeFile(tmp, next, { encoding: 'utf8', mode }); if (process.platform !== 'win32') await chmod(tmp, mode); await rename(tmp, path); } catch (e) { try { await unlink(tmp); } catch { /* ignore */ } throw e; }
  return { changed: true };
}
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/config`
Expected: PASS. (If `smol-toml` throws a different message for the duplicate-table case, adjust the regex in the test to match the actual message; do not weaken the refusal.)

- [ ] **Step 5: Commit**

```bash
git add src/config/markers.ts src/config/toml.ts test/config/markers.test.ts test/config/toml.test.ts
git commit -m "feat(config): marker blocks for TOML/markdown and safe TOML block writes"
```

### Task 9: Selection resolver (profiles, platform, flags, slots, prerequisites, token totals)

**Files:**
- Create: `src/manifest/resolve.ts`
- Test: `test/manifest/resolve.test.ts`

**Interfaces:**
- Produces: `resolveSelection(manifest, host, opts: { profile: ProfileName | 'saved'; savedIds?: string[]; only?: string[]; skip?: string[]; picked?: string[] }): Selection`; `slotConflicts(components): Array<{ slot: Slot; ids: string[] }>`; `closure(manifest, ids): string[]` (adds `prerequisites` and `dependsOn` transitively, in dependency order).
- Rules: `profile.base === 'all'` starts from components with `defaultSelected && !forceOffInAll`; `base === 'none'` starts empty; then `include` adds, `exclude` removes; `component.profiles[profile]` overrides (`true` adds, `false` removes); `agentFilter` keeps only `agents === filter || 'both'`; platform filter removes components whose `platforms` exclude `host.platform` (recorded in `excluded` with reason `platform`); `only` replaces the set (after closure); `skip` removes; `picked` (from the interactive picker) replaces the set; `conflictsWith` pairs: keep the one that appears first in `picked`/`only`/profile order and exclude the other (reason `conflict:<id>`); slot conflicts are NOT auto-resolved here (returned by `slotConflicts` for the picker; in non-interactive mode `resolveSelection` keeps the first per slot and excludes the rest with reason `slot:<slot>`); prerequisites/dependsOn closure always applied last; token totals sum `contextCostTokens` per agent for components whose `agents` include that agent; `codexMcpCount` counts `kind === 'mcp' && spec.target === 'codex'`.

- [ ] **Step 1: Write failing tests**

`test/manifest/resolve.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveSelection, slotConflicts, closure } from '../../src/manifest/resolve.js';
import type { Component, Manifest, HostInfo } from '../../src/types.js';
const c = (id: string, over: Partial<Component> = {}): Component => ({ id, name: id, kind: 'claude-plugin', agents: 'claude', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'optional', defaultSelected: true, spec: { kind: 'claude-plugin', marketplace: 'm', plugin: id }, ...over });
const host = { platform: 'linux' } as HostInfo;
const manifest: Manifest = { version: 1, profiles: {
  all: { description: '', base: 'all' }, minimal: { description: '', base: 'none', include: ['node', 'superpowers'] },
  'claude-only': { description: '', base: 'all', agentFilter: 'claude' }, work: { description: '', base: 'all', exclude: ['proxy'] },
  homelab: { description: '', base: 'all', include: ['ha'] }, 'proxmox-host': { description: '', base: 'none', include: ['superpowers'] }, 'codex-only': { description: '', base: 'all', agentFilter: 'codex' },
}, components: [
  c('node', { kind: 'tool', agents: 'both', spec: { kind: 'tool', probe: ['node', '--version'], packages: {} }, contextCostTokens: {} }),
  c('superpowers', { prerequisites: ['node'], contextCostTokens: { claude: 693 }, slot: 'methodology' }),
  c('compound', { defaultSelected: false, slot: 'methodology', contextCostTokens: { claude: 3000 } }),
  c('caveman-sl', { kind: 'statusline', spec: { kind: 'statusline', provider: 'caveman' }, slot: 'statusline', dependsOn: ['superpowers'] }),
  c('hud', { kind: 'statusline', spec: { kind: 'statusline', provider: 'claude-hud' }, slot: 'statusline', defaultSelected: false }),
  c('proxy', { forceOffInAll: true }),
  c('ha', { kind: 'mcp', agents: 'both', defaultSelected: false, spec: { kind: 'mcp', target: 'codex', name: 'ha', transport: 'http', url: 'https://x' } }),
  c('exa', { kind: 'mcp', agents: 'codex', spec: { kind: 'mcp', target: 'codex', name: 'exa', transport: 'http', url: 'https://x' }, contextCostTokens: { codex: 200 } }),
  c('win-only', { platforms: ['windows'] }),
  c('a1', { conflictsWith: ['a2'] }), c('a2', { conflictsWith: ['a1'] }),
] };
const ids = (s: ReturnType<typeof resolveSelection>) => s.components.map((x) => x.id);
describe('resolveSelection', () => {
  it('profile all: defaultSelected minus forceOff, platform filtered, first-of-conflict kept', () => {
    const s = resolveSelection(manifest, host, { profile: 'all' });
    expect(ids(s)).toEqual(['node', 'superpowers', 'caveman-sl', 'exa', 'a1']);
    expect(s.excluded).toEqual(expect.arrayContaining([{ id: 'proxy', reason: 'forceOffInAll' }, { id: 'win-only', reason: 'platform' }, { id: 'a2', reason: 'conflict:a1' }]));
    expect(s.tokenTotals).toEqual({ claude: 693, codex: 200 }); expect(s.codexMcpCount).toBe(1);
  });
  it('minimal uses include list plus closure in dependency order', () => { expect(ids(resolveSelection(manifest, host, { profile: 'minimal' }))).toEqual(['node', 'superpowers']); });
  it('agent filters and homelab include', () => {
    expect(ids(resolveSelection(manifest, host, { profile: 'codex-only' }))).toEqual(['node', 'exa']);
    expect(ids(resolveSelection(manifest, host, { profile: 'homelab' }))).toContain('ha');
    expect(ids(resolveSelection(manifest, host, { profile: 'work' }))).not.toContain('proxy');
  });
  it('only/skip/picked and slot conflict handling', () => {
    expect(ids(resolveSelection(manifest, host, { profile: 'all', only: ['caveman-sl'] }))).toEqual(['node', 'superpowers', 'caveman-sl']);
    expect(ids(resolveSelection(manifest, host, { profile: 'all', skip: ['exa'] }))).not.toContain('exa');
    const s = resolveSelection(manifest, host, { profile: 'all', picked: ['hud', 'caveman-sl', 'compound', 'superpowers'] });
    expect(ids(s)).toEqual(['hud', 'node', 'superpowers']);
    expect(s.excluded).toEqual(expect.arrayContaining([{ id: 'caveman-sl', reason: 'slot:statusline' }, { id: 'compound', reason: 'slot:methodology' }]));
  });
  it('saved profile replays ids', () => { expect(ids(resolveSelection(manifest, host, { profile: 'saved', savedIds: ['exa'] }))).toEqual(['exa']); });
  it('slotConflicts and closure helpers', () => {
    expect(slotConflicts(manifest.components.filter((x) => ['caveman-sl', 'hud', 'superpowers'].includes(x.id)))).toEqual([{ slot: 'statusline', ids: ['caveman-sl', 'hud'] }]);
    expect(closure(manifest, ['caveman-sl'])).toEqual(['node', 'superpowers', 'caveman-sl']);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/manifest/resolve.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/manifest/resolve.ts`:
```ts
import type { Component, HostInfo, Manifest, ProfileName, Selection, Slot } from '../types.js';
export interface ResolveOpts { profile: ProfileName | 'saved'; savedIds?: string[]; only?: string[]; skip?: string[]; picked?: string[] }
export function closure(manifest: Manifest, ids: string[]): string[] {
  const byId = new Map(manifest.components.map((c) => [c.id, c])); const out: string[] = []; const seen = new Set<string>();
  const visit = (id: string) => { if (seen.has(id)) return; seen.add(id); const c = byId.get(id); if (!c) return; for (const d of [...(c.prerequisites ?? []), ...(c.dependsOn ?? [])]) visit(d); out.push(id); };
  for (const id of ids) visit(id); return out;
}
export function slotConflicts(components: Component[]): Array<{ slot: Slot; ids: string[] }> {
  const m = new Map<Slot, string[]>(); for (const c of components) if (c.slot) m.set(c.slot, [...(m.get(c.slot) ?? []), c.id]);
  return [...m.entries()].filter(([, ids]) => ids.length > 1).map(([slot, ids]) => ({ slot, ids }));
}
export function resolveSelection(manifest: Manifest, host: HostInfo, o: ResolveOpts): Selection {
  const byId = new Map(manifest.components.map((c) => [c.id, c])); const excluded: Selection['excluded'] = [];
  const order = manifest.components.map((c) => c.id);
  let ids: string[];
  if (o.picked) ids = [...o.picked];
  else if (o.profile === 'saved') ids = [...(o.savedIds ?? [])];
  else {
    const p = manifest.profiles[o.profile] ?? { description: '', base: 'all' as const };
    const set = new Set<string>(p.base === 'all' ? manifest.components.filter((c) => c.defaultSelected && !c.forceOffInAll).map((c) => c.id) : []);
    if (p.base === 'all') for (const c of manifest.components) if (c.forceOffInAll && c.defaultSelected) excluded.push({ id: c.id, reason: 'forceOffInAll' });
    for (const id of p.include ?? []) set.add(id); for (const id of p.exclude ?? []) set.delete(id);
    for (const c of manifest.components) { const ov = c.profiles?.[o.profile as ProfileName]; if (ov === true) set.add(c.id); if (ov === false) set.delete(c.id); }
    if (p.agentFilter) for (const id of [...set]) { const c = byId.get(id); if (c && c.agents !== 'both' && c.agents !== p.agentFilter) set.delete(id); }
    ids = order.filter((id) => set.has(id));
  }
  if (o.only) ids = o.only.filter((id) => byId.has(id));
  if (o.skip) ids = ids.filter((id) => !o.skip!.includes(id));
  ids = closure(manifest, ids);
  const keep: string[] = [];
  for (const id of ids) { const c = byId.get(id); if (!c) continue; if (!c.platforms.includes(host.platform)) { excluded.push({ id, reason: 'platform' }); continue; } keep.push(id); }
  const final: string[] = [];
  for (const id of keep) { const c = byId.get(id)!; const winner = (c.conflictsWith ?? []).find((x) => final.includes(x)); if (winner) { excluded.push({ id, reason: `conflict:${winner}` }); continue; } final.push(id); }
  const slotSeen = new Map<Slot, string>(); const afterSlots: string[] = [];
  for (const id of final) { const c = byId.get(id)!; if (c.slot) { const w = slotSeen.get(c.slot); if (w) { excluded.push({ id, reason: `slot:${c.slot}` }); continue; } slotSeen.set(c.slot, id); } afterSlots.push(id); }
  const ordered = closure(manifest, afterSlots).filter((id) => afterSlots.includes(id) || !excluded.some((e) => e.id === id));
  const components = ordered.map((id) => byId.get(id)!).filter((c) => c.platforms.includes(host.platform));
  const tok = { claude: 0, codex: 0 };
  for (const c of components) { if (c.agents !== 'codex') tok.claude += c.contextCostTokens?.claude ?? 0; if (c.agents !== 'claude') tok.codex += c.contextCostTokens?.codex ?? 0; }
  return { profile: o.profile, components, excluded, tokenTotals: tok, codexMcpCount: components.filter((c) => c.kind === 'mcp' && c.spec.kind === 'mcp' && c.spec.target === 'codex').length };
}
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/manifest/resolve.test.ts`
Expected: PASS (6 tests). If an ordering assertion differs only by order of independent items, keep manifest order as the tiebreak (the implementation above uses `closure` over the manifest-ordered list, which yields dependency-first then manifest order).

- [ ] **Step 5: Commit**

```bash
git add src/manifest/resolve.ts test/manifest/resolve.test.ts
git commit -m "feat(manifest): selection resolver with profiles, platform filter, conflicts, slots and closure"
```

---

### Task 10: skills.sh audit client

**Files:**
- Create: `src/audit/skills-audit.ts`
- Test: `test/audit/skills-audit.test.ts`

**Interfaces:**
- Produces: `auditSkill(fetchFn, owner, repo, skill): Promise<AuditResult>` with `AuditResult = { level: 'pass' | 'warn' | 'fail' | 'unknown'; scanners: Record<string, string>; riskLevel?: string }`; `auditVerdict(results: AuditResult[]): 'pass'|'warn'|'fail'|'unknown'`. Endpoint: `https://skills.sh/api/v1/skills/audit/{owner}/{repo}/{skill}`. Mapping: any of `gen`, `socket`, `snyk` equal to `fail` -> `fail`; any scanner `warn`/`fail` from `runlayer`/`zeroleaks` or any `warn` -> `warn`; all `pass`/`none` -> `pass`; HTTP error, timeout (5 s) or empty object -> `unknown`.

- [ ] **Step 1: Write failing tests**

`test/audit/skills-audit.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { auditSkill, auditVerdict } from '../../src/audit/skills-audit.js';
const mk = (body: unknown, status = 200) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
describe('auditSkill', () => {
  it('maps scanner statuses', async () => {
    expect((await auditSkill(mk({ gen: { status: 'pass' }, socket: { status: 'pass' }, snyk: { status: 'warn', riskLevel: 'MEDIUM' }, runlayer: { status: 'none' }, zeroleaks: { status: 'none' } }), 'a', 'b', 'c')).level).toBe('warn');
    expect((await auditSkill(mk({ gen: { status: 'fail' } }), 'a', 'b', 'c')).level).toBe('fail');
    expect((await auditSkill(mk({ gen: { status: 'pass' }, runlayer: { status: 'fail', riskLevel: 'HIGH' } }), 'a', 'b', 'c')).level).toBe('warn');
    expect((await auditSkill(mk({ gen: { status: 'pass' }, socket: { status: 'pass' }, snyk: { status: 'pass' } }), 'a', 'b', 'c')).level).toBe('pass');
  });
  it('returns unknown on errors or empty', async () => {
    expect((await auditSkill(mk({}), 'a', 'b', 'c')).level).toBe('unknown');
    expect((await auditSkill(mk('x', 500), 'a', 'b', 'c')).level).toBe('unknown');
    expect((await auditSkill((async () => { throw new Error('net'); }) as unknown as typeof fetch, 'a', 'b', 'c')).level).toBe('unknown');
  });
  it('combines verdicts', () => { expect(auditVerdict([{ level: 'pass', scanners: {} }, { level: 'warn', scanners: {} }])).toBe('warn'); expect(auditVerdict([{ level: 'fail', scanners: {} }, { level: 'pass', scanners: {} }])).toBe('fail'); expect(auditVerdict([])).toBe('unknown'); });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/audit`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/audit/skills-audit.ts`:
```ts
export interface AuditResult { level: 'pass' | 'warn' | 'fail' | 'unknown'; scanners: Record<string, string>; riskLevel?: string }
const BLOCKING = ['gen', 'socket', 'snyk'];
export async function auditSkill(f: typeof fetch, owner: string, repo: string, skill: string): Promise<AuditResult> {
  try {
    const r = await f(`https://skills.sh/api/v1/skills/audit/${owner}/${repo}/${skill}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { level: 'unknown', scanners: {} };
    const j = (await r.json()) as Record<string, { status?: string; riskLevel?: string }>;
    const scanners: Record<string, string> = {}; let riskLevel: string | undefined; let level: AuditResult['level'] = 'pass';
    for (const [name, v] of Object.entries(j)) { if (!v || typeof v !== 'object') continue; const s = String(v.status ?? 'none').toLowerCase(); scanners[name] = s; if (v.riskLevel) riskLevel = v.riskLevel; if (s === 'fail' && BLOCKING.includes(name.toLowerCase())) level = 'fail'; else if ((s === 'fail' || s === 'warn') && level !== 'fail') level = 'warn'; }
    if (!Object.keys(scanners).length) return { level: 'unknown', scanners };
    return { level, scanners, riskLevel };
  } catch { return { level: 'unknown', scanners: {} }; }
}
export function auditVerdict(results: AuditResult[]): AuditResult['level'] {
  if (!results.length) return 'unknown'; if (results.some((r) => r.level === 'fail')) return 'fail'; if (results.some((r) => r.level === 'warn')) return 'warn'; if (results.every((r) => r.level === 'pass')) return 'pass'; return 'unknown';
}
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/audit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audit test/audit
git commit -m "feat(audit): skills.sh audit client with blocking/warn mapping"
```

---

### Task 11: Provider interface helpers, registry, planner

**Files:**
- Create: `src/providers/types.ts`, `src/providers/registry.ts`, `src/planner.ts`
- Test: `test/planner.test.ts`

**Interfaces:**
- Produces: `action(componentId, op, description, run, extra?)` helper returning `Action` with `id = `${componentId}:${op}:${n}``; `skipAction(componentId, reason)`; `registerProvider(p: Provider)`, `getProvider(kind): Provider` (throws if missing); `buildPlan(selection, ctx, mode): Promise<Plan>` with `Plan = { actions: Action[]; detections: Record<string, Installed | null> }`. Order: kinds in `KIND_ORDER = ['tool','agent','setting','claude-plugin','codex-plugin','mcp','skill','hook','statusline','instructions']` for install/update; reversed for uninstall (agents last). Within a kind, selection order (already dependency-ordered). A provider's `plan` returning `[]` means nothing to do; planner adds a `skip` action so summaries show it.

- [ ] **Step 1: Write failing tests**

`test/planner.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildPlan, KIND_ORDER } from '../src/planner.js';
import { registerProvider, getProvider, clearProviders } from '../src/providers/registry.js';
import { action } from '../src/providers/types.js';
import { makeTestCtx } from './helpers/ctx.js';
import type { Component, Provider, Selection } from '../src/types.js';
const c = (id: string, kind: Component['kind'], spec: Component['spec']): Component => ({ id, name: id, kind, agents: 'both', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: true, spec });
const fake = (kind: Component['kind'], installed: boolean, acts: number): Provider => ({ kind, detect: async () => (installed ? { version: '1' } : null), plan: async (comp, _ctx, inst, mode) => Array.from({ length: acts }, (_, i) => action(comp.id, mode === 'uninstall' ? 'uninstall' : inst ? 'update' : 'install', `${comp.id} ${i}`, async () => ({ ok: true, changed: true, message: 'done' }))) });
describe('planner', () => {
  it('orders actions by kind then selection, adds skip for empty plans, reverses for uninstall', async () => {
    clearProviders(); registerProvider(fake('skill', false, 1)); registerProvider(fake('tool', true, 1)); registerProvider(fake('agent', false, 0));
    const sel: Selection = { profile: 'all', components: [c('s1', 'skill', { kind: 'skill', repo: 'a/b', skills: ['x'], targets: ['codex'] }), c('t1', 'tool', { kind: 'tool', probe: ['x'], packages: {} }), c('a1', 'agent', { kind: 'agent', agent: 'claude' })], excluded: [], tokenTotals: { claude: 0, codex: 0 }, codexMcpCount: 0 };
    const plan = await buildPlan(sel, makeTestCtx(), 'install');
    expect(plan.actions.map((a) => `${a.componentId}:${a.op}`)).toEqual(['t1:update', 'a1:skip', 's1:install']);
    expect(plan.detections).toEqual({ s1: null, t1: { version: '1' }, a1: null });
    const un = await buildPlan(sel, makeTestCtx(), 'uninstall');
    expect(un.actions.map((a) => a.componentId)).toEqual(['s1', 'a1', 't1']);
  });
  it('registry throws for unknown kinds', () => { clearProviders(); expect(() => getProvider('mcp')).toThrow(/no provider/); });
  it('KIND_ORDER covers every kind once', () => { expect([...KIND_ORDER].sort()).toEqual(['agent', 'claude-plugin', 'codex-plugin', 'hook', 'instructions', 'mcp', 'setting', 'skill', 'statusline', 'tool']); });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/planner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/providers/types.ts`:
```ts
import type { Action, ActionResult, Ctx, Op } from '../types.js';
let counter = 0;
export function action(componentId: string, op: Op, description: string, run: (ctx: Ctx) => Promise<ActionResult>, extra: { from?: string | null; to?: string | null } = {}): Action {
  return { id: `${componentId}:${op}:${++counter}`, componentId, op, description, run, ...extra };
}
export function skipAction(componentId: string, reason: string): Action { return action(componentId, 'skip', reason, async () => ({ ok: true, changed: false, message: reason })); }
export const ok = (message: string, changed = true): ActionResult => ({ ok: true, changed, message });
export const fail = (message: string): ActionResult => ({ ok: false, changed: false, message });
```

`src/providers/registry.ts`:
```ts
import type { Kind, Provider } from '../types.js';
const providers = new Map<Kind, Provider>();
export function registerProvider(p: Provider): void { providers.set(p.kind, p); }
export function getProvider(kind: Kind): Provider { const p = providers.get(kind); if (!p) throw new Error(`no provider registered for kind ${kind}`); return p; }
export function clearProviders(): void { providers.clear(); }
```

`src/planner.ts`:
```ts
import type { Action, Ctx, Installed, Kind, Mode, Selection } from './types.js';
import { getProvider } from './providers/registry.js';
import { skipAction } from './providers/types.js';
export const KIND_ORDER: readonly Kind[] = ['tool', 'agent', 'setting', 'claude-plugin', 'codex-plugin', 'mcp', 'skill', 'hook', 'statusline', 'instructions'];
export interface Plan { actions: Action[]; detections: Record<string, Installed | null> }
export async function buildPlan(sel: Selection, ctx: Ctx, mode: Mode): Promise<Plan> {
  const order = mode === 'uninstall' ? [...KIND_ORDER].reverse() : KIND_ORDER;
  const detections: Record<string, Installed | null> = {}; const actions: Action[] = [];
  for (const kind of order) for (const c of sel.components.filter((x) => x.kind === kind)) {
    const p = getProvider(kind);
    let installed: Installed | null = null;
    try { installed = await p.detect(c, ctx); } catch (e) { ctx.log.warn(`${c.id}: detection failed: ${(e as Error).message}`); }
    detections[c.id] = installed;
    const acts = await p.plan(c, ctx, installed, mode);
    actions.push(...(acts.length ? acts : [skipAction(c.id, mode === 'uninstall' ? 'not installed' : 'nothing to do')]));
  }
  return { actions, detections };
}
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/planner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/types.ts src/providers/registry.ts src/planner.ts test/planner.test.ts
git commit -m "feat(core): provider registry, action helpers and kind-ordered planner"
```

---

### Task 12: Claude Code agent provider

**Files:**
- Create: `src/providers/agent-claude.ts`
- Test: `test/providers/agent-claude.test.ts`

**Interfaces:**
- Consumes: `probeVersion`, `latestClaude`, `action/ok/fail`, `mergeClaudeSettings`, `writeJsonAtomic`, `readJsonFile`, `backupFile`.
- Produces: `claudeAgentProvider: Provider` (kind `agent`, only handles `spec.agent === 'claude'`). Behaviour:
  - detect: `claude --version` -> `{ version }` or null.
  - latest: `latestClaude(ctx.fetch, ctx.channel)`.
  - plan install (not installed): linux/darwin (non-Proxmox): `['bash','-c','curl -fsSL https://claude.ai/install.sh | bash -s <channel>']` (env `CLAUDE_INSTALL_ALLOW_SUDO` never set); Proxmox host or `isRoot && pkgManager==='apt'`: apt repo route (three commands: keyring download `curl -fsSL https://downloads.claude.ai/keys/claude-code.asc -o /etc/apt/keyrings/claude-code.asc` after `install -d -m 0755 /etc/apt/keyrings`, write `/etc/apt/sources.list.d/claude-code.list` with `deb [signed-by=/etc/apt/keyrings/claude-code.asc] https://downloads.claude.ai/claude-code/apt/<channel> stable main`, then `apt-get update && apt-get install -y claude-code`); darwin with brew: `brew install --cask claude-code@latest` (channel latest) or `brew install --cask claude-code` (stable); windows: `['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-Command','& ([scriptblock]::Create((irm -UseBasicParsing https://claude.ai/install.ps1))) <channel>']`; musl Alpine: precheck packages `bash curl libgcc libstdc++ ripgrep` via apk and set `env.USE_BUILTIN_RIPGREP=0` in settings; AVX false on linux -> fail action with message pointing to `qm set <vmid> --cpu x86-64-v3`.
  - plan update (installed and `isNewer(latest, installed)`): `claude update` (warn and skip when `host.claudeRunning`), except package-manager-owned installs: detect via `claude doctor` output containing `managed by` is expensive; instead check binary path: `which claude` under `/usr/bin` or `/opt/homebrew` or `%LOCALAPPDATA%\Microsoft\WinGet` -> run `apt-get install -y claude-code` / `brew upgrade --cask claude-code@latest` / `winget upgrade Anthropic.ClaudeCode` respectively.
  - after any install/update: configure action that merges `{ autoUpdatesChannel: ctx.channel }` into settings.json.
  - plan uninstall: linux/darwin remove `~/.local/bin/claude` and `~/.local/share/claude`; apt: `apt-get remove -y claude-code`; brew: `brew uninstall --cask claude-code@latest`; windows: `Remove-Item -Recurse -Force "$env:USERPROFILE\.local\share\claude"` and the exe.

- [ ] **Step 1: Write failing tests**

`test/providers/agent-claude.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { claudeAgentProvider } from '../../src/providers/agent-claude.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const comp: Component = { id: 'claude-code', name: 'Claude Code', kind: 'agent', agents: 'claude', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'agent', agent: 'claude' } };
const fetchLatest = (v: string) => (async () => new Response(v)) as unknown as typeof fetch;
describe('claudeAgentProvider', () => {
  it('detects version', async () => {
    const ctx = makeTestCtx({ responses: { 'claude --version': '2.1.274 (Claude Code)' } });
    expect(await claudeAgentProvider.detect(comp, ctx)).toEqual({ version: '2.1.274' });
  });
  it('plans native install on linux desktop with channel', async () => {
    const ctx = makeTestCtx({ fetch: fetchLatest('2.1.274') });
    const acts = await claudeAgentProvider.plan(comp, ctx, null, 'install');
    expect(acts[0]).toMatchObject({ op: 'install', to: '2.1.274' });
    await acts[0]!.run(ctx);
    expect(ctx.calls.some((a) => a.join(' ').includes('curl -fsSL https://claude.ai/install.sh | bash -s latest'))).toBe(true);
  });
  it('uses the apt repo on a Proxmox host as root', async () => {
    const ctx = makeTestCtx({ host: { isProxmoxHost: true, isRoot: true, pkgManager: 'apt' }, fetch: fetchLatest('2.1.274'), responses: { 'apt-get update': '', 'apt-get install -y claude-code': '' } });
    const acts = await claudeAgentProvider.plan(comp, ctx, null, 'install'); await acts[0]!.run(ctx);
    expect(ctx.calls.some((a) => a.includes('apt-get') && a.includes('claude-code'))).toBe(true);
    expect(ctx.calls.some((a) => a.join(' ').includes('install.sh'))).toBe(false);
  });
  it('fails early without AVX on linux', async () => {
    const ctx = makeTestCtx({ host: { hasAvx: false }, fetch: fetchLatest('2.1.274') });
    const acts = await claudeAgentProvider.plan(comp, ctx, null, 'install'); const r = await acts[0]!.run(ctx);
    expect(r.ok).toBe(false); expect(r.message).toMatch(/AVX/);
  });
  it('plans update only when newer and not while claude is running', async () => {
    const ctx = makeTestCtx({ fetch: fetchLatest('2.1.274'), responses: { 'claude update': 'Successfully updated' } });
    const acts = await claudeAgentProvider.plan(comp, ctx, { version: '2.1.273' }, 'update');
    expect(acts[0]).toMatchObject({ op: 'update', from: '2.1.273', to: '2.1.274' });
    expect(await claudeAgentProvider.plan(comp, ctx, { version: '2.1.274' }, 'update')).toEqual([]);
    const busy = makeTestCtx({ host: { claudeRunning: true }, fetch: fetchLatest('2.1.274') });
    const r = await (await claudeAgentProvider.plan(comp, busy, { version: '2.1.273' }, 'update'))[0]!.run(busy);
    expect(r.ok).toBe(false); expect(r.message).toMatch(/running/);
  });
  it('plans windows install through powershell with -UseBasicParsing', async () => {
    const ctx = makeTestCtx({ host: { platform: 'windows', pkgManager: 'winget' }, fetch: fetchLatest('2.1.274') });
    const acts = await claudeAgentProvider.plan(comp, ctx, null, 'install'); await acts[0]!.run(ctx);
    const ps = ctx.calls.find((a) => a[0] === 'powershell.exe'); expect(ps?.join(' ')).toContain('-UseBasicParsing https://claude.ai/install.ps1'); expect(ps?.join(' ')).toContain(') latest');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/providers/agent-claude.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/providers/agent-claude.ts`:
```ts
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { probeVersion } from '../detect/tools.js';
import { latestClaude } from '../version/latest.js';
import { isNewer } from '../version/compare.js';
import { action, ok, fail } from './types.js';
import { readJsonFile, writeJsonAtomic, backupFile, mergeClaudeSettings } from '../config/json.js';
async function which(ctx: Ctx, cmd: string): Promise<string> { const r = await ctx.run(ctx.host.platform === 'windows' ? ['where.exe', cmd] : ['sh', '-c', `command -v ${cmd}`], { readOnly: true, allowFailure: true }); return r.code === 0 ? r.stdout.trim().split('\n')[0] ?? '' : ''; }
function owner(path: string): 'apt' | 'brew' | 'winget' | 'native' { if (/^\/usr\/bin\//.test(path)) return 'apt'; if (/homebrew|\/usr\/local\/Caskroom/.test(path)) return 'brew'; if (/WinGet/i.test(path)) return 'winget'; return 'native'; }
async function setChannel(ctx: Ctx): Promise<void> { const cur = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; const next = mergeClaudeSettings(cur, { autoUpdatesChannel: ctx.channel }); if (JSON.stringify(next) !== JSON.stringify(cur)) { if (!ctx.dryRun) { await backupFile(ctx.paths.claudeSettings, ctx.paths.backupsDir); await writeJsonAtomic(ctx.paths.claudeSettings, next); } } }
export const claudeAgentProvider: Provider = {
  kind: 'agent',
  async detect(_c, ctx) { const v = await probeVersion(ctx.run, ['claude', '--version']); return v ? { version: v } : null; },
  async latest(_c, ctx) { return latestClaude(ctx.fetch, ctx.channel); },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'agent' || c.spec.agent !== 'claude') return [];
    const h = ctx.host; const latest = mode === 'uninstall' ? null : await latestClaude(ctx.fetch, ctx.channel);
    if (mode === 'uninstall') {
      if (!installed) return [];
      return [action(c.id, 'uninstall', 'remove Claude Code', async () => {
        const o = owner(await which(ctx, 'claude'));
        if (o === 'apt') await ctx.run(['apt-get', 'remove', '-y', 'claude-code']); else if (o === 'brew') await ctx.run(['brew', 'uninstall', '--cask', ctx.channel === 'latest' ? 'claude-code@latest' : 'claude-code']); else if (o === 'winget') await ctx.run(['winget', 'uninstall', '--id', 'Anthropic.ClaudeCode', '--silent']);
        else if (!ctx.dryRun) { await rm(join(h.home, '.local', 'share', 'claude'), { recursive: true, force: true }); await rm(join(h.home, '.local', 'bin', h.platform === 'windows' ? 'claude.exe' : 'claude'), { force: true }); }
        return ok('Claude Code removed');
      })];
    }
    if (!installed) {
      return [action(c.id, 'install', `install Claude Code (${ctx.channel})`, async () => {
        if (h.platform === 'linux' && h.hasAvx === false) return fail('CPU has no AVX: Claude Code crashes with Illegal instruction. On Proxmox run: qm set <vmid> --cpu x86-64-v3 (or host), then retry.');
        if (h.platform === 'linux' && h.isMusl && h.pkgManager === 'apk') { await ctx.run(['apk', 'add', '--no-cache', 'bash', 'curl', 'libgcc', 'libstdc++', 'ripgrep']); }
        if (h.platform === 'linux' && (h.isProxmoxHost || h.isRoot) && h.pkgManager === 'apt') {
          await ctx.run(['install', '-d', '-m', '0755', '/etc/apt/keyrings']);
          await ctx.run(['bash', '-c', 'curl -fsSL https://downloads.claude.ai/keys/claude-code.asc -o /etc/apt/keyrings/claude-code.asc']);
          await ctx.run(['bash', '-c', `printf 'deb [signed-by=/etc/apt/keyrings/claude-code.asc] https://downloads.claude.ai/claude-code/apt/${ctx.channel} stable main\\n' > /etc/apt/sources.list.d/claude-code.list`]);
          await ctx.run(['apt-get', 'update']); await ctx.run(['apt-get', 'install', '-y', 'claude-code']);
        } else if (h.platform === 'darwin' && h.pkgManager === 'brew') { await ctx.run(['brew', 'install', '--cask', ctx.channel === 'latest' ? 'claude-code@latest' : 'claude-code']); }
        else if (h.platform === 'windows') { await ctx.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; & ([scriptblock]::Create((irm -UseBasicParsing https://claude.ai/install.ps1))) ${ctx.channel}`], { timeoutMs: 600000 }); }
        else { await ctx.run(['bash', '-c', `curl -fsSL https://claude.ai/install.sh | bash -s ${ctx.channel}`], { timeoutMs: 600000 }); }
        if (h.platform === 'linux' && h.isMusl) { const cur = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; if (!ctx.dryRun) await writeJsonAtomic(ctx.paths.claudeSettings, mergeClaudeSettings(cur, { env: { USE_BUILTIN_RIPGREP: '0' } })); }
        await setChannel(ctx);
        return ok(`Claude Code ${latest ?? ''} installed`);
      }, { from: null, to: latest })];
    }
    if (!isNewer(latest, installed.version)) return [];
    return [action(c.id, 'update', `update Claude Code ${installed.version} -> ${latest}`, async () => {
      if (h.claudeRunning) return fail('a claude session is running; close it and rerun (claude update silently no-ops while the lock is held)');
      const o = owner(await which(ctx, 'claude'));
      if (o === 'apt') { await ctx.run(['apt-get', 'update']); await ctx.run(['apt-get', 'install', '-y', 'claude-code']); }
      else if (o === 'brew') await ctx.run(['brew', 'upgrade', '--cask', ctx.channel === 'latest' ? 'claude-code@latest' : 'claude-code']);
      else if (o === 'winget') await ctx.run(['winget', 'upgrade', '--id', 'Anthropic.ClaudeCode', '--silent', '--accept-source-agreements', '--accept-package-agreements']);
      else { const r = await ctx.run(['claude', 'update'], { timeoutMs: 600000, allowFailure: true }); if (r.code !== 0) return fail(`claude update failed: ${r.stderr.trim() || r.stdout.trim()}`); }
      await setChannel(ctx);
      return ok(`Claude Code updated to ${latest}`);
    }, { from: installed.version, to: latest })];
  },
};
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/providers/agent-claude.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/agent-claude.ts test/providers/agent-claude.test.ts
git commit -m "feat(provider): Claude Code agent install/update/uninstall across platforms"
```

---

### Task 13: Codex CLI agent provider

**Files:**
- Create: `src/providers/agent-codex.ts`
- Test: `test/providers/agent-codex.test.ts`

**Interfaces:**
- Produces: `codexAgentProvider: Provider` (kind `agent`, `spec.agent === 'codex'`). Behaviour: detect `codex --version`; latest `latestCodex`; install linux/darwin(non-brew): `['sh','-c','curl -fsSL https://chatgpt.com/codex/install.sh | sh']` with env `CODEX_NON_INTERACTIVE=1`; darwin with brew: `brew install --cask codex`; windows: `['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-Command','$env:CODEX_NON_INTERACTIVE=1; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; irm -UseBasicParsing https://chatgpt.com/codex/install.ps1 | iex']`; before install, detect conflicting npm global `@openai/codex` (`npm ls -g @openai/codex --depth=0 --json`) and remove it with `npm uninstall -g @openai/codex` (installers answer "No" to this in non-interactive mode). Update: `codex update` (exit 1 with "Could not detect" -> fall back to rerunning the installer on linux/darwin/windows; on winget-owned installs run `winget upgrade --id OpenAI.Codex`). Post-install on linux: `codex sandbox -- /bin/true` probe (allowFailure); if it fails, return `ok` with a warning message that includes `pct set <ctid> --features nesting=1,keyctl=1` for LXC or `sandbox_mode = "danger-full-access"` guidance. Uninstall: remove `~/.local/bin/codex`, `~/.local/bin/codex-code-mode-host`, `~/.codex/packages/standalone` (Windows: `%LOCALAPPDATA%\Programs\OpenAI\Codex`); brew: `brew uninstall --cask codex`.
- Registration: a combined `agentProvider` in `src/providers/agent.ts` dispatches on `spec.agent` to the two providers (create it in this task with two lines: `kind: 'agent'`, delegate detect/latest/plan).

- [ ] **Step 1: Write failing tests**

`test/providers/agent-codex.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { codexAgentProvider } from '../../src/providers/agent-codex.js';
import { agentProvider } from '../../src/providers/agent.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const comp: Component = { id: 'codex-cli', name: 'Codex CLI', kind: 'agent', agents: 'codex', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'agent', agent: 'codex' } };
const fetchLatest = (tag: string) => (async () => new Response(JSON.stringify({ tag_name: tag }))) as unknown as typeof fetch;
describe('codexAgentProvider', () => {
  it('installs via the standalone installer non-interactively and removes an npm conflict first', async () => {
    const ctx = makeTestCtx({ fetch: fetchLatest('rust-v0.154.0'), responses: { 'npm ls -g @openai/codex --depth=0 --json': JSON.stringify({ dependencies: { '@openai/codex': { version: '0.150.0' } } }), 'npm uninstall -g @openai/codex': '', 'codex sandbox -- /bin/true': '' } });
    const acts = await codexAgentProvider.plan(comp, ctx, null, 'install'); const r = await acts[0]!.run(ctx);
    expect(r.ok).toBe(true);
    expect(ctx.calls).toContainEqual(['npm', 'uninstall', '-g', '@openai/codex']);
    const sh = ctx.calls.find((a) => a[0] === 'sh'); expect(sh?.[2]).toBe('curl -fsSL https://chatgpt.com/codex/install.sh | sh');
  });
  it('warns when the sandbox probe fails inside LXC', async () => {
    const ctx = makeTestCtx({ host: { isLxc: true }, fetch: fetchLatest('rust-v0.154.0'), responses: { 'npm ls -g @openai/codex --depth=0 --json': '{}', 'codex sandbox -- /bin/true': { code: 1, stderr: 'bwrap: No permissions to create a new namespace' } } });
    const r = await (await codexAgentProvider.plan(comp, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true); expect(r.message).toMatch(/nesting=1/);
  });
  it('updates with codex update and falls back to the installer when detection fails', async () => {
    const ctx = makeTestCtx({ fetch: fetchLatest('rust-v0.155.0'), responses: { 'codex update': { code: 1, stderr: 'Could not detect the Codex installation method' } } });
    const acts = await codexAgentProvider.plan(comp, ctx, { version: '0.154.0' }, 'update'); const r = await acts[0]!.run(ctx);
    expect(r.ok).toBe(true); expect(ctx.calls.some((a) => a.join(' ').includes('install.sh'))).toBe(true);
  });
  it('uses brew on macOS and powershell on windows', async () => {
    const mac = makeTestCtx({ host: { platform: 'darwin', pkgManager: 'brew' }, fetch: fetchLatest('rust-v0.154.0'), responses: { 'npm ls -g @openai/codex --depth=0 --json': '{}', 'brew install --cask codex': '' } });
    await (await codexAgentProvider.plan(comp, mac, null, 'install'))[0]!.run(mac); expect(mac.calls).toContainEqual(['brew', 'install', '--cask', 'codex']);
    const win = makeTestCtx({ host: { platform: 'windows', pkgManager: 'winget' }, fetch: fetchLatest('rust-v0.154.0'), responses: { 'npm ls -g @openai/codex --depth=0 --json': '{}' } });
    await (await codexAgentProvider.plan(comp, win, null, 'install'))[0]!.run(win); expect(win.calls.find((a) => a[0] === 'powershell.exe')?.join(' ')).toContain('CODEX_NON_INTERACTIVE=1');
  });
  it('agentProvider dispatches by spec.agent', async () => { const ctx = makeTestCtx({ responses: { 'codex --version': 'codex-cli 0.154.0' } }); expect(await agentProvider.detect(comp, ctx)).toEqual({ version: '0.154.0' }); });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/providers/agent-codex.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/providers/agent-codex.ts`:
```ts
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { probeVersion } from '../detect/tools.js';
import { latestCodex } from '../version/latest.js';
import { isNewer } from '../version/compare.js';
import { action, ok, fail } from './types.js';
const SH = 'curl -fsSL https://chatgpt.com/codex/install.sh | sh';
const PS = '$env:CODEX_NON_INTERACTIVE=1; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; irm -UseBasicParsing https://chatgpt.com/codex/install.ps1 | iex';
async function removeNpmConflict(ctx: Ctx): Promise<void> {
  const r = await ctx.run(['npm', 'ls', '-g', '@openai/codex', '--depth=0', '--json'], { readOnly: true, allowFailure: true });
  if (r.code === 0 && /"@openai\/codex"/.test(r.stdout)) { ctx.log.warn('removing npm-installed @openai/codex so the native install wins on PATH'); await ctx.run(['npm', 'uninstall', '-g', '@openai/codex'], { allowFailure: true }); }
}
async function runInstaller(ctx: Ctx): Promise<void> {
  const h = ctx.host;
  if (h.platform === 'darwin' && h.pkgManager === 'brew') await ctx.run(['brew', 'install', '--cask', 'codex'], { timeoutMs: 600000 });
  else if (h.platform === 'windows') await ctx.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS], { timeoutMs: 600000 });
  else await ctx.run(['sh', '-c', SH], { env: { CODEX_NON_INTERACTIVE: '1' }, timeoutMs: 600000 });
}
async function sandboxNote(ctx: Ctx): Promise<string> {
  if (ctx.host.platform !== 'linux') return '';
  const r = await ctx.run(['codex', 'sandbox', '--', '/bin/true'], { readOnly: true, allowFailure: true, timeoutMs: 30000 });
  if (r.code === 0) return '';
  const hint = ctx.host.isLxc ? 'unprivileged LXC: on the Proxmox host run `pct set <ctid> --features nesting=1,keyctl=1` and reboot the container' : 'user namespaces unavailable: set `sandbox_mode = "danger-full-access"` in ~/.codex/config.toml or run Codex with --sandbox danger-full-access';
  return ` WARNING: Codex sandbox probe failed (${(r.stderr || r.stdout).trim().split('\n').pop() ?? ''}); ${hint}.`;
}
export const codexAgentProvider: Provider = {
  kind: 'agent',
  async detect(_c, ctx) { const v = await probeVersion(ctx.run, ['codex', '--version']); return v ? { version: v } : null; },
  async latest(_c, ctx) { return latestCodex(ctx.fetch); },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'agent' || c.spec.agent !== 'codex') return [];
    const h = ctx.host;
    if (mode === 'uninstall') {
      if (!installed) return [];
      return [action(c.id, 'uninstall', 'remove Codex CLI', async () => {
        if (h.platform === 'darwin' && h.pkgManager === 'brew') { await ctx.run(['brew', 'uninstall', '--cask', 'codex'], { allowFailure: true }); }
        if (!ctx.dryRun) {
          if (h.platform === 'windows') await rm(join(ctx.env.LOCALAPPDATA ?? join(h.home, 'AppData', 'Local'), 'Programs', 'OpenAI', 'Codex'), { recursive: true, force: true });
          else { await rm(join(h.home, '.local', 'bin', 'codex'), { force: true }); await rm(join(h.home, '.local', 'bin', 'codex-code-mode-host'), { force: true }); await rm(join(ctx.paths.codexHome, 'packages', 'standalone'), { recursive: true, force: true }); }
        }
        return ok('Codex CLI removed');
      })];
    }
    const latest = await latestCodex(ctx.fetch);
    if (!installed) return [action(c.id, 'install', `install Codex CLI ${latest ?? ''}`, async () => { await removeNpmConflict(ctx); await runInstaller(ctx); return ok(`Codex CLI ${latest ?? ''} installed.${await sandboxNote(ctx)}`); }, { from: null, to: latest })];
    if (!isNewer(latest, installed.version)) return [];
    return [action(c.id, 'update', `update Codex CLI ${installed.version} -> ${latest}`, async () => {
      const r = await ctx.run(['codex', 'update'], { allowFailure: true, timeoutMs: 600000 });
      if (r.code !== 0) {
        if (/Could not detect/i.test(r.stderr + r.stdout)) { if (h.platform === 'windows' && h.pkgManager === 'winget') await ctx.run(['winget', 'upgrade', '--id', 'OpenAI.Codex', '--silent', '--accept-source-agreements', '--accept-package-agreements'], { allowFailure: true }); else await runInstaller(ctx); }
        else return fail(`codex update failed: ${(r.stderr || r.stdout).trim()}`);
      }
      return ok(`Codex CLI updated to ${latest}`);
    }, { from: installed.version, to: latest })];
  },
};
```

`src/providers/agent.ts`:
```ts
import type { Provider } from '../types.js';
import { claudeAgentProvider } from './agent-claude.js';
import { codexAgentProvider } from './agent-codex.js';
const pick = (c: { spec: { kind: string; agent?: string } }) => (c.spec.kind === 'agent' && c.spec.agent === 'codex' ? codexAgentProvider : claudeAgentProvider);
export const agentProvider: Provider = { kind: 'agent', detect: (c, ctx) => pick(c).detect(c, ctx), latest: (c, ctx) => pick(c).latest!(c, ctx), plan: (c, ctx, i, m) => pick(c).plan(c, ctx, i, m) };
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/providers/agent-codex.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/agent-codex.ts src/providers/agent.ts test/providers/agent-codex.test.ts
git commit -m "feat(provider): Codex CLI agent install/update with npm-conflict removal and sandbox probe"
```

---

### Task 14: Tool provider (package managers, Node strategy, npm/go/uv tools)

**Files:**
- Create: `src/providers/tool.ts`
- Test: `test/providers/tool.test.ts`

**Interfaces:**
- Produces: `toolProvider: Provider` (kind `tool`). Behaviour:
  - detect: `probeVersion(ctx.run, spec.probe, spec.versionRegex)`.
  - latest: `spec.latest.npm` -> `latestNpm`; `spec.latest.github` -> `latestGithubRelease`; else null (tools without latest are only installed when missing).
  - install command selection, in order, first available: `packages.script[platform]` when `strategy === 'node'` handled specially (below); then by `host.pkgManager`: apt -> `apt-get install -y <pkg>` (with `sudo` prefix when `!isRoot && hasSudo`, fail when neither), dnf/yum -> `dnf install -y`, pacman -> `pacman -S --noconfirm`, zypper -> `zypper install -y`, apk -> `apk add --no-cache`, brew -> `brew install <pkg>`, winget -> `winget install --id <id> --silent --accept-source-agreements --accept-package-agreements`, scoop -> `scoop install <pkg>`, choco -> `choco install -y <pkg>`; then `packages.npm` -> `npm install -g <pkg>` (never sudo; if the global prefix is root-owned and user is not root, set `npm config set prefix ~/.local` first and add to PATH hint); `packages.go` -> `go install <module>@latest`; `packages.uvTool` -> `uv tool install <pkg>`; `packages.script[platform]` -> `sh -c <script>` (`powershell.exe -Command` on windows). No option -> fail action with a clear message.
  - Node strategy (`strategy: 'node'`): windows -> winget `OpenJS.NodeJS.LTS`; darwin -> `brew install node@24`; linux root or Proxmox with apt -> NodeSource: `curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh && bash /tmp/nodesource_setup.sh && apt-get install -y nodejs`; linux non-root -> fnm: `curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell` then `~/.local/share/fnm/fnm install 24` and `fnm default 24`, plus shell rc marker hint; other package managers: dnf `nodejs`, pacman `nodejs npm`, apk `nodejs npm`. Update = same command when `isNewer(latest, installed)` or when the installed major is below `NODE_MAJOR`.
  - `postInstall[platform]`: list of argv to run after install/update (used by `playwright-cli` for `playwright-cli install --skills`, and by `caveman-cli`).
  - uninstall: reverse of the package manager command (`apt-get remove -y`, `brew uninstall`, `winget uninstall --id`, `npm uninstall -g`, `uv tool uninstall`); go tools: remove `$(go env GOPATH)/bin/<name>`.

- [ ] **Step 1: Write failing tests**

`test/providers/tool.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { toolProvider } from '../../src/providers/tool.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const tool = (id: string, spec: Partial<Extract<Component['spec'], { kind: 'tool' }>>): Component => ({ id, name: id, kind: 'tool', agents: 'both', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'tool', probe: [id, '--version'], packages: {}, ...spec } });
describe('toolProvider', () => {
  it('installs via apt with sudo for a non-root user', async () => {
    const ctx = makeTestCtx({ responses: { 'sudo apt-get install -y jq': '' } });
    const r = await (await toolProvider.plan(tool('jq', { packages: { apt: 'jq', winget: 'jqlang.jq' } }), ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true); expect(ctx.calls).toContainEqual(['sudo', 'apt-get', 'install', '-y', 'jq']);
  });
  it('fails clearly without root or sudo', async () => {
    const ctx = makeTestCtx({ host: { hasSudo: false } });
    const r = await (await toolProvider.plan(tool('jq', { packages: { apt: 'jq' } }), ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(false); expect(r.message).toMatch(/sudo/);
  });
  it('uses winget on windows and npm -g without sudo', async () => {
    const win = makeTestCtx({ host: { platform: 'windows', pkgManager: 'winget' }, responses: { 'winget install --id jqlang.jq --silent --accept-source-agreements --accept-package-agreements': '' } });
    await (await toolProvider.plan(tool('jq', { packages: { apt: 'jq', winget: 'jqlang.jq' } }), win, null, 'install'))[0]!.run(win);
    expect(win.calls[0]?.[0]).toBe('winget');
    const ctx = makeTestCtx({ responses: { 'npm config get prefix': '/home/u/.local', 'npm install -g @caveman-ai/cli@1.3.4': '', 'caveman --version': '' } });
    const c = tool('caveman-cli', { probe: ['caveman', '--version'], packages: { npm: '@caveman-ai/cli@1.3.4' }, postInstall: { linux: [['caveman', '--version']] } });
    await (await toolProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(ctx.calls).toContainEqual(['npm', 'install', '-g', '@caveman-ai/cli@1.3.4']); expect(ctx.calls).toContainEqual(['caveman', '--version']);
  });
  it('node strategy picks NodeSource for root apt and fnm for users', async () => {
    const root = makeTestCtx({ host: { isRoot: true, hasSudo: false }, responses: { 'bash -c curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh && bash /tmp/nodesource_setup.sh && apt-get install -y nodejs': '' } });
    await (await toolProvider.plan(tool('node', { strategy: 'node', probe: ['node', '--version'] }), root, null, 'install'))[0]!.run(root);
    expect(root.calls.some((a) => a.join(' ').includes('nodesource'))).toBe(true);
    const user = makeTestCtx();
    await (await toolProvider.plan(tool('node', { strategy: 'node', probe: ['node', '--version'] }), user, null, 'install'))[0]!.run(user);
    expect(user.calls.some((a) => a.join(' ').includes('fnm.vercel.app'))).toBe(true);
    expect(user.calls.some((a) => a.join(' ').match(/fnm install 24/))).toBe(true);
  });
  it('plans node update when installed major is below 24', async () => {
    const ctx = makeTestCtx();
    const acts = await toolProvider.plan(tool('node', { strategy: 'node' }), ctx, { version: '22.22.1' }, 'update'); expect(acts[0]).toMatchObject({ op: 'update' });
    expect(await toolProvider.plan(tool('node', { strategy: 'node' }), ctx, { version: '24.19.0' }, 'update')).toEqual([]);
  });
  it('updates npm tools when the registry is newer', async () => {
    const f = (async () => new Response(JSON.stringify({ version: '1.3.4' }))) as unknown as typeof fetch;
    const ctx = makeTestCtx({ fetch: f });
    const c = tool('caveman-cli', { probe: ['caveman', '--version'], packages: { npm: '@caveman-ai/cli' }, latest: { npm: '@caveman-ai/cli' } });
    expect((await toolProvider.plan(c, ctx, { version: '1.3.3' }, 'update'))[0]).toMatchObject({ op: 'update', from: '1.3.3', to: '1.3.4' });
    expect(await toolProvider.plan(c, ctx, { version: '1.3.4' }, 'update')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/providers/tool.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/providers/tool.ts`:
```ts
import { join } from 'node:path';
import type { Action, Component, Ctx, Installed, Provider, ToolSpec } from '../types.js';
import { probeVersion } from '../detect/tools.js';
import { latestNpm, latestGithubRelease } from '../version/latest.js';
import { isNewer, normalizeVersion } from '../version/compare.js';
import { NODE_MAJOR } from '../pins.js';
import { action, ok, fail } from './types.js';
function sudo(ctx: Ctx, argv: string[]): string[] | null { if (ctx.host.isRoot) return argv; if (ctx.host.hasSudo) return ['sudo', ...argv]; return null; }
function pmInstall(ctx: Ctx, p: ToolSpec['packages']): string[] | null | 'nosudo' {
  const pm = ctx.host.pkgManager; const s = (argv: string[]) => sudo(ctx, argv) ?? 'nosudo';
  switch (pm) {
    case 'apt': return p.apt ? s(['apt-get', 'install', '-y', p.apt]) : null;
    case 'dnf': case 'yum': return p.dnf ? s([pm, 'install', '-y', p.dnf]) : null;
    case 'pacman': return p.pacman ? s(['pacman', '-S', '--noconfirm', '--needed', p.pacman]) : null;
    case 'zypper': return p.zypper ? s(['zypper', '--non-interactive', 'install', p.zypper]) : null;
    case 'apk': return p.apk ? s(['apk', 'add', '--no-cache', p.apk]) : null;
    case 'brew': return p.brew ? ['brew', 'install', p.brew] : null;
    case 'winget': return p.winget ? ['winget', 'install', '--id', p.winget, '--silent', '--accept-source-agreements', '--accept-package-agreements'] : null;
    case 'scoop': return p.scoop ? ['scoop', 'install', p.scoop] : null;
    case 'choco': return p.scoop ? ['choco', 'install', '-y', p.scoop] : null;
    default: return null;
  }
}
async function npmGlobal(ctx: Ctx, pkg: string): Promise<void> {
  if (!ctx.host.isRoot && ctx.host.platform !== 'windows') {
    const prefix = (await ctx.run(['npm', 'config', 'get', 'prefix'], { readOnly: true, allowFailure: true })).stdout.trim();
    if (prefix.startsWith('/usr')) { ctx.log.warn(`npm global prefix ${prefix} is not user-writable; switching to ~/.local (add ~/.local/bin to PATH)`); await ctx.run(['npm', 'config', 'set', 'prefix', join(ctx.host.home, '.local')]); }
  }
  await ctx.run(['npm', 'install', '-g', pkg], { timeoutMs: 600000 });
}
async function installNode(ctx: Ctx): Promise<string | null> {
  const h = ctx.host;
  if (h.platform === 'windows') { await ctx.run(['winget', 'install', '--id', 'OpenJS.NodeJS.LTS', '--silent', '--accept-source-agreements', '--accept-package-agreements']); return null; }
  if (h.platform === 'darwin') { await ctx.run(['brew', 'install', `node@${NODE_MAJOR}`]); await ctx.run(['brew', 'link', '--overwrite', '--force', `node@${NODE_MAJOR}`], { allowFailure: true }); return null; }
  if ((h.isRoot || h.isProxmoxHost) && h.pkgManager === 'apt') { await ctx.run(['bash', '-c', `curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x -o /tmp/nodesource_setup.sh && bash /tmp/nodesource_setup.sh && apt-get install -y nodejs`], { timeoutMs: 600000 }); return null; }
  if (h.isRoot && h.pkgManager) { const cmd = pmInstall(ctx, { dnf: 'nodejs npm', pacman: 'nodejs npm', apk: 'nodejs npm', zypper: 'nodejs22 npm22' }); if (cmd && cmd !== 'nosudo') { await ctx.run(cmd); return null; } }
  await ctx.run(['bash', '-c', 'curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell'], { timeoutMs: 600000 });
  const fnm = join(h.home, '.local', 'share', 'fnm', 'fnm');
  await ctx.run(['bash', '-c', `"${fnm}" install ${NODE_MAJOR} && "${fnm}" default ${NODE_MAJOR}`], { timeoutMs: 600000 });
  return `Node ${NODE_MAJOR} installed with fnm. Add to your shell rc: eval "$("${fnm}" env --use-on-cd)"`;
}
async function toolLatest(c: Component, ctx: Ctx): Promise<string | null> { if (c.spec.kind !== 'tool') return null; if (c.spec.latest?.npm) return latestNpm(ctx.fetch, c.spec.latest.npm); if (c.spec.latest?.github) return latestGithubRelease(ctx.fetch, c.spec.latest.github); return null; }
export const toolProvider: Provider = {
  kind: 'tool',
  async detect(c, ctx) { if (c.spec.kind !== 'tool') return null; const v = await probeVersion(ctx.run, c.spec.probe, c.spec.versionRegex); return v ? { version: v } : null; },
  latest: toolLatest,
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'tool') return []; const spec = c.spec; const h = ctx.host;
    const post = async () => { for (const argv of spec.postInstall?.[h.platform] ?? []) await ctx.run(argv, { timeoutMs: 600000 }); };
    if (mode === 'uninstall') {
      if (!installed) return [];
      return [action(c.id, 'uninstall', `remove ${c.name}`, async () => {
        const p = spec.packages; const pm = h.pkgManager;
        if (p.npm) await ctx.run(['npm', 'uninstall', '-g', p.npm.replace(/@[^@/]+$/, '')], { allowFailure: true });
        else if (p.uvTool) await ctx.run(['uv', 'tool', 'uninstall', p.uvTool], { allowFailure: true });
        else if (pm === 'apt' && p.apt) { const cmd = sudo(ctx, ['apt-get', 'remove', '-y', p.apt]); if (cmd) await ctx.run(cmd, { allowFailure: true }); }
        else if (pm === 'brew' && p.brew) await ctx.run(['brew', 'uninstall', p.brew], { allowFailure: true });
        else if (pm === 'winget' && p.winget) await ctx.run(['winget', 'uninstall', '--id', p.winget, '--silent'], { allowFailure: true });
        else return ok(`${c.name}: no uninstall route for ${pm ?? 'this host'}; remove it manually`, false);
        return ok(`${c.name} removed`);
      })];
    }
    const latest = await toolLatest(c, ctx);
    const needsNodeUpgrade = spec.strategy === 'node' && installed?.version && Number(normalizeVersion(installed.version)?.split('.')[0]) < NODE_MAJOR;
    if (installed && mode !== 'install' && !isNewer(latest, installed.version) && !needsNodeUpgrade) return [];
    if (installed && mode === 'install' && !needsNodeUpgrade) return [];
    const op = installed ? 'update' : 'install';
    return [action(c.id, op, `${op} ${c.name}${latest ? ` (${latest})` : ''}`, async () => {
      if (spec.strategy === 'node') { const note = await installNode(ctx); await post(); return ok(`Node installed${note ? `. ${note}` : ''}`); }
      const p = spec.packages;
      const cmd = pmInstall(ctx, p);
      if (cmd === 'nosudo') return fail(`${c.name}: needs root or sudo to use ${h.pkgManager}; install it manually or rerun as root`);
      if (cmd) await ctx.run(cmd, { timeoutMs: 600000 });
      else if (p.npm) await npmGlobal(ctx, p.npm);
      else if (p.go) await ctx.run(['go', 'install', p.go.includes('@') ? p.go : `${p.go}@latest`], { timeoutMs: 600000 });
      else if (p.uvTool) await ctx.run(['uv', 'tool', 'install', p.uvTool], { timeoutMs: 600000 });
      else if (p.script?.[h.platform]) await ctx.run(h.platform === 'windows' ? ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', p.script[h.platform]!] : ['sh', '-c', p.script[h.platform]!], { timeoutMs: 600000 });
      else return fail(`${c.name}: no install route for ${h.platform}/${h.pkgManager ?? 'no package manager'}`);
      await post();
      return ok(`${c.name} ${op === 'install' ? 'installed' : 'updated'}`);
    }, { from: installed?.version ?? null, to: latest })];
  },
};
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/providers/tool.test.ts`
Expected: PASS (6 tests). Unknown mutating commands succeed in the fake runner (Task 6 helper), so the fnm commands need no listed responses.

- [ ] **Step 5: Commit**

```bash
git add src/providers/tool.ts test/providers/tool.test.ts
git commit -m "feat(provider): prerequisite tools via package managers, npm, go, uv and Node strategy"
```

---

### Task 15: Claude plugin provider

**Files:**
- Create: `src/providers/claude-plugin.ts`
- Test: `test/providers/claude-plugin.test.ts`

**Interfaces:**
- Produces: `claudePluginProvider: Provider` (kind `claude-plugin`) and `ensureClaudeMarketplace(ctx, name, source)` (adds when missing from `known_marketplaces.json`; idempotent). Behaviour:
  - detect: from `detectClaude(ctx)` (cache per ctx via a `WeakMap<Ctx, Promise<ClaudeState>>` exported as `getClaudeState(ctx)`), find plugin `${plugin}@${marketplace}` -> `{ version, details: { scopes, enabled } }`.
  - plan by `spec.action` (default `install`):
    - `install`, not installed: ensure marketplace (source = `spec.marketplaceSource ?? OFFICIAL_MARKETPLACE_SOURCE` for the official name), then `claude plugin install <p>@<m> --scope user --json`. Installed: mode `update` -> `claude plugin marketplace update <m>` (once per marketplace per run, tracked in a per-ctx Set) then `claude plugin update <p>@<m> --json`; parse the last JSON line: `updateOutcome: 'up_to_date'` -> `changed:false`. Installed but disabled -> `claude plugin enable <p>@<m>`.
    - `disable`: installed and enabled -> `claude plugin disable <p>@<m> --scope user`; not installed -> nothing.
    - `uninstall`: installed -> for each scope in details.scopes run `claude plugin uninstall <p>@<m> --scope <scope>`; not installed -> nothing.
    - mode `uninstall` for `install` components: `claude plugin uninstall <p>@<m> --scope user`.
  - Skip everything with a `skipAction` when Claude is not installed (`getClaudeState(ctx).installed === false`).

- [ ] **Step 1: Write failing tests**

`test/providers/claude-plugin.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudePluginProvider } from '../../src/providers/claude-plugin.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const plugin = (id: string, over: Partial<Extract<Component['spec'], { kind: 'claude-plugin' }>> = {}): Component => ({ id, name: id, kind: 'claude-plugin', agents: 'claude', platforms: ['linux'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'claude-plugin', marketplace: 'claude-plugins-official', plugin: id, ...over } });
const listed = (rows: unknown[]) => JSON.stringify(rows);
function ctxWith(known: string[], list: unknown[], extra: Record<string, string | { code: number; stdout?: string; stderr?: string }> = {}) {
  const ctx = makeTestCtx({ responses: { 'claude --version': '2.1.274 (Claude Code)', 'claude plugin list --json': listed(list), ...extra } });
  mkdirSync(join(ctx.paths.claudeConfigDir, 'plugins'), { recursive: true });
  writeFileSync(join(ctx.paths.claudeConfigDir, 'plugins', 'known_marketplaces.json'), JSON.stringify(Object.fromEntries(known.map((k) => [k, {}]))));
  return ctx;
}
describe('claudePluginProvider', () => {
  it('installs after adding a missing third-party marketplace', async () => {
    const ctx = ctxWith(['claude-plugins-official'], [], { 'claude plugin marketplace add JuliusBrussee/caveman': '', 'claude plugin install caveman@caveman --scope user --json': '{"outcome":"ok"}' });
    const c = plugin('caveman', { marketplace: 'caveman', marketplaceSource: 'JuliusBrussee/caveman' });
    const acts = await claudePluginProvider.plan(c, ctx, await claudePluginProvider.detect(c, ctx), 'install');
    expect(acts[0]).toMatchObject({ op: 'install' }); expect((await acts[0]!.run(ctx)).ok).toBe(true);
    expect(ctx.calls).toContainEqual(['claude', 'plugin', 'marketplace', 'add', 'JuliusBrussee/caveman']);
    expect(ctx.calls).toContainEqual(['claude', 'plugin', 'install', 'caveman@caveman', '--scope', 'user', '--json']);
  });
  it('updates installed plugins and reports up_to_date as unchanged', async () => {
    const ctx = ctxWith(['claude-plugins-official'], [{ id: 'superpowers@claude-plugins-official', version: '6.3.0', scope: 'user', enabled: true }], { 'claude plugin marketplace update claude-plugins-official': '', 'claude plugin update superpowers@claude-plugins-official --json': 'Checking...\n{"updateOutcome":"up_to_date","oldVersion":"6.3.0","newVersion":"6.3.0"}' });
    const c = plugin('superpowers'); const inst = await claudePluginProvider.detect(c, ctx); expect(inst).toMatchObject({ version: '6.3.0' });
    const r = await (await claudePluginProvider.plan(c, ctx, inst, 'update'))[0]!.run(ctx);
    expect(r).toMatchObject({ ok: true, changed: false });
  });
  it('disables and uninstalls at every scope', async () => {
    const ctx = ctxWith(['claude-plugins-official'], [{ id: 'plugin-dev@claude-plugins-official', version: '1', scope: 'user', enabled: true }, { id: 'code-review@claude-plugins-official', version: '1', scope: 'user', enabled: true }, { id: 'code-review@claude-plugins-official', version: '1', scope: 'project', enabled: true }], { 'claude plugin disable plugin-dev@claude-plugins-official --scope user': '', 'claude plugin uninstall code-review@claude-plugins-official --scope user': '', 'claude plugin uninstall code-review@claude-plugins-official --scope project': '' });
    const d = plugin('plugin-dev', { action: 'disable' }); await (await claudePluginProvider.plan(d, ctx, await claudePluginProvider.detect(d, ctx), 'install'))[0]!.run(ctx);
    expect(ctx.calls).toContainEqual(['claude', 'plugin', 'disable', 'plugin-dev@claude-plugins-official', '--scope', 'user']);
    const u = plugin('code-review', { action: 'uninstall' }); await (await claudePluginProvider.plan(u, ctx, await claudePluginProvider.detect(u, ctx), 'install'))[0]!.run(ctx);
    expect(ctx.calls.filter((a) => a[2] === 'uninstall')).toHaveLength(2);
  });
  it('skips when Claude is not installed', async () => {
    const ctx = makeTestCtx({ responses: {} });
    const acts = await claudePluginProvider.plan(plugin('superpowers'), ctx, null, 'install'); expect(acts[0]).toMatchObject({ op: 'skip' });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/providers/claude-plugin.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/providers/claude-plugin.ts`:
```ts
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { detectClaude, type ClaudeState } from '../detect/agents.js';
import { OFFICIAL_MARKETPLACE, OFFICIAL_MARKETPLACE_SOURCE } from '../pins.js';
import { action, ok, fail, skipAction } from './types.js';
const stateCache = new WeakMap<Ctx, Promise<ClaudeState>>();
export function getClaudeState(ctx: Ctx): Promise<ClaudeState> { let p = stateCache.get(ctx); if (!p) { p = detectClaude(ctx); stateCache.set(ctx, p); } return p; }
export function invalidateClaudeState(ctx: Ctx): void { stateCache.delete(ctx); }
const updatedMarketplaces = new WeakMap<Ctx, Set<string>>();
export async function ensureClaudeMarketplace(ctx: Ctx, name: string, source?: string): Promise<void> {
  const st = await getClaudeState(ctx); if (st.marketplaces.includes(name)) return;
  const src = source ?? (name === OFFICIAL_MARKETPLACE ? OFFICIAL_MARKETPLACE_SOURCE : undefined);
  if (!src) throw new Error(`marketplace ${name} is not registered and no source is known`);
  await ctx.run(['claude', 'plugin', 'marketplace', 'add', src], { timeoutMs: 300000 }); st.marketplaces.push(name);
}
async function refreshMarketplace(ctx: Ctx, name: string): Promise<void> { let s = updatedMarketplaces.get(ctx); if (!s) { s = new Set(); updatedMarketplaces.set(ctx, s); } if (s.has(name)) return; s.add(name); await ctx.run(['claude', 'plugin', 'marketplace', 'update', name], { allowFailure: true, timeoutMs: 300000 }); }
function lastJson(s: string): Record<string, unknown> | null { const l = s.trim().split('\n').reverse().find((x) => x.trim().startsWith('{')); if (!l) return null; try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } }
export const claudePluginProvider: Provider = {
  kind: 'claude-plugin',
  async detect(c, ctx) {
    if (c.spec.kind !== 'claude-plugin') return null; const st = await getClaudeState(ctx); if (!st.installed) return null;
    const id = `${c.spec.plugin}@${c.spec.marketplace}`; const rows = st.plugins.filter((p) => p.id === id); if (!rows.length) return null;
    return { version: rows[0]!.version, details: { scopes: rows.map((r) => r.scope), enabled: rows.some((r) => r.enabled) } };
  },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'claude-plugin') return []; const spec = c.spec; const id = `${spec.plugin}@${spec.marketplace}`;
    const st = await getClaudeState(ctx); if (!st.installed) return [skipAction(c.id, 'Claude Code not installed')];
    const scopes = (installed?.details?.scopes as string[] | undefined) ?? ['user']; const enabled = (installed?.details?.enabled as boolean | undefined) ?? true;
    const act = spec.action ?? 'install';
    const uninstallAll = async () => { for (const s of scopes) await ctx.run(['claude', 'plugin', 'uninstall', id, '--scope', s], { allowFailure: true, timeoutMs: 300000 }); return ok(`${id} uninstalled (${scopes.join(', ')})`); };
    if (act === 'uninstall' || mode === 'uninstall') return installed ? [action(c.id, 'uninstall', `uninstall ${id}`, uninstallAll)] : [];
    if (act === 'disable') return installed && enabled ? [action(c.id, 'disable', `disable ${id} at user scope`, async () => { await ctx.run(['claude', 'plugin', 'disable', id, '--scope', 'user'], { allowFailure: true }); return ok(`${id} disabled`); })] : [];
    if (!installed) return [action(c.id, 'install', `install ${id}`, async () => {
      await ensureClaudeMarketplace(ctx, spec.marketplace, spec.marketplaceSource);
      const r = await ctx.run(['claude', 'plugin', 'install', id, '--scope', 'user', '--json'], { allowFailure: true, timeoutMs: 600000 });
      const j = lastJson(r.stdout); if (r.code !== 0 && j?.outcome !== 'ok') return fail(`install ${id} failed: ${(j?.message as string) ?? r.stderr.trim()}`);
      return ok(`${id} installed`);
    })];
    const acts: Action[] = [];
    if (!enabled) acts.push(action(c.id, 'configure', `enable ${id}`, async () => { await ctx.run(['claude', 'plugin', 'enable', id], { allowFailure: true }); return ok(`${id} enabled`); }));
    if (mode === 'update') acts.push(action(c.id, 'update', `update ${id}`, async () => {
      await refreshMarketplace(ctx, spec.marketplace);
      const r = await ctx.run(['claude', 'plugin', 'update', id, '--json'], { allowFailure: true, timeoutMs: 600000 }); const j = lastJson(r.stdout);
      if (r.code !== 0) return fail(`update ${id} failed: ${(j?.failureCode as string) ?? r.stderr.trim()}`);
      if (j?.updateOutcome === 'up_to_date') return ok(`${id} up to date (${j.newVersion ?? installed.version})`, false);
      return ok(`${id} updated ${j?.oldVersion ?? ''} -> ${j?.newVersion ?? ''}`);
    }, { from: installed.version, to: null }));
    return acts;
  },
};
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/providers/claude-plugin.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/claude-plugin.ts test/providers/claude-plugin.test.ts
git commit -m "feat(provider): Claude plugins with marketplace registration, install/update/disable/uninstall"
```

---

### Task 16: Codex plugin provider

**Files:**
- Create: `src/providers/codex-plugin.ts`
- Test: `test/providers/codex-plugin.test.ts`

**Interfaces:**
- Produces: `codexPluginProvider: Provider` (kind `codex-plugin`), `getCodexState(ctx)` (cached `detectCodex`, with `invalidateCodexState`). Behaviour: skip when Codex not installed; ensure git marketplace: if `spec.marketplace` not in `state.marketplaces` -> `codex plugin marketplace add <source> --json` (source `owner/repo`, path or URL). Install: `codex plugin add <plugin>@<marketplace> --json` (idempotent; parse JSON for `version`). Update: `codex plugin marketplace upgrade <marketplace> --json` once per marketplace per run, then `codex plugin add ... --json` again (re-copies); report `changed:false` when the returned `version` equals the installed one. Uninstall: `codex plugin remove <plugin>@<marketplace> --json`. Marketplaces named `openai-curated-remote` or `openai-curated` are never added/upgraded (reserved); plan install for them only when `state.plugins` lacks the id, and fail with the message `chatgpt authentication required` when the CLI says so.

- [ ] **Step 1: Write failing tests**

`test/providers/codex-plugin.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { codexPluginProvider } from '../../src/providers/codex-plugin.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const plugin = (id: string, marketplace: string, marketplaceSource: string): Component => ({ id: `cx-${id}`, name: id, kind: 'codex-plugin', agents: 'codex', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: false, spec: { kind: 'codex-plugin', marketplace, marketplaceSource, plugin: id } });
function ctxWith(toml: string, installed: Array<{ pluginId: string; version: string }>, extra: Record<string, string | { code: number; stdout?: string; stderr?: string }> = {}) {
  const ctx = makeTestCtx({ responses: { 'codex --version': 'codex-cli 0.154.0', 'codex plugin list --json': JSON.stringify({ installed, available: [] }), 'codex mcp list --json': '[]', ...extra } });
  writeFileSync(ctx.paths.codexConfig, toml); return ctx;
}
describe('codexPluginProvider', () => {
  it('adds the git marketplace then the plugin', async () => {
    const ctx = ctxWith('', [], { 'codex plugin marketplace add JuliusBrussee/caveman --json': '{"marketplaceName":"caveman","alreadyAdded":false}', 'codex plugin add caveman@caveman --json': '{"pluginId":"caveman@caveman","version":"2.7.0"}' });
    const c = plugin('caveman', 'caveman', 'JuliusBrussee/caveman');
    const r = await (await codexPluginProvider.plan(c, ctx, await codexPluginProvider.detect(c, ctx), 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true); expect(ctx.calls).toContainEqual(['codex', 'plugin', 'marketplace', 'add', 'JuliusBrussee/caveman', '--json']); expect(ctx.calls).toContainEqual(['codex', 'plugin', 'add', 'caveman@caveman', '--json']);
  });
  it('updates by upgrading the marketplace and re-adding, unchanged when version equal', async () => {
    const ctx = ctxWith('[marketplaces.caveman]\nsource_type = "git"\n', [{ pluginId: 'caveman@caveman', version: '2.7.0' }], { 'codex plugin marketplace upgrade caveman --json': '{"upgradedRoots":[]}', 'codex plugin add caveman@caveman --json': '{"pluginId":"caveman@caveman","version":"2.7.0"}' });
    const c = plugin('caveman', 'caveman', 'JuliusBrussee/caveman'); const inst = await codexPluginProvider.detect(c, ctx); expect(inst).toMatchObject({ version: '2.7.0' });
    const r = await (await codexPluginProvider.plan(c, ctx, inst, 'update'))[0]!.run(ctx); expect(r).toMatchObject({ ok: true, changed: false });
    expect(ctx.calls.filter((a) => a[2] === 'marketplace' && a[3] === 'add')).toHaveLength(0);
  });
  it('never adds reserved marketplaces and surfaces the ChatGPT auth error', async () => {
    const ctx = ctxWith('', [], { 'codex plugin add superpowers@openai-curated-remote --json': { code: 1, stderr: 'Error: chatgpt authentication required for remote plugin catalog' } });
    const c = plugin('superpowers', 'openai-curated-remote', 'reserved');
    const r = await (await codexPluginProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(false); expect(r.message).toMatch(/chatgpt authentication required/); expect(ctx.calls.some((a) => a[3] === 'add' && a[2] === 'marketplace')).toBe(false);
  });
  it('removes on uninstall and skips without codex', async () => {
    const ctx = ctxWith('', [{ pluginId: 'caveman@caveman', version: '2.7.0' }], { 'codex plugin remove caveman@caveman --json': '{}' });
    const c = plugin('caveman', 'caveman', 'JuliusBrussee/caveman');
    await (await codexPluginProvider.plan(c, ctx, await codexPluginProvider.detect(c, ctx), 'uninstall'))[0]!.run(ctx); expect(ctx.calls).toContainEqual(['codex', 'plugin', 'remove', 'caveman@caveman', '--json']);
    const none = makeTestCtx({ responses: {} }); expect((await codexPluginProvider.plan(c, none, null, 'install'))[0]).toMatchObject({ op: 'skip' });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/providers/codex-plugin.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/providers/codex-plugin.ts`:
```ts
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { detectCodex, type CodexState } from '../detect/agents.js';
import { action, ok, fail, skipAction } from './types.js';
const RESERVED = new Set(['openai-curated', 'openai-curated-remote', 'openai-api-curated']);
const stateCache = new WeakMap<Ctx, Promise<CodexState>>();
export function getCodexState(ctx: Ctx): Promise<CodexState> { let p = stateCache.get(ctx); if (!p) { p = detectCodex(ctx); stateCache.set(ctx, p); } return p; }
export function invalidateCodexState(ctx: Ctx): void { stateCache.delete(ctx); }
const upgraded = new WeakMap<Ctx, Set<string>>();
function lastJson(s: string): Record<string, unknown> | null { const l = s.trim().split('\n').reverse().find((x) => x.trim().startsWith('{')); if (!l) return null; try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } }
export async function ensureCodexMarketplace(ctx: Ctx, name: string, source: string): Promise<void> {
  if (RESERVED.has(name)) return; const st = await getCodexState(ctx); if (st.marketplaces.includes(name)) return;
  await ctx.run(['codex', 'plugin', 'marketplace', 'add', source, '--json'], { timeoutMs: 300000 }); st.marketplaces.push(name);
}
async function upgradeMarketplace(ctx: Ctx, name: string): Promise<void> { if (RESERVED.has(name)) return; let s = upgraded.get(ctx); if (!s) { s = new Set(); upgraded.set(ctx, s); } if (s.has(name)) return; s.add(name); await ctx.run(['codex', 'plugin', 'marketplace', 'upgrade', name, '--json'], { allowFailure: true, timeoutMs: 300000 }); }
async function add(ctx: Ctx, id: string): Promise<{ ok: boolean; version: string | null; error: string }> {
  const r = await ctx.run(['codex', 'plugin', 'add', id, '--json'], { allowFailure: true, timeoutMs: 600000 }); const j = lastJson(r.stdout);
  if (r.code !== 0) return { ok: false, version: null, error: (r.stderr || r.stdout).trim() };
  return { ok: true, version: (j?.version as string) ?? null, error: '' };
}
export const codexPluginProvider: Provider = {
  kind: 'codex-plugin',
  async detect(c, ctx) { if (c.spec.kind !== 'codex-plugin') return null; const st = await getCodexState(ctx); if (!st.installed) return null; const id = `${c.spec.plugin}@${c.spec.marketplace}`; const p = st.plugins.find((x) => x.id === id); return p ? { version: p.version } : null; },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'codex-plugin') return []; const spec = c.spec; const id = `${spec.plugin}@${spec.marketplace}`;
    const st = await getCodexState(ctx); if (!st.installed) return [skipAction(c.id, 'Codex CLI not installed')];
    if (mode === 'uninstall') return installed ? [action(c.id, 'uninstall', `remove ${id}`, async () => { await ctx.run(['codex', 'plugin', 'remove', id, '--json'], { allowFailure: true }); return ok(`${id} removed`); })] : [];
    if (!installed) return [action(c.id, 'install', `install ${id}`, async () => { await ensureCodexMarketplace(ctx, spec.marketplace, spec.marketplaceSource); const r = await add(ctx, id); return r.ok ? ok(`${id} ${r.version ?? ''} installed`) : fail(`install ${id} failed: ${r.error}`); })];
    if (mode !== 'update') return [];
    return [action(c.id, 'update', `update ${id}`, async () => { await upgradeMarketplace(ctx, spec.marketplace); const r = await add(ctx, id); if (!r.ok) return fail(`update ${id} failed: ${r.error}`); const same = r.version && r.version === installed.version; return ok(same ? `${id} up to date (${r.version})` : `${id} updated ${installed.version ?? ''} -> ${r.version ?? ''}`, !same); }, { from: installed.version, to: null })];
  },
};
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/providers/codex-plugin.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/codex-plugin.ts test/providers/codex-plugin.test.ts
git commit -m "feat(provider): Codex plugins via git marketplaces with upgrade-and-readd updates"
```

### Task 17: Skill provider (skills CLI with audit gate)

**Files:**
- Create: `src/providers/skill.ts`
- Test: `test/providers/skill.test.ts`

**Interfaces:**
- Produces: `skillProvider: Provider` (kind `skill`), `readSkillLock(path): Promise<Record<string, { source: string; skillPath?: string; skillFolderHash?: string }>>` (reads `~/.agents/.skill-lock.json` `skills` map). Behaviour:
  - detect: a component is installed when every named skill (or, for `'*'`, at least one skill whose lock `source` equals `spec.repo`) exists in the lock file; `version` = first 7 chars of `skillFolderHash` or `'installed'`.
  - install: unless `ctx.noAudit`, run `auditSkill` for each `c.audit` entry (or for each named skill with `owner/repo` split from `spec.repo` when `c.audit` is absent and `skills !== '*'`); `fail` -> return `fail` with scanner details and the hint `--no-audit`; `warn` -> log warn and continue; then run `npx -y skills@<SKILLS_CLI> add <repo> [--skill <s>]... -g -a <t>... -y [--copy]` where `--copy` is added on Windows when `host.windowsDeveloperMode === false`; for `'*'` pass `--skill '*'` (as a single argv element `*`; no shell).
  - update: `npx -y skills@<SKILLS_CLI> update -g -y` once per run (per-ctx flag), reporting changed when stdout does not contain `up to date`.
  - uninstall: `npx -y skills@<SKILLS_CLI> remove <skill> -g -y` for each named skill (for `'*'`: every lock entry with `source === repo`).
  - Node missing (`probeVersion(['node','--version'])` null) -> `skipAction` explaining Node is required.

- [ ] **Step 1: Write failing tests**

`test/providers/skill.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { skillProvider } from '../../src/providers/skill.js';
import { SKILLS_CLI } from '../../src/pins.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const skill = (id: string, repo: string, skills: string[] | '*', targets: Array<'claude-code' | 'codex'> = ['claude-code', 'codex'], audit?: Component['audit']): Component => ({ id, name: id, kind: 'skill', agents: 'both', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'recommended', defaultSelected: true, audit, spec: { kind: 'skill', repo, skills, targets } });
const auditFetch = (level: 'pass' | 'warn' | 'fail') => (async () => new Response(JSON.stringify({ gen: { status: level === 'fail' ? 'fail' : 'pass' }, snyk: { status: level === 'warn' ? 'warn' : 'pass' } }))) as unknown as typeof fetch;
function withLock(ctx: ReturnType<typeof makeTestCtx>, skills: Record<string, { source: string; skillFolderHash?: string }>) { mkdirSync(join(ctx.host.home, '.agents'), { recursive: true }); writeFileSync(join(ctx.host.home, '.agents', '.skill-lock.json'), JSON.stringify({ version: 3, skills })); }
describe('skillProvider', () => {
  it('detects from the lock file', async () => {
    const ctx = makeTestCtx({ responses: { 'node --version': 'v24.19.0' } }); withLock(ctx, { 'find-skills': { source: 'vercel-labs/skills', skillFolderHash: 'abcdef1234' } });
    expect(await skillProvider.detect(skill('sk-find', 'vercel-labs/skills', ['find-skills']), ctx)).toEqual({ version: 'abcdef1' });
    expect(await skillProvider.detect(skill('sk-x', 'a/b', ['nope']), ctx)).toBeNull();
    expect(await skillProvider.detect(skill('sk-all', 'vercel-labs/skills', '*'), ctx)).toMatchObject({ version: 'abcdef1' });
  });
  it('installs with audit pass and adds --copy on Windows without developer mode', async () => {
    const cmd = `npx -y skills@${SKILLS_CLI} add mattpocock/skills --skill grill-me --skill tdd -g -a claude-code -a codex -y`;
    const ctx = makeTestCtx({ fetch: auditFetch('pass'), responses: { 'node --version': 'v24.19.0', [cmd]: 'installed' } });
    const r = await (await skillProvider.plan(skill('sk-mp', 'mattpocock/skills', ['grill-me', 'tdd']), ctx, null, 'install'))[0]!.run(ctx); expect(r.ok).toBe(true);
    const win = makeTestCtx({ host: { platform: 'windows', windowsDeveloperMode: false }, fetch: auditFetch('pass'), responses: { 'node --version': 'v24.19.0', [`${cmd} --copy`]: 'installed' } });
    expect((await (await skillProvider.plan(skill('sk-mp', 'mattpocock/skills', ['grill-me', 'tdd']), win, null, 'install'))[0]!.run(win)).ok).toBe(true);
  });
  it('blocks on audit fail unless --no-audit, warns on warn', async () => {
    const ctx = makeTestCtx({ fetch: auditFetch('fail'), responses: { 'node --version': 'v24.19.0' } });
    const r = await (await skillProvider.plan(skill('sk-bad', 'evil/skills', ['x']), ctx, null, 'install'))[0]!.run(ctx); expect(r.ok).toBe(false); expect(r.message).toMatch(/--no-audit/);
    const warn = makeTestCtx({ fetch: auditFetch('warn'), responses: { 'node --version': 'v24.19.0', [`npx -y skills@${SKILLS_CLI} add a/b --skill x -g -a codex -y`]: '' } });
    expect((await (await skillProvider.plan(skill('sk-w', 'a/b', ['x'], ['codex']), warn, null, 'install'))[0]!.run(warn)).ok).toBe(true);
    expect(warn.log.lines.some((l) => /WARN.*audit/.test(l))).toBe(true);
  });
  it('updates once per run and removes on uninstall', async () => {
    const ctx = makeTestCtx({ responses: { 'node --version': 'v24.19.0', [`npx -y skills@${SKILLS_CLI} update -g -y`]: '✓ All global skills are up to date', [`npx -y skills@${SKILLS_CLI} remove x -g -y`]: '' } }); withLock(ctx, { x: { source: 'a/b' } });
    const c = skill('sk', 'a/b', ['x']); const inst = await skillProvider.detect(c, ctx);
    const r = await (await skillProvider.plan(c, ctx, inst, 'update'))[0]!.run(ctx); expect(r).toMatchObject({ ok: true, changed: false });
    await (await skillProvider.plan(skill('sk2', 'a/b', ['x']), ctx, inst, 'update'))[0]!.run(ctx); expect(ctx.calls.filter((a) => a.includes('update')).length).toBe(1);
    await (await skillProvider.plan(c, ctx, inst, 'uninstall'))[0]!.run(ctx); expect(ctx.calls).toContainEqual(['npx', '-y', `skills@${SKILLS_CLI}`, 'remove', 'x', '-g', '-y']);
  });
  it('skips without node', async () => { const ctx = makeTestCtx({ responses: {} }); expect((await skillProvider.plan(skill('sk', 'a/b', ['x']), ctx, null, 'install'))[0]).toMatchObject({ op: 'skip' }); });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/providers/skill.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/providers/skill.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { SKILLS_CLI } from '../pins.js';
import { probeVersion } from '../detect/tools.js';
import { auditSkill, auditVerdict, type AuditResult } from '../audit/skills-audit.js';
import { action, ok, fail, skipAction } from './types.js';
type Lock = Record<string, { source: string; skillPath?: string; skillFolderHash?: string }>;
export async function readSkillLock(path: string): Promise<Lock> { try { return ((JSON.parse(await readFile(path, 'utf8')) as { skills?: Lock }).skills) ?? {}; } catch { return {}; } }
const updatedOnce = new WeakSet<Ctx>();
const npx = (...a: string[]) => ['npx', '-y', `skills@${SKILLS_CLI}`, ...a];
export const skillProvider: Provider = {
  kind: 'skill',
  async detect(c, ctx) {
    if (c.spec.kind !== 'skill') return null; const lock = await readSkillLock(join(ctx.host.home, '.agents', '.skill-lock.json'));
    const entries = c.spec.skills === '*' ? Object.values(lock).filter((e) => e.source === (c.spec as { repo: string }).repo) : c.spec.skills.map((s) => lock[s]).filter((e): e is Lock[string] => !!e);
    const want = c.spec.skills === '*' ? 1 : c.spec.skills.length; if (entries.length < want) return null;
    return { version: entries[0]?.skillFolderHash?.slice(0, 7) ?? 'installed' };
  },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'skill') return []; const spec = c.spec;
    if (!(await probeVersion(ctx.run, ['node', '--version']))) return [skipAction(c.id, 'Node.js is required for the skills CLI (select the node tool)')];
    const named = spec.skills === '*' ? null : spec.skills;
    if (mode === 'uninstall') {
      if (!installed) return [];
      return [action(c.id, 'uninstall', `remove skills from ${spec.repo}`, async () => {
        const lock = await readSkillLock(join(ctx.host.home, '.agents', '.skill-lock.json'));
        const names = named ?? Object.entries(lock).filter(([, e]) => e.source === spec.repo).map(([n]) => n);
        for (const n of names) await ctx.run(npx('remove', n, '-g', '-y'), { allowFailure: true, timeoutMs: 300000 });
        return ok(`removed ${names.join(', ')}`);
      })];
    }
    if (installed) {
      if (mode !== 'update') return [];
      return [action(c.id, 'update', 'update global skills (skills CLI)', async () => {
        if (updatedOnce.has(ctx)) return ok('global skills already updated this run', false); updatedOnce.add(ctx);
        const r = await ctx.run(npx('update', '-g', '-y'), { allowFailure: true, timeoutMs: 600000 }); if (r.code !== 0) return fail(`skills update failed: ${(r.stderr || r.stdout).trim()}`);
        return ok(/up to date/i.test(r.stdout) ? 'global skills up to date' : 'global skills updated', !/up to date/i.test(r.stdout));
      }, { from: installed.version, to: null })];
    }
    return [action(c.id, 'install', `install ${named ? named.join(', ') : 'all skills'} from ${spec.repo}`, async () => {
      if (!ctx.noAudit) {
        const targets = c.audit ?? (named ? named.map((s) => { const [owner = '', repo = ''] = spec.repo.replace(/^https:\/\/github\.com\//, '').split('/'); return { owner, repo, skill: s }; }) : []);
        const results: AuditResult[] = []; for (const t of targets) results.push(await auditSkill(ctx.fetch, t.owner, t.repo, t.skill));
        const v = auditVerdict(results);
        if (v === 'fail') return fail(`skills.sh audit FAILED for ${spec.repo}: ${results.map((r) => JSON.stringify(r.scanners)).join(' ')}. Rerun with --no-audit to override.`);
        if (v === 'warn') ctx.log.warn(`skills.sh audit warnings for ${spec.repo}: ${results.map((r) => `${r.riskLevel ?? ''} ${JSON.stringify(r.scanners)}`).join(' ')}`);
        if (v === 'unknown' && targets.length) ctx.log.warn(`skills.sh audit unavailable for ${spec.repo}`);
      }
      const argv = npx('add', spec.repo, ...(named ? named.flatMap((s) => ['--skill', s]) : ['--skill', '*']), '-g', ...spec.targets.flatMap((t) => ['-a', t]), '-y');
      if (ctx.host.platform === 'windows' && ctx.host.windowsDeveloperMode === false) argv.push('--copy');
      const r = await ctx.run(argv, { allowFailure: true, timeoutMs: 600000 }); if (r.code !== 0) return fail(`skills add failed: ${(r.stderr || r.stdout).trim()}`);
      return ok(`installed ${named ? named.join(', ') : spec.repo}`);
    })];
  },
};
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/providers/skill.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/skill.ts test/providers/skill.test.ts
git commit -m "feat(provider): skills via the skills CLI with audit gate, lockfile detection and global update"
```

---

### Task 18: Claude MCP provider

**Files:**
- Create: `src/providers/mcp-claude.ts`
- Test: `test/providers/mcp-claude.test.ts`

**Interfaces:**
- Produces: `mcpClaudeProvider` (object, not registered directly; Task 19 creates the combined `mcpProvider`). Behaviour for `spec.target === 'claude'`:
  - detect: `getClaudeState(ctx).mcp[spec.name]` -> `{ version: null, details: cfg }`.
  - desired JSON: http -> `{ type: 'http', url, headers?: { Authorization: 'Bearer ${<bearerEnv>}' } }` (when `bearerEnv`), plus `oauth` when given; stdio -> `{ type: 'stdio', command, args, env }` where on Windows a `command` of `npx`/`uvx` becomes `{ command: 'cmd', args: ['/c', command, ...args] }`; secret env entries are written as `${VAR}` references (never literal values).
  - install when missing; `configure` when present but `JSON.stringify(desired) !== JSON.stringify(existing)` (compare after sorting keys); both run: `claude mcp remove -s user <name>` (allowFailure) then `claude mcp add-json <name> '<json>' -s user`. Skip when identical. No update op (config-only).
  - uninstall: `claude mcp remove -s user <name>`.
  - Secrets: for each `secretEnv` var not present in `ctx.env` and not in `ctx.secrets`, add to the action result message an instruction `export VAR=...` (Windows `setx VAR ...`) and log a warning; still install (references are inert until set).

- [ ] **Step 1: Write failing tests**

`test/providers/mcp-claude.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { mcpClaudeProvider, desiredClaudeMcp } from '../../src/providers/mcp-claude.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const mcp = (spec: Partial<Extract<Component['spec'], { kind: 'mcp' }>>, secrets?: Component['secrets']): Component => ({ id: `mcp-${spec.name}`, name: spec.name ?? 'x', kind: 'mcp', agents: 'claude', platforms: ['linux', 'windows'], description: '', verdict: 'optional', defaultSelected: false, secrets, spec: { kind: 'mcp', target: 'claude', name: 'x', transport: 'http', ...spec } });
function ctxWith(existing: Record<string, unknown>, extra: Record<string, string> = {}, host = {}) { const ctx = makeTestCtx({ host, responses: { 'claude --version': '2.1.274 (Claude Code)', 'claude plugin list --json': '[]', ...extra } }); writeFileSync(ctx.paths.claudeJson, JSON.stringify({ mcpServers: existing })); return ctx; }
describe('mcpClaudeProvider', () => {
  it('builds desired json with env references and windows cmd wrapping', () => {
    expect(desiredClaudeMcp({ kind: 'mcp', target: 'claude', name: 'gh', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', bearerEnv: 'GITHUB_PAT' }, 'linux')).toEqual({ type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_PAT}' } });
    expect(desiredClaudeMcp({ kind: 'mcp', target: 'claude', name: 'k8s', transport: 'stdio', command: 'npx', args: ['-y', 'kubernetes-mcp-server@latest', '--read-only'] }, 'windows')).toEqual({ type: 'stdio', command: 'cmd', args: ['/c', 'npx', '-y', 'kubernetes-mcp-server@latest', '--read-only'] });
    expect(desiredClaudeMcp({ kind: 'mcp', target: 'claude', name: 'p', transport: 'stdio', command: 'uvx', args: ['proxmox-mcp-plus'], secretEnv: ['PROXMOX_TOKEN_VALUE'], env: { PROXMOX_HOST: 'pve' } }, 'linux')).toEqual({ type: 'stdio', command: 'uvx', args: ['proxmox-mcp-plus'], env: { PROXMOX_HOST: 'pve', PROXMOX_TOKEN_VALUE: '${PROXMOX_TOKEN_VALUE}' } });
  });
  it('installs with remove-then-add-json and skips when identical', async () => {
    const c = mcp({ name: 'exa', url: 'https://mcp.exa.ai/mcp' });
    const ctx = ctxWith({}, { 'claude mcp remove -s user exa': '', 'claude mcp add-json exa {"type":"http","url":"https://mcp.exa.ai/mcp"} -s user': '' });
    const acts = await mcpClaudeProvider.plan(c, ctx, await mcpClaudeProvider.detect(c, ctx), 'install'); expect(acts[0]).toMatchObject({ op: 'install' }); expect((await acts[0]!.run(ctx)).ok).toBe(true);
    expect(ctx.calls).toContainEqual(['claude', 'mcp', 'remove', '-s', 'user', 'exa']);
    const same = ctxWith({ exa: { type: 'http', url: 'https://mcp.exa.ai/mcp' } });
    expect(await mcpClaudeProvider.plan(c, same, await mcpClaudeProvider.detect(c, same), 'install')).toEqual([]);
    const diff = ctxWith({ exa: { type: 'http', url: 'https://old' } }, { 'claude mcp remove -s user exa': '', 'claude mcp add-json exa {"type":"http","url":"https://mcp.exa.ai/mcp"} -s user': '' });
    expect((await mcpClaudeProvider.plan(c, diff, await mcpClaudeProvider.detect(c, diff), 'update'))[0]).toMatchObject({ op: 'configure' });
  });
  it('warns about unset secret env vars but still installs', async () => {
    const c = mcp({ name: 'gh', url: 'https://api.githubcopilot.com/mcp/', bearerEnv: 'GITHUB_PAT', secretEnv: ['GITHUB_PAT'] }, [{ env: 'GITHUB_PAT', prompt: 'GitHub PAT', required: false }]);
    const ctx = ctxWith({}, { 'claude mcp remove -s user gh': '', 'claude mcp add-json gh {"type":"http","url":"https://api.githubcopilot.com/mcp/","headers":{"Authorization":"Bearer ${GITHUB_PAT}"}} -s user': '' });
    const r = await (await mcpClaudeProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx); expect(r.ok).toBe(true); expect(r.message).toMatch(/export GITHUB_PAT=/);
  });
  it('uninstalls', async () => { const c = mcp({ name: 'exa', url: 'https://x' }); const ctx = ctxWith({ exa: {} }, { 'claude mcp remove -s user exa': '' }); await (await mcpClaudeProvider.plan(c, ctx, { version: null }, 'uninstall'))[0]!.run(ctx); expect(ctx.calls).toContainEqual(['claude', 'mcp', 'remove', '-s', 'user', 'exa']); });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/providers/mcp-claude.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/providers/mcp-claude.ts`:
```ts
import type { Action, Component, Ctx, Installed, McpSpec, Platform, Provider } from '../types.js';
import { getClaudeState } from './claude-plugin.js';
import { action, ok, skipAction } from './types.js';
const sortKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : v);
export function desiredClaudeMcp(spec: McpSpec, platform: Platform): Record<string, unknown> {
  if (spec.transport === 'http') { const o: Record<string, unknown> = { type: 'http', url: spec.url }; if (spec.bearerEnv) o.headers = { Authorization: `Bearer \${${spec.bearerEnv}}` }; if (spec.oauth) o.oauth = spec.oauth; return o; }
  let command = spec.command ?? ''; let args = [...(spec.args ?? [])];
  if (platform === 'windows' && ['npx', 'uvx', 'npm', 'node'].includes(command) && command !== 'node') { args = ['/c', command, ...args]; command = 'cmd'; }
  const env: Record<string, string> = { ...(spec.env ?? {}) }; for (const v of spec.secretEnv ?? []) env[v] = `\${${v}}`;
  const o: Record<string, unknown> = { type: 'stdio', command, args }; if (Object.keys(env).length) o.env = env; return o;
}
export function secretHints(c: Component, ctx: Ctx): string {
  const missing = (c.spec.kind === 'mcp' ? c.spec.secretEnv ?? [] : []).filter((v) => !ctx.env[v] && !ctx.secrets.has(v));
  if (!missing.length) return ''; const w = ctx.host.platform === 'windows';
  return ` Set before use: ${missing.map((v) => (w ? `setx ${v} "<value>"` : `export ${v}=<value>`)).join('; ')}`;
}
export const mcpClaudeProvider: Provider = {
  kind: 'mcp',
  async detect(c, ctx) { if (c.spec.kind !== 'mcp') return null; const st = await getClaudeState(ctx); if (!st.installed) return null; const cfg = st.mcp[c.spec.name]; return cfg ? { version: null, details: cfg as Record<string, unknown> } : null; },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'mcp') return []; const spec = c.spec; const st = await getClaudeState(ctx); if (!st.installed) return [skipAction(c.id, 'Claude Code not installed')];
    const remove = () => ctx.run(['claude', 'mcp', 'remove', '-s', 'user', spec.name], { allowFailure: true });
    if (mode === 'uninstall') return installed ? [action(c.id, 'uninstall', `remove MCP ${spec.name} (Claude)`, async () => { await remove(); return ok(`${spec.name} removed`); })] : [];
    const desired = desiredClaudeMcp(spec, ctx.host.platform);
    if (installed && JSON.stringify(sortKeys(installed.details)) === JSON.stringify(sortKeys(desired))) return [];
    const op = installed ? 'configure' : 'install';
    return [action(c.id, op, `${op} MCP ${spec.name} (Claude, user scope)`, async () => {
      for (const v of spec.secretEnv ?? []) if (!ctx.env[v] && !ctx.secrets.has(v)) ctx.log.warn(`${spec.name}: ${v} is not set; the server will not authenticate until you export it`);
      await remove(); await ctx.run(['claude', 'mcp', 'add-json', spec.name, JSON.stringify(desired), '-s', 'user'], { timeoutMs: 120000 });
      return ok(`${spec.name} configured for Claude.${secretHints(c, ctx)}`);
    })];
  },
};
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/providers/mcp-claude.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/mcp-claude.ts test/providers/mcp-claude.test.ts
git commit -m "feat(provider): Claude MCP servers via remove-then-add-json upsert with env references"
```

---

### Task 19: Codex MCP provider and combined MCP provider

**Files:**
- Create: `src/providers/mcp-codex.ts`, `src/providers/mcp.ts`
- Test: `test/providers/mcp-codex.test.ts`

**Interfaces:**
- Produces: `mcpCodexProvider`, `desiredCodexMcp(spec): Record<string, unknown>` (TOML table: http -> `{ url, bearer_token_env_var? }`; stdio -> `{ command, args, env?, env_vars? }` where `secretEnv` names go to `env_vars` (forwarded from the parent environment) and `spec.extra` keys (`startup_timeout_sec`, `enabled_tools`, ...) are merged); `mcpProvider: Provider` dispatching on `spec.target`. Behaviour:
  - detect: `getCodexState(ctx).mcp[spec.name]`.
  - install/configure when table differs (`tomlTableEquals`): run `codex mcp add <name> --url <url> [--bearer-token-env-var VAR]` for http (never without a bearer var for URLs that may start OAuth: when `bearerEnv` is absent and `spec.oauth` is absent, still add; log that `codex mcp login <name>` may be required); stdio: `codex mcp add <name> [--env K=V]... -- <command> <args...>`; then, if `spec.extra` or `env_vars` are needed, write them by re-reading `config.toml`, setting the keys under `mcp_servers.<name>` and writing via a dedicated helper `patchCodexTable(ctx, name, patch)` that uses `smol-toml` parse/stringify of the WHOLE file only when the file has no comments (detect `#` outside strings); if the file has comments, write a marker block containing `[mcp_servers.<name>]` overrides is NOT possible (duplicate table), so instead log a warning with the exact TOML lines to add manually. Validate with `codex mcp get <name> --json` (exit 0) afterwards.
  - Codex MCP count cap: the planner does not enforce; the picker warns (Task 26).
  - uninstall: `codex mcp remove <name>`.
  - **Verification step inside this task:** run `codex mcp add --help` on this host and confirm the `--env` and `--bearer-token-env-var` flags and the `--` separator; grep `~/.codex/config.toml` docs (`https://learn.chatgpt.com/docs/config-reference.md`) for `env_vars`; if `env_vars` is not documented for stdio servers, keep writing it only when documented and otherwise log the export instructions (like Claude).

- [ ] **Step 1: Verify CLI surface (read-only)**

Run: `codex mcp add --help | sed -n '1,60p'` and `curl -fsSL https://learn.chatgpt.com/docs/config-reference.md | grep -n -i 'env_vars\|bearer_token_env_var\|startup_timeout_sec' | head`
Expected: `--env <KEY=VALUE>`, `--bearer-token-env-var`, `--url`, and `-- <COMMAND>...` present; note whether `env_vars` appears. Record the outcome in a comment at the top of `mcp-codex.ts`.

- [ ] **Step 2: Write failing tests**

`test/providers/mcp-codex.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { mcpCodexProvider, desiredCodexMcp } from '../../src/providers/mcp-codex.js';
import { mcpProvider } from '../../src/providers/mcp.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const mcp = (spec: Partial<Extract<Component['spec'], { kind: 'mcp' }>>): Component => ({ id: `mcp-cx-${spec.name}`, name: spec.name ?? 'x', kind: 'mcp', agents: 'codex', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: false, spec: { kind: 'mcp', target: 'codex', name: 'x', transport: 'http', ...spec } });
function ctxWith(toml: string, extra: Record<string, string> = {}) { const ctx = makeTestCtx({ responses: { 'codex --version': 'codex-cli 0.154.0', 'codex plugin list --json': '{"installed":[]}', 'codex mcp list --json': '[]', ...extra } }); writeFileSync(ctx.paths.codexConfig, toml); return ctx; }
describe('mcpCodexProvider', () => {
  it('builds desired tables', () => {
    expect(desiredCodexMcp({ kind: 'mcp', target: 'codex', name: 'gh', transport: 'http', url: 'https://api.githubcopilot.com/mcp/readonly', bearerEnv: 'GITHUB_PAT_TOKEN' })).toEqual({ url: 'https://api.githubcopilot.com/mcp/readonly', bearer_token_env_var: 'GITHUB_PAT_TOKEN' });
    expect(desiredCodexMcp({ kind: 'mcp', target: 'codex', name: 'c7', transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], extra: { startup_timeout_sec: 20 } })).toEqual({ command: 'npx', args: ['-y', '@upstash/context7-mcp'], startup_timeout_sec: 20 });
  });
  it('adds http servers with bearer env and skips when identical', async () => {
    const c = mcp({ name: 'gh', url: 'https://api.githubcopilot.com/mcp/readonly', bearerEnv: 'GITHUB_PAT_TOKEN' });
    const ctx = ctxWith('', { 'codex mcp add gh --url https://api.githubcopilot.com/mcp/readonly --bearer-token-env-var GITHUB_PAT_TOKEN': '', 'codex mcp get gh --json': '{}' });
    expect((await (await mcpCodexProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx)).ok).toBe(true);
    const same = ctxWith('[mcp_servers.gh]\nurl = "https://api.githubcopilot.com/mcp/readonly"\nbearer_token_env_var = "GITHUB_PAT_TOKEN"\n');
    expect(await mcpCodexProvider.plan(c, same, await mcpCodexProvider.detect(c, same), 'install')).toEqual([]);
  });
  it('adds stdio servers with --env and -- separator, then patches extra keys into a comment-free file', async () => {
    const c = mcp({ name: 'c7', transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], env: { A: '1' }, extra: { startup_timeout_sec: 20 } });
    const ctx = ctxWith('model = "gpt-5.6-sol"\n', { 'codex mcp add c7 --env A=1 -- npx -y @upstash/context7-mcp': '', 'codex mcp get c7 --json': '{}' });
    const r = await (await mcpCodexProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx); expect(r.ok).toBe(true);
    expect(ctx.calls).toContainEqual(['codex', 'mcp', 'add', 'c7', '--env', 'A=1', '--', 'npx', '-y', '@upstash/context7-mcp']);
    expect(readFileSync(ctx.paths.codexConfig, 'utf8')).toContain('startup_timeout_sec = 20');
  });
  it('does not rewrite a commented file; prints manual lines instead', async () => {
    const c = mcp({ name: 'c7', transport: 'stdio', command: 'npx', args: ['x'], extra: { startup_timeout_sec: 20 } });
    const ctx = ctxWith('# my comment\nmodel = "gpt-5.6-sol"\n', { 'codex mcp add c7 -- npx x': '', 'codex mcp get c7 --json': '{}' });
    const r = await (await mcpCodexProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true); expect(r.message).toMatch(/startup_timeout_sec = 20/); expect(readFileSync(ctx.paths.codexConfig, 'utf8')).toContain('# my comment');
  });
  it('removes on uninstall and mcpProvider dispatches by target', async () => {
    const c = mcp({ name: 'gh', url: 'https://x' }); const ctx = ctxWith('[mcp_servers.gh]\nurl = "https://x"\n', { 'codex mcp remove gh': '' });
    await (await mcpProvider.plan(c, ctx, await mcpProvider.detect(c, ctx), 'uninstall'))[0]!.run(ctx); expect(ctx.calls).toContainEqual(['codex', 'mcp', 'remove', 'gh']);
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `bunx vitest run test/providers/mcp-codex.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

`src/providers/mcp-codex.ts`:
```ts
// Verified on codex-cli 0.154.0 (2026-09-17): `codex mcp add <NAME> (--url <URL> [--bearer-token-env-var VAR] | [--env K=V]... -- <COMMAND> [ARGS]...)`.
// env_vars forwarding for stdio servers: record the Step 1 finding here (documented or not) and set ENV_VARS_SUPPORTED accordingly. When not documented, secret env vars are only printed as export instructions.
import { readFile } from 'node:fs/promises';
import { parse, stringify } from 'smol-toml';
import type { Action, Component, Ctx, Installed, McpSpec, Provider } from '../types.js';
import { getCodexState } from './codex-plugin.js';
import { tomlTableEquals, TomlError } from '../config/toml.js';
import { backupFile, writeJsonAtomic } from '../config/json.js';
import { writeFile, rename, stat, chmod, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { action, ok, fail, skipAction } from './types.js';
import { secretHints } from './mcp-claude.js';
export const ENV_VARS_SUPPORTED = false; // set to true only if Step 1 found env_vars documented for mcp_servers
export function desiredCodexMcp(spec: McpSpec): Record<string, unknown> {
  if (spec.transport === 'http') { const o: Record<string, unknown> = { url: spec.url }; if (spec.bearerEnv) o.bearer_token_env_var = spec.bearerEnv; return { ...o, ...(spec.extra ?? {}) }; }
  const o: Record<string, unknown> = { command: spec.command, args: spec.args ?? [] }; if (spec.env && Object.keys(spec.env).length) o.env = spec.env;
  if (ENV_VARS_SUPPORTED && spec.secretEnv?.length) o.env_vars = spec.secretEnv; return { ...o, ...(spec.extra ?? {}) };
}
function hasComments(text: string): boolean { return text.split('\n').some((l) => /^\s*#/.test(l) || /"[^"]*"\s*#|'[^']*'\s*#|=\s*[^"'#\n]*#/.test(l)); }
async function patchCodexTable(ctx: Ctx, name: string, patch: Record<string, unknown>): Promise<{ applied: boolean; manual: string }> {
  const manual = stringify({ mcp_servers: { [name]: patch } }).trim();
  let text = ''; try { text = await readFile(ctx.paths.codexConfig, 'utf8'); } catch { text = ''; }
  if (hasComments(text)) return { applied: false, manual };
  let doc: Record<string, unknown>; try { doc = parse(text) as Record<string, unknown>; } catch (e) { throw new TomlError((e as Error).message); }
  const servers = ((doc.mcp_servers as Record<string, Record<string, unknown>>) ?? {}); servers[name] = { ...(servers[name] ?? {}), ...patch }; doc.mcp_servers = servers;
  if (ctx.dryRun) return { applied: true, manual };
  await backupFile(ctx.paths.codexConfig, ctx.paths.backupsDir);
  let mode = 0o600; try { mode = (await stat(ctx.paths.codexConfig)).mode & 0o777; } catch { /* new */ }
  const tmp = join(dirname(ctx.paths.codexConfig), `.${basename(ctx.paths.codexConfig)}.${process.pid}.tmp`);
  try { await writeFile(tmp, stringify(doc), { encoding: 'utf8', mode }); if (process.platform !== 'win32') await chmod(tmp, mode); await rename(tmp, ctx.paths.codexConfig); } catch (e) { try { await unlink(tmp); } catch { /* ignore */ } throw e; }
  return { applied: true, manual };
}
export const mcpCodexProvider: Provider = {
  kind: 'mcp',
  async detect(c, ctx) { if (c.spec.kind !== 'mcp') return null; const st = await getCodexState(ctx); if (!st.installed) return null; const t = st.mcp[c.spec.name]; return t ? { version: null, details: t } : null; },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'mcp') return []; const spec = c.spec; const st = await getCodexState(ctx); if (!st.installed) return [skipAction(c.id, 'Codex CLI not installed')];
    if (mode === 'uninstall') return installed ? [action(c.id, 'uninstall', `remove MCP ${spec.name} (Codex)`, async () => { await ctx.run(['codex', 'mcp', 'remove', spec.name], { allowFailure: true }); return ok(`${spec.name} removed`); })] : [];
    const desired = desiredCodexMcp(spec);
    if (installed && tomlTableEquals(installed.details, desired)) return [];
    const op = installed ? 'configure' : 'install';
    return [action(c.id, op, `${op} MCP ${spec.name} (Codex)`, async () => {
      const argv = ['codex', 'mcp', 'add', spec.name];
      if (spec.transport === 'http') { argv.push('--url', spec.url!); if (spec.bearerEnv) argv.push('--bearer-token-env-var', spec.bearerEnv); else if (!spec.oauth) ctx.log.warn(`${spec.name}: no bearer env var; if the server needs auth run: codex mcp login ${spec.name}`); }
      else { for (const [k, v] of Object.entries(spec.env ?? {})) argv.push('--env', `${k}=${v}`); argv.push('--', spec.command!, ...(spec.args ?? [])); }
      await ctx.run(argv, { timeoutMs: 120000 });
      const extra: Record<string, unknown> = { ...(spec.extra ?? {}) }; if (ENV_VARS_SUPPORTED && spec.secretEnv?.length) extra.env_vars = spec.secretEnv;
      let note = '';
      if (Object.keys(extra).length) { const r = await patchCodexTable(ctx, spec.name, extra); if (!r.applied) note = ` config.toml has comments, so extra keys were not written automatically. Add under [mcp_servers.${spec.name}]:\n${r.manual}`; }
      const chk = await ctx.run(['codex', 'mcp', 'get', spec.name, '--json'], { readOnly: true, allowFailure: true }); if (chk.code !== 0 && !ctx.dryRun) return fail(`codex cannot read ${spec.name} after write: ${(chk.stderr || chk.stdout).trim()}`);
      return ok(`${spec.name} configured for Codex.${secretHints(c, ctx)}${note}`);
    })];
  },
};
```

`src/providers/mcp.ts`:
```ts
import type { Provider } from '../types.js';
import { mcpClaudeProvider } from './mcp-claude.js';
import { mcpCodexProvider } from './mcp-codex.js';
const pick = (c: { spec: { kind: string; target?: string } }) => (c.spec.kind === 'mcp' && c.spec.target === 'codex' ? mcpCodexProvider : mcpClaudeProvider);
export const mcpProvider: Provider = { kind: 'mcp', detect: (c, ctx) => pick(c).detect(c, ctx), plan: (c, ctx, i, m) => pick(c).plan(c, ctx, i, m) };
```

- [ ] **Step 5: Run tests**

Run: `bunx vitest run test/providers/mcp-codex.test.ts`
Expected: PASS (5 tests). Remove the unused `writeJsonAtomic` import if the linter/typecheck flags it.

- [ ] **Step 6: Commit**

```bash
git add src/providers/mcp-codex.ts src/providers/mcp.ts test/providers/mcp-codex.test.ts
git commit -m "feat(provider): Codex MCP servers with compare-then-add, bearer env vars and extra-key patching"
```

---

### Task 20: Setting provider (Claude settings.json patches, Codex TOML block, features, git config)

**Files:**
- Create: `src/providers/setting.ts`
- Test: `test/providers/setting.test.ts`

**Interfaces:**
- Produces: `settingProvider: Provider` (kind `setting`). Behaviour:
  - Claude (`spec.claudeSettings`): detect = every key of the patch already deep-equal in `settings.json` (`null` means key absent); install/update = `mergeClaudeSettings` + backup + `writeJsonAtomic`; uninstall = remove the top-level keys the patch introduced (only those whose current value deep-equals the patch value).
  - Codex `codexFeatures`: `codex features enable <name>` / `disable`; detect via `config.features[name]`.
  - Codex `codexToml`: managed marker block via `writeTomlMarkerBlock`; detect = each key path deep-equal in parsed config; uninstall = `removeMarkerBlock` (write via the same atomic path helper: add `removeTomlMarkerBlock(path, backupsDir)` to `src/config/toml.ts` in this task, using `removeMarkerBlock` + parse validation + atomic write).
  - `windowsGitConfig`: on Windows only, `git config --global <k> <v>`; detect via `git config --global --get <k>`.
  - Skip when the target agent is not installed (via `getClaudeState`/`getCodexState`).

- [ ] **Step 1: Write failing tests**

`test/providers/setting.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { settingProvider } from '../../src/providers/setting.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const setting = (id: string, spec: Partial<Extract<Component['spec'], { kind: 'setting' }>>): Component => ({ id, name: id, kind: 'setting', agents: spec.target === 'codex' ? 'codex' : 'claude', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'optional', defaultSelected: false, spec: { kind: 'setting', target: 'claude', ...spec } });
const base = { 'claude --version': '2.1.274 (Claude Code)', 'claude plugin list --json': '[]', 'codex --version': 'codex-cli 0.154.0', 'codex plugin list --json': '{"installed":[]}', 'codex mcp list --json': '[]' };
describe('settingProvider', () => {
  it('applies a Claude settings patch idempotently and removes it on uninstall', async () => {
    const ctx = makeTestCtx({ responses: base }); writeFileSync(ctx.paths.claudeSettings, JSON.stringify({ model: 'opus' }));
    const c = setting('set-channel', { claudeSettings: { autoUpdatesChannel: 'latest' } });
    expect(await settingProvider.detect(c, ctx)).toBeNull();
    await (await settingProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(JSON.parse(readFileSync(ctx.paths.claudeSettings, 'utf8'))).toEqual({ model: 'opus', autoUpdatesChannel: 'latest' });
    expect(await settingProvider.detect(c, ctx)).toEqual({ version: null }); expect(await settingProvider.plan(c, ctx, { version: null }, 'update')).toEqual([]);
    await (await settingProvider.plan(c, ctx, { version: null }, 'uninstall'))[0]!.run(ctx); expect(JSON.parse(readFileSync(ctx.paths.claudeSettings, 'utf8'))).toEqual({ model: 'opus' });
  });
  it('enables codex features and writes a TOML marker block', async () => {
    const ctx = makeTestCtx({ responses: { ...base, 'codex features enable memories': '' } }); writeFileSync(ctx.paths.codexConfig, 'model = "x"\n');
    const f = setting('set-mem', { target: 'codex', codexFeatures: { memories: true } });
    await (await settingProvider.plan(f, ctx, null, 'install'))[0]!.run(ctx); expect(ctx.calls).toContainEqual(['codex', 'features', 'enable', 'memories']);
    const t = setting('set-trust', { target: 'codex', codexToml: { projects: { [ctx.host.home]: { trust_level: 'trusted' } } } });
    await (await settingProvider.plan(t, ctx, null, 'install'))[0]!.run(ctx);
    const text = readFileSync(ctx.paths.codexConfig, 'utf8'); expect(text).toContain('# >>> super-agent-installer >>>'); expect(text).toContain('trust_level = "trusted"');
    expect(await settingProvider.detect(t, ctx)).toEqual({ version: null });
    await (await settingProvider.plan(t, ctx, { version: null }, 'uninstall'))[0]!.run(ctx); expect(readFileSync(ctx.paths.codexConfig, 'utf8')).toBe('model = "x"\n');
  });
  it('sets windows git config only on windows', async () => {
    const win = makeTestCtx({ host: { platform: 'windows' }, responses: { ...base, 'git config --global --get core.symlinks': { code: 1 }, 'git config --global core.symlinks true': '' } });
    const c = setting('set-symlinks', { target: 'claude', windowsGitConfig: { 'core.symlinks': 'true' } });
    await (await settingProvider.plan(c, win, null, 'install'))[0]!.run(win); expect(win.calls).toContainEqual(['git', 'config', '--global', 'core.symlinks', 'true']);
    const lin = makeTestCtx({ responses: base }); expect(await settingProvider.plan(c, lin, null, 'install')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/providers/setting.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `src/config/toml.ts`:
```ts
import { removeMarkerBlock } from './markers.js';
export async function removeTomlMarkerBlock(path: string, backupsDir: string): Promise<{ changed: boolean }> {
  let text = ''; try { text = await readFile(path, 'utf8'); } catch { return { changed: false }; }
  const next = removeMarkerBlock(text, 'hash'); if (next === text.replace(/\r\n/g, '\n')) return { changed: false };
  try { parse(next); } catch (e) { throw new TomlError(`refusing to write ${path}: ${(e as Error).message}`); }
  await backupFile(path, backupsDir);
  let mode = 0o600; try { mode = (await stat(path)).mode & 0o777; } catch { /* new */ }
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try { await writeFile(tmp, next, { encoding: 'utf8', mode }); if (process.platform !== 'win32') await chmod(tmp, mode); await rename(tmp, path); } catch (e) { try { await unlink(tmp); } catch { /* ignore */ } throw e; }
  return { changed: true };
}
```

`src/providers/setting.ts`:
```ts
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { readJsonFile, writeJsonAtomic, backupFile, mergeClaudeSettings } from '../config/json.js';
import { readToml, writeTomlMarkerBlock, removeTomlMarkerBlock } from '../config/toml.js';
import { getClaudeState } from './claude-plugin.js';
import { getCodexState } from './codex-plugin.js';
import { action, ok, skipAction } from './types.js';
const deepEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function getPath(o: unknown, path: string[]): unknown { let cur = o; for (const k of path) { if (!cur || typeof cur !== 'object') return undefined; cur = (cur as Record<string, unknown>)[k]; } return cur; }
function leaves(o: Record<string, unknown>, prefix: string[] = []): Array<{ path: string[]; value: unknown }> { return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? leaves(v as Record<string, unknown>, [...prefix, k]) : [{ path: [...prefix, k], value: v }])); }
export const settingProvider: Provider = {
  kind: 'setting',
  async detect(c, ctx) {
    if (c.spec.kind !== 'setting') return null; const s = c.spec;
    if (s.windowsGitConfig && ctx.host.platform !== 'windows') return null;
    if (s.claudeSettings) { const cur = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; for (const [k, v] of Object.entries(s.claudeSettings)) { if (v === null ? k in cur : !deepEq(cur[k], v)) return null; } }
    if (s.codexFeatures || s.codexToml) { const cfg = await readToml(ctx.paths.codexConfig); for (const [k, v] of Object.entries(s.codexFeatures ?? {})) if (getPath(cfg, ['features', k]) !== v) return null; for (const l of leaves(s.codexToml ?? {})) if (!deepEq(getPath(cfg, l.path), l.value)) return null; }
    if (s.windowsGitConfig) for (const [k, v] of Object.entries(s.windowsGitConfig)) { const r = await ctx.run(['git', 'config', '--global', '--get', k], { readOnly: true, allowFailure: true }); if (r.code !== 0 || r.stdout.trim() !== v) return null; }
    return { version: null };
  },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'setting') return []; const s = c.spec;
    if (s.windowsGitConfig && ctx.host.platform !== 'windows') return [];
    if (s.target === 'claude' && !(await getClaudeState(ctx)).installed) return [skipAction(c.id, 'Claude Code not installed')];
    if (s.target === 'codex' && !(await getCodexState(ctx)).installed) return [skipAction(c.id, 'Codex CLI not installed')];
    if (mode === 'uninstall') {
      if (!installed) return [];
      return [action(c.id, 'uninstall', `revert ${c.name}`, async () => {
        if (s.claudeSettings) { const cur = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; const next = { ...cur }; for (const [k, v] of Object.entries(s.claudeSettings)) if (v !== null && deepEq(cur[k], v)) delete next[k]; if (!ctx.dryRun) { await backupFile(ctx.paths.claudeSettings, ctx.paths.backupsDir); await writeJsonAtomic(ctx.paths.claudeSettings, next); } }
        for (const [k, v] of Object.entries(s.codexFeatures ?? {})) await ctx.run(['codex', 'features', v ? 'disable' : 'enable', k], { allowFailure: true });
        if (s.codexToml && !ctx.dryRun) await removeTomlMarkerBlock(ctx.paths.codexConfig, ctx.paths.backupsDir);
        return ok(`${c.name} reverted`);
      })];
    }
    if (installed) return [];
    return [action(c.id, 'configure', `apply ${c.name}`, async () => {
      if (s.claudeSettings) { const cur = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; const next = mergeClaudeSettings(cur, s.claudeSettings); if (!ctx.dryRun) { await backupFile(ctx.paths.claudeSettings, ctx.paths.backupsDir); await writeJsonAtomic(ctx.paths.claudeSettings, next); } }
      for (const [k, v] of Object.entries(s.codexFeatures ?? {})) await ctx.run(['codex', 'features', v ? 'enable' : 'disable', k]);
      if (s.codexToml) { const existing = await readToml(ctx.paths.codexConfig); const blockKeys: Record<string, unknown> = {}; for (const [k, v] of Object.entries(s.codexToml)) { if (k in existing && !ctx.dryRun) ctx.log.warn(`${c.name}: top-level [${k}] already exists in config.toml; merging the managed block may fail if keys collide`); blockKeys[k] = v; } if (!ctx.dryRun) await writeTomlMarkerBlock(ctx.paths.codexConfig, blockKeys, ctx.paths.backupsDir); }
      for (const [k, v] of Object.entries(s.windowsGitConfig ?? {})) await ctx.run(['git', 'config', '--global', k, v]);
      return ok(`${c.name} applied`);
    })];
  },
};
```

Note: `writeTomlMarkerBlock` refuses when the same table exists outside the block (test 2 covers `[projects."<home>"]` absent; when present, the provider warns and the write throws a `TomlError`, which the executor reports as a failed step).

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/providers/setting.test.ts test/config/toml.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/setting.ts src/config/toml.ts test/providers/setting.test.ts
git commit -m "feat(provider): settings for Claude JSON patches, Codex features/TOML block and Windows git config"
```

---

### Task 21: Hook provider (caveman native hooks) and statusline provider

**Files:**
- Create: `src/providers/hook.ts`, `src/providers/statusline.ts`, `assets/caveman-statusline.sh`, `assets/caveman-statusline.ps1`
- Test: `test/providers/hook.test.ts`, `test/providers/statusline.test.ts`

**Interfaces:**
- `hookProvider` (kind `hook`, provider `caveman`): detect = for `claude`: settings.json `hooks.SessionStart` contains a handler whose command includes `caveman-proxy` and `native-hook claude`; for `codex`: `~/.codex/hooks.json` exists and contains `caveman`. Install/update: require `caveman` on PATH (`probeVersion(['caveman','--version'])`, else skip with hint to select `caveman-cli`), then `caveman setup --agent-native <agent>` (idempotent per gap-2; on Windows for `codex` -> skipAction "caveman Codex hooks are disabled on Windows"). Uninstall: `caveman setup --agent-native <agent> --remove`.
- `statuslineProvider` (kind `statusline`): `caveman`: copy the bundled `assets/caveman-statusline.sh` (Linux/macOS) or `.ps1` (Windows) to `ctx.paths.claudeHooksDir/`, chmod 755, and merge `statusLine: { type: 'command', command: 'bash "<dir>/caveman-statusline.sh"' }` (Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File "<dir>\caveman-statusline.ps1"`); detect = settings `statusLine.command` contains `caveman-statusline`. `claude-hud`: statusLine is configured by the plugin's own `/claude-hud:setup`; provider only removes a caveman statusLine and prints the hint; detect = `statusLine.command` contains `claude-hud`. Uninstall: remove `statusLine` key when it points at our script.
- The asset scripts: copy the current content of the caveman plugin's `src/hooks/caveman-statusline.sh` and `.ps1` from `~/.claude/plugins/cache/caveman/caveman/*/src/hooks/` on this host into `assets/` (they are MIT-licensed; keep the license header). Bundling: `bun build --compile` embeds files imported via `import x from './file' with { type: 'text' }`; add `src/assets.ts` exporting both strings.

- [ ] **Step 1: Copy assets and create src/assets.ts**

Run: `mkdir -p assets && cp "$(ls -td ~/.claude/plugins/cache/caveman/caveman/*/ | head -1)src/hooks/caveman-statusline.sh" assets/ && cp "$(ls -td ~/.claude/plugins/cache/caveman/caveman/*/ | head -1)src/hooks/caveman-statusline.ps1" assets/ && head -5 assets/caveman-statusline.sh`
Expected: both files copied; first lines show a shebang/license.

`src/assets.ts`:
```ts
import statuslineSh from '../assets/caveman-statusline.sh' with { type: 'text' };
import statuslinePs1 from '../assets/caveman-statusline.ps1' with { type: 'text' };
export const ASSETS = { 'caveman-statusline.sh': statuslineSh as string, 'caveman-statusline.ps1': statuslinePs1 as string };
```
Also create `src/assets.d.ts` so TypeScript accepts the text imports:
```ts
declare module '*.sh' { const s: string; export default s; }
declare module '*.ps1' { const s: string; export default s; }
declare module '*.md' { const s: string; export default s; }
```
If vitest under Bun cannot resolve `with { type: 'text' }`, add to `vitest.config.ts` a tiny plugin: `{ name: 'text', transform(code, id) { if (id.endsWith('.sh') || id.endsWith('.ps1')) return `export default ${JSON.stringify(code)}`; } }` and keep the import attribute for Bun's compiler.

- [ ] **Step 2: Write failing tests**

`test/providers/hook.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { hookProvider } from '../../src/providers/hook.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const hook = (agent: 'claude' | 'codex'): Component => ({ id: `hook-caveman-${agent}`, name: 'caveman hooks', kind: 'hook', agents: agent, platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'recommended', defaultSelected: agent === 'claude', spec: { kind: 'hook', provider: 'caveman', agent } });
describe('hookProvider', () => {
  it('detects caveman native hooks in settings.json', async () => {
    const ctx = makeTestCtx(); writeFileSync(ctx.paths.claudeSettings, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: "'/home/u/.caveman/bin/caveman-proxy' native-hook claude --adapter x" }] }] } }));
    expect(await hookProvider.detect(hook('claude'), ctx)).toEqual({ version: null }); expect(await hookProvider.detect(hook('codex'), ctx)).toBeNull();
  });
  it('runs caveman setup when caveman is present, skips otherwise', async () => {
    const ctx = makeTestCtx({ responses: { 'caveman --version': '1.3.4', 'caveman setup --agent-native claude': '' } });
    await (await hookProvider.plan(hook('claude'), ctx, null, 'install'))[0]!.run(ctx); expect(ctx.calls).toContainEqual(['caveman', 'setup', '--agent-native', 'claude']);
    const none = makeTestCtx({ responses: {} }); expect((await hookProvider.plan(hook('claude'), none, null, 'install'))[0]).toMatchObject({ op: 'skip' });
    const win = makeTestCtx({ host: { platform: 'windows' }, responses: { 'caveman --version': '1.3.4' } }); expect((await hookProvider.plan(hook('codex'), win, null, 'install'))[0]).toMatchObject({ op: 'skip' });
  });
  it('re-runs setup on update and removes on uninstall', async () => {
    const ctx = makeTestCtx({ responses: { 'caveman --version': '1.3.4', 'caveman setup --agent-native claude': '', 'caveman setup --agent-native claude --remove': '' } });
    expect((await hookProvider.plan(hook('claude'), ctx, { version: null }, 'update'))[0]).toMatchObject({ op: 'update' });
    await (await hookProvider.plan(hook('claude'), ctx, { version: null }, 'uninstall'))[0]!.run(ctx); expect(ctx.calls).toContainEqual(['caveman', 'setup', '--agent-native', 'claude', '--remove']);
  });
});
```

`test/providers/statusline.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { statuslineProvider } from '../../src/providers/statusline.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const sl = (provider: 'caveman' | 'claude-hud'): Component => ({ id: `sl-${provider}`, name: provider, kind: 'statusline', agents: 'claude', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'recommended', defaultSelected: provider === 'caveman', slot: 'statusline', spec: { kind: 'statusline', provider } });
describe('statuslineProvider', () => {
  it('installs the caveman statusline script and settings entry, idempotently', async () => {
    const ctx = makeTestCtx(); writeFileSync(ctx.paths.claudeSettings, '{}');
    await (await statuslineProvider.plan(sl('caveman'), ctx, null, 'install'))[0]!.run(ctx);
    const script = join(ctx.paths.claudeHooksDir, 'caveman-statusline.sh'); expect(existsSync(script)).toBe(true);
    const s = JSON.parse(readFileSync(ctx.paths.claudeSettings, 'utf8')); expect(s.statusLine.command).toBe(`bash "${script}"`);
    expect(await statuslineProvider.detect(sl('caveman'), ctx)).toEqual({ version: null }); expect(await statuslineProvider.plan(sl('caveman'), ctx, { version: null }, 'install')).toEqual([]);
    await (await statuslineProvider.plan(sl('caveman'), ctx, { version: null }, 'uninstall'))[0]!.run(ctx); expect(JSON.parse(readFileSync(ctx.paths.claudeSettings, 'utf8'))).toEqual({});
  });
  it('replaces a fragile glob statusLine and uses powershell on windows', async () => {
    const win = makeTestCtx({ host: { platform: 'windows' } }); writeFileSync(win.paths.claudeSettings, JSON.stringify({ statusLine: { type: 'command', command: 'bash "$(ls -td ...)src/hooks/caveman-statusline.sh"' } }));
    expect(await statuslineProvider.detect(sl('caveman'), win)).toBeNull();
    await (await statuslineProvider.plan(sl('caveman'), win, null, 'install'))[0]!.run(win);
    expect(JSON.parse(readFileSync(win.paths.claudeSettings, 'utf8')).statusLine.command).toMatch(/powershell -NoProfile -ExecutionPolicy Bypass -File ".*caveman-statusline\.ps1"/);
  });
  it('claude-hud clears a caveman statusLine and prints the setup hint', async () => {
    const ctx = makeTestCtx(); writeFileSync(ctx.paths.claudeSettings, JSON.stringify({ statusLine: { type: 'command', command: 'bash "/x/caveman-statusline.sh"' } }));
    const r = await (await statuslineProvider.plan(sl('claude-hud'), ctx, null, 'install'))[0]!.run(ctx);
    expect(r.message).toMatch(/\/claude-hud:setup/); expect(JSON.parse(readFileSync(ctx.paths.claudeSettings, 'utf8'))).toEqual({});
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `bunx vitest run test/providers/hook.test.ts test/providers/statusline.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

`src/providers/hook.ts`:
```ts
import { readFile } from 'node:fs/promises';
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { readJsonFile } from '../config/json.js';
import { probeVersion } from '../detect/tools.js';
import { action, ok, fail, skipAction } from './types.js';
export const hookProvider: Provider = {
  kind: 'hook',
  async detect(c, ctx) {
    if (c.spec.kind !== 'hook') return null;
    if (c.spec.agent === 'claude') { const s = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; const text = JSON.stringify((s as { hooks?: unknown }).hooks ?? {}); return /caveman-proxy[^"]*native-hook claude|caveman-proxy' native-hook claude/.test(text) ? { version: null } : null; }
    try { const t = await readFile(ctx.paths.codexHooks, 'utf8'); return /caveman/.test(t) ? { version: null } : null; } catch { return null; }
  },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'hook') return []; const agent = c.spec.agent;
    if (agent === 'codex' && ctx.host.platform === 'windows') return [skipAction(c.id, 'caveman Codex hooks are disabled on Windows (caveman docs/install-windows.md)')];
    if (!(await probeVersion(ctx.run, ['caveman', '--version']))) return [skipAction(c.id, 'caveman CLI not found; select the caveman-cli tool first')];
    if (mode === 'uninstall') return installed ? [action(c.id, 'uninstall', `remove caveman native hooks (${agent})`, async () => { await ctx.run(['caveman', 'setup', '--agent-native', agent, '--remove'], { allowFailure: true }); return ok('caveman hooks removed'); })] : [];
    if (installed && mode !== 'update') return [];
    return [action(c.id, installed ? 'update' : 'install', `caveman setup --agent-native ${agent}`, async () => {
      const r = await ctx.run(['caveman', 'setup', '--agent-native', agent], { allowFailure: true, timeoutMs: 300000 }); if (r.code !== 0) return fail(`caveman setup failed: ${(r.stderr || r.stdout).trim()}`);
      return ok(`caveman native hooks ${installed ? 'regenerated' : 'installed'} for ${agent}${agent === 'codex' ? '. Open Codex and run /hooks to trust them.' : ''}`);
    })];
  },
};
```

`src/providers/statusline.ts`:
```ts
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { readJsonFile, writeJsonAtomic, backupFile, mergeClaudeSettings } from '../config/json.js';
import { ASSETS } from '../assets.js';
import { action, ok } from './types.js';
function current(s: Record<string, unknown>): string { const sl = s.statusLine as { command?: string } | undefined; return sl?.command ?? ''; }
function scriptPath(ctx: Ctx): string { const name = ctx.host.platform === 'windows' ? 'caveman-statusline.ps1' : 'caveman-statusline.sh'; return ctx.host.platform === 'windows' ? `${ctx.paths.claudeHooksDir}\\${name}` : join(ctx.paths.claudeHooksDir, name); }
function command(ctx: Ctx): string { const p = scriptPath(ctx); return ctx.host.platform === 'windows' ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${p}"` : `bash "${p}"`; }
async function write(ctx: Ctx, patch: Record<string, unknown>): Promise<void> { const cur = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; if (ctx.dryRun) return; await backupFile(ctx.paths.claudeSettings, ctx.paths.backupsDir); await writeJsonAtomic(ctx.paths.claudeSettings, mergeClaudeSettings(cur, patch)); }
export const statuslineProvider: Provider = {
  kind: 'statusline',
  async detect(c, ctx) {
    if (c.spec.kind !== 'statusline') return null; const cmd = current((await readJsonFile(ctx.paths.claudeSettings)) ?? {});
    if (c.spec.provider === 'caveman') return cmd === command(ctx) ? { version: null } : null;
    return /claude-hud/.test(cmd) ? { version: null } : null;
  },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'statusline') return []; const prov = c.spec.provider;
    if (mode === 'uninstall') { if (!installed) return []; return [action(c.id, 'uninstall', `remove ${prov} statusLine`, async () => { await write(ctx, { statusLine: null }); return ok('statusLine removed'); })]; }
    if (installed) return [];
    if (prov === 'caveman') return [action(c.id, 'install', 'install caveman statusline script and statusLine setting', async () => {
      const name = ctx.host.platform === 'windows' ? 'caveman-statusline.ps1' : 'caveman-statusline.sh';
      if (!ctx.dryRun) { await mkdir(ctx.paths.claudeHooksDir, { recursive: true }); const p = join(ctx.paths.claudeHooksDir, name); await writeFile(p, ASSETS[name], 'utf8'); if (ctx.host.platform !== 'windows') await chmod(p, 0o755); }
      await write(ctx, { statusLine: { type: 'command', command: command(ctx) } }); return ok('caveman statusline configured');
    })];
    return [action(c.id, 'configure', 'hand statusLine over to claude-hud', async () => {
      const cur = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; if (/caveman-statusline/.test(current(cur))) await write(ctx, { statusLine: null });
      return ok('statusLine cleared for claude-hud. In Claude Code run: /claude-hud:setup');
    })];
  },
};
```

- [ ] **Step 5: Run tests**

Run: `bunx vitest run test/providers/hook.test.ts test/providers/statusline.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add assets src/assets.ts src/providers/hook.ts src/providers/statusline.ts test/providers/hook.test.ts test/providers/statusline.test.ts vitest.config.ts
git commit -m "feat(provider): caveman native hooks and statusline management"
```

---

### Task 22: Instructions provider (shared marker block in CLAUDE.md and AGENTS.md)

**Files:**
- Create: `src/providers/instructions.ts`, `instructions.md`
- Test: `test/providers/instructions.test.ts`

**Interfaces:**
- Produces: `instructionsProvider: Provider` (kind `instructions`). `spec.source` is the bundled file name (`instructions.md`, embedded via `src/assets.ts` as `ASSETS['instructions.md']`). Detect = both `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` (only those whose agent is installed) already contain the exact block. Install/update = `setMarkerBlock(text, content, 'html')` on each file (create when missing; backup; write atomic text with 0644 default), refuse when the Codex file would exceed 32 KiB (log warning, skip Codex). Uninstall = `removeMarkerBlock`.
- Add `writeTextAtomic(path, text, backupsDir)` to `src/config/json.ts` (same temp+rename pattern, default mode 0o644, preserve existing mode).

- [ ] **Step 1: Write instructions.md (initial content)**

`instructions.md`:
```markdown
## Global working agreement (managed by super-agent-installer)

- Prefer the simplest complete change. Reuse existing code before adding new abstractions.
- Before claiming work is done, run the relevant tests or commands and report their real output.
- Use conventional commit messages (feat/fix/docs/chore/refactor/test).
- Never write secrets into config files or commits. Reference environment variables instead.
- When a task touches Claude Code or Codex configuration, use the vendor CLI (`claude plugin`, `claude mcp`, `codex plugin`, `codex mcp`) instead of hand-editing config files.
```

- [ ] **Step 2: Write failing tests**

`test/providers/instructions.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { instructionsProvider } from '../../src/providers/instructions.js';
import { MARKER_STYLES } from '../../src/config/markers.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const comp: Component = { id: 'instr-global', name: 'global instructions', kind: 'instructions', agents: 'both', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'recommended', defaultSelected: true, spec: { kind: 'instructions', source: 'instructions.md' } };
const base = { 'claude --version': '2.1.274 (Claude Code)', 'claude plugin list --json': '[]', 'codex --version': 'codex-cli 0.154.0', 'codex plugin list --json': '{"installed":[]}', 'codex mcp list --json': '[]' };
describe('instructionsProvider', () => {
  it('writes the block into both files, keeps user text, idempotent, removable', async () => {
    const ctx = makeTestCtx({ responses: base }); writeFileSync(ctx.paths.claudeMd, '# my rules\n');
    expect(await instructionsProvider.detect(comp, ctx)).toBeNull();
    await (await instructionsProvider.plan(comp, ctx, null, 'install'))[0]!.run(ctx);
    const md = readFileSync(ctx.paths.claudeMd, 'utf8'); expect(md.startsWith('# my rules\n')).toBe(true); expect(md).toContain(MARKER_STYLES.html.start); expect(md).toContain('Global working agreement');
    expect(readFileSync(ctx.paths.codexAgentsMd, 'utf8')).toContain(MARKER_STYLES.html.end);
    expect(await instructionsProvider.detect(comp, ctx)).toEqual({ version: null }); expect(await instructionsProvider.plan(comp, ctx, { version: null }, 'update')).toEqual([]);
    await (await instructionsProvider.plan(comp, ctx, { version: null }, 'uninstall'))[0]!.run(ctx); expect(readFileSync(ctx.paths.claudeMd, 'utf8')).toBe('# my rules\n');
  });
  it('only touches files of installed agents', async () => {
    const ctx = makeTestCtx({ responses: { 'claude --version': '2.1.274 (Claude Code)', 'claude plugin list --json': '[]' } });
    await (await instructionsProvider.plan(comp, ctx, null, 'install'))[0]!.run(ctx);
    expect(readFileSync(ctx.paths.claudeMd, 'utf8')).toContain(MARKER_STYLES.html.start); expect(() => readFileSync(ctx.paths.codexAgentsMd)).toThrow();
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `bunx vitest run test/providers/instructions.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

Add to `src/config/json.ts`:
```ts
export async function writeTextAtomic(path: string, text: string, backupsDir: string): Promise<void> {
  let mode = 0o644; try { mode = (await stat(path)).mode & 0o777; await backupFile(path, backupsDir); } catch { /* new file */ }
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try { await writeFile(tmp, text, { encoding: 'utf8', mode }); if (process.platform !== 'win32') await chmod(tmp, mode); await rename(tmp, path); } catch (e) { try { await unlink(tmp); } catch { /* ignore */ } throw e; }
}
```

Add to `src/assets.ts`: `import instructionsMd from '../instructions.md' with { type: 'text' };` and the key `'instructions.md': instructionsMd as string` (extend the vitest text plugin to `.md`).

`src/providers/instructions.ts`:
```ts
import { readFile } from 'node:fs/promises';
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { ASSETS } from '../assets.js';
import { setMarkerBlock, removeMarkerBlock } from '../config/markers.js';
import { writeTextAtomic } from '../config/json.js';
import { getClaudeState } from './claude-plugin.js';
import { getCodexState } from './codex-plugin.js';
import { action, ok } from './types.js';
const CODEX_CAP = 32 * 1024;
async function targets(ctx: Ctx): Promise<Array<{ agent: 'claude' | 'codex'; path: string }>> { const out: Array<{ agent: 'claude' | 'codex'; path: string }> = []; if ((await getClaudeState(ctx)).installed) out.push({ agent: 'claude', path: ctx.paths.claudeMd }); if ((await getCodexState(ctx)).installed) out.push({ agent: 'codex', path: ctx.paths.codexAgentsMd }); return out; }
async function readOr(path: string): Promise<string> { try { return await readFile(path, 'utf8'); } catch { return ''; } }
export const instructionsProvider: Provider = {
  kind: 'instructions',
  async detect(c, ctx) {
    if (c.spec.kind !== 'instructions') return null; const content = ASSETS[c.spec.source as keyof typeof ASSETS] ?? ''; const t = await targets(ctx); if (!t.length) return null;
    for (const { path } of t) { const cur = await readOr(path); if (cur === '' || setMarkerBlock(cur, content, 'html') !== cur.replace(/\r\n/g, '\n')) return null; }
    return { version: null };
  },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'instructions') return []; const content = ASSETS[c.spec.source as keyof typeof ASSETS] ?? ''; const t = await targets(ctx); if (!t.length) return [];
    if (mode === 'uninstall') return installed ? [action(c.id, 'uninstall', 'remove managed instructions block', async () => { for (const { path } of t) { const cur = await readOr(path); const next = removeMarkerBlock(cur, 'html'); if (next !== cur && !ctx.dryRun) await writeTextAtomic(path, next, ctx.paths.backupsDir); } return ok('managed instructions removed'); })] : [];
    if (installed) return [];
    return [action(c.id, 'configure', 'write managed instructions block into CLAUDE.md and AGENTS.md', async () => {
      const notes: string[] = [];
      for (const { agent, path } of t) { const cur = await readOr(path); const next = setMarkerBlock(cur, content, 'html'); if (agent === 'codex' && Buffer.byteLength(next, 'utf8') > CODEX_CAP) { notes.push(`skipped ${path}: would exceed the 32 KiB Codex AGENTS.md cap`); continue; } if (next !== cur.replace(/\r\n/g, '\n') && !ctx.dryRun) await writeTextAtomic(path, next, ctx.paths.backupsDir); }
      return ok(`instructions block written${notes.length ? ` (${notes.join('; ')})` : ''}`);
    })];
  },
};
```

- [ ] **Step 5: Run tests**

Run: `bunx vitest run test/providers/instructions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add instructions.md src/assets.ts src/config/json.ts src/providers/instructions.ts test/providers/instructions.test.ts vitest.config.ts
git commit -m "feat(provider): shared instructions marker block for CLAUDE.md and AGENTS.md"
```

---

### Task 23: Executor and host state

**Files:**
- Create: `src/executor.ts`, `src/state/state.ts`, `src/providers/index.ts`
- Test: `test/executor.test.ts`, `test/state/state.test.ts`

**Interfaces:**
- Produces: `executePlan(plan: Plan, ctx: Ctx, opts?: { onStep?: (rec: StepRecord) => void }): Promise<{ records: StepRecord[]; failed: number; changed: number }>` (runs actions sequentially, catches thrown errors as failed records, never aborts the loop, logs each step via `ctx.log.step`); `readState(path): Promise<HostState | null>`, `writeState(path, state): Promise<void>`, `buildState(prev, selection, records, detections, installerVersion, channel): HostState` (installed map: for records with `ok` and op in install/update/configure set version from `to ?? detections[id]?.version ?? null`; for uninstall delete; untouched ids keep previous); `registerAllProviders()` in `src/providers/index.ts` registering agent, tool, claude-plugin, codex-plugin, mcp, skill, setting, hook, statusline, instructions.

- [ ] **Step 1: Write failing tests**

`test/executor.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { executePlan } from '../src/executor.js';
import { action } from '../src/providers/types.js';
import { makeTestCtx } from './helpers/ctx.js';
describe('executePlan', () => {
  it('runs all actions, records failures and thrown errors, keeps going', async () => {
    const ctx = makeTestCtx(); const seen: string[] = [];
    const plan = { detections: {}, actions: [
      action('a', 'install', 'ok one', async () => ({ ok: true, changed: true, message: 'done' })),
      action('b', 'update', 'fails', async () => ({ ok: false, changed: false, message: 'nope' })),
      action('c', 'configure', 'throws', async () => { throw new Error('boom'); }),
      action('d', 'skip', 'skipped', async () => ({ ok: true, changed: false, message: 'skip' })),
    ] };
    const r = await executePlan(plan, ctx, { onStep: (s) => seen.push(`${s.componentId}:${s.ok}`) });
    expect(seen).toEqual(['a:true', 'b:false', 'c:false', 'd:true']); expect(r.failed).toBe(2); expect(r.changed).toBe(1);
    expect(r.records[2]).toMatchObject({ componentId: 'c', ok: false, message: expect.stringContaining('boom') });
  });
});
```

`test/state/state.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState, writeState, buildState } from '../../src/state/state.js';
import type { Selection, StepRecord } from '../../src/types.js';
describe('state', () => {
  it('round-trips and builds installed map from records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const p = join(dir, 'state.json');
    expect(await readState(p)).toBeNull();
    const sel = { profile: 'all', components: [{ id: 'x' }, { id: 'y' }, { id: 'z' }], excluded: [], tokenTotals: { claude: 0, codex: 0 }, codexMcpCount: 0 } as unknown as Selection;
    const recs: StepRecord[] = [{ componentId: 'x', op: 'install', ok: true, changed: true, message: '', to: '1.0' }, { componentId: 'y', op: 'uninstall', ok: true, changed: true, message: '' }, { componentId: 'z', op: 'skip', ok: true, changed: false, message: '' }];
    const prev = { version: 1 as const, installerVersion: '0.0.1', profile: 'all' as const, selectedIds: ['y'], channel: 'latest' as const, installed: { y: { version: '9', at: 't' }, z: { version: '2', at: 't' } }, lastRun: 't' };
    const s = buildState(prev, sel, recs, { z: { version: '2.1' } }, '0.1.0', 'latest');
    expect(s.installed.x?.version).toBe('1.0'); expect(s.installed.y).toBeUndefined(); expect(s.installed.z?.version).toBe('2'); expect(s.selectedIds).toEqual(['x', 'y', 'z']); expect(s.installerVersion).toBe('0.1.0');
    await writeState(p, s); expect(await readState(p)).toEqual(s);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/executor.test.ts test/state`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/executor.ts`:
```ts
import type { Ctx, StepRecord } from './types.js';
import type { Plan } from './planner.js';
export async function executePlan(plan: Plan, ctx: Ctx, opts: { onStep?: (rec: StepRecord) => void } = {}): Promise<{ records: StepRecord[]; failed: number; changed: number }> {
  const records: StepRecord[] = [];
  for (const a of plan.actions) {
    ctx.log.step(`${a.op.padEnd(9)} ${a.description}`);
    let rec: StepRecord;
    try { const r = await a.run(ctx); rec = { componentId: a.componentId, op: a.op, ok: r.ok, changed: r.changed, message: r.message, from: a.from ?? null, to: a.to ?? null }; }
    catch (e) { rec = { componentId: a.componentId, op: a.op, ok: false, changed: false, message: (e as Error).message, from: a.from ?? null, to: a.to ?? null }; }
    if (!rec.ok) ctx.log.error(`${a.componentId}: ${rec.message}`); else if (rec.changed) ctx.log.info(`${a.componentId}: ${rec.message}`); else ctx.log.debug(`${a.componentId}: ${rec.message}`);
    records.push(rec); opts.onStep?.(rec);
  }
  return { records, failed: records.filter((r) => !r.ok).length, changed: records.filter((r) => r.ok && r.changed).length };
}
```

`src/state/state.ts`:
```ts
import type { Channel, HostState, Installed, Selection, StepRecord } from '../types.js';
import { readJsonFile, writeJsonAtomic } from '../config/json.js';
export async function readState(path: string): Promise<HostState | null> { const s = await readJsonFile<HostState>(path); return s && s.version === 1 ? s : null; }
export async function writeState(path: string, state: HostState): Promise<void> { await writeJsonAtomic(path, state, { mode: 0o600 }); }
export function buildState(prev: HostState | null, sel: Selection, records: StepRecord[], detections: Record<string, Installed | null>, installerVersion: string, channel: Channel): HostState {
  const installed: HostState['installed'] = { ...(prev?.installed ?? {}) }; const now = new Date().toISOString();
  for (const r of records) {
    if (!r.ok) continue;
    if (r.op === 'uninstall') delete installed[r.componentId];
    else if (r.op === 'install' || r.op === 'update' || r.op === 'configure') installed[r.componentId] = { version: r.to ?? detections[r.componentId]?.version ?? null, at: now };
    else if (r.op === 'skip' && !installed[r.componentId] && detections[r.componentId]) installed[r.componentId] = { version: detections[r.componentId]?.version ?? null, at: now };
  }
  return { version: 1, installerVersion, profile: sel.profile, selectedIds: sel.components.map((c) => c.id), channel, installed, lastRun: now };
}
```

`src/providers/index.ts`:
```ts
import { registerProvider } from './registry.js';
import { agentProvider } from './agent.js';
import { toolProvider } from './tool.js';
import { claudePluginProvider } from './claude-plugin.js';
import { codexPluginProvider } from './codex-plugin.js';
import { mcpProvider } from './mcp.js';
import { skillProvider } from './skill.js';
import { settingProvider } from './setting.js';
import { hookProvider } from './hook.js';
import { statuslineProvider } from './statusline.js';
import { instructionsProvider } from './instructions.js';
export function registerAllProviders(): void { for (const p of [agentProvider, toolProvider, claudePluginProvider, codexPluginProvider, mcpProvider, skillProvider, settingProvider, hookProvider, statuslineProvider, instructionsProvider]) registerProvider(p); }
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/executor.test.ts test/state`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/executor.ts src/state/state.ts src/providers/index.ts test/executor.test.ts test/state
git commit -m "feat(core): sequential executor with failure isolation, host state file, provider registration"
```

### Task 24: Drift report and the `check`, `list`, `doctor` commands

**Files:**
- Create: `src/update/drift.ts`, `src/commands/check.ts`, `src/commands/list.ts`, `src/commands/doctor.ts`, `src/context.ts`
- Test: `test/update/drift.test.ts`, `test/commands/list.test.ts`

**Interfaces:**
- `createCtx(opts: { dryRun; yes; noAudit; channel?; verbose; json; manifestPath?; secrets? }): Promise<Ctx>` in `src/context.ts`: loads manifest (bundled `manifest.json` via `src/assets.ts` as `ASSETS['manifest.json']`, overridable by `--manifest <path>`), detects host with `defaultHostDeps`, resolves paths, creates logger (file `paths.logFile`) and runner, registers providers.
- `driftReport(ctx, components: Component[]): Promise<DriftRow[]>` with `DriftRow = { id: string; name: string; installed: string | null; latest: string | null; status: 'ok' | 'outdated' | 'missing' | 'unknown' }`: uses provider `detect` and optional `latest`; `missing` when detect null; `outdated` when `isNewer(latest, installed)`; `unknown` when latest is null and installed non-null for kinds that have a latest probe; `ok` otherwise (config-only kinds report `ok` when detected).
- `check` command: components = saved state `selectedIds` if state exists else profile `all`; prints table; exit 2 when any row is `outdated` or `missing`; `--json` prints rows.
- `list` command: prints every manifest component for this platform with id, kind, agents, verdict, tokens, default flag, and `[selected]` when in saved state.
- `doctor` command: prints host summary (platform, arch, root/sudo, pkg manager, Node/uv/git versions, AVX, bwrap, LXC, WSL, disk free), then runs `claude doctor` and `codex doctor --json` (readOnly, allowFailure), `codex sandbox -- /bin/true` on linux, and lists MCP health via `claude mcp list` (readOnly). Never mutates.

- [ ] **Step 1: Write failing tests**

`test/update/drift.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { driftReport } from '../../src/update/drift.js';
import { registerProvider, clearProviders } from '../../src/providers/registry.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, Provider } from '../../src/types.js';
const c = (id: string, kind: Component['kind']): Component => ({ id, name: id, kind, agents: 'both', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: true, spec: { kind: 'tool', probe: ['x'], packages: {} } as Component['spec'] });
describe('driftReport', () => {
  it('classifies rows', async () => {
    clearProviders();
    const tool: Provider = { kind: 'tool', detect: async (comp) => (comp.id === 'missing' ? null : { version: comp.id === 'old' ? '1.0.0' : '2.0.0' }), latest: async (comp) => (comp.id === 'nolatest' ? null : '2.0.0'), plan: async () => [] };
    const setting: Provider = { kind: 'setting', detect: async () => ({ version: null }), plan: async () => [] };
    registerProvider(tool); registerProvider(setting);
    const rows = await driftReport(makeTestCtx(), [c('old', 'tool'), c('fresh', 'tool'), c('missing', 'tool'), c('nolatest', 'tool'), c('cfg', 'setting')]);
    expect(rows.map((r) => `${r.id}:${r.status}`)).toEqual(['old:outdated', 'fresh:ok', 'missing:missing', 'nolatest:unknown', 'cfg:ok']);
  });
});
```

`test/commands/list.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { renderList } from '../../src/commands/list.js';
import type { Manifest } from '../../src/types.js';
const m: Manifest = { version: 1, profiles: {}, components: [{ id: 'a', name: 'A', kind: 'claude-plugin', agents: 'claude', platforms: ['linux'], description: 'd', verdict: 'must-have', defaultSelected: true, contextCostTokens: { claude: 100 }, spec: { kind: 'claude-plugin', marketplace: 'm', plugin: 'a' } }, { id: 'w', name: 'W', kind: 'tool', agents: 'both', platforms: ['windows'], description: '', verdict: 'optional', defaultSelected: false, spec: { kind: 'tool', probe: ['w'], packages: {} } }] };
describe('renderList', () => {
  it('lists platform components with selection marks', () => {
    const out = renderList(m, 'linux', ['a']);
    expect(out).toContain('a'); expect(out).toContain('must-have'); expect(out).toContain('100'); expect(out).toContain('[selected]'); expect(out).not.toContain('W');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/update/drift.test.ts test/commands/list.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/context.ts`:
```ts
import { readFile } from 'node:fs/promises';
import type { Channel, Ctx, Manifest } from './types.js';
import { parseManifest } from './manifest/schema.js';
import bundledManifest from '../manifest.json' with { type: 'json' };
import { detectHost, defaultHostDeps } from './detect/host.js';
import { resolvePaths } from './config/paths.js';
import { createRunner } from './exec/run.js';
import { createLogger } from './ui/log.js';
import { registerAllProviders } from './providers/index.js';
export interface CtxOptions { dryRun?: boolean; yes?: boolean; noAudit?: boolean; channel?: Channel; verbose?: boolean; json?: boolean; manifestPath?: string; secrets?: Map<string, string>; logFile?: string }
export async function loadBundledManifest(path?: string): Promise<Manifest> { return parseManifest(path ? JSON.parse(await readFile(path, 'utf8')) : bundledManifest); }
export async function createCtx(o: CtxOptions): Promise<Ctx> {
  registerAllProviders();
  const manifest = await loadBundledManifest(o.manifestPath);
  const probeLog = createLogger({ quiet: true }); const probeRun = createRunner({ dryRun: false, log: probeLog });
  const host = await detectHost(defaultHostDeps(probeRun)); const paths = resolvePaths(host, process.env);
  const log = createLogger({ file: o.logFile ?? paths.logFile, verbose: o.verbose, json: o.json });
  const run = createRunner({ dryRun: !!o.dryRun, log });
  return { host, paths, run, log, dryRun: !!o.dryRun, yes: !!o.yes, noAudit: !!o.noAudit, channel: o.channel ?? 'latest', secrets: o.secrets ?? new Map(), fetch: globalThis.fetch, env: process.env, manifest };
}
```
The manifest is imported as JSON (`with { type: 'json' }`), which Bun's compiler embeds and vitest resolves natively (`resolveJsonModule` is on via `module: NodeNext`). Until Task 29 writes the real manifest, create a placeholder `manifest.json` with `{ "version": 1, "profiles": { "all": { "description": "everything", "base": "all" } }, "components": [] }`.

`src/update/drift.ts`:
```ts
import type { Component, Ctx } from '../types.js';
import { getProvider } from '../providers/registry.js';
import { isNewer } from '../version/compare.js';
export interface DriftRow { id: string; name: string; kind: string; installed: string | null; latest: string | null; status: 'ok' | 'outdated' | 'missing' | 'unknown' }
export async function driftReport(ctx: Ctx, components: Component[]): Promise<DriftRow[]> {
  const rows: DriftRow[] = [];
  for (const c of components) {
    const p = getProvider(c.kind); let installed: string | null = null; let present = false;
    try { const d = await p.detect(c, ctx); present = !!d; installed = d?.version ?? null; } catch { present = false; }
    let latest: string | null = null; if (p.latest) { try { latest = await p.latest(c, ctx); } catch { latest = null; } }
    const status: DriftRow['status'] = !present ? 'missing' : p.latest && latest === null ? 'unknown' : isNewer(latest, installed) ? 'outdated' : 'ok';
    rows.push({ id: c.id, name: c.name, kind: c.kind, installed, latest, status });
  }
  return rows;
}
```

`src/commands/check.ts`:
```ts
import type { Ctx } from '../types.js';
import { resolveSelection } from '../manifest/resolve.js';
import { readState } from '../state/state.js';
import { driftReport } from '../update/drift.js';
import { table } from '../ui/log.js';
export async function runCheck(ctx: Ctx, opts: { json?: boolean }): Promise<number> {
  const state = await readState(ctx.paths.stateFile);
  const sel = state ? resolveSelection(ctx.manifest, ctx.host, { profile: 'saved', savedIds: state.selectedIds }) : resolveSelection(ctx.manifest, ctx.host, { profile: 'all' });
  const rows = await driftReport(ctx, sel.components);
  if (opts.json) console.log(JSON.stringify({ profile: sel.profile, rows }, null, 2));
  else { console.log(table(rows.map((r) => [r.id, r.kind, r.installed ?? '-', r.latest ?? '-', r.status]), ['component', 'kind', 'installed', 'latest', 'status'])); }
  const drift = rows.filter((r) => r.status === 'outdated' || r.status === 'missing').length;
  if (!opts.json) console.log(drift ? `\n${drift} component(s) need attention. Run: super-agent-installer update` : '\nEverything is up to date.');
  return drift ? 2 : 0;
}
```

`src/commands/list.ts`:
```ts
import type { Manifest, Platform } from '../types.js';
import { table } from '../ui/log.js';
export function renderList(m: Manifest, platform: Platform, selected: string[]): string {
  const rows = m.components.filter((c) => c.platforms.includes(platform)).map((c) => [c.id, c.kind, c.agents, c.verdict, String(c.contextCostTokens?.claude ?? c.contextCostTokens?.codex ?? ''), c.defaultSelected && !c.forceOffInAll ? 'default' : c.forceOffInAll ? 'forced-off' : 'optional', selected.includes(c.id) ? '[selected]' : '', c.name]);
  return table(rows, ['id', 'kind', 'agents', 'verdict', 'tokens', 'in ALL', 'state', 'name']);
}
```
plus `runList(ctx)` that reads state and prints `renderList(ctx.manifest, ctx.host.platform, state?.selectedIds ?? [])`.

`src/commands/doctor.ts`:
```ts
import type { Ctx } from '../types.js';
import { probeVersion } from '../detect/tools.js';
export async function runDoctor(ctx: Ctx): Promise<number> {
  const h = ctx.host; const v = async (argv: string[], re?: string) => (await probeVersion(ctx.run, argv, re)) ?? 'missing';
  const lines = [`platform: ${h.platform}/${h.arch}${h.isWsl ? ' (WSL)' : ''}${h.isLxc ? ' (LXC)' : ''}${h.isProxmoxHost ? ' (Proxmox host)' : ''}`, `user: ${h.isRoot ? 'root' : `non-root${h.hasSudo ? ' + sudo' : ''}`}`, `package manager: ${h.pkgManager ?? 'none'}`, `disk free (home): ${h.diskFreeMb ?? '?'} MB`, `AVX: ${h.hasAvx === null ? 'n/a' : h.hasAvx ? 'yes' : 'NO (Claude Code will crash)'}`, `bubblewrap: ${h.hasBwrap ? 'yes' : 'no'}`, `claude: ${await v(['claude', '--version'])}`, `codex: ${await v(['codex', '--version'])}`, `node: ${await v(['node', '--version'])}`, `npm: ${await v(['npm', '--version'])}`, `uv: ${await v(['uv', '--version'])}`, `git: ${await v(['git', '--version'])}`, `jq: ${await v(['jq', '--version'])}`, `gh: ${await v(['gh', '--version'])}`, `caveman: ${await v(['caveman', '--version'])}`, `claude session running: ${h.claudeRunning ? 'yes' : 'no'}`];
  console.log(lines.join('\n'));
  for (const argv of [['claude', 'doctor'], ['codex', 'doctor', '--json'], ...(h.platform === 'linux' ? [['codex', 'sandbox', '--', '/bin/true']] : []), ['claude', 'mcp', 'list']]) { const r = await ctx.run(argv, { readOnly: true, allowFailure: true, timeoutMs: 120000 }); console.log(`\n$ ${argv.join(' ')} (exit ${r.code})\n${(r.stdout + r.stderr).trim().slice(0, 4000)}`); }
  return 0;
}
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/update test/commands`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/context.ts src/update/drift.ts src/commands/check.ts src/commands/list.ts src/commands/doctor.ts src/assets.ts manifest.json vitest.config.ts test/update test/commands
git commit -m "feat(commands): context factory, drift report, check/list/doctor"
```

---

### Task 25: `install`, `update`, `uninstall` commands (non-interactive path)

**Files:**
- Create: `src/commands/install.ts`, `src/commands/update.ts`, `src/commands/uninstall.ts`, `src/commands/summary.ts`
- Test: `test/commands/install.test.ts`

**Interfaces:**
- `runInstall(ctx, opts: { profile?: ProfileName; only?: string[]; skip?: string[]; fromState?: boolean; picked?: string[]; json?: boolean; installerVersion: string }): Promise<number>`: resolve selection (`fromState` -> saved ids; `picked` from the picker), pre-flight checks (disk free < 2000 MB -> warn; `claudeRunning` -> warn; `isNixOS` -> print home-manager snippet and return 4), `buildPlan(..., 'install')`, print plan table (`op | component | from -> to | description`), `--dry-run` returns 0 here, prompt for secrets of selected components not in env (only when `!ctx.yes`; in `--yes` mode skip and print hints), execute, print summary, write state, return `failed ? 1 : 0`.
- `runUpdate(ctx, opts: { json?: boolean; installerVersion: string; noSelfUpdate?: boolean })`: self-update first (Task 27, injected as `selfUpdateFn` parameter so this task can test without it), then selection from state (or `all` when no state, with a warning), plan with mode `update`, execute, drift report at the end, write state.
- `runUninstall(ctx, ids: string[] | undefined, opts)`: ids from args or all selected in state; confirm unless `--yes` (use `@clack/prompts` `confirm`); plan `uninstall`; execute; update state.
- `renderPlan(actions)` and `renderSummary(records)` in `summary.ts`.
- Secrets prompt: `promptSecrets(ctx, components)` in `summary.ts` using `@clack/prompts` `password` for each `component.secrets[]` entry whose env var is unset; store in `ctx.secrets` and also into `ctx.env` for the run (so child processes see it).

- [ ] **Step 1: Write failing test**

`test/commands/install.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { runInstall } from '../../src/commands/install.js';
import { runUpdate } from '../../src/commands/update.js';
import { registerProvider, clearProviders } from '../../src/providers/registry.js';
import { action } from '../../src/providers/types.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, Manifest, Provider } from '../../src/types.js';
const comp = (id: string, ok = true): Component => ({ id, name: id, kind: 'tool', agents: 'both', platforms: ['linux'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'tool', probe: [id], packages: {} } });
const manifest: Manifest = { version: 1, profiles: { all: { description: '', base: 'all' }, minimal: { description: '', base: 'none', include: ['a'] } }, components: [comp('a'), comp('b')] };
const fake = (fails: string[]): Provider => ({ kind: 'tool', detect: async () => null, latest: async () => '1', plan: async (c) => [action(c.id, 'install', `install ${c.id}`, async () => (fails.includes(c.id) ? { ok: false, changed: false, message: 'bad' } : { ok: true, changed: true, message: 'good' }), { to: '1' })] });
describe('runInstall / runUpdate', () => {
  it('installs the profile, writes state, returns 1 when a step fails', async () => {
    clearProviders(); registerProvider(fake(['b']));
    const ctx = makeTestCtx({ manifest });
    expect(await runInstall(ctx, { profile: 'all', installerVersion: '0.1.0' })).toBe(1);
    const state = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8')); expect(state.selectedIds).toEqual(['a', 'b']); expect(state.installed.a.version).toBe('1'); expect(state.installed.b).toBeUndefined();
  });
  it('dry-run plans without executing or writing state', async () => {
    clearProviders(); registerProvider(fake([]));
    const ctx = makeTestCtx({ manifest, dryRun: true });
    expect(await runInstall(ctx, { profile: 'minimal', installerVersion: '0.1.0' })).toBe(0); expect(existsSync(ctx.paths.stateFile)).toBe(false);
  });
  it('update replays the saved selection and calls self-update first', async () => {
    clearProviders(); registerProvider(fake([]));
    const ctx = makeTestCtx({ manifest }); await runInstall(ctx, { profile: 'minimal', installerVersion: '0.1.0' });
    let selfUpdated = false;
    expect(await runUpdate(ctx, { installerVersion: '0.1.0', selfUpdateFn: async () => { selfUpdated = true; return { updated: false, message: 'current' }; } })).toBe(0);
    expect(selfUpdated).toBe(true); expect(JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8')).selectedIds).toEqual(['a']);
  });
  it('bails on NixOS with exit 4', async () => { clearProviders(); registerProvider(fake([])); const ctx = makeTestCtx({ manifest, host: { isNixOS: true } }); expect(await runInstall(ctx, { profile: 'all', installerVersion: '0.1.0' })).toBe(4); });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/commands/install.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/commands/summary.ts`:
```ts
import * as p from '@clack/prompts';
import type { Action, Component, Ctx, StepRecord } from '../types.js';
import { table } from '../ui/log.js';
export function renderPlan(actions: Action[]): string { return table(actions.map((a) => [a.op, a.componentId, a.from || a.to ? `${a.from ?? '-'} -> ${a.to ?? '?'}` : '', a.description]), ['op', 'component', 'version', 'description']); }
export function renderSummary(records: StepRecord[]): string {
  const rows = records.filter((r) => r.op !== 'skip' || !r.ok).map((r) => [r.ok ? (r.changed ? 'changed' : 'ok') : 'FAILED', r.componentId, r.op, r.message.split('\n')[0] ?? '']);
  const skipped = records.filter((r) => r.op === 'skip' && r.ok).length;
  return `${table(rows, ['result', 'component', 'op', 'message'])}${skipped ? `\n(${skipped} skipped: nothing to do)` : ''}`;
}
export async function promptSecrets(ctx: Ctx, components: Component[]): Promise<void> {
  const wanted = components.flatMap((c) => (c.secrets ?? []).map((s) => ({ ...s, component: c.id }))).filter((s) => !ctx.env[s.env] && !ctx.secrets.has(s.env));
  if (!wanted.length) return;
  if (ctx.yes) { ctx.log.warn(`secrets not set (non-interactive): ${wanted.map((s) => s.env).join(', ')}. Export them before using those components.`); return; }
  for (const s of wanted) {
    const v = await p.password({ message: `${s.prompt} (${s.env})${s.required ? '' : ' - press Enter to skip'}`, mask: '*' });
    if (p.isCancel(v) || !v) continue; ctx.secrets.set(s.env, String(v)); ctx.env[s.env] = String(v);
  }
}
export function postInstallHints(ctx: Ctx, components: Component[], records: StepRecord[]): string[] {
  const hints: string[] = [];
  for (const c of components) if (c.postInstallHint && records.some((r) => r.componentId === c.id && r.ok && r.changed)) hints.push(`${c.id}: ${c.postInstallHint}`);
  if (records.some((r) => r.componentId === 'claude-code' && r.ok && r.changed)) hints.push('claude-code: run `claude` once to log in (or `claude setup-token` for headless hosts)');
  if (records.some((r) => r.componentId === 'codex-cli' && r.ok && r.changed)) hints.push('codex-cli: run `codex login` (or `codex login --device-auth` on headless hosts)');
  if (records.some((r) => /^hook-caveman-codex/.test(r.componentId) && r.ok && r.changed)) hints.push('codex: open Codex and run /hooks to trust the new hooks');
  if (ctx.host.claudeRunning) hints.push('restart running Claude Code sessions to pick up plugin and settings changes');
  return hints;
}
```

`src/commands/install.ts`:
```ts
import type { Ctx, ProfileName } from '../types.js';
import { resolveSelection } from '../manifest/resolve.js';
import { buildPlan } from '../planner.js';
import { executePlan } from '../executor.js';
import { readState, writeState, buildState } from '../state/state.js';
import { renderPlan, renderSummary, promptSecrets, postInstallHints } from './summary.js';
export interface InstallOpts { profile?: ProfileName; only?: string[]; skip?: string[]; fromState?: boolean; picked?: string[]; json?: boolean; installerVersion: string }
const NIX_SNIPPET = `NixOS detected. Use home-manager instead:\n  programs.claude-code.enable = true;\n  programs.codex.enable = true;\nSee https://home-manager-options.extranix.com/?query=claude-code`;
export async function runInstall(ctx: Ctx, o: InstallOpts): Promise<number> {
  if (ctx.host.isNixOS) { console.error(NIX_SNIPPET); return 4; }
  const state = await readState(ctx.paths.stateFile);
  const sel = o.picked ? resolveSelection(ctx.manifest, ctx.host, { profile: o.profile ?? state?.profile ?? 'all', picked: o.picked }) : o.fromState && state ? resolveSelection(ctx.manifest, ctx.host, { profile: 'saved', savedIds: state.selectedIds, skip: o.skip }) : resolveSelection(ctx.manifest, ctx.host, { profile: o.profile ?? 'all', only: o.only, skip: o.skip });
  if (ctx.host.diskFreeMb !== null && ctx.host.diskFreeMb < 2000) ctx.log.warn(`only ${ctx.host.diskFreeMb} MB free in home; plugin caches can need 1.5 GB`);
  if (ctx.host.claudeRunning) ctx.log.warn('a claude session is running; agent updates will be skipped and plugin changes need a restart');
  for (const e of sel.excluded) ctx.log.debug(`excluded ${e.id}: ${e.reason}`);
  ctx.log.info(`profile ${sel.profile}: ${sel.components.length} components, Claude always-on tokens ~${sel.tokenTotals.claude}, Codex MCP servers ${sel.codexMcpCount}`);
  const plan = await buildPlan(sel, ctx, 'install');
  if (!o.json) console.log(renderPlan(plan.actions));
  if (ctx.dryRun) { ctx.log.info('dry-run: nothing executed'); return 0; }
  await promptSecrets(ctx, sel.components);
  const result = await executePlan(plan, ctx);
  if (o.json) console.log(JSON.stringify({ selection: sel.components.map((c) => c.id), records: result.records }, null, 2)); else { console.log('\n' + renderSummary(result.records)); const hints = postInstallHints(ctx, sel.components, result.records); if (hints.length) console.log('\nNext steps:\n- ' + hints.join('\n- ')); }
  await writeState(ctx.paths.stateFile, buildState(state, sel, result.records, plan.detections, o.installerVersion, ctx.channel));
  return result.failed ? 1 : 0;
}
```

`src/commands/update.ts`:
```ts
import type { Ctx } from '../types.js';
import { resolveSelection } from '../manifest/resolve.js';
import { buildPlan } from '../planner.js';
import { executePlan } from '../executor.js';
import { readState, writeState, buildState } from '../state/state.js';
import { driftReport } from '../update/drift.js';
import { renderPlan, renderSummary, postInstallHints } from './summary.js';
import { table } from '../ui/log.js';
export interface UpdateOpts { json?: boolean; installerVersion: string; noSelfUpdate?: boolean; selfUpdateFn?: (ctx: Ctx, version: string) => Promise<{ updated: boolean; message: string }> }
export async function runUpdate(ctx: Ctx, o: UpdateOpts): Promise<number> {
  if (!o.noSelfUpdate && o.selfUpdateFn) { const r = await o.selfUpdateFn(ctx, o.installerVersion); ctx.log.info(`self-update: ${r.message}`); if (r.updated) return 0; }
  const state = await readState(ctx.paths.stateFile);
  if (!state) ctx.log.warn('no saved selection on this host; updating the "all" profile');
  const sel = state ? resolveSelection(ctx.manifest, ctx.host, { profile: 'saved', savedIds: state.selectedIds }) : resolveSelection(ctx.manifest, ctx.host, { profile: 'all' });
  const plan = await buildPlan(sel, ctx, 'update');
  if (!o.json) console.log(renderPlan(plan.actions));
  if (ctx.dryRun) return 0;
  const result = await executePlan(plan, ctx);
  const drift = await driftReport(ctx, sel.components);
  if (o.json) console.log(JSON.stringify({ records: result.records, drift }, null, 2)); else { console.log('\n' + renderSummary(result.records)); console.log('\n' + table(drift.map((r) => [r.id, r.installed ?? '-', r.latest ?? '-', r.status]), ['component', 'installed', 'latest', 'status'])); const hints = postInstallHints(ctx, sel.components, result.records); if (hints.length) console.log('\nNext steps:\n- ' + hints.join('\n- ')); }
  await writeState(ctx.paths.stateFile, buildState(state, sel, result.records, plan.detections, o.installerVersion, ctx.channel));
  return result.failed ? 1 : 0;
}
```

`src/commands/uninstall.ts`:
```ts
import * as p from '@clack/prompts';
import type { Ctx } from '../types.js';
import { resolveSelection } from '../manifest/resolve.js';
import { buildPlan } from '../planner.js';
import { executePlan } from '../executor.js';
import { readState, writeState, buildState } from '../state/state.js';
import { renderPlan, renderSummary } from './summary.js';
export async function runUninstall(ctx: Ctx, ids: string[] | undefined, o: { json?: boolean; installerVersion: string }): Promise<number> {
  const state = await readState(ctx.paths.stateFile);
  const target = ids?.length ? ids : state?.selectedIds ?? [];
  if (!target.length) { ctx.log.error('nothing to uninstall: pass component ids or install first'); return 1; }
  const sel = resolveSelection(ctx.manifest, ctx.host, { profile: 'saved', savedIds: target });
  const plan = await buildPlan(sel, ctx, 'uninstall');
  if (!o.json) console.log(renderPlan(plan.actions));
  if (ctx.dryRun) return 0;
  if (!ctx.yes) { const c = await p.confirm({ message: `Remove ${sel.components.length} component(s)?`, initialValue: false }); if (p.isCancel(c) || !c) return 0; }
  const result = await executePlan(plan, ctx);
  if (!o.json) console.log('\n' + renderSummary(result.records)); else console.log(JSON.stringify(result.records, null, 2));
  const remaining = (state?.selectedIds ?? []).filter((id) => !result.records.some((r) => r.componentId === id && r.op === 'uninstall' && r.ok));
  const next = buildState(state, { ...sel, components: ctx.manifest.components.filter((c) => remaining.includes(c.id)) }, result.records, plan.detections, o.installerVersion, ctx.channel);
  await writeState(ctx.paths.stateFile, next);
  return result.failed ? 1 : 0;
}
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/commands/install.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/commands test/commands/install.test.ts
git commit -m "feat(commands): install, update, uninstall with plan preview, secrets prompt, summary and state"
```

---

### Task 26: Interactive picker

**Files:**
- Create: `src/picker/flow.ts`
- Test: `test/picker/flow.test.ts`

**Interfaces:**
- `runPicker(ctx, opts: { state: HostState | null; ui?: PickerUi }): Promise<{ picked: string[]; profile: ProfileName | 'saved' } | null>` (null on cancel). `PickerUi` abstracts `@clack/prompts` (`intro`, `note`, `select`, `multiselect`, `confirm`, `outro`, `isCancel`) so tests inject a scripted UI. Flow:
  1. `note(hostSummary)`.
  2. `select` profile: options from `PROFILE_NAMES` present in manifest + `saved` when state exists (initial: `saved` if exists else `all`).
  3. For each category in order `agent, tool, claude-plugin, codex-plugin, mcp, skill, setting, hook, statusline, instructions` (labels: Agents, Prerequisite tools, Claude Code plugins, Codex plugins, MCP servers, Skills, Settings, Hooks, Status line, Instructions): `multiselect` over platform-applicable components of that kind, `initialValues` = ids in the profile's resolved selection, option `hint` = `${verdict} · ${tokens} tok · ${popularity}` and a `(off in ALL: reason)` marker for `forceOffInAll`. Skip a category with no components.
  4. Compute `slotConflicts` over the union; for each conflict `select` the winner; drop the others.
  5. Show footer note: count, Claude token total (warn > 8000), Codex MCP count (warn > 5), excluded-by-platform list.
  6. `confirm('Proceed with this selection?')`.
- `hostSummary(host)` string helper exported for reuse by `doctor`.

- [ ] **Step 1: Write failing test**

`test/picker/flow.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { runPicker, type PickerUi } from '../../src/picker/flow.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, Manifest } from '../../src/types.js';
const c = (id: string, kind: Component['kind'], over: Partial<Component> = {}): Component => ({ id, name: id, kind, agents: 'claude', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: true, spec: { kind: 'claude-plugin', marketplace: 'm', plugin: id } as Component['spec'], ...over });
const manifest: Manifest = { version: 1, profiles: { all: { description: 'all', base: 'all' }, minimal: { description: 'min', base: 'none', include: ['sp'] } }, components: [c('sp', 'claude-plugin', { slot: 'methodology', contextCostTokens: { claude: 700 } }), c('ce', 'claude-plugin', { slot: 'methodology', defaultSelected: false }), c('sl1', 'statusline', { slot: 'statusline', spec: { kind: 'statusline', provider: 'caveman' } }), c('sl2', 'statusline', { slot: 'statusline', defaultSelected: false, spec: { kind: 'statusline', provider: 'claude-hud' } })] };
function scripted(script: { profile?: string; multi?: Record<string, string[]>; slot?: Record<string, string>; confirm?: boolean }): PickerUi & { notes: string[] } {
  const notes: string[] = [];
  return { notes, intro: () => {}, outro: () => {}, note: (m) => notes.push(m), isCancel: (v) => v === Symbol.for('cancel'),
    select: async (o) => (o.message.startsWith('Profile') ? (script.profile ?? 'all') : (script.slot?.[o.message] ?? (o.options[0]!.value as string))),
    multiselect: async (o) => script.multi?.[o.message] ?? (o.initialValues ?? []),
    confirm: async () => script.confirm ?? true };
}
describe('runPicker', () => {
  it('pre-fills from the profile, resolves slot conflicts, returns picked ids', async () => {
    const ui = scripted({ profile: 'all', multi: { 'Claude Code plugins': ['sp', 'ce'], 'Status line': ['sl1', 'sl2'] }, slot: { 'Only one methodology component can be active. Keep which?': 'ce', 'Only one statusline component can be active. Keep which?': 'sl1' } });
    const r = await runPicker(makeTestCtx({ manifest }), { state: null, ui });
    expect(r).toEqual({ picked: ['ce', 'sl1'], profile: 'all' }); expect(ui.notes.some((n) => /tokens/.test(n))).toBe(true);
  });
  it('uses profile defaults as initial values and returns null on decline', async () => {
    const ui = scripted({ profile: 'minimal', confirm: false });
    expect(await runPicker(makeTestCtx({ manifest }), { state: null, ui })).toBeNull();
    const ui2 = scripted({ profile: 'minimal' }); const r = await runPicker(makeTestCtx({ manifest }), { state: null, ui: ui2 }); expect(r?.picked).toEqual(['sp']);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/picker`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/picker/flow.ts`:
```ts
import * as clack from '@clack/prompts';
import type { Ctx, HostInfo, HostState, Kind, ProfileName } from '../types.js';
import { PROFILE_NAMES } from '../types.js';
import { resolveSelection, slotConflicts } from '../manifest/resolve.js';
export interface PickerUi {
  intro(m: string): void; outro(m: string): void; note(m: string, title?: string): void; isCancel(v: unknown): boolean;
  select(o: { message: string; options: Array<{ value: string; label: string; hint?: string }>; initialValue?: string }): Promise<unknown>;
  multiselect(o: { message: string; options: Array<{ value: string; label: string; hint?: string }>; initialValues?: string[]; required?: boolean }): Promise<unknown>;
  confirm(o: { message: string; initialValue?: boolean }): Promise<unknown>;
}
export const clackUi: PickerUi = { intro: clack.intro, outro: clack.outro, note: clack.note, isCancel: clack.isCancel, select: (o) => clack.select(o as never), multiselect: (o) => clack.multiselect({ ...o, required: false } as never), confirm: clack.confirm };
const CATEGORIES: Array<[Kind, string]> = [['agent', 'Agents'], ['tool', 'Prerequisite tools'], ['claude-plugin', 'Claude Code plugins'], ['codex-plugin', 'Codex plugins'], ['mcp', 'MCP servers'], ['skill', 'Skills'], ['setting', 'Settings'], ['hook', 'Hooks'], ['statusline', 'Status line'], ['instructions', 'Instructions']];
export function hostSummary(h: HostInfo): string { return [`${h.platform}/${h.arch}${h.isWsl ? ' WSL' : ''}${h.isLxc ? ' LXC' : ''}${h.isProxmoxHost ? ' Proxmox host' : ''}`, h.isRoot ? 'root' : `user${h.hasSudo ? ' (sudo)' : ' (no sudo)'}`, `pkg: ${h.pkgManager ?? 'none'}`, h.hasAvx === false ? 'NO AVX' : '', h.diskFreeMb !== null ? `${Math.round(h.diskFreeMb / 1024)} GB free` : ''].filter(Boolean).join(' · '); }
export async function runPicker(ctx: Ctx, o: { state: HostState | null; ui?: PickerUi }): Promise<{ picked: string[]; profile: ProfileName | 'saved' } | null> {
  const ui = o.ui ?? clackUi; const m = ctx.manifest; ui.intro('super-agent-installer'); ui.note(hostSummary(ctx.host), 'Host');
  const profiles = PROFILE_NAMES.filter((p) => m.profiles[p]).map((p) => ({ value: p as string, label: p, hint: m.profiles[p]?.description }));
  if (o.state) profiles.unshift({ value: 'saved', label: 'saved (this host)', hint: `${o.state.selectedIds.length} components from ${o.state.lastRun}` });
  const profile = await ui.select({ message: 'Profile (starting point; you can adjust every category next)', options: profiles, initialValue: o.state ? 'saved' : 'all' }); if (ui.isCancel(profile)) return null;
  const prof = profile as ProfileName | 'saved';
  const base = resolveSelection(m, ctx.host, prof === 'saved' ? { profile: 'saved', savedIds: o.state?.selectedIds ?? [] } : { profile: prof });
  const initial = new Set(base.components.map((c) => c.id)); const picked: string[] = [];
  for (const [kind, label] of CATEGORIES) {
    const comps = m.components.filter((c) => c.kind === kind && c.platforms.includes(ctx.host.platform)); if (!comps.length) continue;
    const options = comps.map((c) => ({ value: c.id, label: `${c.name}${c.forceOffInAll ? ' (off in ALL)' : ''}`, hint: [c.verdict, c.contextCostTokens?.claude ? `${c.contextCostTokens.claude} tok` : '', c.popularity?.stars ? `${c.popularity.stars.toLocaleString()} stars` : c.popularity?.installs ? `${c.popularity.installs.toLocaleString()} installs` : '', c.description].filter(Boolean).join(' · ') }));
    const r = await ui.multiselect({ message: label, options, initialValues: comps.filter((c) => initial.has(c.id)).map((c) => c.id), required: false }); if (ui.isCancel(r)) return null;
    picked.push(...(r as string[]));
  }
  let chosen = m.components.filter((c) => picked.includes(c.id));
  for (const conflict of slotConflicts(chosen)) {
    const w = await ui.select({ message: `Only one ${conflict.slot} component can be active. Keep which?`, options: conflict.ids.map((id) => ({ value: id, label: id })), initialValue: conflict.ids[0] }); if (ui.isCancel(w)) return null;
    chosen = chosen.filter((c) => c.slot !== conflict.slot || c.id === w);
  }
  const sel = resolveSelection(m, ctx.host, { profile: prof, picked: chosen.map((c) => c.id), savedIds: o.state?.selectedIds });
  const warn = [sel.tokenTotals.claude > 8000 ? `Claude always-on tokens ~${sel.tokenTotals.claude} (above the 8k warning line)` : `Claude always-on tokens ~${sel.tokenTotals.claude}`, sel.codexMcpCount > 5 ? `Codex MCP servers: ${sel.codexMcpCount} (Codex has no tool search; keep it at 5 or fewer)` : `Codex MCP servers: ${sel.codexMcpCount}`, `${sel.components.length} components selected`, ...(sel.excluded.filter((e) => e.reason !== 'platform').map((e) => `excluded ${e.id}: ${e.reason}`))];
  ui.note(warn.join('\n'), 'Selection');
  const go = await ui.confirm({ message: 'Proceed with this selection?', initialValue: true }); if (ui.isCancel(go) || !go) return null;
  return { picked: sel.components.map((c) => c.id), profile: prof };
}
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/picker`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/picker test/picker
git commit -m "feat(picker): interactive profile and per-category selection with slot resolution and budget notes"
```

---

### Task 27: Self-update

**Files:**
- Create: `src/update/self-update.ts`
- Test: `test/update/self-update.test.ts`

**Interfaces:**
- `selfUpdate(ctx, currentVersion, deps?: { fetch?; execPath?; platform?; arch?; writeFile?; rename?; chmod? }): Promise<{ updated: boolean; message: string }>`. Steps: `latestGithubRelease(fetch, REPO)`; if not newer -> `{ updated: false, message: 'already current (vX)' }`; when running from source (`execPath` ends with `bun`/`node` or `process.argv[1]` ends with `.ts`/`.js`) -> `{ updated: false, message: 'running from source; update with git pull / npm' }`; download `https://github.com/${REPO}/releases/download/v${latest}/SHA256SUMS` and `super-agent-installer-${target}${ext}` (target from platform/arch: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `windows-x64` + `.exe`), verify sha256 (node:crypto), write next to the current executable as `<exe>.new`, then on POSIX `rename` over the executable (chmod 755); on Windows rename current to `<exe>.old`, rename `.new` to `<exe>`, and log that `.old` can be deleted; return `{ updated: true, message: 'updated vA -> vB; rerun the command' }`. Dry-run: report what would happen, no writes.

- [ ] **Step 1: Write failing tests**

`test/update/self-update.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selfUpdate } from '../../src/update/self-update.js';
import { makeTestCtx } from '../helpers/ctx.js';
const bin = Buffer.from('new-binary'); const sha = createHash('sha256').update(bin).digest('hex');
const f = (latest: string) => (async (url: string | URL, init?: RequestInit) => { const u = String(url); if (u.endsWith('/releases/latest')) return new Response('', { status: 302, headers: { location: `https://github.com/x/y/releases/tag/v${latest}` } }); if (u.endsWith('SHA256SUMS')) return new Response(`${sha}  super-agent-installer-linux-x64\nabc  other\n`); if (u.includes('super-agent-installer-linux-x64')) return new Response(bin); return new Response('nf', { status: 404 }); }) as unknown as typeof fetch;
describe('selfUpdate', () => {
  it('reports current when not newer', async () => { expect(await selfUpdate(makeTestCtx(), '0.2.0', { fetch: f('0.2.0'), execPath: '/opt/sai/super-agent-installer', platform: 'linux', arch: 'x64' })).toMatchObject({ updated: false, message: expect.stringMatching(/current/) }); });
  it('downloads, verifies and replaces the executable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const exe = join(dir, 'super-agent-installer'); writeFileSync(exe, 'old');
    const r = await selfUpdate(makeTestCtx(), '0.1.0', { fetch: f('0.2.0'), execPath: exe, platform: 'linux', arch: 'x64' });
    expect(r.updated).toBe(true); expect(readFileSync(exe, 'utf8')).toBe('new-binary'); expect(existsSync(`${exe}.new`)).toBe(false);
  });
  it('refuses on checksum mismatch', async () => {
    const bad = (async (url: string | URL) => { const u = String(url); if (u.endsWith('/releases/latest')) return new Response('', { status: 302, headers: { location: 'https://github.com/x/y/releases/tag/v0.2.0' } }); if (u.endsWith('SHA256SUMS')) return new Response('0000  super-agent-installer-linux-x64\n'); return new Response(bin); }) as unknown as typeof fetch;
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const exe = join(dir, 'super-agent-installer'); writeFileSync(exe, 'old');
    const r = await selfUpdate(makeTestCtx(), '0.1.0', { fetch: bad, execPath: exe, platform: 'linux', arch: 'x64' }); expect(r.updated).toBe(false); expect(r.message).toMatch(/checksum/); expect(readFileSync(exe, 'utf8')).toBe('old');
  });
  it('does nothing when running from source', async () => { expect((await selfUpdate(makeTestCtx(), '0.1.0', { fetch: f('9.9.9'), execPath: '/usr/bin/bun', platform: 'linux', arch: 'x64' })).message).toMatch(/source/); });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/update/self-update.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/update/self-update.ts`:
```ts
import { createHash } from 'node:crypto';
import { writeFile, rename, chmod, unlink } from 'node:fs/promises';
import type { Ctx } from '../types.js';
import { REPO } from '../pins.js';
import { latestGithubRelease } from '../version/latest.js';
import { isNewer } from '../version/compare.js';
export interface SelfUpdateDeps { fetch?: typeof fetch; execPath?: string; platform?: string; arch?: string }
export function releaseTarget(platform: string, arch: string): { asset: string; exe: string } { const os = platform === 'win32' || platform === 'windows' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux'; const a = arch === 'arm64' || arch === 'aarch64' ? 'arm64' : 'x64'; const asset = `super-agent-installer-${os}-${a}`; return { asset, exe: os === 'windows' ? `${asset}.exe` : asset }; }
export async function selfUpdate(ctx: Ctx, current: string, d: SelfUpdateDeps = {}): Promise<{ updated: boolean; message: string }> {
  const f = d.fetch ?? ctx.fetch; const execPath = d.execPath ?? process.execPath; const platform = d.platform ?? process.platform; const arch = d.arch ?? process.arch;
  if (/(^|[\\/])(bun|node)(\.exe)?$/.test(execPath)) return { updated: false, message: 'running from source; update with git pull or npm install -g super-agent-installer@latest' };
  const latest = await latestGithubRelease(f, REPO); if (!latest) return { updated: false, message: 'could not reach GitHub releases' };
  if (!isNewer(latest, current)) return { updated: false, message: `already current (v${current})` };
  if (ctx.dryRun) return { updated: false, message: `[dry-run] would update v${current} -> v${latest}` };
  const { asset, exe } = releaseTarget(platform, arch); const base = `https://github.com/${REPO}/releases/download/v${latest}`;
  try {
    const sums = await (await f(`${base}/SHA256SUMS`)).text(); const line = sums.split('\n').find((l) => l.trim().endsWith(exe) || l.trim().endsWith(asset)); const expected = line?.trim().split(/\s+/)[0];
    if (!expected) return { updated: false, message: `no checksum for ${exe} in release v${latest}` };
    const r = await f(`${base}/${exe}`); if (!r.ok) return { updated: false, message: `download failed (${r.status})` };
    const buf = Buffer.from(await r.arrayBuffer()); const actual = createHash('sha256').update(buf).digest('hex');
    if (actual !== expected) return { updated: false, message: `checksum mismatch for ${exe}: expected ${expected}, got ${actual}` };
    const tmp = `${execPath}.new`; await writeFile(tmp, buf); if (platform !== 'win32' && platform !== 'windows') await chmod(tmp, 0o755);
    if (platform === 'win32' || platform === 'windows') { const old = `${execPath}.old`; try { await unlink(old); } catch { /* none */ } await rename(execPath, old); await rename(tmp, execPath); ctx.log.info(`old executable kept at ${old}; delete it when convenient`); }
    else await rename(tmp, execPath);
    return { updated: true, message: `updated v${current} -> v${latest}; rerun the command` };
  } catch (e) { return { updated: false, message: `self-update failed: ${(e as Error).message}` }; }
}
```

- [ ] **Step 4: Run tests**

Run: `bunx vitest run test/update/self-update.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/update/self-update.ts test/update/self-update.test.ts
git commit -m "feat(update): self-update from GitHub Releases with SHA256SUMS verification"
```

---

### Task 28: CLI entry point

**Files:**
- Create: `src/cli.ts`, `src/version.ts`
- Test: `test/cli.test.ts`

**Interfaces:**
- `parseCli(argv: string[]): CliArgs` (pure, testable) with `CliArgs = { command: 'install'|'update'|'check'|'uninstall'|'list'|'doctor'|'self-update'|'help'|'version'; profile?: ProfileName; only?: string[]; skip?: string[]; yes: boolean; dryRun: boolean; json: boolean; noAudit: boolean; noSelfUpdate: boolean; fromState: boolean; channel?: Channel; verbose: boolean; manifest?: string; logFile?: string; ids: string[] }` using `node:util` `parseArgs` with `allowPositionals`. Unknown command -> `help` with exit 1. `main(argv, io?)`: creates ctx, dispatches; `install` with a TTY and no `--yes` and no `--only/--profile` runs the picker first (`process.stdin.isTTY && process.stdout.isTTY`); no TTY and no `--yes` -> print `Unable to run interactively. Run with --yes [--profile <name>]` and exit 3. `VERSION` in `src/version.ts` read from `package.json` at build time (`import pkg from '../package.json' with { type: 'json' }`).

- [ ] **Step 1: Write failing tests**

`test/cli.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseCli } from '../src/cli.js';
describe('parseCli', () => {
  it('parses commands and flags', () => {
    expect(parseCli(['install', '--profile', 'homelab', '--only', 'a,b', '--skip', 'c', '--yes', '--dry-run', '--json', '--no-audit', '--channel', 'stable', '-v'])).toMatchObject({ command: 'install', profile: 'homelab', only: ['a', 'b'], skip: ['c'], yes: true, dryRun: true, json: true, noAudit: true, channel: 'stable', verbose: true });
    expect(parseCli([])).toMatchObject({ command: 'install' });
    expect(parseCli(['uninstall', 'cp-x', 'cp-y', '-y'])).toMatchObject({ command: 'uninstall', ids: ['cp-x', 'cp-y'], yes: true });
    expect(parseCli(['update', '--no-self-update', '--from-state'])).toMatchObject({ command: 'update', noSelfUpdate: true, fromState: true });
    expect(parseCli(['--version'])).toMatchObject({ command: 'version' }); expect(parseCli(['bogus'])).toMatchObject({ command: 'help', error: expect.stringContaining('bogus') });
    expect(() => parseCli(['install', '--profile', 'nope'])).toThrow(/profile/);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/cli.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/version.ts`:
```ts
import pkg from '../package.json' with { type: 'json' };
export const VERSION: string = (pkg as { version: string }).version;
```

`src/cli.ts`:
```ts
#!/usr/bin/env node
import { parseArgs } from 'node:util';
import type { Channel, ProfileName } from './types.js';
import { PROFILE_NAMES } from './types.js';
import { VERSION } from './version.js';
import { createCtx } from './context.js';
import { runInstall } from './commands/install.js';
import { runUpdate } from './commands/update.js';
import { runCheck } from './commands/check.js';
import { runUninstall } from './commands/uninstall.js';
import { runList } from './commands/list.js';
import { runDoctor } from './commands/doctor.js';
import { selfUpdate } from './update/self-update.js';
import { readState } from './state/state.js';
import { runPicker } from './picker/flow.js';
export type Command = 'install' | 'update' | 'check' | 'uninstall' | 'list' | 'doctor' | 'self-update' | 'help' | 'version';
export interface CliArgs { command: Command; profile?: ProfileName; only?: string[]; skip?: string[]; yes: boolean; dryRun: boolean; json: boolean; noAudit: boolean; noSelfUpdate: boolean; fromState: boolean; channel?: Channel; verbose: boolean; manifest?: string; logFile?: string; ids: string[]; error?: string }
const HELP = `super-agent-installer v${VERSION}
Usage: super-agent-installer [install] [--profile <name>] [--only a,b] [--skip c] [--yes] [--dry-run]
       super-agent-installer update [--no-self-update] | check | list | doctor | self-update | uninstall [id...]
Profiles: ${PROFILE_NAMES.join(', ')}
Flags: --yes/-y  --dry-run  --json  --no-audit  --channel latest|stable  --from-state  --manifest <path>  --log-file <path>  --verbose/-v  --version  --help/-h`;
export function parseCli(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: { profile: { type: 'string' }, only: { type: 'string' }, skip: { type: 'string' }, yes: { type: 'boolean', short: 'y', default: false }, 'dry-run': { type: 'boolean', default: false }, json: { type: 'boolean', default: false }, 'no-audit': { type: 'boolean', default: false }, 'no-self-update': { type: 'boolean', default: false }, 'from-state': { type: 'boolean', default: false }, channel: { type: 'string' }, verbose: { type: 'boolean', short: 'v', default: false }, manifest: { type: 'string' }, 'log-file': { type: 'string' }, version: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false } } });
  const [first, ...rest] = positionals; const commands: Command[] = ['install', 'update', 'check', 'uninstall', 'list', 'doctor', 'self-update'];
  let command: Command = 'install'; let error: string | undefined; let ids = rest;
  if (values.help) command = 'help'; else if (values.version) command = 'version'; else if (first && commands.includes(first as Command)) command = first as Command; else if (first) { command = 'help'; error = `unknown command: ${first}`; ids = []; }
  if (values.profile && !PROFILE_NAMES.includes(values.profile as ProfileName)) throw new Error(`unknown profile ${values.profile}; use one of ${PROFILE_NAMES.join(', ')}`);
  if (values.channel && values.channel !== 'latest' && values.channel !== 'stable') throw new Error('--channel must be latest or stable');
  const list = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
  return { command, profile: values.profile as ProfileName | undefined, only: list(values.only), skip: list(values.skip), yes: values.yes, dryRun: values['dry-run'], json: values.json, noAudit: values['no-audit'], noSelfUpdate: values['no-self-update'], fromState: values['from-state'], channel: values.channel as Channel | undefined, verbose: values.verbose, manifest: values.manifest, logFile: values['log-file'], ids, error };
}
export async function main(argv = process.argv.slice(2)): Promise<number> {
  let a: CliArgs; try { a = parseCli(argv); } catch (e) { console.error((e as Error).message); console.error(HELP); return 1; }
  if (a.command === 'help') { if (a.error) console.error(a.error); console.log(HELP); return a.error ? 1 : 0; }
  if (a.command === 'version') { console.log(VERSION); return 0; }
  const ctx = await createCtx({ dryRun: a.dryRun, yes: a.yes, noAudit: a.noAudit, channel: a.channel, verbose: a.verbose, json: a.json, manifestPath: a.manifest, logFile: a.logFile });
  const tty = !!process.stdin.isTTY && !!process.stdout.isTTY;
  switch (a.command) {
    case 'install': {
      const interactive = tty && !a.yes && !a.only && !a.profile && !a.fromState;
      if (!tty && !a.yes) { console.error('Unable to run interactively. Run with --yes [--profile <name>]'); return 3; }
      if (interactive) { const state = await readState(ctx.paths.stateFile); const pick = await runPicker(ctx, { state }); if (!pick) { console.log('cancelled'); return 0; } ctx.yes = false; return runInstall(ctx, { picked: pick.picked, profile: pick.profile === 'saved' ? undefined : pick.profile, json: a.json, installerVersion: VERSION }); }
      return runInstall(ctx, { profile: a.profile, only: a.only, skip: a.skip, fromState: a.fromState, json: a.json, installerVersion: VERSION });
    }
    case 'update': return runUpdate(ctx, { json: a.json, installerVersion: VERSION, noSelfUpdate: a.noSelfUpdate, selfUpdateFn: selfUpdate });
    case 'check': return runCheck(ctx, { json: a.json });
    case 'uninstall': if (!tty && !a.yes) { console.error('Unable to run interactively. Run with --yes'); return 3; } return runUninstall(ctx, a.ids, { json: a.json, installerVersion: VERSION });
    case 'list': return runList(ctx);
    case 'doctor': return runDoctor(ctx);
    case 'self-update': { const r = await selfUpdate(ctx, VERSION); console.log(r.message); return 0; }
  }
  return 1;
}
if (import.meta.main ?? (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1]))) main().then((code) => process.exit(code), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
```
Note: `runList(ctx)` must be exported from `src/commands/list.ts` (Task 24) as `export async function runList(ctx: Ctx): Promise<number> { const s = await readState(ctx.paths.stateFile); console.log(renderList(ctx.manifest, ctx.host.platform, s?.selectedIds ?? [])); return 0; }`.

- [ ] **Step 4: Run tests and a smoke run**

Run: `bunx vitest run test/cli.test.ts && bun run src/cli.ts --help && bun run src/cli.ts doctor | head -20`
Expected: tests PASS; help prints; doctor prints this host's summary (read-only).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/version.ts src/commands/list.ts test/cli.test.ts
git commit -m "feat(cli): argument parsing, command dispatch, TTY gating and exit codes"
```

### Task 29: The real manifest.json (plus three small provider amendments it needs)

**Files:**
- Modify: `src/providers/tool.ts` (split multi-package strings), `src/providers/mcp-codex.ts` (non-secret `${VAR}` placeholder substitution), `src/providers/setting.ts` + `src/manifest/schema.ts` + `src/types.ts` (`${HOME}` substitution in `codexToml`, new `claudeJsonSeed`)
- Create: `manifest.json` (replace the placeholder)
- Test: `test/manifest/real-manifest.test.ts`, additions to `test/providers/tool.test.ts`, `test/providers/mcp-codex.test.ts`, `test/providers/setting.test.ts`

**Interfaces:**
- `SettingSpec.claudeJsonSeed?: Record<string, unknown>`: written to `paths.claudeJson` only when that file does not exist (headless onboarding seed); detect = file exists.
- Placeholders: `${HOME}` in `codexToml` keys/values -> `ctx.host.home`; in Codex MCP `url`/`args`/`env` values, `${VAR}` where `VAR` is not in `secretEnv` -> `ctx.env[VAR] ?? ctx.secrets.get(VAR)`; unresolved non-secret placeholders make the action fail with `set VAR or answer the prompt`.
- Tool `packages.apt|dnf|apk|pacman|zypper|brew|npm` may contain several space-separated packages.

- [ ] **Step 1: Write the amendment tests**

Append to `test/providers/tool.test.ts`:
```ts
it('installs several packages from one string', async () => {
  const ctx = makeTestCtx({ host: { isRoot: true, hasSudo: false }, responses: { 'apt-get install -y bubblewrap socat': '', 'npm config get prefix': '/root/.local', 'npm install -g typescript-language-server typescript': '' } });
  await (await toolProvider.plan(tool('bwrap', { probe: ['bwrap', '--version'], packages: { apt: 'bubblewrap socat' } }), ctx, null, 'install'))[0]!.run(ctx);
  expect(ctx.calls).toContainEqual(['apt-get', 'install', '-y', 'bubblewrap', 'socat']);
  await (await toolProvider.plan(tool('tsls', { probe: ['typescript-language-server', '--version'], packages: { npm: 'typescript-language-server typescript' } }), ctx, null, 'install'))[0]!.run(ctx);
  expect(ctx.calls).toContainEqual(['npm', 'install', '-g', 'typescript-language-server', 'typescript']);
});
```
Append to `test/providers/mcp-codex.test.ts`:
```ts
it('substitutes non-secret placeholders from env and fails when unresolved', async () => {
  const c = mcp({ name: 'ha', url: '${HA_URL}/api/mcp', extra: { auth: 'oauth' }, secretEnv: [] });
  const ctx = ctxWith('', { 'codex mcp add ha --url https://ha.lan:8123/api/mcp': '', 'codex mcp get ha --json': '{}' }); ctx.env.HA_URL = 'https://ha.lan:8123';
  expect((await (await mcpCodexProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx)).ok).toBe(true);
  const none = ctxWith(''); const r = await (await mcpCodexProvider.plan(c, none, null, 'install'))[0]!.run(none); expect(r.ok).toBe(false); expect(r.message).toMatch(/HA_URL/);
});
```
Append to `test/providers/setting.test.ts`:
```ts
it('expands ${HOME} in codexToml and seeds ~/.claude.json only when absent', async () => {
  const ctx = makeTestCtx({ responses: base }); writeFileSync(ctx.paths.codexConfig, '');
  const t = setting('set-trust', { target: 'codex', codexToml: { projects: { '${HOME}': { trust_level: 'trusted' } } } });
  await (await settingProvider.plan(t, ctx, null, 'install'))[0]!.run(ctx); expect(readFileSync(ctx.paths.codexConfig, 'utf8')).toContain(`[projects."${ctx.host.home}"]`);
  const seed = setting('set-seed', { target: 'claude', claudeJsonSeed: { hasCompletedOnboarding: true } });
  await (await settingProvider.plan(seed, ctx, null, 'install'))[0]!.run(ctx); expect(JSON.parse(readFileSync(ctx.paths.claudeJson, 'utf8'))).toEqual({ hasCompletedOnboarding: true });
  writeFileSync(ctx.paths.claudeJson, '{"x":1}'); expect(await settingProvider.detect(seed, ctx)).toEqual({ version: null });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/providers/tool.test.ts test/providers/mcp-codex.test.ts test/providers/setting.test.ts`
Expected: the three new tests FAIL.

- [ ] **Step 3: Apply the amendments**

In `src/providers/tool.ts`, replace every `pkg`-carrying argv construction so the package string is split: in `pmInstall`, change each `[..., p.apt]` style to `[..., ...p.apt.split(/\s+/)]` (same for dnf/pacman/zypper/apk/brew/winget/scoop) and in `npmGlobal` use `['npm', 'install', '-g', ...pkg.split(/\s+/)]`; in the uninstall branch use `.split(/\s+/)[0]` semantics via the same spread.

In `src/providers/mcp-codex.ts`, add:
```ts
function substitute(value: string, spec: McpSpec, ctx: Ctx): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (m, name: string) => { if (spec.secretEnv?.includes(name)) return m; const v = ctx.env[name] ?? ctx.secrets.get(name); if (v === undefined) throw new Error(`${name} is not set; export it or answer the prompt`); return v; });
}
```
and apply it to `spec.url`, each `spec.args` element and each `spec.env` value inside the action (wrap in try/catch returning `fail(e.message)`), and to `desiredCodexMcp` via an optional third parameter `resolve?: (s: string) => string` used by the provider when comparing.

In `src/types.ts` add `claudeJsonSeed?: Record<string, unknown>` to `SettingSpec`; in `src/manifest/schema.ts` add `claudeJsonSeed: z.record(z.string(), z.unknown()).optional()`; in `src/providers/setting.ts`: (a) before using `s.codexToml`, deep-replace `${HOME}` in keys and string values with `ctx.host.home` (helper `expandHome(obj, home)`), also in `detect`; (b) `claudeJsonSeed`: detect -> `{version:null}` when `paths.claudeJson` exists; install -> when absent, `writeJsonAtomic(paths.claudeJson, seed, {mode: 0o600})`; uninstall -> no-op.

- [ ] **Step 4: Write the real manifest test**

`test/manifest/real-manifest.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseManifest } from '../../src/manifest/schema.js';
import { resolveSelection, slotConflicts } from '../../src/manifest/resolve.js';
import type { HostInfo } from '../../src/types.js';
const m = parseManifest(JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8')));
const host = (platform: HostInfo['platform']) => ({ platform } as HostInfo);
describe('manifest.json', () => {
  it('validates and contains the approved core', () => {
    const ids = m.components.map((c) => c.id);
    for (const id of ['claude-code', 'codex-cli', 'node', 'git', 'uv', 'caveman-cli', 'playwright-cli', 'typescript-language-server', 'pyright', 'gopls', 'cp-superpowers', 'cp-caveman', 'cp-security-guidance', 'cp-context7', 'cp-commit-commands', 'cp-typescript-lsp', 'cp-pyright-lsp', 'cp-gopls-lsp', 'cp-frontend-design', 'cp-skill-creator', 'cp-feature-dev', 'cp-claude-md-management', 'cp-github', 'cp-chrome-devtools-mcp', 'cp-hookify', 'cp-playwright', 'cp-remember', 'cp-plugin-dev', 'cp-pr-review-toolkit', 'cp-code-review', 'cp-code-simplifier', 'cp-ralph-loop', 'cp-claude-code-setup', 'sk-find-skills', 'sk-caveman-codex', 'sk-cc-devops', 'sk-linux-admin', 'sk-powershell-windows', 'mcp-cx-context7', 'mcp-cx-exa', 'hook-caveman-claude', 'hook-caveman-codex', 'sl-caveman', 'sl-claude-hud', 'instr-global', 'set-codex-memories', 'set-windows-git-symlinks']) expect(ids, id).toContain(id);
    expect(Object.keys(m.profiles).sort()).toEqual(['all', 'claude-only', 'codex-only', 'homelab', 'minimal', 'proxmox-host', 'work']);
  });
  it('profile all on linux has no slot conflicts, respects forceOff, stays under the token warning', () => {
    const s = resolveSelection(m, host('linux'), { profile: 'all' });
    expect(slotConflicts(s.components)).toEqual([]);
    expect(s.components.map((c) => c.id)).not.toContain('hook-caveman-codex');
    expect(s.components.map((c) => c.id)).toEqual(expect.arrayContaining(['claude-code', 'codex-cli', 'cp-superpowers', 'cp-caveman', 'cp-github', 'cp-chrome-devtools-mcp', 'cp-hookify', 'sk-cc-devops', 'sk-linux-admin', 'mcp-cx-context7', 'mcp-cx-exa', 'sl-caveman', 'hook-caveman-claude', 'instr-global']));
    expect(s.tokenTotals.claude).toBeLessThan(8000); expect(s.codexMcpCount).toBeLessThanOrEqual(5);
  });
  it('windows all includes powershell skill and excludes linux-only items', () => {
    const s = resolveSelection(m, host('windows'), { profile: 'all' }); const ids = s.components.map((c) => c.id);
    expect(ids).toContain('sk-powershell-windows'); expect(ids).toContain('set-windows-git-symlinks'); expect(ids).not.toContain('sk-linux-admin'); expect(ids).not.toContain('bubblewrap');
  });
  it('proxmox-host is lean and headless', () => {
    const s = resolveSelection(m, host('linux'), { profile: 'proxmox-host' }); const ids = s.components.map((c) => c.id);
    expect(ids).toContain('set-claude-headless-seed'); expect(ids).toContain('set-codex-trust-home'); expect(ids).not.toContain('cp-playwright'); expect(ids).not.toContain('cp-chrome-devtools-mcp'); expect(ids).not.toContain('cp-typescript-lsp');
  });
  it('every skill component with named skills has audit entries', () => {
    for (const c of m.components) if (c.spec.kind === 'skill' && c.spec.skills !== '*') expect(c.audit?.length, c.id).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Write manifest.json**

`manifest.json` (all commands and numbers are from the verified reports; `observedAt` is the date the number was read):
```json
{
  "version": 1,
  "profiles": {
    "all": { "description": "Everything selected by default (forced-off items stay off)", "base": "all" },
    "minimal": { "description": "Agents + superpowers + caveman + context7 + find-skills", "base": "none", "include": ["claude-code", "codex-cli", "git", "node", "cp-superpowers", "cp-caveman", "cp-context7", "sk-find-skills", "sk-caveman-codex", "mcp-cx-context7", "instr-global"] },
    "claude-only": { "description": "Claude Code side only", "base": "all", "agentFilter": "claude" },
    "codex-only": { "description": "Codex CLI side only", "base": "all", "agentFilter": "codex" },
    "work": { "description": "Work hosts: no proxies, no personal/homelab servers, GitHub read-only", "base": "all", "exclude": ["hook-caveman-codex", "cp-github", "mcp-cx-github", "sk-proxmox-admin", "sk-lunar-proxmox", "mcp-ha-claude", "mcp-ha-codex", "mcp-proxmox-claude", "mcp-proxmox-codex", "mcp-tailscale-claude", "mcp-tailscale-codex"] },
    "homelab": { "description": "Everything plus Proxmox/Home Assistant/Docker/Kubernetes helpers", "base": "all", "include": ["sk-proxmox-admin", "mcp-ha-claude", "mcp-ha-codex", "set-codex-oauth-port", "mcp-k8s-claude", "mcp-k8s-codex", "docker-mcp-gateway", "uv"] },
    "proxmox-host": { "description": "Root Debian host: apt-installed Claude, standalone Codex, no browser/LSP components, headless auth seeding", "base": "none", "headless": true, "include": ["claude-code", "codex-cli", "git", "node", "jq", "ripgrep", "cp-superpowers", "cp-caveman", "cp-context7", "cp-security-guidance", "cp-commit-commands", "sk-find-skills", "sk-caveman-codex", "sk-cc-devops", "sk-linux-admin", "sk-proxmox-admin", "mcp-cx-context7", "set-codex-trust-home", "set-claude-headless-seed", "set-codex-memories", "instr-global"] }
  },
  "components": [
    { "id": "claude-code", "name": "Claude Code", "kind": "agent", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Anthropic's terminal agent (native installer; apt repo on root Debian hosts; brew cask on macOS)", "verdict": "must-have", "defaultSelected": true, "popularity": { "stars": 145476, "downloadsWeekly": 10994666, "observedAt": "2026-09-17" }, "source": "https://code.claude.com/docs/en/setup", "spec": { "kind": "agent", "agent": "claude" } },
    { "id": "codex-cli", "name": "Codex CLI", "kind": "agent", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "OpenAI's terminal agent (standalone installer, CODEX_NON_INTERACTIVE=1; brew cask on macOS)", "verdict": "must-have", "defaultSelected": true, "popularity": { "stars": 124738, "downloadsWeekly": 17149232, "observedAt": "2026-09-17" }, "source": "https://learn.chatgpt.com/docs/cli", "spec": { "kind": "agent", "agent": "codex" } },

    { "id": "git", "name": "git", "kind": "tool", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "Version control; Git Bash on Windows also runs caveman plugin hooks", "verdict": "must-have", "defaultSelected": true, "spec": { "kind": "tool", "probe": ["git", "--version"], "packages": { "apt": "git", "dnf": "git", "apk": "git", "pacman": "git", "zypper": "git", "brew": "git", "winget": "Git.Git", "scoop": "git" } } },
    { "id": "node", "name": "Node.js 24 LTS", "kind": "tool", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "Needed by npx MCP servers, the skills CLI (>=22.20), caveman CLI, Playwright CLI (fnm on desktops, NodeSource on root servers, winget on Windows)", "verdict": "must-have", "defaultSelected": true, "spec": { "kind": "tool", "strategy": "node", "probe": ["node", "--version"], "packages": {} } },
    { "id": "uv", "name": "uv", "kind": "tool", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "Python tool runner for uvx MCP servers (serena, grafana, portainer, proxmox) and snyk-agent-scan", "verdict": "recommended", "defaultSelected": true, "spec": { "kind": "tool", "probe": ["uv", "--version"], "latest": { "github": "astral-sh/uv" }, "packages": { "winget": "astral-sh.uv", "brew": "uv", "script": { "linux": "curl -LsSf https://astral.sh/uv/install.sh | sh", "darwin": "curl -LsSf https://astral.sh/uv/install.sh | sh" } } } },
    { "id": "jq", "name": "jq", "kind": "tool", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "JSON processor (handy for hooks and scripts)", "verdict": "recommended", "defaultSelected": true, "spec": { "kind": "tool", "probe": ["jq", "--version"], "latest": { "github": "jqlang/jq" }, "packages": { "apt": "jq", "dnf": "jq", "apk": "jq", "pacman": "jq", "zypper": "jq", "brew": "jq", "winget": "jqlang.jq", "scoop": "jq" } } },
    { "id": "ripgrep", "name": "ripgrep", "kind": "tool", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "Fast search; required by Claude Code on Alpine and by rtk", "verdict": "recommended", "defaultSelected": true, "spec": { "kind": "tool", "probe": ["rg", "--version"], "packages": { "apt": "ripgrep", "dnf": "ripgrep", "apk": "ripgrep", "pacman": "ripgrep", "zypper": "ripgrep", "brew": "ripgrep", "winget": "BurntSushi.ripgrep.MSVC", "scoop": "ripgrep" } } },
    { "id": "gh", "name": "GitHub CLI", "kind": "tool", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "gh CLI (commit-commands, PR flows); >=2.49 for attestation verify", "verdict": "recommended", "defaultSelected": true, "spec": { "kind": "tool", "probe": ["gh", "--version"], "latest": { "github": "cli/cli" }, "packages": { "apt": "gh", "dnf": "gh", "apk": "github-cli", "pacman": "github-cli", "zypper": "gh", "brew": "gh", "winget": "GitHub.cli", "scoop": "gh" } } },
    { "id": "bubblewrap", "name": "bubblewrap + socat", "kind": "tool", "agents": "both", "platforms": ["linux"], "description": "Sandbox helpers for Claude Code's bash sandbox and a system bwrap for Codex", "verdict": "optional", "defaultSelected": true, "spec": { "kind": "tool", "probe": ["bwrap", "--version"], "packages": { "apt": "bubblewrap socat", "dnf": "bubblewrap socat", "apk": "bubblewrap socat", "pacman": "bubblewrap socat", "zypper": "bubblewrap socat" } } },
    { "id": "powershell-7", "name": "PowerShell 7", "kind": "tool", "agents": "both", "platforms": ["windows"], "description": "Modern PowerShell (avoids Windows PowerShell 5.1 quirks)", "verdict": "recommended", "defaultSelected": true, "spec": { "kind": "tool", "probe": ["pwsh", "--version"], "packages": { "winget": "Microsoft.PowerShell" } } },
    { "id": "go", "name": "Go toolchain", "kind": "tool", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Needed to build gopls", "verdict": "optional", "defaultSelected": false, "spec": { "kind": "tool", "probe": ["go", "version"], "versionRegex": "go(\\d+\\.\\d+\\.\\d+)", "packages": { "apt": "golang-go", "dnf": "golang", "apk": "go", "pacman": "go", "zypper": "go", "brew": "go", "winget": "GoLang.Go", "scoop": "go" } } },
    { "id": "typescript-language-server", "name": "typescript-language-server", "kind": "tool", "agents": "claude", "platforms": ["linux", "darwin", "windows"], "description": "Language server binary for the typescript-lsp plugin (known .cmd shim spawn bug on native Windows, issue #59925)", "verdict": "must-have", "defaultSelected": true, "prerequisites": ["node"], "spec": { "kind": "tool", "probe": ["typescript-language-server", "--version"], "latest": { "npm": "typescript-language-server" }, "packages": { "npm": "typescript-language-server typescript" } } },
    { "id": "pyright", "name": "pyright", "kind": "tool", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Language server for the pyright-lsp plugin", "verdict": "must-have", "defaultSelected": true, "prerequisites": ["node"], "spec": { "kind": "tool", "probe": ["pyright", "--version"], "latest": { "npm": "pyright" }, "packages": { "npm": "pyright" } } },
    { "id": "gopls", "name": "gopls", "kind": "tool", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Go language server for the gopls-lsp plugin", "verdict": "recommended", "defaultSelected": true, "prerequisites": ["go"], "spec": { "kind": "tool", "probe": ["gopls", "version"], "versionRegex": "v(\\d+\\.\\d+\\.\\d+)", "packages": { "go": "golang.org/x/tools/gopls" } } },
    { "id": "caveman-cli", "name": "@caveman-ai/cli", "kind": "tool", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "caveman CLI (native hooks, proxy, cavemem); node >=22.13", "verdict": "must-have", "defaultSelected": true, "prerequisites": ["node"], "popularity": { "stars": 106038, "observedAt": "2026-09-17" }, "source": "https://github.com/JuliusBrussee/caveman", "spec": { "kind": "tool", "probe": ["caveman", "--version"], "latest": { "npm": "@caveman-ai/cli" }, "packages": { "npm": "@caveman-ai/cli" } } },
    { "id": "playwright-cli", "name": "Playwright CLI + skills", "kind": "tool", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "Browser automation as a CLI plus skills (no MCP schema cost; the route Playwright's own README recommends for coding agents)", "verdict": "recommended", "defaultSelected": true, "prerequisites": ["node"], "popularity": { "stars": 13345, "downloadsWeekly": 675949, "observedAt": "2026-09-17" }, "source": "https://github.com/microsoft/playwright-cli", "spec": { "kind": "tool", "probe": ["playwright-cli", "--version"], "latest": { "npm": "@playwright/cli" }, "packages": { "npm": "@playwright/cli" }, "postInstall": { "linux": [["playwright-cli", "install", "--skills"]], "darwin": [["playwright-cli", "install", "--skills"]], "windows": [["playwright-cli", "install", "--skills"]] } } },
    { "id": "docker-mcp-gateway", "name": "Docker MCP Gateway", "kind": "tool", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "Registers Docker's MCP gateway with both agents (needs Docker Desktop 4.59+ or Docker CE with the MCP plugin)", "verdict": "optional", "defaultSelected": false, "popularity": { "stars": 1600, "observedAt": "2026-09-17" }, "source": "https://github.com/docker/mcp-gateway", "spec": { "kind": "tool", "probe": ["docker", "mcp", "version"], "packages": { "script": { "linux": "docker mcp client connect claude-code --global && docker mcp client connect codex --global", "darwin": "docker mcp client connect claude-code --global && docker mcp client connect codex --global", "windows": "docker mcp client connect claude-code --global; docker mcp client connect codex --global" } } } },

    { "id": "cp-superpowers", "name": "superpowers", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Brainstorm, plan, TDD, debug, review, worktree skills", "verdict": "must-have", "defaultSelected": true, "slot": "methodology", "contextCostTokens": { "claude": 693 }, "popularity": { "stars": 287604, "installs": 1112404, "observedAt": "2026-09-17" }, "source": "https://github.com/obra/superpowers", "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "superpowers" } },
    { "id": "cp-caveman", "name": "caveman", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Token-saving communication skills + activation hooks (third-party marketplace, no auto-update)", "verdict": "must-have", "defaultSelected": true, "contextCostTokens": { "claude": 1814 }, "popularity": { "stars": 106038, "observedAt": "2026-09-17" }, "source": "https://github.com/JuliusBrussee/caveman", "spec": { "kind": "claude-plugin", "marketplace": "caveman", "marketplaceSource": "JuliusBrussee/caveman", "plugin": "caveman" } },
    { "id": "cp-security-guidance", "name": "security-guidance", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Hooks that review every edit for common vulnerabilities (0 always-on tokens)", "verdict": "must-have", "defaultSelected": true, "contextCostTokens": { "claude": 0 }, "popularity": { "installs": 241800, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "security-guidance" } },
    { "id": "cp-context7", "name": "context7", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Current library docs over remote MCP (deferred tools, 0 tokens)", "verdict": "must-have", "defaultSelected": true, "contextCostTokens": { "claude": 0 }, "popularity": { "stars": 62095, "installs": 417801, "observedAt": "2026-09-17" }, "secrets": [{ "env": "CONTEXT7_API_KEY", "prompt": "Context7 API key (optional, raises rate limits)", "required": false }], "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "context7" } },
    { "id": "cp-commit-commands", "name": "commit-commands", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "/commit, /commit-push-pr, /clean_gone", "verdict": "must-have", "defaultSelected": true, "contextCostTokens": { "claude": 108 }, "popularity": { "installs": 171244, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "commit-commands" } },
    { "id": "cp-typescript-lsp", "name": "typescript-lsp", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "darwin", "windows"], "description": "TypeScript diagnostics via LSP (binary installed separately)", "verdict": "must-have", "defaultSelected": true, "prerequisites": ["typescript-language-server"], "contextCostTokens": { "claude": 0 }, "popularity": { "installs": 212522, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "typescript-lsp" } },
    { "id": "cp-pyright-lsp", "name": "pyright-lsp", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Python diagnostics via LSP", "verdict": "must-have", "defaultSelected": true, "prerequisites": ["pyright"], "contextCostTokens": { "claude": 0 }, "popularity": { "installs": 109778, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "pyright-lsp" } },
    { "id": "cp-gopls-lsp", "name": "gopls-lsp", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Go diagnostics via LSP", "verdict": "recommended", "defaultSelected": true, "prerequisites": ["gopls"], "contextCostTokens": { "claude": 0 }, "popularity": { "installs": 41639, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "gopls-lsp" } },
    { "id": "cp-frontend-design", "name": "frontend-design", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Distinctive production-grade UI skill (#1 official plugin)", "verdict": "recommended", "defaultSelected": true, "contextCostTokens": { "claude": 83 }, "popularity": { "installs": 1245390, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "frontend-design" } },
    { "id": "cp-skill-creator", "name": "skill-creator", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Create, evaluate and optimize skills", "verdict": "recommended", "defaultSelected": true, "contextCostTokens": { "claude": 117 }, "popularity": { "installs": 385083, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "skill-creator" } },
    { "id": "cp-feature-dev", "name": "feature-dev", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Explore/architect/review agents for feature work", "verdict": "recommended", "defaultSelected": true, "contextCostTokens": { "claude": 243 }, "popularity": { "installs": 256017, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "feature-dev" } },
    { "id": "cp-claude-md-management", "name": "claude-md-management", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "CLAUDE.md revise/improve skills", "verdict": "recommended", "defaultSelected": true, "contextCostTokens": { "claude": 180 }, "popularity": { "installs": 287247, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "claude-md-management" } },
    { "id": "cp-github", "name": "github (remote MCP)", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Official GitHub MCP (api.githubcopilot.com); needs GITHUB_PERSONAL_ACCESS_TOKEN in your environment", "verdict": "recommended", "defaultSelected": true, "contextCostTokens": { "claude": 0 }, "popularity": { "stars": 32998, "installs": 344375, "observedAt": "2026-09-17" }, "secrets": [{ "env": "GITHUB_PERSONAL_ACCESS_TOKEN", "prompt": "GitHub personal access token for the github plugin", "required": false }], "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "github" } },
    { "id": "cp-chrome-devtools-mcp", "name": "chrome-devtools-mcp", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Chrome DevTools MCP: performance traces, network, console (58 tools; deferred)", "verdict": "recommended", "defaultSelected": true, "slot": "browser", "prerequisites": ["node"], "contextCostTokens": { "claude": 809 }, "popularity": { "stars": 52186, "installs": 117775, "downloadsWeekly": 1516489, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "chrome-devtools-mcp" } },
    { "id": "cp-hookify", "name": "hookify", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Create hooks from natural language rules", "verdict": "recommended", "defaultSelected": true, "contextCostTokens": { "claude": 297 }, "popularity": { "installs": 60376, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "hookify" } },
    { "id": "cp-playwright", "name": "playwright (MCP)", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Playwright MCP via npx (deferred tools on Claude); Playwright CLI skills are the lighter alternative", "verdict": "recommended", "defaultSelected": true, "prerequisites": ["node"], "contextCostTokens": { "claude": 0 }, "popularity": { "stars": 37181, "installs": 319887, "downloadsWeekly": 4633135, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "playwright" } },
    { "id": "cp-remember", "name": "remember", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Session memory plugin (built-in auto memory already covers most of it)", "verdict": "optional", "defaultSelected": true, "slot": "memory", "contextCostTokens": { "claude": 78 }, "popularity": { "stars": 172, "installs": 51442, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "remember" } },
    { "id": "cp-exa", "name": "exa (remote search MCP)", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Keyless web search MCP (Claude has built-in WebSearch, so optional)", "verdict": "optional", "defaultSelected": false, "contextCostTokens": { "claude": 0 }, "popularity": { "stars": 5000, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "exa" } },
    { "id": "cp-microsoft-docs", "name": "microsoft-docs (Microsoft Learn MCP)", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Official Microsoft Learn remote MCP (Azure/.NET/PowerShell docs)", "verdict": "optional", "defaultSelected": false, "contextCostTokens": { "claude": 0 }, "popularity": { "stars": 1892, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "microsoft-docs" } },
    { "id": "cp-grafana-mcp", "name": "grafana-mcp", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Grafana MCP (100+ tools; prune with --disable-*)", "verdict": "optional", "defaultSelected": false, "prerequisites": ["uv"], "popularity": { "stars": 3500, "observedAt": "2026-09-17" }, "secrets": [{ "env": "GRAFANA_SERVICE_ACCOUNT_TOKEN", "prompt": "Grafana service account token", "required": false }], "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "grafana-mcp" } },
    { "id": "cp-serena", "name": "serena", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Semantic code MCP via uvx (overlaps LSP plugins on Claude)", "verdict": "optional", "defaultSelected": false, "prerequisites": ["uv"], "contextCostTokens": { "claude": 0 }, "popularity": { "stars": 29478, "installs": 89147, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "serena" } },
    { "id": "cp-claude-hud", "name": "claude-hud", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Rich status line (context %, tools, agents, todos); run /claude-hud:setup after install", "verdict": "optional", "defaultSelected": false, "prerequisites": ["node"], "contextCostTokens": { "claude": 0 }, "popularity": { "stars": 28095, "observedAt": "2026-09-17" }, "source": "https://github.com/jarrodwatts/claude-hud", "postInstallHint": "In Claude Code run /claude-hud:setup", "spec": { "kind": "claude-plugin", "marketplace": "claude-hud", "marketplaceSource": "jarrodwatts/claude-hud", "plugin": "claude-hud" } },
    { "id": "cp-mattpocock-skills", "name": "mattpocock-skills (full pack)", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "All 25 Matt Pocock skills (1.6k always-on tokens); prefer the 4-skill cherry-pick component", "verdict": "optional", "defaultSelected": false, "conflictsWith": ["sk-mattpocock-core"], "contextCostTokens": { "claude": 1614 }, "popularity": { "stars": 264109, "installs": 45070, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "mattpocock-skills" } },
    { "id": "cp-document-skills", "name": "document-skills (docx/pdf/pptx/xlsx)", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Anthropic office-document skills; needs LibreOffice, pandoc and python libs for full function", "verdict": "optional", "defaultSelected": false, "contextCostTokens": { "claude": 1100 }, "popularity": { "stars": 176707, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "anthropic-agent-skills", "marketplaceSource": "anthropics/skills", "plugin": "document-skills" } },
    { "id": "cp-compound-engineering", "name": "compound-engineering", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "35-skill methodology bundle (overlaps superpowers)", "verdict": "optional", "defaultSelected": false, "slot": "methodology", "contextCostTokens": { "claude": 3060 }, "popularity": { "stars": 25116, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "compound-engineering-plugin", "marketplaceSource": "EveryInc/compound-engineering-plugin", "plugin": "compound-engineering" } },
    { "id": "cp-planning-with-files", "name": "planning-with-files", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "File-based persistent planning with per-turn re-injection", "verdict": "optional", "defaultSelected": false, "contextCostTokens": { "claude": 1065 }, "popularity": { "stars": 26939, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "planning-with-files", "marketplaceSource": "OthmanAdi/planning-with-files", "plugin": "planning-with-files" } },
    { "id": "cp-context-mode", "name": "context-mode", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Sandboxes tool output into a knowledge base (overlaps caveman proxy)", "verdict": "optional", "defaultSelected": false, "prerequisites": ["node"], "contextCostTokens": { "claude": 915 }, "popularity": { "stars": 23226, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "context-mode", "marketplaceSource": "mksglu/context-mode", "plugin": "context-mode" } },
    { "id": "cp-elements-of-style", "name": "elements-of-style", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Strunk's Elements of Style as a writing skill", "verdict": "optional", "defaultSelected": false, "contextCostTokens": { "claude": 94 }, "popularity": { "stars": 577, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "superpowers-marketplace", "marketplaceSource": "obra/superpowers-marketplace", "plugin": "elements-of-style" } },
    { "id": "cp-obsidian", "name": "obsidian-skills", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Official Obsidian markdown/CLI/bases skills", "verdict": "optional", "defaultSelected": false, "popularity": { "stars": 48449, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "obsidian-skills", "marketplaceSource": "kepano/obsidian-skills", "plugin": "obsidian" } },
    { "id": "cp-ui-ux-pro-max", "name": "ui-ux-pro-max", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Design-system intelligence skill (overlaps frontend-design)", "verdict": "optional", "defaultSelected": false, "popularity": { "stars": 128185, "observedAt": "2026-09-17" }, "spec": { "kind": "claude-plugin", "marketplace": "ui-ux-pro-max-skill", "marketplaceSource": "nextlevelbuilder/ui-ux-pro-max-skill", "plugin": "ui-ux-pro-max" } },
    { "id": "cp-plugin-dev", "name": "plugin-dev (disable globally)", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "2,354 always-on tokens; keep installed but disabled at user scope, enable per project", "verdict": "optional", "defaultSelected": true, "contextCostTokens": { "claude": 0 }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "plugin-dev", "action": "disable" } },
    { "id": "cp-pr-review-toolkit", "name": "pr-review-toolkit (disable globally)", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "2,038 always-on tokens; disabled at user scope, enable per project", "verdict": "optional", "defaultSelected": true, "contextCostTokens": { "claude": 0 }, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "pr-review-toolkit", "action": "disable" } },
    { "id": "cp-code-review", "name": "code-review (remove: built-in /code-review)", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Redundant with built-in /code-review and /ultrareview", "verdict": "optional", "defaultSelected": true, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "code-review", "action": "uninstall" } },
    { "id": "cp-code-simplifier", "name": "code-simplifier (remove: built-in /simplify)", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Redundant with built-in /simplify", "verdict": "optional", "defaultSelected": true, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "code-simplifier", "action": "uninstall" } },
    { "id": "cp-ralph-loop", "name": "ralph-loop (remove: built-in /goal and /loop)", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Redundant with built-in /goal and /loop", "verdict": "optional", "defaultSelected": true, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "ralph-loop", "action": "uninstall" } },
    { "id": "cp-claude-code-setup", "name": "claude-code-setup (remove: built-in /init)", "kind": "claude-plugin", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Redundant with CLAUDE_CODE_NEW_INIT=1 /init", "verdict": "optional", "defaultSelected": true, "spec": { "kind": "claude-plugin", "marketplace": "claude-plugins-official", "plugin": "claude-code-setup", "action": "uninstall" } },

    { "id": "cx-superpowers-remote", "name": "superpowers (Codex remote catalog)", "kind": "codex-plugin", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "OpenAI-curated superpowers plugin; needs ChatGPT login in Codex", "verdict": "recommended", "defaultSelected": false, "popularity": { "stars": 287604, "observedAt": "2026-09-17" }, "spec": { "kind": "codex-plugin", "marketplace": "openai-curated-remote", "marketplaceSource": "reserved", "plugin": "superpowers" } },
    { "id": "cx-compound-engineering", "name": "compound-engineering (Codex)", "kind": "codex-plugin", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "Native Codex plugin from EveryInc", "verdict": "optional", "defaultSelected": false, "popularity": { "stars": 25116, "observedAt": "2026-09-17" }, "spec": { "kind": "codex-plugin", "marketplace": "compound-engineering-plugin", "marketplaceSource": "EveryInc/compound-engineering-plugin", "plugin": "compound-engineering" } },

    { "id": "sk-find-skills", "name": "find-skills", "kind": "skill", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "Search skills.sh on demand (#1 skill, 3.4M installs)", "verdict": "must-have", "defaultSelected": true, "prerequisites": ["node"], "popularity": { "stars": 31818, "installs": 3400000, "observedAt": "2026-09-17" }, "audit": [{ "owner": "vercel-labs", "repo": "skills", "skill": "find-skills" }], "spec": { "kind": "skill", "repo": "vercel-labs/skills", "skills": ["find-skills"], "targets": ["claude-code", "codex"] } },
    { "id": "sk-caveman-codex", "name": "caveman skills (Codex)", "kind": "skill", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "All caveman skills for Codex (Claude gets them from the plugin)", "verdict": "must-have", "defaultSelected": true, "prerequisites": ["node"], "popularity": { "stars": 106038, "installs": 3300000, "observedAt": "2026-09-17" }, "spec": { "kind": "skill", "repo": "JuliusBrussee/caveman", "skills": "*", "targets": ["codex"] } },
    { "id": "sk-cc-devops", "name": "cc-devops-skills", "kind": "skill", "agents": "both", "platforms": ["linux", "darwin", "windows"], "description": "Ansible/Docker/Kubernetes/Helm/Terraform/bash generator+validator pairs (validators run linters: Runlayer HIGH advisory)", "verdict": "recommended", "defaultSelected": true, "prerequisites": ["node"], "popularity": { "stars": 311, "installs": 17600, "observedAt": "2026-09-17" }, "audit": [{ "owner": "akin-ozer", "repo": "cc-devops-skills", "skill": "ansible-validator" }, { "owner": "akin-ozer", "repo": "cc-devops-skills", "skill": "dockerfile-generator" }, { "owner": "akin-ozer", "repo": "cc-devops-skills", "skill": "terraform-validator" }], "spec": { "kind": "skill", "repo": "akin-ozer/cc-devops-skills", "skills": ["ansible-generator", "ansible-validator", "dockerfile-generator", "dockerfile-validator", "k8s-generator", "k8s-validator", "terraform-generator", "terraform-validator", "bash-script-generator", "bash-script-validator"], "targets": ["claude-code", "codex"] } },
    { "id": "sk-linux-admin", "name": "linux-administration + hardening + ssh", "kind": "skill", "agents": "both", "platforms": ["linux", "darwin"], "description": "Sysadmin skills from devops-security-agent-skills", "verdict": "recommended", "defaultSelected": true, "prerequisites": ["node"], "popularity": { "stars": 1098, "observedAt": "2026-09-17" }, "audit": [{ "owner": "bagelhole", "repo": "devops-security-agent-skills", "skill": "linux-administration" }, { "owner": "bagelhole", "repo": "devops-security-agent-skills", "skill": "linux-hardening" }, { "owner": "bagelhole", "repo": "devops-security-agent-skills", "skill": "ssh-configuration" }], "spec": { "kind": "skill", "repo": "bagelhole/devops-security-agent-skills", "skills": ["linux-administration", "linux-hardening", "ssh-configuration"], "targets": ["claude-code", "codex"] } },
    { "id": "sk-powershell-windows", "name": "powershell-windows", "kind": "skill", "agents": "both", "platforms": ["windows"], "description": "PowerShell/Windows skill (cherry-picked from claude-code-templates)", "verdict": "recommended", "defaultSelected": true, "prerequisites": ["node"], "popularity": { "stars": 30761, "installs": 456, "observedAt": "2026-09-17" }, "audit": [{ "owner": "davila7", "repo": "claude-code-templates", "skill": "powershell-windows" }], "spec": { "kind": "skill", "repo": "davila7/claude-code-templates", "skills": ["powershell-windows"], "targets": ["claude-code", "codex"] } },
    { "id": "sk-mattpocock-core", "name": "mattpocock: grill-me, handoff, tdd, to-spec", "kind": "skill", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "Four cherry-picked Matt Pocock skills (~320 tokens)", "verdict": "recommended", "defaultSelected": false, "prerequisites": ["node"], "conflictsWith": ["cp-mattpocock-skills"], "contextCostTokens": { "claude": 320, "codex": 320 }, "popularity": { "stars": 264109, "installs": 22900000, "observedAt": "2026-09-17" }, "audit": [{ "owner": "mattpocock", "repo": "skills", "skill": "grill-me" }, { "owner": "mattpocock", "repo": "skills", "skill": "handoff" }, { "owner": "mattpocock", "repo": "skills", "skill": "tdd" }, { "owner": "mattpocock", "repo": "skills", "skill": "to-spec" }], "spec": { "kind": "skill", "repo": "mattpocock/skills", "skills": ["grill-me", "handoff", "tdd", "to-spec"], "targets": ["claude-code", "codex"] } },
    { "id": "sk-anthropic-codex", "name": "Anthropic skills for Codex (frontend-design, skill-creator, mcp-builder, webapp-testing)", "kind": "skill", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "Codex copies of the Anthropic skills that Claude gets from plugins", "verdict": "recommended", "defaultSelected": false, "prerequisites": ["node"], "popularity": { "stars": 176707, "observedAt": "2026-09-17" }, "audit": [{ "owner": "anthropics", "repo": "skills", "skill": "frontend-design" }, { "owner": "anthropics", "repo": "skills", "skill": "mcp-builder" }], "spec": { "kind": "skill", "repo": "anthropics/skills", "skills": ["frontend-design", "skill-creator", "mcp-builder", "webapp-testing"], "targets": ["codex"] } },
    { "id": "sk-vercel-agent-skills", "name": "vercel-labs/agent-skills", "kind": "skill", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "React/Next best practices, web design guidelines, composition patterns", "verdict": "optional", "defaultSelected": false, "prerequisites": ["node"], "popularity": { "stars": 31253, "observedAt": "2026-09-17" }, "spec": { "kind": "skill", "repo": "vercel-labs/agent-skills", "skills": "*", "targets": ["claude-code", "codex"] } },
    { "id": "sk-obsidian", "name": "kepano/obsidian-skills (skills route)", "kind": "skill", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "Obsidian skills for both agents via the skills CLI", "verdict": "optional", "defaultSelected": false, "prerequisites": ["node"], "conflictsWith": ["cp-obsidian"], "popularity": { "stars": 48449, "observedAt": "2026-09-17" }, "spec": { "kind": "skill", "repo": "kepano/obsidian-skills", "skills": "*", "targets": ["claude-code", "codex"] } },
    { "id": "sk-proxmox-admin", "name": "proxmox-admin", "kind": "skill", "agents": "both", "platforms": ["linux", "darwin"], "description": "qm/pct/storage/cluster reference skill (clean audits, tiny repo)", "verdict": "recommended", "defaultSelected": false, "prerequisites": ["node"], "popularity": { "stars": 7, "installs": 706, "observedAt": "2026-09-17" }, "audit": [{ "owner": "bastos", "repo": "skills", "skill": "proxmox-admin" }], "spec": { "kind": "skill", "repo": "bastos/skills", "skills": ["proxmox-admin"], "targets": ["claude-code", "codex"] } },
    { "id": "sk-lunar-proxmox", "name": "proxmox-infrastructure (lunar-claude)", "kind": "skill", "agents": "both", "platforms": ["linux", "darwin"], "description": "Proxmox + Ansible infrastructure skill", "verdict": "optional", "defaultSelected": false, "prerequisites": ["node"], "popularity": { "stars": 23, "observedAt": "2026-09-17" }, "audit": [{ "owner": "basher83", "repo": "lunar-claude", "skill": "proxmox-infrastructure" }], "spec": { "kind": "skill", "repo": "basher83/lunar-claude", "skills": ["proxmox-infrastructure"], "targets": ["claude-code", "codex"] } },
    { "id": "sk-agent-browser", "name": "agent-browser", "kind": "skill", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "Headless browser CLI skill; also needs `npm i -g agent-browser && agent-browser install` (Node 24)", "verdict": "optional", "defaultSelected": false, "prerequisites": ["node"], "slot": "browser", "popularity": { "stars": 42704, "installs": 868500, "observedAt": "2026-09-17" }, "audit": [{ "owner": "vercel-labs", "repo": "agent-browser", "skill": "agent-browser" }], "postInstallHint": "npm install -g agent-browser && agent-browser install", "spec": { "kind": "skill", "repo": "vercel-labs/agent-browser", "skills": ["agent-browser"], "targets": ["claude-code", "codex"] } },

    { "id": "mcp-cx-context7", "name": "context7 (Codex)", "kind": "mcp", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "Library docs MCP for Codex (stdio via npx; keyless with lower limits)", "verdict": "must-have", "defaultSelected": true, "prerequisites": ["node"], "contextCostTokens": { "codex": 400 }, "popularity": { "stars": 62095, "downloadsWeekly": 1132952, "observedAt": "2026-09-17" }, "spec": { "kind": "mcp", "target": "codex", "name": "context7", "transport": "stdio", "command": "npx", "args": ["-y", "@upstash/context7-mcp"], "extra": { "startup_timeout_sec": 20 } } },
    { "id": "mcp-cx-exa", "name": "exa (Codex)", "kind": "mcp", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "Keyless remote web search + fetch for Codex", "verdict": "recommended", "defaultSelected": true, "contextCostTokens": { "codex": 400 }, "popularity": { "stars": 5000, "downloadsWeekly": 79339, "observedAt": "2026-09-17" }, "spec": { "kind": "mcp", "target": "codex", "name": "exa", "transport": "http", "url": "https://mcp.exa.ai/mcp" } },
    { "id": "mcp-cx-github", "name": "GitHub read-only (Codex)", "kind": "mcp", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "Official GitHub remote MCP, read-only endpoint, PAT via env var", "verdict": "optional", "defaultSelected": false, "contextCostTokens": { "codex": 3000 }, "popularity": { "stars": 32998, "observedAt": "2026-09-17" }, "secrets": [{ "env": "GITHUB_PAT_TOKEN", "prompt": "GitHub PAT for Codex github MCP", "required": false }], "spec": { "kind": "mcp", "target": "codex", "name": "github", "transport": "http", "url": "https://api.githubcopilot.com/mcp/readonly", "bearerEnv": "GITHUB_PAT_TOKEN", "secretEnv": ["GITHUB_PAT_TOKEN"] } },
    { "id": "mcp-cx-chrome-devtools", "name": "chrome-devtools-mcp (Codex)", "kind": "mcp", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "Chrome DevTools MCP for Codex (58 tools, no tool search on Codex)", "verdict": "optional", "defaultSelected": false, "prerequisites": ["node"], "slot": "browser", "contextCostTokens": { "codex": 6000 }, "popularity": { "stars": 52186, "observedAt": "2026-09-17" }, "spec": { "kind": "mcp", "target": "codex", "name": "chrome-devtools", "transport": "stdio", "command": "npx", "args": ["-y", "chrome-devtools-mcp@latest"] } },
    { "id": "mcp-cx-microsoft-learn", "name": "Microsoft Learn (Codex)", "kind": "mcp", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "Official Microsoft Learn remote MCP", "verdict": "optional", "defaultSelected": false, "contextCostTokens": { "codex": 600 }, "popularity": { "stars": 1892, "observedAt": "2026-09-17" }, "spec": { "kind": "mcp", "target": "codex", "name": "microsoft-learn", "transport": "http", "url": "https://learn.microsoft.com/api/mcp" } },
    { "id": "mcp-ha-claude", "name": "Home Assistant (Claude)", "kind": "mcp", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Native HA MCP over OAuth; set HA_URL (https://ha.example:8123) then run `claude mcp login homeassistant`", "verdict": "recommended", "defaultSelected": false, "popularity": { "stars": 91000, "observedAt": "2026-09-17" }, "secrets": [{ "env": "HA_URL", "prompt": "Home Assistant base URL (https://host:8123)", "required": true }], "postInstallHint": "claude mcp login homeassistant", "spec": { "kind": "mcp", "target": "claude", "name": "homeassistant", "transport": "http", "url": "${HA_URL}/api/mcp", "oauth": { "clientId": "http://localhost:12345", "callbackPort": 12345 } } },
    { "id": "mcp-ha-codex", "name": "Home Assistant (Codex)", "kind": "mcp", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "Native HA MCP over OAuth for Codex; run `codex mcp login homeassistant`", "verdict": "recommended", "defaultSelected": false, "dependsOn": ["set-codex-oauth-port"], "contextCostTokens": { "codex": 500 }, "popularity": { "stars": 91000, "observedAt": "2026-09-17" }, "secrets": [{ "env": "HA_URL", "prompt": "Home Assistant base URL (https://host:8123)", "required": true }], "postInstallHint": "codex mcp login homeassistant", "spec": { "kind": "mcp", "target": "codex", "name": "homeassistant", "transport": "http", "url": "${HA_URL}/api/mcp", "extra": { "auth": "oauth", "oauth": { "client_id": "http://127.0.0.1:12345" } } } },
    { "id": "mcp-k8s-claude", "name": "Kubernetes read-only (Claude)", "kind": "mcp", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "containers/kubernetes-mcp-server --read-only (no kubectl needed)", "verdict": "recommended", "defaultSelected": false, "prerequisites": ["node"], "popularity": { "stars": 2100, "observedAt": "2026-09-17" }, "spec": { "kind": "mcp", "target": "claude", "name": "k8s", "transport": "stdio", "command": "npx", "args": ["-y", "kubernetes-mcp-server@latest", "--read-only"] } },
    { "id": "mcp-k8s-codex", "name": "Kubernetes read-only (Codex)", "kind": "mcp", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "containers/kubernetes-mcp-server --read-only", "verdict": "recommended", "defaultSelected": false, "prerequisites": ["node"], "contextCostTokens": { "codex": 2000 }, "popularity": { "stars": 2100, "observedAt": "2026-09-17" }, "spec": { "kind": "mcp", "target": "codex", "name": "k8s", "transport": "stdio", "command": "npx", "args": ["-y", "kubernetes-mcp-server@latest", "--read-only"] } },
    { "id": "mcp-proxmox-claude", "name": "ProxmoxMCP-Plus (Claude)", "kind": "mcp", "agents": "claude", "platforms": ["linux", "darwin"], "description": "Proxmox VE MCP via uvx; use a limited API token", "verdict": "optional", "defaultSelected": false, "prerequisites": ["uv"], "popularity": { "stars": 538, "observedAt": "2026-09-17" }, "secrets": [{ "env": "PROXMOX_HOST", "prompt": "Proxmox host (pve.example.lan)", "required": true }, { "env": "PROXMOX_TOKEN_NAME", "prompt": "Proxmox API token name", "required": true }, { "env": "PROXMOX_TOKEN_VALUE", "prompt": "Proxmox API token secret", "required": true }], "spec": { "kind": "mcp", "target": "claude", "name": "proxmox", "transport": "stdio", "command": "uvx", "args": ["proxmox-mcp-plus"], "env": { "PROXMOX_USER": "root@pam" }, "secretEnv": ["PROXMOX_HOST", "PROXMOX_TOKEN_NAME", "PROXMOX_TOKEN_VALUE"] } },
    { "id": "mcp-proxmox-codex", "name": "ProxmoxMCP-Plus (Codex)", "kind": "mcp", "agents": "codex", "platforms": ["linux", "darwin"], "description": "Proxmox VE MCP via uvx for Codex (secrets must be exported in the shell)", "verdict": "optional", "defaultSelected": false, "prerequisites": ["uv"], "contextCostTokens": { "codex": 4000 }, "popularity": { "stars": 538, "observedAt": "2026-09-17" }, "secrets": [{ "env": "PROXMOX_HOST", "prompt": "Proxmox host", "required": true }, { "env": "PROXMOX_TOKEN_NAME", "prompt": "Proxmox API token name", "required": true }, { "env": "PROXMOX_TOKEN_VALUE", "prompt": "Proxmox API token secret", "required": true }], "spec": { "kind": "mcp", "target": "codex", "name": "proxmox", "transport": "stdio", "command": "uvx", "args": ["proxmox-mcp-plus"], "env": { "PROXMOX_USER": "root@pam" }, "secretEnv": ["PROXMOX_HOST", "PROXMOX_TOKEN_NAME", "PROXMOX_TOKEN_VALUE"] } },
    { "id": "mcp-tailscale-claude", "name": "Tailscale (Claude)", "kind": "mcp", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Community Tailscale MCP (read-only by default)", "verdict": "optional", "defaultSelected": false, "prerequisites": ["node"], "popularity": { "stars": 132, "observedAt": "2026-09-17" }, "secrets": [{ "env": "TAILSCALE_API_KEY", "prompt": "Tailscale API key", "required": true }], "spec": { "kind": "mcp", "target": "claude", "name": "tailscale", "transport": "stdio", "command": "npx", "args": ["-y", "@hexsleeves/tailscale-mcp-server"], "env": { "TAILSCALE_TAILNET": "-" }, "secretEnv": ["TAILSCALE_API_KEY"] } },
    { "id": "mcp-tailscale-codex", "name": "Tailscale (Codex)", "kind": "mcp", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "Community Tailscale MCP for Codex", "verdict": "optional", "defaultSelected": false, "prerequisites": ["node"], "contextCostTokens": { "codex": 1500 }, "popularity": { "stars": 132, "observedAt": "2026-09-17" }, "secrets": [{ "env": "TAILSCALE_API_KEY", "prompt": "Tailscale API key", "required": true }], "spec": { "kind": "mcp", "target": "codex", "name": "tailscale", "transport": "stdio", "command": "npx", "args": ["-y", "@hexsleeves/tailscale-mcp-server"], "env": { "TAILSCALE_TAILNET": "-" }, "secretEnv": ["TAILSCALE_API_KEY"] } },
    { "id": "mcp-n8n-claude", "name": "n8n-mcp (Claude)", "kind": "mcp", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "n8n node docs and workflow management", "verdict": "optional", "defaultSelected": false, "prerequisites": ["node"], "popularity": { "stars": 23000, "observedAt": "2026-09-17" }, "spec": { "kind": "mcp", "target": "claude", "name": "n8n-mcp", "transport": "stdio", "command": "npx", "args": ["n8n-mcp"], "env": { "MCP_MODE": "stdio", "LOG_LEVEL": "error", "DISABLE_CONSOLE_OUTPUT": "true" } } },

    { "id": "set-codex-memories", "name": "Codex memories on", "kind": "setting", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "Enable the Codex memories feature ([features] memories = true)", "verdict": "recommended", "defaultSelected": true, "spec": { "kind": "setting", "target": "codex", "codexFeatures": { "memories": true } } },
    { "id": "set-codex-trust-home", "name": "Codex trusts $HOME", "kind": "setting", "agents": "codex", "platforms": ["linux", "darwin"], "description": "[projects.\"$HOME\"] trust_level = \"trusted\" (headless hosts)", "verdict": "optional", "defaultSelected": false, "spec": { "kind": "setting", "target": "codex", "codexToml": { "projects": { "${HOME}": { "trust_level": "trusted" } } } } },
    { "id": "set-codex-oauth-port", "name": "Codex MCP OAuth callback port", "kind": "setting", "agents": "codex", "platforms": ["linux", "windows", "darwin"], "description": "mcp_oauth_callback_port = 12345 (Home Assistant OAuth)", "verdict": "optional", "defaultSelected": false, "spec": { "kind": "setting", "target": "codex", "codexToml": { "mcp_oauth_callback_port": 12345 } } },
    { "id": "set-claude-headless-seed", "name": "Claude headless onboarding seed", "kind": "setting", "agents": "claude", "platforms": ["linux", "darwin"], "description": "Creates ~/.claude.json with hasCompletedOnboarding=true so `claude -p` works after CLAUDE_CODE_OAUTH_TOKEN is exported (only when the file is absent)", "verdict": "optional", "defaultSelected": false, "spec": { "kind": "setting", "target": "claude", "claudeJsonSeed": { "hasCompletedOnboarding": true } } },
    { "id": "set-windows-git-symlinks", "name": "git core.symlinks=true", "kind": "setting", "agents": "claude", "platforms": ["windows"], "description": "Lets the skills CLI create symlinks on Windows (also enable Developer Mode)", "verdict": "recommended", "defaultSelected": true, "spec": { "kind": "setting", "target": "claude", "windowsGitConfig": { "core.symlinks": "true" } } },

    { "id": "hook-caveman-claude", "name": "caveman native hooks (Claude)", "kind": "hook", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "caveman setup --agent-native claude (10-event hook block, regenerated per host)", "verdict": "must-have", "defaultSelected": true, "prerequisites": ["caveman-cli"], "slot": "bash-rewriter", "spec": { "kind": "hook", "provider": "caveman", "agent": "claude" } },
    { "id": "hook-caveman-codex", "name": "caveman agent-native (Codex proxy)", "kind": "hook", "agents": "codex", "platforms": ["linux", "darwin"], "description": "Routes Codex through the caveman gateway (rewrites model_provider) and adds hooks.json; opt-in only", "verdict": "optional", "defaultSelected": false, "forceOffInAll": true, "prerequisites": ["caveman-cli"], "slot": "api-proxy", "spec": { "kind": "hook", "provider": "caveman", "agent": "codex" } },

    { "id": "sl-caveman", "name": "caveman status line", "kind": "statusline", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "caveman statusline script copied to ~/.claude/hooks (replaces the fragile plugin-cache glob)", "verdict": "recommended", "defaultSelected": true, "slot": "statusline", "spec": { "kind": "statusline", "provider": "caveman" } },
    { "id": "sl-claude-hud", "name": "claude-hud status line", "kind": "statusline", "agents": "claude", "platforms": ["linux", "windows", "darwin"], "description": "Hand the status line to claude-hud (requires the claude-hud plugin)", "verdict": "optional", "defaultSelected": false, "dependsOn": ["cp-claude-hud"], "slot": "statusline", "spec": { "kind": "statusline", "provider": "claude-hud" } },

    { "id": "instr-global", "name": "Shared global instructions block", "kind": "instructions", "agents": "both", "platforms": ["linux", "windows", "darwin"], "description": "instructions.md rendered into a managed block in ~/.claude/CLAUDE.md and ~/.codex/AGENTS.md", "verdict": "recommended", "defaultSelected": true, "spec": { "kind": "instructions", "source": "instructions.md" } }
  ]
}
```

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `bunx vitest run && bunx tsc --noEmit`
Expected: all PASS. If the `all` profile token total exceeds 8000 on linux, lower `defaultSelected` of `cp-chrome-devtools-mcp` to `false` and note it in the commit (the approved additions still appear in the picker).

- [ ] **Step 7: Commit**

```bash
git add manifest.json src test
git commit -m "feat(manifest): full component catalog, profiles and provider amendments (multi-package, placeholders, headless seed)"
```

---

### Task 30: Linux/macOS bootstrap `install.sh`

**Files:**
- Create: `install.sh`, `test/bootstrap/install.bats`
- Tooling: `shellcheck`, `bats-core` (install: `sudo apt-get install -y shellcheck bats` or `npm i -g bats`).

**Interfaces:**
- Env/flags: `SAI_VERSION` (default: `SAI_DEFAULT_VERSION` literal in the script, updated by the release script), `SAI_REPO` (default `alexfirilov/super-agent-installer`), `SAI_BASE_URL` override (tests point it at a local dir served via `file://`... bats uses a fake `curl`), `SAI_INSTALL_DIR` (default `$HOME/.local/bin`), `SAI_ALLOW_SUDO`, `--no-run` (download only). All other args are passed to the binary.
- Behaviour: refuse `sudo` from a user; detect `uname -s`/`-m` -> target (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`); on Linux detect musl (`ldd --version 2>&1 | grep -qi musl`) -> `linux-x64-musl`/`linux-arm64-musl`; ensure `curl` or `wget` and `tar` (offer apt/dnf/apk install when root); download `super-agent-installer-<target>` and `SHA256SUMS` to a `mktemp -d`; verify with `sha256sum -c --ignore-missing` or `shasum -a 256`; `install -m 0755` to `$SAI_INSTALL_DIR/super-agent-installer`; add PATH marker block to `~/.profile`/`~/.bashrc`/`~/.zshrc` if the dir is not on PATH; `exec` the binary with args unless `--no-run`. Fallback when download fails and `node >= 22` exists: `exec npx --yes super-agent-installer@$SAI_VERSION "$@"`.

- [ ] **Step 1: Write the bats tests**

`test/bootstrap/install.bats`:
```bash
#!/usr/bin/env bats
setup() {
  export TMP="$(mktemp -d)"; export HOME="$TMP/home"; mkdir -p "$HOME"
  export SAI_INSTALL_DIR="$TMP/bin"; export SAI_VERSION="0.1.0"; export SAI_BASE_URL="file://$TMP/release"
  mkdir -p "$TMP/release" "$TMP/fakebin"
  printf '#!/bin/sh\necho "fake binary args: $*"\n' > "$TMP/release/super-agent-installer-linux-x64"; chmod +x "$TMP/release/super-agent-installer-linux-x64"
  (cd "$TMP/release" && sha256sum super-agent-installer-linux-x64 > SHA256SUMS)
  # fake curl that copies from file:// URLs
  cat > "$TMP/fakebin/curl" <<'EOF'
#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift;; -*) ;; *) url="$1";; esac; shift; done
src="${url#file://}"; [ -f "$src" ] || exit 22; cp "$src" "$out"
EOF
  chmod +x "$TMP/fakebin/curl"; export PATH="$TMP/fakebin:$PATH"
  export UNAME_S=Linux UNAME_M=x86_64
}
@test "downloads, verifies, installs and execs the binary" {
  run bash "$BATS_TEST_DIRNAME/../../install.sh" --profile minimal --yes
  [ "$status" -eq 0 ]; [[ "$output" == *"fake binary args: --profile minimal --yes"* ]]
  [ -x "$SAI_INSTALL_DIR/super-agent-installer" ]
}
@test "refuses sudo from a user" {
  SUDO_USER=alex run bash "$BATS_TEST_DIRNAME/../../install.sh" --no-run
  [ "$status" -eq 1 ]; [[ "$output" == *"sudo"* ]]
}
@test "fails on checksum mismatch" {
  echo "0000000000000000000000000000000000000000000000000000000000000000  super-agent-installer-linux-x64" > "$TMP/release/SHA256SUMS"
  run bash "$BATS_TEST_DIRNAME/../../install.sh" --no-run
  [ "$status" -ne 0 ]; [[ "$output" == *"checksum"* ]]; [ ! -e "$SAI_INSTALL_DIR/super-agent-installer" ]
}
@test "adds PATH block to profile files once" {
  touch "$HOME/.bashrc"
  bash "$BATS_TEST_DIRNAME/../../install.sh" --no-run >/dev/null; bash "$BATS_TEST_DIRNAME/../../install.sh" --no-run >/dev/null
  [ "$(grep -c 'super-agent-installer' "$HOME/.bashrc")" -eq 2 ]
}
```

- [ ] **Step 2: Run to verify fail**

Run: `bats test/bootstrap/install.bats`
Expected: FAIL (script missing).

- [ ] **Step 3: Write install.sh**

```bash
#!/bin/sh
# super-agent-installer bootstrap for Linux, macOS and WSL.
# Usage: curl -fsSL https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.1.0/install.sh | bash -s -- [--profile all] [--yes]
set -eu
SAI_DEFAULT_VERSION="0.1.0"
SAI_VERSION="${SAI_VERSION:-$SAI_DEFAULT_VERSION}"
SAI_REPO="${SAI_REPO:-alexfirilov/super-agent-installer}"
SAI_BASE_URL="${SAI_BASE_URL:-https://github.com/${SAI_REPO}/releases/download/v${SAI_VERSION}}"
SAI_INSTALL_DIR="${SAI_INSTALL_DIR:-$HOME/.local/bin}"
NO_RUN=0
for a in "$@"; do [ "$a" = "--no-run" ] && NO_RUN=1; done
say() { printf '%s\n' "super-agent-installer: $*" >&2; }
die() { say "$*"; exit 1; }
if [ -n "${SUDO_USER:-}" ] && [ "${SAI_ALLOW_SUDO:-0}" != "1" ]; then die "do not run with sudo (it would install into root's home). Run as your user, or as plain root on servers. Set SAI_ALLOW_SUDO=1 to override."; fi
os="$(${UNAME_S:+echo "$UNAME_S"} || true)"; [ -n "$os" ] || os="$(uname -s)"
arch="$(${UNAME_M:+echo "$UNAME_M"} || true)"; [ -n "$arch" ] || arch="$(uname -m)"
case "$os" in Linux) plat=linux;; Darwin) plat=darwin;; *) die "unsupported OS: $os (use install.ps1 on Windows)";; esac
case "$arch" in x86_64|amd64) a=x64;; aarch64|arm64) a=arm64;; *) die "unsupported architecture: $arch";; esac
target="${plat}-${a}"
if [ "$plat" = linux ] && [ -z "${UNAME_S:-}" ] && ldd --version 2>&1 | grep -qi musl; then target="${target}-musl"; fi
need() { command -v "$1" >/dev/null 2>&1; }
if ! need curl && ! need wget; then
  if [ "$(id -u)" = 0 ]; then
    if need apt-get; then apt-get update && apt-get install -y curl ca-certificates; elif need apk; then apk add --no-cache curl ca-certificates; elif need dnf; then dnf install -y curl ca-certificates; fi
  fi
  need curl || need wget || die "curl or wget is required"
fi
need tar || die "tar is required"
fetch() { if need curl; then curl --proto '=https' --tlsv1.2 -fsSL --retry 3 -o "$2" "$1"; else wget -q -O "$2" "$1"; fi; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
asset="super-agent-installer-${target}"
say "downloading ${asset} v${SAI_VERSION}"
if ! fetch "${SAI_BASE_URL}/${asset}" "$tmp/$asset" || ! fetch "${SAI_BASE_URL}/SHA256SUMS" "$tmp/SHA256SUMS"; then
  if need node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then say "binary download failed; falling back to npx"; exec npx --yes "super-agent-installer@${SAI_VERSION}" "$@"; fi
  die "download failed for ${SAI_BASE_URL}/${asset}"
fi
expected="$(grep " ${asset}\$" "$tmp/SHA256SUMS" | awk '{print $1}')"; [ -n "$expected" ] || die "no checksum for ${asset} in SHA256SUMS"
if need sha256sum; then actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"; else actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"; fi
[ "$actual" = "$expected" ] || die "checksum mismatch for ${asset}: expected ${expected}, got ${actual}"
mkdir -p "$SAI_INSTALL_DIR"; install -m 0755 "$tmp/$asset" "$SAI_INSTALL_DIR/super-agent-installer"
case ":$PATH:" in *":$SAI_INSTALL_DIR:"*) ;; *)
  for rc in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
    [ -f "$rc" ] || continue
    grep -q '# >>> super-agent-installer >>>' "$rc" && continue
    printf '\n# >>> super-agent-installer >>>\nexport PATH="%s:$PATH"\n# <<< super-agent-installer <<<\n' "$SAI_INSTALL_DIR" >> "$rc"
  done
  say "added ${SAI_INSTALL_DIR} to PATH in your shell rc (open a new shell to pick it up)";;
esac
say "installed to ${SAI_INSTALL_DIR}/super-agent-installer"
[ "$NO_RUN" = 1 ] && exit 0
exec "$SAI_INSTALL_DIR/super-agent-installer" "$@"
```
Note the `UNAME_S`/`UNAME_M` test overrides and `SAI_BASE_URL` `file://` support through the fake `curl` in tests; in real use the `curl` flags are the hardened form.

- [ ] **Step 4: Run tests and shellcheck**

Run: `shellcheck install.sh && bats test/bootstrap/install.bats`
Expected: shellcheck clean (add `# shellcheck disable=SC2086` only where a variable must split intentionally); 4 bats tests PASS.

- [ ] **Step 5: Commit**

```bash
git add install.sh test/bootstrap/install.bats
git commit -m "feat(bootstrap): POSIX install.sh with checksum verification, PATH setup and npx fallback"
```

---

### Task 31: Windows bootstrap `install.ps1`

**Files:**
- Create: `install.ps1`, `test/bootstrap/install.Tests.ps1`
- Tooling: `pwsh` on this host for tests (`winget`-less; install via `sudo apt-get install -y powershell` from Microsoft's repo or `sudo snap install powershell --classic`), `Install-Module Pester -Force -SkipPublisherCheck`, `Install-Module PSScriptAnalyzer -Force`.

**Interfaces:**
- Same env variables as the sh bootstrap (`SAI_VERSION`, `SAI_REPO`, `SAI_BASE_URL`, `SAI_INSTALL_DIR` default `%LOCALAPPDATA%\super-agent-installer\bin`), `-NoRun` switch; remaining args forwarded. PowerShell 5.1 compatible: `Set-StrictMode -Version 2.0`, TLS 1.2, `Invoke-WebRequest -UseBasicParsing -OutFile`, `Get-FileHash -Algorithm SHA256`, User PATH via `[Environment]::SetEnvironmentVariable('Path', ..., 'User')` plus `$env:Path` update for the current session, arch from `$env:PROCESSOR_ARCHITECTURE` (`AMD64` -> x64, `ARM64` -> arm64). No `??`, no ternary, no `-AsHashtable`. Fallback to `npx --yes super-agent-installer@<ver>` when Node >= 22 exists and download fails.

- [ ] **Step 1: Write Pester tests**

`test/bootstrap/install.Tests.ps1`:
```powershell
Describe 'install.ps1' {
  BeforeEach {
    $script:tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString()); New-Item -ItemType Directory -Path $script:tmp | Out-Null
    $env:SAI_INSTALL_DIR = Join-Path $script:tmp 'bin'; $env:SAI_VERSION = '0.1.0'; $env:SAI_BASE_URL = Join-Path $script:tmp 'release'
    New-Item -ItemType Directory -Path $env:SAI_BASE_URL | Out-Null
    $asset = Join-Path $env:SAI_BASE_URL 'super-agent-installer-windows-x64.exe'
    [IO.File]::WriteAllText($asset, 'fake', [Text.UTF8Encoding]::new($false))
    $hash = (Get-FileHash -Algorithm SHA256 $asset).Hash.ToLower()
    [IO.File]::WriteAllText((Join-Path $env:SAI_BASE_URL 'SHA256SUMS'), "$hash  super-agent-installer-windows-x64.exe`n", [Text.UTF8Encoding]::new($false))
    $env:SAI_TEST_ARCH = 'AMD64'; $env:SAI_TEST_NO_PATH = '1'
  }
  It 'downloads from a local base, verifies and installs with -NoRun' {
    & pwsh -NoProfile -File "$PSScriptRoot/../../install.ps1" -NoRun
    $LASTEXITCODE | Should -Be 0
    Test-Path (Join-Path $env:SAI_INSTALL_DIR 'super-agent-installer.exe') | Should -BeTrue
  }
  It 'fails on checksum mismatch and installs nothing' {
    [IO.File]::WriteAllText((Join-Path $env:SAI_BASE_URL 'SHA256SUMS'), "0000  super-agent-installer-windows-x64.exe`n", [Text.UTF8Encoding]::new($false))
    $out = & pwsh -NoProfile -File "$PSScriptRoot/../../install.ps1" -NoRun 2>&1
    $LASTEXITCODE | Should -Not -Be 0
    ($out -join "`n") | Should -Match 'checksum'
    Test-Path (Join-Path $env:SAI_INSTALL_DIR 'super-agent-installer.exe') | Should -BeFalse
  }
  It 'passes PSScriptAnalyzer with 5.1 compatibility rules' {
    $r = Invoke-ScriptAnalyzer -Path "$PSScriptRoot/../../install.ps1" -Severity Warning,Error -IncludeRule PSUseCompatibleSyntax,PSUseCompatibleCommands -Settings @{ Rules = @{ PSUseCompatibleSyntax = @{ Enable = $true; TargetVersions = @('5.1', '7.0') }; PSUseCompatibleCommands = @{ Enable = $true; TargetProfiles = @('win-8_x64_10.0.17763.0_5.1.17763.316_x64_4.0.30319.42000_framework') } } }
    $r | Should -BeNullOrEmpty
  }
}
```

- [ ] **Step 2: Run to verify fail**

Run: `pwsh -NoProfile -Command "Invoke-Pester -Path test/bootstrap/install.Tests.ps1 -Output Detailed"`
Expected: FAIL (script missing).

- [ ] **Step 3: Write install.ps1**

```powershell
<#
 super-agent-installer bootstrap for Windows (Windows PowerShell 5.1 and PowerShell 7).
 Usage: irm https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.1.0/install.ps1 | iex
        & ([scriptblock]::Create((irm https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.1.0/install.ps1))) -NoRun
#>
[CmdletBinding()]
param([switch]$NoRun, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$defaultVersion = '0.1.0'
$version = if ($env:SAI_VERSION) { $env:SAI_VERSION } else { $defaultVersion }
$repo = if ($env:SAI_REPO) { $env:SAI_REPO } else { 'alexfirilov/super-agent-installer' }
$base = if ($env:SAI_BASE_URL) { $env:SAI_BASE_URL } else { "https://github.com/$repo/releases/download/v$version" }
$installDir = if ($env:SAI_INSTALL_DIR) { $env:SAI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'super-agent-installer\bin' }
function Say([string]$m) { Write-Host "super-agent-installer: $m" }
function Fail([string]$m) { Write-Error "super-agent-installer: $m"; exit 1 }
$archRaw = if ($env:SAI_TEST_ARCH) { $env:SAI_TEST_ARCH } else { $env:PROCESSOR_ARCHITECTURE }
$arch = switch ($archRaw) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { Fail "unsupported architecture: $archRaw" } }
$asset = "super-agent-installer-windows-$arch.exe"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("sai-" + [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp | Out-Null
function Get-Asset([string]$name, [string]$dest) {
  if ($base -match '^https?://') { Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $dest }
  else { Copy-Item -Path (Join-Path $base $name) -Destination $dest }
}
try {
  Say "downloading $asset v$version"
  try { Get-Asset $asset (Join-Path $tmp $asset); Get-Asset 'SHA256SUMS' (Join-Path $tmp 'SHA256SUMS') }
  catch {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) { $major = [int]((& node -p 'process.versions.node.split(".")[0]')); if ($major -ge 22) { Say 'binary download failed; falling back to npx'; & npx --yes "super-agent-installer@$version" @Args; exit $LASTEXITCODE } }
    Fail "download failed: $($_.Exception.Message)"
  }
  $line = Get-Content (Join-Path $tmp 'SHA256SUMS') | Where-Object { $_ -match "\s$([regex]::Escape($asset))$" } | Select-Object -First 1
  if (-not $line) { Fail "no checksum for $asset in SHA256SUMS" }
  $expected = ($line -split '\s+')[0].ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp $asset)).Hash.ToLower()
  if ($actual -ne $expected) { Fail "checksum mismatch for ${asset}: expected $expected, got $actual" }
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  $exe = Join-Path $installDir 'super-agent-installer.exe'
  Move-Item -Path (Join-Path $tmp $asset) -Destination $exe -Force
  if (-not $env:SAI_TEST_NO_PATH) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) { $userPath = '' }
    if (($userPath -split ';') -notcontains $installDir) { [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $installDir).TrimStart(';'), 'User'); Say "added $installDir to your user PATH" }
    if (($env:Path -split ';') -notcontains $installDir) { $env:Path = "$installDir;$env:Path" }
  }
  Say "installed to $exe"
  if ($NoRun) { exit 0 }
  & $exe @Args
  exit $LASTEXITCODE
}
finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
```
Note: `$version = if (...) {...} else {...}` assignment-from-if is valid in 5.1. Keep the file ASCII-only so 5.1 reads it without a BOM.

- [ ] **Step 4: Run tests**

Run: `pwsh -NoProfile -Command "Invoke-Pester -Path test/bootstrap/install.Tests.ps1 -Output Detailed"`
Expected: 3 tests PASS (the analyzer test needs `PSScriptAnalyzer` installed; if compatibility profiles are unavailable offline, keep `PSUseCompatibleSyntax` only and note it).

- [ ] **Step 5: Commit**

```bash
git add install.ps1 test/bootstrap/install.Tests.ps1
git commit -m "feat(bootstrap): PowerShell 5.1-safe install.ps1 with checksum verification and PATH setup"
```

---

### Task 32: Build, release and CI

**Files:**
- Create: `scripts/build.sh`, `scripts/release.sh`, `scripts/docker-matrix.sh`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `test/docker/Dockerfile.debian`, `test/docker/Dockerfile.alpine`
- Test: `test/scripts/build.test.ts` (asserts the target list and SHA256SUMS format via a dry run of the script with `SAI_BUILD_DRY=1`)

**Interfaces:**
- `scripts/build.sh`: builds `dist/cli.js` (node target) and compiles binaries for targets `bun-linux-x64 bun-linux-arm64 bun-linux-x64-musl bun-linux-arm64-musl bun-darwin-x64 bun-darwin-arm64 bun-windows-x64` into `release/super-agent-installer-<target-name>[.exe]` (names: `linux-x64`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl`, `darwin-x64`, `darwin-arm64`, `windows-x64`), then writes `release/SHA256SUMS` (`sha256sum` format, two spaces). `SAI_BUILD_DRY=1` prints the commands only.
- `scripts/release.sh <version>`: bumps `package.json` version, `SAI_DEFAULT_VERSION` in `install.sh`, `$defaultVersion` in `install.ps1`, commits `chore(release): vX`, tags `vX`.
- `release.yml`: on tag `v*`: checkout, `oven-sh/setup-bun@v2`, `bun install`, `bun test`-equivalent (`bunx vitest run`), `bash scripts/build.sh`, `gh release create` with `release/*` and `install.sh`/`install.ps1` attached, and `actions/attest-build-provenance@v3` on `release/*`.
- `ci.yml`: on push/PR: job `unit` (ubuntu-latest: bun install, typecheck, vitest, shellcheck, bats), job `windows` (windows-latest and windows-2022: `pwsh` Pester + `powershell` 5.1 run of `install.ps1 -NoRun` against a local fake release built from a stub exe), job `docker` (ubuntu-latest: `bash scripts/docker-matrix.sh` running `install --yes --profile minimal --dry-run` inside debian:13 and alpine:3.21 with the freshly built linux binaries), job `macos` (macos-latest: bun install + vitest).
- `scripts/docker-matrix.sh`: for each Dockerfile, `docker build` with the matching binary copied in, then `docker run --rm <img> super-agent-installer doctor` and `... install --yes --profile minimal --dry-run`; exit non-zero on any failure.

- [ ] **Step 1: Write the build test**

`test/scripts/build.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
describe('scripts/build.sh', () => {
  it('lists all targets in dry mode', () => {
    const out = execFileSync('bash', ['scripts/build.sh'], { env: { ...process.env, SAI_BUILD_DRY: '1' }, encoding: 'utf8' });
    for (const t of ['bun-linux-x64', 'bun-linux-arm64', 'bun-linux-x64-musl', 'bun-linux-arm64-musl', 'bun-darwin-x64', 'bun-darwin-arm64', 'bun-windows-x64']) expect(out).toContain(`--target=${t}`);
    expect(out).toContain('release/super-agent-installer-windows-x64.exe'); expect(out).toContain('SHA256SUMS');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bunx vitest run test/scripts/build.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the scripts and workflows**

`scripts/build.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
run() { if [ "${SAI_BUILD_DRY:-0}" = 1 ]; then echo "$*"; else "$@"; fi; }
run mkdir -p dist release
run bun build ./src/cli.ts --target=node --outfile=dist/cli.js
targets="bun-linux-x64:linux-x64 bun-linux-arm64:linux-arm64 bun-linux-x64-musl:linux-x64-musl bun-linux-arm64-musl:linux-arm64-musl bun-darwin-x64:darwin-x64 bun-darwin-arm64:darwin-arm64 bun-windows-x64:windows-x64"
for pair in $targets; do
  t="${pair%%:*}"; name="${pair##*:}"; out="release/super-agent-installer-${name}"; [ "$name" = windows-x64 ] && out="${out}.exe"
  run bun build ./src/cli.ts --compile --minify --target="$t" --outfile="$out"
done
if [ "${SAI_BUILD_DRY:-0}" = 1 ]; then echo "(cd release && sha256sum super-agent-installer-* > SHA256SUMS)"; else (cd release && sha256sum super-agent-installer-* > SHA256SUMS && cat SHA256SUMS); fi
```

`scripts/release.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
v="${1:?usage: scripts/release.sh X.Y.Z}"
cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean" >&2; exit 1; }
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version='$v';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
sed -i.bak -E "s/^SAI_DEFAULT_VERSION=\"[^\"]+\"/SAI_DEFAULT_VERSION=\"$v\"/" install.sh && rm install.sh.bak
sed -i.bak -E "s/^\\\$defaultVersion = '[^']+'/\$defaultVersion = '$v'/" install.ps1 && rm install.ps1.bak
sed -i.bak -E "s#/v[0-9]+\.[0-9]+\.[0-9]+/install\.#/v$v/install.#g" install.sh install.ps1 README.md 2>/dev/null; rm -f install.sh.bak install.ps1.bak README.md.bak
bunx vitest run
git add -A && git commit -m "chore(release): v$v" && git tag "v$v"
echo "tagged v$v; push with: git push && git push --tags"
```

`.github/workflows/ci.yml`:
```yaml
name: ci
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bunx tsc --noEmit
      - run: bunx vitest run
      - run: sudo apt-get update && sudo apt-get install -y shellcheck bats
      - run: shellcheck install.sh scripts/*.sh && bats test/bootstrap/install.bats
  windows:
    strategy: { matrix: { os: [windows-latest, windows-2022] } }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - shell: pwsh
        run: Install-Module Pester -Force -SkipPublisherCheck; Install-Module PSScriptAnalyzer -Force; Invoke-Pester -Path test/bootstrap/install.Tests.ps1 -CI
      - shell: powershell
        run: |
          $env:SAI_BASE_URL = "$env:TEMP\rel"; New-Item -ItemType Directory $env:SAI_BASE_URL -Force | Out-Null
          [IO.File]::WriteAllText("$env:SAI_BASE_URL\super-agent-installer-windows-x64.exe", 'fake')
          $h = (Get-FileHash -Algorithm SHA256 "$env:SAI_BASE_URL\super-agent-installer-windows-x64.exe").Hash.ToLower()
          [IO.File]::WriteAllText("$env:SAI_BASE_URL\SHA256SUMS", "$h  super-agent-installer-windows-x64.exe`n")
          $env:SAI_INSTALL_DIR = "$env:TEMP\bin"; $env:SAI_TEST_NO_PATH = '1'
          powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -NoRun
          if ($LASTEXITCODE -ne 0) { exit 1 }
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile && bash scripts/build.sh
      - run: bash scripts/docker-matrix.sh
  macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile && bunx vitest run
```

`.github/workflows/release.yml`:
```yaml
name: release
on: { push: { tags: ['v*'] } }
permissions: { contents: write, id-token: write, attestations: write }
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile && bunx vitest run && bash scripts/build.sh
      - uses: actions/attest-build-provenance@v3
        with: { subject-path: 'release/*' }
      - run: gh release create "${GITHUB_REF_NAME}" release/* install.sh install.ps1 --title "${GITHUB_REF_NAME}" --generate-notes
        env: { GH_TOKEN: '${{ github.token }}' }
```

`scripts/docker-matrix.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
status=0
for df in test/docker/Dockerfile.*; do
  name="${df##*.}"; img="sai-test-$name"
  docker build -q -f "$df" -t "$img" . || { echo "build failed: $name"; status=1; continue; }
  docker run --rm "$img" super-agent-installer doctor || { echo "doctor failed: $name"; status=1; }
  docker run --rm "$img" super-agent-installer install --yes --profile minimal --dry-run || { echo "dry-run failed: $name"; status=1; }
done
exit $status
```

`test/docker/Dockerfile.debian`:
```dockerfile
FROM debian:13
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY release/super-agent-installer-linux-x64 /usr/local/bin/super-agent-installer
RUN chmod +x /usr/local/bin/super-agent-installer
WORKDIR /root
```

`test/docker/Dockerfile.alpine`:
```dockerfile
FROM alpine:3.21
RUN apk add --no-cache bash curl ca-certificates libgcc libstdc++
COPY release/super-agent-installer-linux-x64-musl /usr/local/bin/super-agent-installer
RUN chmod +x /usr/local/bin/super-agent-installer
WORKDIR /root
```

- [ ] **Step 4: Run tests and a real local build**

Run: `bunx vitest run test/scripts/build.test.ts && bash scripts/build.sh && ls -la release/ && ./release/super-agent-installer-linux-x64 --version`
Expected: test PASS; seven binaries plus `SHA256SUMS`; the linux binary prints `0.1.0`. If `bun build --compile` rejects the `with { type: 'text' }` imports for `.sh`/`.ps1`/`.md`, switch `src/assets.ts` to Bun's `import ... with { type: 'file' }` alternative or generate `src/assets.generated.ts` from `scripts/gen-assets.mjs` (JSON-stringified file contents) and import that instead; keep tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts .github test/docker test/scripts
git commit -m "build: bun compile targets, SHA256SUMS, release script, CI and docker matrix"
```

---

### Task 33: README and one-liners

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

```markdown
# super-agent-installer

One command that installs and updates Claude Code, Codex CLI, and the plugins, skills, MCP servers and settings you want on every host: Linux, Windows and macOS.

## Install

Linux / macOS / WSL:

    curl -fsSL https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.1.0/install.sh | bash

Windows (PowerShell 5.1 or 7):

    irm https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.1.0/install.ps1 | iex

Unattended:

    curl -fsSL .../install.sh | bash -s -- --yes --profile homelab
    irm .../install.ps1 | iex; super-agent-installer --yes --profile work

Proxmox host (root, no sudo):

    curl -fsSL .../install.sh | bash -s -- --yes --profile proxmox-host

## Commands

    super-agent-installer            interactive picker (default: everything)
    super-agent-installer update     update everything selected on this host, including the installer
    super-agent-installer check      drift report (exit 2 when something is outdated or missing)
    super-agent-installer list       all components with verdicts and token costs
    super-agent-installer doctor     host diagnostics plus claude doctor / codex doctor
    super-agent-installer uninstall [id...]

Flags: --profile all|minimal|claude-only|codex-only|work|homelab|proxmox-host, --only a,b, --skip c, --yes, --dry-run, --json, --no-audit, --channel latest|stable, --from-state.

## What it manages

See `docs/research/CATALOG.md` for the full ranked catalog and `manifest.json` for the exact components. Secrets are never written to disk: the installer prompts for API keys only when a command needs them and otherwise prints the `export`/`setx` lines to run.

## After install

- `claude` once to log in (headless: `claude setup-token` then export `CLAUDE_CODE_OAUTH_TOKEN`)
- `codex login` (headless: `codex login --device-auth`)
- Codex: run `/hooks` once to trust caveman hooks if you enabled them

## Development

    bun install && bunx vitest run && bunx tsc --noEmit
    bash scripts/build.sh          # binaries in release/
    scripts/release.sh 0.2.0       # bump, tag; push tags to publish
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with one-liners, commands and post-install steps"
```

---

### Task 34: Real-host verification (dry run, then the approved changes on this machine)

**Files:**
- None new; fixes go into the modules they belong to with tests.

- [ ] **Step 1: Dry run of the full profile on this host**

Run: `bun run src/cli.ts install --yes --profile all --dry-run 2>&1 | tee /tmp/sai-dry.txt; tail -60 /tmp/sai-dry.txt`
Expected: a plan table listing (at least) `claude-code:skip`/`update`, `codex-cli`, tool installs for missing `uv`, `pyright`, `typescript-language-server`, `go`, `gopls`, plugin installs for `github`, `chrome-devtools-mcp`, `hookify`, disables for `plugin-dev`/`pr-review-toolkit`, uninstalls for `code-review` (2 scopes), `code-simplifier`, `ralph-loop`, `claude-code-setup`, update of `caveman` plugin (2.6.0 -> 2.7.0), `caveman-cli` update (1.3.3 -> 1.3.4), Codex MCP `context7` and `exa`, skills `cc-devops`, `linux-admin`, `caveman` (codex), `hook-caveman-claude`, `sl-caveman`, `set-codex-memories`, `instr-global`. No command is executed (all lines `[dry-run]`). Fix any exception or wrong plan row at its source with a test before continuing.

- [ ] **Step 2: Check and doctor**

Run: `bun run src/cli.ts check; echo "exit=$?"; bun run src/cli.ts doctor | head -40`
Expected: `check` exits 2 with the outdated/missing rows matching Step 1; `doctor` prints the host summary (AVX yes, bwrap yes on this Ubuntu host) and vendor doctor output.

- [ ] **Step 3: Apply for real (this host is the user's workstation; the changes were approved in the spec)**

Run: `bun run src/cli.ts install --yes --profile all 2>&1 | tee /tmp/sai-run.txt; echo "exit=$?"`
Expected: exit 0 (or 1 with a small number of explained failures such as a plugin marketplace being unreachable). Then verify:
- `claude plugin list --json | jq -r '.[].id' | sort` shows `github@`, `chrome-devtools-mcp@`, `hookify@` present, no `code-review@`, `code-simplifier@`, `ralph-loop@`, `claude-code-setup@`; `plugin-dev` and `pr-review-toolkit` show `enabled: false`; `caveman@caveman` version `2.7.0`.
- `codex mcp list` shows `context7` and `exa`.
- `ls ~/.agents/skills | grep -E 'ansible-validator|linux-administration'`.
- `jq .statusLine ~/.claude/settings.json` points at `~/.claude/hooks/caveman-statusline.sh`.
- `grep -c 'super-agent-installer' ~/.claude/CLAUDE.md ~/.codex/AGENTS.md` is 2 each.
- `cat ~/.config/super-agent-installer/state.json | jq '.selectedIds | length'`.

- [ ] **Step 4: Second run is a no-op**

Run: `bun run src/cli.ts install --yes --from-state 2>&1 | tail -30 && bun run src/cli.ts check; echo "exit=$?"`
Expected: every action reports `ok` unchanged or `skip`; `check` exits 0.

- [ ] **Step 5: Commit any fixes and record the run**

```bash
git add -A
git commit -m "test: real-host verification fixes from first end-to-end run"
```

---

## Self-review notes

- Spec coverage: bootstrap (30, 31), core CLI (28), manifest + schema (2, 29), profiles (9, 29), picker (26), providers for every kind (12 to 22), idempotency rules (15 to 19, 2), config write strategy (7, 8, 20), update/drift/self-update (24, 25, 27), state (23), security (10 audit gate; 27 and 30/31 checksum verification; 25 secrets prompting; no secrets persisted), platform matrix (5, 12, 13, 14, 31, 32 docker), testing (every task; 32 CI), Proxmox/LXC/headless (5, 12, 13, 29 `proxmox-host`), Windows parity (14, 18, 21, 31).
- Not covered on purpose (spec section 14 open items): runtime behaviour of Claude-format plugin hooks under Codex (Codex plugins limited to native manifests plus the remote superpowers), TrueNAS binary download (left out of v1 manifest), `--slim` flag for chrome-devtools (not verified, not used).
- Type consistency check: `Runner`, `RunOptions.readOnly`, `Ctx.secrets/env`, `Provider.plan(c, ctx, installed, mode)`, `action(componentId, op, description, run, extra)`, `Selection`, `HostState`, `StepRecord` are used with the same names in Tasks 11 through 28.

