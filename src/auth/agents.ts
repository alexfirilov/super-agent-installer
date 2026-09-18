import { readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthState, Ctx } from '../types.js';

export type { AuthState };

const TOKEN_RE = /^[A-Za-z0-9._-]{20,}$/;

function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean);
  return line ?? '';
}

/** No GUI session to open a browser in: no DISPLAY/WAYLAND_DISPLAY on linux, or an SSH session, or an
 * unprivileged LXC container (Proxmox). Windows and macOS always have a way to pop a browser, so they
 * are never treated as headless here. */
export function isHeadless(ctx: Ctx): boolean {
  if (ctx.host.platform !== 'linux') return false;
  if (ctx.host.isLxc) return true;
  if (ctx.env.SSH_CONNECTION) return true;
  return !ctx.env.DISPLAY && !ctx.env.WAYLAND_DISPLAY;
}

export async function detectAuth(ctx: Ctx, agent: 'claude' | 'codex'): Promise<AuthState> {
  if (agent === 'claude') {
    const r = await ctx.run(['claude', 'auth', 'status'], { readOnly: true, allowFailure: true });
    return { agent, authenticated: r.code === 0, mode: null, detail: firstLine(r.stdout) || firstLine(r.stderr) };
  }
  const r = await ctx.run(['codex', 'login', 'status'], { readOnly: true, allowFailure: true });
  const text = `${r.stdout}\n${r.stderr}`;
  // No machine-readable flag exists on `codex login status`, so the mode is matched out of CLI prose. A vendor
  // wording change silently yields `null`, which downstream reads as "not signed in" -- log the raw line so that
  // failure is diagnosable instead of mysterious.
  let mode: string | null = null;
  if (/chatgpt|subscription/i.test(text)) mode = 'chatgpt';
  else if (/api[ -]?key/i.test(text)) mode = 'apikey';
  if (mode === null) ctx.log.debug(`codex login status: could not classify auth mode from ${JSON.stringify(firstLine(r.stdout) || firstLine(r.stderr))}`);
  return { agent, authenticated: r.code === 0, mode, detail: firstLine(r.stdout) || firstLine(r.stderr) };
}

/** Strips CSI colour codes and OSC-8 hyperlink wrappers so a token or URL can be read out of a captured pty session. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\]8;[^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '').replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '\n');
}

/**
 * `claude setup-token` renders its sign-in UI only to a terminal. With stdout redirected -- CI, `curl | sh > log`,
 * nohup, any remote provisioning run -- it prints NOTHING at all and then waits for a browser flow the user was
 * never told about, until the ten-minute timeout expires. GCE QA hit exactly that: a silent hang, which is worse
 * than a clean failure. When we have no tty of our own, borrow one from script(1) and tee the session to a file we
 * can read the token back out of, so the URL still reaches the user's screen.
 */
async function runSetupToken(ctx: Ctx): Promise<string | null> {
  // `claude setup-token` is a PASTE-BACK flow, confirmed on a GCE host: it shows a URL, the browser hands the user a
  // code, and the CLI waits for that code on stdin. With no stdin there is nobody to paste, so it can never finish --
  // it would just hold the run until the ten-minute timeout. Say so immediately instead.
  if (!process.stdin.isTTY) return null;
  const usePty = !process.stdout.isTTY && ctx.host.platform === 'linux'
    && (await ctx.run(['script', '--version'], { readOnly: true, allowFailure: true })).code === 0;
  if (!usePty) return (await ctx.run(['claude', 'setup-token'], { timeoutMs: 600000, allowFailure: true })).stdout;
  const logPath = join(tmpdir(), `sai-setup-token-${process.pid}.log`);
  await writeFile(logPath, '', { mode: 0o600 }); // script(1) truncates but keeps the mode: the token must not be world-readable
  try {
    ctx.log.info('claude: starting sign-in - a URL will appear below; open it in a browser to finish');
    // a pty with no terminal behind it defaults to 80 columns, which wraps the OAuth URL across lines
    await ctx.run(['script', '-qec', 'stty cols 400 rows 100 2>/dev/null; claude setup-token', logPath], { interactive: true, timeoutMs: 600000, allowFailure: true });
    return stripAnsi(await readFile(logPath, 'utf8').catch(() => ''));
  } finally {
    await rm(logPath, { force: true });
  }
}

async function signInClaudeHeadless(ctx: Ctx): Promise<AuthState> {
  const output = await runSetupToken(ctx);
  if (output === null) {
    return { agent: 'claude', authenticated: false, mode: null, detail: 'claude sign-in needs a terminal to paste the code back into: run the installer interactively, or set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token` on any machine) before running it' };
  }
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
  let token: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) { const l = lines[i]; if (l && TOKEN_RE.test(l)) { token = l; break; } }
  if (!token) return { agent: 'claude', authenticated: false, mode: null, detail: 'claude setup-token produced no token' };
  ctx.secrets.set('CLAUDE_CODE_OAUTH_TOKEN', token);
  ctx.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  ctx.log.info(`claude: captured setup-token (length ${token.length}, set CLAUDE_CODE_OAUTH_TOKEN)`);
  return { agent: 'claude', authenticated: true, mode: 'token', detail: 'CLAUDE_CODE_OAUTH_TOKEN captured via setup-token' };
}

async function ensureOne(ctx: Ctx, agent: 'claude' | 'codex', headless: boolean): Promise<AuthState> {
  let state = await detectAuth(ctx, agent);
  if (state.authenticated) { ctx.log.info(`${agent}: already signed in`); return state; }
  if (!headless) {
    const cmd = agent === 'claude' ? ['claude', 'auth', 'login'] : ['codex', 'login'];
    await ctx.run(cmd, { interactive: true, timeoutMs: 600000, allowFailure: true });
    state = await detectAuth(ctx, agent); // never trust the login command's own exit code -- re-probe
  } else if (agent === 'claude') {
    state = await signInClaudeHeadless(ctx);
  } else {
    await ctx.run(['codex', 'login', '--device-auth'], { interactive: true, timeoutMs: 600000, allowFailure: true });
    state = await detectAuth(ctx, agent);
  }
  if (state.authenticated) ctx.log.info(`${agent}: signed in`); else ctx.log.warn(`${agent}: still not signed in${state.detail ? ` (${state.detail})` : ''}`);
  return state;
}

export async function ensureAuth(ctx: Ctx, agents: Array<'claude' | 'codex'>, opts: { headless: boolean }): Promise<AuthState[]> {
  const out: AuthState[] = [];
  for (const agent of agents) out.push(await ensureOne(ctx, agent, opts.headless));
  return out;
}
