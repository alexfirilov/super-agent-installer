import { describe, it, expect } from 'vitest';
import { resolveSelection, slotConflicts, closure } from '../../src/manifest/resolve.js';
import type { Component, Manifest, HostInfo } from '../../src/types.js';
const c = (id: string, over: Partial<Component> = {}): Component => ({ id, name: id, kind: 'claude-plugin', agents: 'claude', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'optional', defaultSelected: true, spec: { kind: 'claude-plugin', marketplace: 'm', plugin: id }, ...over });
const host = { platform: 'linux' } as HostInfo;
const manifest: Manifest = { version: 1, profiles: {
  all: { description: '', base: 'all' }, minimal: { description: '', base: 'none', include: ['node', 'superpowers'] },
  'claude-only': { description: '', base: 'all', agentFilter: 'claude' }, work: { description: '', base: 'all', exclude: ['proxy'] },
  homelab: { description: '', base: 'all', include: ['ha'] }, 'proxmox-host': { description: '', base: 'none', include: ['superpowers'] }, 'codex-only': { description: '', base: 'all', agentFilter: 'codex' },
}, components: [
  c('node', { kind: 'tool', agents: 'both', spec: { kind: 'tool', probe: ['node', '--version'], packages: {} }, contextCostTokens: {} }),
  c('superpowers', { prerequisites: ['node'], contextCostTokens: { claude: 693 }, slot: 'methodology' }),
  c('compound', { defaultSelected: false, slot: 'methodology', contextCostTokens: { claude: 3000 } }),
  c('caveman-sl', { kind: 'statusline', spec: { kind: 'statusline', provider: 'caveman' }, slot: 'statusline', dependsOn: ['superpowers'] }),
  c('hud', { kind: 'statusline', spec: { kind: 'statusline', provider: 'claude-hud' }, slot: 'statusline', defaultSelected: false }),
  c('proxy', { forceOffInAll: true }),
  c('ha', { kind: 'mcp', agents: 'both', defaultSelected: false, spec: { kind: 'mcp', target: 'codex', name: 'ha', transport: 'http', url: 'https://x' } }),
  c('exa', { kind: 'mcp', agents: 'codex', spec: { kind: 'mcp', target: 'codex', name: 'exa', transport: 'http', url: 'https://x' }, contextCostTokens: { codex: 200 } }),
  c('win-only', { platforms: ['windows'] }),
  c('a1', { conflictsWith: ['a2'] }), c('a2', { conflictsWith: ['a1'] }),
] };
const ids = (s: ReturnType<typeof resolveSelection>) => s.components.map((x) => x.id);
describe('resolveSelection', () => {
  it('profile all: defaultSelected minus forceOff, platform filtered, first-of-conflict kept', () => {
    const s = resolveSelection(manifest, host, { profile: 'all' });
    expect(ids(s)).toEqual(['node', 'superpowers', 'caveman-sl', 'exa', 'a1']);
    expect(s.excluded).toEqual(expect.arrayContaining([{ id: 'proxy', reason: 'forceOffInAll' }, { id: 'win-only', reason: 'platform' }, { id: 'a2', reason: 'conflict:a1' }]));
    expect(s.tokenTotals).toEqual({ claude: 693, codex: 200 }); expect(s.codexMcpCount).toBe(1);
  });
  it('minimal uses include list plus closure in dependency order', () => { expect(ids(resolveSelection(manifest, host, { profile: 'minimal' }))).toEqual(['node', 'superpowers']); });
  it('agent filters and homelab include', () => {
    expect(ids(resolveSelection(manifest, host, { profile: 'codex-only' }))).toEqual(['node', 'exa']);
    expect(ids(resolveSelection(manifest, host, { profile: 'homelab' }))).toContain('ha');
    expect(ids(resolveSelection(manifest, host, { profile: 'work' }))).not.toContain('proxy');
  });
  it('only/skip/picked and slot conflict handling', () => {
    expect(ids(resolveSelection(manifest, host, { profile: 'all', only: ['caveman-sl'] }))).toEqual(['node', 'superpowers', 'caveman-sl']);
    expect(ids(resolveSelection(manifest, host, { profile: 'all', skip: ['exa'] }))).not.toContain('exa');
    const s = resolveSelection(manifest, host, { profile: 'all', picked: ['hud', 'caveman-sl', 'compound', 'superpowers'] });
    expect(ids(s)).toEqual(['hud', 'node', 'superpowers']);
    expect(s.excluded).toEqual(expect.arrayContaining([{ id: 'caveman-sl', reason: 'slot:statusline' }, { id: 'compound', reason: 'slot:methodology' }]));
  });
  it('saved profile replays ids', () => { expect(ids(resolveSelection(manifest, host, { profile: 'saved', savedIds: ['exa'] }))).toEqual(['exa']); });
  it('slotConflicts and closure helpers', () => {
    expect(slotConflicts(manifest.components.filter((x) => ['caveman-sl', 'hud', 'superpowers'].includes(x.id)))).toEqual([{ slot: 'statusline', ids: ['caveman-sl', 'hud'] }]);
    expect(closure(manifest, ['caveman-sl'])).toEqual(['node', 'superpowers', 'caveman-sl']);
  });
});
