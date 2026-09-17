import { describe, it, expect } from 'vitest';
import { claudeAgentProvider } from '../../src/providers/agent-claude.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const comp: Component = { id: 'claude-code', name: 'Claude Code', kind: 'agent', agents: 'claude', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'agent', agent: 'claude' } };
const fetchLatest = (v: string) => (async () => new Response(v)) as unknown as typeof fetch;
describe('claudeAgentProvider', () => {
  it('detects version', async () => {
    const ctx = makeTestCtx({ responses: { 'claude --version': '2.1.274 (Claude Code)' } });
    expect(await claudeAgentProvider.detect(comp, ctx)).toEqual({ version: '2.1.274' });
  });
  it('plans native install on linux desktop with channel', async () => {
    const ctx = makeTestCtx({ fetch: fetchLatest('2.1.274') });
    const acts = await claudeAgentProvider.plan(comp, ctx, null, 'install');
    expect(acts[0]).toMatchObject({ op: 'install', to: '2.1.274' });
    await acts[0]!.run(ctx);
    expect(ctx.calls.some((a) => a.join(' ').includes('curl -fsSL https://claude.ai/install.sh | bash -s latest'))).toBe(true);
  });
  it('uses the apt repo on a Proxmox host as root', async () => {
    const ctx = makeTestCtx({ host: { isProxmoxHost: true, isRoot: true, pkgManager: 'apt' }, fetch: fetchLatest('2.1.274'), responses: { 'apt-get update': '', 'apt-get install -y claude-code': '' } });
    const acts = await claudeAgentProvider.plan(comp, ctx, null, 'install'); await acts[0]!.run(ctx);
    expect(ctx.calls.some((a) => a.includes('apt-get') && a.includes('claude-code'))).toBe(true);
    expect(ctx.calls.some((a) => a.join(' ').includes('install.sh'))).toBe(false);
  });
  it('fails early without AVX on linux', async () => {
    const ctx = makeTestCtx({ host: { hasAvx: false }, fetch: fetchLatest('2.1.274') });
    const acts = await claudeAgentProvider.plan(comp, ctx, null, 'install'); const r = await acts[0]!.run(ctx);
    expect(r.ok).toBe(false); expect(r.message).toMatch(/AVX/);
  });
  it('plans update only when newer and not while claude is running', async () => {
    const ctx = makeTestCtx({ fetch: fetchLatest('2.1.274'), responses: { 'claude update': 'Successfully updated' } });
    const acts = await claudeAgentProvider.plan(comp, ctx, { version: '2.1.273' }, 'update');
    expect(acts[0]).toMatchObject({ op: 'update', from: '2.1.273', to: '2.1.274' });
    expect(await claudeAgentProvider.plan(comp, ctx, { version: '2.1.274' }, 'update')).toEqual([]);
    const busy = makeTestCtx({ host: { claudeRunning: true }, fetch: fetchLatest('2.1.274') });
    const r = await (await claudeAgentProvider.plan(comp, busy, { version: '2.1.273' }, 'update'))[0]!.run(busy);
    expect(r.ok).toBe(false); expect(r.message).toMatch(/running/);
  });
  it('plans windows install through powershell with -UseBasicParsing', async () => {
    const ctx = makeTestCtx({ host: { platform: 'windows', pkgManager: 'winget' }, fetch: fetchLatest('2.1.274') });
    const acts = await claudeAgentProvider.plan(comp, ctx, null, 'install'); await acts[0]!.run(ctx);
    const ps = ctx.calls.find((a) => a[0] === 'powershell.exe'); expect(ps?.join(' ')).toContain('-UseBasicParsing https://claude.ai/install.ps1'); expect(ps?.join(' ')).toContain(') latest');
  });
});
