import { describe, it, expect } from 'vitest';
import { detectAuth, ensureAuth, isHeadless } from '../../src/auth/agents.js';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestCtx } from '../helpers/ctx.js';


/** Fakes script(1): answers the probe, and writes `session` to whatever log path the provider chose. */
function fakeScript(ctx: ReturnType<typeof makeTestCtx>, session: string | null): void {
  const real = ctx.run;
  ctx.run = (async (argv, opts) => {
    const key = argv.join(' ');
    if (argv[0] === 'script') {
      ctx.calls.push(argv); ctx.opts.push({ argv, opts: opts ?? {} }); // the recording lives in the real runner we are bypassing
      if (key === 'script --version') return { code: session === null ? 127 : 0, stdout: 'script from util-linux', stderr: '', skipped: false };
      writeFileSync(argv[argv.length - 1]!, session ?? '');
      return { code: 0, stdout: '', stderr: '', skipped: false };
    }
    return real(argv, opts);
  }) as typeof ctx.run;
}

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
    const realStdin = process.stdin.isTTY, realStdout = process.stdout.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true }); // the code gets pasted back on stdin
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const restore = () => { Object.defineProperty(process.stdin, 'isTTY', { value: realStdin, configurable: true }); Object.defineProperty(process.stdout, 'isTTY', { value: realStdout, configurable: true }); };
    const token = 'sk-ant-oat01-abcdefghijklmnopqrstuvwxyz0123456789';
    const ctx = makeTestCtx({
      responses: {
        'claude auth status': { code: 1, stderr: 'Not authenticated' },
      },
    });
    fakeScript(ctx, `Open this URL to authorize:\nhttps://console.anthropic.com/oauth/authorize?x=1\n\n${token}\n`);
    const [state] = await ensureAuth(ctx, ['claude'], { headless: true });
    expect(state).toMatchObject({ agent: 'claude', authenticated: true, mode: 'token' });
    expect(ctx.secrets.get('CLAUDE_CODE_OAUTH_TOKEN')).toBe(token);
    expect(ctx.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(token);
    expect(ctx.calls).not.toContainEqual(['claude', 'auth', 'login']);
    expect(ctx.calls.some((a) => a[0] === 'script')).toBe(true);
    // the token itself must never be logged; only its length or a marker
    expect(ctx.log.lines.some((l) => l.includes(token))).toBe(false);
    expect(ctx.log.lines.some((l) => /captured setup-token/.test(l))).toBe(true);
    restore();
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

describe('claude setup-token with no terminal of our own', () => {
  it('borrows a pty from script(1) so the sign-in URL reaches the user, and reads the token back', async () => {
    // GCE QA on Ubuntu 24.04: with stdout redirected, `claude setup-token` printed NOTHING and hung until the
    // 10-minute timeout -- a silent hang, worse than a clean failure. Under script(1) it prints the URL at once.
    const realIsTTY = process.stdout.isTTY; const realStdin = process.stdin.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true }); // someone is there to paste the code
    try {
      const token = 'sk-ant-oat01-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const session = '\u001b[94mhttps://claude.com/cai/oauth/authorize?code=true\u001b[0m\n' + token + '\n';
      const ctx = makeTestCtx({
        host: { platform: 'linux' },
        responses: {
          'claude auth status': { code: 1 },
          'script --version': 'script from util-linux 2.39.3',
        },
      });
      fakeScript(ctx, session);
      const [state] = await ensureAuth(ctx, ['claude'], { headless: true });
      expect(ctx.calls.some((a) => a[0] === 'script')).toBe(true);
      expect(state!.authenticated).toBe(true);
      expect(ctx.secrets.get('CLAUDE_CODE_OAUTH_TOKEN')).toBe(token); // ANSI stripped off the captured session
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: realIsTTY, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: realStdin, configurable: true });
    }
  });

  it('refuses immediately when no one can paste the code back, instead of hanging until the timeout', async () => {
    // Confirmed on GCE: authorising in the browser yields a code that must be pasted into the CLI. With stdin at
    // /dev/null nobody can, so starting the flow only burns the ten-minute timeout.
    const realStdin = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const ctx = makeTestCtx({ host: { platform: 'linux' }, responses: { 'claude auth status': { code: 1 } } });
      const [state] = await ensureAuth(ctx, ['claude'], { headless: true });
      expect(state!.authenticated).toBe(false);
      expect(ctx.calls.some((a) => a.join(' ').includes('setup-token'))).toBe(false);
      expect(state!.detail).toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: realStdin, configurable: true });
    }
  });

  it('always borrows a pty when one is available, because a captured child never gets a tty either', async () => {
    // run.ts spawns every non-interactive child with ['pipe','pipe','pipe'], so plain capture hands `claude
    // setup-token` a pipe exactly like a redirected stdout does -- and it prints nothing and waits. Gating the pty
    // on OUR stdout being a tty therefore reintroduced the very hang it was meant to fix, on the other branch.
    const realStdout = process.stdout.isTTY, realStdin = process.stdin.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      const token = 'sk-ant-oat01-TTYBRANCHABCDEFGHIJKLMNOP0123456789';
      const ctx = makeTestCtx({
        host: { platform: 'linux' },
        responses: {
          'claude auth status': { code: 1 },
          'script --version': 'script from util-linux 2.39.3',
          [`script -qec stty cols 400 rows 100 2>/dev/null; claude setup-token ${join(tmpdir(), `sai-setup-token-${process.pid}.log`)}`]: { code: 0, writesFile: token + '\n' },
        },
      });
      fakeScript(ctx, token + '\n');
      const [state] = await ensureAuth(ctx, ['claude'], { headless: true });
      expect(ctx.calls.some((a) => a[0] === 'script')).toBe(true);
      expect(ctx.calls.some((a) => a.join(' ') === 'claude setup-token')).toBe(false); // never the blind path
      expect(state!.authenticated).toBe(true);
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: realStdout, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: realStdin, configurable: true });
    }
  });

  it('keeps the captured token out of a world-readable temp file', async () => {
    // writeFile(path,'',{mode:0o600}) does NOT change the mode of a file that already exists, so a pre-created
    // 0666 /tmp/sai-setup-token-<pid>.log would have received the OAuth token at 0666. Verified: mode stays 666.
    const realStdout = process.stdout.isTTY, realStdin = process.stdin.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      const ctx = makeTestCtx({ host: { platform: 'linux' }, responses: { 'claude auth status': { code: 1 } } });
      fakeScript(ctx, 'no token here\n');
      await ensureAuth(ctx, ['claude'], { headless: true });
      const scriptCall = ctx.calls.find((a) => a[0] === 'script' && a[1] === '-qec');
      expect(scriptCall).toBeDefined();
      const logPath = scriptCall![scriptCall!.length - 1]!;
      expect(logPath).not.toMatch(new RegExp(`^${tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/sai-setup-token-`)); // not a predictable path
      expect(logPath.startsWith(tmpdir())).toBe(true);
      expect(logPath).toMatch(/sai-auth-[^/]+\/setup-token\.log$/); // inside a 0700 mkdtemp dir
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: realStdout, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: realStdin, configurable: true });
    }
  });

  it('with no script(1), hands the terminal to the CLI and re-probes instead of parsing a token', async () => {
    const realIsTTY = process.stdout.isTTY; const realStdin = process.stdin.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      const ctx = makeTestCtx({ host: { platform: 'linux' }, responses: { 'claude auth status': { code: 1 }, 'claude setup-token': '' } });
      fakeScript(ctx, null); // script(1) absent
      const [state] = await ensureAuth(ctx, ['claude'], { headless: true });
      expect(ctx.calls.some((a) => a[0] === 'script' && a[1] === '-qec')).toBe(false);
      const setup = ctx.opts.find((o) => o.argv.join(' ') === 'claude setup-token');
      expect(setup?.opts.interactive).toBe(true); // the user needs the terminal to paste the code
      expect(state!.authenticated).toBe(false); // re-probe still says signed out; we never invent success
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: realIsTTY, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: realStdin, configurable: true });
    }
  });
});
