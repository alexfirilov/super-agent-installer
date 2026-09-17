import { describe, it, expect } from 'vitest';
import { extendPath, toolDirs } from '../../src/exec/path.js';
import type { HostInfo } from '../../src/types.js';
const linux = { platform: 'linux', home: '/home/u' } as HostInfo;
const windows = { platform: 'windows', home: 'C:\\Users\\u' } as HostInfo;
describe('extendPath', () => {
  it('prepends the install dirs once and keeps the existing PATH', () => {
    const env: Record<string, string | undefined> = { PATH: '/usr/bin:/bin' };
    const added = extendPath(linux, env);
    expect(added).toEqual(['/home/u/.local/bin', '/home/u/.local/share/fnm', '/home/u/.local/share/fnm/aliases/default/bin', '/usr/local/bin']);
    expect(env.PATH).toBe('/home/u/.local/bin:/home/u/.local/share/fnm:/home/u/.local/share/fnm/aliases/default/bin:/usr/local/bin:/usr/bin:/bin');
    expect(extendPath(linux, env)).toEqual([]);
    expect(env.PATH).toBe('/home/u/.local/bin:/home/u/.local/share/fnm:/home/u/.local/share/fnm/aliases/default/bin:/usr/local/bin:/usr/bin:/bin');
  });
  it('skips dirs already on PATH (trailing slash tolerant) and handles an empty PATH', () => {
    const env: Record<string, string | undefined> = { PATH: '/usr/local/bin/:/home/u/.local/bin' };
    expect(extendPath(linux, env)).toEqual(['/home/u/.local/share/fnm', '/home/u/.local/share/fnm/aliases/default/bin']);
    const empty: Record<string, string | undefined> = {};
    extendPath(linux, empty); expect(empty.PATH).toBe(toolDirs(linux, empty).join(':'));
  });
  it('uses ; and the Windows install dirs', () => {
    const env: Record<string, string | undefined> = { PATH: 'C:\\Windows\\system32', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
    const added = extendPath(windows, env);
    expect(added).toEqual(['C:\\Users\\u\\.local\\bin', 'C:\\Users\\u\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin', 'C:\\Program Files\\nodejs']);
    expect(env.PATH).toBe('C:\\Users\\u\\.local\\bin;C:\\Users\\u\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin;C:\\Program Files\\nodejs;C:\\Windows\\system32');
    expect(extendPath(windows, env)).toEqual([]);
  });
});
