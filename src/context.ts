import { join } from 'node:path';
import type { Channel, Ctx } from './types.js';
import { loadCatalog } from './manifest/catalog.js';
import bundledManifest from '../manifest.json' with { type: 'json' };
import { VERSION } from './version.js';
import { detectHost, defaultHostDeps } from './detect/host.js';
import { resolvePaths } from './config/paths.js';
import { createRunner } from './exec/run.js';
import { createLogger } from './ui/log.js';
import { registerAllProviders } from './providers/index.js';
import { extendPath } from './exec/path.js';
import { DEFAULT_COOLDOWN_DAYS } from './pins.js';
/** `manifestPath`: `--manifest`, a local path or an http(s) URL. `offline`: skip the published catalog. */
export interface CtxOptions { dryRun?: boolean; yes?: boolean; noAudit?: boolean; channel?: Channel; verbose?: boolean; json?: boolean; manifestPath?: string; offline?: boolean; secrets?: Map<string, string>; logFile?: string; elevate?: boolean }
export async function createCtx(o: CtxOptions): Promise<Ctx> {
  registerAllProviders();
  const probeLog = createLogger({ quiet: true }); const probeRun = createRunner({ dryRun: false, log: probeLog });
  const host = await detectHost(defaultHostDeps(probeRun)); const paths = resolvePaths(host, process.env);
  extendPath(host, process.env); // binaries the vendor installers put in ~/.local/bin, fnm, ... are visible to every command even before the user opens a new shell
  const log = createLogger({ file: o.logFile ?? paths.logFile, verbose: o.verbose, json: o.json });
  const { manifest, source } = await loadCatalog({ source: o.manifestPath, offline: o.offline, cacheFile: join(paths.stateDir, 'catalog.json'), bundled: bundledManifest, installerVersion: VERSION, fetch: globalThis.fetch, log });
  log.debug(`catalog: ${source}`);
  const run = createRunner({ dryRun: !!o.dryRun, log });
  return { host, paths, run, log, dryRun: !!o.dryRun, yes: !!o.yes, noAudit: !!o.noAudit, channel: o.channel ?? 'latest', cooldownDays: DEFAULT_COOLDOWN_DAYS, offline: !!o.offline, catalogSource: source, secrets: o.secrets ?? new Map(), fetch: globalThis.fetch, env: process.env, manifest, elevate: !!o.elevate };
}
