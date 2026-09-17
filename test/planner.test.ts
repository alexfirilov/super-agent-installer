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
