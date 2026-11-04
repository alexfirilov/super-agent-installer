import { describe, it, expect } from 'vitest';
import { runPicker, settleCooldown, type PickerUi } from '../../src/picker/flow.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, Manifest } from '../../src/types.js';
const c = (id: string, kind: Component['kind'], over: Partial<Component> = {}): Component => ({ id, name: id, kind, agents: 'claude', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: true, spec: { kind: 'claude-plugin', marketplace: 'm', plugin: id } as Component['spec'], ...over });
const manifest: Manifest = { version: 1, components: [c('sp', 'claude-plugin', { slot: 'methodology', contextCostTokens: { claude: 700 } }), c('ce', 'claude-plugin', { slot: 'methodology', defaultSelected: false }), c('sl1', 'statusline', { slot: 'statusline', spec: { kind: 'statusline', provider: 'caveman' } }), c('sl2', 'statusline', { slot: 'statusline', defaultSelected: false, spec: { kind: 'statusline', provider: 'claude-hud' } })] };
function scripted(script: { multi?: Record<string, string[]>; slot?: Record<string, string>; confirm?: boolean; cooldown?: string | symbol }): PickerUi & { notes: string[]; asked: string[] } {
  const notes: string[] = []; const asked: string[] = [];
  return { notes, asked, intro: () => {}, outro: () => {}, note: (m) => notes.push(m), isCancel: (v) => v === Symbol.for('cancel'),
    select: async (o) => { asked.push(o.message); if (/How new\?/.test(o.message)) return script.cooldown ?? o.initialValue; return script.slot?.[o.message] ?? (o.options[0]!.value as string); },
    multiselect: async (o) => script.multi?.[o.message] ?? (o.initialValues ?? []),
    confirm: async () => script.confirm ?? true };
}
describe('runPicker', () => {
  it('pre-fills the catalog defaults, resolves slot conflicts, returns picked ids', async () => {
    const ui = scripted({ multi: { 'Claude Code plugins': ['sp', 'ce'], 'Status line': ['sl1', 'sl2'] }, slot: { 'Only one methodology component can be active. Keep which?': 'ce', 'Only one statusline component can be active. Keep which?': 'sl1' } });
    const r = await runPicker(makeTestCtx({ manifest }), { state: null, ui });
    expect(r).toEqual({ picked: ['ce', 'sl1'], cooldownDays: 3 }); expect(ui.notes.some((n) => /tokens/.test(n))).toBe(true);
  });
  it('uses the catalog defaults as initial values and returns null on decline', async () => {
    const ui = scripted({ confirm: false });
    expect(await runPicker(makeTestCtx({ manifest }), { state: null, ui })).toBeNull();
    const ui2 = scripted({}); const r = await runPicker(makeTestCtx({ manifest }), { state: null, ui: ui2 }); expect(r?.picked).toEqual(['sp', 'sl1']);
  });
  it('starts from what this host saved, not the catalog defaults', async () => {
    const state = { version: 1 as const, installerVersion: '0.5.0', selectedIds: ['sl1'], channel: 'latest' as const, cooldownDays: 3, installed: {}, lastRun: 't' };
    const r = await runPicker(makeTestCtx({ manifest }), { state, ui: scripted({}) });
    expect(r?.picked).toEqual(['sl1']);
  });
  it('asks how new registry versions may be, offering 3 days (default) and 0', async () => {
    const ui = scripted({ cooldown: '0' });
    expect((await runPicker(makeTestCtx({ manifest }), { state: null, ui }))?.cooldownDays).toBe(0);
    expect(ui.asked.some((m) => /How new\?/.test(m))).toBe(true);
    const cancel = scripted({ cooldown: Symbol.for('cancel') });
    expect(await runPicker(makeTestCtx({ manifest }), { state: null, ui: cancel })).toBeNull();
  });
  it('does not ask when --cooldown was given or the run resolves to the stable channel', async () => {
    for (const o of [{ cooldownFlag: 7 }, { channelFlag: 'stable' as const }]) {
      const ui = scripted({}); const r = await runPicker(makeTestCtx({ manifest }), { state: null, ui, ...o });
      expect(r?.cooldownDays).toBeUndefined(); expect(ui.asked.some((m) => /How new\?/.test(m))).toBe(false);
    }
  });
});
describe('settleCooldown', () => {
  const state = (cooldownDays?: number) => ({ version: 1 as const, installerVersion: '0.5.0', selectedIds: [], channel: 'latest' as const, installed: {}, lastRun: 't', ...(cooldownDays !== undefined ? { cooldownDays } : {}) });
  it('flag beats the saved choice, which beats asking; nobody to ask means 3 days', async () => {
    const ui = scripted({ cooldown: '0' }); const ctx = makeTestCtx();
    expect(await settleCooldown(ctx, 5, state(0), true, ui)).toBe(5);
    expect(await settleCooldown(ctx, undefined, state(0), true, ui)).toBe(0);
    expect(ui.asked).toEqual([]);
    expect(await settleCooldown(ctx, undefined, state(), true, ui)).toBe(0); expect(ui.asked.length).toBe(1);
    expect(await settleCooldown(ctx, undefined, null, false, ui)).toBe(3);
  });
  it('never asks on the stable channel', async () => {
    const ui = scripted({ cooldown: '0' }); const ctx = makeTestCtx(); ctx.channel = 'stable';
    expect(await settleCooldown(ctx, undefined, null, true, ui)).toBe(3); expect(ui.asked).toEqual([]);
  });
});
