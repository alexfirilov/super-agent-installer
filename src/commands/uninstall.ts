import * as p from '@clack/prompts';
import type { Ctx } from '../types.js';
import { resolveSelection } from '../manifest/resolve.js';
import { buildPlan } from '../planner.js';
import { executePlan } from '../executor.js';
import { readState, writeState, buildState } from '../state/state.js';
import { renderPlan, renderSummary } from './summary.js';
/**
 * Uninstall removes only what this installer put on the host.
 *
 * On 2026-09-19 a bare `uninstall --yes` on a real workstation removed the host's pre-existing git, jq, ripgrep, gh
 * and go -- none of which we installed -- because the target list came from `selectedIds` (everything the profile
 * SELECTED) rather than from what we actually installed. apt then removed 150 further packages that depended on
 * them, including the whole desktop. Two guards now stand in the way: provenance (`byUs`), and the refusal to treat
 * a bare `uninstall --yes` as "remove everything".
 */
export async function runUninstall(ctx: Ctx, ids: string[] | undefined, o: { json?: boolean; installerVersion: string; force?: boolean; all?: boolean }): Promise<number> {
  const state = await readState(ctx.paths.stateFile);
  // Refuse only what we know is on the host but did not put there. An id with no record at all is bookkeeping --
  // the provider's own `if (!installed) return []` makes it a no-op -- so there is nothing to protect.
  const foreignToUs = (id: string) => state?.installed[id] !== undefined && state.installed[id]?.byUs !== true;
  const ours = (id: string) => state?.installed[id]?.byUs === true;
  let target: string[];
  if (ids?.length) {
    const foreign = ids.filter(foreignToUs);
    if (foreign.length && !o.force) {
      ctx.log.error(`refusing to remove ${foreign.join(', ')}: this installer did not install ${foreign.length > 1 ? 'them' : 'it'}, so removing ${foreign.length > 1 ? 'them' : 'it'} could break software you rely on. Re-run with --force if you are sure.`);
      return 1;
    }
    target = ids;
  } else {
    if (!o.all) {
      const n = (state?.selectedIds ?? []).filter(ours).length;
      ctx.log.error(`refusing to remove everything: name the component ids to remove, or pass --all to remove all ${n} component(s) this installer installed.`);
      return 1;
    }
    target = (state?.selectedIds ?? []).filter(ours);
  }
  if (!target.length) { ctx.log.error('nothing to uninstall: pass component ids or install first'); return 1; }
  // explicit ids only: never widen to the prerequisite closure (uninstall sk-x must not remove node)
  const resolved = resolveSelection(ctx.manifest, ctx.host, { profile: 'saved', savedIds: target });
  const wanted = new Set(target); const sel = { ...resolved, components: resolved.components.filter((c) => wanted.has(c.id)) };
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
