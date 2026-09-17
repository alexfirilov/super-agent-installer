import type { Action, Ctx, Installed, Kind, Mode, Selection } from './types.js';
import { getProvider } from './providers/registry.js';
import { skipAction } from './providers/types.js';

export const KIND_ORDER: readonly Kind[] = ['tool', 'agent', 'setting', 'claude-plugin', 'codex-plugin', 'mcp', 'skill', 'hook', 'statusline', 'instructions'];

export interface Plan { actions: Action[]; detections: Record<string, Installed | null> }

export async function buildPlan(sel: Selection, ctx: Ctx, mode: Mode): Promise<Plan> {
  const order = mode === 'uninstall' ? [...KIND_ORDER].reverse() : KIND_ORDER;
  const detections: Record<string, Installed | null> = {};
  const actions: Action[] = [];
  for (const kind of order) {
    for (const c of sel.components.filter((x) => x.kind === kind)) {
      const p = getProvider(kind);
      let installed: Installed | null = null;
      try {
        installed = await p.detect(c, ctx);
      } catch (e) {
        ctx.log.warn(`${c.id}: detection failed: ${(e as Error).message}`);
      }
      detections[c.id] = installed;
      const acts = await p.plan(c, ctx, installed, mode);
      actions.push(...(acts.length ? acts : [skipAction(c.id, mode === 'uninstall' ? 'not installed' : 'nothing to do')]));
    }
  }
  return { actions, detections };
}
