import { describe, it, expect } from 'vitest';
import { probeVersion } from '../../src/detect/tools.js';
import type { Runner } from '../../src/types.js';
const fake = (out: Record<string, string | Error>): Runner => async (argv) => { const v = out[argv.join(' ')]; if (v instanceof Error) throw v; if (v === undefined) return { code: 127, stdout: '', stderr: 'not found', skipped: false }; return { code: 0, stdout: v, stderr: '', skipped: false }; };
describe('probeVersion', () => {
  it('returns normalized version', async () => { expect(await probeVersion(fake({ 'claude --version': '2.1.273 (Claude Code)\n' }), ['claude', '--version'])).toBe('2.1.273'); });
  it('returns null when missing or throwing', async () => {
    expect(await probeVersion(fake({}), ['nope', '--version'])).toBeNull();
    expect(await probeVersion(fake({ 'x --version': new Error('ENOENT') }), ['x', '--version'])).toBeNull();
  });
  it('applies a custom regex', async () => { expect(await probeVersion(fake({ 'go version': 'go version go1.27.0 linux/amd64' }), ['go', 'version'], 'go(\\d+\\.\\d+\\.\\d+)')).toBe('1.27.0'); });
});
