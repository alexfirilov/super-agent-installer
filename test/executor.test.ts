import { describe, it, expect, afterEach } from 'vitest';
import { executePlan, executeGrouped, refreshEnvironment } from '../src/executor.js';
import { registerProvider, clearProviders } from '../src/providers/registry.js';
import { getClaudeState } from '../src/providers/claude-plugin.js';
import { action, skipAction } from '../src/providers/types.js';
import { makeTestCtx } from './helpers/ctx.js';
import type { Component, Provider, Selection } from '../src/types.js';
const c = (id: string, kind: Component['kind'], spec: Component['spec']): Component => ({ id, name: id, kind, agents: 'both', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: true, spec });
const sel = (components: Component[]): Selection => ({ profile: 'all', components, excluded: [], tokenTotals: { claude: 0, codex: 0 }, codexMcpCount: 0 });
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
describe('executeGrouped', () => {
  it('plans each kind group after the previous one ran: a plugin skipped on a fresh host installs once the agent action flipped detection', async () => {
    clearProviders();
    let agentInstalled = false; let nodeInstalled = false; const order: string[] = [];
    registerProvider({ kind: 'tool', detect: async () => (nodeInstalled ? { version: '22' } : null), plan: async (comp, _ctx, inst) => (inst ? [] : [action(comp.id, 'install', 'install node', async () => { nodeInstalled = true; order.push('node'); return { ok: true, changed: true, message: 'node' }; })]) });
    registerProvider({ kind: 'agent', detect: async () => (agentInstalled ? { version: '2' } : null), plan: async (comp, _ctx, inst) => (inst ? [] : [action(comp.id, 'install', 'install Claude Code', async () => { agentInstalled = true; order.push('agent'); return { ok: true, changed: true, message: 'installed' }; })]) });
    registerProvider({ kind: 'claude-plugin', detect: async () => null, plan: async (comp) => (agentInstalled ? [action(comp.id, 'install', `install ${comp.id}`, async () => { order.push('plugin'); return { ok: true, changed: true, message: 'plugin installed' }; })] : [skipAction(comp.id, 'Claude Code not installed', 'claude-code')]) });
    registerProvider({ kind: 'skill', detect: async () => null, plan: async (comp) => (nodeInstalled ? [action(comp.id, 'install', `install ${comp.id}`, async () => { order.push('skill'); return { ok: true, changed: true, message: 'skill installed' }; })] : [skipAction(comp.id, 'Node.js is required', 'node')]) });
    const s = sel([c('node', 'tool', { kind: 'tool', probe: ['node'], packages: {} }), c('claude-code', 'agent', { kind: 'agent', agent: 'claude' }), c('cp-x', 'claude-plugin', { kind: 'claude-plugin', marketplace: 'm', plugin: 'x' }), c('sk-y', 'skill', { kind: 'skill', repo: 'a/b', skills: ['y'], targets: ['claude-code'] })]);
    const refreshed: number[] = []; const ctx = makeTestCtx();
    const r = await executeGrouped(s, ctx, 'install', { refresh: () => { refreshed.push(order.length); } });
    expect(order).toEqual(['node', 'agent', 'plugin', 'skill']);
    expect(r.records.map((x) => `${x.componentId}:${x.op}:${x.ok}`)).toEqual(['node:install:true', 'claude-code:install:true', 'cp-x:install:true', 'sk-y:install:true']);
    expect(r.failed).toBe(0); expect(r.changed).toBe(4);
    expect(refreshed).toEqual([1, 2]); // after the tool action and after the agent action, not after plugin/skill actions
    expect(r.plan.detections).toEqual({ node: null, 'claude-code': null, 'cp-x': null, 'sk-y': null });
  });
});
describe('refreshEnvironment', () => {
  const saved = process.env.PATH;
  afterEach(() => { process.env.PATH = saved; });
  it('prepends the tool dirs to process.env.PATH once and drops the agent state caches', async () => {
    const ctx = makeTestCtx({ responses: { 'claude --version': '1.0.0' } });
    const before = await getClaudeState(ctx); expect(before.installed).toBe(true);
    ctx.calls.length = 0;
    process.env.PATH = '/usr/bin';
    await refreshEnvironment(ctx);
    const home = ctx.host.home; const goBin = `${process.env.GOPATH ?? `${home}/go`}/bin`;
    expect(process.env.PATH).toBe(`${home}/.local/bin:${home}/.local/share/fnm:${home}/.local/share/fnm/aliases/default/bin:${goBin}:${home}/.local/go/bin:/usr/local/bin:/usr/bin`);
    await refreshEnvironment(ctx);
    expect(process.env.PATH).toBe(`${home}/.local/bin:${home}/.local/share/fnm:${home}/.local/share/fnm/aliases/default/bin:${goBin}:${home}/.local/go/bin:/usr/local/bin:/usr/bin`);
    await getClaudeState(ctx); expect(ctx.calls.some((a) => a.join(' ') === 'claude --version')).toBe(true); // re-detected
  });
  it('also merges any registry PATH entry missing from process.env.PATH on Windows, exactly once across two calls', async () => {
    const registryPath = 'C:\\Program Files\\Go\\bin;C:\\Users\\u\\AppData\\Roaming\\npm';
    const psProbe = ['powershell', '-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"].join(' ');
    const ctx = makeTestCtx({ host: { platform: 'windows', home: 'C:\\Users\\u' }, responses: { [psProbe]: registryPath } });
    process.env.PATH = 'C:\\Windows\\system32';
    await refreshEnvironment(ctx);
    expect(process.env.PATH).toContain('C:\\Program Files\\Go\\bin');
    expect(process.env.PATH).toContain('C:\\Users\\u\\AppData\\Roaming\\npm');
    const afterFirst = process.env.PATH;
    await refreshEnvironment(ctx);
    expect(process.env.PATH).toBe(afterFirst); // idempotent: no duplicates across two calls
    const parts = (process.env.PATH ?? '').split(';').map((p) => p.toLowerCase());
    expect(new Set(parts).size).toBe(parts.length); // exactly once each, across two calls
  });
});
