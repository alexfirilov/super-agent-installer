import type { Ctx } from '../types.js';

/** Result of a best-effort key check: `ok: false` only when the remote service positively rejected the
 * key (401/403); any network failure or unexpected status is `ok: true` with an "inconclusive" warning
 * so validation never blocks an install on a flaky network. */
export type KeyCheck = { ok: boolean; summary: string; warnings: string[] };

const NEEDED_GITHUB_SCOPES = ['repo', 'public_repo'];
const OVERBROAD_GITHUB_SCOPES = ['delete_repo', 'admin:org', 'admin:enterprise', 'site_admin'];

async function validateContext7(ctx: Ctx, value: string): Promise<KeyCheck> {
  try {
    const res = await ctx.fetch('https://context7.com/api/v2/libs/search?query=react', { headers: { Authorization: `Bearer ${value}` } });
    if (res.status === 200) return { ok: true, summary: 'key accepted', warnings: [] };
    if (res.status === 401) return { ok: false, summary: 'key rejected (invalid)', warnings: [] };
    if (res.status === 403) return { ok: false, summary: 'key rejected (restricted)', warnings: [] };
    return { ok: true, summary: 'validation inconclusive', warnings: [`validation inconclusive: context7.com returned ${res.status}`] };
  } catch {
    return { ok: true, summary: 'validation inconclusive', warnings: ['validation inconclusive: could not reach context7.com'] };
  }
}

async function validateGithubPat(ctx: Ctx, value: string): Promise<KeyCheck> {
  try {
    const res = await ctx.fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${value}` } });
    if (res.status === 401) return { ok: false, summary: 'token rejected (invalid)', warnings: [] };
    if (res.status === 200) {
      const scopesHeader = res.headers.get('x-oauth-scopes');
      if (scopesHeader !== null && scopesHeader.trim() !== '') {
        const scopes = scopesHeader.split(',').map((s) => s.trim()).filter(Boolean);
        const warnings: string[] = [];
        if (!scopes.some((sc) => NEEDED_GITHUB_SCOPES.includes(sc))) warnings.push(`missing a scope the github plugin needs (repo or public_repo); has: ${scopes.join(', ') || '(none)'}`);
        const overbroad = scopes.filter((sc) => OVERBROAD_GITHUB_SCOPES.includes(sc));
        if (overbroad.length) warnings.push(`token grants broader access than needed: ${overbroad.join(', ')}`);
        return { ok: true, summary: `classic PAT, scopes: ${scopes.join(', ') || '(none)'}`, warnings };
      }
      return { ok: true, summary: 'fine-grained PAT (GitHub exposes no scope introspection for these; check its permissions in Settings if unsure)', warnings: [] };
    }
    return { ok: true, summary: 'validation inconclusive', warnings: [`validation inconclusive: api.github.com returned ${res.status}`] };
  } catch {
    return { ok: true, summary: 'validation inconclusive', warnings: ['validation inconclusive: could not reach api.github.com'] };
  }
}

export async function validateSecret(ctx: Ctx, env: string, value: string): Promise<KeyCheck> {
  if (env === 'CONTEXT7_API_KEY') return validateContext7(ctx, value);
  if (env === 'GITHUB_PERSONAL_ACCESS_TOKEN' || env === 'GITHUB_PAT_TOKEN') return validateGithubPat(ctx, value);
  return { ok: true, summary: 'no validator', warnings: [] };
}
