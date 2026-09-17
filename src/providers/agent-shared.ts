import type { Ctx } from '../types.js';

export async function which(ctx: Ctx, cmd: string): Promise<string> {
  const r = await ctx.run(ctx.host.platform === 'windows' ? ['where.exe', cmd] : ['sh', '-c', `command -v ${cmd}`], { readOnly: true, allowFailure: true });
  return r.code === 0 ? (r.stdout.trim().split('\n')[0] ?? '') : '';
}

export function owner(path: string): 'apt' | 'brew' | 'winget' | 'native' {
  if (/^\/usr\/bin\//.test(path)) return 'apt';
  if (/homebrew|\/usr\/local\/Caskroom/.test(path)) return 'brew';
  if (/WinGet/i.test(path)) return 'winget';
  return 'native';
}
