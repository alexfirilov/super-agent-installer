import type { Ctx } from '../types.js';
import { probeVersion } from '../detect/tools.js';
export async function runDoctor(ctx: Ctx): Promise<number> {
  const h = ctx.host; const v = async (argv: string[], re?: string) => (await probeVersion(ctx.run, argv, re)) ?? 'missing';
  const lines = [`platform: ${h.platform}/${h.arch}${h.isWsl ? ' (WSL)' : ''}${h.isLxc ? ' (LXC)' : ''}${h.isProxmoxHost ? ' (Proxmox host)' : ''}`, `user: ${h.isRoot ? 'root' : `non-root${h.hasSudo ? ' + sudo' : ''}`}`, `package manager: ${h.pkgManager ?? 'none'}`, `disk free (home): ${h.diskFreeMb ?? '?'} MB`, `AVX: ${h.hasAvx === null ? 'n/a' : h.hasAvx ? 'yes' : 'NO (Claude Code will crash)'}`, `bubblewrap: ${h.hasBwrap ? 'yes' : 'no'}`, `claude: ${await v(['claude', '--version'])}`, `codex: ${await v(['codex', '--version'])}`, `node: ${await v(['node', '--version'])}`, `npm: ${await v(['npm', '--version'])}`, `uv: ${await v(['uv', '--version'])}`, `git: ${await v(['git', '--version'])}`, `jq: ${await v(['jq', '--version'])}`, `gh: ${await v(['gh', '--version'])}`, `caveman: ${await v(['caveman', '--version'])}`, `claude session running: ${h.claudeRunning ? 'yes' : 'no'}`];
  console.log(lines.join('\n'));
  for (const argv of [['claude', 'doctor'], ['codex', 'doctor', '--json'], ...(h.platform === 'linux' ? [['codex', 'sandbox', '--', '/bin/true']] : []), ['claude', 'mcp', 'list']]) { const r = await ctx.run(argv, { readOnly: true, allowFailure: true, timeoutMs: 120000 }); console.log(`\n$ ${argv.join(' ')} (exit ${r.code})\n${(r.stdout + r.stderr).trim().slice(0, 4000)}`); }
  return 0;
}
