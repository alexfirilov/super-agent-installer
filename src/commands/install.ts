import type { Component, Ctx, ProfileName } from '../types.js';
import { resolveSelection } from '../manifest/resolve.js';
import { buildPlan } from '../planner.js';
import { executeGrouped } from '../executor.js';
import { readState, writeState, buildState } from '../state/state.js';
import { renderPlan, renderSummary, promptSecrets, postInstallHints } from './summary.js';
import { ensureAuth, isHeadless } from '../auth/agents.js';
import { probeVersion } from '../detect/tools.js';
import { persistSecrets } from '../secrets/persist.js';
export interface InstallOpts { profile?: ProfileName; only?: string[]; skip?: string[]; fromState?: boolean; picked?: string[]; json?: boolean; installerVersion: string; noLogin?: boolean; noPersistSecrets?: boolean }
const NIX_SNIPPET = `NixOS detected. Use home-manager instead:\n  programs.claude-code.enable = true;\n  programs.codex.enable = true;\nSee https://home-manager-options.extranix.com/?query=claude-code`;
/** Agents this run actually needs signed in: the agent-target excludes the other agent on at least one
 * selected component, AND either the agent's own component is in the selection (it will exist by the
 * time components run) or it is already installed on this host. Never signs in an agent nothing needs. */
async function agentsToSignIn(ctx: Ctx, components: Component[]): Promise<Array<'claude' | 'codex'>> {
  const agents: Array<'claude' | 'codex'> = [];
  if (components.some((c) => c.agents !== 'codex')) {
    if (components.some((c) => c.id === 'claude-code') || (await probeVersion(ctx.run, ['claude', '--version']))) agents.push('claude');
  }
  if (components.some((c) => c.agents !== 'claude')) {
    if (components.some((c) => c.id === 'codex-cli') || (await probeVersion(ctx.run, ['codex', '--version']))) agents.push('codex');
  }
  return agents;
}
export async function runInstall(ctx: Ctx, o: InstallOpts): Promise<number> {
  if (ctx.host.isNixOS) { console.error(NIX_SNIPPET); return 4; }
  const state = await readState(ctx.paths.stateFile);
  const sel = o.picked ? resolveSelection(ctx.manifest, ctx.host, { profile: o.profile ?? state?.profile ?? 'all', picked: o.picked }) : o.fromState && state ? resolveSelection(ctx.manifest, ctx.host, { profile: 'saved', savedIds: state.selectedIds, skip: o.skip }) : resolveSelection(ctx.manifest, ctx.host, { profile: o.profile ?? 'all', only: o.only, skip: o.skip });
  if (ctx.host.diskFreeMb !== null && ctx.host.diskFreeMb < 2000) ctx.log.warn(`only ${ctx.host.diskFreeMb} MB free in home; plugin caches can need 1.5 GB`);
  if (ctx.host.claudeRunning) ctx.log.warn('a claude session is running; agent updates will be skipped and plugin changes need a restart');
  for (const e of sel.excluded) ctx.log.debug(`excluded ${e.id}: ${e.reason}`);
  ctx.log.info(`profile ${sel.profile}: ${sel.components.length} components, Claude always-on tokens ~${sel.tokenTotals.claude}, Codex MCP servers ${sel.codexMcpCount}`);
  /** Sign-in + secrets, exactly once per run. It cannot run before the components: on a clean host `claude`/`codex`
   * do not exist yet, so every probe would ENOENT and both sign-ins would "fail". It must not run later than this
   * either: `ctx.auth` gates the codex-plugin group, and MCP specs substitute `${VAR}` when their group is planned.
   * So it runs immediately after the `agent` group installed the agents (`afterKind` below), or before the loop when
   * this selection installs no agent because both are already on the host. */
  let signedIn = false;
  const signInAndSecrets = async (): Promise<void> => {
    if (signedIn) return; signedIn = true;
    if (!o.noLogin) {
      const agents = await agentsToSignIn(ctx, sel.components);
      if (agents.length) {
        const results = await ensureAuth(ctx, agents, { headless: isHeadless(ctx) });
        ctx.auth = { ...ctx.auth, ...Object.fromEntries(results.map((r) => [r.agent, r])) };
      }
    }
    await promptSecrets(ctx, sel.components);
    if (!o.noPersistSecrets && ctx.secrets.size) {
      ctx.secretsPersist = await persistSecrets(ctx, ctx.secrets); // after promptSecrets, so it covers everything in ctx.secrets including a captured CLAUDE_CODE_OAUTH_TOKEN
      for (const f of ctx.secretsPersist.failed) ctx.log.warn(`could not persist ${f.name} to the user environment: ${f.reason}`);
    }
  };
  const preview = await buildPlan(sel, ctx, 'install', { preview: true });
  if (!o.json) console.log(renderPlan(preview.actions));
  if (ctx.dryRun) { ctx.log.info('dry-run: nothing executed'); return 0; }
  if (!sel.components.some((c) => c.kind === 'agent')) await signInAndSecrets();
  const result = await executeGrouped(sel, ctx, 'install', { afterKind: (kind) => (kind === 'agent' ? signInAndSecrets() : undefined) });
  if (o.json) console.log(JSON.stringify({ selection: sel.components.map((c) => c.id), records: result.records }, null, 2)); else { console.log('\n' + renderSummary(result.records)); const hints = postInstallHints(ctx, sel.components, result.records); if (hints.length) console.log('\nNext steps:\n- ' + hints.join('\n- ')); }
  await writeState(ctx.paths.stateFile, buildState(state, sel, result.records, result.plan.detections, o.installerVersion, ctx.channel));
  return result.failed ? 1 : 0;
}
