import type { Ctx, ProfileName } from '../types.js';
import { resolveSelection } from '../manifest/resolve.js';
import { buildPlan } from '../planner.js';
import { executePlan } from '../executor.js';
import { readState, writeState, buildState } from '../state/state.js';
import { renderPlan, renderSummary, promptSecrets, postInstallHints } from './summary.js';
export interface InstallOpts { profile?: ProfileName; only?: string[]; skip?: string[]; fromState?: boolean; picked?: string[]; json?: boolean; installerVersion: string }
const NIX_SNIPPET = `NixOS detected. Use home-manager instead:\n  programs.claude-code.enable = true;\n  programs.codex.enable = true;\nSee https://home-manager-options.extranix.com/?query=claude-code`;
export async function runInstall(ctx: Ctx, o: InstallOpts): Promise<number> {
  if (ctx.host.isNixOS) { console.error(NIX_SNIPPET); return 4; }
  const state = await readState(ctx.paths.stateFile);
  const sel = o.picked ? resolveSelection(ctx.manifest, ctx.host, { profile: o.profile ?? state?.profile ?? 'all', picked: o.picked }) : o.fromState && state ? resolveSelection(ctx.manifest, ctx.host, { profile: 'saved', savedIds: state.selectedIds, skip: o.skip }) : resolveSelection(ctx.manifest, ctx.host, { profile: o.profile ?? 'all', only: o.only, skip: o.skip });
  if (ctx.host.diskFreeMb !== null && ctx.host.diskFreeMb < 2000) ctx.log.warn(`only ${ctx.host.diskFreeMb} MB free in home; plugin caches can need 1.5 GB`);
  if (ctx.host.claudeRunning) ctx.log.warn('a claude session is running; agent updates will be skipped and plugin changes need a restart');
  for (const e of sel.excluded) ctx.log.debug(`excluded ${e.id}: ${e.reason}`);
  ctx.log.info(`profile ${sel.profile}: ${sel.components.length} components, Claude always-on tokens ~${sel.tokenTotals.claude}, Codex MCP servers ${sel.codexMcpCount}`);
  const plan = await buildPlan(sel, ctx, 'install');
  if (!o.json) console.log(renderPlan(plan.actions));
  if (ctx.dryRun) { ctx.log.info('dry-run: nothing executed'); return 0; }
  await promptSecrets(ctx, sel.components);
  const result = await executePlan(plan, ctx);
  if (o.json) console.log(JSON.stringify({ selection: sel.components.map((c) => c.id), records: result.records }, null, 2)); else { console.log('\n' + renderSummary(result.records)); const hints = postInstallHints(ctx, sel.components, result.records); if (hints.length) console.log('\nNext steps:\n- ' + hints.join('\n- ')); }
  await writeState(ctx.paths.stateFile, buildState(state, sel, result.records, plan.detections, o.installerVersion, ctx.channel));
  return result.failed ? 1 : 0;
}
