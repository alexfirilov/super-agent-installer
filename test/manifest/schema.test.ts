import { describe, it, expect } from 'vitest';
import { parseManifest, ManifestError } from '../../src/manifest/schema.js';

const base = { version: 1, profiles: { all: { description: 'everything', base: 'all' } }, components: [] as unknown[] };
const plugin = { id: 'cp-x', name: 'x', kind: 'claude-plugin', agents: 'claude', platforms: ['linux'], description: 'd', verdict: 'optional', defaultSelected: false, spec: { kind: 'claude-plugin', marketplace: 'm', plugin: 'x' } };

describe('parseManifest', () => {
  it('parses a valid manifest', () => {
    const m = parseManifest({ ...base, components: [plugin] });
    expect(m.components).toHaveLength(1);
  });
  it('rejects duplicate ids', () => {
    expect(() => parseManifest({ ...base, components: [plugin, plugin] })).toThrow(ManifestError);
    try { parseManifest({ ...base, components: [plugin, plugin] }); } catch (e) { expect((e as ManifestError).issues[0]).toMatch(/duplicate id cp-x/); }
  });
  it('rejects unknown dependsOn / prerequisites / conflictsWith ids', () => {
    expect(() => parseManifest({ ...base, components: [{ ...plugin, dependsOn: ['nope'] }] })).toThrow(/unknown id nope/);
  });
  it('rejects spec.kind that does not match kind', () => {
    expect(() => parseManifest({ ...base, components: [{ ...plugin, kind: 'skill' }] })).toThrow(/spec.kind/);
  });
  it('rejects a codex-only component whose spec targets claude', () => {
    const mcp = { ...plugin, id: 'mcp-a', kind: 'mcp', agents: 'codex', spec: { kind: 'mcp', target: 'claude', name: 'a', transport: 'http', url: 'https://x' } };
    expect(() => parseManifest({ ...base, components: [mcp] })).toThrow(/agents/);
  });
});
