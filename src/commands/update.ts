import type { Ctx } from '../types.js';
import { resolveSelection } from '../manifest/resolve.js';
import { buildPlan } from '../planner.js';
import { executePlan } from '../executor.js';
import { readState, writeState, buildState } from '../state/state.js';
import { driftReport } from '../update/drift.js';
import { renderPlan, renderSummary, postInstallHints } from './summary.js';
import { table } from '../ui/log.js';
export interface UpdateOpts { json?: boolean; installerVersion: string; noSelfUpdate?: boolean; selfUpdateFn?: (ctx: Ctx, version: string) => Promise<{ updated: boolean; message: string }> }
export async function runUpdate(ctx: Ctx, o: UpdateOpts): Promise<number> {
  if (!o.noSelfUpdate && o.selfUpdateFn) { const r = await o.selfUpdateFn(ctx, o.installerVersion); ctx.log.info(`self-update: ${r.message}`); if (r.updated) return 0; }
  const state = await readState(ctx.paths.stateFile);
  if (!state) ctx.log.warn('no saved selection on this host; updating the "all" profile');
  const sel = state ? resolveSelection(ctx.manifest, ctx.host, { profile: 'saved', savedIds: state.selectedIds }) : resolveSelection(ctx.manifest, ctx.host, { profile: 'all' });
  const plan = await buildPlan(sel, ctx, 'update');
  if (!o.json) console.log(renderPlan(plan.actions));
  if (ctx.dryRun) return 0;
  const result = await executePlan(plan, ctx);
  const drift = await driftReport(ctx, sel.components);
  if (o.json) console.log(JSON.stringify({ records: result.records, drift }, null, 2)); else { console.log('\n' + renderSummary(result.records)); console.log('\n' + table(drift.map((r) => [r.id, r.installed ?? '-', r.latest ?? '-', r.status]), ['component', 'installed', 'latest', 'status'])); const hints = postInstallHints(ctx, sel.components, result.records); if (hints.length) console.log('\nNext steps:\n- ' + hints.join('\n- ')); }
  await writeState(ctx.paths.stateFile, buildState(state, sel, result.records, plan.detections, o.installerVersion, ctx.channel));
  return result.failed ? 1 : 0;
}
