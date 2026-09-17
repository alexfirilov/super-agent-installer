import { describe, it, expect } from 'vitest';
import { toolProvider } from '../../src/providers/tool.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const tool = (id: string, spec: Partial<Extract<Component['spec'], { kind: 'tool' }>>): Component => ({ id, name: id, kind: 'tool', agents: 'both', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'tool', probe: [id, '--version'], packages: {}, ...spec } });
describe('toolProvider', () => {
  it('installs via apt with sudo for a non-root user', async () => {
    const ctx = makeTestCtx({ responses: { 'sudo apt-get install -y jq': '' } });
    const r = await (await toolProvider.plan(tool('jq', { packages: { apt: 'jq', winget: 'jqlang.jq' } }), ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true); expect(ctx.calls).toContainEqual(['sudo', 'apt-get', 'install', '-y', 'jq']);
  });
  it('fails clearly without root or sudo', async () => {
    const ctx = makeTestCtx({ host: { hasSudo: false } });
    const r = await (await toolProvider.plan(tool('jq', { packages: { apt: 'jq' } }), ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(false); expect(r.message).toMatch(/sudo/);
  });
  it('uses winget on windows and npm -g without sudo', async () => {
    const win = makeTestCtx({ host: { platform: 'windows', pkgManager: 'winget' }, responses: { 'winget install --id jqlang.jq --silent --accept-source-agreements --accept-package-agreements': '' } });
    await (await toolProvider.plan(tool('jq', { packages: { apt: 'jq', winget: 'jqlang.jq' } }), win, null, 'install'))[0]!.run(win);
    expect(win.calls[0]?.[0]).toBe('winget');
    const ctx = makeTestCtx({ responses: { 'npm config get prefix': '/home/u/.local', 'npm install -g @caveman-ai/cli@1.3.4': '', 'caveman --version': '' } });
    const c = tool('caveman-cli', { probe: ['caveman', '--version'], packages: { npm: '@caveman-ai/cli@1.3.4' }, postInstall: { linux: [['caveman', '--version']] } });
    await (await toolProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(ctx.calls).toContainEqual(['npm', 'install', '-g', '@caveman-ai/cli@1.3.4']); expect(ctx.calls).toContainEqual(['caveman', '--version']);
  });
  it('node strategy picks NodeSource for root apt and fnm for users', async () => {
    const root = makeTestCtx({ host: { isRoot: true, hasSudo: false }, responses: { 'bash -c curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh && bash /tmp/nodesource_setup.sh && apt-get install -y nodejs': '' } });
    await (await toolProvider.plan(tool('node', { strategy: 'node', probe: ['node', '--version'] }), root, null, 'install'))[0]!.run(root);
    expect(root.calls.some((a) => a.join(' ').includes('nodesource'))).toBe(true);
    const user = makeTestCtx();
    await (await toolProvider.plan(tool('node', { strategy: 'node', probe: ['node', '--version'] }), user, null, 'install'))[0]!.run(user);
    expect(user.calls.some((a) => a.join(' ').includes('fnm.vercel.app'))).toBe(true);
    expect(user.calls.some((a) => a.join(' ').match(/fnm install 24/))).toBe(true);
  });
  it('plans node update when installed major is below 24', async () => {
    const ctx = makeTestCtx();
    const acts = await toolProvider.plan(tool('node', { strategy: 'node' }), ctx, { version: '22.22.1' }, 'update'); expect(acts[0]).toMatchObject({ op: 'update' });
    expect(await toolProvider.plan(tool('node', { strategy: 'node' }), ctx, { version: '24.19.0' }, 'update')).toEqual([]);
  });
  it('updates npm tools when the registry is newer', async () => {
    const f = (async () => new Response(JSON.stringify({ version: '1.3.4' }))) as unknown as typeof fetch;
    const ctx = makeTestCtx({ fetch: f });
    const c = tool('caveman-cli', { probe: ['caveman', '--version'], packages: { npm: '@caveman-ai/cli' }, latest: { npm: '@caveman-ai/cli' } });
    expect((await toolProvider.plan(c, ctx, { version: '1.3.3' }, 'update'))[0]).toMatchObject({ op: 'update', from: '1.3.3', to: '1.3.4' });
    expect(await toolProvider.plan(c, ctx, { version: '1.3.4' }, 'update')).toEqual([]);
  });
  it('spreads multi-package strings into argv for apt and npm as root', async () => {
    const ctx = makeTestCtx({ host: { isRoot: true } });
    await (await toolProvider.plan(tool('bwrap-tools', { packages: { apt: 'bubblewrap socat' } }), ctx, null, 'install'))[0]!.run(ctx);
    expect(ctx.calls).toContainEqual(['apt-get', 'install', '-y', 'bubblewrap', 'socat']);
    const ctx2 = makeTestCtx({ host: { isRoot: true } });
    await (await toolProvider.plan(tool('ts-lsp', { probe: ['typescript-language-server', '--version'], packages: { npm: 'typescript-language-server typescript' } }), ctx2, null, 'install'))[0]!.run(ctx2);
    expect(ctx2.calls).toContainEqual(['npm', 'install', '-g', 'typescript-language-server', 'typescript']);
  });
});
