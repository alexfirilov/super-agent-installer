import { describe, it, expect } from 'vitest';
import { detectHost, type HostDeps } from '../../src/detect/host.js';
function deps(over: Partial<HostDeps> & { files?: Record<string, string>; bins?: string[]; uid?: number; ps?: string }): HostDeps {
  const files = over.files ?? {}; const bins = new Set(over.bins ?? []);
  return {
    platform: 'linux', arch: 'x64', env: {}, homedir: '/home/u', uid: over.uid ?? 1000,
    readFile: async (p) => files[p] ?? null, exists: async (p) => p in files, which: async (c) => bins.has(c),
    run: async (argv) => ({ code: 0, stdout: argv[0] === 'ps' ? (over.ps ?? '') : argv[0] === 'df' ? 'Filesystem 1M-blocks Used Available Use% Mounted\n/dev/x 1000 500 12345 50% /home\n' : '', stderr: '', skipped: false }),
    ...over,
  };
}
describe('detectHost', () => {
  it('detects Proxmox host as root with apt and AVX', async () => {
    const h = await detectHost(deps({ uid: 0, bins: ['apt-get', 'pveversion'], files: { '/etc/os-release': 'ID=debian\nVERSION_ID="13"\n', '/proc/cpuinfo': 'flags : fpu avx avx2\n', '/etc/pve/.version': '{}' } }));
    expect(h).toMatchObject({ platform: 'linux', isRoot: true, pkgManager: 'apt', isProxmoxHost: true, hasAvx: true, osRelease: { ID: 'debian' } });
  });
  it('detects LXC, WSL, musl and missing AVX', async () => {
    const h = await detectHost(deps({ bins: ['apk', 'sudo'], files: { '/etc/os-release': 'ID=alpine\n', '/proc/cpuinfo': 'flags : fpu sse\n', '/proc/1/environ': 'container=lxc\0', '/proc/version': 'Linux version 5.15 microsoft-standard-WSL2', '/lib/ld-musl-x86_64.so.1': '' } }));
    expect(h).toMatchObject({ isLxc: true, isWsl: true, isMusl: true, hasAvx: false, pkgManager: 'apk', hasSudo: true, isRoot: false });
  });
  it('detects a running claude session and disk space', async () => {
    const h = await detectHost(deps({ ps: '1234 claude\n', files: { '/proc/cpuinfo': 'avx' } }));
    expect(h.claudeRunning).toBe(true); expect(h.diskFreeMb).toBe(12345);
  });
  it('maps windows and darwin', async () => {
    const w = await detectHost(deps({ platform: 'win32', arch: 'arm64', bins: ['winget'], env: { USERPROFILE: 'C:\\Users\\u' } }));
    expect(w).toMatchObject({ platform: 'windows', arch: 'arm64', pkgManager: 'winget', hasAvx: null });
    const d = await detectHost(deps({ platform: 'darwin', bins: ['brew'] }));
    expect(d).toMatchObject({ platform: 'darwin', pkgManager: 'brew' });
  });
});
