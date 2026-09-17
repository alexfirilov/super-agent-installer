import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Ctx, HostInfo, Logger, Manifest, Runner } from '../../src/types.js';
import { resolvePaths } from '../../src/config/paths.js';
import { createLogger } from '../../src/ui/log.js';
export interface FakeOpts { responses?: Record<string, string | { code: number; stdout?: string; stderr?: string }>; env?: Record<string, string>; host?: Partial<HostInfo>; dryRun?: boolean; manifest?: Manifest; fetch?: typeof fetch; secrets?: Record<string, string> }
export function makeTestCtx(o: FakeOpts = {}): Ctx & { calls: string[][]; log: Logger & { lines: string[] } } {
  const calls: string[][] = [];
  const run: Runner = async (argv, opts = {}) => {
    calls.push(argv); const key = argv.join(' '); const r = o.responses?.[key];
    // unknown read-only probes behave like a missing command (127); unknown mutating commands succeed silently so providers can be tested without listing every side-effect command
    if (r === undefined) return opts.readOnly ? { code: 127, stdout: '', stderr: `no fake response for: ${key}`, skipped: false } : { code: 0, stdout: '', stderr: '', skipped: false };
    const res = typeof r === 'string' ? { code: 0, stdout: r, stderr: '', skipped: false } : { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '', skipped: false };
    if (res.code !== 0 && !opts.allowFailure) throw new Error(`${key} failed with exit ${res.code}`);
    return res;
  };
  const home = mkdtempSync(join(tmpdir(), 'sai-home-'));
  const host: HostInfo = { platform: 'linux', arch: 'x64', isRoot: false, hasSudo: true, pkgManager: 'apt', isWsl: false, isProxmoxHost: false, isLxc: false, isNixOS: false, isMusl: false, hasAvx: true, hasBwrap: true, home, diskFreeMb: 100000, claudeRunning: false, windowsDeveloperMode: null, osRelease: { ID: 'ubuntu' }, ...o.host };
  const env = { ...o.env };
  return { calls, host, paths: resolvePaths(host, env), run, log: createLogger({ quiet: true }), dryRun: o.dryRun ?? false, yes: true, noAudit: false, channel: 'latest', secrets: new Map(Object.entries(o.secrets ?? {})), fetch: o.fetch ?? (globalThis.fetch as typeof fetch), env, manifest: o.manifest ?? { version: 1, profiles: {}, components: [] } };
}
