import type { Component, Ctx, HostState, Installed, RetiredComponent, Selection, StepRecord } from '../types.js';
import { buildPlan } from '../planner.js';
import { executePlan } from '../executor.js';
import { resolveVersions } from '../version/resolve.js';
import { renderPlan } from './summary.js';

/** `skipped`: a partial run (`--only`), which installs no successor and so must not take anything away. */
export interface Retirement { records: StepRecord[]; detections: Record<string, Installed | null>; failed: boolean; pending: string[]; skipped: boolean }

/**
 * The retired components this host should remove: those its saved selection still names. Tools and agents also need
 * proof that we installed them, because removing an OS package can take its reverse dependencies with it (see
 * `uninstall.ts`). Everything else in a saved selection is agent configuration this installer manages and can put back,
 * so being selected is enough: hosts often adopted these rather than having them recorded as installed by us.
 */
export function retiredToRemove(ctx: Ctx, state: HostState | null): RetiredComponent[] {
  return (ctx.manifest.retired ?? []).filter((c) => state?.selectedIds.includes(c.id) && c.platforms.includes(ctx.host.platform) && ((c.kind !== 'tool' && c.kind !== 'agent') || state.installed[c.id]?.byUs === true));
}

/** A retired skill pack can share skills with a live component (the same skill, now from a smaller pack). `skills remove`
 * goes by name, so those are left out; a pack with nothing else left has nothing to remove. */
function withoutLiveSkills(ctx: Ctx, due: RetiredComponent[]): RetiredComponent[] {
  const live = new Set(ctx.manifest.components.flatMap((c) => (c.spec.kind === 'skill' && c.spec.skills !== '*' ? c.spec.skills : [])));
  return due.flatMap((c) => {
    if (c.spec.kind !== 'skill' || c.spec.skills === '*') return [c];
    const skills = c.spec.skills.filter((s) => !live.has(s));
    return skills.length ? [{ ...c, spec: { ...c.spec, skills } }] : [];
  });
}

/** Runs before the components are installed, so a replacement never lands next to what it replaces. */
export async function retireComponents(ctx: Ctx, state: HostState | null, o: { partial?: boolean; json?: boolean } = {}): Promise<Retirement> {
  const none = { records: [], detections: {}, failed: false, pending: [] };
  if (o.partial) return { ...none, skipped: true };
  const due = withoutLiveSkills(ctx, retiredToRemove(ctx, state));
  if (!due.length) return { ...none, skipped: false };
  ctx.log.info(`removing ${due.length} component(s) dropped from the catalog: ${due.map((c) => c.id).join(', ')}`);
  const { components } = await resolveVersions(due as Component[], ctx, { pinsOnly: true, recorded: (id) => state?.installed[id]?.versions });
  const sel: Selection = { components, excluded: [], tokenTotals: { claude: 0, codex: 0 }, codexMcpCount: 0 };
  const plan = await buildPlan(sel, ctx, 'uninstall');
  if (!o.json) console.log(renderPlan(plan.actions));
  const result = await executePlan(plan, ctx);
  const pending = due.filter((c) => result.records.some((r) => r.componentId === c.id && !r.ok)).map((c) => c.id);
  return { records: result.records, detections: plan.detections, failed: pending.length > 0, pending, skipped: false };
}

/** Retired ids leave the saved selection, except those whose removal failed: they stay so the next run tries again. */
export function applyRetirement(ctx: Ctx, next: HostState, retirement: Retirement): HostState {
  if (retirement.skipped) return next;
  const retired = new Set((ctx.manifest.retired ?? []).map((c) => c.id));
  return { ...next, selectedIds: [...new Set([...next.selectedIds.filter((id) => !retired.has(id)), ...retirement.pending])] };
}
