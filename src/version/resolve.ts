import type { Component, Ctx, VersionSource } from '../types.js';
import { compareVersions } from './compare.js';
import { memo } from '../exec/memo.js';

type F = typeof fetch;
/** One published, non-prerelease version. `publishedAt` is epoch ms, or null when the registry did not say. */
export interface Release { version: string; publishedAt: number | null }
/** How a `{{key}}` was filled: `latest` from the registry, `pin` because the run asked for pins (stable channel,
 * uninstall), `fallback` because the registry lookup failed or nothing qualified. */
export interface ResolvedVersion { componentId: string; key: string; package: string; version: string; how: 'latest' | 'pin' | 'fallback' }

const DAY_MS = 86_400_000;
const FINAL = /^\d+\.\d+\.\d+$/;

async function get(f: F, url: string): Promise<Response | null> {
  try { const r = await f(url, { signal: AbortSignal.timeout(30000) }); return r.ok ? r : null; } catch { return null; }
}

/** Full packument: the abbreviated one has no publish times. Versions above the `latest` dist-tag (a `next` line that
 * happens to have no prerelease suffix) and deprecated ones are not candidates. */
export async function npmReleases(f: F, pkg: string): Promise<Release[] | null> {
  const r = await get(f, `https://registry.npmjs.org/${pkg.replace('/', '%2F')}`); if (!r) return null;
  try {
    const d = (await r.json()) as { 'dist-tags'?: { latest?: string }; versions?: Record<string, { deprecated?: unknown }>; time?: Record<string, string> };
    if (!d.versions) return null; const cap = d['dist-tags']?.latest;
    return Object.entries(d.versions)
      .filter(([v, meta]) => FINAL.test(v) && !meta.deprecated && (!cap || compareVersions(v, cap) <= 0))
      .map(([v]) => ({ version: v, publishedAt: Date.parse(d.time?.[v] ?? '') || null }));
  } catch { return null; }
}

/** A release counts once at least one of its files is not yanked; its date is the earliest such upload. */
export async function pypiReleases(f: F, pkg: string): Promise<Release[] | null> {
  const r = await get(f, `https://pypi.org/pypi/${pkg}/json`); if (!r) return null;
  try {
    const d = (await r.json()) as { releases?: Record<string, Array<{ upload_time_iso_8601?: string; yanked?: boolean }>> };
    if (!d.releases) return null;
    return Object.entries(d.releases).flatMap(([v, files]) => {
      const live = files.filter((x) => !x.yanked); if (!FINAL.test(v) || !live.length) return [];
      const times = live.map((x) => Date.parse(x.upload_time_iso_8601 ?? '')).filter((t) => !Number.isNaN(t));
      return [{ version: v, publishedAt: times.length ? Math.min(...times) : null }];
    });
  } catch { return null; }
}

/** The Go module proxy lists versions without dates, so only the newest few get an `.info` lookup -- enough for any
 * sane cooldown, and one request each. Module paths escape capitals as `!lower`. */
export async function goReleases(f: F, module: string): Promise<Release[] | null> {
  const base = `https://proxy.golang.org/${module.replace(/[A-Z]/g, (ch) => `!${ch.toLowerCase()}`)}/@v`;
  const r = await get(f, `${base}/list`); if (!r) return null;
  const versions = (await r.text()).split('\n').map((l) => l.trim().replace(/^v/, '')).filter((v) => FINAL.test(v))
    .sort((a, b) => compareVersions(b, a)).slice(0, 8);
  return Promise.all(versions.map(async (v) => {
    const info = await get(f, `${base}/v${v}.info`);
    let publishedAt: number | null = null;
    try { publishedAt = info ? Date.parse(((await info.json()) as { Time?: string }).Time ?? '') || null : null; } catch { /* undated */ }
    return { version: v, publishedAt };
  }));
}

const LISTERS: Record<VersionSource['registry'], (f: F, pkg: string) => Promise<Release[] | null>> = { npm: npmReleases, pypi: pypiReleases, go: goReleases };

