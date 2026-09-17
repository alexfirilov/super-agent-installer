import * as clack from '@clack/prompts';
import type { Ctx, HostInfo, HostState, Kind, ProfileName } from '../types.js';
import { PROFILE_NAMES } from '../types.js';
import { resolveSelection, slotConflicts } from '../manifest/resolve.js';
export interface PickerUi {
  intro(m: string): void; outro(m: string): void; note(m: string, title?: string): void; isCancel(v: unknown): boolean;
  select(o: { message: string; options: Array<{ value: string; label: string; hint?: string }>; initialValue?: string }): Promise<unknown>;
  multiselect(o: { message: string; options: Array<{ value: string; label: string; hint?: string }>; initialValues?: string[]; required?: boolean }): Promise<unknown>;
  confirm(o: { message: string; initialValue?: boolean }): Promise<unknown>;
}
export const clackUi: PickerUi = { intro: clack.intro, outro: clack.outro, note: clack.note, isCancel: clack.isCancel, select: (o) => clack.select(o as never), multiselect: (o) => clack.multiselect({ ...o, required: false } as never), confirm: clack.confirm };
const CATEGORIES: Array<[Kind, string]> = [['agent', 'Agents'], ['tool', 'Prerequisite tools'], ['claude-plugin', 'Claude Code plugins'], ['codex-plugin', 'Codex plugins'], ['mcp', 'MCP servers'], ['skill', 'Skills'], ['setting', 'Settings'], ['hook', 'Hooks'], ['statusline', 'Status line'], ['instructions', 'Instructions']];
export function hostSummary(h: HostInfo): string { return [`${h.platform}/${h.arch}${h.isWsl ? ' WSL' : ''}${h.isLxc ? ' LXC' : ''}${h.isProxmoxHost ? ' Proxmox host' : ''}`, h.isRoot ? 'root' : `user${h.hasSudo ? ' (sudo)' : ' (no sudo)'}`, `pkg: ${h.pkgManager ?? 'none'}`, h.hasAvx === false ? 'NO AVX' : '', h.diskFreeMb !== null ? `${Math.round(h.diskFreeMb / 1024)} GB free` : ''].filter(Boolean).join(' · '); }
export async function runPicker(ctx: Ctx, o: { state: HostState | null; ui?: PickerUi }): Promise<{ picked: string[]; profile: ProfileName | 'saved' } | null> {
  const ui = o.ui ?? clackUi; const m = ctx.manifest; ui.intro('super-agent-installer'); ui.note(hostSummary(ctx.host), 'Host');
  const profiles: Array<{ value: string; label: string; hint?: string }> = PROFILE_NAMES.filter((p) => m.profiles[p]).map((p) => ({ value: p as string, label: p, hint: m.profiles[p]?.description }));
  if (o.state) profiles.unshift({ value: 'saved', label: 'saved (this host)', hint: `${o.state.selectedIds.length} components from ${o.state.lastRun}` });
  const profile = await ui.select({ message: 'Profile (starting point; you can adjust every category next)', options: profiles, initialValue: o.state ? 'saved' : 'all' }); if (ui.isCancel(profile)) return null;
  const prof = profile as ProfileName | 'saved';
  const base = resolveSelection(m, ctx.host, prof === 'saved' ? { profile: 'saved', savedIds: o.state?.selectedIds ?? [] } : { profile: prof });
  const initial = new Set(base.components.map((c) => c.id)); const picked: string[] = [];
  for (const [kind, label] of CATEGORIES) {
    const comps = m.components.filter((c) => c.kind === kind && c.platforms.includes(ctx.host.platform)); if (!comps.length) continue;
    const options = comps.map((c) => ({ value: c.id, label: `${c.name}${c.forceOffInAll ? ' (off in ALL)' : ''}`, hint: [c.verdict, c.contextCostTokens?.claude ? `${c.contextCostTokens.claude} tok` : '', c.popularity?.stars ? `${c.popularity.stars.toLocaleString()} stars` : c.popularity?.installs ? `${c.popularity.installs.toLocaleString()} installs` : '', c.description].filter(Boolean).join(' · ') }));
    const r = await ui.multiselect({ message: label, options, initialValues: comps.filter((c) => initial.has(c.id)).map((c) => c.id), required: false }); if (ui.isCancel(r)) return null;
    picked.push(...(r as string[]));
  }
  let chosen = m.components.filter((c) => picked.includes(c.id));
  for (const conflict of slotConflicts(chosen)) {
    const w = await ui.select({ message: `Only one ${conflict.slot} component can be active. Keep which?`, options: conflict.ids.map((id) => ({ value: id, label: id })), initialValue: conflict.ids[0] }); if (ui.isCancel(w)) return null;
    chosen = chosen.filter((c) => c.slot !== conflict.slot || c.id === w);
  }
  const sel = resolveSelection(m, ctx.host, { profile: prof, picked: chosen.map((c) => c.id), savedIds: o.state?.selectedIds });
  const warn = [sel.tokenTotals.claude > 8000 ? `Claude always-on tokens ~${sel.tokenTotals.claude} (above the 8k warning line)` : `Claude always-on tokens ~${sel.tokenTotals.claude}`, sel.codexMcpCount > 5 ? `Codex MCP servers: ${sel.codexMcpCount} (Codex has no tool search; keep it at 5 or fewer)` : `Codex MCP servers: ${sel.codexMcpCount}`, `${sel.components.length} components selected`, ...(sel.excluded.filter((e) => e.reason !== 'platform').map((e) => `excluded ${e.id}: ${e.reason}`))];
  ui.note(warn.join('\n'), 'Selection');
  const go = await ui.confirm({ message: 'Proceed with this selection?', initialValue: true }); if (ui.isCancel(go) || !go) return null;
  return { picked: sel.components.map((c) => c.id), profile: prof };
}
