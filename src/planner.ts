import type { Action, Component, Ctx, Installed, Kind, Mode, Selection } from './types.js';
import { getProvider } from './providers/registry.js';
import { action, skipAction } from './providers/types.js';

export const KIND_ORDER: readonly Kind[] = ['tool', 'agent', 'setting', 'claude-plugin', 'codex-plugin', 'mcp', 'skill', 'hook', 'statusline', 'instructions'];
export function kindOrder(mode: Mode): readonly Kind[] { return mode === 'uninstall' ? [...KIND_ORDER].reverse() : KIND_ORDER; }

export interface Plan { actions: Action[]; detections: Record<string, Installed | null> }
/** preview: single-pass plan for the table / --dry-run. Components blocked only by something this run installs (Claude, Codex, node, caveman) are shown as `install (after <id>)` instead of skip; the action re-detects and re-plans when run. */
export interface PlanOpts { preview?: boolean }

export async function planComponent(c: Component, ctx: Ctx, mode: Mode): Promise<{ installed: Installed | null; actions: Action[] }> {
  const p = getProvider(c.kind);
  let installed: Installed | null = null;
  try { installed = await p.detect(c, ctx); } catch (e) { ctx.log.warn(`${c.id}: detection failed: ${(e as Error).message}`); }
  const acts = await p.plan(c, ctx, installed, mode);
  return { installed, actions: acts.length ? acts : [skipAction(c.id, mode === 'uninstall' ? 'not installed' : 'nothing to do')] };
}

function deferredAction(c: Component, mode: Mode, after: string): Action {
  return action(c.id, 'install', `install (after ${after})`, async (ctx) => {
    const { actions } = await planComponent(c, ctx, mode);
    if (actions.every((a) => a.op === 'skip' && a.blockedBy?.length)) return { ok: false, changed: false, message: `still blocked: ${actions.map((a) => a.description).join('; ')}` };
    const results = []; for (const a of actions) results.push(await a.run(ctx));
    return { ok: results.every((r) => r.ok), changed: results.some((r) => r.changed), message: results.map((r) => r.message).join('; ') };
  });
}

export async function buildPlan(sel: Selection, ctx: Ctx, mode: Mode, opts: PlanOpts = {}): Promise<Plan> {
  const detections: Record<string, Installed | null> = {};
  const actions: Action[] = [];
  const pending = new Set<string>(); // components this run will install/update (preview only)
  for (const kind of kindOrder(mode)) {
    for (const c of sel.components.filter((x) => x.kind === kind)) {
      const r = await planComponent(c, ctx, mode);
      detections[c.id] = r.installed;
      let acts = r.actions;
      if (opts.preview) { const by = acts.flatMap((a) => a.blockedBy ?? []).find((id) => pending.has(id)); if (by) acts = [deferredAction(c, mode, by)]; }
      if (acts.some((a) => a.op !== 'skip')) pending.add(c.id);
      actions.push(...acts);
    }
  }
  return { actions, detections };
}
