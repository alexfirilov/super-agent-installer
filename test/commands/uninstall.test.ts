import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runUninstall } from '../../src/commands/uninstall.js';
import { registerProvider, clearProviders } from '../../src/providers/registry.js';
import { action } from '../../src/providers/types.js';
import { writeState } from '../../src/state/state.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, HostState, Manifest, Provider } from '../../src/types.js';

const comp = (id: string): Component => ({ id, name: id, kind: 'tool', agents: 'both', platforms: ['linux'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'tool', probe: [id], packages: {} } });
const manifest: Manifest = { version: 1, profiles: {}, components: [comp('a'), comp('b'), comp('c')] };

// behavior: 'ok' -> installed, uninstall succeeds; 'fail' -> installed, uninstall fails; 'absent' -> never installed (detect null, planner auto-skips)
const fakeProvider = (behavior: Record<string, 'ok' | 'fail' | 'absent'>): Provider => ({
  kind: 'tool',
  detect: async (c) => (behavior[c.id] === 'absent' ? null : { version: '1' }),
  plan: async (c, _ctx, installed, mode) => {
    if (mode !== 'uninstall' || installed === null) return [];
    return [action(c.id, 'uninstall', `remove ${c.id}`, async () => (behavior[c.id] === 'fail' ? { ok: false, changed: false, message: 'bad' } : { ok: true, changed: true, message: 'removed' }))];
  },
});

const initialState = (selectedIds: string[], installed: HostState['installed']): HostState => ({ version: 1, installerVersion: '0.1.0', profile: 'all', selectedIds, channel: 'latest', installed, lastRun: 't' });

describe('runUninstall', () => {
  it('removes an installed component from selectedIds and installed', async () => {
    clearProviders(); registerProvider(fakeProvider({ a: 'ok', b: 'ok', c: 'ok' }));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    await writeState(ctx.paths.stateFile, initialState(['a', 'b', 'c'], { a: { version: '1', at: 't' }, b: { version: '1', at: 't' }, c: { version: '1', at: 't' } }));
    const code = await runUninstall(ctx, ['a'], { installerVersion: '0.1.0' });
    expect(code).toBe(0);
    const state = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8'));
    expect(state.selectedIds).toEqual(['b', 'c']);
    expect(state.installed.a).toBeUndefined();
  });

  it('removes an already-absent component (detect null) from selectedIds too', async () => {
    clearProviders(); registerProvider(fakeProvider({ a: 'ok', b: 'ok', c: 'absent' }));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    await writeState(ctx.paths.stateFile, initialState(['a', 'b', 'c'], { a: { version: '1', at: 't' }, b: { version: '1', at: 't' } }));
    const code = await runUninstall(ctx, ['c'], { installerVersion: '0.1.0' });
    expect(code).toBe(0);
    const state = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8'));
    expect(state.selectedIds).toEqual(['a', 'b']);
    expect(state.installed.c).toBeUndefined();
  });

  it('keeps the id in selectedIds when the uninstall step fails', async () => {
    clearProviders(); registerProvider(fakeProvider({ a: 'ok', b: 'fail', c: 'ok' }));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    await writeState(ctx.paths.stateFile, initialState(['a', 'b', 'c'], { a: { version: '1', at: 't' }, b: { version: '1', at: 't' }, c: { version: '1', at: 't' } }));
    const code = await runUninstall(ctx, undefined, { installerVersion: '0.1.0' });
    expect(code).toBe(1);
    const state = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8'));
    expect(state.selectedIds).toEqual(['b']);
    expect(state.installed.b.version).toBe('1');
    expect(state.installed.a).toBeUndefined();
  });

  it('uninstall <id> removes only the named component, never its prerequisites (uninstall sk-x must not plan removing node)', async () => {
    clearProviders(); registerProvider(fakeProvider({ node: 'ok', 'sk-x': 'ok' }));
    registerProvider({ ...fakeProvider({ node: 'ok', 'sk-x': 'ok' }), kind: 'skill' });
    const chain: Manifest = { version: 1, profiles: {}, components: [comp('node'), { ...comp('sk-x'), kind: 'skill', prerequisites: ['node'], spec: { kind: 'skill', repo: 'a/b', skills: ['x'], targets: ['codex'] } }] };
    const ctx = makeTestCtx({ manifest: chain }); ctx.yes = true;
    await writeState(ctx.paths.stateFile, initialState(['node', 'sk-x'], { node: { version: '1', at: 't' }, 'sk-x': { version: '1', at: 't' } }));
    const logs: string[] = []; const orig = console.log; console.log = (m: string) => { logs.push(String(m)); };
    try { expect(await runUninstall(ctx, ['sk-x'], { installerVersion: '0.1.0' })).toBe(0); } finally { console.log = orig; }
    expect(logs[0]).not.toMatch(/remove node/); expect(logs[0]).toMatch(/remove sk-x/);
    const state = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8'));
    expect(state.selectedIds).toEqual(['node']); expect(state.installed.node.version).toBe('1'); expect(state.installed['sk-x']).toBeUndefined();
  });
});