const majorOf = (v: string) => Number(v.split('.')[0]);
/** The newest release on the held major line that is at least `cooldownDays` old. With a cooldown, an undated
 * release never qualifies: we cannot show it is old enough. */
export function pickRelease(releases: Release[], src: Pick<VersionSource, 'major'>, cooldownDays: number, now = Date.now()): string | null {
  const cutoff = now - cooldownDays * DAY_MS;
  let best: string | null = null;
  for (const r of releases) {
    if (src.major !== undefined && majorOf(r.version) !== src.major) continue;
    if (cooldownDays > 0 && (r.publishedAt === null || r.publishedAt > cutoff)) continue;
    if (!best || compareVersions(r.version, best) > 0) best = r.version;
  }
  return best;
}

/** Replaces every `{{key}}` in the strings of `value` with `values[key]`. */
export function fillVersions<T>(value: T, values: Record<string, string>): T {
  if (typeof value === 'string') return value.replace(/\{\{([a-z][a-z0-9-]*)\}\}/g, (m, k: string) => values[k] ?? m) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => fillVersions(v, values)) as unknown as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillVersions(v, values)])) as T;
  return value;
}

/**
 * Returns the components with every `{{key}}` in their spec replaced by a concrete version, so the rest of the
 * installer only ever sees exact versions (an MCP launch line never floats between agent sessions; `check` and
 * `update` have something to compare). On the `latest` channel each package is looked up once per run and the newest
 * release that is old enough wins, but never one below the catalog's pin. The stable channel and `--offline` use the pins.
 * `pinsOnly` (uninstall) does no network I/O and prefers `recorded`, the versions the host was last converged to.
 */
export async function resolveVersions(components: Component[], ctx: Ctx, o: { pinsOnly?: boolean; recorded?: (componentId: string) => Record<string, string> | undefined } = {}): Promise<{ components: Component[]; resolved: ResolvedVersion[] }> {
  const pinsOnly = o.pinsOnly || ctx.offline || ctx.channel === 'stable';
  const resolved: ResolvedVersion[] = []; const warned = new Set<string>();
  const out = await Promise.all(components.map(async (c) => {
    if (!c.versions) return c;
    const values: Record<string, string> = {};
    for (const [key, src] of Object.entries(c.versions)) {
      let version = (o.pinsOnly && o.recorded?.(c.id)?.[key]) || src.pin; let how: ResolvedVersion['how'] = 'pin';
      if (!pinsOnly) {
        const releases = await memo(ctx, `releases:${src.registry}:${src.package}`, () => LISTERS[src.registry](ctx.fetch, src.package));
        const picked = releases ? pickRelease(releases, src, ctx.cooldownDays) : null;
        if (picked) { how = 'latest'; if (compareVersions(picked, src.pin) > 0) version = picked; }
        else {
          how = 'fallback';
          if (!warned.has(src.package)) { warned.add(src.package); ctx.log.warn(`${src.package}: ${releases ? `no ${src.major !== undefined ? `${src.major}.x ` : ''}release at least ${ctx.cooldownDays} day(s) old` : `could not read the ${src.registry} registry`}; using the catalog pin ${src.pin}`); }
        }
      }
      values[key] = version; resolved.push({ componentId: c.id, key, package: src.package, version, how });
    }
    return { ...c, spec: fillVersions(c.spec, values) };
  }));
  return { components: out, resolved };
}

/** One log line for the run header: which versions the registry packages resolved to, and under which policy. */
export function describeResolution(ctx: Ctx, resolved: ResolvedVersion[]): string | null {
  const seen = new Map<string, ResolvedVersion>(); for (const r of resolved) if (!seen.has(r.package)) seen.set(r.package, r);
  if (!seen.size) return null;
  const policy = ctx.offline ? 'offline: catalog pins' : ctx.channel === 'stable' ? 'stable channel: catalog pins' : `latest${ctx.cooldownDays ? `, at least ${ctx.cooldownDays} day(s) old` : ''}`;
  return `versions (${policy}): ${[...seen.values()].map((r) => `${r.package} ${r.version}${r.how === 'fallback' ? ' (pin, lookup failed)' : ''}`).join(', ')}`;
}
