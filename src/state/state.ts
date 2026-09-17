import type { Channel, HostState, Installed, Selection, StepRecord } from '../types.js';
import { readJsonFile, writeJsonAtomic } from '../config/json.js';
export async function readState(path: string): Promise<HostState | null> { const s = await readJsonFile<HostState>(path); return s && s.version === 1 ? s : null; }
export async function writeState(path: string, state: HostState): Promise<void> { await writeJsonAtomic(path, state, { mode: 0o600 }); }
export function buildState(prev: HostState | null, sel: Selection, records: StepRecord[], detections: Record<string, Installed | null>, installerVersion: string, channel: Channel): HostState {
  const installed: HostState['installed'] = { ...(prev?.installed ?? {}) }; const now = new Date().toISOString();
  for (const r of records) {
    if (!r.ok) continue;
    if (r.op === 'uninstall') delete installed[r.componentId];
    else if (r.op === 'install' || r.op === 'update' || r.op === 'configure') installed[r.componentId] = { version: r.to ?? detections[r.componentId]?.version ?? null, at: now };
    else if (r.op === 'skip' && !installed[r.componentId] && detections[r.componentId]) installed[r.componentId] = { version: detections[r.componentId]?.version ?? null, at: now };
  }
  return { version: 1, installerVersion, profile: sel.profile, selectedIds: sel.components.map((c) => c.id), channel, installed, lastRun: now };
}
