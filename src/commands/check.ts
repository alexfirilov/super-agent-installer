import type { Channel, Ctx } from '../types.js';
import { resolveSelection } from '../manifest/resolve.js';
import { readState, resolveChannel } from '../state/state.js';
import { driftReport } from '../update/drift.js';
import { table } from '../ui/log.js';
import { resolveVersions } from '../version/resolve.js';
import { DEFAULT_COOLDOWN_DAYS } from '../pins.js';
import { retiredToRemove } from './retire.js';
export async function runCheck(ctx: Ctx, opts: { json?: boolean; channel?: Channel; cooldown?: number }): Promise<number> {
  const state = await readState(ctx.paths.stateFile);
  ctx.channel = resolveChannel(opts.channel, state); // Claude's "latest" differs per channel
  ctx.cooldownDays = opts.cooldown ?? state?.cooldownDays ?? DEFAULT_COOLDOWN_DAYS; // check reports against what update would install; it never asks
  const sel = state ? resolveSelection(ctx.manifest, ctx.host, { savedIds: state.selectedIds }) : resolveSelection(ctx.manifest, ctx.host, {});
  const rows = await driftReport(ctx, (await resolveVersions(sel.components, ctx)).components);
  for (const c of retiredToRemove(ctx, state)) rows.push({ id: c.id, name: c.name, kind: c.kind, installed: null, latest: 'removed from catalog', status: 'outdated' });
  if (opts.json) console.log(JSON.stringify({ rows }, null, 2));
  else { console.log(table(rows.map((r) => [r.id, r.kind, r.installed ?? '-', r.latest ?? '-', r.status]), ['component', 'kind', 'installed', 'latest', 'status'])); }
  const drift = rows.filter((r) => r.status === 'outdated' || r.status === 'missing').length;
  const unknown = rows.filter((r) => r.status === 'unknown' && (r.kind === 'claude-plugin' || r.kind === 'skill')).length;
  if (!opts.json) console.log(`${drift ? `\n${drift} component(s) need attention. Run: super-agent-installer update` : '\nNothing known to be out of date.'}${unknown ? `\n${unknown} plugin(s) or skill(s) cannot be compared with upstream; update refreshes them anyway.` : ''}`);
  return drift ? 2 : 0;
}
