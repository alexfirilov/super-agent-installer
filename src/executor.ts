import type { Ctx, StepRecord } from './types.js';
import type { Plan } from './planner.js';
export async function executePlan(plan: Plan, ctx: Ctx, opts: { onStep?: (rec: StepRecord) => void } = {}): Promise<{ records: StepRecord[]; failed: number; changed: number }> {
  const records: StepRecord[] = [];
  for (const a of plan.actions) {
    ctx.log.step(`${a.op.padEnd(9)} ${a.description}`);
    let rec: StepRecord;
    try { const r = await a.run(ctx); rec = { componentId: a.componentId, op: a.op, ok: r.ok, changed: r.changed, message: r.message, from: a.from ?? null, to: a.to ?? null }; }
    catch (e) { rec = { componentId: a.componentId, op: a.op, ok: false, changed: false, message: (e as Error).message, from: a.from ?? null, to: a.to ?? null }; }
    if (!rec.ok) ctx.log.error(`${a.componentId}: ${rec.message}`); else if (rec.changed) ctx.log.info(`${a.componentId}: ${rec.message}`); else ctx.log.debug(`${a.componentId}: ${rec.message}`);
    records.push(rec); opts.onStep?.(rec);
  }
  return { records, failed: records.filter((r) => !r.ok).length, changed: records.filter((r) => r.ok && r.changed).length };
}
