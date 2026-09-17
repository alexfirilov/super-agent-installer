import { readFile as fsReadFile, access } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import type { HostInfo, PkgManager, Platform, Runner } from '../types.js';
export interface HostDeps { platform: NodeJS.Platform; arch: string; env: Record<string, string | undefined>; homedir: string; uid: number; readFile(p: string): Promise<string | null>; exists(p: string): Promise<boolean>; which(cmd: string): Promise<boolean>; run: Runner }
export function defaultHostDeps(run: Runner): HostDeps {
  const which = async (cmd: string) => { const r = await run(process.platform === 'win32' ? ['where.exe', cmd] : ['sh', '-c', `command -v ${cmd}`], { readOnly: true, allowFailure: true }); return r.code === 0; };
  return { platform: process.platform, arch: process.arch, env: process.env, homedir: homedir(), uid: process.platform === 'win32' ? 1000 : userInfo().uid, readFile: async (p) => { try { return await fsReadFile(p, 'utf8'); } catch { return null; } }, exists: async (p) => { try { await access(p); return true; } catch { return false; } }, which, run };
}
function parseOsRelease(t: string | null): Record<string, string> { const o: Record<string, string> = {}; for (const line of (t ?? '').split('\n')) { const m = /^([A-Z_]+)=("?)(.*)\2$/.exec(line.trim()); if (m && m[1] && m[3] !== undefined) o[m[1]] = m[3]; } return o; }
export async function detectHost(d: HostDeps): Promise<HostInfo> {
  const platform: Platform = d.platform === 'win32' ? 'windows' : d.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = d.arch === 'arm64' || d.arch === 'aarch64' ? 'arm64' : 'x64';
  const home = platform === 'windows' ? (d.env.USERPROFILE ?? d.homedir) : d.homedir;
  const has = async (...c: string[]) => { for (const x of c) if (await d.which(x)) return true; return false; };
  let pkgManager: PkgManager = null;
  if (platform === 'linux') { for (const [bin, pm] of [['apt-get', 'apt'], ['dnf', 'dnf'], ['yum', 'yum'], ['pacman', 'pacman'], ['zypper', 'zypper'], ['apk', 'apk'], ['nix-env', 'nix']] as const) if (await d.which(bin)) { pkgManager = pm; break; } }
  else if (platform === 'darwin') pkgManager = (await d.which('brew')) ? 'brew' : null;
  else pkgManager = (await d.which('winget')) ? 'winget' : (await d.which('scoop')) ? 'scoop' : (await d.which('choco')) ? 'choco' : null;
  const osRelease = platform === 'linux' ? parseOsRelease(await d.readFile('/etc/os-release')) : {};
  const cpuinfo = platform === 'linux' ? await d.readFile('/proc/cpuinfo') : null;
  const hasAvx = platform === 'linux' ? (cpuinfo ? /\bavx\b/.test(cpuinfo) : null) : null;
  const environ = platform === 'linux' ? await d.readFile('/proc/1/environ') : null;
  const version = platform === 'linux' ? await d.readFile('/proc/version') : null;
  const isRoot = platform !== 'windows' && d.uid === 0;
  const psOut = platform === 'windows' ? (await d.run(['tasklist.exe', '/FI', 'IMAGENAME eq claude.exe', '/NH'], { readOnly: true, allowFailure: true })).stdout : (await d.run(['ps', '-eo', 'pid,comm'], { readOnly: true, allowFailure: true })).stdout;
  const claudeRunning = /(^|\s)claude(\.exe)?(\s|$)/m.test(psOut);
  let diskFreeMb: number | null = null;
  if (platform !== 'windows') { const df = await d.run(['df', '-m', home], { readOnly: true, allowFailure: true }); const line = df.stdout.trim().split('\n').pop() ?? ''; const cols = line.split(/\s+/); const n = Number(cols[3]); diskFreeMb = Number.isFinite(n) ? n : null; }
  else { const r = await d.run(['powershell.exe', '-NoProfile', '-Command', `(Get-PSDrive -Name ($env:USERPROFILE.Substring(0,1))).Free / 1MB`], { readOnly: true, allowFailure: true }); const s = r.stdout.trim(); const n = s ? Number(s) : NaN; diskFreeMb = r.code === 0 && Number.isFinite(n) ? Math.floor(n) : null; }
  let windowsDeveloperMode: boolean | null = null;
  if (platform === 'windows') { const r = await d.run(['reg.exe', 'query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock', '/v', 'AllowDevelopmentWithoutDevLicense'], { readOnly: true, allowFailure: true }); windowsDeveloperMode = r.code === 0 ? /0x1/.test(r.stdout) : false; }
  let isElevated: boolean | null = null;
  if (platform === 'windows') { const r = await d.run(['powershell.exe', '-NoProfile', '-Command', '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'], { readOnly: true, allowFailure: true }); isElevated = r.code === 0 ? /true/i.test(r.stdout) : false; }
  return {
    platform, arch, isRoot, hasSudo: platform !== 'windows' && !isRoot && (await d.which('sudo')), pkgManager,
    isWsl: /microsoft/i.test(version ?? '') || !!d.env.WSL_DISTRO_NAME, isProxmoxHost: platform === 'linux' && ((await d.which('pveversion')) || (await d.exists('/etc/pve/.version'))),
    isLxc: /container=lxc/.test(environ ?? ''), isNixOS: osRelease.ID === 'nixos', isMusl: platform === 'linux' && ((await d.exists('/lib/ld-musl-x86_64.so.1')) || (await d.exists('/lib/ld-musl-aarch64.so.1'))),
    hasAvx, hasBwrap: platform === 'linux' && (await has('bwrap')), home, diskFreeMb, claudeRunning, windowsDeveloperMode, isElevated, osRelease,
  };
}
