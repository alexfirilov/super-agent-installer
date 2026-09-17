import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { Ctx } from '../types.js';
import { probeVersion } from './tools.js';
export interface ClaudeState { installed: boolean; version: string | null; plugins: Array<{ id: string; version: string; scope: string; enabled: boolean }>; marketplaces: string[]; mcp: Record<string, unknown>; settings: Record<string, unknown> }
export interface CodexState { installed: boolean; version: string | null; plugins: Array<{ id: string; version: string | null }>; marketplaces: string[]; mcp: Record<string, Record<string, unknown>>; config: Record<string, unknown> }
async function readJson(p: string): Promise<Record<string, unknown>> { try { return JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>; } catch { return {}; } }
function lastJsonLine(s: string): unknown { const lines = s.trim().split('\n').filter((l) => l.trim().startsWith('{') || l.trim().startsWith('[')); const last = lines.pop(); if (!last) return null; try { return JSON.parse(last); } catch { return null; } }
export async function detectClaude(ctx: Ctx): Promise<ClaudeState> {
  const version = await probeVersion(ctx.run, ['claude', '--version']);
  const settings = await readJson(ctx.paths.claudeSettings);
  const claudeJson = await readJson(ctx.paths.claudeJson);
  const known = await readJson(join(ctx.paths.claudeConfigDir, 'plugins', 'known_marketplaces.json'));
  let plugins: ClaudeState['plugins'] = [];
  if (version) { const r = await ctx.run(['claude', 'plugin', 'list', '--json'], { readOnly: true, allowFailure: true, timeoutMs: 60000 }); const j = lastJsonLine(r.stdout); if (Array.isArray(j)) plugins = j as ClaudeState['plugins']; }
  return { installed: !!version, version, plugins, marketplaces: Object.keys(known), mcp: (claudeJson.mcpServers as Record<string, unknown>) ?? {}, settings };
}
export async function detectCodex(ctx: Ctx): Promise<CodexState> {
  const version = await probeVersion(ctx.run, ['codex', '--version']);
  let config: Record<string, unknown> = {};
  try { config = parseToml(await readFile(ctx.paths.codexConfig, 'utf8')) as Record<string, unknown>; } catch { config = {}; }
  let plugins: CodexState['plugins'] = []; let mcp: CodexState['mcp'] = {};
  if (version) {
    const p = await ctx.run(['codex', 'plugin', 'list', '--json'], { readOnly: true, allowFailure: true, timeoutMs: 60000 }); const pj = lastJsonLine(p.stdout) as { installed?: Array<{ pluginId: string; version?: string }> } | null;
    plugins = (pj?.installed ?? []).map((x) => ({ id: x.pluginId, version: x.version ?? null }));
    const m = await ctx.run(['codex', 'mcp', 'list', '--json'], { readOnly: true, allowFailure: true, timeoutMs: 60000 }); const mj = lastJsonLine(m.stdout);
    if (Array.isArray(mj)) for (const s of mj as Array<{ name: string }>) mcp[s.name] = ((config.mcp_servers as Record<string, Record<string, unknown>>) ?? {})[s.name] ?? {};
  }
  if (!Object.keys(mcp).length) mcp = (config.mcp_servers as CodexState['mcp']) ?? {};
  return { installed: !!version, version, plugins, marketplaces: Object.keys((config.marketplaces as Record<string, unknown>) ?? {}), mcp, config };
}
