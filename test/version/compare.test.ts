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
describe('prerelease identifiers (SemVer 2.0.0 section 11)', () => {
  it('compares numeric identifiers numerically, not as strings', () => {
    // string ordering put alpha.2 above alpha.10, so an update from 0.155.0-alpha.2 to alpha.10 was never offered
    expect(compareVersions('0.155.0-alpha.10', '0.155.0-alpha.2')).toBe(1);
    expect(isNewer('0.155.0-alpha.10', '0.155.0-alpha.2')).toBe(true);
    expect(isNewer('0.155.0-alpha.2', '0.155.0-alpha.10')).toBe(false);
  });
  it('numeric identifiers rank below alphanumeric ones, and a longer identifier set ranks higher when the prefix is equal', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.beta', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.1')).toBe(0);
  });
});
