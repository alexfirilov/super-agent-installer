import { describe, it, expect } from 'vitest';
import { parseCli } from '../src/cli.js';
describe('parseCli', () => {
  it('parses commands and flags', () => {
    expect(parseCli(['install', '--profile', 'homelab', '--only', 'a,b', '--skip', 'c', '--yes', '--dry-run', '--json', '--no-audit', '--channel', 'stable', '-v'])).toMatchObject({ command: 'install', profile: 'homelab', only: ['a', 'b'], skip: ['c'], yes: true, dryRun: true, json: true, noAudit: true, channel: 'stable', verbose: true });
    expect(parseCli([])).toMatchObject({ command: 'install' });
    expect(parseCli(['uninstall', 'cp-x', 'cp-y', '-y'])).toMatchObject({ command: 'uninstall', ids: ['cp-x', 'cp-y'], yes: true });
    expect(parseCli(['update', '--no-self-update', '--from-state'])).toMatchObject({ command: 'update', noSelfUpdate: true, fromState: true });
    expect(parseCli(['install'])).toMatchObject({ noLogin: false });
    expect(parseCli(['install', '--no-login'])).toMatchObject({ noLogin: true });
    expect(parseCli(['install'])).toMatchObject({ noPersistSecrets: false });
    expect(parseCli(['install', '--no-persist-secrets'])).toMatchObject({ noPersistSecrets: true });
    expect(parseCli(['install'])).toMatchObject({ elevate: false });
    expect(parseCli(['install', '--elevate'])).toMatchObject({ elevate: true });
    expect(parseCli(['--version'])).toMatchObject({ command: 'version' }); expect(parseCli(['bogus'])).toMatchObject({ command: 'help', error: expect.stringContaining('bogus') });
    expect(() => parseCli(['install', '--profile', 'nope'])).toThrow(/profile/);
  });
});
