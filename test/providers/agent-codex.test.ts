import { describe, it, expect } from 'vitest';
import { codexAgentProvider } from '../../src/providers/agent-codex.js';
import { agentProvider } from '../../src/providers/agent.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const comp: Component = { id: 'codex-cli', name: 'Codex CLI', kind: 'agent', agents: 'codex', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'agent', agent: 'codex' } };
const fetchLatest = (tag: string) => (async () => new Response(JSON.stringify({ tag_name: tag }))) as unknown as typeof fetch;
describe('codexAgentProvider', () => {
  it('installs via the standalone installer non-interactively and removes an npm conflict first', async () => {
    const ctx = makeTestCtx({ fetch: fetchLatest('rust-v0.154.0'), responses: { 'npm ls -g @openai/codex --depth=0 --json': JSON.stringify({ dependencies: { '@openai/codex': { version: '0.150.0' } } }), 'npm uninstall -g @openai/codex': '', 'codex sandbox -- /bin/true': '' } });
    const acts = await codexAgentProvider.plan(comp, ctx, null, 'install'); const r = await acts[0]!.run(ctx);
    expect(r.ok).toBe(true);
    expect(ctx.calls).toContainEqual(['npm', 'uninstall', '-g', '@openai/codex']);
    const sh = ctx.calls.find((a) => a[0] === 'sh'); expect(sh?.[2]).toBe('curl -fsSL https://chatgpt.com/codex/install.sh | sh');
  });
  it('warns when the sandbox probe fails inside LXC', async () => {
    const ctx = makeTestCtx({ host: { isLxc: true }, fetch: fetchLatest('rust-v0.154.0'), responses: { 'npm ls -g @openai/codex --depth=0 --json': '{}', 'codex sandbox -- /bin/true': { code: 1, stderr: 'bwrap: No permissions to create a new namespace' } } });
    const r = await (await codexAgentProvider.plan(comp, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true); expect(r.message).toMatch(/nesting=1/);
  });
  it('updates with codex update and falls back to the installer when detection fails', async () => {
    const ctx = makeTestCtx({ fetch: fetchLatest('rust-v0.155.0'), responses: { 'codex update': { code: 1, stderr: 'Could not detect the Codex installation method' } } });
    const acts = await codexAgentProvider.plan(comp, ctx, { version: '0.154.0' }, 'update'); const r = await acts[0]!.run(ctx);
    expect(r.ok).toBe(true); expect(ctx.calls.some((a) => a.join(' ').includes('install.sh'))).toBe(true);
  });
  it('uses brew on macOS and powershell on windows', async () => {
    const mac = makeTestCtx({ host: { platform: 'darwin', pkgManager: 'brew' }, fetch: fetchLatest('rust-v0.154.0'), responses: { 'npm ls -g @openai/codex --depth=0 --json': '{}', 'brew install --cask codex': '' } });
    await (await codexAgentProvider.plan(comp, mac, null, 'install'))[0]!.run(mac); expect(mac.calls).toContainEqual(['brew', 'install', '--cask', 'codex']);
    const win = makeTestCtx({ host: { platform: 'windows', pkgManager: 'winget' }, fetch: fetchLatest('rust-v0.154.0'), responses: { 'npm ls -g @openai/codex --depth=0 --json': '{}' } });
    await (await codexAgentProvider.plan(comp, win, null, 'install'))[0]!.run(win); expect(win.calls.find((a) => a[0] === 'powershell.exe')?.join(' ')).toContain('CODEX_NON_INTERACTIVE=1');
  });
  it('agentProvider dispatches by spec.agent', async () => { const ctx = makeTestCtx({ responses: { 'codex --version': 'codex-cli 0.154.0' } }); expect(await agentProvider.detect(comp, ctx)).toEqual({ version: '0.154.0' }); });
});
