import type { Ctx } from '../types.js';
import { resolveSelection } from '../manifest/resolve.js';
import { readState } from '../state/state.js';
import { driftReport } from '../update/drift.js';
import { table } from '../ui/log.js';
export async function runCheck(ctx: Ctx, opts: { json?: boolean }): Promise<number> {
  const state = await readState(ctx.paths.stateFile);
  const sel = state ? resolveSelection(ctx.manifest, ctx.host, { profile: 'saved', savedIds: state.selectedIds }) : resolveSelection(ctx.manifest, ctx.host, { profile: 'all' });
  const rows = await driftReport(ctx, sel.components);
  if (opts.json) console.log(JSON.stringify({ profile: sel.profile, rows }, null, 2));
  else { console.log(table(rows.map((r) => [r.id, r.kind, r.installed ?? '-', r.latest ?? '-', r.status]), ['component', 'kind', 'installed', 'latest', 'status'])); }
  const drift = rows.filter((r) => r.status === 'outdated' || r.status === 'missing').length;
  if (!opts.json) console.log(drift ? `\n${drift} component(s) need attention. Run: super-agent-installer update` : '\nEverything is up to date.');
  return drift ? 2 : 0;
}
