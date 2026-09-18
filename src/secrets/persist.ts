import { readFile, access, chmod, stat } from 'node:fs/promises';
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

/**
 * POSIX secrets live in a dedicated file we own (`<stateDir>/secrets.env`, `stateDir` already resolves to
 * `${XDG_CONFIG_HOME:-$HOME/.config}/super-agent-installer`), never in `~/.profile`/`~/.zshrc`. Those rc files are
 * shared with the user's own content and commonly mode 644 (world-readable); `writeTextAtomic` only applies a
 * requested mode to a brand-new file and otherwise preserves whatever mode the file already had, so writing a
 * secret into an existing 644 rc file would leave it world-readable. Instead we chmod the secrets file to 0600
 * explicitly after every write (never trusting "it was already 0600") and verify it stuck before reporting
 * success; the rc files only ever receive a guarded `. "<path>"` source line, so no secret value reaches them and
 * their own mode is left exactly as it was. The source line goes in its own `hashSecrets` marker block, never the
 * plain `hash` one: `install.sh` owns that one in the same files for its PATH export.
 */
async function writeSecretsFile(ctx: Ctx, block: string): Promise<string> {
  const secretsPath = join(ctx.paths.stateDir, 'secrets.env');
  await writeTextAtomic(secretsPath, setMarkerBlock(await readIfExists(secretsPath), block, 'hash'), { mode: 0o600 });
  await chmod(secretsPath, 0o600);
  const mode = (await stat(secretsPath)).mode & 0o777;
  if (mode !== 0o600) throw new Error(`could not enforce 0600 permissions on ${secretsPath} (mode is ${mode.toString(8)})`);
  return secretsPath;
}

async function persistPosix(ctx: Ctx, vars: Map<string, string>): Promise<PersistResult> {
  const names = [...vars.keys()];
  const block = names.map((name) => `export ${name}=${shellSingleQuote(vars.get(name) as string)}`).join('\n');
  let secretsPath: string;
  try {
    secretsPath = await writeSecretsFile(ctx, block);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { persisted: [], failed: names.map((name) => ({ name, reason })) };
  }
  const sourceLine = `[ -f "${secretsPath}" ] && . "${secretsPath}"`;
  const write = async (path: string) => writeTextAtomic(path, setMarkerBlock(await readIfExists(path), sourceLine, 'hashSecrets'));
  // ~/.profile alone is not enough: a Linux desktop terminal starts a non-login interactive bash, which reads
  // ~/.bashrc and never ~/.profile, and zsh never reads ~/.profile at all -- on a fresh macOS account ~/.zshrc does
  // not even exist yet, so create it there. install.sh:93 loops the same three files.
  const profilePath = join(ctx.host.home, '.profile');
  try {
    await write(profilePath);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { persisted: [], failed: names.map((name) => ({ name, reason })) };
  }
  const zsh = /(^|\/)zsh$/.test(ctx.env.SHELL ?? '');
  for (const rc of ['.bashrc', '.zshrc']) {
    const path = join(ctx.host.home, rc);
    if (!(await fileExists(path)) && !(rc === '.zshrc' && zsh)) continue;
    try {
      await write(path);
    } catch (e) {
      ctx.log.warn(`could not update ~/${rc}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const name of names) ctx.log.info(`persisted ${name} to the user environment`);
  return { persisted: names, failed: [] };
}

/** Writes every entry of `vars` to the OS user environment: `[Environment]::SetEnvironmentVariable(name, value, 'User')`
 * via a per-variable PowerShell child on Windows (the value travels through the child's environment, never argv, so
 * it never appears in a command line, a log line or a process listing), or a 0600 `<stateDir>/secrets.env` file plus
 * a guarded source line in `~/.profile`, `~/.bashrc` and `~/.zshrc` on POSIX (the latter two when they exist, plus
 * `~/.zshrc` created when the login shell is zsh) -- the value itself never enters any rc file. Never runs under `--dry-run`; logs variable names only, never values. */
export async function persistSecrets(ctx: Ctx, vars: Map<string, string>): Promise<PersistResult> {
  if (ctx.dryRun || !vars.size) return { persisted: [], failed: [] };
  return ctx.host.platform === 'windows' ? persistWindows(ctx, vars) : persistPosix(ctx, vars);
}
