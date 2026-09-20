import { connect } from 'node:net';
import type { Ctx } from '../types.js';
import { probeVersion } from '../detect/tools.js';
import { readJsonFile, JsonParseError } from '../config/json.js';

/** True if something accepts a TCP connection at host:port within `ms`. */
function listening(host: string, port: number, ms = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const done = (v: boolean) => { sock.destroy(); resolve(v); };
    sock.setTimeout(ms, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/**
 * An `ANTHROPIC_BASE_URL` in ~/.claude/settings.json routes every Claude Code request somewhere else. When that
 * somewhere is a local proxy that is not running, Claude Code is simply unreachable and nothing says why
 * (2026-09-19: a caveman gateway route at 127.0.0.1:8787 left behind after the proxy stopped). Name it.
 * Returns a report line, or null when there is nothing to say.
 */
async function baseUrlReport(ctx: Ctx): Promise<{ line: string; broken: boolean } | null> {
  let s: { env?: Record<string, unknown> };
  try { s = (await readJsonFile<{ env?: Record<string, unknown> }>(ctx.paths.claudeSettings)) ?? {}; }
  catch (e) { if (e instanceof JsonParseError) return { line: `${e.message} Every installer step that patches this file will refuse to run until it parses.`, broken: true }; throw e; }
  const url = s.env?.ANTHROPIC_BASE_URL;
  if (typeof url !== 'string' || !url) return null;
  let u: URL; try { u = new URL(url); } catch { return { line: `ANTHROPIC_BASE_URL: ${url} (not a valid URL)`, broken: true }; }
  const local = /^(127\.0\.0\.1|localhost|::1|\[::1\])$/.test(u.hostname);
  if (!local) return { line: `ANTHROPIC_BASE_URL: ${url} (requests go through this host, not api.anthropic.com; remote control will not work)`, broken: false };
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  const up = await listening(u.hostname.replace(/^\[|\]$/g, ''), port);
  return up
    ? { line: `ANTHROPIC_BASE_URL: ${url} (local proxy, listening; remote control will not work while this is set)`, broken: false }
    : { line: `ANTHROPIC_BASE_URL: ${url} -- local proxy at ${u.hostname}:${port} is NOT listening. Every Claude Code request goes to a dead port. Remove the "env.ANTHROPIC_BASE_URL" entry from ${ctx.paths.claudeSettings} (and _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL with it), or start the proxy.`, broken: true };
}
export async function runDoctor(ctx: Ctx): Promise<number> {
  const h = ctx.host; const v = async (argv: string[], re?: string) => (await probeVersion(ctx.run, argv, re)) ?? 'missing';
  const lines = [`platform: ${h.platform}/${h.arch}${h.isWsl ? ' (WSL)' : ''}${h.isLxc ? ' (LXC)' : ''}${h.isProxmoxHost ? ' (Proxmox host)' : ''}`, `user: ${h.isRoot ? 'root' : `non-root${h.hasSudo ? ' + sudo' : ''}`}`, `package manager: ${h.pkgManager ?? 'none'}`, `disk free (home): ${h.diskFreeMb ?? '?'} MB`, `AVX: ${h.hasAvx === null ? 'n/a' : h.hasAvx ? 'yes' : 'NO (Claude Code will crash)'}`, `bubblewrap: ${h.hasBwrap ? 'yes' : 'no'}`, `claude: ${await v(['claude', '--version'])}`, `codex: ${await v(['codex', '--version'])}`, `node: ${await v(['node', '--version'])}`, `npm: ${await v(['npm', '--version'])}`, `uv: ${await v(['uv', '--version'])}`, `git: ${await v(['git', '--version'])}`, `jq: ${await v(['jq', '--version'])}`, `gh: ${await v(['gh', '--version'])}`, `caveman: ${await v(['caveman', '--version'])}`, `claude session running: ${h.claudeRunning ? 'yes' : 'no'}`];
  const base = await baseUrlReport(ctx);
  if (base) lines.push(base.line);
  console.log(lines.join('\n'));
  for (const argv of [['claude', 'doctor'], ['codex', 'doctor', '--json'], ...(h.platform === 'linux' ? [['codex', 'sandbox', '--', '/bin/true']] : []), ['claude', 'mcp', 'list']]) { const r = await ctx.run(argv, { readOnly: true, allowFailure: true, timeoutMs: 120000 }); console.log(`\n$ ${argv.join(' ')} (exit ${r.code})\n${(r.stdout + r.stderr).trim().slice(0, 4000)}`); }
  return base?.broken ? 2 : 0;
}
