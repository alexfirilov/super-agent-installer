import type { Component, Ctx, McpSpec } from '../types.js';

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
/** The spec with url/args/env placeholders resolved (secret ones kept as `${VAR}` references). */
export function substituteSpec(spec: McpSpec, ctx: Ctx): McpSpec {
  const out: McpSpec = { ...spec };
  if (out.url) out.url = substitute(out.url, spec, ctx);
  if (out.args) out.args = substitute(out.args, spec, ctx);
  if (out.env) out.env = substitute(out.env, spec, ctx);
  return out;
}
export function secretHints(c: Component, ctx: Ctx): string {
  const missing = (c.spec.kind === 'mcp' ? c.spec.secretEnv ?? [] : []).filter((v) => !ctx.env[v] && !ctx.secrets.has(v));
  if (!missing.length) return ''; const w = ctx.host.platform === 'windows';
  return ` Set before use: ${missing.map((v) => (w ? `setx ${v} "<value>"` : `export ${v}=<value>`)).join('; ')}`;
}

/** Runs an `McpSpec.postInstall` command list with inherited stdio (these are browser OAuth logins: the user has to
 * see and answer them). Returns an error message for the first command that fails, or null when all of them ran. */
export async function runMcpPostInstall(spec: McpSpec, ctx: Ctx): Promise<string | null> {
  for (const argv of spec.postInstall ?? []) {
    const r = await ctx.run(argv, { interactive: true, allowFailure: true, timeoutMs: 600000 });
    if (r.code !== 0) return `post-install command failed (exit ${r.code}): ${argv.join(' ')}`;
  }
  return null;
}
