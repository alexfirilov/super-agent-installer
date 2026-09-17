import { describe, it, expect } from 'vitest';
import { detectAuth, ensureAuth, isHeadless } from '../../src/auth/agents.js';
import { makeTestCtx } from '../helpers/ctx.js';

describe('isHeadless', () => {
  it('is never headless on windows or macOS', () => {
    expect(isHeadless(makeTestCtx({ host: { platform: 'windows' }, env: {} }))).toBe(false);
    expect(isHeadless(makeTestCtx({ host: { platform: 'darwin' }, env: {} }))).toBe(false);
  });
  it('is headless on linux with no DISPLAY/WAYLAND_DISPLAY', () => {
    expect(isHeadless(makeTestCtx({ host: { platform: 'linux' }, env: {} }))).toBe(true);
  });
  it('is not headless on linux with a DISPLAY or WAYLAND_DISPLAY', () => {
    expect(isHeadless(makeTestCtx({ host: { platform: 'linux' }, env: { DISPLAY: ':0' } }))).toBe(false);
    expect(isHeadless(makeTestCtx({ host: { platform: 'linux' }, env: { WAYLAND_DISPLAY: 'wayland-0' } }))).toBe(false);
  });
  it('is headless over SSH even with a DISPLAY set', () => {
    expect(isHeadless(makeTestCtx({ host: { platform: 'linux' }, env: { DISPLAY: ':0', SSH_CONNECTION: '1.2.3.4 22 5.6.7.8 22' } }))).toBe(true);
  });
  it('is headless inside an unprivileged LXC even with a DISPLAY set', () => {
    expect(isHeadless(makeTestCtx({ host: { platform: 'linux', isLxc: true }, env: { DISPLAY: ':0' } }))).toBe(true);
  });
});

describe('detectAuth', () => {
  it('reports claude authenticated on exit 0 and captures the first line as detail', async () => {
    const ctx = makeTestCtx({ responses: { 'claude auth status': { code: 0, stdout: 'Logged in as demo@example.com\nmore stuff' } } });
    expect(await detectAuth(ctx, 'claude')).toMatchObject({ agent: 'claude', authenticated: true, mode: null, detail: 'Logged in as demo@example.com' });
  });
  it('reports claude not authenticated on nonzero exit', async () => {
    const ctx = makeTestCtx({ responses: { 'claude auth status': { code: 1, stderr: 'Not authenticated' } } });
    expect(await detectAuth(ctx, 'claude')).toMatchObject({ authenticated: false });
  });
  it('detects codex chatgpt mode from status output', async () => {
    const ctx = makeTestCtx({ responses: { 'codex login status': { code: 0, stdout: 'Logged in using ChatGPT (Plus)' } } });
    expect(await detectAuth(ctx, 'codex')).toMatchObject({ agent: 'codex', authenticated: true, mode: 'chatgpt' });
  });
  it('detects codex apikey mode from status output', async () => {
    const ctx = makeTestCtx({ responses: { 'codex login status': { code: 0, stdout: 'Logged in using an API key' } } });
    expect(await detectAuth(ctx, 'codex')).toMatchObject({ agent: 'codex', authenticated: true, mode: 'apikey' });
  });
  it('reports codex not authenticated on nonzero exit with null mode', async () => {
    const ctx = makeTestCtx({ responses: { 'codex login status': { code: 1, stderr: 'Not logged in' } } });
    expect(await detectAuth(ctx, 'codex')).toMatchObject({ authenticated: false, mode: null });
  });
});

