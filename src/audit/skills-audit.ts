export interface AuditResult { level: 'pass' | 'warn' | 'fail' | 'unknown'; scanners: Record<string, string>; riskLevel?: string }

const BLOCKING = ['gen', 'socket', 'snyk'];

export async function auditSkill(f: typeof fetch, owner: string, repo: string, skill: string): Promise<AuditResult> {
  try {
    const r = await f(`https://skills.sh/api/v1/skills/audit/${owner}/${repo}/${skill}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { level: 'unknown', scanners: {} };
    const j = (await r.json()) as Record<string, { status?: string; riskLevel?: string }>;
    const scanners: Record<string, string> = {};
    let riskLevel: string | undefined;
    let level: AuditResult['level'] = 'pass';
    for (const [name, v] of Object.entries(j)) {
      if (!v || typeof v !== 'object') continue;
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
