import { describe, it, expect } from 'vitest';
import { auditSkill, auditVerdict } from '../../src/audit/skills-audit.js';
const mk = (body: unknown, status = 200) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
describe('auditSkill', () => {
  const audit = (...scanners: Array<[string, string, string?]>) => ({ id: 'a/b/c', source: 'a/b', slug: 'c', audits: scanners.map(([slug, status, riskLevel]) => ({ provider: slug, slug, status, summary: 's', auditedAt: 't', ...(riskLevel ? { riskLevel } : {}) })) });
  it('reads the audits array skills.sh returns', async () => {
    expect((await auditSkill(mk(audit(['agent-trust-hub', 'pass', 'SAFE'], ['socket', 'pass'], ['snyk', 'pass'])), 'a', 'b', 'c'))).toMatchObject({ level: 'pass', scanners: { 'agent-trust-hub': 'pass', socket: 'pass', snyk: 'pass' }, riskLevel: 'SAFE' });
    expect((await auditSkill(mk(audit(['agent-trust-hub', 'pass'], ['snyk', 'warn', 'MEDIUM'])), 'a', 'b', 'c')).level).toBe('warn');
  });
  it('blocks on a failed core scanner; another scanner failing only warns', async () => {
    expect((await auditSkill(mk(audit(['agent-trust-hub', 'fail', 'CRITICAL'], ['socket', 'pass'])), 'a', 'b', 'c')).level).toBe('fail');
    expect((await auditSkill(mk(audit(['socket', 'fail'])), 'a', 'b', 'c')).level).toBe('fail');
    expect((await auditSkill(mk(audit(['agent-trust-hub', 'pass'], ['runlayer', 'fail', 'HIGH'])), 'a', 'b', 'c')).level).toBe('warn');
  });
  it('a response it cannot read is unknown, never a pass', async () => {
    expect((await auditSkill(mk({ id: 'a/b/c', source: 'a/b', slug: 'c' }), 'a', 'b', 'c')).level).toBe('unknown');
    expect((await auditSkill(mk({ id: 'a/b/c', audits: [] }), 'a', 'b', 'c')).level).toBe('unknown');
    expect((await auditSkill(mk({ gen: { status: 'fail' } }), 'a', 'b', 'c')).level).toBe('unknown');
  });
  it('returns unknown on errors or empty', async () => {
    expect((await auditSkill(mk({}), 'a', 'b', 'c')).level).toBe('unknown');
    expect((await auditSkill(mk('x', 500), 'a', 'b', 'c')).level).toBe('unknown');
    expect((await auditSkill((async () => { throw new Error('net'); }) as unknown as typeof fetch, 'a', 'b', 'c')).level).toBe('unknown');
  });
  it('combines verdicts', () => { expect(auditVerdict([{ level: 'pass', scanners: {} }, { level: 'warn', scanners: {} }])).toBe('warn'); expect(auditVerdict([{ level: 'fail', scanners: {} }, { level: 'pass', scanners: {} }])).toBe('fail'); expect(auditVerdict([])).toBe('unknown'); });
});
