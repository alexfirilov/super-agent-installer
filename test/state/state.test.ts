import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
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
});
