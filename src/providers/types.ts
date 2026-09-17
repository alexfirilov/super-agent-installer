import type { Action, ActionResult, Ctx, Op } from '../types.js';

let counter = 0;

export function action(componentId: string, op: Op, description: string, run: (ctx: Ctx) => Promise<ActionResult>, extra: { from?: string | null; to?: string | null } = {}): Action {
  return { id: `${componentId}:${op}:${++counter}`, componentId, op, description, run, ...extra };
}

export function skipAction(componentId: string, reason: string): Action {
  return action(componentId, 'skip', reason, async () => ({ ok: true, changed: false, message: reason }));
}

export const ok = (message: string, changed = true): ActionResult => ({ ok: true, changed, message });
export const fail = (message: string): ActionResult => ({ ok: false, changed: false, message });
