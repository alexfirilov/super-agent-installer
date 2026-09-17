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
    const uninstallAll = async () => {
      for (const s of scopes) await ctx.run(['claude', 'plugin', 'uninstall', id, '--scope', s], { allowFailure: true, timeoutMs: 300000 });
      st.plugins = st.plugins.filter((p) => p.id !== id);
      return ok(`${id} uninstalled (${scopes.join(', ')})`);
    };
    if (act === 'uninstall' || mode === 'uninstall') return installed ? [action(c.id, 'uninstall', `uninstall ${id}`, uninstallAll)] : [];
    if (act === 'disable') return installed && enabled ? [action(c.id, 'disable', `disable ${id} at user scope`, async () => {
      await ctx.run(['claude', 'plugin', 'disable', id, '--scope', 'user'], { allowFailure: true });
      for (const p of st.plugins) if (p.id === id && p.scope === 'user') p.enabled = false;
      return ok(`${id} disabled`);
    })] : [];
    if (!installed) return [action(c.id, 'install', `install ${id}`, async () => {
      await ensureClaudeMarketplace(ctx, spec.marketplace, spec.marketplaceSource);
      const r = await ctx.run(['claude', 'plugin', 'install', id, '--scope', 'user', '--json'], { allowFailure: true, timeoutMs: 600000 });
      const j = lastJson(r.stdout); if (r.code !== 0 && j?.outcome !== 'ok') return fail(`install ${id} failed: ${(j?.message as string) ?? r.stderr.trim()}`);
      const existing = st.plugins.find((p) => p.id === id && p.scope === 'user');
      if (existing) existing.enabled = true; else st.plugins.push({ id, version: (j?.version as string) ?? '', scope: 'user', enabled: true });
      return ok(`${id} installed`);
    })];
    const acts: Action[] = [];
    if (!enabled) acts.push(action(c.id, 'configure', `enable ${id}`, async () => {
      await ctx.run(['claude', 'plugin', 'enable', id], { allowFailure: true });
      for (const p of st.plugins) if (p.id === id) p.enabled = true;
      return ok(`${id} enabled`);
    }));
    if (mode === 'update') acts.push(action(c.id, 'update', `update ${id}`, async () => {
      await refreshMarketplace(ctx, spec.marketplace);
      const r = await ctx.run(['claude', 'plugin', 'update', id, '--json'], { allowFailure: true, timeoutMs: 600000 }); const j = lastJson(r.stdout);
      if (r.code !== 0) return fail(`update ${id} failed: ${(j?.failureCode as string) ?? r.stderr.trim()}`);
      if (j?.updateOutcome === 'up_to_date') return ok(`${id} up to date (${j.newVersion ?? installed.version})`, false);
      const newVersion = (j?.newVersion as string | undefined) ?? installed.version ?? '';
      for (const p of st.plugins) if (p.id === id) p.version = newVersion;
      return ok(`${id} updated ${j?.oldVersion ?? ''} -> ${j?.newVersion ?? ''}`);
    }, { from: installed.version, to: null }));
    return acts;
  },
};
