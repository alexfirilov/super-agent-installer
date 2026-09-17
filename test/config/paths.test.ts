import { describe, it, expect } from 'vitest';
import { resolvePaths } from '../../src/config/paths.js';
import type { HostInfo } from '../../src/types.js';
const base = { platform: 'linux', arch: 'x64', isRoot: false, hasSudo: true, pkgManager: 'apt', isWsl: false, isProxmoxHost: false, isLxc: false, isNixOS: false, isMusl: false, hasAvx: true, hasBwrap: true, home: '/home/u', diskFreeMb: 1, claudeRunning: false, windowsDeveloperMode: null, isElevated: null, osRelease: {} } as HostInfo;
describe('resolvePaths', () => {
  it('uses defaults on linux', () => {
    const p = resolvePaths(base, {});
    expect(p.claudeSettings).toBe('/home/u/.claude/settings.json');
    expect(p.claudeJson).toBe('/home/u/.claude.json');
    expect(p.codexConfig).toBe('/home/u/.codex/config.toml');
    expect(p.agentsSkillsDir).toBe('/home/u/.agents/skills');
    expect(p.stateFile).toBe('/home/u/.config/super-agent-installer/state.json');
  });
  it('honours CLAUDE_CONFIG_DIR and CODEX_HOME', () => {
    const p = resolvePaths(base, { CLAUDE_CONFIG_DIR: '/tmp/cc', CODEX_HOME: '/tmp/cx' });
    expect(p.claudeSettings).toBe('/tmp/cc/settings.json'); expect(p.claudeJson).toBe('/tmp/cc/.claude.json'); expect(p.codexHooks).toBe('/tmp/cx/hooks.json');
  });
  it('uses APPDATA on windows', () => {
    const p = resolvePaths({ ...base, platform: 'windows', home: 'C:\\Users\\u' }, { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' });
    expect(p.stateFile).toBe('C:\\Users\\u\\AppData\\Roaming\\super-agent-installer\\state.json');
    expect(p.claudeSettings).toBe('C:\\Users\\u\\.claude\\settings.json');
  });
});
