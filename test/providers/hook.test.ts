import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { hookProvider } from '../../src/providers/hook.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const hook = (agent: 'claude' | 'codex'): Component => ({ id: `hook-caveman-${agent}`, name: 'caveman hooks', kind: 'hook', agents: agent, platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'recommended', defaultSelected: agent === 'claude', spec: { kind: 'hook', provider: 'caveman', agent } });
describe('hookProvider', () => {
  it('detects caveman native hooks in settings.json', async () => {
    const ctx = makeTestCtx(); mkdirSync(ctx.paths.claudeConfigDir, { recursive: true });
    writeFileSync(ctx.paths.claudeSettings, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: "'/home/u/.caveman/bin/caveman-proxy' native-hook claude --adapter x" }] }] } }));
    expect(await hookProvider.detect(hook('claude'), ctx)).toEqual({ version: null }); expect(await hookProvider.detect(hook('codex'), ctx)).toBeNull();
  });
  it('runs caveman setup when caveman is present, skips otherwise', async () => {
    const ctx = makeTestCtx({ responses: { 'caveman --version': '1.3.4', 'caveman setup --agent-native claude': '' } });
    await (await hookProvider.plan(hook('claude'), ctx, null, 'install'))[0]!.run(ctx); expect(ctx.calls).toContainEqual(['caveman', 'setup', '--agent-native', 'claude']);
    const none = makeTestCtx({ responses: {} }); expect((await hookProvider.plan(hook('claude'), none, null, 'install'))[0]).toMatchObject({ op: 'skip' });
    const win = makeTestCtx({ host: { platform: 'windows' }, responses: { 'caveman --version': '1.3.4' } }); expect((await hookProvider.plan(hook('codex'), win, null, 'install'))[0]).toMatchObject({ op: 'skip' });
  });
  it('re-runs setup on update and removes on uninstall', async () => {
    const ctx = makeTestCtx({ responses: { 'caveman --version': '1.3.4', 'caveman setup --agent-native claude': '', 'caveman setup --agent-native claude --remove': '' } });
    expect((await hookProvider.plan(hook('claude'), ctx, { version: null }, 'update'))[0]).toMatchObject({ op: 'update' });
    await (await hookProvider.plan(hook('claude'), ctx, { version: null }, 'uninstall'))[0]!.run(ctx); expect(ctx.calls).toContainEqual(['caveman', 'setup', '--agent-native', 'claude', '--remove']);
  });
  it('surfaces a failed uninstall instead of reporting success', async () => {
    const ctx = makeTestCtx({ responses: { 'caveman --version': '1.3.4', 'caveman setup --agent-native claude --remove': { code: 1, stderr: 'boom' } } });
    const r = await (await hookProvider.plan(hook('claude'), ctx, { version: null }, 'uninstall'))[0]!.run(ctx);
    expect(r.ok).toBe(false); expect(r.message).toContain('boom');
  });
});

describe('caveman setup asking for its helper', () => {
  it('runs `caveman setup --install` itself instead of printing it (GCE QA: fresh Rocky 9 host)', async () => {
    let attempts = 0;
    const ctx = makeTestCtx({ responses: { 'caveman --version': '1.3.4' } });
    const realRun = ctx.run;
    ctx.run = async (argv, opts) => {
      if (argv.join(' ') === 'caveman setup --agent-native claude') {
        attempts += 1;
        if (attempts === 1) return { code: 1, stdout: '', stderr: 'caveman-mcp not found; run `caveman setup --install`', skipped: false };
        return { code: 0, stdout: '', stderr: '', skipped: false };
      }
      return realRun(argv, opts);
    };
    const c: Component = { id: 'hook-caveman-claude', name: 'caveman hooks', kind: 'hook', agents: 'claude', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'hook', provider: 'caveman', agent: 'claude' } };
    const r = await (await hookProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true);
    expect(ctx.calls).toContainEqual(['caveman', 'setup', '--install']);
    expect(attempts).toBe(2); // retried after installing the helper
  });
});
