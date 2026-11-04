import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { skillProvider, skillsCliVersion } from '../../src/providers/skill.js';
import { SKILLS_CLI } from '../../src/pins.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const skill = (id: string, repo: string, skills: string[] | '*', targets: Array<'claude-code' | 'codex'> = ['claude-code', 'codex'], audit?: Component['audit'], postInstall?: string[][]): Component => ({ id, name: id, kind: 'skill', agents: 'both', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'recommended', defaultSelected: true, audit, spec: { kind: 'skill', repo, skills, targets, postInstall } });
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
  it('fails when skills add exits 0 but a named skill never landed in the lock file (found by real-host apply: the skills CLI ignores unknown names)', async () => {
    const cmd = `npx -y skills@${SKILLS_CLI} add a/b --skill real --skill nope -g -a claude-code -a codex -y`;
    const ctx = makeTestCtx({ fetch: auditFetch('pass'), responses: { 'node --version': 'v24.19.0', [cmd]: 'installed' } });
    withLock(ctx, { real: { source: 'a/b', skillFolderHash: 'abc' } });
    const r = await (await skillProvider.plan(skill('sk-ab', 'a/b', ['real', 'nope']), ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(false); expect(r.message).toMatch(/nope/); expect(r.message).not.toMatch(/\breal\b/);
    const good = makeTestCtx({ fetch: auditFetch('pass'), responses: { 'node --version': 'v24.19.0', [cmd]: 'installed' } });
    withLock(good, { real: { source: 'a/b' }, nope: { source: 'a/b' } });
    expect((await (await skillProvider.plan(skill('sk-ab', 'a/b', ['real', 'nope']), good, null, 'install'))[0]!.run(good)).ok).toBe(true);
  });
  it('blocks on audit fail unless --no-audit, warns on warn', async () => {
    const ctx = makeTestCtx({ fetch: auditFetch('fail'), responses: { 'node --version': 'v24.19.0' } });
    const r = await (await skillProvider.plan(skill('sk-bad', 'evil/skills', ['x']), ctx, null, 'install'))[0]!.run(ctx); expect(r.ok).toBe(false); expect(r.message).toMatch(/--no-audit/);
    const warn = makeTestCtx({ fetch: auditFetch('warn'), responses: { 'node --version': 'v24.19.0', [`npx -y skills@${SKILLS_CLI} add a/b --skill x -g -a codex -y`]: '' } });
    expect((await (await skillProvider.plan(skill('sk-w', 'a/b', ['x'], ['codex']), warn, null, 'install'))[0]!.run(warn)).ok).toBe(true);
    expect(warn.log.lines.some((l) => /WARN.*audit/.test(l))).toBe(true);
  });
  it('removes by name on uninstall', async () => {
    const ctx = makeTestCtx({ responses: { 'node --version': 'v24.19.0' } }); withLock(ctx, { x: { source: 'a/b', skillFolderHash: 'abc' } });
    const c = skill('sk', 'a/b', ['x']); const inst = await skillProvider.detect(c, ctx);
    await (await skillProvider.plan(c, ctx, inst, 'uninstall'))[0]!.run(ctx);
    expect(ctx.calls).toContainEqual(['npx', '-y', `skills@${SKILLS_CLI}`, 'remove', 'x', '-g', '-y']);
  });
  it('a failed removal is a failure, and a same-named skill from another repo is left alone', async () => {
    const remove = (n: string) => `npx -y skills@${SKILLS_CLI} remove ${n} -g -y`;
    const ctx = makeTestCtx({ responses: { 'node --version': 'v24.19.0', [remove('x')]: { code: 1, stderr: 'locked' } } });
    withLock(ctx, { x: { source: 'a/b', skillFolderHash: 'abc' }, y: { source: 'someone/else', skillFolderHash: 'def' } });
    const c = skill('sk', 'a/b', ['x', 'y']);
    const r = await (await skillProvider.plan(c, ctx, { version: 'abc' }, 'uninstall'))[0]!.run(ctx);
    expect(r.ok).toBe(false); expect(r.message).toMatch(/could not remove x/);
    expect(ctx.calls.some((a) => a.join(' ') === remove('y'))).toBe(false);
  });
  describe('staying current', () => {
    const check = `npx -y skills@${SKILLS_CLI} check -g`; const c = skill('sk', 'a/b', ['x', 'y']);
    const hosted = (responses: Record<string, string | { code: number; stdout?: string; stderr?: string }>, fetch: typeof globalThis.fetch = auditFetch('pass')) => {
      const ctx = makeTestCtx({ fetch, responses: { 'node --version': 'v24.19.0', ...responses } });
      withLock(ctx, { x: { source: 'a/b', skillFolderHash: 'abc' }, y: { source: 'a/b', skillFolderHash: 'def' } });
      return ctx;
    };
    it('a re-run of install refreshes a stale skill, by name, leaving skills the user added alone', async () => {
      const update = `npx -y skills@${SKILLS_CLI} update x y -g -y`;
      const ctx = hosted({ [check]: '\x1b[38;5;145m↑ x has an update\x1b[0m', [update]: '✓ Updated 1 skill(s)' });
      const acts = await skillProvider.plan(c, ctx, { version: 'abc' }, 'install');
      expect(acts[0]).toMatchObject({ op: 'update' });
      expect(await acts[0]!.run(ctx)).toMatchObject({ ok: true, changed: true });
      expect(ctx.calls.some((a) => a.join(' ') === update)).toBe(true);
      expect(ctx.calls.some((a) => a.join(' ').endsWith('update -g -y'))).toBe(false);
    });
    it('plans nothing when upstream has nothing new', async () => {
      const ctx = hosted({ [check]: '✓ All global skills are up to date' });
      expect(await skillProvider.plan(c, ctx, { version: 'abc' }, 'update')).toEqual([]);
      expect(await skillProvider.stale!(c, ctx)).toBe(false);
    });
    it('attempts the update when the check could not tell', async () => {
      const ctx = hosted({ [check]: { code: 1, stderr: 'network down' } });
      expect(await skillProvider.stale!(c, ctx)).toBeNull();
      expect((await skillProvider.plan(c, ctx, { version: 'abc' }, 'update'))[0]).toMatchObject({ op: 'update' });
    });
    it('believes the report over the exit code: on Windows the CLI can die on a libuv assertion after finishing', async () => {
      const update = `npx -y skills@${SKILLS_CLI} update x y -g -y`;
      const crash = 'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 94';
      const ctx = hosted({ [check]: { code: 3221226505, stdout: '↑ y has an update', stderr: crash }, [update]: { code: 3221226505, stdout: '✓ Updated 1 skill(s)', stderr: crash } });
      expect(await skillProvider.stale!(c, ctx)).toBe(true);
      expect(await (await skillProvider.plan(c, ctx, { version: 'abc' }, 'update'))[0]!.run(ctx)).toMatchObject({ ok: true, changed: true });
    });
    it('a failed update is a failure, also when another skill in the batch worked', async () => {
      const update = `npx -y skills@${SKILLS_CLI} update x y -g -y`;
      const ctx = hosted({ [check]: '↑ x has an update', [update]: '✓ Updated 1 skill(s)\nFailed to update 1 skill(s)' });
      expect((await (await skillProvider.plan(c, ctx, { version: 'abc' }, 'update'))[0]!.run(ctx)).ok).toBe(false);
    });
    it('an update passes the audit gate too: a failed audit keeps the current version', async () => {
      const ctx = hosted({ [check]: '↑ x has an update' }, auditFetch('fail'));
      const r = await (await skillProvider.plan(c, ctx, { version: 'abc' }, 'update'))[0]!.run(ctx);
      expect(r.ok).toBe(false); expect(r.message).toMatch(/audit FAILED/);
      expect(ctx.calls.some((a) => a.includes('update'))).toBe(false);
    });
    it('sets DISABLE_TELEMETRY on the CLI child only, never in the environment agents inherit', async () => {
      const ctx = hosted({ [check]: '↑ x has an update' });
      await skillProvider.stale!(c, ctx);
      expect(ctx.opts.find((o) => o.argv.includes('check'))?.opts.env).toEqual({ DISABLE_TELEMETRY: '1' });
      expect(process.env.DISABLE_TELEMETRY).toBeUndefined(); expect(ctx.env.DISABLE_TELEMETRY).toBeUndefined();
    });
  });
  describe('skillsCliVersion', () => {
    const packument = (versions: string[]) => (async () => new Response(JSON.stringify({ 'dist-tags': { latest: versions.at(-1) }, versions: Object.fromEntries(versions.map((v) => [v, {}])), time: Object.fromEntries(versions.map((v) => [v, '2020-01-01T00:00:00Z'])) }))) as unknown as typeof fetch;
    it('takes the newest release on the latest channel, never below the pin', async () => {
      expect(await skillsCliVersion(makeTestCtx({ fetch: packument([SKILLS_CLI, '99.0.0']) }))).toBe('99.0.0');
      expect(await skillsCliVersion(makeTestCtx({ fetch: packument(['0.0.1']) }))).toBe(SKILLS_CLI);
    });
    it('uses the pin on stable, offline, and when the registry cannot be read', async () => {
      const stable = makeTestCtx({ fetch: packument(['99.0.0']) }); stable.channel = 'stable'; expect(await skillsCliVersion(stable)).toBe(SKILLS_CLI);
      const offline = makeTestCtx({ fetch: packument(['99.0.0']) }); offline.offline = true; expect(await skillsCliVersion(offline)).toBe(SKILLS_CLI);
      expect(await skillsCliVersion(makeTestCtx({ fetch: (async () => { throw new Error('down'); }) as unknown as typeof fetch }))).toBe(SKILLS_CLI);
    });
  });
  it('skips without node', async () => { const ctx = makeTestCtx({ responses: {} }); expect((await skillProvider.plan(skill('sk', 'a/b', ['x']), ctx, null, 'install'))[0]).toMatchObject({ op: 'skip' }); });
  it('runs postInstall argv in order after a successful install', async () => {
    const cmd = `npx -y skills@${SKILLS_CLI} add a/b --skill x -g -a claude-code -a codex -y`;
    const ctx = makeTestCtx({ fetch: auditFetch('pass'), responses: { 'node --version': 'v24.19.0', [cmd]: 'installed' } });
    const c = skill('sk-pi', 'a/b', ['x'], ['claude-code', 'codex'], undefined, [['npm', 'install', '-g', 'agent-browser'], ['agent-browser', 'install']]);
    const r = await (await skillProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true);
    expect(ctx.calls).toContainEqual(['npm', 'install', '-g', 'agent-browser']);
    expect(ctx.calls).toContainEqual(['agent-browser', 'install']);
    // ran in order, after the skills add
    const idxAdd = ctx.calls.findIndex((a) => a.join(' ') === cmd);
    const idxNpm = ctx.calls.findIndex((a) => a.join(' ') === 'npm install -g agent-browser');
    const idxBrowser = ctx.calls.findIndex((a) => a.join(' ') === 'agent-browser install');
    expect(idxAdd).toBeLessThan(idxNpm);
    expect(idxNpm).toBeLessThan(idxBrowser);
  });
  it('fails the action when a postInstall command exits non-zero, and does not run the ones after it', async () => {
    const cmd = `npx -y skills@${SKILLS_CLI} add a/b --skill x -g -a claude-code -a codex -y`;
    const ctx = makeTestCtx({ fetch: auditFetch('pass'), responses: { 'node --version': 'v24.19.0', [cmd]: 'installed', 'npm install -g agent-browser': { code: 1, stderr: 'boom' } } });
    const c = skill('sk-pf', 'a/b', ['x'], ['claude-code', 'codex'], undefined, [['npm', 'install', '-g', 'agent-browser'], ['agent-browser', 'install']]);
    const r = await (await skillProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/post-install command failed/);
    expect(r.message).toMatch(/boom/);
    expect(ctx.calls).not.toContainEqual(['agent-browser', 'install']);
  });
  it('skips the audit fetch entirely when ctx.noAudit is true', async () => {
    let fetchCalled = false;
    const fetchSpy = (async (u: string) => { if (!String(u).includes('registry.npmjs.org')) fetchCalled = true; return new Response(JSON.stringify({ gen: { status: 'fail' } })); }) as unknown as typeof fetch;
    const ctx = makeTestCtx({ fetch: fetchSpy, responses: { 'node --version': 'v24.19.0', [`npx -y skills@${SKILLS_CLI} add a/b --skill x -g -a claude-code -a codex -y`]: 'installed' } });
    ctx.noAudit = true;
    const r = await (await skillProvider.plan(skill('sk-noaudit', 'a/b', ['x']), ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true);
    expect(fetchCalled).toBe(false);
  });
  it('warns when a skills: "*" component has no audit targets, and audits the manifest audit entries when present', async () => {
    const cmd = `npx -y skills@${SKILLS_CLI} add a/b --skill * -g -a claude-code -a codex -y`;
    const ctx = makeTestCtx({ fetch: auditFetch('pass'), responses: { 'node --version': 'v24.19.0', [cmd]: 'installed' } });
    expect((await (await skillProvider.plan(skill('sk-all', 'a/b', '*'), ctx, null, 'install'))[0]!.run(ctx)).ok).toBe(true);
    expect(ctx.log.lines.some((l) => /audit skipped: no audit targets for a\/b/.test(l))).toBe(true);
    const urls: string[] = []; const f = (async (u: string) => { urls.push(String(u)); return new Response(JSON.stringify({ gen: { status: 'pass' } })); }) as unknown as typeof fetch;
    const audited = makeTestCtx({ fetch: f, responses: { 'node --version': 'v24.19.0', [cmd]: 'installed' } });
    expect((await (await skillProvider.plan(skill('sk-all', 'a/b', '*', ['claude-code', 'codex'], [{ owner: 'a', repo: 'b', skill: 'one' }]), audited, null, 'install'))[0]!.run(audited)).ok).toBe(true);
    expect(urls.some((u) => /a\/b\/one/.test(u))).toBe(true); expect(audited.log.lines.some((l) => /audit skipped/.test(l))).toBe(false);
  });
});
