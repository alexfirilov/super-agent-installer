import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runUpdate } from '../../src/commands/update.js';
import { runCheck } from '../../src/commands/check.js';
import { retiredToRemove } from '../../src/commands/retire.js';
import { runInstall } from '../../src/commands/install.js';
import { registerProvider, clearProviders } from '../../src/providers/registry.js';
import { action } from '../../src/providers/types.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, HostState, Kind, Manifest, Provider, RetiredComponent } from '../../src/types.js';

const comp = (id: string, kind: Kind = 'skill'): Component => ({ id, name: id, kind, agents: 'both', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: true, spec: kind === 'tool' ? { kind: 'tool', probe: ['x'], packages: {} } : { kind: 'skill', repo: 'a/b', skills: [id], targets: ['codex'] } });
const manifest = (retired: RetiredComponent[]): Manifest => ({ version: 1, components: [comp('live')], retired });
const state = (selectedIds: string[], byUs: string[] = []): HostState => ({ version: 1, installerVersion: '0.4.0', selectedIds, channel: 'latest', cooldownDays: 3, installed: Object.fromEntries(selectedIds.map((id) => [id, { version: '1', at: 't', byUs: byUs.includes(id) }])), lastRun: 't' });
const seed = (ctx: ReturnType<typeof makeTestCtx>, s: HostState) => { mkdirSync(dirname(ctx.paths.stateFile), { recursive: true }); writeFileSync(ctx.paths.stateFile, JSON.stringify(s)); };
const saved = (ctx: ReturnType<typeof makeTestCtx>) => JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8')) as HostState;

/** Everything is present, and uninstalling `failing` fails. Records the order components were acted on. */
function provider(kind: Kind, log: string[], failing: string[] = []): Provider {
  return {
    kind, detect: async () => ({ version: '1' }),
    plan: async (c, _ctx, _i, mode) => [action(c.id, mode === 'uninstall' ? 'uninstall' : 'update', `${mode} ${c.id}`, async () => { log.push(`${mode}:${c.id}`); return { ok: !(mode === 'uninstall' && failing.includes(c.id)), changed: true, message: 'x' }; })],
  };
}
const update = (ctx: ReturnType<typeof makeTestCtx>) => runUpdate(ctx, { installerVersion: '0.5.0', noSelfUpdate: true });

describe('retiredToRemove', () => {
  const ctx = makeTestCtx({ manifest: manifest([comp('old-skill'), comp('old-tool', 'tool'), comp('never-had')]) });
  it('removes managed agent configuration even when the host adopted it rather than us installing it', () => {
    expect(retiredToRemove(ctx, state(['old-skill'])).map((c) => c.id)).toEqual(['old-skill']);
  });
  it('removes a tool only with proof we installed it: removing an OS package can take its dependents with it', () => {
    expect(retiredToRemove(ctx, state(['old-tool']))).toEqual([]);
    expect(retiredToRemove(ctx, state(['old-tool'], ['old-tool'])).map((c) => c.id)).toEqual(['old-tool']);
  });
  it('touches nothing the saved selection does not name, and nothing on a fresh host', () => {
    expect(retiredToRemove(ctx, state(['live']))).toEqual([]);
    expect(retiredToRemove(ctx, null)).toEqual([]);
  });
});

