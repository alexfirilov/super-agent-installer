import type { Ctx, Manifest, Platform } from '../types.js';
import { readState } from '../state/state.js';
import { table } from '../ui/log.js';
export function renderList(m: Manifest, platform: Platform, selected: string[]): string {
  const rows = m.components.filter((c) => c.platforms.includes(platform)).map((c) => [c.id, c.kind, c.agents, c.verdict, String(c.contextCostTokens?.claude ?? c.contextCostTokens?.codex ?? ''), c.defaultSelected && !c.forceOffInAll ? 'default' : c.forceOffInAll ? 'forced-off' : 'optional', selected.includes(c.id) ? '[selected]' : '', c.name]);
  return table(rows, ['id', 'kind', 'agents', 'verdict', 'tokens', 'in ALL', 'state', 'name']);
}
export async function runList(ctx: Ctx): Promise<number> {
  const state = await readState(ctx.paths.stateFile);
  console.log(renderList(ctx.manifest, ctx.host.platform, state?.selectedIds ?? []));
  return 0;
}
