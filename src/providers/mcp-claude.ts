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
    if (c.spec.kind !== 'mcp') return []; const spec = c.spec; const st = await getClaudeState(ctx); if (!st.installed) return [skipAction(c.id, 'Claude Code not installed', 'claude-code')];
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
