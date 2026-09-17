import { readFile } from 'node:fs/promises';
import type { Channel, Ctx, Manifest } from './types.js';
import { parseManifest } from './manifest/schema.js';
import bundledManifest from '../manifest.json' with { type: 'json' };
import { detectHost, defaultHostDeps } from './detect/host.js';
import { resolvePaths } from './config/paths.js';
import { createRunner } from './exec/run.js';
import { createLogger } from './ui/log.js';
import { registerAllProviders } from './providers/index.js';
import { extendPath } from './exec/path.js';
export interface CtxOptions { dryRun?: boolean; yes?: boolean; noAudit?: boolean; channel?: Channel; verbose?: boolean; json?: boolean; manifestPath?: string; secrets?: Map<string, string>; logFile?: string; elevate?: boolean }
export async function loadBundledManifest(path?: string): Promise<Manifest> { return parseManifest(path ? JSON.parse(await readFile(path, 'utf8')) : bundledManifest); }
export async function createCtx(o: CtxOptions): Promise<Ctx> {
  registerAllProviders();
  const manifest = await loadBundledManifest(o.manifestPath);
  const probeLog = createLogger({ quiet: true }); const probeRun = createRunner({ dryRun: false, log: probeLog });
  const host = await detectHost(defaultHostDeps(probeRun)); const paths = resolvePaths(host, process.env);
  extendPath(host, process.env); // binaries the vendor installers put in ~/.local/bin, fnm, ... are visible to every command even before the user opens a new shell
  const log = createLogger({ file: o.logFile ?? paths.logFile, verbose: o.verbose, json: o.json });
  const run = createRunner({ dryRun: !!o.dryRun, log });
  return { host, paths, run, log, dryRun: !!o.dryRun, yes: !!o.yes, noAudit: !!o.noAudit, channel: o.channel ?? 'latest', secrets: o.secrets ?? new Map(), fetch: globalThis.fetch, env: process.env, manifest, elevate: !!o.elevate };
}
