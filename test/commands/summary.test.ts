import { describe, it, expect } from 'vitest';
import { postInstallHints, secretExportHints } from '../../src/commands/summary.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const comp = (id: string, secrets: Component['secrets']): Component => ({ id, name: id, kind: 'mcp', agents: 'both', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: true, secrets, spec: { kind: 'mcp', target: 'claude', name: id, transport: 'http', url: 'https://x' } });
describe('secretExportHints', () => {
  const comps = [comp('a', [{ env: 'A_KEY', prompt: 'A key', required: true }]), comp('b', [{ env: 'B_KEY', prompt: 'B key', required: false }, { env: 'A_KEY', prompt: 'dup', required: false }]), comp('c', [{ env: 'C_KEY', prompt: 'C key', required: true }])];
  it('lists every secret env that is not in the ambient environment, once, including values typed this run', () => {
    const ctx = makeTestCtx({ env: { B_KEY: 'ambient', C_KEY: 'typed' }, secrets: { C_KEY: 'typed' } });
    const hints = secretExportHints(ctx, comps);
    expect(hints).toHaveLength(2);
    expect(hints[0]).toMatch(/^export A_KEY=<value>  # A key \(required, not set\)/);
    expect(hints[1]).toMatch(/^export C_KEY=<value>  # C key \(the value you typed was used for this run only/);
  });
  it('uses setx on Windows and is included in postInstallHints', () => {
    const ctx = makeTestCtx({ host: { platform: 'windows' } });
    const hints = postInstallHints(ctx, comps, []);
    expect(hints).toEqual([expect.stringMatching(/^setx A_KEY "<value>"/), expect.stringMatching(/^setx B_KEY "<value>"  # B key \(optional, not set\)/), expect.stringMatching(/^setx C_KEY "<value>"/)]);
  });
});
