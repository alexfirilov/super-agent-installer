import { describe, it, expect } from 'vitest';
import { normalizeVersion, compareVersions, isNewer } from '../../src/version/compare.js';
describe('normalizeVersion', () => {
  it('extracts versions from CLI output', () => {
    expect(normalizeVersion('2.1.273 (Claude Code)')).toBe('2.1.273');
    expect(normalizeVersion('codex-cli 0.154.0')).toBe('0.154.0');
    expect(normalizeVersion('rust-v0.154.0')).toBe('0.154.0');
    expect(normalizeVersion('v1.6.0')).toBe('1.6.0');
    expect(normalizeVersion('0.155.0-alpha.16')).toBe('0.155.0-alpha.16');
    expect(normalizeVersion('no version here')).toBeNull();
  });
});
describe('compareVersions', () => {
  it('orders numerically and treats prerelease as lower', () => {
    expect(compareVersions('2.1.274', '2.1.273')).toBe(1);
    expect(compareVersions('0.154.0', '0.155.0-alpha.1')).toBe(-1);
    expect(compareVersions('0.155.0-alpha.1', '0.155.0')).toBe(-1);
    expect(compareVersions('1.6.0', '1.6.0')).toBe(0);
    expect(isNewer('2.1.274', '2.1.273')).toBe(true);
    expect(isNewer('2.1.273', null)).toBe(true);
    expect(isNewer(null, '2.1.273')).toBe(false);
  });
});
