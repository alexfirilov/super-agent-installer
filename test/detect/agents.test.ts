import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectClaude, detectCodex } from '../../src/detect/agents.js';
import { makeTestCtx } from '../helpers/ctx.js';
describe('detectClaude', () => {
  it('parses plugin list, marketplaces, mcp and settings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); mkdirSync(join(dir, 'plugins'), { recursive: true });
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'a@m': true }, statusLine: { type: 'command', command: 'x' } }));
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { fli: { type: 'stdio', command: 'fli-mcp' } } }));
    writeFileSync(join(dir, 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'claude-plugins-official': {}, caveman: {} }));
    const ctx = makeTestCtx({ env: { CLAUDE_CONFIG_DIR: dir }, responses: { 'claude --version': '2.1.274 (Claude Code)', 'claude plugin list --json': JSON.stringify([{ id: 'superpowers@claude-plugins-official', version: '6.3.0', scope: 'user', enabled: true }]) } });
    const s = await detectClaude(ctx);
    expect(s).toMatchObject({ installed: true, version: '2.1.274', marketplaces: ['claude-plugins-official', 'caveman'] });
    expect(s.plugins[0]).toMatchObject({ id: 'superpowers@claude-plugins-official', version: '6.3.0' });
    expect(s.mcp).toHaveProperty('fli'); expect(s.settings).toHaveProperty('statusLine');
  });
  it('reports not installed when claude is missing', async () => {
    const ctx = makeTestCtx({ responses: {} });
    expect((await detectClaude(ctx)).installed).toBe(false);
  });
});
describe('detectCodex', () => {
  it('parses config.toml, plugin list and mcp list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-'));
    writeFileSync(join(dir, 'config.toml'), 'model = "gpt-5.6-sol"\n[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]\n[marketplaces.caveman]\nsource_type = "git"\n');
    const ctx = makeTestCtx({ env: { CODEX_HOME: dir }, responses: { 'codex --version': 'codex-cli 0.154.0', 'codex plugin list --json': JSON.stringify({ installed: [{ pluginId: 'superpowers@openai-curated-remote', version: '6.3.0' }], available: [] }), 'codex mcp list --json': JSON.stringify([{ name: 'context7', transport: { type: 'stdio', command: 'npx' } }]) } });
    const s = await detectCodex(ctx);
    expect(s).toMatchObject({ installed: true, version: '0.154.0', marketplaces: ['caveman'] });
    expect(s.plugins[0]).toMatchObject({ id: 'superpowers@openai-curated-remote', version: '6.3.0' });
    expect(s.mcp.context7).toMatchObject({ command: 'npx' }); expect(s.config.model).toBe('gpt-5.6-sol');
  });
});
