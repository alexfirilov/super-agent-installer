import type { Channel, HostState, Installed, Selection, StepRecord } from '../types.js';
import { readJsonFile, writeJsonAtomic, JsonParseError } from '../config/json.js';
/** A corrupt state file aborts the run rather than reading as "first run": starting over would drop every
 * provenance record, and a later `install` would re-record the host's software as ours. */
export async function readState(path: string): Promise<HostState | null> {
  let s: HostState | null;
  try { s = await readJsonFile<HostState>(path); }
  catch (e) { if (e instanceof JsonParseError) throw new Error(`${e.message} Deleting it makes this a fresh host: uninstall will then refuse anything it cannot prove it installed.`); throw e; }
  return s && s.version === 1 ? s : null;
}
export async function writeState(path: string, state: HostState): Promise<void> { await writeJsonAtomic(path, state, { mode: 0o600 }); }
/**
 * `mergeSelected` is for runs that touch only part of the host (`--only`, an explicit id list). Replacing
 * `selectedIds` with that narrow closure silently dropped every other component out of update, check and
 * uninstall, so the host stopped being managed without anyone being told. Full-profile runs still replace.
 */
export function buildState(prev: HostState | null, sel: Selection, records: StepRecord[], detections: Record<string, Installed | null>, installerVersion: string, channel: Channel, opts: { mergeSelected?: boolean } = {}): HostState {
  const installed: HostState['installed'] = { ...(prev?.installed ?? {}) }; const now = new Date().toISOString();
  for (const r of records) {
    if (!r.ok) continue;
    if (r.op === 'uninstall') delete installed[r.componentId];
    // `changed` separates "we installed it" from "it was already correct": only the former is ours to remove later.
    // An `update` never changes provenance: upgrading the distro's git does not make git ours.
    else if (r.op === 'update') installed[r.componentId] = { version: r.to ?? detections[r.componentId]?.version ?? null, at: now, byUs: installed[r.componentId]?.byUs ?? false };
    else if (r.op === 'install' || r.op === 'configure') installed[r.componentId] = { version: r.to ?? detections[r.componentId]?.version ?? null, at: now, byUs: r.changed || (installed[r.componentId]?.byUs ?? false) };
    else if (r.op === 'skip' && !installed[r.componentId] && detections[r.componentId]) installed[r.componentId] = { version: detections[r.componentId]?.version ?? null, at: now, byUs: false };
  }
  const selected = sel.components.map((c) => c.id);
  const selectedIds = opts.mergeSelected ? [...new Set([...(prev?.selectedIds ?? []), ...selected])] : selected;
  return { version: 1, installerVersion, profile: opts.mergeSelected ? prev?.profile ?? sel.profile : sel.profile, selectedIds, channel, installed, lastRun: now };
}
