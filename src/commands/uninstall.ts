import * as p from '@clack/prompts';
import type { Ctx } from '../types.js';
import { resolveSelection } from '../manifest/resolve.js';
import { buildPlan } from '../planner.js';
import { executePlan } from '../executor.js';
import { readState, writeState, buildState } from '../state/state.js';
import { renderPlan, renderSummary } from './summary.js';
export async function runUninstall(ctx: Ctx, ids: string[] | undefined, o: { json?: boolean; installerVersion: string }): Promise<number> {
  const state = await readState(ctx.paths.stateFile);
  const target = ids?.length ? ids : state?.selectedIds ?? [];
  if (!target.length) { ctx.log.error('nothing to uninstall: pass component ids or install first'); return 1; }
  const sel = resolveSelection(ctx.manifest, ctx.host, { profile: 'saved', savedIds: target });
  const plan = await buildPlan(sel, ctx, 'uninstall');
  if (!o.json) console.log(renderPlan(plan.actions));
  if (ctx.dryRun) return 0;
  if (!ctx.yes) { const c = await p.confirm({ message: `Remove ${sel.components.length} component(s)?`, initialValue: false }); if (p.isCancel(c) || !c) return 0; }
  const result = await executePlan(plan, ctx);
  if (!o.json) console.log('\n' + renderSummary(result.records)); else console.log(JSON.stringify(result.records, null, 2));
  const removedIds = new Set(target.filter((id) => result.records.some((r) => r.componentId === id && r.ok)));
  const remaining = (state?.selectedIds ?? []).filter((id) => !removedIds.has(id));
  const next = buildState(state, { ...sel, components: ctx.manifest.components.filter((c) => remaining.includes(c.id)) }, result.records, plan.detections, o.installerVersion, ctx.channel);
  for (const id of removedIds) delete next.installed[id];
  await writeState(ctx.paths.stateFile, next);
  return result.failed ? 1 : 0;
}
