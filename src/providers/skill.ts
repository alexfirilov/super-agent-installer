import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { SKILLS_CLI } from '../pins.js';
import { probeVersion } from '../detect/tools.js';
import { auditSkill, auditVerdict, type AuditResult } from '../audit/skills-audit.js';
import { action, ok, fail, skipAction } from './types.js';
type Lock = Record<string, { source: string; skillPath?: string; skillFolderHash?: string }>;
export async function readSkillLock(path: string): Promise<Lock> { try { return ((JSON.parse(await readFile(path, 'utf8')) as { skills?: Lock }).skills) ?? {}; } catch { return {}; } }
const updatedOnce = new WeakSet<Ctx>();
const npx = (...a: string[]) => ['npx', '-y', `skills@${SKILLS_CLI}`, ...a];
export const skillProvider: Provider = {
  kind: 'skill',
  async detect(c, ctx) {
    if (c.spec.kind !== 'skill') return null; const lock = await readSkillLock(join(ctx.host.home, '.agents', '.skill-lock.json'));
    const entries = c.spec.skills === '*' ? Object.values(lock).filter((e) => e.source === (c.spec as { repo: string }).repo) : c.spec.skills.map((s) => lock[s]).filter((e): e is Lock[string] => !!e);
    const want = c.spec.skills === '*' ? 1 : c.spec.skills.length; if (entries.length < want) return null;
    return { version: entries[0]?.skillFolderHash?.slice(0, 7) ?? 'installed' };
  },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'skill') return []; const spec = c.spec;
    if (!(await probeVersion(ctx.run, ['node', '--version']))) return [skipAction(c.id, 'Node.js is required for the skills CLI (select the node tool)', 'node')];
    const named = spec.skills === '*' ? null : spec.skills;
    if (mode === 'uninstall') {
      if (!installed) return [];
      return [action(c.id, 'uninstall', `remove skills from ${spec.repo}`, async () => {
        const lock = await readSkillLock(join(ctx.host.home, '.agents', '.skill-lock.json'));
        const names = named ?? Object.entries(lock).filter(([, e]) => e.source === spec.repo).map(([n]) => n);
        for (const n of names) await ctx.run(npx('remove', n, '-g', '-y'), { allowFailure: true, timeoutMs: 300000 });
        return ok(`removed ${names.join(', ')}`);
      })];
    }
    if (installed) {
      if (mode !== 'update') return [];
      return [action(c.id, 'update', 'update global skills (skills CLI)', async () => {
        if (updatedOnce.has(ctx)) return ok('global skills already updated this run', false); updatedOnce.add(ctx);
        const r = await ctx.run(npx('update', '-g', '-y'), { allowFailure: true, timeoutMs: 600000 }); if (r.code !== 0) return fail(`skills update failed: ${(r.stderr || r.stdout).trim()}`);
        return ok(/up to date/i.test(r.stdout) ? 'global skills up to date' : 'global skills updated', !/up to date/i.test(r.stdout));
      }, { from: installed.version, to: null })];
    }
    return [action(c.id, 'install', `install ${named ? named.join(', ') : 'all skills'} from ${spec.repo}`, async () => {
      if (!ctx.noAudit) {
        const targets = c.audit ?? (named ? named.map((s) => { const [owner = '', repo = ''] = spec.repo.replace(/^https:\/\/github\.com\//, '').split('/'); return { owner, repo, skill: s }; }) : []);
        const results: AuditResult[] = []; for (const t of targets) results.push(await auditSkill(ctx.fetch, t.owner, t.repo, t.skill));
        const v = auditVerdict(results);
        if (v === 'fail') return fail(`skills.sh audit FAILED for ${spec.repo}: ${results.map((r) => JSON.stringify(r.scanners)).join(' ')}. Rerun with --no-audit to override.`);
        if (v === 'warn') ctx.log.warn(`skills.sh audit warnings for ${spec.repo}: ${results.map((r) => `${r.riskLevel ?? ''} ${JSON.stringify(r.scanners)}`).join(' ')}`);
        if (v === 'unknown' && targets.length) ctx.log.warn(`skills.sh audit unavailable for ${spec.repo}`);
        if (!targets.length) ctx.log.warn(`audit skipped: no audit targets for ${spec.repo}`);
      }
      const argv = npx('add', spec.repo, ...(named ? named.flatMap((s) => ['--skill', s]) : ['--skill', '*']), '-g', ...spec.targets.flatMap((t) => ['-a', t]), '-y');
      if (ctx.host.platform === 'windows' && ctx.host.windowsDeveloperMode === false) argv.push('--copy');
      const r = await ctx.run(argv, { allowFailure: true, timeoutMs: 600000 }); if (r.code !== 0) return fail(`skills add failed: ${(r.stderr || r.stdout).trim()}`);
      // the skills CLI exits 0 and says nothing when a --skill name does not exist in the repo; check the lock so a typo in the manifest is a visible failure instead of an install that repeats on every run
      if (named && !ctx.dryRun) {
        const lock = await readSkillLock(join(ctx.host.home, '.agents', '.skill-lock.json'));
        if (Object.keys(lock).length) { const missing = named.filter((s) => !lock[s]); if (missing.length) return fail(`skills add reported success but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in ~/.agents/.skill-lock.json: no skill with that name in ${spec.repo}?`); }
      }
      return ok(`installed ${named ? named.join(', ') : spec.repo}`);
    })];
  },
};
