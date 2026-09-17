import { stat } from 'node:fs/promises';
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { readJsonFile, writeJsonAtomic, backupFile, mergeClaudeSettings } from '../config/json.js';
import { readToml, writeTomlMarkerBlock, removeTomlMarkerBlock } from '../config/toml.js';
import { getClaudeState } from './claude-plugin.js';
import { getCodexState } from './codex-plugin.js';
import { action, ok, skipAction } from './types.js';

const deepEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function getPath(o: unknown, path: string[]): unknown { let cur = o; for (const k of path) { if (!cur || typeof cur !== 'object') return undefined; cur = (cur as Record<string, unknown>)[k]; } return cur; }
function leaves(o: Record<string, unknown>, prefix: string[] = []): Array<{ path: string[]; value: unknown }> { return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? leaves(v as Record<string, unknown>, [...prefix, k]) : [{ path: [...prefix, k], value: v }])); }
function expandHome(v: unknown, home: string): unknown {
  if (typeof v === 'string') return v.replace(/\$\{HOME\}/g, home);
  if (Array.isArray(v)) return v.map((x) => expandHome(x, home));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k.replace(/\$\{HOME\}/g, home), expandHome(val, home)]));
  return v;
}
async function fileExists(path: string): Promise<boolean> { try { await stat(path); return true; } catch { return false; } }

export const settingProvider: Provider = {
  kind: 'setting',
  async detect(c, ctx) {
    if (c.spec.kind !== 'setting') return null; const s = c.spec;
    if (s.windowsGitConfig && ctx.host.platform !== 'windows') return null;
    if (s.claudeSettings) { const cur = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; for (const [k, v] of Object.entries(s.claudeSettings)) { if (v === null ? k in cur : !deepEq(cur[k], v)) return null; } }
    if (s.claudeJsonSeed && !(await fileExists(ctx.paths.claudeJson))) return null;
    if (s.codexFeatures || s.codexToml) {
      const cfg = await readToml(ctx.paths.codexConfig);
      for (const [k, v] of Object.entries(s.codexFeatures ?? {})) if (getPath(cfg, ['features', k]) !== v) return null;
      const expanded = expandHome(s.codexToml ?? {}, ctx.host.home) as Record<string, unknown>;
      for (const l of leaves(expanded)) if (!deepEq(getPath(cfg, l.path), l.value)) return null;
    }
    if (s.windowsGitConfig) for (const [k, v] of Object.entries(s.windowsGitConfig)) { const r = await ctx.run(['git', 'config', '--global', '--get', k], { readOnly: true, allowFailure: true }); if (r.code !== 0 || r.stdout.trim() !== v) return null; }
    return { version: null };
  },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'setting') return []; const s = c.spec;
    if (s.windowsGitConfig && ctx.host.platform !== 'windows') return [];
    if (s.target === 'claude' && !(await getClaudeState(ctx)).installed) return [skipAction(c.id, 'Claude Code not installed')];
    if (s.target === 'codex' && !(await getCodexState(ctx)).installed) return [skipAction(c.id, 'Codex CLI not installed')];
    if (mode === 'uninstall') {
      if (!installed) return [];
      return [action(c.id, 'uninstall', `revert ${c.name}`, async () => {
        if (s.claudeSettings) { const cur = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; const next = { ...cur }; for (const [k, v] of Object.entries(s.claudeSettings)) if (v !== null && deepEq(cur[k], v)) delete next[k]; if (!ctx.dryRun) { await backupFile(ctx.paths.claudeSettings, ctx.paths.backupsDir); await writeJsonAtomic(ctx.paths.claudeSettings, next); } }
        for (const [k, v] of Object.entries(s.codexFeatures ?? {})) await ctx.run(['codex', 'features', v ? 'disable' : 'enable', k], { allowFailure: true });
        if (s.codexToml && !ctx.dryRun) await removeTomlMarkerBlock(ctx.paths.codexConfig, ctx.paths.backupsDir);
        // claudeJsonSeed is a one-time seed; uninstall never removes ~/.claude.json.
        return ok(`${c.name} reverted`);
      })];
    }
    if (installed) return [];
    return [action(c.id, 'configure', `apply ${c.name}`, async () => {
      if (s.claudeSettings) { const cur = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; const next = mergeClaudeSettings(cur, s.claudeSettings); if (!ctx.dryRun) { await backupFile(ctx.paths.claudeSettings, ctx.paths.backupsDir); await writeJsonAtomic(ctx.paths.claudeSettings, next); } }
      if (s.claudeJsonSeed && !(await fileExists(ctx.paths.claudeJson)) && !ctx.dryRun) await writeJsonAtomic(ctx.paths.claudeJson, s.claudeJsonSeed, { mode: 0o600 });
      for (const [k, v] of Object.entries(s.codexFeatures ?? {})) await ctx.run(['codex', 'features', v ? 'enable' : 'disable', k]);
      if (s.codexToml) {
        const existing = await readToml(ctx.paths.codexConfig);
        const expanded = expandHome(s.codexToml, ctx.host.home) as Record<string, unknown>;
        const blockKeys: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(expanded)) { if (k in existing && !ctx.dryRun) ctx.log.warn(`${c.name}: top-level [${k}] already exists in config.toml; merging the managed block may fail if keys collide`); blockKeys[k] = v; }
        if (!ctx.dryRun) await writeTomlMarkerBlock(ctx.paths.codexConfig, blockKeys, ctx.paths.backupsDir);
      }
      for (const [k, v] of Object.entries(s.windowsGitConfig ?? {})) await ctx.run(['git', 'config', '--global', k, v]);
      return ok(`${c.name} applied`);
    })];
  },
};