describe('retirement during update', () => {
  it('removes the retired component first, drops it from the saved selection and moves the host to the successor', async () => {
    const log: string[] = []; clearProviders(); registerProvider(provider('skill', log));
    const ctx = makeTestCtx({ manifest: { version: 1, components: [comp('new')], retired: [{ ...comp('old'), replacedBy: 'new' }] } }); seed(ctx, state(['old']));
    expect(await update(ctx)).toBe(0);
    expect(log).toEqual(['uninstall:old', 'update:new']);
    expect(saved(ctx).selectedIds).toEqual(['new']);
    expect(saved(ctx).installed.old).toBeUndefined();
  });
  it('keeps a failed removal in the selection so the next run retries, and exits 1', async () => {
    const log: string[] = []; clearProviders(); registerProvider(provider('skill', log, ['old']));
    const ctx = makeTestCtx({ manifest: manifest([comp('old')]) }); seed(ctx, state(['live', 'old']));
    expect(await update(ctx)).toBe(1);
    expect(saved(ctx).selectedIds).toEqual(['live', 'old']);
    registerProvider(provider('skill', log));
    expect(await update(ctx)).toBe(0);
    expect(saved(ctx).selectedIds).toEqual(['live']);
  });
  it('--only retires nothing and keeps the saved selection: it installs no successor', async () => {
    const log: string[] = []; clearProviders(); registerProvider(provider('skill', log));
    const ctx = makeTestCtx({ manifest: { version: 1, components: [comp('live'), { ...comp('new'), defaultSelected: false }], retired: [{ ...comp('old'), replacedBy: 'new' }] } }); seed(ctx, state(['live', 'old']));
    expect(await runInstall(ctx, { only: ['live'], installerVersion: '0.5.0' })).toBe(0);
    expect(log).not.toContain('uninstall:old');
    expect(saved(ctx).selectedIds).toEqual(['live', 'old']);
  });
  it('--json output stays one JSON document when something is retired', async () => {
    const lines: string[] = []; const orig = console.log; console.log = (m: string) => lines.push(m);
    try {
      clearProviders(); registerProvider(provider('skill', []));
      const ctx = makeTestCtx({ manifest: manifest([comp('old')]) }); seed(ctx, state(['live', 'old']));
      expect(await runUpdate(ctx, { installerVersion: '0.5.0', noSelfUpdate: true, json: true })).toBe(0);
      expect(() => JSON.parse(lines.join('\n'))).not.toThrow();
    } finally { console.log = orig; }
  });
  it('a retired pack leaves alone the skills a live component now owns', async () => {
    const seen: string[][] = []; clearProviders();
    registerProvider({ kind: 'skill', detect: async () => ({ version: '1' }), plan: async (c, _ctx, _i, mode) => { if (mode === 'uninstall' && c.spec.kind === 'skill') seen.push(c.spec.skills as string[]); return []; } });
    const pack = (id: string, skills: string[]): Component => ({ ...comp(id), spec: { kind: 'skill', repo: 'a/b', skills, targets: ['codex'] } });
    const ctx = makeTestCtx({ manifest: { version: 1, components: [pack('new', ['keep'])], retired: [{ ...pack('old', ['keep', 'drop']), replacedBy: 'new' }, pack('all-live', ['keep'])] } }); seed(ctx, state(['old', 'all-live']));
    await update(ctx);
    expect(seen).toEqual([['drop']]);
  });
  it('leaves an adopted tool on the host and stops managing it', async () => {
    const log: string[] = []; clearProviders(); registerProvider(provider('skill', log)); registerProvider(provider('tool', log));
    const ctx = makeTestCtx({ manifest: manifest([comp('old-tool', 'tool')]) }); seed(ctx, state(['live', 'old-tool']));
    expect(await update(ctx)).toBe(0);
    expect(log).not.toContain('uninstall:old-tool');
    expect(saved(ctx).selectedIds).toEqual(['live']);
  });
});

describe('check', () => {
  it('reports a retired component still to be removed as drift', async () => {
    const lines: string[] = []; const orig = console.log; console.log = (m: string) => lines.push(m);
    try {
      clearProviders(); registerProvider(provider('skill', []));
      const ctx = makeTestCtx({ manifest: manifest([comp('old')]) }); seed(ctx, state(['live', 'old']));
      expect(await runCheck(ctx, { json: true })).toBe(2);
      expect(JSON.parse(lines.join('\n')).rows.find((r: { id: string }) => r.id === 'old')).toMatchObject({ status: 'outdated', latest: 'removed from catalog' });
    } finally { console.log = orig; }
  });
  it('a stale skill is outdated, an unanswerable one unknown, not ok', async () => {
    const lines: string[] = []; const orig = console.log; console.log = (m: string) => lines.push(m);
    try {
      for (const [answer, status, exit] of [[true, 'outdated', 2], [false, 'ok', 0], [null, 'unknown', 0]] as const) {
        lines.length = 0; clearProviders(); registerProvider({ ...provider('skill', []), stale: async () => answer });
        const ctx = makeTestCtx({ manifest: { version: 1, components: [comp('live')] } }); seed(ctx, state(['live']));
        expect(await runCheck(ctx, { json: true })).toBe(exit);
        expect(JSON.parse(lines.join('\n')).rows[0].status).toBe(status);
      }
    } finally { console.log = orig; }
  });
});
