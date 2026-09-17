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
  let mode: string | null = null;
  if (/chatgpt|subscription/i.test(text)) mode = 'chatgpt';
  else if (/api[ -]?key/i.test(text)) mode = 'apikey';
  return { agent, authenticated: r.code === 0, mode, detail: firstLine(r.stdout) || firstLine(r.stderr) };
}

async function signInClaudeHeadless(ctx: Ctx): Promise<AuthState> {
  const r = await ctx.run(['claude', 'setup-token'], { timeoutMs: 600000, allowFailure: true });
  const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
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
