import { describe, it, expect } from 'vitest';
import { latestClaude, latestCodex, latestNpm, latestGithubRelease } from '../../src/version/latest.js';
const mk = (map: Record<string, { status: number; body?: string; location?: string }>) => (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url); const r = map[u]; if (!r) return new Response('nf', { status: 404 });
  return new Response(r.body ?? '', { status: r.status, headers: r.location ? { location: r.location } : {} });
}) as unknown as typeof fetch;
describe('latest probes', () => {
  it('reads Claude channels', async () => {
    const f = mk({ 'https://downloads.claude.ai/claude-code-releases/latest': { status: 200, body: '2.1.274\n' }, 'https://downloads.claude.ai/claude-code-releases/stable': { status: 200, body: '2.1.267' } });
    expect(await latestClaude(f, 'latest')).toBe('2.1.274');
    expect(await latestClaude(f, 'stable')).toBe('2.1.267');
  });
  it('reads Codex channel json', async () => {
    const f = mk({ 'https://releases.openai.com/codex/channels/latest': { status: 200, body: JSON.stringify({ tag_name: 'rust-v0.154.0' }) } });
    expect(await latestCodex(f)).toBe('0.154.0');
  });
  it('reads npm dist-tags', async () => {
    const f = mk({ 'https://registry.npmjs.org/@caveman-ai%2Fcli/latest': { status: 200, body: JSON.stringify({ version: '1.3.4' }) } });
    expect(await latestNpm(f, '@caveman-ai/cli')).toBe('1.3.4');
  });
  it('reads GitHub release tag from the redirect target without the API', async () => {
    const f = mk({ 'https://github.com/rtk-ai/rtk/releases/latest': { status: 302, location: 'https://github.com/rtk-ai/rtk/releases/tag/v0.49.0' } });
    expect(await latestGithubRelease(f, 'rtk-ai/rtk')).toBe('0.49.0');
  });
  it('returns null on network failure', async () => {
    const f = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await latestClaude(f, 'latest')).toBeNull();
  });
});
