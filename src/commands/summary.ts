import * as p from '@clack/prompts';
import type { Action, Component, Ctx, StepRecord } from '../types.js';
import { table } from '../ui/log.js';
import { validateSecret, type KeyCheck } from '../secrets/validate.js';

/** What the caller knows that the records do not: whether secret persistence was deliberately skipped, and which
 * agents this run needed signed in (`attempted: false` means the phase was skipped with `--no-login`). */
export interface HintOpts { persistSkipped?: boolean; signIn?: { agents: Array<'claude' | 'codex'>; attempted: boolean } }
export interface SecretsUi { password(o: { message: string; mask?: string }): Promise<unknown>; isCancel(v: unknown): boolean }
export const clackSecretsUi: SecretsUi = { password: (o) => p.password(o), isCancel: (v) => p.isCancel(v) };
export function renderPlan(actions: Action[]): string { return table(actions.map((a) => [a.op, a.componentId, a.from || a.to ? `${a.from ?? '-'} -> ${a.to ?? '?'}` : '', a.description]), ['op', 'component', 'version', 'description']); }
/** Ordinary "nothing to do" skips collapse into the footer count; an auth-blocked one keeps its own BLOCKED row --
 * it is the reason a component the user selected did not happen, and the run exits non-zero for it. */
export function renderSummary(records: StepRecord[]): string {
  const rows = records.filter((r) => r.op !== 'skip' || !r.ok || r.blocked).map((r) => [r.ok ? (r.blocked ? 'BLOCKED' : r.changed ? 'changed' : 'ok') : 'FAILED', r.componentId, r.op, r.message.split('\n')[0] ?? '']);
  const skipped = records.filter((r) => r.op === 'skip' && r.ok && !r.blocked).length;
  return `${table(rows, ['result', 'component', 'op', 'message'])}${skipped ? `\n(${skipped} skipped: nothing to do)` : ''}`;
}
async function askSecret(ui: SecretsUi, s: { env: string; prompt: string; required: boolean }, retry: boolean): Promise<string | undefined> {
  const message = retry ? `${s.prompt} (${s.env}) - re-enter, or press Enter to skip` : `${s.prompt} (${s.env})${s.required ? '' : ' - press Enter to skip'}`;
  const v = await ui.password({ message, mask: '*' });
  if (ui.isCancel(v) || !v) return undefined;
  return String(v);
}
/** Prints only the env name plus the check's summary/warnings -- never the value itself. */
function reportCheck(ctx: Ctx, env: string, check: KeyCheck): void {
  ctx.log.info(`${env}: ${check.summary}`);
  for (const w of check.warnings) ctx.log.warn(`${env}: ${w}`);
}
export async function promptSecrets(ctx: Ctx, components: Component[], o: { ui?: SecretsUi } = {}): Promise<void> {
  const ui = o.ui ?? clackSecretsUi;
  const seenEnv = new Set<string>();
  const wanted = components
    .flatMap((c) => (c.secrets ?? []).map((s) => ({ ...s, component: c.id })))
    .filter((s) => !ctx.env[s.env] && !ctx.secrets.has(s.env))
    .filter((s) => (seenEnv.has(s.env) ? false : (seenEnv.add(s.env), true)));
  if (!wanted.length) return;
  if (ctx.yes) { ctx.log.warn(`secrets not set (non-interactive): ${wanted.map((s) => s.env).join(', ')}. Export them before using those components.`); return; }
  for (const s of wanted) {
    let value = await askSecret(ui, s, false);
    if (value === undefined) continue;
    if (!ctx.dryRun) {
      let check = await validateSecret(ctx, s.env, value);
      reportCheck(ctx, s.env, check);
      if (!check.ok) {
        const retry = await askSecret(ui, s, true);
        if (retry === undefined) continue; // second entry left empty (or cancelled): skip the variable entirely
        value = retry;
        check = await validateSecret(ctx, s.env, value);
        reportCheck(ctx, s.env, check);
        if (!check.ok) ctx.log.warn(`${s.env}: keeping the value you entered despite failed validation`);
      }
    }
    ctx.secrets.set(s.env, value); ctx.env[s.env] = value;
  }
}
const AGENT_COMPONENT = { claude: 'claude-code', codex: 'codex-cli' } as const;
const HEADLESS_SIGN_IN = { claude: 'claude setup-token', codex: 'codex login --device-auth' } as const;
/** Every remaining `postInstallHint` (and the hardcoded notes below) is advisory: something we could not turn into an
 * action (a slash command run inside the agent, a trust prompt, a reminder to restart a running session) -- never a
 * shell command we could have run for the user. The sign-in lines are the one exception, and they are derived from
 * the outcome, never from a flag: `ensureAuth` normally signs the agents in during the run, so an agent that is
 * authenticated is never nagged; one whose sign-in was skipped (`--no-login`) or ran and failed is, because nothing
 * else in the output would tell the user. */
