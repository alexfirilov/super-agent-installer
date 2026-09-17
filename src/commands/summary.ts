import * as p from '@clack/prompts';
import type { Action, Component, Ctx, StepRecord } from '../types.js';
import { table } from '../ui/log.js';
export function renderPlan(actions: Action[]): string { return table(actions.map((a) => [a.op, a.componentId, a.from || a.to ? `${a.from ?? '-'} -> ${a.to ?? '?'}` : '', a.description]), ['op', 'component', 'version', 'description']); }
export function renderSummary(records: StepRecord[]): string {
  const rows = records.filter((r) => r.op !== 'skip' || !r.ok).map((r) => [r.ok ? (r.changed ? 'changed' : 'ok') : 'FAILED', r.componentId, r.op, r.message.split('\n')[0] ?? '']);
  const skipped = records.filter((r) => r.op === 'skip' && r.ok).length;
  return `${table(rows, ['result', 'component', 'op', 'message'])}${skipped ? `\n(${skipped} skipped: nothing to do)` : ''}`;
}
export async function promptSecrets(ctx: Ctx, components: Component[]): Promise<void> {
  const seenEnv = new Set<string>();
  const wanted = components
    .flatMap((c) => (c.secrets ?? []).map((s) => ({ ...s, component: c.id })))
    .filter((s) => !ctx.env[s.env] && !ctx.secrets.has(s.env))
    .filter((s) => (seenEnv.has(s.env) ? false : (seenEnv.add(s.env), true)));
  if (!wanted.length) return;
  if (ctx.yes) { ctx.log.warn(`secrets not set (non-interactive): ${wanted.map((s) => s.env).join(', ')}. Export them before using those components.`); return; }
  for (const s of wanted) {
    const v = await p.password({ message: `${s.prompt} (${s.env})${s.required ? '' : ' - press Enter to skip'}`, mask: '*' });
    if (p.isCancel(v) || !v) continue; ctx.secrets.set(s.env, String(v)); ctx.env[s.env] = String(v);
  }
}
export function postInstallHints(ctx: Ctx, components: Component[], records: StepRecord[]): string[] {
  const hints: string[] = [];
  for (const c of components) if (c.postInstallHint && records.some((r) => r.componentId === c.id && r.ok && r.changed)) hints.push(`${c.id}: ${c.postInstallHint}`);
  if (records.some((r) => r.componentId === 'claude-code' && r.ok && r.changed)) hints.push('claude-code: run `claude` once to log in (or `claude setup-token` for headless hosts)');
  if (records.some((r) => r.componentId === 'codex-cli' && r.ok && r.changed)) hints.push('codex-cli: run `codex login` (or `codex login --device-auth` on headless hosts)');
  if (records.some((r) => /^hook-caveman-codex/.test(r.componentId) && r.ok && r.changed)) hints.push('codex: open Codex and run /hooks to trust the new hooks');
  if (ctx.host.claudeRunning) hints.push('restart running Claude Code sessions to pick up plugin and settings changes');
  hints.push(...secretExportHints(ctx, components));
  return hints;
}
/** One `export VAR=<value>` / `setx VAR "<value>"` line per secret env of the selected components that is not in the ambient environment. Values typed at the prompt live in ctx.secrets and were used for this run only: the agents will not see them until the user exports them. */
export function secretExportHints(ctx: Ctx, components: Component[]): string[] {
  const w = ctx.host.platform === 'windows'; const seen = new Set<string>(); const out: string[] = [];
  for (const c of components) for (const s of c.secrets ?? []) {
    if (seen.has(s.env)) continue; seen.add(s.env);
    const typed = ctx.secrets.has(s.env); if (!typed && ctx.env[s.env]) continue;
    const line = w ? `setx ${s.env} "<value>"` : `export ${s.env}=<value>`;
    out.push(`${line}  # ${s.prompt}${typed ? ' (the value you typed was used for this run only; export it so the agents can see it)' : s.required ? ' (required, not set)' : ' (optional, not set)'}`);
  }
  return out;
}
