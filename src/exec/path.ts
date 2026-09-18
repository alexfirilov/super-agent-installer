import { join } from 'node:path';
import type { Ctx, HostInfo } from '../types.js';
/**
 * Directories the vendor installers drop binaries into during a run (Claude/Codex native installs, fnm's Node, npm
 * global/--prefix bins, `go install` into GOPATH/bin or the user Go bin, scoop shims). Deliberately excludes
 * `%LOCALAPPDATA%\fnm_multishells`: fnm creates one such directory per shell session and tears it down again, so
 * adding it to PATH would just accumulate stale, already-gone entries.
 */
export function toolDirs(host: HostInfo, env: Record<string, string | undefined>): string[] {
  const h = host.home;
  if (host.platform === 'windows') {
    const local = env.LOCALAPPDATA ?? `${h}\\AppData\\Local`;
    const appData = env.APPDATA ?? `${h}\\AppData\\Roaming`;
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
    const scoop = env.SCOOP ?? `${h}\\scoop`;
    const fnm = env.FNM_DIR ?? `${appData}\\fnm`;
    return [
      `${h}\\.local\\bin`,
      `${local}\\Programs\\OpenAI\\Codex\\bin`,
      `${fnm}\\aliases\\default`, // fnm's persistent default alias; on Windows node.exe sits in it directly (POSIX has a bin/ subdir)
      `${programFiles}\\nodejs`,
      `${env.GOPATH ?? `${h}\\go`}\\bin`,
      `${appData}\\npm`,
      `${programFiles}\\Go\\bin`,
      `${local}\\Programs\\Go\\bin`,
      `${scoop}\\shims`,
    ];
  }
  const fnm = join(h, '.local', 'share', 'fnm');
  return [join(h, '.local', 'bin'), fnm, join(fnm, 'aliases', 'default', 'bin'), join(env.GOPATH ?? join(h, 'go'), 'bin'), join(h, '.local', 'go', 'bin'), '/usr/local/bin'];
}
/** Prepends the given dirs to env.PATH (idempotent, case-insensitive and trailing-slash tolerant on Windows) and returns the dirs that were added. */
function prependDirs(host: HostInfo, env: Record<string, string | undefined>, dirs: string[]): string[] {
  const sep = host.platform === 'windows' ? ';' : ':';
  const norm = (d: string) => (host.platform === 'windows' ? d.toLowerCase() : d).replace(/[\\/]+$/, '');
  const cur = (env.PATH ?? '').split(sep).filter(Boolean);
  const have = new Set(cur.map(norm));
  const add = dirs.filter((d) => !have.has(norm(d)));
  if (add.length) env.PATH = [...add, ...cur].join(sep);
  return add;
}
/** Prepends the missing tool dirs to env.PATH (idempotent) and returns the dirs that were added. */
export function extendPath(host: HostInfo, env: Record<string, string | undefined>): string[] {
  return prependDirs(host, env, toolDirs(host, env));
}
/** Prepends any of the given dirs missing from env.PATH (idempotent). Used to merge freshly-read registry PATH entries. */
export function extendPathWith(host: HostInfo, env: Record<string, string | undefined>, dirs: string[]): string[] {
  return prependDirs(host, env, dirs);
}
/**
 * Reads the machine + user PATH straight from the Windows registry (via `[Environment]::GetEnvironmentVariable`),
 * so a binary a sibling installer (winget, an MSI, etc.) just registered is visible without restarting the process.
 * Windows only; returns `[]` off Windows or if the probe fails for any reason (it must never throw).
 */
export async function readSystemPath(ctx: Ctx): Promise<string[]> {
  if (ctx.host.platform !== 'windows') return [];
  try {
    const r = await ctx.run(
      ['powershell', '-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"],
      { readOnly: true, allowFailure: true },
    );
    if (r.code !== 0) return [];
    return r.stdout.split(';').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