export function postInstallHints(ctx: Ctx, components: Component[], records: StepRecord[], o: HintOpts = {}): string[] {
  const hints: string[] = [];
  for (const agent of o.signIn?.agents ?? []) {
    const state = ctx.auth?.[agent];
    if (state?.authenticated) continue;
    const id = AGENT_COMPONENT[agent];
    if (!o.signIn?.attempted) hints.push(`${id}: run \`${agent}\` once to log in (sign-in was skipped with --no-login)`);
    else hints.push(`${id}: sign-in did not complete${state?.detail ? ` (${state.detail})` : ''}; run \`${agent}\` (or \`${HEADLESS_SIGN_IN[agent]}\` on a headless host)`);
  }
  for (const c of components) if (c.postInstallHint && records.some((r) => r.componentId === c.id && r.ok && r.changed)) hints.push(`${c.id}: advisory: ${c.postInstallHint}`);
  if (records.some((r) => /^hook-caveman-codex/.test(r.componentId) && r.ok && r.changed)) hints.push('codex: advisory: open Codex and run /hooks to trust the new hooks');
  if (ctx.host.claudeRunning) hints.push('advisory: restart running Claude Code sessions to pick up plugin and settings changes');
  const persisted = ctx.secretsPersist?.persisted ?? [];
  if (persisted.length) hints.push(`persisted to your user environment: ${persisted.join(', ')} (open a new terminal for other apps to see them)`);
  hints.push(...secretExportHints(ctx, components, o));
  return hints;
}
/** One `export VAR=<value>` / `setx VAR "<value>"` line per secret env of the selected components that is not in
 * the ambient environment and was not successfully auto-persisted (see `persistSecrets`). A variable that
 * `ctx.secretsPersist` reports persisted is dropped from this per-variable list and instead summarized in one
 * line by `postInstallHints`; a variable that failed to persist keeps its manual line with the failure reason. */
export function secretExportHints(ctx: Ctx, components: Component[], o: HintOpts = {}): string[] {
  const w = ctx.host.platform === 'windows'; const seen = new Set<string>(); const out: string[] = [];
  const persisted = new Set(ctx.secretsPersist?.persisted ?? []);
  const failed = new Map((ctx.secretsPersist?.failed ?? []).map((f) => [f.name, f.reason] as const));
  for (const c of components) for (const s of c.secrets ?? []) {
    if (seen.has(s.env)) continue; seen.add(s.env);
    const typed = ctx.secrets.has(s.env); if (!typed && ctx.env[s.env]) continue;
    if (persisted.has(s.env)) continue;
    const line = w ? `setx ${s.env} "<value>"` : `export ${s.env}=<value>`;
    const reason = failed.get(s.env);
    out.push(`${line}  # ${s.prompt}${typed ? ' (the value you typed was used for this run only; export it so the agents can see it)' : s.required ? ' (required, not set)' : ' (optional, not set)'}${reason ? ` [auto-persist failed: ${reason}]` : ''}`);
  }
  // secrets captured this run but not tied to a manifest component's secret list (e.g. a captured OAuth token) that failed to persist
  for (const [name, reason] of failed) {
    if (seen.has(name)) continue; seen.add(name);
    const line = w ? `setx ${name} "<value>"` : `export ${name}=<value>`;
    out.push(`${line}  # captured this run [auto-persist failed: ${reason}]`);
  }
  // `--no-persist-secrets`: persistence never ran, so `failed` is empty and nothing above covers a secret we captured
  // ourselves (a `claude setup-token` token is not on any component's secrets list). Say so rather than dropping it.
  if (o.persistSkipped) for (const name of ctx.secrets.keys()) {
    if (seen.has(name)) continue; seen.add(name);
    const line = w ? `setx ${name} "<value>"` : `export ${name}=<value>`;
    out.push(`${line}  # captured this run, not saved because --no-persist-secrets was passed${name === 'CLAUDE_CODE_OAUTH_TOKEN' ? ' (`claude setup-token` mints a new one)' : ''}`);
  }
  return out;
}
