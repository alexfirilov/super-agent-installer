import { readFile } from 'node:fs/promises';
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { readJsonFile } from '../config/json.js';
import { probeVersion } from '../detect/tools.js';
import { action, ok, fail, skipAction } from './types.js';
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
    if (installed && mode !== 'update') return [];
    return [action(c.id, installed ? 'update' : 'install', `caveman setup --agent-native ${agent}`, async () => {
      const r = await ctx.run(['caveman', 'setup', '--agent-native', agent], { allowFailure: true, timeoutMs: 300000 }); if (r.code !== 0) return fail(`caveman setup failed: ${(r.stderr || r.stdout).trim()}`);
      return ok(`caveman native hooks ${installed ? 'regenerated' : 'installed'} for ${agent}${agent === 'codex' ? '. Open Codex and run /hooks to trust them.' : ''}`);
    })];
  },
};
