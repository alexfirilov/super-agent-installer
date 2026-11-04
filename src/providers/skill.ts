import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Action, Component, Ctx, Installed, Provider, SkillSpec } from '../types.js';
import { SKILLS_CLI } from '../pins.js';
import { memo } from '../exec/memo.js';
import { probeVersion } from '../detect/tools.js';
import { auditSkill, auditVerdict, type AuditResult } from '../audit/skills-audit.js';
import { compareVersions } from '../version/compare.js';
import { npmReleases, pickRelease } from '../version/resolve.js';
import { action, ok, fail, skipAction } from './types.js';
type Lock = Record<string, { source: string; skillPath?: string; skillFolderHash?: string }>;
export async function readSkillLock(path: string): Promise<Lock> { try { return ((JSON.parse(await readFile(path, 'utf8')) as { skills?: Lock }).skills) ?? {}; } catch { return {}; } }
const lockPath = (ctx: Ctx) => join(ctx.host.home, '.agents', '.skill-lock.json');

/** The skills CLI version for this run: the newest qualifying release, like any registry package, so a catalog host
 * is not stuck on what the last installer release pinned. The pin is the floor, and all that stable and offline use. */
export function skillsCliVersion(ctx: Ctx): Promise<string> {
  if (ctx.offline || ctx.channel === 'stable') return Promise.resolve(SKILLS_CLI);
  return memo(ctx, 'skills-cli-version', async () => {
    const releases = await npmReleases(ctx.fetch, 'skills');
    const picked = releases ? pickRelease(releases, {}, ctx.cooldownDays) : null;
    return picked && compareVersions(picked, SKILLS_CLI) > 0 ? picked : SKILLS_CLI;
  });
}
/** Only on these child processes, never in the user environment: Claude Code withholds its sign-in from plugin hooks
 * in a session that has DISABLE_TELEMETRY set, which would silently switch off security-guidance's reviews. */
const CLI_ENV = { DISABLE_TELEMETRY: '1' };
const npx = async (ctx: Ctx, ...a: string[]) => ['npx', '-y', `skills@${await skillsCliVersion(ctx)}`, ...a];
const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''); // eslint-disable-line no-control-regex

const checks = new WeakMap<Ctx, Promise<Set<string> | null>>();
/** Which global skills `skills check` says have an update, or null when it could not tell. The output decides, not the
 * exit code: on Windows the CLI can finish its report and then die on a libuv assertion while exiting. */
function skillsWithUpdates(ctx: Ctx): Promise<Set<string> | null> {
  let p = checks.get(ctx);
  if (!p) {
    p = (async () => {
      if (ctx.offline) return null;
      const r = await ctx.run(await npx(ctx, 'check', '-g'), { readOnly: true, allowFailure: true, timeoutMs: 300000, env: CLI_ENV });
      const out = plain(r.stdout + r.stderr);
      const names = [...out.matchAll(/↑\s+(\S+)\s+has an update/g)].map((m) => m[1]!);
      return names.length || /all global skills are up to date/i.test(out) ? new Set(names) : null;
    })();
    checks.set(ctx, p);
  }
  return p;
}

async function namesOf(spec: SkillSpec, ctx: Ctx): Promise<string[]> {
  if (spec.skills !== '*') return spec.skills;
  const lock = await readSkillLock(lockPath(ctx));
  return Object.entries(lock).filter(([, e]) => e.source === spec.repo).map(([n]) => n);
}

/** The skills.sh audit, on first install and on every update: an update is new code from the same repo. Returns why
 * the run must not proceed, or null. */
