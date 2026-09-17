import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readToml, writeTomlMarkerBlock, tomlTableEquals, TomlError } from '../../src/config/toml.js';
describe('toml', () => {
  it('reads missing file as empty and throws on invalid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-'));
    expect(await readToml(join(dir, 'none.toml'))).toEqual({});
    writeFileSync(join(dir, 'bad.toml'), '[a\n'); await expect(readToml(join(dir, 'bad.toml'))).rejects.toThrow(TomlError);
  });
  it('writes a marker block of top-level keys and keeps user content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const f = join(dir, 'config.toml');
    writeFileSync(f, 'model = "gpt-5.6-sol"\n# user comment\n[projects."/home/u"]\ntrust_level = "trusted"\n');
    const r1 = await writeTomlMarkerBlock(f, { features: { memories: true } }, join(dir, 'b'));
    expect(r1.changed).toBe(true);
    const text = readFileSync(f, 'utf8');
    expect(text).toContain('# user comment'); expect(text).toContain('# >>> super-agent-installer >>>'); expect(text).toContain('[features]\nmemories = true');
    expect((await readToml(f)) as { features: { memories: boolean } }).toMatchObject({ features: { memories: true }, model: 'gpt-5.6-sol' });
    const r2 = await writeTomlMarkerBlock(f, { features: { memories: true } }, join(dir, 'b')); expect(r2.changed).toBe(false);
  });
  it('refuses to write when the result does not parse', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const f = join(dir, 'c.toml'); writeFileSync(f, '[features]\nmemories = false\n');
    await expect(writeTomlMarkerBlock(f, { features: { memories: true } }, join(dir, 'b'))).rejects.toThrow(/duplicate|redefine|parse/i);
    expect(readFileSync(f, 'utf8')).toBe('[features]\nmemories = false\n');
  });
  it('compares tables ignoring key order', () => { expect(tomlTableEquals({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true); expect(tomlTableEquals({ a: 1 }, { a: 2 })).toBe(false); });
});
