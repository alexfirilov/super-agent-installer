import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { skillProvider } from '../../src/providers/skill.js';
import { SKILLS_CLI } from '../../src/pins.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const skill = (id: string, repo: string, skills: string[] | '*', targets: Array<'claude-code' | 'codex'> = ['claude-code', 'codex'], audit?: Component['audit']): Component => ({ id, name: id, kind: 'skill', agents: 'both', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'recommended', defaultSelected: true, audit, spec: { kind: 'skill', repo, skills, targets } });
const auditFetch = (level: 'pass' | 'warn' | 'fail') => (async () => new Response(JSON.stringify({ gen: { status: level === 'fail' ? 'fail' : 'pass' }, snyk: { status: level === 'warn' ? 'warn' : 'pass' } }))) as unknown as typeof fetch;
function withLock(ctx: ReturnType<typeof makeTestCtx>, skills: Record<string, { source: string; skillFolderHash?: string }>) { mkdirSync(join(ctx.host.home, '.agents'), { recursive: true }); writeFileSync(join(ctx.host.home, '.agents', '.skill-lock.json'), JSON.stringify({ version: 3, skills })); }
describe('skillProvider', () => {
  it('detects from the lock file', async () => {
    const ctx = makeTestCtx({ responses: { 'node --version': 'v24.19.0' } }); withLock(ctx, { 'find-skills': { source: 'vercel-labs/skills', skillFolderHash: 'abcdef1234' } });
    expect(await skillProvider.detect(skill('sk-find', 'vercel-labs/skills', ['find-skills']), ctx)).toEqual({ version: 'abcdef1' });
    expect(await skillProvider.detect(skill('sk-x', 'a/b', ['nope']), ctx)).toBeNull();
    expect(await skillProvider.detect(skill('sk-all', 'vercel-labs/skills', '*'), ctx)).toMatchObject({ version: 'abcdef1' });
  });
  it('installs with audit pass and adds --copy on Windows without developer mode', async () => {
    const cmd = `npx -y skills@${SKILLS_CLI} add mattpocock/skills --skill grill-me --skill tdd -g -a claude-code -a codex -y`;
    const ctx = makeTestCtx({ fetch: auditFetch('pass'), responses: { 'node --version': 'v24.19.0', [cmd]: 'installed' } });
    const r = await (await skillProvider.plan(skill('sk-mp', 'mattpocock/skills', ['grill-me', 'tdd']), ctx, null, 'install'))[0]!.run(ctx); expect(r.ok).toBe(true);
    const win = makeTestCtx({ host: { platform: 'windows', windowsDeveloperMode: false }, fetch: auditFetch('pass'), responses: { 'node --version': 'v24.19.0', [`${cmd} --copy`]: 'installed' } });
    expect((await (await skillProvider.plan(skill('sk-mp', 'mattpocock/skills', ['grill-me', 'tdd']), win, null, 'install'))[0]!.run(win)).ok).toBe(true);
  });
  it('blocks on audit fail unless --no-audit, warns on warn', async () => {
    const ctx = makeTestCtx({ fetch: auditFetch('fail'), responses: { 'node --version': 'v24.19.0' } });
    const r = await (await skillProvider.plan(skill('sk-bad', 'evil/skills', ['x']), ctx, null, 'install'))[0]!.run(ctx); expect(r.ok).toBe(false); expect(r.message).toMatch(/--no-audit/);
    const warn = makeTestCtx({ fetch: auditFetch('warn'), responses: { 'node --version': 'v24.19.0', [`npx -y skills@${SKILLS_CLI} add a/b --skill x -g -a codex -y`]: '' } });
    expect((await (await skillProvider.plan(skill('sk-w', 'a/b', ['x'], ['codex']), warn, null, 'install'))[0]!.run(warn)).ok).toBe(true);
    expect(warn.log.lines.some((l) => /WARN.*audit/.test(l))).toBe(true);
  });
  it('updates once per run and removes on uninstall', async () => {
    const ctx = makeTestCtx({ responses: { 'node --version': 'v24.19.0', [`npx -y skills@${SKILLS_CLI} update -g -y`]: '✓ All global skills are up to date', [`npx -y skills@${SKILLS_CLI} remove x -g -y`]: '' } }); withLock(ctx, { x: { source: 'a/b' } });
    const c = skill('sk', 'a/b', ['x']); const inst = await skillProvider.detect(c, ctx);
    const r = await (await skillProvider.plan(c, ctx, inst, 'update'))[0]!.run(ctx); expect(r).toMatchObject({ ok: true, changed: false });
    await (await skillProvider.plan(skill('sk2', 'a/b', ['x']), ctx, inst, 'update'))[0]!.run(ctx); expect(ctx.calls.filter((a) => a.includes('update')).length).toBe(1);
    await (await skillProvider.plan(c, ctx, inst, 'uninstall'))[0]!.run(ctx); expect(ctx.calls).toContainEqual(['npx', '-y', `skills@${SKILLS_CLI}`, 'remove', 'x', '-g', '-y']);
  });
  it('skips without node', async () => { const ctx = makeTestCtx({ responses: {} }); expect((await skillProvider.plan(skill('sk', 'a/b', ['x']), ctx, null, 'install'))[0]).toMatchObject({ op: 'skip' }); });
  it('skips the audit fetch entirely when ctx.noAudit is true', async () => {
    let fetchCalled = false;
    const fetchSpy = (async () => { fetchCalled = true; return new Response(JSON.stringify({ gen: { status: 'fail' } })); }) as unknown as typeof fetch;
    const ctx = makeTestCtx({ fetch: fetchSpy, responses: { 'node --version': 'v24.19.0', [`npx -y skills@${SKILLS_CLI} add a/b --skill x -g -a claude-code -a codex -y`]: 'installed' } });
    ctx.noAudit = true;
    const r = await (await skillProvider.plan(skill('sk-noaudit', 'a/b', ['x']), ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true);
    expect(fetchCalled).toBe(false);
  });
});
