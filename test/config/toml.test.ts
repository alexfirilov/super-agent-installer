import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readToml, writeTomlMarkerBlock, removeTomlMarkerBlock, tomlTableEquals, TomlError } from '../../src/config/toml.js';
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
  it('places bare keys before the first user table so they stay top-level (C3), idempotently, and removes cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const f = join(dir, 'config.toml');
    const original = 'model = "gpt-5.6-sol"\n\n[mcp_servers.x]\ncommand = "npx"\nargs = ["-y", "x"]\n';
    writeFileSync(f, original);
    expect((await writeTomlMarkerBlock(f, { mcp_oauth_callback_port: 12345, features: { memories: true } }, join(dir, 'b'))).changed).toBe(true);
    const parsed = await readToml(f) as { mcp_oauth_callback_port?: number; features?: { memories?: boolean }; mcp_servers?: { x?: Record<string, unknown> } };
    expect(parsed.mcp_oauth_callback_port).toBe(12345); expect(parsed.features).toEqual({ memories: true });
    expect(parsed.mcp_servers?.x).toEqual({ command: 'npx', args: ['-y', 'x'] });
    const text1 = readFileSync(f, 'utf8');
    expect(text1.indexOf('# >>> super-agent-installer >>>')).toBeLessThan(text1.indexOf('[mcp_servers.x]'));
    expect(text1).toMatch(/# >>> super-agent-installer >>>\nmcp_oauth_callback_port = 12345\n\n\[features\]\nmemories = true\n# <<< super-agent-installer <<</);
    expect((await writeTomlMarkerBlock(f, { mcp_oauth_callback_port: 12345, features: { memories: true } }, join(dir, 'b'))).changed).toBe(false);
    expect(readFileSync(f, 'utf8')).toBe(text1);
    expect((await removeTomlMarkerBlock(f, join(dir, 'b'))).changed).toBe(true);
    expect(readFileSync(f, 'utf8')).toBe(original);
  });
  it('moves a legacy trailing block in front of the tables and handles a file that starts with a table', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const f = join(dir, 'config.toml');
    writeFileSync(f, '[mcp_servers.x]\ncommand = "npx"\n\n# >>> super-agent-installer >>>\nmcp_oauth_callback_port = 12345\n# <<< super-agent-installer <<<\n');
    expect((await writeTomlMarkerBlock(f, { mcp_oauth_callback_port: 12345 }, join(dir, 'b'))).changed).toBe(true);
    const text = readFileSync(f, 'utf8');
    expect(text).toBe('# >>> super-agent-installer >>>\nmcp_oauth_callback_port = 12345\n# <<< super-agent-installer <<<\n\n[mcp_servers.x]\ncommand = "npx"\n');
    expect((await readToml(f)).mcp_oauth_callback_port).toBe(12345);
    expect((await writeTomlMarkerBlock(f, { mcp_oauth_callback_port: 12345 }, join(dir, 'b'))).changed).toBe(false);
    expect(readFileSync(f, 'utf8')).toBe(text);
    expect((await removeTomlMarkerBlock(f, join(dir, 'b'))).changed).toBe(true);
    expect(readFileSync(f, 'utf8')).toBe('[mcp_servers.x]\ncommand = "npx"\n');
  });
});
