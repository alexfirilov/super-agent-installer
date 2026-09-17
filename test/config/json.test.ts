import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, statSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { readJsonFile, backupFile, writeJsonAtomic, mergeClaudeSettings } from '../../src/config/json.js';
describe('json config', () => {
  it('backs up then writes atomically preserving mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const f = join(dir, 'settings.json'); writeFileSync(f, '{"a":1}'); chmodSync(f, 0o600);
    const b = await backupFile(f, join(dir, 'backups'));
    expect(b && readFileSync(b, 'utf8')).toBe('{"a":1}');
    await writeJsonAtomic(f, { a: 2 });
    expect(readFileSync(f, 'utf8')).toBe('{\n  "a": 2\n}\n');
    if (platform() !== 'win32') expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).filter((n) => n.startsWith('.settings.json.'))).toHaveLength(0);
  });
  it('returns null for missing or invalid json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); expect(await readJsonFile(join(dir, 'x.json'))).toBeNull();
    writeFileSync(join(dir, 'bad.json'), '{'); expect(await readJsonFile(join(dir, 'bad.json'))).toBeNull();
  });
  it('backup of a missing file returns null', async () => { expect(await backupFile('/nonexistent/x.json', tmpdir())).toBeNull(); });
});
describe('mergeClaudeSettings', () => {
  const hook = (cmd: string) => ({ hooks: [{ type: 'command', command: cmd }] });
  it('deep merges, dedupes hooks, deletes on null', () => {
    const existing = { model: 'opus', env: { A: '1' }, hooks: { PreToolUse: [hook('x')] }, statusLine: { type: 'command', command: 'old' } };
    const out = mergeClaudeSettings(existing, { env: { B: '2' }, hooks: { PreToolUse: [hook('x'), hook('y')], Stop: [hook('z')] }, statusLine: null, autoUpdatesChannel: 'latest' });
    expect(out).toEqual({ model: 'opus', env: { A: '1', B: '2' }, hooks: { PreToolUse: [hook('x'), hook('y')], Stop: [hook('z')] }, autoUpdatesChannel: 'latest' });
  });
  it('replaces non-hook arrays and is idempotent', () => {
    const a = mergeClaudeSettings({ permissions: { allow: ['a'] } }, { permissions: { allow: ['b'] } });
    expect(a).toEqual({ permissions: { allow: ['b'] } });
    const once = mergeClaudeSettings({}, { hooks: { Stop: [hook('z')] } }); expect(mergeClaudeSettings(once, { hooks: { Stop: [hook('z')] } })).toEqual(once);
  });
});
