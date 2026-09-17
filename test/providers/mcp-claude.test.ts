import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { mcpClaudeProvider, desiredClaudeMcp } from '../../src/providers/mcp-claude.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const mcp = (spec: Partial<Extract<Component['spec'], { kind: 'mcp' }>>, secrets?: Component['secrets']): Component => ({ id: `mcp-${spec.name}`, name: spec.name ?? 'x', kind: 'mcp', agents: 'claude', platforms: ['linux', 'windows'], description: '', verdict: 'optional', defaultSelected: false, secrets, spec: { kind: 'mcp', target: 'claude', name: 'x', transport: 'http', ...spec } });
function ctxWith(existing: Record<string, unknown>, extra: Record<string, string> = {}, host = {}, env: Record<string, string> = {}) { const ctx = makeTestCtx({ host, env, responses: { 'claude --version': '2.1.274 (Claude Code)', 'claude plugin list --json': '[]', ...extra } }); writeFileSync(ctx.paths.claudeJson, JSON.stringify({ mcpServers: existing })); return ctx; }
describe('mcpClaudeProvider', () => {
  it('builds desired json with env references and windows cmd wrapping', () => {
    expect(desiredClaudeMcp({ kind: 'mcp', target: 'claude', name: 'gh', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', bearerEnv: 'GITHUB_PAT' }, 'linux')).toEqual({ type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_PAT}' } });
    expect(desiredClaudeMcp({ kind: 'mcp', target: 'claude', name: 'k8s', transport: 'stdio', command: 'npx', args: ['-y', 'kubernetes-mcp-server@latest', '--read-only'] }, 'windows')).toEqual({ type: 'stdio', command: 'cmd', args: ['/c', 'npx', '-y', 'kubernetes-mcp-server@latest', '--read-only'] });
    expect(desiredClaudeMcp({ kind: 'mcp', target: 'claude', name: 'p', transport: 'stdio', command: 'uvx', args: ['proxmox-mcp-plus'], secretEnv: ['PROXMOX_TOKEN_VALUE'], env: { PROXMOX_HOST: 'pve' } }, 'linux')).toEqual({ type: 'stdio', command: 'uvx', args: ['proxmox-mcp-plus'], env: { PROXMOX_HOST: 'pve', PROXMOX_TOKEN_VALUE: '${PROXMOX_TOKEN_VALUE}' } });
  });
  it('installs with remove-then-add-json and skips when identical', async () => {
    const c = mcp({ name: 'exa', url: 'https://mcp.exa.ai/mcp' });
    const ctx = ctxWith({}, { 'claude mcp remove -s user exa': '', 'claude mcp add-json exa {"type":"http","url":"https://mcp.exa.ai/mcp"} -s user': '' });
    const acts = await mcpClaudeProvider.plan(c, ctx, await mcpClaudeProvider.detect(c, ctx), 'install'); expect(acts[0]).toMatchObject({ op: 'install' }); expect((await acts[0]!.run(ctx)).ok).toBe(true);
    expect(ctx.calls).toContainEqual(['claude', 'mcp', 'remove', '-s', 'user', 'exa']);
    const same = ctxWith({ exa: { type: 'http', url: 'https://mcp.exa.ai/mcp' } });
    expect(await mcpClaudeProvider.plan(c, same, await mcpClaudeProvider.detect(c, same), 'install')).toEqual([]);
    const diff = ctxWith({ exa: { type: 'http', url: 'https://old' } }, { 'claude mcp remove -s user exa': '', 'claude mcp add-json exa {"type":"http","url":"https://mcp.exa.ai/mcp"} -s user': '' });
    expect((await mcpClaudeProvider.plan(c, diff, await mcpClaudeProvider.detect(c, diff), 'update'))[0]).toMatchObject({ op: 'configure' });
  });
  it('warns about unset secret env vars but still installs', async () => {
    const c = mcp({ name: 'gh', url: 'https://api.githubcopilot.com/mcp/', bearerEnv: 'GITHUB_PAT', secretEnv: ['GITHUB_PAT'] }, [{ env: 'GITHUB_PAT', prompt: 'GitHub PAT', required: false }]);
    const ctx = ctxWith({}, { 'claude mcp remove -s user gh': '', 'claude mcp add-json gh {"type":"http","url":"https://api.githubcopilot.com/mcp/","headers":{"Authorization":"Bearer ${GITHUB_PAT}"}} -s user': '' });
    const r = await (await mcpClaudeProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx); expect(r.ok).toBe(true); expect(r.message).toMatch(/export GITHUB_PAT=/);
  });
  it('uninstalls', async () => { const c = mcp({ name: 'exa', url: 'https://x' }); const ctx = ctxWith({ exa: {} }, { 'claude mcp remove -s user exa': '' }); await (await mcpClaudeProvider.plan(c, ctx, { version: null }, 'uninstall'))[0]!.run(ctx); expect(ctx.calls).toContainEqual(['claude', 'mcp', 'remove', '-s', 'user', 'exa']); });
  it('substitutes non-secret ${VAR} placeholders from ctx.env / ctx.secrets like Codex does, and leaves secret ones as references', async () => {
    const c = mcp({ name: 'ha', url: '${HA_URL}/api/mcp', bearerEnv: 'HA_TOKEN', secretEnv: ['HA_TOKEN'] });
    const ctx = ctxWith({}, { 'claude mcp remove -s user ha': '', 'claude mcp add-json ha {"type":"http","url":"https://ha.lan:8123/api/mcp","headers":{"Authorization":"Bearer ${HA_TOKEN}"}} -s user': '' }, {}, { HA_URL: 'https://ha.lan:8123' });
    const r = await (await mcpClaudeProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx); expect(r.ok).toBe(true);
    expect(ctx.calls).toContainEqual(['claude', 'mcp', 'add-json', 'ha', '{"type":"http","url":"https://ha.lan:8123/api/mcp","headers":{"Authorization":"Bearer ${HA_TOKEN}"}}', '-s', 'user']);
    const typed = ctxWith({ ha: { type: 'http', url: 'https://typed.lan/api/mcp', headers: { Authorization: 'Bearer ${HA_TOKEN}' } } }); typed.secrets.set('HA_URL', 'https://typed.lan');
    expect(await mcpClaudeProvider.plan(c, typed, await mcpClaudeProvider.detect(c, typed), 'install')).toEqual([]); // identical after substitution -> nothing to do
    const stdio = mcp({ name: 'p', transport: 'stdio', command: 'uvx', args: ['x', '--host', '${PROXMOX_HOST}'], env: { PROXMOX_USER: '${PVE_USER}' }, secretEnv: ['PROXMOX_TOKEN'] });
    const sctx = ctxWith({}, {}, {}, { PROXMOX_HOST: 'pve.lan', PVE_USER: 'root@pam' });
    const acts = await mcpClaudeProvider.plan(stdio, sctx, null, 'install'); await acts[0]!.run(sctx);
    expect(sctx.calls.find((a) => a[2] === 'add-json')?.[4]).toBe('{"type":"stdio","command":"uvx","args":["x","--host","pve.lan"],"env":{"PROXMOX_USER":"root@pam","PROXMOX_TOKEN":"${PROXMOX_TOKEN}"}}');
  });
  it('fails the action (does not throw at plan time) when a non-secret ${VAR} is unresolved', async () => {
    const c = mcp({ name: 'ha', url: '${HA_URL}/api/mcp' });
    const ctx = ctxWith({});
    const acts = await mcpClaudeProvider.plan(c, ctx, null, 'install'); expect(acts).toHaveLength(1);
    const r = await acts[0]!.run(ctx); expect(r.ok).toBe(false); expect(r.message).toMatch(/HA_URL is not set/);
    expect(ctx.calls.some((a) => a[1] === 'mcp' && a[2] === 'add-json')).toBe(false);
  });
});
