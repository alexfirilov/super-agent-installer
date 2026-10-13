import { describe, it, expect } from 'vitest';
import { pickRelease, npmReleases, pypiReleases, goReleases, resolveVersions, fillVersions, describeResolution, type Release } from '../../src/version/resolve.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';

const DAY = 86_400_000; const NOW = Date.now(); // resolveVersions reads the real clock, so fixtures are dated relative to it
const ago = (days: number) => NOW - days * DAY;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
/** fetch double: url -> body (404 for anything unlisted); records every url asked for. */
function fakeFetch(routes: Record<string, unknown>): typeof fetch & { urls: string[] } {
  const urls: string[] = [];
  const f = (async (url: string | URL) => { const u = String(url); urls.push(u); return u in routes ? (typeof routes[u] === 'string' ? new Response(routes[u] as string) : json(routes[u])) : new Response('nope', { status: 404 }); }) as typeof fetch & { urls: string[] };
  f.urls = urls; return f;
}
const iso = (days: number) => new Date(ago(days)).toISOString();

describe('pickRelease', () => {
  const rel: Release[] = [{ version: '1.9.0', publishedAt: ago(30) }, { version: '2.0.0', publishedAt: ago(10) }, { version: '2.1.0', publishedAt: ago(2) }, { version: '2.2.0', publishedAt: null }];
  it('takes the newest release that is old enough', () => {
    expect(pickRelease(rel, {}, 3, NOW)).toBe('2.0.0');
    expect(pickRelease(rel, {}, 1, NOW)).toBe('2.1.0');
    expect(pickRelease(rel, {}, 60, NOW)).toBeNull();
  });
  it('with no cooldown takes the newest, dated or not', () => { expect(pickRelease(rel, {}, 0, NOW)).toBe('2.2.0'); });
  it('stays on a held major line', () => { expect(pickRelease(rel, { major: 1 }, 0, NOW)).toBe('1.9.0'); expect(pickRelease(rel, { major: 3 }, 0, NOW)).toBeNull(); });
  it('compares numerically, not as strings', () => { expect(pickRelease([{ version: '0.10.0', publishedAt: ago(9) }, { version: '0.9.9', publishedAt: ago(9) }], {}, 3, NOW)).toBe('0.10.0'); });
});

describe('registry listers', () => {
  it('npm: skips prereleases, deprecated versions and anything above the latest dist-tag', async () => {
    const f = fakeFetch({ 'https://registry.npmjs.org/@scope%2Fpkg': { 'dist-tags': { latest: '1.2.0' }, versions: { '1.0.0': {}, '1.1.0': { deprecated: 'broken' }, '1.2.0': {}, '1.3.0-beta.1': {}, '9.0.0': {} }, time: { '1.0.0': iso(40), '1.2.0': iso(5), '9.0.0': iso(1) } } });
    expect(await npmReleases(f, '@scope/pkg')).toEqual([{ version: '1.0.0', publishedAt: ago(40) }, { version: '1.2.0', publishedAt: ago(5) }]);
  });
  it('pypi: a release counts while one file is not yanked, dated by its earliest upload; pre-releases are out', async () => {
    const f = fakeFetch({ 'https://pypi.org/pypi/pkg/json': { releases: { '0.5.0': [{ upload_time_iso_8601: iso(20), yanked: false }, { upload_time_iso_8601: iso(19) }], '0.6.0': [{ upload_time_iso_8601: iso(2), yanked: true }], '0.7.0rc1': [{ upload_time_iso_8601: iso(1) }], '0.4.0': [] } } });
    expect(await pypiReleases(f, 'pkg')).toEqual([{ version: '0.5.0', publishedAt: ago(20) }]);
  });
  it('go: lists via the module proxy, dates via .info, escapes capitals', async () => {
    const base = 'https://proxy.golang.org/github.com/!foo/bar/@v';
    const f = fakeFetch({ [`${base}/list`]: 'v0.1.0\nv0.2.0\nv0.3.0-pre.1\n', [`${base}/v0.2.0.info`]: { Version: 'v0.2.0', Time: iso(4) }, [`${base}/v0.1.0.info`]: { Version: 'v0.1.0', Time: iso(50) } });
    expect(await goReleases(f, 'github.com/Foo/bar')).toEqual([{ version: '0.2.0', publishedAt: ago(4) }, { version: '0.1.0', publishedAt: ago(50) }]);
  });
  it('a registry that cannot be reached reads as null, not as an empty release list', async () => {
    const f = fakeFetch({});
    expect(await npmReleases(f, 'x')).toBeNull(); expect(await pypiReleases(f, 'x')).toBeNull(); expect(await goReleases(f, 'x')).toBeNull();
  });
});