describe('ensureAuth', () => {
  it('short-circuits when already authenticated and logs it, without attempting a login', async () => {
    const ctx = makeTestCtx({ responses: { 'claude auth status': { code: 0, stdout: 'Logged in as demo@example.com' } } });
    const [state] = await ensureAuth(ctx, ['claude'], { headless: false });
    expect(state).toMatchObject({ agent: 'claude', authenticated: true });
    expect(ctx.calls).not.toContainEqual(['claude', 'auth', 'login']);
    expect(ctx.log.lines.some((l) => /already signed in/.test(l))).toBe(true);
  });

  it('drives an interactive browser login then re-verifies with detectAuth instead of trusting the login exit code', async () => {
    const responses: Record<string, string | { code: number; stdout?: string; stderr?: string }> = {
      'claude auth status': { code: 1, stderr: 'Not authenticated' },
    };
    const ctx = makeTestCtx({ responses });
    const realRun = ctx.run;
    ctx.run = async (argv, opts) => {
      const r = await realRun(argv, opts);
      if (argv.join(' ') === 'claude auth login') responses['claude auth status'] = { code: 0, stdout: 'Logged in as demo@example.com' };
      return r;
    };
    const [state] = await ensureAuth(ctx, ['claude'], { headless: false });
    expect(state).toMatchObject({ agent: 'claude', authenticated: true });
    expect(ctx.calls).toContainEqual(['claude', 'auth', 'login']);
    const loginCall = ctx.opts.find((o) => o.argv.join(' ') === 'claude auth login');
    expect(loginCall?.opts).toMatchObject({ interactive: true, timeoutMs: 600000 });
    // detectAuth was re-run after the login command (two status probes: before and after)
    expect(ctx.calls.filter((a) => a.join(' ') === 'claude auth status')).toHaveLength(2);
  });

  it('headless claude captures the setup-token into ctx.secrets and ctx.env without logging the token itself', async () => {
    const token = 'sk-ant-oat01-abcdefghijklmnopqrstuvwxyz0123456789';
    const ctx = makeTestCtx({
      responses: {
        'claude auth status': { code: 1, stderr: 'Not authenticated' },
        'claude setup-token': { code: 0, stdout: `Open this URL to authorize:\nhttps://console.anthropic.com/oauth/authorize?x=1\n\n${token}\n` },
      },
    });
    const [state] = await ensureAuth(ctx, ['claude'], { headless: true });
    expect(state).toMatchObject({ agent: 'claude', authenticated: true, mode: 'token' });
    expect(ctx.secrets.get('CLAUDE_CODE_OAUTH_TOKEN')).toBe(token);
    expect(ctx.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(token);
    expect(ctx.calls).not.toContainEqual(['claude', 'auth', 'login']);
    const setupCall = ctx.opts.find((o) => o.argv.join(' ') === 'claude setup-token');
    expect(setupCall?.opts.interactive).toBeFalsy();
    // the token itself must never be logged; only its length or a marker
    expect(ctx.log.lines.some((l) => l.includes(token))).toBe(false);
    expect(ctx.log.lines.some((l) => /captured setup-token/.test(l))).toBe(true);
  });

  it('headless codex uses --device-auth (interactive) then re-verifies with detectAuth', async () => {
    const responses: Record<string, string | { code: number; stdout?: string; stderr?: string }> = {
      'codex login status': { code: 1, stderr: 'Not logged in' },
    };
    const ctx = makeTestCtx({ responses });
    const realRun = ctx.run;
    ctx.run = async (argv, opts) => {
      const r = await realRun(argv, opts);
      if (argv.join(' ') === 'codex login --device-auth') responses['codex login status'] = { code: 0, stdout: 'Logged in using ChatGPT' };
      return r;
    };
    const [state] = await ensureAuth(ctx, ['codex'], { headless: true });
    expect(state).toMatchObject({ agent: 'codex', authenticated: true, mode: 'chatgpt' });
    expect(ctx.calls).toContainEqual(['codex', 'login', '--device-auth']);
    const deviceCall = ctx.opts.find((o) => o.argv.join(' ') === 'codex login --device-auth');
    expect(deviceCall?.opts).toMatchObject({ interactive: true });
    expect(ctx.calls).not.toContainEqual(['codex', 'login']);
  });

  it('warns and reports authenticated:false when the agent is still not signed in afterwards', async () => {
    const ctx = makeTestCtx({ responses: { 'codex login status': { code: 1, stderr: 'Not logged in' } } });
    const [state] = await ensureAuth(ctx, ['codex'], { headless: false });
    expect(state).toMatchObject({ agent: 'codex', authenticated: false });
    expect(ctx.calls).toContainEqual(['codex', 'login']);
    expect(ctx.log.lines.some((l) => /WARN.*not signed in/.test(l))).toBe(true);
  });

  it('signs in multiple agents in order and only the ones asked for', async () => {
    const ctx = makeTestCtx({
      responses: {
        'claude auth status': { code: 0, stdout: 'Logged in as demo@example.com' },
        'codex login status': { code: 0, stdout: 'Logged in using ChatGPT' },
      },
    });
    const states = await ensureAuth(ctx, ['claude', 'codex'], { headless: false });
    expect(states.map((s) => s.agent)).toEqual(['claude', 'codex']);
    expect(states.every((s) => s.authenticated)).toBe(true);
  });
});
