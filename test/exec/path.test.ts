import { describe, it, expect } from 'vitest';
import { extendPath, toolDirs } from '../../src/exec/path.js';
import type { HostInfo } from '../../src/types.js';
const linux = { platform: 'linux', home: '/home/u' } as HostInfo;
const windows = { platform: 'windows', home: 'C:\\Users\\u' } as HostInfo;
describe('extendPath', () => {
  it('prepends the install dirs once and keeps the existing PATH', () => {
    const env: Record<string, string | undefined> = { PATH: '/usr/bin:/bin' };
    const added = extendPath(linux, env);
    expect(added).toEqual(['/home/u/.local/bin', '/home/u/.local/share/fnm', '/home/u/.local/share/fnm/aliases/default/bin', '/home/u/go/bin', '/home/u/.local/go/bin', '/usr/local/bin']);
    expect(env.PATH).toBe('/home/u/.local/bin:/home/u/.local/share/fnm:/home/u/.local/share/fnm/aliases/default/bin:/home/u/go/bin:/home/u/.local/go/bin:/usr/local/bin:/usr/bin:/bin');
    expect(extendPath(linux, env)).toEqual([]);
    expect(env.PATH).toBe('/home/u/.local/bin:/home/u/.local/share/fnm:/home/u/.local/share/fnm/aliases/default/bin:/home/u/go/bin:/home/u/.local/go/bin:/usr/local/bin:/usr/bin:/bin');
  });
  it('skips dirs already on PATH (trailing slash tolerant) and handles an empty PATH', () => {
    const env: Record<string, string | undefined> = { PATH: '/usr/local/bin/:/home/u/.local/bin' };
    expect(extendPath(linux, env)).toEqual(['/home/u/.local/share/fnm', '/home/u/.local/share/fnm/aliases/default/bin', '/home/u/go/bin', '/home/u/.local/go/bin']);
    const empty: Record<string, string | undefined> = {};
    extendPath(linux, empty); expect(empty.PATH).toBe(toolDirs(linux, empty).join(':'));
  });
  it('uses ; and the Windows install dirs', () => {
    const env: Record<string, string | undefined> = { PATH: 'C:\\Windows\\system32', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
    const added = extendPath(windows, env);
    expect(added).toEqual([
      'C:\\Users\\u\\.local\\bin',
      'C:\\Users\\u\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin',
      'C:\\Program Files\\nodejs',
      'C:\\Users\\u\\go\\bin',
      'C:\\Users\\u\\AppData\\Roaming\\npm',
      'C:\\Program Files\\Go\\bin',
      'C:\\Users\\u\\AppData\\Local\\Programs\\Go\\bin',
      'C:\\Users\\u\\scoop\\shims',
    ]);
    expect(env.PATH).toBe('C:\\Users\\u\\.local\\bin;C:\\Users\\u\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin;C:\\Program Files\\nodejs;C:\\Users\\u\\go\\bin;C:\\Users\\u\\AppData\\Roaming\\npm;C:\\Program Files\\Go\\bin;C:\\Users\\u\\AppData\\Local\\Programs\\Go\\bin;C:\\Users\\u\\scoop\\shims;C:\\Windows\\system32');
    expect(extendPath(windows, env)).toEqual([]);
  });
  it('honours GOPATH for the go bin dir (go install puts gopls there; found by real-host apply)', () => {
    expect(toolDirs(linux, { GOPATH: '/opt/gopath' })).toContain('/opt/gopath/bin');
    expect(toolDirs(linux, {})).toContain('/home/u/go/bin');
    expect(toolDirs(linux, {})).toContain('/home/u/.local/go/bin');
  });
  it('uses %APPDATA%\\npm, %SCOOP%\\shims when set, and does not add the transient fnm_multishells dir', () => {
    const withScoop = toolDirs(windows, { APPDATA: 'C:\\Users\\u\\AppData\\Roaming', SCOOP: 'D:\\scoop', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' });
    expect(withScoop).toContain('C:\\Users\\u\\AppData\\Roaming\\npm');
    expect(withScoop).toContain('D:\\scoop\\shims');
    expect(withScoop).not.toContain('C:\\Users\\u\\AppData\\Local\\fnm_multishells');
    expect(withScoop.some((d) => d.includes('fnm_multishells'))).toBe(false);
  });
  it('falls back to %USERPROFILE%\\scoop\\shims and default APPDATA/ProgramFiles when unset', () => {
    const dirs = toolDirs(windows, {});
    expect(dirs).toContain('C:\\Users\\u\\AppData\\Roaming\\npm');
    expect(dirs).toContain('C:\\Users\\u\\scoop\\shims');
    expect(dirs).toContain('C:\\Program Files\\Go\\bin');
    expect(dirs).toContain('C:\\Users\\u\\AppData\\Local\\Programs\\Go\\bin');
  });
});
