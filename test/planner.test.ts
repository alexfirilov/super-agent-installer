import { describe, it, expect } from 'vitest';
import { buildPlan, KIND_ORDER } from '../src/planner.js';
import { registerProvider, getProvider, clearProviders } from '../src/providers/registry.js';
import { action, skipAction } from '../src/providers/types.js';
import { makeTestCtx } from './helpers/ctx.js';
import type { Component, Provider, Selection } from '../src/types.js';
const c = (id: string, kind: Component['kind'], spec: Component['spec']): Component => ({ id, name: id, kind, agents: 'both', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: true, spec });
const fake = (kind: Component['kind'], installed: boolean, acts: number): Provider => ({ kind, detect: async () => (installed ? { version: '1' } : null), plan: async (comp, _ctx, inst, mode) => Array.from({ length: acts }, (_, i) => action(comp.id, mode === 'uninstall' ? 'uninstall' : inst ? 'update' : 'install', `${comp.id} ${i}`, async () => ({ ok: true, changed: true, message: 'done' }))) });
const sel = (components: Component[]): Selection => ({ profile: 'all', components, excluded: [], tokenTotals: { claude: 0, codex: 0 }, codexMcpCount: 0 });
describe('planner', () => {
  it('orders actions by kind then selection, adds skip for empty plans, reverses for uninstall', async () => {
    clearProviders(); registerProvider(fake('skill', false, 1)); registerProvider(fake('tool', true, 1)); registerProvider(fake('agent', false, 0));
    const s = sel([c('s1', 'skill', { kind: 'skill', repo: 'a/b', skills: ['x'], targets: ['codex'] }), c('t1', 'tool', { kind: 'tool', probe: ['x'], packages: {} }), c('a1', 'agent', { kind: 'agent', agent: 'claude' })]);
    const plan = await buildPlan(s, makeTestCtx(), 'install');
    expect(plan.actions.map((a) => `${a.componentId}:${a.op}`)).toEqual(['t1:update', 'a1:skip', 's1:install']);
    expect(plan.detections).toEqual({ s1: null, t1: { version: '1' }, a1: null });
    const un = await buildPlan(s, makeTestCtx(), 'uninstall');
    expect(un.actions.map((a) => a.componentId)).toEqual(['s1', 'a1', 't1']);
  });
  it('registry throws for unknown kinds', () => { clearProviders(); expect(() => getProvider('mcp')).toThrow(/no provider/); });
  it('KIND_ORDER covers every kind once', () => { expect([...KIND_ORDER].sort()).toEqual(['agent', 'claude-plugin', 'codex-plugin', 'hook', 'instructions', 'mcp', 'setting', 'skill', 'statusline', 'tool']); });

  // A fresh host: the agent is not installed, so the plugin provider can only skip. In preview mode the row must say "install (after claude-code)" when claude-code is part of the same run, and running that action must re-detect and re-plan.
  const freshHost = () => {
    let agentInstalled = false;
    const agent: Provider = { kind: 'agent', detect: async () => (agentInstalled ? { version: '2' } : null), plan: async (comp, _ctx, inst) => (inst ? [] : [action(comp.id, 'install', 'install Claude Code', async () => { agentInstalled = true; return { ok: true, changed: true, message: 'installed' }; })]) };
    const plugin: Provider = { kind: 'claude-plugin', detect: async () => null, plan: async (comp) => (agentInstalled ? [action(comp.id, 'install', `install ${comp.id}`, async () => ({ ok: true, changed: true, message: 'plugin installed' }))] : [skipAction(comp.id, 'Claude Code not installed', 'claude-code')]) };
    const s = sel([c('claude-code', 'agent', { kind: 'agent', agent: 'claude' }), c('cp-x', 'claude-plugin', { kind: 'claude-plugin', marketplace: 'm', plugin: 'x' })]);
    return { agent, plugin, s, installed: () => agentInstalled };
  };
  it('preview labels blocked dependents as install (after <blocker>) and the deferred action re-plans at run time', async () => {
    clearProviders(); const f = freshHost(); registerProvider(f.agent); registerProvider(f.plugin);
    const plain = await buildPlan(f.s, makeTestCtx(), 'install');
    expect(plain.actions.map((a) => `${a.componentId}:${a.op}:${a.description}`)).toEqual(['claude-code:install:install Claude Code', 'cp-x:skip:Claude Code not installed']);
    const preview = await buildPlan(f.s, makeTestCtx(), 'install', { preview: true });
    expect(preview.actions.map((a) => `${a.componentId}:${a.op}:${a.description}`)).toEqual(['claude-code:install:install Claude Code', 'cp-x:install:install (after claude-code)']);
    expect(f.installed()).toBe(false);
    const ctx = makeTestCtx();
    const early = await preview.actions[1]!.run(ctx); expect(early.ok).toBe(false); expect(early.message).toMatch(/still blocked: Claude Code not installed/); // agent not installed yet
    for (const a of preview.actions) expect((await a.run(ctx)).ok).toBe(true);
    expect(f.installed()).toBe(true);
  });
  it('preview keeps the skip when the blocker is not part of the run', async () => {
    clearProviders(); const f = freshHost(); registerProvider(f.agent); registerProvider(f.plugin);
    const preview = await buildPlan(sel(f.s.components.filter((x) => x.kind !== 'agent')), makeTestCtx(), 'install', { preview: true });
    expect(preview.actions.map((a) => `${a.componentId}:${a.op}`)).toEqual(['cp-x:skip']);
  });
});
