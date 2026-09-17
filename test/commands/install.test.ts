import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { runInstall } from '../../src/commands/install.js';
import { runUpdate } from '../../src/commands/update.js';
import { registerProvider, clearProviders } from '../../src/providers/registry.js';
import { action } from '../../src/providers/types.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, Manifest, Provider } from '../../src/types.js';
const comp = (id: string, ok = true): Component => ({ id, name: id, kind: 'tool', agents: 'both', platforms: ['linux'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'tool', probe: [id], packages: {} } });
const manifest: Manifest = { version: 1, profiles: { all: { description: '', base: 'all' }, minimal: { description: '', base: 'none', include: ['a'] } }, components: [comp('a'), comp('b')] };
const fake = (fails: string[]): Provider => ({ kind: 'tool', detect: async () => null, latest: async () => '1', plan: async (c) => [action(c.id, 'install', `install ${c.id}`, async () => (fails.includes(c.id) ? { ok: false, changed: false, message: 'bad' } : { ok: true, changed: true, message: 'good' }), { to: '1' })] });
describe('runInstall / runUpdate', () => {
  it('installs the profile, writes state, returns 1 when a step fails', async () => {
    clearProviders(); registerProvider(fake(['b']));
    const ctx = makeTestCtx({ manifest });
    expect(await runInstall(ctx, { profile: 'all', installerVersion: '0.1.0' })).toBe(1);
    const state = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8')); expect(state.selectedIds).toEqual(['a', 'b']); expect(state.installed.a.version).toBe('1'); expect(state.installed.b).toBeUndefined();
  });
  it('dry-run plans without executing or writing state', async () => {
    clearProviders(); registerProvider(fake([]));
    const ctx = makeTestCtx({ manifest, dryRun: true });
    expect(await runInstall(ctx, { profile: 'minimal', installerVersion: '0.1.0' })).toBe(0); expect(existsSync(ctx.paths.stateFile)).toBe(false);
  });
  it('update replays the saved selection and calls self-update first', async () => {
    clearProviders(); registerProvider(fake([]));
    const ctx = makeTestCtx({ manifest }); await runInstall(ctx, { profile: 'minimal', installerVersion: '0.1.0' });
    let selfUpdated = false;
    expect(await runUpdate(ctx, { installerVersion: '0.1.0', selfUpdateFn: async () => { selfUpdated = true; return { updated: false, message: 'current' }; } })).toBe(0);
    expect(selfUpdated).toBe(true); expect(JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8')).selectedIds).toEqual(['a']);
  });
  it('bails on NixOS with exit 4', async () => { clearProviders(); registerProvider(fake([])); const ctx = makeTestCtx({ manifest, host: { isNixOS: true } }); expect(await runInstall(ctx, { profile: 'all', installerVersion: '0.1.0' })).toBe(4); });
});
