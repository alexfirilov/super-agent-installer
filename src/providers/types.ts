import type { Action, ActionResult, Ctx, Op } from '../types.js';

let counter = 0;

export function action(componentId: string, op: Op, description: string, run: (ctx: Ctx) => Promise<ActionResult>, extra: { from?: string | null; to?: string | null; blockedBy?: string[] } = {}): Action {
  return { id: `${componentId}:${op}:${++counter}`, componentId, op, description, run, ...extra };
}

/** A no-op action. `blockedBy` names the component ids whose install would unblock this one (e.g. the agent that is
 * not installed yet); the planner uses it in preview mode. `o.blocked` marks the skip as auth-blocked: it stays in
 * the summary table and makes the run exit non-zero, unlike an ordinary "nothing to do" skip. */
export function skipAction(componentId: string, reason: string, blockedBy?: string | string[], o: { blocked?: boolean } = {}): Action {
  return action(componentId, 'skip', reason, async () => ({ ok: true, changed: false, message: reason, ...(o.blocked ? { blocked: true } : {}) }), blockedBy ? { blockedBy: Array.isArray(blockedBy) ? blockedBy : [blockedBy] } : {});
}

export const ok = (message: string, changed = true): ActionResult => ({ ok: true, changed, message });
export const fail = (message: string): ActionResult => ({ ok: false, changed: false, message });
