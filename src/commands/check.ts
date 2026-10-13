import type { Channel, Ctx } from '../types.js';
import { resolveSelection } from '../manifest/resolve.js';
import { readState, resolveChannel } from '../state/state.js';
import { driftReport } from '../update/drift.js';
import { table } from '../ui/log.js';
import { resolveVersions } from '../version/resolve.js';
import { DEFAULT_COOLDOWN_DAYS } from '../pins.js';
export async function runCheck(ctx: Ctx, opts: { json?: boolean; channel?: Channel; cooldown?: number }): Promise<number> {
  const state = await readState(ctx.paths.stateFile);
  ctx.channel = resolveChannel(opts.channel, state, state && state.profile !== 'saved' ? ctx.manifest.profiles[state.profile] : undefined); // Claude's "latest" differs per channel
  ctx.cooldownDays = opts.cooldown ?? state?.cooldownDays ?? DEFAULT_COOLDOWN_DAYS; // check reports against what update would install; it never asks
  const sel = state ? resolveSelection(ctx.manifest, ctx.host, { profile: 'saved', savedIds: state.selectedIds }) : resolveSelection(ctx.manifest, ctx.host, { profile: 'all' });
  const rows = await driftReport(ctx, (await resolveVersions(sel.components, ctx)).components);
  if (opts.json) console.log(JSON.stringify({ profile: sel.profile, rows }, null, 2));
  else { console.log(table(rows.map((r) => [r.id, r.kind, r.installed ?? '-', r.latest ?? '-', r.status]), ['component', 'kind', 'installed', 'latest', 'status'])); }
  const drift = rows.filter((r) => r.status === 'outdated' || r.status === 'missing').length;
  if (!opts.json) console.log(drift ? `\n${drift} component(s) need attention. Run: super-agent-installer update` : '\nEverything is up to date.');
  return drift ? 2 : 0;
}