async function auditBlocks(c: Component, spec: SkillSpec, ctx: Ctx): Promise<string | null> {
  if (ctx.noAudit) return null;
  const named = spec.skills === '*' ? null : spec.skills;
  const targets = c.audit ?? (named ? named.map((s) => { const [owner = '', repo = ''] = spec.repo.replace(/^https:\/\/github\.com\//, '').split('/'); return { owner, repo, skill: s }; }) : []);
  const results: AuditResult[] = []; for (const t of targets) results.push(await auditSkill(ctx.fetch, t.owner, t.repo, t.skill));
  const v = auditVerdict(results);
  if (v === 'fail') return `skills.sh audit FAILED for ${spec.repo}: ${results.map((r) => JSON.stringify(r.scanners)).join(' ')}. Rerun with --no-audit to override.`;
  if (v === 'warn') ctx.log.warn(`skills.sh audit warnings for ${spec.repo}: ${results.map((r) => `${r.riskLevel ?? ''} ${JSON.stringify(r.scanners)}`).join(' ')}`);
  if (v === 'unknown' && targets.length) ctx.log.warn(`skills.sh audit unavailable for ${spec.repo}`);
  if (!targets.length) ctx.log.warn(`audit skipped: no audit targets for ${spec.repo}`);
  return null;
}

export const skillProvider: Provider = {
  kind: 'skill',
  async detect(c, ctx) {
    if (c.spec.kind !== 'skill') return null; const lock = await readSkillLock(lockPath(ctx));
    const entries = c.spec.skills === '*' ? Object.values(lock).filter((e) => e.source === (c.spec as { repo: string }).repo) : c.spec.skills.map((s) => lock[s]).filter((e): e is Lock[string] => !!e);
    const want = c.spec.skills === '*' ? 1 : c.spec.skills.length; if (entries.length < want) return null;
    return { version: entries[0]?.skillFolderHash?.slice(0, 7) ?? 'installed' };
  },
  async stale(c, ctx) {
    if (c.spec.kind !== 'skill') return null;
    const updates = await skillsWithUpdates(ctx); if (!updates) return null;
    return (await namesOf(c.spec, ctx)).some((n) => updates.has(n));
  },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'skill') return []; const spec = c.spec;
    if (!(await probeVersion(ctx.run, ['node', '--version']))) return [skipAction(c.id, 'Node.js is required for the skills CLI (select the node tool)', 'node')];
    const named = spec.skills === '*' ? null : spec.skills;
    if (mode === 'uninstall') {
      if (!installed) return [];
      return [action(c.id, 'uninstall', `remove skills from ${spec.repo}`, async () => {
        // a skill of the same name from another repo is not ours to remove: the CLI goes by name only
        const lock = await readSkillLock(lockPath(ctx));
        const names = (await namesOf(spec, ctx)).filter((n) => lock[n]?.source === spec.repo);
        const failed: string[] = [];
        for (const n of names) {
          const r = await ctx.run(await npx(ctx, 'remove', n, '-g', '-y'), { allowFailure: true, timeoutMs: 300000, env: CLI_ENV });
          if (r.code !== 0 && !/successfully removed/i.test(plain(r.stdout + r.stderr))) failed.push(n); // see skillsWithUpdates on the exit code
        }
        return failed.length ? fail(`could not remove ${failed.join(', ')}`) : ok(`removed ${names.join(', ')}`);
      })];
    }
    if (installed) {
      // install and update both converge on upstream; only a known "nothing new" skips the work
      if ((await skillProvider.stale!(c, ctx)) === false) return [];
      return [action(c.id, 'update', `update skills from ${spec.repo}`, async () => {
        const blocked = await auditBlocks(c, spec, ctx); if (blocked) return fail(blocked);
        // by name, so a skill the user added by hand is theirs to update
        const names = await namesOf(spec, ctx);
        const r = await ctx.run(await npx(ctx, 'update', ...names, '-g', '-y'), { allowFailure: true, timeoutMs: 600000, env: CLI_ENV });
        const out = plain(r.stdout + r.stderr); const updated = /updated \d+ skill/i.test(out);
        if (/failed to update/i.test(out) || (r.code !== 0 && !updated && !/up to date/i.test(out))) return fail(`skills update failed: ${out.trim()}`); // see skillsWithUpdates on the exit code
        checks.delete(ctx);
        return ok(updated ? `updated ${names.join(', ')}` : `${names.join(', ')} up to date`, updated);
      }, { from: installed.version, to: null })];
    }
    return [action(c.id, 'install', `install ${named ? named.join(', ') : 'all skills'} from ${spec.repo}`, async () => {
      const blocked = await auditBlocks(c, spec, ctx); if (blocked) return fail(blocked);
      const argv = await npx(ctx, 'add', spec.repo, ...(named ? named.flatMap((s) => ['--skill', s]) : ['--skill', '*']), '-g', ...spec.targets.flatMap((t) => ['-a', t]), '-y');
      if (ctx.host.platform === 'windows' && ctx.host.windowsDeveloperMode === false) argv.push('--copy');
      const r = await ctx.run(argv, { allowFailure: true, timeoutMs: 600000, env: CLI_ENV }); if (r.code !== 0) return fail(`skills add failed: ${(r.stderr || r.stdout).trim()}`);
      // the skills CLI exits 0 and says nothing when a --skill name does not exist in the repo; check the lock so a typo in the manifest is a visible failure instead of an install that repeats on every run
      if (named && !ctx.dryRun) {
        const lock = await readSkillLock(lockPath(ctx));
        if (Object.keys(lock).length) { const missing = named.filter((s) => !lock[s]); if (missing.length) return fail(`skills add reported success but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in ~/.agents/.skill-lock.json: no skill with that name in ${spec.repo}?`); }
      }
      for (const post of spec.postInstall ?? []) {
        const pr = await ctx.run(post, { allowFailure: true, timeoutMs: 600000 });
        if (pr.code !== 0) return fail(`post-install command failed (exit ${pr.code}): ${post.join(' ')}${(pr.stderr || pr.stdout).trim() ? ` - ${(pr.stderr || pr.stdout).trim()}` : ''}`);
      }
      return ok(`installed ${named ? named.join(', ') : spec.repo}`);
    })];
  },
};
