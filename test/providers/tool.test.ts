import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolProvider } from '../../src/providers/tool.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const tool = (id: string, spec: Partial<Extract<Component['spec'], { kind: 'tool' }>>): Component => ({ id, name: id, kind: 'tool', agents: 'both', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'tool', probe: [id, '--version'], packages: {}, ...spec } });
describe('toolProvider', () => {
  it('installs via apt with sudo for a non-root user', async () => {
    const ctx = makeTestCtx({ responses: { 'sudo apt-get install -y jq': '' } });
    const r = await (await toolProvider.plan(tool('jq', { packages: { apt: 'jq', winget: 'jqlang.jq' } }), ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true); expect(ctx.calls).toContainEqual(['sudo', 'apt-get', 'install', '-y', 'jq']);
    // apt lists may be empty/stale on a fresh host (docker matrix: "Unable to locate package git"): refresh once per run, before the first install
    expect(ctx.calls.findIndex((a) => a.join(' ') === 'sudo apt-get update')).toBeLessThan(ctx.calls.findIndex((a) => a.join(' ') === 'sudo apt-get install -y jq'));
    await (await toolProvider.plan(tool('git', { packages: { apt: 'git' } }), ctx, null, 'install'))[0]!.run(ctx);
    expect(ctx.calls.filter((a) => a.join(' ') === 'sudo apt-get update')).toHaveLength(1);
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
    const responses: Record<string, string> = { 'npm install -g @caveman-ai/cli@1.3.4': '', 'caveman --version': '' };
    const ctx = makeTestCtx({ responses }); responses['npm config get prefix'] = join(ctx.host.home, '.local'); // not created yet, but its parent (home) is writable
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
    // distro-pinned route (root + apk): the repo node is what we can get; do not re-plan an update on every run (docker matrix: alpine 3.21 ships 22)
    const apk = makeTestCtx({ host: { isRoot: true, hasSudo: false, pkgManager: 'apk', isMusl: true } });
    expect(await toolProvider.plan(tool('node', { strategy: 'node' }), apk, { version: '22.23.2' }, 'update')).toEqual([]);
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
  it('uninstalls npm packages by stripping the version suffix', async () => {
    const ctx = makeTestCtx({ responses: { 'npm uninstall -g @caveman-ai/cli': '' } });
    const c = tool('caveman-cli', { probe: ['caveman', '--version'], packages: { npm: '@caveman-ai/cli@1.3.4' } });
    const r = await (await toolProvider.plan(c, ctx, { version: '1.3.4' }, 'uninstall'))[0]!.run(ctx);
    expect(r.ok).toBe(true);
    expect(ctx.calls).toContainEqual(['npm', 'uninstall', '-g', '@caveman-ai/cli']);
  });
  it('uninstalls apt packages with sudo for a non-root user', async () => {
    const ctx = makeTestCtx({ responses: { 'sudo apt-get remove -y jq': '' } });
    const c = tool('jq', { packages: { apt: 'jq' } });
    const r = await (await toolProvider.plan(c, ctx, { version: '1.0' }, 'uninstall'))[0]!.run(ctx);
    expect(r.ok).toBe(true);
    expect(ctx.calls).toContainEqual(['sudo', 'apt-get', 'remove', '-y', 'jq']);
  });
  it('uninstalls via winget on windows', async () => {
    const ctx = makeTestCtx({ host: { platform: 'windows', pkgManager: 'winget' }, responses: { 'winget uninstall --id jqlang.jq --silent': '' } });
    const c = tool('jq', { packages: { winget: 'jqlang.jq' } });
    const r = await (await toolProvider.plan(c, ctx, { version: '1.0' }, 'uninstall'))[0]!.run(ctx);
    expect(r.ok).toBe(true);
    expect(ctx.calls).toContainEqual(['winget', 'uninstall', '--id', 'jqlang.jq', '--silent']);
  });
  it('reports an apt update that could not move the version as unchanged, naming the distro ceiling (found by real-host apply: jq 1.8.1 and gh 2.46.0 are the apt candidates)', async () => {
    const c = tool('jq', { probe: ['jq', '--version'], versionRegex: 'jq-(\\d+\\.\\d+(?:\\.\\d+)?)', packages: { apt: 'jq' }, latest: { github: 'jqlang/jq' } });
    const ctx = makeTestCtx({ fetch: (async () => new Response('', { status: 302, headers: { location: 'https://github.com/jqlang/jq/releases/tag/jq-1.8.2' } })) as unknown as typeof fetch, responses: { 'jq --version': 'jq-1.8.1', 'sudo -n apt-get install -y jq': '', 'sudo -n apt-get update': '' } });
    const acts = await toolProvider.plan(c, ctx, { version: '1.8.1' }, 'update');
    const r = await acts[0]!.run(ctx);
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(r.message).toMatch(/1\.8\.1/); expect(r.message).toMatch(/1\.8\.2/);
    expect(r.message).not.toMatch(/\bjq updated\b/);
  });
  it('still reports changed when the version actually moves', async () => {
    const c = tool('jq', { probe: ['jq', '--version'], versionRegex: 'jq-(\\d+\\.\\d+(?:\\.\\d+)?)', packages: { apt: 'jq' }, latest: { github: 'jqlang/jq' } });
    const ctx = makeTestCtx({ fetch: (async () => new Response('', { status: 302, headers: { location: 'https://github.com/jqlang/jq/releases/tag/jq-1.8.2' } })) as unknown as typeof fetch, responses: { 'jq --version': 'jq-1.8.2', 'sudo -n apt-get install -y jq': '', 'sudo -n apt-get update': '' } });
    const r = await (await toolProvider.plan(c, ctx, { version: '1.8.1' }, 'update'))[0]!.run(ctx);
    expect(r).toMatchObject({ ok: true, changed: true }); expect(r.message).toMatch(/updated/);
  });
  it('go install without an @version appends @latest', async () => {
    const ctx = makeTestCtx();
    const c = tool('gopls', { probe: ['gopls', 'version'], packages: { go: 'golang.org/x/tools/gopls' } });
    await (await toolProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(ctx.calls).toContainEqual(['go', 'install', 'golang.org/x/tools/gopls@latest']);
  });
  it('go install tells the user where the binary went so the LSP plugin can find it (found by real-host apply: ~/go/bin is not on PATH)', async () => {
    const ctx = makeTestCtx({ responses: { 'go env GOPATH': '/home/u/go' } });
    const c = tool('gopls', { probe: ['gopls', 'version'], packages: { go: 'golang.org/x/tools/gopls' } });
    const r = await (await toolProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true); expect(r.message).toMatch(/\/home\/u\/go\/bin/); expect(r.message).toMatch(/PATH/);
  });
  it('go uninstall removes the binary from GOPATH/bin', async () => {
    const gopath = mkdtempSync(join(tmpdir(), 'sai-gopath-'));
    mkdirSync(join(gopath, 'bin'), { recursive: true });
    const binPath = join(gopath, 'bin', 'gopls');
    writeFileSync(binPath, '');
    const ctx = makeTestCtx({ responses: { 'go env GOPATH': gopath } });
    const c = tool('gopls', { probe: ['gopls', 'version'], packages: { go: 'golang.org/x/tools/gopls' } });
    const r = await (await toolProvider.plan(c, ctx, { version: '1.0' }, 'uninstall'))[0]!.run(ctx);
    expect(r.ok).toBe(true);
    expect(existsSync(binPath)).toBe(false);
  });
  it('installs via packages.script.linux using sh -c', async () => {
    const ctx = makeTestCtx({ responses: { 'sh -c echo hi': '' } });
    const c = tool('custom-tool', { packages: { script: { linux: 'echo hi' } } });
    const r = await (await toolProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true);
    expect(ctx.calls).toContainEqual(['sh', '-c', 'echo hi']);
  });
  it('installs with --prefix ~/.local when the npm global prefix is not writable (no persistent npm config), and plainly when it is (I8)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-npm-'));
    const unwritable = join(dir, 'notadir'); writeFileSync(unwritable, ''); // <prefix>/lib/node_modules cannot exist under a file -> not writable
    const ctx = makeTestCtx({ responses: { 'npm config get prefix': unwritable } });
    const c = tool('some-tool', { probe: ['some-tool', '--version'], packages: { npm: 'some-pkg' } });
    const r = await (await toolProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true);
    expect(ctx.calls.some((a) => a.join(' ').startsWith('npm config set'))).toBe(false);
    expect(ctx.calls).toContainEqual(['npm', 'install', '-g', '--prefix', join(ctx.host.home, '.local'), 'some-pkg']);
    expect(ctx.log.lines.some((l) => /\.local\/bin/.test(l) && /PATH/.test(l))).toBe(true);
    const writable = join(dir, 'prefix'); mkdirSync(join(writable, 'lib', 'node_modules'), { recursive: true });
    const wctx = makeTestCtx({ responses: { 'npm config get prefix': writable } });
    expect((await (await toolProvider.plan(c, wctx, null, 'install'))[0]!.run(wctx)).ok).toBe(true);
    expect(wctx.calls).toContainEqual(['npm', 'install', '-g', 'some-pkg']);
    const missing = join(dir, 'fresh'); mkdirSync(missing); // prefix exists and is writable but lib/node_modules does not exist yet
    const mctx = makeTestCtx({ responses: { 'npm config get prefix': missing } });
    await (await toolProvider.plan(c, mctx, null, 'install'))[0]!.run(mctx);
    expect(mctx.calls).toContainEqual(['npm', 'install', '-g', 'some-pkg']);
  });
  it('uninstalls npm packages from the ~/.local prefix too when they live there', async () => {
    const ctx = makeTestCtx(); mkdirSync(join(ctx.host.home, '.local', 'lib', 'node_modules', '@caveman-ai', 'cli'), { recursive: true });
    const c = tool('caveman-cli', { probe: ['caveman', '--version'], packages: { npm: '@caveman-ai/cli@1.3.4' } });
    await (await toolProvider.plan(c, ctx, { version: '1' }, 'uninstall'))[0]!.run(ctx);
    expect(ctx.calls).toContainEqual(['npm', 'uninstall', '-g', '@caveman-ai/cli']);
    expect(ctx.calls).toContainEqual(['npm', 'uninstall', '-g', '--prefix', join(ctx.host.home, '.local'), '@caveman-ai/cli']);
  });
});
