import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Ctx } from '../types.js';
import { setMarkerBlock } from '../config/markers.js';
import { writeTextAtomic } from '../config/json.js';

const MAX_VALUE_LEN = 1024; // setx/registry write limit (see research-v02.md B3): reject rather than silently truncate

export type PersistResult = { persisted: string[]; failed: Array<{ name: string; reason: string }> };

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}
async function readIfExists(path: string): Promise<string> {
  try { return await readFile(path, 'utf8'); } catch { return ''; }
}
/** Single-quoted POSIX shell literal: close the quote, emit an escaped literal quote, reopen it. */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function persistWindows(ctx: Ctx, vars: Map<string, string>): Promise<PersistResult> {
  const persisted: string[] = []; const failed: Array<{ name: string; reason: string }> = [];
  for (const [name, value] of vars) {
    if (value.length > MAX_VALUE_LEN) { failed.push({ name, reason: `value is ${value.length} characters, over the ${MAX_VALUE_LEN}-character setx/registry limit` }); continue; }
    const safeName = name.replace(/'/g, "''"); // PowerShell single-quoted string escape; env var names shouldn't contain quotes, but never trust it
    try {
      const r = await ctx.run(['powershell.exe', '-NoProfile', '-Command', `[Environment]::SetEnvironmentVariable('${safeName}', $env:SAI_SECRET_VALUE, 'User')`], { env: { SAI_SECRET_VALUE: value }, allowFailure: true });
      if (r.code === 0) { persisted.push(name); ctx.log.info(`persisted ${name} to the user environment`); }
      else failed.push({ name, reason: `powershell exited ${r.code}` });
    } catch (e) {
      failed.push({ name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { persisted, failed };
}

async function persistPosix(ctx: Ctx, vars: Map<string, string>): Promise<PersistResult> {
  const names = [...vars.keys()];
  const block = names.map((name) => `export ${name}=${shellSingleQuote(vars.get(name) as string)}`).join('\n');
  const profilePath = join(ctx.host.home, '.profile');
  try {
    await writeTextAtomic(profilePath, setMarkerBlock(await readIfExists(profilePath), block, 'hash'), { mode: 0o600 });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { persisted: [], failed: names.map((name) => ({ name, reason })) };
  }
  const zshrcPath = join(ctx.host.home, '.zshrc');
  if (await fileExists(zshrcPath)) {
    try {
      await writeTextAtomic(zshrcPath, setMarkerBlock(await readIfExists(zshrcPath), block, 'hash'), { mode: 0o600 });
    } catch (e) {
      ctx.log.warn(`could not update ~/.zshrc: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const name of names) ctx.log.info(`persisted ${name} to the user environment`);
  return { persisted: names, failed: [] };
}

/** Writes every entry of `vars` to the OS user environment: `[Environment]::SetEnvironmentVariable(name, value, 'User')`
 * via a per-variable PowerShell child on Windows (the value travels through the child's environment, never argv, so
 * it never appears in a command line, a log line or a process listing), or one marked block of `export NAME='value'`
 * in `~/.profile` (and `~/.zshrc` when it already exists) on POSIX. Never runs under `--dry-run`; logs variable
 * names only, never values. */
export async function persistSecrets(ctx: Ctx, vars: Map<string, string>): Promise<PersistResult> {
  if (ctx.dryRun || !vars.size) return { persisted: [], failed: [] };
  return ctx.host.platform === 'windows' ? persistWindows(ctx, vars) : persistPosix(ctx, vars);
}
