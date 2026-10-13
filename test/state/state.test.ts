import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState, writeState, buildState } from '../../src/state/state.js';
import type { Selection, StepRecord } from '../../src/types.js';
describe('state', () => {
  it('round-trips and builds installed map from records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const p = join(dir, 'state.json');
    expect(await readState(p)).toBeNull();
    const sel = { profile: 'all', components: [{ id: 'x' }, { id: 'y' }, { id: 'z' }], excluded: [], tokenTotals: { claude: 0, codex: 0 }, codexMcpCount: 0 } as unknown as Selection;
    const recs: StepRecord[] = [{ componentId: 'x', op: 'install', ok: true, changed: true, message: '', to: '1.0' }, { componentId: 'y', op: 'uninstall', ok: true, changed: true, message: '' }, { componentId: 'z', op: 'skip', ok: true, changed: false, message: '' }];
    const prev = { version: 1 as const, installerVersion: '0.0.1', profile: 'all' as const, selectedIds: ['y'], channel: 'latest' as const, installed: { y: { version: '9', at: 't' }, z: { version: '2', at: 't' } }, lastRun: 't' };
    const s = buildState(prev, sel, recs, { z: { version: '2.1' } }, '0.1.0', 'latest');
    expect(s.installed.x?.version).toBe('1.0'); expect(s.installed.y).toBeUndefined(); expect(s.installed.z?.version).toBe('2'); expect(s.selectedIds).toEqual(['x', 'y', 'z']); expect(s.installerVersion).toBe('0.1.0');
    await writeState(p, s); expect(await readState(p)).toEqual(s);
  });
  it('refuses to run on a corrupt state file instead of silently starting over (provenance would be lost)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const p = join(dir, 'state.json'); writeFileSync(p, '{"version":1,');
    await expect(readState(p)).rejects.toThrow(/state\.json.*not valid JSON/s);
  });
});
describe('previous values (Finding 9)', () => {
  const sel = { profile: 'all', components: [{ id: 'm' }], excluded: [], tokenTotals: { claude: 0, codex: 0 }, codexMcpCount: 0 } as unknown as Selection;
  it('records what a configure replaced, keeps it across re-applies that replace nothing, and drops it on uninstall', () => {
    const first = buildState(null, sel, [{ componentId: 'm', op: 'configure', ok: true, changed: true, message: '', previous: { url: 'https://theirs' } }], {}, '0.4.0', 'latest');
    expect(first.installed.m).toMatchObject({ byUs: true, previous: { url: 'https://theirs' } });
    const again = buildState(first, sel, [{ componentId: 'm', op: 'configure', ok: true, changed: true, message: '' }], {}, '0.4.0', 'latest');
    expect(again.installed.m?.previous).toEqual({ url: 'https://theirs' });
    const edited = buildState(again, sel, [{ componentId: 'm', op: 'configure', ok: true, changed: true, message: '', previous: { url: 'https://edited-later' } }], {}, '0.4.0', 'latest');
    expect(edited.installed.m?.previous).toEqual({ url: 'https://edited-later' }); // the most recent foreign value we replaced
    const gone = buildState(edited, sel, [{ componentId: 'm', op: 'uninstall', ok: true, changed: true, message: '' }], {}, '0.4.0', 'latest');
    expect(gone.installed.m).toBeUndefined();
  });
});

describe('resolved versions and the cooldown choice', () => {
  const sel = { profile: 'all', components: [{ id: 'm' }, { id: 'f' }], excluded: [], tokenTotals: { claude: 0, codex: 0 }, codexMcpCount: 0 } as unknown as Selection;
  const rec = (componentId: string, ok = true): StepRecord => ({ componentId, op: 'install', ok, changed: true, message: '' });
  it('records the versions a component was converged to, but not for one whose step failed', () => {
    const s = buildState(null, sel, [rec('m'), rec('f', false)], {}, '0.5.0', 'latest', { cooldownDays: 0, versions: [{ componentId: 'm', key: 'version', version: '2.0.0' }, { componentId: 'f', key: 'version', version: '9.9.9' }] });
    expect(s.installed.m?.versions).toEqual({ version: '2.0.0' }); expect(s.installed.f).toBeUndefined(); expect(s.cooldownDays).toBe(0);
  });
  it('keeps the saved cooldown when a run does not pass one', () => {
    const first = buildState(null, sel, [], {}, '0.5.0', 'latest', { cooldownDays: 3 });
    expect(buildState(first, sel, [], {}, '0.5.0', 'latest').cooldownDays).toBe(3);
    expect('cooldownDays' in buildState(null, sel, [], {}, '0.5.0', 'latest')).toBe(false);
  });
});
