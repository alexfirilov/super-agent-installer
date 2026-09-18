import type { Ctx, Kind, Mode, Selection, StepRecord } from './types.js';
import { buildPlan, kindOrder, type Plan } from './planner.js';
import { invalidateClaudeState } from './providers/claude-plugin.js';
import { invalidateCodexState } from './providers/codex-plugin.js';
import { extendPath, extendPathWith, readSystemPath } from './exec/path.js';
export interface ExecOpts { onStep?: (rec: StepRecord) => void; afterEach?: () => void | Promise<void> }
export interface ExecResult { records: StepRecord[]; failed: number; changed: number; blocked: number }
export async function executePlan(plan: Plan, ctx: Ctx, opts: ExecOpts = {}): Promise<ExecResult> {
  const records: StepRecord[] = [];
  for (const a of plan.actions) {
    ctx.log.step(`${a.op.padEnd(9)} ${a.description}`);
    let rec: StepRecord;
    try { const r = await a.run(ctx); rec = { componentId: a.componentId, op: a.op, ok: r.ok, changed: r.changed, message: r.message, ...(r.blocked ? { blocked: true } : {}), from: a.from ?? null, to: a.to ?? null }; }
    catch (e) { rec = { componentId: a.componentId, op: a.op, ok: false, changed: false, message: (e as Error).message, from: a.from ?? null, to: a.to ?? null }; }
    if (!rec.ok) ctx.log.error(`${a.componentId}: ${rec.message}`); else if (rec.changed) ctx.log.info(`${a.componentId}: ${rec.message}`); else ctx.log.debug(`${a.componentId}: ${rec.message}`);
    records.push(rec); opts.onStep?.(rec);
    if (rec.op !== 'skip') await opts.afterEach?.();
  }
  return { records, failed: records.filter((r) => !r.ok).length, changed: records.filter((r) => r.ok && r.changed).length, blocked: records.filter((r) => r.blocked).length };
}
/** Kinds whose actions put new binaries on disk: after each of their actions the agent state caches are dropped and PATH is extended so later groups see them. */
export const REFRESH_AFTER: ReadonlySet<Kind> = new Set<Kind>(['tool', 'agent']);
export async function refreshEnvironment(ctx: Ctx): Promise<void> {
  invalidateClaudeState(ctx); invalidateCodexState(ctx);
  const registryPath = await readSystemPath(ctx);
  if (registryPath.length) {
    extendPathWith(ctx.host, process.env, registryPath);
    if (ctx.env !== process.env) extendPathWith(ctx.host, ctx.env, registryPath);
  }
  const added = extendPath(ctx.host, process.env);
  if (ctx.env !== process.env) extendPath(ctx.host, ctx.env);
  if (added.length) ctx.log.debug(`PATH += ${added.join(', ')}`);
}
/** Real runs: plan and execute one KIND_ORDER group at a time, so plugins/MCP/skills are planned only after the agents and tools they need exist.
 * `afterKind` fires once per non-empty group, after its actions ran and after the PATH refresh their `afterEach` did
 * -- that is where `runInstall` signs the agents in, since on a clean host their binaries only exist from the `agent`
 * group onwards. */
export async function executeGrouped(sel: Selection, ctx: Ctx, mode: Mode, opts: { onStep?: (rec: StepRecord) => void; refresh?: (ctx: Ctx) => void | Promise<void>; afterKind?: (kind: Kind, ctx: Ctx) => void | Promise<void> } = {}): Promise<ExecResult & { plan: Plan }> {
  const refresh = opts.refresh ?? refreshEnvironment;
  const plan: Plan = { actions: [], detections: {} }; const records: StepRecord[] = [];
  for (const kind of kindOrder(mode)) {
    const components = sel.components.filter((c) => c.kind === kind); if (!components.length) continue;
    const group = await buildPlan({ ...sel, components }, ctx, mode);
    plan.actions.push(...group.actions); Object.assign(plan.detections, group.detections);
    const r = await executePlan(group, ctx, { onStep: opts.onStep, afterEach: REFRESH_AFTER.has(kind) ? () => refresh(ctx) : undefined });
    records.push(...r.records);
    await opts.afterKind?.(kind, ctx);
  }
  return { plan, records, failed: records.filter((r) => !r.ok).length, changed: records.filter((r) => r.ok && r.changed).length, blocked: records.filter((r) => r.blocked).length };
}
