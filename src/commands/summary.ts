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
  const wanted = components.flatMap((c) => (c.secrets ?? []).map((s) => ({ ...s, component: c.id }))).filter((s) => !ctx.env[s.env] && !ctx.secrets.has(s.env));
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
  return hints;
}
