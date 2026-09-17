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
const toolSpec = z.object({ kind: z.literal('tool'), probe: z.array(z.string()).min(1), versionRegex: z.string().optional(), packages: z.object({ apt: z.string().optional(), dnf: z.string().optional(), apk: z.string().optional(), pacman: z.string().optional(), zypper: z.string().optional(), brew: z.string().optional(), winget: z.string().optional(), scoop: z.string().optional(), choco: z.string().optional(), npm: z.string().optional(), go: z.string().optional(), uvTool: z.string().optional(), script: z.object({ linux: z.string().optional(), windows: z.string().optional(), darwin: z.string().optional() }).optional() }), latest: z.object({ npm: z.string().optional(), github: z.string().optional() }).optional(), postInstall: z.object({ linux: z.array(z.array(z.string())).optional(), windows: z.array(z.array(z.string())).optional(), darwin: z.array(z.array(z.string())).optional() }).optional(), strategy: z.literal('node').optional() });
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
