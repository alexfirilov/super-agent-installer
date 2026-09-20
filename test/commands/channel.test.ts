import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInstall } from '../../src/commands/install.js';
import { runUpdate } from '../../src/commands/update.js';
import { runCheck } from '../../src/commands/check.js';
import { registerProvider, clearProviders } from '../../src/providers/registry.js';
import { action } from '../../src/providers/types.js';
import { resolveChannel } from '../../src/state/state.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, Manifest, Provider } from '../../src/types.js';

/** Finding 5: `install --channel stable` was forgotten by the very next `update`, which ran on the default
 * `latest` and then persisted that as the new saved channel. Precedence: CLI flag > saved state > profile > latest. */
const comp = (id: string): Component => ({ id, name: id, kind: 'tool', agents: 'both', platforms: ['linux'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'tool', probe: [id], packages: {} } });
const manifest: Manifest = { version: 1, profiles: { all: { description: '', base: 'all' }, homelab: { description: '', base: 'all', channel: 'stable' } }, components: [comp('a')] };
/** Records the channel the provider saw while planning, which is what the Claude installer uses for its apt repo / cask / installer argument. */
function seen(): { provider: Provider; channels: string[] } {
  const channels: string[] = [];
  const provider: Provider = { kind: 'tool', detect: async () => null, plan: async (c, ctx) => { channels.push(ctx.channel); return [action(c.id, 'install', 'install', async () => ({ ok: true, changed: true, message: 'ok' }))]; } };
  return { provider, channels };
}
const saved = (ctx: ReturnType<typeof makeTestCtx>) => JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8')).channel;

describe('release channel precedence', () => {
  it('resolveChannel: explicit flag, then saved state, then the profile, then latest', () => {
    const state = { version: 1 as const, installerVersion: '0', profile: 'all' as const, selectedIds: [], channel: 'stable' as const, installed: {}, lastRun: 't' };
    expect(resolveChannel('latest', state, { description: '', base: 'all', channel: 'stable' })).toBe('latest');
    expect(resolveChannel(undefined, state, { description: '', base: 'all', channel: 'latest' })).toBe('stable');
    expect(resolveChannel(undefined, null, { description: '', base: 'all', channel: 'stable' })).toBe('stable');
    expect(resolveChannel(undefined, null, undefined)).toBe('latest');
  });
  it('case A: install --channel stable, then a bare update, stays on stable', async () => {
    const s = seen(); clearProviders(); registerProvider(s.provider);
    const ctx = makeTestCtx({ manifest });
    expect(await runInstall(ctx, { profile: 'all', installerVersion: '0.4.0', channel: 'stable' })).toBe(0);
    expect(saved(ctx)).toBe('stable');
    const ctx2 = makeTestCtx({ manifest }); ctx2.paths = ctx.paths; // a later run: fresh ctx, same host state
    expect(await runUpdate(ctx2, { installerVersion: '0.4.0' })).toBe(0);
    expect(s.channels).toEqual(['stable', 'stable', 'stable', 'stable']); // preview + run, twice
    expect(saved(ctx2)).toBe('stable');
    expect(await runCheck(ctx2, {})).toBe(2); // detect null => missing; what matters is the channel it probed with
    expect(s.channels.length).toBe(4); // check does not plan; the drift report reads ctx.channel through the agent provider's latest()
    expect(ctx2.channel).toBe('stable');
  });
  it('case B: update --channel latest switches and persists the switch', async () => {
    const s = seen(); clearProviders(); registerProvider(s.provider);
    const ctx = makeTestCtx({ manifest });
    await runInstall(ctx, { profile: 'all', installerVersion: '0.4.0', channel: 'stable' });
    const ctx2 = makeTestCtx({ manifest }); ctx2.paths = ctx.paths;
    expect(await runUpdate(ctx2, { installerVersion: '0.4.0', channel: 'latest' })).toBe(0);
    expect(saved(ctx2)).toBe('latest');
  });
  it('case C: a profile channel applies when neither the flag nor a saved state names one, and the flag beats it', async () => {
    const s = seen(); clearProviders(); registerProvider(s.provider);
    const ctx = makeTestCtx({ manifest });
    expect(await runInstall(ctx, { profile: 'homelab', installerVersion: '0.4.0' })).toBe(0);
    expect(saved(ctx)).toBe('stable'); expect(s.channels[0]).toBe('stable');
    const ctx2 = makeTestCtx({ manifest });
    expect(await runInstall(ctx2, { profile: 'homelab', installerVersion: '0.4.0', channel: 'latest' })).toBe(0);
    expect(saved(ctx2)).toBe('latest');
  });
});
