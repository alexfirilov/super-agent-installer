import { describe, it, expect } from 'vitest';
import { executePlan } from '../src/executor.js';
import { action } from '../src/providers/types.js';
import { makeTestCtx } from './helpers/ctx.js';
describe('executePlan', () => {
  it('runs all actions, records failures and thrown errors, keeps going', async () => {
    const ctx = makeTestCtx(); const seen: string[] = [];
    const plan = { detections: {}, actions: [
      action('a', 'install', 'ok one', async () => ({ ok: true, changed: true, message: 'done' })),
      action('b', 'update', 'fails', async () => ({ ok: false, changed: false, message: 'nope' })),
      action('c', 'configure', 'throws', async () => { throw new Error('boom'); }),
      action('d', 'skip', 'skipped', async () => ({ ok: true, changed: false, message: 'skip' })),
    ] };
    const r = await executePlan(plan, ctx, { onStep: (s) => seen.push(`${s.componentId}:${s.ok}`) });
    expect(seen).toEqual(['a:true', 'b:false', 'c:false', 'd:true']); expect(r.failed).toBe(2); expect(r.changed).toBe(1);
    expect(r.records[2]).toMatchObject({ componentId: 'c', ok: false, message: expect.stringContaining('boom') });
  });
});