describe('fillVersions', () => {
  it('fills placeholders everywhere in a spec and leaves ${ENV} references alone', () => {
    expect(fillVersions({ args: ['-y', 'pkg@{{version}}'], env: { A: '${TOKEN}' }, go: 'mod@v{{version}}', other: '{{nope}}' }, { version: '1.2.3' }))
      .toEqual({ args: ['-y', 'pkg@1.2.3'], env: { A: '${TOKEN}' }, go: 'mod@v1.2.3', other: '{{nope}}' });
  });
});

describe('resolveVersions', () => {
  const comp = (id: string, pkg: string, pin: string, extra: Partial<Component> = {}): Component => ({ id, name: id, kind: 'mcp', agents: 'claude', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: true, spec: { kind: 'mcp', target: 'claude', name: id, transport: 'stdio', command: 'npx', args: ['-y', `${pkg}@{{version}}`] }, versions: { version: { registry: 'npm', package: pkg, pin } }, ...extra });
  const args = (c: Component) => (c.spec as { args: string[] }).args[1];
  const registry = { 'https://registry.npmjs.org/pkg': { 'dist-tags': { latest: '2.1.0' }, versions: { '1.0.0': {}, '2.0.0': {}, '2.1.0': {} }, time: { '1.0.0': iso(90), '2.0.0': iso(10), '2.1.0': iso(1) } } };
  const ctxWith = (f: typeof fetch, cooldownDays: number) => { const ctx = makeTestCtx({ fetch: f }); ctx.cooldownDays = cooldownDays; return ctx; };
  it('latest channel: the newest release old enough for the cooldown, looked up once per package', async () => {
    const f = fakeFetch(registry);
    const r = await resolveVersions([comp('a', 'pkg', '1.0.0'), comp('b', 'pkg', '1.0.0')], ctxWith(f, 3));
    expect(r.components.map(args)).toEqual(['pkg@2.0.0', 'pkg@2.0.0']);
    expect(r.resolved.map((x) => x.how)).toEqual(['latest', 'latest']);
    expect(f.urls).toEqual(['https://registry.npmjs.org/pkg']);
    expect((await resolveVersions([comp('a', 'pkg', '1.0.0')], ctxWith(fakeFetch(registry), 0))).components.map(args)).toEqual(['pkg@2.1.0']);
  });
  it('never goes below the catalog pin', async () => {
    expect((await resolveVersions([comp('a', 'pkg', '2.1.0')], ctxWith(fakeFetch(registry), 3))).components.map(args)).toEqual(['pkg@2.1.0']);
  });
  it('falls back to the pin, with one warning, when the registry is unreachable or nothing qualifies', async () => {
    const ctx = ctxWith(fakeFetch({}), 3);
    const r = await resolveVersions([comp('a', 'pkg', '1.0.0'), comp('b', 'pkg', '1.0.0')], ctx);
    expect(r.components.map(args)).toEqual(['pkg@1.0.0', 'pkg@1.0.0']); expect(r.resolved.every((x) => x.how === 'fallback')).toBe(true);
    expect(ctx.log.lines.filter((l) => /using the catalog pin/.test(l))).toHaveLength(1);
    const held = await resolveVersions([comp('a', 'pkg', '1.0.0', { versions: { version: { registry: 'npm', package: 'pkg', pin: '1.0.0', major: 3 } } })], ctxWith(fakeFetch(registry), 0));
    expect(held.components.map(args)).toEqual(['pkg@1.0.0']); expect(held.resolved[0]!.how).toBe('fallback');
  });
  it('stable channel and uninstall use pins (or the recorded version) without touching the network', async () => {
    const f = fakeFetch(registry); const ctx = ctxWith(f, 0); ctx.channel = 'stable';
    expect((await resolveVersions([comp('a', 'pkg', '1.0.0')], ctx)).components.map(args)).toEqual(['pkg@1.0.0']);
    const latest = ctxWith(f, 0);
    expect((await resolveVersions([comp('a', 'pkg', '1.0.0'), comp('b', 'pkg', '1.0.0')], latest, { pinsOnly: true, recorded: (id) => (id === 'a' ? { version: '2.0.0' } : undefined) })).components.map(args)).toEqual(['pkg@2.0.0', 'pkg@1.0.0']);
    const off = ctxWith(f, 0); off.offline = true; const r = await resolveVersions([comp('a', 'pkg', '1.0.0')], off);
    expect(r.components.map(args)).toEqual(['pkg@1.0.0']); expect(describeResolution(off, r.resolved)).toBe('versions (offline: catalog pins): pkg 1.0.0');
    expect(f.urls).toEqual([]);
  });
  it('leaves components without versions untouched and describes the policy in one line', async () => {
    const plain = { ...comp('p', 'x', '1.0.0'), versions: undefined };
    const ctx = ctxWith(fakeFetch(registry), 3); const r = await resolveVersions([plain, comp('a', 'pkg', '1.0.0')], ctx);
    expect(r.components[0]).toBe(plain);
    expect(describeResolution(ctx, r.resolved)).toBe('versions (latest, at least 3 day(s) old): pkg 2.0.0');
    expect(describeResolution(ctx, [])).toBeNull();
  });
});
