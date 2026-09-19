import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

describe('caveman proxy routing is never left in settings.json (2026-09-19: ANTHROPIC_BASE_URL took Claude Code offline)', () => {
  const wired = { env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787/w/claude', _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1', ENABLE_TOOL_SEARCH: 'auto', MY_OWN: 'keep' }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: "'/h/.caveman/bin/caveman-proxy' native-hook claude --adapter x" }] }] } };

  it('strips the gateway route caveman setup writes, keeps hooks and unrelated env', async () => {
    // caveman 2.7.0's `setup --agent-native claude` bundles routing with the hooks: it writes
    // env.ANTHROPIC_BASE_URL = <gateway>/w/claude plus the first-party flag. With the proxy not running every
    // request went to a dead port and the user could not talk to Claude Code at all; remote control refuses a
    // proxied base URL by design. The approved design is hooks + statusline, proxy OFF.
    const ctx = makeTestCtx({ responses: { 'caveman --version': '2.7.0' } });
    mkdirSync(ctx.paths.claudeConfigDir, { recursive: true });
    ctx.run = (async (argv, opts) => {
      if (argv.join(' ') === 'caveman setup --agent-native claude') { writeFileSync(ctx.paths.claudeSettings, JSON.stringify(wired)); return { code: 0, stdout: '', stderr: '', skipped: false }; }
      return { code: argv[0] === 'caveman' ? 0 : 127, stdout: argv[1] === '--version' ? '2.7.0' : '', stderr: '', skipped: false };
    }) as typeof ctx.run;
    const r = await (await hookProvider.plan(hook('claude'), ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true);
    const s = JSON.parse(readFileSync(ctx.paths.claudeSettings, 'utf8'));
    expect(s.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(s.env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL).toBeUndefined();
    expect(s.env.MY_OWN).toBe('keep');
    expect(s.env.ENABLE_TOOL_SEARCH).toBe('auto'); // not routing: harmless, left alone
    expect(s.hooks.SessionStart).toHaveLength(1);    // the hooks are the point; they stay
    expect(r.message).toMatch(/proxy route removed/);
  });

  it('never touches a base URL the user set themselves', async () => {
    const ctx = makeTestCtx({ responses: { 'caveman --version': '2.7.0', 'caveman setup --agent-native claude': '' } });
    mkdirSync(ctx.paths.claudeConfigDir, { recursive: true });
    writeFileSync(ctx.paths.claudeSettings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://my-corp-gateway.example/v1', _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1' } }));
    await (await hookProvider.plan(hook('claude'), ctx, null, 'install'))[0]!.run(ctx);
    const s = JSON.parse(readFileSync(ctx.paths.claudeSettings, 'utf8'));
    expect(s.env.ANTHROPIC_BASE_URL).toBe('https://my-corp-gateway.example/v1');
    expect(s.env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL).toBe('1');
  });

  it('heals an already-wired settings.json on a re-run even when hooks are already installed', async () => {
    const ctx = makeTestCtx({ responses: { 'caveman --version': '2.7.0' } });
    mkdirSync(ctx.paths.claudeConfigDir, { recursive: true });
    writeFileSync(ctx.paths.claudeSettings, JSON.stringify(wired));
    const acts = await hookProvider.plan(hook('claude'), ctx, { version: null }, 'install');
    expect(acts).toHaveLength(1); expect(acts[0]).toMatchObject({ op: 'configure' });
    await acts[0]!.run(ctx);
    const s = JSON.parse(readFileSync(ctx.paths.claudeSettings, 'utf8'));
    expect(s.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(ctx.calls.some((a) => a.join(' ').includes('setup --agent-native'))).toBe(false); // no needless re-setup
  });
});
