import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog, CATALOG_URL } from '../../src/manifest/catalog.js';
import { createLogger } from '../../src/ui/log.js';
import type { Manifest } from '../../src/types.js';

const comp = (id: string) => ({ id, name: id, kind: 'tool', agents: 'both', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: true, spec: { kind: 'tool', probe: [id], packages: {} } });
const catalog = (id: string, extra: Record<string, unknown> = {}): Manifest => ({ version: 1, profiles: {}, components: [comp(id)], ...extra } as unknown as Manifest);
const ids = (m: Manifest) => m.components.map((c) => c.id);
function setup(remote: { status: number; body?: string } | 'throw', o: { cache?: string; source?: string; offline?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sai-cat-')); const cacheFile = join(dir, 'state', 'catalog.json');
  if (o.cache !== undefined) { mkdirSync(join(dir, 'state'), { recursive: true }); writeFileSync(cacheFile, o.cache); }
  const urls: string[] = [];
  const fetch = (async (u: string | URL) => { urls.push(String(u)); if (remote === 'throw') throw new Error('offline'); return new Response(remote.body ?? '', { status: remote.status }); }) as typeof globalThis.fetch;
  const log = createLogger({ quiet: true });
  return { cacheFile, urls, log, dir, load: () => loadCatalog({ cacheFile, bundled: catalog('bundled'), installerVersion: '0.5.0', fetch, log, source: o.source, offline: o.offline }) };
}

describe('loadCatalog', () => {
  it('uses the published catalog and caches it', async () => {
    const s = setup({ status: 200, body: JSON.stringify(catalog('remote')) });
    const r = await s.load();
    expect(ids(r.manifest)).toEqual(['remote']); expect(r.source).toBe(CATALOG_URL); expect(s.urls).toEqual([CATALOG_URL]);
    expect(JSON.parse(readFileSync(s.cacheFile, 'utf8')).components[0].id).toBe('remote');
  });
  it('falls back to the cache, then to the bundled copy, when the catalog cannot be fetched', async () => {
    const cached = await setup('throw', { cache: JSON.stringify(catalog('cached')) }).load();
    expect(ids(cached.manifest)).toEqual(['cached']); expect(cached.source).toMatch(/^cache \(\d{4}-\d{2}-\d{2}\)$/);
    const s = setup({ status: 500 }); const bundled = await s.load();
    expect(ids(bundled.manifest)).toEqual(['bundled']); expect(bundled.source).toBe('bundled with v0.5.0');
    expect(s.log.lines.some((l) => /could not fetch the catalog/.test(l))).toBe(true);
  });
  it('skips a catalog that needs a newer installer, and says to self-update', async () => {
    const s = setup({ status: 200, body: JSON.stringify(catalog('future', { minInstallerVersion: '0.6.0' })) });
    const r = await s.load();
    expect(ids(r.manifest)).toEqual(['bundled']); expect(existsSync(s.cacheFile)).toBe(false);
    expect(s.log.lines.some((l) => /needs installer 0\.6\.0 or newer.*self-update/.test(l))).toBe(true);
    expect(ids((await setup({ status: 200, body: JSON.stringify(catalog('same', { minInstallerVersion: '0.5.0' })) }).load()).manifest)).toEqual(['same']);
  });
  it('skips a catalog this installer cannot parse (a kind it does not know), and an unusable cache too', async () => {
    const future = { ...catalog('x'), components: [{ ...comp('x'), kind: 'mod', spec: { kind: 'mod' } }] };
    const s = setup({ status: 200, body: JSON.stringify(future) }, { cache: '{not json' });
    expect(ids((await s.load()).manifest)).toEqual(['bundled']);
    expect(s.log.lines.some((l) => /not usable by installer 0\.5\.0/.test(l))).toBe(true);
  });
  it('--offline never fetches: last cache, else bundled', async () => {
    const s = setup({ status: 200, body: JSON.stringify(catalog('remote')) }, { offline: true, cache: JSON.stringify(catalog('cached')) });
    expect(ids((await s.load()).manifest)).toEqual(['cached']); expect(s.urls).toEqual([]);
  });
  it('--manifest with a path reads that file; with a URL fetches it, does not cache it, and fails loudly', async () => {
    const s = setup('throw'); const path = join(s.dir, 'm.json'); writeFileSync(path, JSON.stringify(catalog('local')));
    const local = await loadCatalog({ cacheFile: s.cacheFile, bundled: catalog('bundled'), installerVersion: '0.5.0', fetch: globalThis.fetch, log: s.log, source: path });
    expect(ids(local.manifest)).toEqual(['local']); expect(local.source).toBe(path);
    const u = setup({ status: 200, body: JSON.stringify(catalog('fork')) }, { source: 'https://example.test/m.json' });
    expect(ids((await u.load()).manifest)).toEqual(['fork']); expect(u.urls).toEqual(['https://example.test/m.json']); expect(existsSync(u.cacheFile)).toBe(false);
    await expect(setup({ status: 404 }, { source: 'https://example.test/m.json' }).load()).rejects.toThrow(/could not load the catalog/);
  });
});
