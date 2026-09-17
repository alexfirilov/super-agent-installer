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
});
