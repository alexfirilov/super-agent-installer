import { normalizeVersion } from './compare.js';
type F = typeof fetch;
async function text(f: F, url: string): Promise<string | null> { try { const r = await f(url, { redirect: 'follow' }); if (!r.ok) return null; return await r.text(); } catch { return null; } }
export async function latestClaude(f: F, channel: 'latest' | 'stable'): Promise<string | null> { return normalizeVersion(await text(f, `https://downloads.claude.ai/claude-code-releases/${channel}`)); }
export async function latestCodex(f: F): Promise<string | null> {
  const t = await text(f, 'https://releases.openai.com/codex/channels/latest'); if (!t) return null;
  try { return normalizeVersion((JSON.parse(t) as { tag_name?: string }).tag_name ?? ''); } catch { return null; }
}
export async function latestNpm(f: F, pkg: string): Promise<string | null> {
  const t = await text(f, `https://registry.npmjs.org/${pkg.replace('/', '%2F')}/latest`); if (!t) return null;
  try { return normalizeVersion((JSON.parse(t) as { version?: string }).version ?? ''); } catch { return null; }
}
export async function latestGithubRelease(f: F, ownerRepo: string): Promise<string | null> {
  try {
    const r = await f(`https://github.com/${ownerRepo}/releases/latest`, { redirect: 'manual' });
    const loc = r.headers.get('location') ?? (r.url !== `https://github.com/${ownerRepo}/releases/latest` ? r.url : '');
    return normalizeVersion(loc.split('/').pop() ?? '');
  } catch { return null; }
}
