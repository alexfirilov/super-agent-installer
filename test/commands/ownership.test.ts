import { describe, it, expect } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runInstall } from '../../src/commands/install.js';
import { runUpdate } from '../../src/commands/update.js';
import { runUninstall } from '../../src/commands/uninstall.js';
import { registerProvider, clearProviders } from '../../src/providers/registry.js';
import { action } from '../../src/providers/types.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, Manifest, Provider } from '../../src/types.js';

/**
 * Finding 1: uninstall must remove only what this installer created. Software that was on the host before the first
 * run is ADOPTED (detected, recorded, managed) but never removed; unknown provenance is treated the same way.
 */
const comp = (id: string): Component => ({ id, name: id, kind: 'tool', agents: 'both', platforms: ['linux'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'tool', probe: [id], packages: {} } });
const manifest: Manifest = { version: 1, profiles: { all: { description: '', base: 'all' } }, components: [comp('a'), comp('b')] };
/** A fake host: `present` is the set of tools on disk. install adds, uninstall removes, update bumps the version. */
function fakeHost(present: Set<string>): Provider {
  return {
    kind: 'tool',
    detect: async (c) => (present.has(c.id) ? { version: '1' } : null),
    latest: async () => '2',
    plan: async (c, _ctx, installed, mode) => {
      if (mode === 'uninstall') return installed ? [action(c.id, 'uninstall', `remove ${c.id}`, async () => { present.delete(c.id); return { ok: true, changed: true, message: 'removed' }; })] : [];
      if (!installed) return [action(c.id, 'install', `install ${c.id}`, async () => { present.add(c.id); return { ok: true, changed: true, message: 'installed' }; }, { to: '2' })];
      if (mode === 'update') return [action(c.id, 'update', `update ${c.id}`, async () => ({ ok: true, changed: true, message: 'updated' }), { from: '1', to: '2' })];
      return [];
    },
  };
}
const state = (ctx: ReturnType<typeof makeTestCtx>) => JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8'));

describe('uninstall ownership: created vs adopted', () => {
  it('case A: a tool absent before install is created by us, and uninstall removes it', async () => {
    const present = new Set<string>(); clearProviders(); registerProvider(fakeHost(present));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    expect(await runInstall(ctx, { profile: 'all', installerVersion: '0.4.0' })).toBe(0);
    expect(present.has('a')).toBe(true); expect(state(ctx).installed.a.byUs).toBe(true);
    expect(await runUninstall(ctx, ['a'], { installerVersion: '0.4.0' })).toBe(0);
    expect(present.has('a')).toBe(false);
  });
  it('case B: a tool that already existed is adopted, and uninstall leaves the software in place', async () => {
    const present = new Set(['a', 'b']); clearProviders(); registerProvider(fakeHost(present));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    expect(await runInstall(ctx, { profile: 'all', installerVersion: '0.4.0' })).toBe(0);
    expect(state(ctx).installed.a.byUs).toBe(false);
    expect(await runUninstall(ctx, ['a'], { installerVersion: '0.4.0' })).toBe(1); // refused
    expect(present.has('a')).toBe(true);
    expect(await runUninstall(ctx, undefined, { installerVersion: '0.4.0', all: true })).toBe(1); // nothing of ours to remove
    expect(present).toEqual(new Set(['a', 'b']));
  });
  it('case C: mixed host -- uninstall --all removes only what we created', async () => {
    const present = new Set(['b']); clearProviders(); registerProvider(fakeHost(present));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    expect(await runInstall(ctx, { profile: 'all', installerVersion: '0.4.0' })).toBe(0);
    expect(present).toEqual(new Set(['a', 'b']));
    expect(await runUninstall(ctx, undefined, { installerVersion: '0.4.0', all: true })).toBe(0);
    expect(present).toEqual(new Set(['b'])); // a (ours) gone, b (theirs) kept
    expect(state(ctx).installed.b).toBeDefined(); expect(state(ctx).installed.a).toBeUndefined();
  });
  it('case D1: a v0.2.0 state without provenance never removes anything', async () => {
    const present = new Set(['a', 'b']); clearProviders(); registerProvider(fakeHost(present));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    mkdirSync(dirname(ctx.paths.stateFile), { recursive: true });
    writeFileSync(ctx.paths.stateFile, JSON.stringify({ version: 1, installerVersion: '0.2.0', profile: 'all', selectedIds: ['a', 'b'], channel: 'latest', installed: { a: { version: '1', at: 't' }, b: { version: '1', at: 't' } }, lastRun: 't' }));
    expect(await runUninstall(ctx, undefined, { installerVersion: '0.4.0', all: true })).toBe(1);
    expect(await runUninstall(ctx, ['a'], { installerVersion: '0.4.0' })).toBe(1);
    expect(present).toEqual(new Set(['a', 'b']));
  });
  it('case D2: no state file at all -- a named tool that is on the host is refused, not removed', async () => {
    // Before: no record meant "nothing to protect", so the provider detected the host's own tool and removed it.
    const present = new Set(['a']); clearProviders(); registerProvider(fakeHost(present));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    expect(await runUninstall(ctx, ['a'], { installerVersion: '0.4.0' })).toBe(1);
    expect(ctx.log.lines.some((l) => /--force/.test(l))).toBe(true);
    expect(present.has('a')).toBe(true);
  });
  it('case D3: a tool that was never selected (no record) but is on the host is refused too', async () => {
    const present = new Set(['b']); clearProviders(); registerProvider(fakeHost(present));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    expect(await runInstall(ctx, { profile: 'all', only: ['a'], installerVersion: '0.4.0' })).toBe(0); // b never in the selection
    expect(state(ctx).installed.b).toBeUndefined();
    expect(await runUninstall(ctx, ['b'], { installerVersion: '0.4.0' })).toBe(1);
    expect(present.has('b')).toBe(true);
    expect(await runUninstall(ctx, ['b'], { installerVersion: '0.4.0', force: true })).toBe(0); // explicit override still works
    expect(present.has('b')).toBe(false);
  });
  it('an id with no record that is NOT on the host is a harmless no-op, so selectedIds can still be cleaned up', async () => {
    const present = new Set<string>(); clearProviders(); registerProvider(fakeHost(present));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    mkdirSync(dirname(ctx.paths.stateFile), { recursive: true });
    writeFileSync(ctx.paths.stateFile, JSON.stringify({ version: 1, installerVersion: '0.3.0', profile: 'all', selectedIds: ['a'], channel: 'latest', installed: {}, lastRun: 't' }));
    expect(await runUninstall(ctx, ['a'], { installerVersion: '0.4.0' })).toBe(0);
    expect(state(ctx).selectedIds).toEqual([]);
  });
  it('case E: updating an adopted tool does not make it ours', async () => {
    const present = new Set(['a', 'b']); clearProviders(); registerProvider(fakeHost(present));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    expect(await runInstall(ctx, { profile: 'all', installerVersion: '0.4.0' })).toBe(0);
    expect(await runUpdate(ctx, { installerVersion: '0.4.0' })).toBe(0);
    expect(state(ctx).installed.a.byUs).toBe(false); // update changed it, provenance unchanged
    expect(await runUninstall(ctx, undefined, { installerVersion: '0.4.0', all: true })).toBe(1);
    expect(present).toEqual(new Set(['a', 'b']));
  });
});
