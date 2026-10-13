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

describe('version placeholders', () => {
  const tool = (npm: string, versions?: unknown) => ({ id: 'tl', name: 'tl', kind: 'tool', agents: 'both', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: false, spec: { kind: 'tool', probe: ['tl'], packages: { npm } }, ...(versions ? { versions } : {}) });
  const issues = (c: unknown) => { try { parseManifest({ ...base, components: [c] }); return []; } catch (e) { return (e as ManifestError).issues; } };
  it('accepts a placeholder with a matching versions entry', () => {
    expect(issues(tool('tl@{{version}}', { version: { registry: 'npm', package: 'tl', pin: '1.2.3', major: 1 } }))).toEqual([]);
  });
  it('rejects a placeholder without an entry, an entry nothing uses, and a pin that is not exact', () => {
    expect(issues(tool('tl@{{version}}'))).toEqual(['tl: {{version}} has no entry in versions']);
    expect(issues(tool('tl@1.0.0', { version: { registry: 'npm', package: 'tl', pin: '1.0.0' } }))).toEqual(['tl: versions.version is never used in the spec']);
    expect(issues(tool('tl@{{version}}', { version: { registry: 'npm', package: 'tl', pin: '^1.0.0' } })).join()).toMatch(/exact x\.y\.z/);
  });
});
