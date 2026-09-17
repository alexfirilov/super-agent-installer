import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { mcpClaudeProvider, desiredClaudeMcp } from '../../src/providers/mcp-claude.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const mcp = (spec: Partial<Extract<Component['spec'], { kind: 'mcp' }>>, secrets?: Component['secrets']): Component => ({ id: `mcp-${spec.name}`, name: spec.name ?? 'x', kind: 'mcp', agents: 'claude', platforms: ['linux', 'windows'], description: '', verdict: 'optional', defaultSelected: false, secrets, spec: { kind: 'mcp', target: 'claude', name: 'x', transport: 'http', ...spec } });
function ctxWith(existing: Record<string, unknown>, extra: Record<string, string> = {}, host = {}) { const ctx = makeTestCtx({ host, responses: { 'claude --version': '2.1.274 (Claude Code)', 'claude plugin list --json': '[]', ...extra } }); writeFileSync(ctx.paths.claudeJson, JSON.stringify({ mcpServers: existing })); return ctx; }
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
});
