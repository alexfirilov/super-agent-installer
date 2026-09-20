import type { Action, Component, Ctx, Installed, McpSpec, Platform, Provider } from '../types.js';
import { getClaudeState } from './claude-plugin.js';
import { action, ok, fail, skipAction } from './types.js';
import { substituteSpec, secretHints, runMcpPostInstall } from './mcp-shared.js';
export { secretHints };
const sortKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : v);
export function desiredClaudeMcp(spec: McpSpec, platform: Platform): Record<string, unknown> {
  if (spec.transport === 'http') { const o: Record<string, unknown> = { type: 'http', url: spec.url }; if (spec.bearerEnv) o.headers = { Authorization: `Bearer \${${spec.bearerEnv}}` }; if (spec.oauth) o.oauth = spec.oauth; return o; }
  let command = spec.command ?? ''; let args = [...(spec.args ?? [])];
  if (platform === 'windows' && ['npx', 'uvx', 'npm', 'node'].includes(command) && command !== 'node') { args = ['/c', command, ...args]; command = 'cmd'; }
  const env: Record<string, string> = { ...(spec.env ?? {}) }; for (const v of spec.secretEnv ?? []) env[v] = `\${${v}}`;
  const o: Record<string, unknown> = { type: 'stdio', command, args }; if (Object.keys(env).length) o.env = env; return o;
}
export const mcpClaudeProvider: Provider = {
  kind: 'mcp',
  async detect(c, ctx) { if (c.spec.kind !== 'mcp') return null; const st = await getClaudeState(ctx); if (!st.installed) return null; const cfg = st.mcp[c.spec.name]; return cfg ? { version: null, details: cfg as Record<string, unknown> } : null; },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'mcp') return []; const spec = c.spec; const st = await getClaudeState(ctx); if (!st.installed) return [skipAction(c.id, 'Claude Code not installed', 'claude-code')];
    const remove = () => ctx.run(['claude', 'mcp', 'remove', '-s', 'user', spec.name], { allowFailure: true });
    const same = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
    const tryDesired = (): Record<string, unknown> | null => { try { return desiredClaudeMcp(substituteSpec(spec, ctx), ctx.host.platform); } catch { return null; } };
    if (mode === 'uninstall') {
      if (!installed) return [];
      return [action(c.id, 'uninstall', `remove MCP ${spec.name} (Claude)`, async () => {
        // Ours to remove only while the entry is still what we wrote. An entry the user edited since is theirs now:
        // leave it and say so. (When the desired form cannot be computed -- a placeholder env var is unset -- the
        // comparison is skipped and the entry is treated as ours, as before.)
        const desired = tryDesired();
        if (desired && installed.details !== undefined && !same(installed.details, desired)) return ok(`${spec.name}: left in place, it was modified after this installer wrote it`, false);
        await remove();
        const previous = ctx.state?.installed[c.id]?.previous;
        if (previous !== undefined) { await ctx.run(['claude', 'mcp', 'add-json', spec.name, JSON.stringify(previous), '-s', 'user'], { timeoutMs: 120000 }); return ok(`${spec.name} removed; your earlier definition restored`); }
        return ok(`${spec.name} removed`);
      })];
    }
    const op = installed ? 'configure' : 'install';
    let resolved: McpSpec;
    try { resolved = substituteSpec(spec, ctx); } catch (e) { return [action(c.id, op, `${op} MCP ${spec.name} (Claude, user scope)`, async () => fail((e as Error).message))]; }
    const desired = desiredClaudeMcp(resolved, ctx.host.platform);
    if (installed && same(installed.details, desired)) return [];
    return [action(c.id, op, `${op} MCP ${spec.name} (Claude, user scope)`, async () => {
      for (const v of spec.secretEnv ?? []) if (!ctx.env[v] && !ctx.secrets.has(v)) ctx.log.warn(`${spec.name}: ${v} is not set; the server will not authenticate until you export it`);
      await remove(); await ctx.run(['claude', 'mcp', 'add-json', spec.name, JSON.stringify(desired), '-s', 'user'], { timeoutMs: 120000 });
      const post = await runMcpPostInstall(spec, ctx);
      if (post) return fail(post);
      // an entry that was there and differed is the user's own: remember it so uninstall can put it back
      return { ...ok(`${spec.name} configured for Claude.${secretHints(c, ctx)}`), ...(installed ? { previous: installed.details } : {}) };
    })];
  },
};
