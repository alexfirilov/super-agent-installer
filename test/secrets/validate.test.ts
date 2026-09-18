import { describe, it, expect } from 'vitest';
import { validateSecret } from '../../src/secrets/validate.js';
import { makeTestCtx } from '../helpers/ctx.js';

const mk = (map: Record<string, { status: number; headers?: Record<string, string> }>) =>
  (async (url: string | URL | Request) => {
    const u = String(url);
    const r = map[u];
    if (!r) return new Response('nf', { status: 404 });
    return new Response('', { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;

const throwing = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;

describe('validateSecret', () => {
  it('unknown env name has no validator', async () => {
    const ctx = makeTestCtx();
    expect(await validateSecret(ctx, 'SOME_RANDOM_ENV', 'x')).toEqual({ ok: true, summary: 'no validator', warnings: [] });
  });

  describe('CONTEXT7_API_KEY', () => {
    it('200 is ok', async () => {
      const ctx = makeTestCtx({ fetch: mk({ 'https://context7.com/api/v2/libs/search?query=react': { status: 200 } }) });
      const r = await validateSecret(ctx, 'CONTEXT7_API_KEY', 'ctx7sk-good');
      expect(r.ok).toBe(true);
      expect(r.warnings).toEqual([]);
    });
    it('401 is not ok', async () => {
      const ctx = makeTestCtx({ fetch: mk({ 'https://context7.com/api/v2/libs/search?query=react': { status: 401 } }) });
      const r = await validateSecret(ctx, 'CONTEXT7_API_KEY', 'bad');
      expect(r.ok).toBe(false);
    });
    it('403 is not ok and mentions restricted', async () => {
      const ctx = makeTestCtx({ fetch: mk({ 'https://context7.com/api/v2/libs/search?query=react': { status: 403 } }) });
      const r = await validateSecret(ctx, 'CONTEXT7_API_KEY', 'restricted');
      expect(r.ok).toBe(false);
      expect(r.summary).toMatch(/restricted/);
    });
    it('other status is ok with an inconclusive warning', async () => {
      const ctx = makeTestCtx({ fetch: mk({ 'https://context7.com/api/v2/libs/search?query=react': { status: 500 } }) });
      const r = await validateSecret(ctx, 'CONTEXT7_API_KEY', 'x');
      expect(r.ok).toBe(true);
      expect(r.warnings.some((w) => /inconclusive/.test(w))).toBe(true);
    });
    it('network throw is ok with an inconclusive warning, never blocks', async () => {
      const ctx = makeTestCtx({ fetch: throwing });
      const r = await validateSecret(ctx, 'CONTEXT7_API_KEY', 'x');
      expect(r.ok).toBe(true);
      expect(r.warnings.some((w) => /inconclusive/.test(w))).toBe(true);
    });
  });

  describe('GITHUB_PERSONAL_ACCESS_TOKEN / GITHUB_PAT_TOKEN', () => {
    it('valid classic PAT with repo scope: ok, no warnings', async () => {
      const ctx = makeTestCtx({ fetch: mk({ 'https://api.github.com/user': { status: 200, headers: { 'x-oauth-scopes': 'repo, read:org' } } }) });
      const r = await validateSecret(ctx, 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghp_x');
      expect(r.ok).toBe(true);
      expect(r.warnings).toEqual([]);
      expect(r.summary).toMatch(/repo/);
    });
    it('classic PAT with delete_repo warns over-broad', async () => {
      const ctx = makeTestCtx({ fetch: mk({ 'https://api.github.com/user': { status: 200, headers: { 'x-oauth-scopes': 'repo, delete_repo' } } }) });
      const r = await validateSecret(ctx, 'GITHUB_PAT_TOKEN', 'ghp_x');
      expect(r.ok).toBe(true);
      expect(r.warnings.some((w) => /delete_repo/.test(w))).toBe(true);
    });
    it('classic PAT missing repo/public_repo warns missing', async () => {
      const ctx = makeTestCtx({ fetch: mk({ 'https://api.github.com/user': { status: 200, headers: { 'x-oauth-scopes': 'read:org' } } }) });
      const r = await validateSecret(ctx, 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghp_x');
      expect(r.ok).toBe(true);
      expect(r.warnings.some((w) => /repo/.test(w))).toBe(true);
    });
    it('fine-grained PAT (no x-oauth-scopes header): ok, notes no introspection', async () => {
      const ctx = makeTestCtx({ fetch: mk({ 'https://api.github.com/user': { status: 200 } }) });
      const r = await validateSecret(ctx, 'GITHUB_PERSONAL_ACCESS_TOKEN', 'github_pat_x');
      expect(r.ok).toBe(true);
      expect(r.warnings).toEqual([]);
      expect(r.summary).toMatch(/fine-grained/);
    });
    it('401 is not ok', async () => {
      const ctx = makeTestCtx({ fetch: mk({ 'https://api.github.com/user': { status: 401 } }) });
      const r = await validateSecret(ctx, 'GITHUB_PERSONAL_ACCESS_TOKEN', 'bad');
      expect(r.ok).toBe(false);
    });
    it('network throw is ok with an inconclusive warning', async () => {
      const ctx = makeTestCtx({ fetch: throwing });
      const r = await validateSecret(ctx, 'GITHUB_PAT_TOKEN', 'x');
      expect(r.ok).toBe(true);
      expect(r.warnings.some((w) => /inconclusive/.test(w))).toBe(true);
    });
  });
});
