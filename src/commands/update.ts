import type { Channel, Ctx } from '../types.js';
import { resolveSelection } from '../manifest/resolve.js';
import { buildPlan } from '../planner.js';
import { executeGrouped } from '../executor.js';
import { persistToolPath } from '../exec/persist-path.js';
import { readState, writeState, buildState, resolveChannel } from '../state/state.js';
import { driftReport } from '../update/drift.js';
import { renderPlan, renderSummary, postInstallHints } from './summary.js';
import { table } from '../ui/log.js';
/** `reexec(extraArgs)` runs the freshly installed binary with this invocation's arguments plus `extraArgs` and resolves
 * to its exit code, so one `update` finishes the whole stack with the new manifest. `channel`: explicit flag only. */
export interface UpdateOpts { json?: boolean; installerVersion: string; noSelfUpdate?: boolean; selfUpdateFn?: (ctx: Ctx, version: string) => Promise<{ updated: boolean; message: string }>; reexec?: (extraArgs: string[]) => Promise<number>; channel?: Channel }
export async function runUpdate(ctx: Ctx, o: UpdateOpts): Promise<number> {
  if (!o.noSelfUpdate && o.selfUpdateFn) {
    if (ctx.dryRun) ctx.log.info('[dry-run] self-update skipped');
    else {
      const r = await o.selfUpdateFn(ctx, o.installerVersion); ctx.log.info(`self-update: ${r.message}`);
      // The new binary carries the new manifest, so hand the rest of the run to it rather than finishing with the
      // old one; --no-self-update stops it from doing this again. Without a way to re-exec, keep going ourselves.
      if (r.updated) { if (o.reexec) { ctx.log.info('continuing the update with the new installer'); return o.reexec(['--no-self-update']); } ctx.log.warn('installer updated; continuing this run with the previous manifest'); }
    }
  }
  const state = await readState(ctx.paths.stateFile);
  ctx.channel = resolveChannel(o.channel, state, state && state.profile !== 'saved' ? ctx.manifest.profiles[state.profile] : undefined);
  if (!state) ctx.log.warn('no saved selection on this host; updating the "all" profile');
  const sel = state ? resolveSelection(ctx.manifest, ctx.host, { profile: 'saved', savedIds: state.selectedIds }) : resolveSelection(ctx.manifest, ctx.host, { profile: 'all' });
  const preview = await buildPlan(sel, ctx, 'update', { preview: true });
  if (!o.json) console.log(renderPlan(preview.actions));
  if (ctx.dryRun) return 0;
  const result = await executeGrouped(sel, ctx, 'update');
  await persistToolPath(ctx); // update installs missing components too, and their dirs must reach the next shell
  const drift = await driftReport(ctx, sel.components);
  if (o.json) console.log(JSON.stringify({ records: result.records, drift }, null, 2)); else { console.log('\n' + renderSummary(result.records)); console.log('\n' + table(drift.map((r) => [r.id, r.installed ?? '-', r.latest ?? '-', r.status]), ['component', 'installed', 'latest', 'status'])); const hints = postInstallHints(ctx, sel.components, result.records); if (hints.length) console.log('\nNext steps:\n- ' + hints.join('\n- ')); }
  await writeState(ctx.paths.stateFile, buildState(state, sel, result.records, result.plan.detections, o.installerVersion, ctx.channel));
  return result.failed ? 1 : result.blocked ? 2 : 0; // same contract as install: 2 = nothing failed, but requested work could not be completed
}
