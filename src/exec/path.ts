import { join } from 'node:path';
import type { HostInfo } from '../types.js';
/** Directories the vendor installers drop binaries into during a run (Claude/Codex native installs, fnm's Node, npm --prefix ~/.local, `go install` into GOPATH/bin). */
export function toolDirs(host: HostInfo, env: Record<string, string | undefined>): string[] {
  const h = host.home;
  if (host.platform === 'windows') {
    const local = env.LOCALAPPDATA ?? `${h}\\AppData\\Local`;
    return [`${h}\\.local\\bin`, `${local}\\Programs\\OpenAI\\Codex\\bin`, `${env.ProgramFiles ?? 'C:\\Program Files'}\\nodejs`, `${env.GOPATH ?? `${h}\\go`}\\bin`];
  }
  const fnm = join(h, '.local', 'share', 'fnm');
  return [join(h, '.local', 'bin'), fnm, join(fnm, 'aliases', 'default', 'bin'), join(env.GOPATH ?? join(h, 'go'), 'bin'), '/usr/local/bin'];
}
/** Prepends the missing tool dirs to env.PATH (idempotent) and returns the dirs that were added. */
export function extendPath(host: HostInfo, env: Record<string, string | undefined>): string[] {
  const sep = host.platform === 'windows' ? ';' : ':';
  const norm = (d: string) => (host.platform === 'windows' ? d.toLowerCase() : d).replace(/[\\/]+$/, '');
  const cur = (env.PATH ?? '').split(sep).filter(Boolean);
  const have = new Set(cur.map(norm));
  const add = toolDirs(host, env).filter((d) => !have.has(norm(d)));
  if (add.length) env.PATH = [...add, ...cur].join(sep);
  return add;
}
