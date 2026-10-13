import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Logger, Manifest } from '../types.js';
import { parseManifest } from './schema.js';
import { isNewer } from '../version/compare.js';
import { REPO } from '../pins.js';

/** The published catalog: the manifest on the repository's default branch. Changing which skills, plugins and MCP
 * servers hosts get is a commit there, not a binary release. */
export const CATALOG_URL = `https://raw.githubusercontent.com/${REPO}/HEAD/manifest.json`;
const MAX_BYTES = 5 * 1024 * 1024;

export interface CatalogOpts {
  /** `--manifest`: a local path (used as is, errors are fatal) or an http(s) URL (replaces the default catalog URL). */
  source?: string; offline?: boolean; cacheFile: string; bundled: unknown; installerVersion: string; fetch: typeof fetch; log: Logger;
}

async function fetchText(f: typeof fetch, url: string): Promise<string | null> {
  try {
    const r = await f(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) return null;
    const t = await r.text(); return t.length > MAX_BYTES ? null : t;
  } catch { return null; }
}

/**
 * Where the manifest comes from, most current first: the published catalog (cached on success), the cache from the
 * last successful fetch, the copy bundled into this binary. A catalog this installer cannot use -- invalid for its
 * schema, or declaring a newer `minInstallerVersion` -- is skipped with a warning rather than half-applied, so an old
 * binary keeps working from its own copy until `self-update` brings one that understands the new catalog.
 */
export async function loadCatalog(o: CatalogOpts): Promise<{ manifest: Manifest; source: string }> {
  if (o.source && !/^https?:\/\//i.test(o.source)) return { manifest: parseManifest(JSON.parse(await readFile(o.source, 'utf8'))), source: o.source };
  const usable = (text: string, where: string): Manifest | null => {
    try {
      const m = parseManifest(JSON.parse(text));
      if (m.minInstallerVersion && isNewer(m.minInstallerVersion, o.installerVersion)) { o.log.warn(`the ${where} needs installer ${m.minInstallerVersion} or newer (this is ${o.installerVersion}); run: super-agent-installer self-update`); return null; }
      return m;
    } catch (e) { o.log.warn(`the ${where} is not usable by installer ${o.installerVersion}: ${(e as Error).message.split('\n').slice(0, 3).join(' ')}`); return null; }
  };
  if (!o.offline) {
    const url = o.source ?? CATALOG_URL;
    const text = await fetchText(o.fetch, url);
    const m = text === null ? null : usable(text, `catalog at ${url}`);
    if (m) {
      if (!o.source) { try { await mkdir(dirname(o.cacheFile), { recursive: true }); await writeFile(o.cacheFile, text!, { mode: 0o600 }); } catch (e) { o.log.debug(`could not cache the catalog: ${(e as Error).message}`); } }
      return { manifest: m, source: url };
    }
    if (o.source) throw new Error(`could not load the catalog from ${o.source}`);
    if (text === null) o.log.warn(`could not fetch the catalog from ${url}; using the last cached or the bundled copy`);
  }
  try {
    const [text, st] = await Promise.all([readFile(o.cacheFile, 'utf8'), stat(o.cacheFile)]);
    const m = usable(text, 'cached catalog'); if (m) return { manifest: m, source: `cache (${st.mtime.toISOString().slice(0, 10)})` };
  } catch { /* no cache yet */ }
  return { manifest: parseManifest(o.bundled), source: `bundled with v${o.installerVersion}` };
}
