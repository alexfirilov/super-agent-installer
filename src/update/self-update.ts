import { createHash } from 'node:crypto';
import { writeFile, rename, chmod, unlink } from 'node:fs/promises';
import type { Ctx } from '../types.js';
import { REPO } from '../pins.js';
import { latestGithubRelease } from '../version/latest.js';
import { isNewer } from '../version/compare.js';
export interface SelfUpdateDeps { fetch?: typeof fetch; execPath?: string; platform?: string; arch?: string }
export function releaseTarget(platform: string, arch: string): { asset: string; exe: string } { const os = platform === 'win32' || platform === 'windows' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux'; const a = arch === 'arm64' || arch === 'aarch64' ? 'arm64' : 'x64'; const asset = `super-agent-installer-${os}-${a}`; return { asset, exe: os === 'windows' ? `${asset}.exe` : asset }; }
export async function selfUpdate(ctx: Ctx, current: string, d: SelfUpdateDeps = {}): Promise<{ updated: boolean; message: string }> {
  const f = d.fetch ?? ctx.fetch; const execPath = d.execPath ?? process.execPath; const platform = d.platform ?? process.platform; const arch = d.arch ?? process.arch;
  if (/(^|[\\/])(bun|node)(\.exe)?$/.test(execPath)) return { updated: false, message: 'running from source; update with git pull or npm install -g super-agent-installer@latest' };
  const latest = await latestGithubRelease(f, REPO); if (!latest) return { updated: false, message: 'could not reach GitHub releases' };
  if (!isNewer(latest, current)) return { updated: false, message: `already current (v${current})` };
  if (ctx.dryRun) return { updated: false, message: `[dry-run] would update v${current} -> v${latest}` };
  const { asset, exe } = releaseTarget(platform, arch); const base = `https://github.com/${REPO}/releases/download/v${latest}`;
  try {
    const sums = await (await f(`${base}/SHA256SUMS`)).text(); const line = sums.split('\n').find((l) => l.trim().endsWith(exe) || l.trim().endsWith(asset)); const expected = line?.trim().split(/\s+/)[0];
    if (!expected) return { updated: false, message: `no checksum for ${exe} in release v${latest}` };
    const r = await f(`${base}/${exe}`); if (!r.ok) return { updated: false, message: `download failed (${r.status})` };
    const buf = Buffer.from(await r.arrayBuffer()); const actual = createHash('sha256').update(buf).digest('hex');
    if (actual !== expected) return { updated: false, message: `checksum mismatch for ${exe}: expected ${expected}, got ${actual}` };
    const tmp = `${execPath}.new`; await writeFile(tmp, buf); if (platform !== 'win32' && platform !== 'windows') await chmod(tmp, 0o755);
    if (platform === 'win32' || platform === 'windows') { const old = `${execPath}.old`; try { await unlink(old); } catch { /* none */ } await rename(execPath, old); await rename(tmp, execPath); ctx.log.info(`old executable kept at ${old}; delete it when convenient`); }
    else await rename(tmp, execPath);
    return { updated: true, message: `updated v${current} -> v${latest}; rerun the command` };
  } catch (e) { return { updated: false, message: `self-update failed: ${(e as Error).message}` }; }
}
