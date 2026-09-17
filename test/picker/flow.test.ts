import { describe, it, expect } from 'vitest';
import { runPicker, type PickerUi } from '../../src/picker/flow.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, Manifest } from '../../src/types.js';
const c = (id: string, kind: Component['kind'], over: Partial<Component> = {}): Component => ({ id, name: id, kind, agents: 'claude', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: true, spec: { kind: 'claude-plugin', marketplace: 'm', plugin: id } as Component['spec'], ...over });
const manifest: Manifest = { version: 1, profiles: { all: { description: 'all', base: 'all' }, minimal: { description: 'min', base: 'none', include: ['sp'] } }, components: [c('sp', 'claude-plugin', { slot: 'methodology', contextCostTokens: { claude: 700 } }), c('ce', 'claude-plugin', { slot: 'methodology', defaultSelected: false }), c('sl1', 'statusline', { slot: 'statusline', spec: { kind: 'statusline', provider: 'caveman' } }), c('sl2', 'statusline', { slot: 'statusline', defaultSelected: false, spec: { kind: 'statusline', provider: 'claude-hud' } })] };
function scripted(script: { profile?: string; multi?: Record<string, string[]>; slot?: Record<string, string>; confirm?: boolean }): PickerUi & { notes: string[] } {
  const notes: string[] = [];
  return { notes, intro: () => {}, outro: () => {}, note: (m) => notes.push(m), isCancel: (v) => v === Symbol.for('cancel'),
    select: async (o) => (o.message.startsWith('Profile') ? (script.profile ?? 'all') : (script.slot?.[o.message] ?? (o.options[0]!.value as string))),
    multiselect: async (o) => script.multi?.[o.message] ?? (o.initialValues ?? []),
    confirm: async () => script.confirm ?? true };
}
describe('runPicker', () => {
  it('pre-fills from the profile, resolves slot conflicts, returns picked ids', async () => {
    const ui = scripted({ profile: 'all', multi: { 'Claude Code plugins': ['sp', 'ce'], 'Status line': ['sl1', 'sl2'] }, slot: { 'Only one methodology component can be active. Keep which?': 'ce', 'Only one statusline component can be active. Keep which?': 'sl1' } });
    const r = await runPicker(makeTestCtx({ manifest }), { state: null, ui });
    expect(r).toEqual({ picked: ['ce', 'sl1'], profile: 'all' }); expect(ui.notes.some((n) => /tokens/.test(n))).toBe(true);
  });
  it('uses profile defaults as initial values and returns null on decline', async () => {
    const ui = scripted({ profile: 'minimal', confirm: false });
    expect(await runPicker(makeTestCtx({ manifest }), { state: null, ui })).toBeNull();
    const ui2 = scripted({ profile: 'minimal' }); const r = await runPicker(makeTestCtx({ manifest }), { state: null, ui: ui2 }); expect(r?.picked).toEqual(['sp']);
  });
});
