import { readFile } from 'node:fs/promises';
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { readJsonFile, writeJsonAtomic } from '../config/json.js';
import { probeVersion } from '../detect/tools.js';
import { action, ok, fail, skipAction } from './types.js';

/** True for the base URL caveman's native setup writes: its local gateway, or any host with caveman's `/w/claude` app path. */
export function isCavemanRoute(url: unknown): boolean {
  return typeof url === 'string' && (/\/w\/claude\/?$/.test(url) || /^https?:\/\/(127\.0\.0\.1|localhost):8787(\/|$)/.test(url));
}

/**
 * Caveman 2.7.0's `setup --agent-native claude` bundles gateway ROUTING with the hooks we actually want: it writes
 * `env.ANTHROPIC_BASE_URL = <gateway>/w/claude` plus `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1` into
 * ~/.claude/settings.json. With the proxy not running, every request goes to a dead port and Claude Code cannot
 * talk to Anthropic at all (2026-09-19, this workstation); and remote control refuses a proxied base URL by design.
 * The approved design is hooks + statusline with the proxy OFF, and caveman offers no hooks-only mode (`--no-proxy`
 * is on its deleted-flags list), so we take the route back out after every setup and on every re-run.
 * Only caveman's own route is touched: a base URL the user set themselves is left exactly as it was.
 */
export async function stripCavemanRoute(ctx: Ctx): Promise<boolean> {
  const settings = (await readJsonFile<Record<string, unknown>>(ctx.paths.claudeSettings)) ?? null;
  const env = settings?.env;
  if (!env || typeof env !== 'object' || Array.isArray(env)) return false;
  const e = env as Record<string, unknown>;
  if (!isCavemanRoute(e.ANTHROPIC_BASE_URL)) return false;
  delete e.ANTHROPIC_BASE_URL;
  delete e._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL; // only meaningful alongside the route; without it, it just pre-blesses the next one
  if (!ctx.dryRun) await writeJsonAtomic(ctx.paths.claudeSettings, settings);
  ctx.log.info('caveman: removed the gateway route from ~/.claude/settings.json (hooks kept, proxy off by design)');
  return true;
}

export const hookProvider: Provider = {
  kind: 'hook',
  async detect(c, ctx) {
    if (c.spec.kind !== 'hook') return null;
    if (c.spec.agent === 'claude') { const s = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; const text = JSON.stringify((s as { hooks?: unknown }).hooks ?? {}); return /caveman-proxy[^"]*native-hook claude|caveman-proxy' native-hook claude/.test(text) ? { version: null } : null; }
    try { const t = await readFile(ctx.paths.codexHooks, 'utf8'); return /caveman/.test(t) ? { version: null } : null; } catch { return null; }
  },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'hook') return []; const agent = c.spec.agent;
    if (agent === 'codex' && ctx.host.platform === 'windows') return [skipAction(c.id, 'caveman Codex hooks are disabled on Windows (caveman docs/install-windows.md)')];
    if (!(await probeVersion(ctx.run, ['caveman', '--version']))) return [skipAction(c.id, 'caveman CLI not found; select the caveman-cli tool first', 'caveman-cli')];
    if (mode === 'uninstall') return installed ? [action(c.id, 'uninstall', `remove caveman native hooks (${agent})`, async () => {
      const r = await ctx.run(['caveman', 'setup', '--agent-native', agent, '--remove'], { allowFailure: true });
      if (r.code !== 0) return fail(`caveman setup --agent-native ${agent} --remove failed: ${(r.stderr || r.stdout).trim()}`);
      return ok('caveman hooks removed');
    })] : [];
    if (installed && mode !== 'update') {
      // hooks are in place, but a re-run must still heal routing that caveman (or its own auto-update) wired since
      if (agent === 'claude') {
        let settings: Record<string, unknown>;
        try { settings = (await readJsonFile<Record<string, unknown>>(ctx.paths.claudeSettings)) ?? {}; }
        catch (e) { return [action(c.id, 'configure', 'read settings.json', async () => fail((e as Error).message))]; } // a malformed file fails this component, never the whole plan
        if (isCavemanRoute((settings.env as Record<string, unknown> | undefined)?.ANTHROPIC_BASE_URL)) {
          return [action(c.id, 'configure', 'remove caveman gateway route from settings.json', async () => { await stripCavemanRoute(ctx); return ok('caveman proxy route removed from settings.json (hooks kept)'); })];
        }
      }
      return [];
    }
    return [action(c.id, installed ? 'update' : 'install', `caveman setup --agent-native ${agent}`, async () => {
      let r = await ctx.run(['caveman', 'setup', '--agent-native', agent], { allowFailure: true, timeoutMs: 300000 });
      // GCE QA on Rocky 9: a fresh host fails with "caveman-mcp not found; run `caveman setup --install`" -- a
      // command we can run ourselves, so telling the user to do it is the leftover work §3 forbids.
      if (r.code !== 0 && /caveman setup --install|caveman-mcp not found/i.test(r.stderr + r.stdout)) {
        ctx.log.info('caveman: installing the caveman-mcp helper it asked for');
        await ctx.run(['caveman', 'setup', '--install'], { allowFailure: true, timeoutMs: 300000 });
        r = await ctx.run(['caveman', 'setup', '--agent-native', agent], { allowFailure: true, timeoutMs: 300000 });
      }
      if (r.code !== 0) return fail(`caveman setup failed: ${(r.stderr || r.stdout).trim()}`);
      const stripped = agent === 'claude' && (await stripCavemanRoute(ctx));
      return ok(`caveman native hooks ${installed ? 'regenerated' : 'installed'} for ${agent}${stripped ? '; proxy route removed (hooks only, by design)' : ''}${agent === 'codex' ? '. Open Codex and run /hooks to trust them.' : ''}`);
    })];
  },
};
