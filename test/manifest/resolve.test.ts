import { describe, it, expect } from 'vitest';
import { resolveSelection, slotConflicts, closure } from '../../src/manifest/resolve.js';
import type { Component, Manifest, HostInfo } from '../../src/types.js';
const c = (id: string, over: Partial<Component> = {}): Component => ({ id, name: id, kind: 'claude-plugin', agents: 'claude', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'optional', defaultSelected: true, spec: { kind: 'claude-plugin', marketplace: 'm', plugin: id }, ...over });
const host = { platform: 'linux' } as HostInfo;
const manifest: Manifest = { version: 1, components: [
  c('node', { kind: 'tool', agents: 'both', spec: { kind: 'tool', probe: ['node', '--version'], packages: {} }, contextCostTokens: {} }),
  c('superpowers', { prerequisites: ['node'], contextCostTokens: { claude: 693 }, slot: 'methodology' }),
  c('compound', { defaultSelected: false, slot: 'methodology', contextCostTokens: { claude: 3000 } }),
  c('caveman-sl', { kind: 'statusline', spec: { kind: 'statusline', provider: 'caveman' }, slot: 'statusline', dependsOn: ['superpowers'] }),
  c('hud', { kind: 'statusline', spec: { kind: 'statusline', provider: 'claude-hud' }, slot: 'statusline', defaultSelected: false }),
  c('ha', { kind: 'mcp', agents: 'both', defaultSelected: false, spec: { kind: 'mcp', target: 'codex', name: 'ha', transport: 'http', url: 'https://x' } }),
  c('exa', { kind: 'mcp', agents: 'codex', spec: { kind: 'mcp', target: 'codex', name: 'exa', transport: 'http', url: 'https://x' }, contextCostTokens: { codex: 200 } }),
  c('win-only', { platforms: ['windows'] }),
  c('a1', { conflictsWith: ['a2'] }), c('a2', { conflictsWith: ['a1'] }),
] };
const ids = (s: ReturnType<typeof resolveSelection>) => s.components.map((x) => x.id);
describe('resolveSelection', () => {
  it('the default selection: defaultSelected, platform filtered, first-of-conflict kept', () => {
    const s = resolveSelection(manifest, host, {});
    expect(ids(s)).toEqual(['node', 'superpowers', 'caveman-sl', 'exa', 'a1']);
    expect(s.excluded).toEqual(expect.arrayContaining([{ id: 'win-only', reason: 'platform' }, { id: 'a2', reason: 'conflict:a1' }]));
    expect(s.tokenTotals).toEqual({ claude: 693, codex: 200 }); expect(s.codexMcpCount).toBe(1);
  });
  it('only/skip/picked and slot conflict handling', () => {
    expect(ids(resolveSelection(manifest, host, { only: ['caveman-sl'] }))).toEqual(['node', 'superpowers', 'caveman-sl']);
    expect(ids(resolveSelection(manifest, host, { skip: ['exa'] }))).not.toContain('exa');
    const s = resolveSelection(manifest, host, { picked: ['hud', 'caveman-sl', 'compound', 'superpowers'] });
    expect(ids(s)).toEqual(['hud', 'node', 'superpowers']);
    expect(s.excluded).toEqual(expect.arrayContaining([{ id: 'caveman-sl', reason: 'slot:statusline' }, { id: 'compound', reason: 'slot:methodology' }]));
  });
  it('a saved selection replays ids', () => { expect(ids(resolveSelection(manifest, host, { savedIds: ['exa'] }))).toEqual(['exa']); });
  it('a saved selection follows a retired id to its successor and drops one that has none', () => {
    const m: Manifest = { version: 1, components: [c('new'), c('kept')], retired: [{ ...c('old'), replacedBy: 'new' }, c('gone')] };
    expect(ids(resolveSelection(m, host, { savedIds: ['old', 'gone', 'kept'] }))).toEqual(['new', 'kept']);
    expect(ids(resolveSelection(m, host, { savedIds: ['new', 'old'] }))).toEqual(['new']);
  });
  it('slotConflicts and closure helpers', () => {
    expect(slotConflicts(manifest.components.filter((x) => ['caveman-sl', 'hud', 'superpowers'].includes(x.id)))).toEqual([{ slot: 'statusline', ids: ['caveman-sl', 'hud'] }]);
    expect(closure(manifest, ['caveman-sl'])).toEqual(['node', 'superpowers', 'caveman-sl']);
  });
  it('excludes a component whose dependsOn target lost a slot conflict', () => {
    const m: Manifest = { version: 1, components: [
      c('b', { slot: 'browser' }), c('d', { slot: 'browser' }), c('a', { dependsOn: ['b'] }),
    ] };
    const s = resolveSelection(m, host, { picked: ['d', 'b', 'a'] });
    expect(ids(s)).toEqual(['d']);
    expect(s.excluded).toEqual(expect.arrayContaining([{ id: 'b', reason: 'slot:browser' }, { id: 'a', reason: 'dependency:b' }]));
  });
  it('excludes a component whose prerequisite was platform-filtered', () => {
    const m: Manifest = { version: 1, components: [
      c('b', { platforms: ['windows'] }), c('a', { prerequisites: ['b'] }),
    ] };
    const s = resolveSelection(m, host, { picked: ['a', 'b'] });
    expect(ids(s)).toEqual([]);
    expect(s.excluded).toEqual(expect.arrayContaining([{ id: 'b', reason: 'platform' }, { id: 'a', reason: 'dependency:b' }]));
  });
  it('drops a transitive chain when the root dependency is platform-excluded', () => {
    const m: Manifest = { version: 1, components: [
      c('b', { platforms: ['windows'] }), c('a', { dependsOn: ['b'] }), c('c', { dependsOn: ['a'] }),
    ] };
    const s = resolveSelection(m, host, { picked: ['c', 'a', 'b'] });
    expect(ids(s)).toEqual([]);
    expect(s.excluded).toEqual(expect.arrayContaining([{ id: 'b', reason: 'platform' }, { id: 'a', reason: 'dependency:b' }, { id: 'c', reason: 'dependency:a' }]));
  });
});
