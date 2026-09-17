import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { readJsonFile, writeJsonAtomic, backupFile, mergeClaudeSettings } from '../config/json.js';
import { ASSETS } from '../assets.js';
import { action, ok } from './types.js';
function current(s: Record<string, unknown>): string { const sl = s.statusLine as { command?: string } | undefined; return sl?.command ?? ''; }
function scriptPath(ctx: Ctx): string { const name = ctx.host.platform === 'windows' ? 'caveman-statusline.ps1' : 'caveman-statusline.sh'; return ctx.host.platform === 'windows' ? `${ctx.paths.claudeHooksDir}\\${name}` : join(ctx.paths.claudeHooksDir, name); }
function command(ctx: Ctx): string { const p = scriptPath(ctx); return ctx.host.platform === 'windows' ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${p}"` : `bash "${p}"`; }
async function write(ctx: Ctx, patch: Record<string, unknown>): Promise<void> { const cur = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; if (ctx.dryRun) return; await backupFile(ctx.paths.claudeSettings, ctx.paths.backupsDir); await writeJsonAtomic(ctx.paths.claudeSettings, mergeClaudeSettings(cur, patch)); }
export const statuslineProvider: Provider = {
  kind: 'statusline',
  async detect(c, ctx) {
    if (c.spec.kind !== 'statusline') return null; const cmd = current((await readJsonFile(ctx.paths.claudeSettings)) ?? {});
    if (c.spec.provider === 'caveman') return cmd === command(ctx) ? { version: null } : null;
    return /claude-hud/.test(cmd) ? { version: null } : null;
  },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'statusline') return []; const prov = c.spec.provider;
    if (mode === 'uninstall') { if (!installed) return []; return [action(c.id, 'uninstall', `remove ${prov} statusLine`, async () => { await write(ctx, { statusLine: null }); return ok('statusLine removed'); })]; }
    if (installed) return [];
    if (prov === 'caveman') return [action(c.id, 'install', 'install caveman statusline script and statusLine setting', async () => {
      const name = ctx.host.platform === 'windows' ? 'caveman-statusline.ps1' : 'caveman-statusline.sh';
      if (!ctx.dryRun) { await mkdir(ctx.paths.claudeHooksDir, { recursive: true }); const p = join(ctx.paths.claudeHooksDir, name); await writeFile(p, ASSETS[name], 'utf8'); if (ctx.host.platform !== 'windows') await chmod(p, 0o755); }
      await write(ctx, { statusLine: { type: 'command', command: command(ctx) } }); return ok('caveman statusline configured');
    })];
    return [action(c.id, 'configure', 'hand statusLine over to claude-hud', async () => {
      const cur = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; if (/caveman-statusline/.test(current(cur))) await write(ctx, { statusLine: null });
      return ok('statusLine cleared for claude-hud. In Claude Code run: /claude-hud:setup');
    })];
  },
};
