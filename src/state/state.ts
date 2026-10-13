import type { Channel, HostState, Installed, Profile, Selection, StepRecord } from '../types.js';
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
export function buildState(prev: HostState | null, sel: Selection, records: StepRecord[], detections: Record<string, Installed | null>, installerVersion: string, channel: Channel, opts: { mergeSelected?: boolean; cooldownDays?: number; versions?: Array<{ componentId: string; key: string; version: string }> } = {}): HostState {
  const installed: HostState['installed'] = { ...(prev?.installed ?? {}) }; const now = new Date().toISOString();
  for (const r of records) {
    if (!r.ok) continue;
    if (r.op === 'uninstall') delete installed[r.componentId];
    // `changed` separates "we installed it" from "it was already correct": only the former is ours to remove later.
    // An `update` never changes provenance: upgrading the distro's git does not make git ours.
    else if (r.op === 'update') installed[r.componentId] = { version: r.to ?? detections[r.componentId]?.version ?? null, at: now, byUs: installed[r.componentId]?.byUs ?? false };
    else if (r.op === 'install' || r.op === 'configure') {
      // `previous` is the most recent foreign value we wrote over; a re-apply that replaced nothing keeps the old one
      const previous = r.previous !== undefined ? r.previous : installed[r.componentId]?.previous;
      installed[r.componentId] = { version: r.to ?? detections[r.componentId]?.version ?? null, at: now, byUs: r.changed || (installed[r.componentId]?.byUs ?? false), ...(previous !== undefined ? { previous } : {}) };
    }
    else if (r.op === 'skip' && !installed[r.componentId] && detections[r.componentId]) installed[r.componentId] = { version: detections[r.componentId]?.version ?? null, at: now, byUs: false };
  }
  // the versions a component now runs: only where this run left it converged (no failed step for it)
  for (const v of opts.versions ?? []) {
    const rec = installed[v.componentId]; if (!rec || records.some((r) => r.componentId === v.componentId && !r.ok)) continue;
    installed[v.componentId] = { ...rec, versions: { ...rec.versions, [v.key]: v.version } };
  }
  const selected = sel.components.map((c) => c.id);
  const selectedIds = opts.mergeSelected ? [...new Set([...(prev?.selectedIds ?? []), ...selected])] : selected;
  const cooldownDays = opts.cooldownDays ?? prev?.cooldownDays;
  return { version: 1, installerVersion, profile: opts.mergeSelected ? prev?.profile ?? sel.profile : sel.profile, selectedIds, channel, ...(cooldownDays !== undefined ? { cooldownDays } : {}), installed, lastRun: now };
}
/**
 * Which release channel this run uses. An explicit `--channel` wins; otherwise the channel saved by the last run on
 * this host, so `install --channel stable` is not undone by the next bare `update`; otherwise the profile's; otherwise
 * `latest`. The CLI keeps "no flag given" distinct from "latest" precisely so that the saved value can apply.
 */
export function resolveChannel(explicit: Channel | undefined, state: HostState | null, profile: Profile | undefined): Channel {
  return explicit ?? state?.channel ?? profile?.channel ?? 'latest';
}
