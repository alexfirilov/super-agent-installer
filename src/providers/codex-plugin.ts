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
    if (mode === 'uninstall') return installed ? [action(c.id, 'uninstall', `remove ${id}`, async () => {
      await ctx.run(['codex', 'plugin', 'remove', id, '--json'], { allowFailure: true });
      st.plugins = st.plugins.filter((p) => p.id !== id);
      return ok(`${id} removed`);
    })] : [];
    if (!installed) return [action(c.id, 'install', `install ${id}`, async () => {
      await ensureCodexMarketplace(ctx, spec.marketplace, spec.marketplaceSource);
      const r = await add(ctx, id);
      if (!r.ok) return fail(`install ${id} failed: ${r.error}`);
      const existing = st.plugins.find((p) => p.id === id);
      if (existing) existing.version = r.version; else st.plugins.push({ id, version: r.version });
      return ok(`${id} ${r.version ?? ''} installed`);
    })];
    if (mode !== 'update') return [];
    return [action(c.id, 'update', `update ${id}`, async () => {
      await upgradeMarketplace(ctx, spec.marketplace);
      const r = await add(ctx, id);
      if (!r.ok) return fail(`update ${id} failed: ${r.error}`);
      const same = r.version && r.version === installed.version;
      for (const p of st.plugins) if (p.id === id) p.version = r.version;
      return ok(same ? `${id} up to date (${r.version})` : `${id} updated ${installed.version ?? ''} -> ${r.version ?? ''}`, !same);
    }, { from: installed.version, to: null })];
  },
};
