import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { mcpCodexProvider, desiredCodexMcp } from '../../src/providers/mcp-codex.js';
import { mcpProvider } from '../../src/providers/mcp.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const mcp = (spec: Partial<Extract<Component['spec'], { kind: 'mcp' }>>): Component => ({ id: `mcp-cx-${spec.name}`, name: spec.name ?? 'x', kind: 'mcp', agents: 'codex', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: false, spec: { kind: 'mcp', target: 'codex', name: 'x', transport: 'http', ...spec } });
function ctxWith(toml: string, extra: Record<string, string> = {}, env: Record<string, string> = {}) { const ctx = makeTestCtx({ env, responses: { 'codex --version': 'codex-cli 0.154.0', 'codex plugin list --json': '{"installed":[]}', 'codex mcp list --json': '[]', ...extra } }); mkdirSync(ctx.paths.codexHome, { recursive: true }); writeFileSync(ctx.paths.codexConfig, toml); return ctx; }
describe('mcpCodexProvider', () => {
  it('builds desired tables', () => {
    expect(desiredCodexMcp({ kind: 'mcp', target: 'codex', name: 'gh', transport: 'http', url: 'https://api.githubcopilot.com/mcp/readonly', bearerEnv: 'GITHUB_PAT_TOKEN' })).toEqual({ url: 'https://api.githubcopilot.com/mcp/readonly', bearer_token_env_var: 'GITHUB_PAT_TOKEN' });
    expect(desiredCodexMcp({ kind: 'mcp', target: 'codex', name: 'c7', transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], extra: { startup_timeout_sec: 20 } })).toEqual({ command: 'npx', args: ['-y', '@upstash/context7-mcp'], startup_timeout_sec: 20 });
  });
  it('adds http servers with bearer env and skips when identical', async () => {
    const c = mcp({ name: 'gh', url: 'https://api.githubcopilot.com/mcp/readonly', bearerEnv: 'GITHUB_PAT_TOKEN' });
    const ctx = ctxWith('', { 'codex mcp add gh --url https://api.githubcopilot.com/mcp/readonly --bearer-token-env-var GITHUB_PAT_TOKEN': '', 'codex mcp get gh --json': '{}' });
    expect((await (await mcpCodexProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx)).ok).toBe(true);
    const same = ctxWith('[mcp_servers.gh]\nurl = "https://api.githubcopilot.com/mcp/readonly"\nbearer_token_env_var = "GITHUB_PAT_TOKEN"\n');
    expect(await mcpCodexProvider.plan(c, same, await mcpCodexProvider.detect(c, same), 'install')).toEqual([]);
  });
  it('adds stdio servers with --env and -- separator, then patches extra keys into a comment-free file', async () => {
    const c = mcp({ name: 'c7', transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], env: { A: '1' }, extra: { startup_timeout_sec: 20 } });
    const ctx = ctxWith('model = "gpt-5.6-sol"\n', { 'codex mcp add c7 --env A=1 -- npx -y @upstash/context7-mcp': '', 'codex mcp get c7 --json': '{}' });
    const r = await (await mcpCodexProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx); expect(r.ok).toBe(true);
    expect(ctx.calls).toContainEqual(['codex', 'mcp', 'add', 'c7', '--env', 'A=1', '--', 'npx', '-y', '@upstash/context7-mcp']);
    expect(readFileSync(ctx.paths.codexConfig, 'utf8')).toContain('startup_timeout_sec = 20');
  });
  it('does not rewrite a commented file; prints manual lines instead', async () => {
    const c = mcp({ name: 'c7', transport: 'stdio', command: 'npx', args: ['x'], extra: { startup_timeout_sec: 20 } });
    const ctx = ctxWith('# my comment\nmodel = "gpt-5.6-sol"\n', { 'codex mcp add c7 -- npx x': '', 'codex mcp get c7 --json': '{}' });
    const r = await (await mcpCodexProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true); expect(r.message).toMatch(/startup_timeout_sec = 20/); expect(readFileSync(ctx.paths.codexConfig, 'utf8')).toContain('# my comment');
  });
  it('removes on uninstall and mcpProvider dispatches by target', async () => {
    const c = mcp({ name: 'gh', url: 'https://x' }); const ctx = ctxWith('[mcp_servers.gh]\nurl = "https://x"\n', { 'codex mcp remove gh': '' });
    await (await mcpProvider.plan(c, ctx, await mcpProvider.detect(c, ctx), 'uninstall'))[0]!.run(ctx); expect(ctx.calls).toContainEqual(['codex', 'mcp', 'remove', 'gh']);
  });
  it('substitutes ${VAR} placeholders in url from ctx.env for non-secret vars', async () => {
    const c = mcp({ name: 'ha', url: '${HA_URL}/api/mcp' });
    const ctx = ctxWith('', { 'codex mcp add ha --url https://ha.lan:8123/api/mcp': '', 'codex mcp get ha --json': '{}' }, { HA_URL: 'https://ha.lan:8123' });
    const r = await (await mcpCodexProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true);
    expect(ctx.calls).toContainEqual(['codex', 'mcp', 'add', 'ha', '--url', 'https://ha.lan:8123/api/mcp']);
  });
  it('fails when a non-secret ${VAR} placeholder cannot be resolved', async () => {
    const c = mcp({ name: 'ha', url: '${HA_URL}/api/mcp' });
    const ctx = ctxWith('', {});
    const r = await (await mcpCodexProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/HA_URL/);
  });
  it('treats our own marker lines as not-a-comment when deciding whether the file can be rewritten (I3)', async () => {
    const c = mcp({ name: 'c7', transport: 'stdio', command: 'npx', args: ['x'], extra: { startup_timeout_sec: 20 } });
    const ctx = ctxWith('model = "gpt-5.6-sol"\n\n# >>> super-agent-installer >>>\n[features]\nmemories = true\n# <<< super-agent-installer <<<\n', { 'codex mcp add c7 -- npx x': '', 'codex mcp get c7 --json': '{}' });
    const r = await (await mcpCodexProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true); expect(r.message).not.toMatch(/has comments/);
    const text = readFileSync(ctx.paths.codexConfig, 'utf8'); expect(text).toContain('startup_timeout_sec = 20');
    expect(text).toMatch(/# >>> super-agent-installer >>>\n\[features\]\nmemories = true\n# <<< super-agent-installer <<</); // block kept verbatim, before the tables
    expect(text.indexOf('# <<< super-agent-installer <<<')).toBeLessThan(text.indexOf('[mcp_servers.c7]'));
  });
  it('warns about a missing bearer env only when the component declares secrets', async () => {
    const quiet = mcp({ name: 'c7', url: 'https://mcp.context7.com/mcp' });
    const ctx = ctxWith('', { 'codex mcp add c7 --url https://mcp.context7.com/mcp': '', 'codex mcp get c7 --json': '{}' });
    await (await mcpCodexProvider.plan(quiet, ctx, null, 'install'))[0]!.run(ctx); expect(ctx.log.lines.some((l) => /no bearer env var/.test(l))).toBe(false);
    const loud = { ...mcp({ name: 'gh', url: 'https://api.githubcopilot.com/mcp/' }), secrets: [{ env: 'GITHUB_PAT_TOKEN', prompt: 'PAT', required: false }] };
    const lctx = ctxWith('', { 'codex mcp add gh --url https://api.githubcopilot.com/mcp/': '', 'codex mcp get gh --json': '{}' });
    await (await mcpCodexProvider.plan(loud, lctx, null, 'install'))[0]!.run(lctx); expect(lctx.log.lines.some((l) => /no bearer env var/.test(l))).toBe(true);
  });
});
