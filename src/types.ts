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
  apt?: string; dnf?: string; apk?: string; pacman?: string; zypper?: string; brew?: string; winget?: string; scoop?: string; choco?: string;
  npm?: string; go?: string; uvTool?: string; script?: Partial<Record<Platform, string>>;
}
export interface ToolSpec { kind: 'tool'; probe: string[]; versionRegex?: string; packages: ToolPackages; latest?: { npm?: string; github?: string }; postInstall?: Partial<Record<Platform, string[][]>>; strategy?: 'node' }
export interface SettingSpec { kind: 'setting'; target: 'claude' | 'codex'; claudeSettings?: Record<string, unknown>; claudeJsonSeed?: Record<string, unknown>; codexToml?: Record<string, unknown>; codexFeatures?: Record<string, boolean>; windowsGitConfig?: Record<string, string> }
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

/**
 * `stopOnOutput`: kill the child as soon as its combined output matches (for vendor CLIs that finish their work and
 * then block on an interactive step, e.g. `codex mcp add --url` starting a browser OAuth flow); the result then has
 * `stopped: true` and exit 0.
 * `interactive`: spawn with `stdio: 'inherit'` so the command owns the real terminal (needed for `claude auth login`
 * / `codex login`, which prompt directly). No output is captured either way — `stdout`/`stderr` come back empty —
 * and `input` is not piped in. Still honours `timeoutMs`, and still respects `dryRun` (skipped unless `readOnly`).
 * Mutually exclusive with `stopOnOutput` (nothing is captured to match against); if both are set, `interactive`
 * wins and `stopOnOutput` is ignored.
 */
export interface RunOptions { cwd?: string; env?: Record<string, string>; input?: string; timeoutMs?: number; readOnly?: boolean; allowFailure?: boolean; shell?: boolean; stopOnOutput?: RegExp; interactive?: boolean }
export interface RunResult { code: number; stdout: string; stderr: string; skipped: boolean; stopped?: boolean }
export type Runner = (argv: string[], opts?: RunOptions) => Promise<RunResult>;
export interface Logger { info(msg: string): void; warn(msg: string): void; error(msg: string): void; debug(msg: string): void; step(msg: string): void }

export type AuthState = { agent: 'claude' | 'codex'; authenticated: boolean; mode: string | null; detail: string };

export interface Ctx {
  host: HostInfo; paths: Paths; run: Runner; log: Logger; dryRun: boolean; yes: boolean; noAudit: boolean; channel: Channel;
  secrets: Map<string, string>; fetch: typeof fetch; env: Record<string, string | undefined>; manifest: Manifest;
  auth?: Partial<Record<'claude' | 'codex', AuthState>>;
}
export interface Installed { version: string | null; details?: Record<string, unknown> }
export type Op = 'install' | 'update' | 'skip' | 'uninstall' | 'disable' | 'configure';
export interface ActionResult { ok: boolean; message: string; changed: boolean }
export interface Action { id: string; componentId: string; op: Op; description: string; from?: string | null; to?: string | null; blockedBy?: string[]; run: (ctx: Ctx) => Promise<ActionResult> }
export type Mode = 'install' | 'update' | 'uninstall';
export interface Provider { kind: Kind; detect(c: Component, ctx: Ctx): Promise<Installed | null>; latest?(c: Component, ctx: Ctx): Promise<string | null>; plan(c: Component, ctx: Ctx, installed: Installed | null, mode: Mode): Promise<Action[]> }
export interface Selection { profile: ProfileName | 'saved'; components: Component[]; excluded: Array<{ id: string; reason: string }>; tokenTotals: { claude: number; codex: number }; codexMcpCount: number }
export interface StepRecord { componentId: string; op: Op; ok: boolean; changed: boolean; message: string; from?: string | null; to?: string | null }
export interface HostState { version: 1; installerVersion: string; profile: ProfileName | 'saved'; selectedIds: string[]; channel: Channel; installed: Record<string, { version: string | null; at: string }>; lastRun: string }
