// Verified on codex-cli 0.154.0 (2026-09-17): `codex mcp add --help` shows
// `codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)` with
// `--env <KEY=VALUE>` ("Only valid with stdio servers"), `--bearer-token-env-var <ENV_VAR>`
// ("Only valid with streamable HTTP servers"), and `-- <COMMAND>...` as the stdio launcher
// separator. `codex mcp get --help` confirms `--json`.
// Doc check: https://learn.chatgpt.com/docs/config-reference.md returned 404 on this host;
// the current config reference lives at https://developers.openai.com/codex/config-reference.md
// (fetched 2026-09-17), which documents `mcp_servers.<id>.env_vars` as
// `array<string | { name = string, source = "local" | "remote" }>` -- "Additional environment
// variables to whitelist for an MCP stdio server. String entries default to source = 'local'" --
// i.e. env vars forwarded from the parent process environment. It also documents
// `mcp_servers.<id>.startup_timeout_sec` and `mcp_servers.<id>.bearer_token_env_var`.
// Since env_vars IS documented for stdio mcp_servers, ENV_VARS_SUPPORTED is true and secretEnv
// names are written as a plain string array under that key.
import { readFile } from 'node:fs/promises';
import { parse, stringify } from 'smol-toml';
import type { Action, Component, Ctx, Installed, McpSpec, Provider } from '../types.js';
import { getCodexState } from './codex-plugin.js';
import { tomlTableEquals, placeTomlMarkerBlock, TomlError } from '../config/toml.js';
import { backupFile, writeTextAtomic } from '../config/json.js';
import { action, ok, fail, skipAction } from './types.js';
import { secretHints, substituteSpec } from './mcp-shared.js';
import { MARKER_STYLES, extractMarkerBlock, removeMarkerBlock } from '../config/markers.js';

export const ENV_VARS_SUPPORTED = true;

export function desiredCodexMcp(spec: McpSpec): Record<string, unknown> {
  if (spec.transport === 'http') { const o: Record<string, unknown> = { url: spec.url }; if (spec.bearerEnv) o.bearer_token_env_var = spec.bearerEnv; return { ...o, ...(spec.extra ?? {}) }; }
  const o: Record<string, unknown> = { command: spec.command, args: spec.args ?? [] }; if (spec.env && Object.keys(spec.env).length) o.env = spec.env;
  if (ENV_VARS_SUPPORTED && spec.secretEnv?.length) o.env_vars = spec.secretEnv; return { ...o, ...(spec.extra ?? {}) };
}

const MARKER_LINES = new Set<string>([MARKER_STYLES.hash.start, MARKER_STYLES.hash.end]);
/** True when the file has user comments (which smol-toml's stringify would drop). Our own marker lines do not count. */
export function hasComments(text: string): boolean {
  for (const line of text.split('\n')) {
    if (MARKER_LINES.has(line.trim())) continue;
    let inStr = false; let strCh = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inStr) { if (ch === strCh && line[i - 1] !== '\\') inStr = false; continue; }
      if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
      if (ch === '#') return true;
    }
  }
  return false;
}
async function patchCodexTable(ctx: Ctx, name: string, patch: Record<string, unknown>): Promise<{ applied: boolean; manual: string }> {
  const manual = stringify({ mcp_servers: { [name]: patch } }).trim();
  let text = ''; try { text = await readFile(ctx.paths.codexConfig, 'utf8'); } catch { text = ''; }
  if (hasComments(text)) return { applied: false, manual };
  // our own marker block (settings) is kept verbatim: only the rest of the file goes through parse/stringify
  const block = extractMarkerBlock(text, 'hash'); const rest = block === null ? text : removeMarkerBlock(text, 'hash');
  let doc: Record<string, unknown>; try { doc = rest.trim() ? (parse(rest) as Record<string, unknown>) : {}; } catch (e) { throw new TomlError((e as Error).message); }
  const servers = ((doc.mcp_servers as Record<string, Record<string, unknown>>) ?? {}); servers[name] = { ...(servers[name] ?? {}), ...patch }; doc.mcp_servers = servers;
  let next = stringify(doc); if (block !== null) next = placeTomlMarkerBlock(next, block);
  try { parse(next); } catch (e) { throw new TomlError(`refusing to write ${ctx.paths.codexConfig}: merged file does not parse (${(e as Error).message})`); }
  if (ctx.dryRun) return { applied: true, manual };
  await backupFile(ctx.paths.codexConfig, ctx.paths.backupsDir);
  await writeTextAtomic(ctx.paths.codexConfig, next, { mode: 0o600 });
  return { applied: true, manual };
}

export const mcpCodexProvider: Provider = {
  kind: 'mcp',
  async detect(c, ctx) { if (c.spec.kind !== 'mcp') return null; const st = await getCodexState(ctx); if (!st.installed) return null; const t = st.mcp[c.spec.name]; return t ? { version: null, details: t } : null; },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'mcp') return []; const spec = c.spec; const st = await getCodexState(ctx); if (!st.installed) return [skipAction(c.id, 'Codex CLI not installed', 'codex-cli')];
    if (mode === 'uninstall') return installed ? [action(c.id, 'uninstall', `remove MCP ${spec.name} (Codex)`, async () => { await ctx.run(['codex', 'mcp', 'remove', spec.name], { allowFailure: true }); return ok(`${spec.name} removed`); })] : [];
    const op = installed ? 'configure' : 'install';
    let resolved: McpSpec;
    try { resolved = substituteSpec(spec, ctx); } catch (e) {
      return [action(c.id, op, `${op} MCP ${spec.name} (Codex)`, async () => fail((e as Error).message))];
    }
    const desired = desiredCodexMcp(resolved);
    if (installed && tomlTableEquals(installed.details, desired)) return [];
    return [action(c.id, op, `${op} MCP ${spec.name} (Codex)`, async () => {
      const argv = ['codex', 'mcp', 'add', spec.name];
      if (resolved.transport === 'http') { argv.push('--url', resolved.url!); if (resolved.bearerEnv) argv.push('--bearer-token-env-var', resolved.bearerEnv); else if (!resolved.oauth && c.secrets?.length) ctx.log.warn(`${spec.name}: no bearer env var; if the server needs auth run: codex mcp login ${spec.name}`); }
      else { for (const [k, v] of Object.entries(resolved.env ?? {})) argv.push('--env', `${k}=${v}`); argv.push('--', resolved.command!, ...(resolved.args ?? [])); }
      await ctx.run(argv, { timeoutMs: 120000 });
      const extra: Record<string, unknown> = { ...(spec.extra ?? {}) }; if (ENV_VARS_SUPPORTED && spec.secretEnv?.length) extra.env_vars = spec.secretEnv;
      let note = '';
      if (Object.keys(extra).length) { const r = await patchCodexTable(ctx, spec.name, extra); if (!r.applied) note = ` config.toml has comments, so extra keys were not written automatically. Add under [mcp_servers.${spec.name}]:\n${r.manual}`; }
      const chk = await ctx.run(['codex', 'mcp', 'get', spec.name, '--json'], { readOnly: true, allowFailure: true }); if (chk.code !== 0 && !ctx.dryRun) return fail(`codex cannot read ${spec.name} after write: ${(chk.stderr || chk.stdout).trim()}`);
      return ok(`${spec.name} configured for Codex.${secretHints(c, ctx)}${note}`);
    })];
  },
};
