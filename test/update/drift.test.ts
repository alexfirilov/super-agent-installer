import { describe, it, expect } from 'vitest';
import { driftReport } from '../../src/update/drift.js';
import { registerProvider, clearProviders } from '../../src/providers/registry.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, Provider } from '../../src/types.js';
const c = (id: string, kind: Component['kind']): Component => ({ id, name: id, kind, agents: 'both', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: true, spec: { kind: 'tool', probe: ['x'], packages: {} } as Component['spec'] });
describe('driftReport', () => {
  it('classifies rows', async () => {
    clearProviders();
    const tool: Provider = { kind: 'tool', detect: async (comp) => (comp.id === 'missing' ? null : { version: comp.id === 'old' ? '1.0.0' : '2.0.0' }), latest: async (comp) => (comp.id === 'nolatest' ? null : '2.0.0'), plan: async () => [] };
    const setting: Provider = { kind: 'setting', detect: async () => ({ version: null }), plan: async () => [] };
    registerProvider(tool); registerProvider(setting);
    const rows = await driftReport(makeTestCtx(), [c('old', 'tool'), c('fresh', 'tool'), c('missing', 'tool'), c('nolatest', 'tool'), c('cfg', 'setting')]);
    expect(rows.map((r) => `${r.id}:${r.status}`)).toEqual(['old:outdated', 'fresh:ok', 'missing:missing', 'nolatest:unknown', 'cfg:ok']);
  });
  it('reads an uninstall/disable component the other way round: absent or disabled is the wanted state (found by real-host apply: check exited 2 over four plugins it had just removed)', async () => {
    clearProviders();
    const plug = (id: string, act: 'uninstall' | 'disable'): Component => ({ ...c(id, 'claude-plugin'), spec: { kind: 'claude-plugin', marketplace: 'm', plugin: id, action: act } });
    const present = new Set(['still-there', 'still-enabled', 'properly-disabled']);
    registerProvider({ kind: 'claude-plugin', detect: async (comp) => (present.has(comp.id) ? { version: '1.0.0', details: { enabled: comp.id !== 'properly-disabled' } } : null), plan: async () => [] });
    const rows = await driftReport(makeTestCtx(), [plug('gone', 'uninstall'), plug('still-there', 'uninstall'), plug('properly-disabled', 'disable'), plug('still-enabled', 'disable'), plug('never-installed', 'disable')]);
    expect(rows.map((r) => `${r.id}:${r.status}`)).toEqual(['gone:ok', 'still-there:outdated', 'properly-disabled:ok', 'still-enabled:outdated', 'never-installed:ok']);
  });
});
