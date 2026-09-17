import { describe, it, expect } from 'vitest';
import { auditSkill, auditVerdict } from '../../src/audit/skills-audit.js';
const mk = (body: unknown, status = 200) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
describe('auditSkill', () => {
  it('maps scanner statuses', async () => {
    expect((await auditSkill(mk({ gen: { status: 'pass' }, socket: { status: 'pass' }, snyk: { status: 'warn', riskLevel: 'MEDIUM' }, runlayer: { status: 'none' }, zeroleaks: { status: 'none' } }), 'a', 'b', 'c')).level).toBe('warn');
    expect((await auditSkill(mk({ gen: { status: 'fail' } }), 'a', 'b', 'c')).level).toBe('fail');
    expect((await auditSkill(mk({ gen: { status: 'pass' }, runlayer: { status: 'fail', riskLevel: 'HIGH' } }), 'a', 'b', 'c')).level).toBe('warn');
    expect((await auditSkill(mk({ gen: { status: 'pass' }, socket: { status: 'pass' }, snyk: { status: 'pass' } }), 'a', 'b', 'c')).level).toBe('pass');
  });
  it('returns unknown on errors or empty', async () => {
    expect((await auditSkill(mk({}), 'a', 'b', 'c')).level).toBe('unknown');
    expect((await auditSkill(mk('x', 500), 'a', 'b', 'c')).level).toBe('unknown');
    expect((await auditSkill((async () => { throw new Error('net'); }) as unknown as typeof fetch, 'a', 'b', 'c')).level).toBe('unknown');
  });
  it('combines verdicts', () => { expect(auditVerdict([{ level: 'pass', scanners: {} }, { level: 'warn', scanners: {} }])).toBe('warn'); expect(auditVerdict([{ level: 'fail', scanners: {} }, { level: 'pass', scanners: {} }])).toBe('fail'); expect(auditVerdict([])).toBe('unknown'); });
});
