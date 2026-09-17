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
import { tomlTableEquals, TomlError } from '../config/toml.js';
import { backupFile, writeTextAtomic } from '../config/json.js';
import { action, ok, fail, skipAction } from './types.js';
import { secretHints } from './mcp-claude.js';

export const ENV_VARS_SUPPORTED = true;

export function desiredCodexMcp(spec: McpSpec): Record<string, unknown> {
  if (spec.transport === 'http') { const o: Record<string, unknown> = { url: spec.url }; if (spec.bearerEnv) o.bearer_token_env_var = spec.bearerEnv; return { ...o, ...(spec.extra ?? {}) }; }
  const o: Record<string, unknown> = { command: spec.command, args: spec.args ?? [] }; if (spec.env && Object.keys(spec.env).length) o.env = spec.env;
  if (ENV_VARS_SUPPORTED && spec.secretEnv?.length) o.env_vars = spec.secretEnv; return { ...o, ...(spec.extra ?? {}) };
}

/** Replaces `${VAR}` placeholders in `value` (a URL, an args array, or an env value map) using
 * `ctx.env[VAR] ?? ctx.secrets.get(VAR)` for VARs not listed in `spec.secretEnv` (secret
 * placeholders are left untouched -- they are written as-is and resolved by the target agent).
 * Throws with a message matching `<VAR> is not set; export it or answer the prompt` when a
 * non-secret placeholder cannot be resolved. */
function resolveVar(name: string, spec: McpSpec, ctx: Ctx): string {
  if ((spec.secretEnv ?? []).includes(name)) return `\${${name}}`;
  const v = ctx.env[name] ?? ctx.secrets.get(name);
  if (v === undefined) throw new Error(`${name} is not set; export it or answer the prompt`);
  return v;
}
function substituteString(value: string, spec: McpSpec, ctx: Ctx): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => resolveVar(name, spec, ctx));
}
export function substitute<T>(value: T, spec: McpSpec, ctx: Ctx): T {
  if (typeof value === 'string') return substituteString(value, spec, ctx) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => substitute(v, spec, ctx)) as unknown as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substitute(v, spec, ctx)])) as unknown as T;
  return value;
}
function substituteSpec(spec: McpSpec, ctx: Ctx): McpSpec {
  const out: McpSpec = { ...spec };
  if (out.url) out.url = substitute(out.url, spec, ctx);
  if (out.args) out.args = substitute(out.args, spec, ctx);
  if (out.env) out.env = substitute(out.env, spec, ctx);
  return out;
}

function hasComments(text: string): boolean {
  let inStr = false; let strCh = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) { if (ch === strCh && text[i - 1] !== '\\') inStr = false; continue; }
    if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
    if (ch === '#') return true;
  }
  return false;
}
async function patchCodexTable(ctx: Ctx, name: string, patch: Record<string, unknown>): Promise<{ applied: boolean; manual: string }> {
  const manual = stringify({ mcp_servers: { [name]: patch } }).trim();
  let text = ''; try { text = await readFile(ctx.paths.codexConfig, 'utf8'); } catch { text = ''; }
  if (hasComments(text)) return { applied: false, manual };
  let doc: Record<string, unknown>; try { doc = text ? (parse(text) as Record<string, unknown>) : {}; } catch (e) { throw new TomlError((e as Error).message); }
  const servers = ((doc.mcp_servers as Record<string, Record<string, unknown>>) ?? {}); servers[name] = { ...(servers[name] ?? {}), ...patch }; doc.mcp_servers = servers;
  if (ctx.dryRun) return { applied: true, manual };
  await backupFile(ctx.paths.codexConfig, ctx.paths.backupsDir);
  await writeTextAtomic(ctx.paths.codexConfig, stringify(doc), { mode: 0o600 });
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
      if (resolved.transport === 'http') { argv.push('--url', resolved.url!); if (resolved.bearerEnv) argv.push('--bearer-token-env-var', resolved.bearerEnv); else if (!resolved.oauth) ctx.log.warn(`${spec.name}: no bearer env var; if the server needs auth run: codex mcp login ${spec.name}`); }
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
