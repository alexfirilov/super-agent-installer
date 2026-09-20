import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInstall } from '../../src/commands/install.js';
import { runUpdate } from '../../src/commands/update.js';
import { runUninstall } from '../../src/commands/uninstall.js';
import { registerProvider, clearProviders } from '../../src/providers/registry.js';
import { action, skipAction } from '../../src/providers/types.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, Manifest, Provider } from '../../src/types.js';

/** Finding 6: `update` returned right after updating the installer itself, so the components waited for a second
 * run; and blocked components (agent never signed in) counted as success. */
const comp = (id: string): Component => ({ id, name: id, kind: 'tool', agents: 'both', platforms: ['linux'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'tool', probe: [id], packages: {} } });
const manifest: Manifest = { version: 1, profiles: { all: { description: '', base: 'all' } }, components: [comp('a'), comp('b')] };
type Behavior = 'update' | 'fail' | 'blocked' | 'current';
function fake(b: Record<string, Behavior>): { provider: Provider; ran: string[] } {
  const ran: string[] = [];
  const provider: Provider = {
    kind: 'tool',
    detect: async () => ({ version: '1' }),
    latest: async () => '2',
    plan: async (c, _ctx, _installed, mode) => {
      if (mode === 'uninstall') return [skipAction(c.id, 'blocked on uninstall', undefined, { blocked: true })];
      if (mode === 'install') return []; // already on the host
      switch (b[c.id]) {
        case 'blocked': return [skipAction(c.id, 'agent not signed in', 'codex-cli', { blocked: true })];
        case 'fail': return [action(c.id, 'update', 'update', async () => { ran.push(c.id); return { ok: false, changed: false, message: 'boom' }; })];
        case 'update': return [action(c.id, 'update', 'update', async () => { ran.push(c.id); return { ok: true, changed: true, message: 'updated' }; }, { from: '1', to: '2' })];
        default: return [];
      }
    },
  };
  return { provider, ran };
}
const installed = async (behaviour: Record<string, Behavior>) => { const f = fake(behaviour); clearProviders(); registerProvider(f.provider); const ctx = makeTestCtx({ manifest }); await runInstall(ctx, { profile: 'all', installerVersion: '0.4.0' }); return { ctx, ...f }; };

describe('runUpdate', () => {
  it('self-update available + component updates: re-executes the new binary with --no-self-update and returns its exit code, without running the components itself', async () => {
    const { ctx, ran } = await installed({ a: 'update', b: 'update' });
    let reexecArgs: string[] | null = null;
    const code = await runUpdate(ctx, { installerVersion: '0.4.0', selfUpdateFn: async () => ({ updated: true, message: 'updated v0.4.0 -> v0.5.0' }), reexec: async (extra) => { reexecArgs = extra; return 7; } });
    expect(code).toBe(7);
    expect(reexecArgs).toEqual(['--no-self-update']);
    expect(ran).toEqual([]); // the old binary must not also run the component updates
  });
  it('self-update available but no way to re-exec: says so and still updates the components', async () => {
    const { ctx, ran } = await installed({ a: 'update', b: 'current' });
    const code = await runUpdate(ctx, { installerVersion: '0.4.0', selfUpdateFn: async () => ({ updated: true, message: 'updated' }) });
    expect(code).toBe(0); expect(ran).toEqual(['a']);
  });
  it('a blocked component makes update exit 2, not 0', async () => {
    const { ctx } = await installed({ a: 'current', b: 'blocked' });
    expect(await runUpdate(ctx, { installerVersion: '0.4.0' })).toBe(2);
  });
  it('a failed component makes update exit 1, even when another one is blocked', async () => {
    const { ctx } = await installed({ a: 'fail', b: 'blocked' });
    expect(await runUpdate(ctx, { installerVersion: '0.4.0' })).toBe(1);
  });
  it('a fully successful update exits 0, and so does one with nothing to do', async () => {
    const some = await installed({ a: 'update', b: 'current' });
    expect(await runUpdate(some.ctx, { installerVersion: '0.4.0' })).toBe(0); expect(some.ran).toEqual(['a']);
    const none = await installed({ a: 'current', b: 'current' });
    expect(await runUpdate(none.ctx, { installerVersion: '0.4.0' })).toBe(0); expect(none.ran).toEqual([]);
    expect(JSON.parse(readFileSync(none.ctx.paths.stateFile, 'utf8')).selectedIds).toEqual(['a', 'b']);
  });
});
describe('runUninstall exit codes', () => {
  it('a blocked step exits 2', async () => {
    const { ctx } = await installed({ a: 'current' });
    // make `a` ours so the provenance guard lets it through
    const { writeState, readState } = await import('../../src/state/state.js');
    const s = (await readState(ctx.paths.stateFile))!; s.installed.a = { version: '1', at: 't', byUs: true }; await writeState(ctx.paths.stateFile, s);
    expect(await runUninstall(ctx, ['a'], { installerVersion: '0.4.0' })).toBe(2);
  });
});
