export interface AuditResult { level: 'pass' | 'warn' | 'fail' | 'unknown'; scanners: Record<string, string>; riskLevel?: string }

const BLOCKING = ['agent-trust-hub', 'socket', 'snyk'];

export async function auditSkill(f: typeof fetch, owner: string, repo: string, skill: string): Promise<AuditResult> {
  try {
    const r = await f(`https://skills.sh/api/v1/skills/audit/${owner}/${repo}/${skill}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { level: 'unknown', scanners: {} };
    // { id, source, slug, audits: [{ slug, status, riskLevel, ... }] }. A shape we cannot read is `unknown`, never a pass:
    // this parser once walked the top-level keys of this response, found no statuses, and passed every skill.
    const { audits } = (await r.json()) as { audits?: Array<{ slug?: string; provider?: string; status?: string; riskLevel?: string }> };
    if (!Array.isArray(audits)) return { level: 'unknown', scanners: {} };
    const scanners: Record<string, string> = {};
    let riskLevel: string | undefined;
    let level: AuditResult['level'] = 'pass';
    for (const v of audits) {
      const name = v.slug ?? v.provider ?? 'unknown';
      const s = String(v.status ?? 'none').toLowerCase();
      scanners[name] = s;
      if (v.riskLevel) riskLevel = v.riskLevel;
      if (s === 'fail' && BLOCKING.includes(name.toLowerCase())) level = 'fail';
      else if ((s === 'fail' || s === 'warn') && level !== 'fail') level = 'warn';
    }
    if (!Object.keys(scanners).length) return { level: 'unknown', scanners };
    return { level, scanners, riskLevel };
  } catch {
    return { level: 'unknown', scanners: {} };
  }
}

export function auditVerdict(results: AuditResult[]): AuditResult['level'] {
  if (!results.length) return 'unknown';
  if (results.some((r) => r.level === 'fail')) return 'fail';
  if (results.some((r) => r.level === 'warn')) return 'warn';
  if (results.every((r) => r.level === 'pass')) return 'pass';
  return 'unknown';
}
