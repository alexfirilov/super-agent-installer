import { readFile, writeFile, rename, mkdir, copyFile, stat, chmod, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

/** A file that exists but does not parse. Callers must never treat this like a missing file: every config writer
 * in this codebase does `(await readJsonFile(p)) ?? {}` and then writes the merge back, so a parse failure that
 * read as null replaced the user's whole configuration with the installer's two-key patch. */
export class JsonParseError extends Error {
  constructor(public path: string, cause: string) { super(`${path} is not valid JSON (${cause}). It was left untouched: fix the file or restore a backup, then rerun.`); }
}

/** `null` only when the file does not exist. Invalid JSON throws `JsonParseError`; any other read error propagates. */
export async function readJsonFile<T = Record<string, unknown>>(path: string): Promise<T | null> {
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  try { return JSON.parse(text) as T; } catch (e) { throw new JsonParseError(path, (e as Error).message); }
}

export async function backupFile(path: string, backupsDir: string): Promise<string | null> {
  try { await stat(path); } catch { return null; }
  await mkdir(backupsDir, { recursive: true });
  const dest = join(backupsDir, `${basename(path)}.${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await copyFile(path, dest);
  return dest;
}

export async function writeTextAtomic(path: string, text: string, opts: { mode?: number; backupsDir?: string } = {}): Promise<void> {
  let mode = opts.mode ?? 0o644;
  let exists = false;
  try { mode = (await stat(path)).mode & 0o777; exists = true; } catch { /* new file */ }
  if (exists && opts.backupsDir) await backupFile(path, opts.backupsDir);
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    await writeFile(tmp, text, { encoding: 'utf8', mode });
    if (process.platform !== 'win32') await chmod(tmp, mode);
    await rename(tmp, path);
  } catch (e) {
    try { await unlink(tmp); } catch { /* ignore */ }
    throw e;
  }
}

export async function writeJsonAtomic(path: string, value: unknown, opts: { mode?: number } = {}): Promise<void> {
  await writeTextAtomic(path, JSON.stringify(value, null, 2) + '\n', { mode: opts.mode ?? 0o600 });
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export function mergeClaudeSettings(existing: Obj, patch: Obj): Obj {
  const out: Obj = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) { delete out[k]; continue; }
    if (k === 'hooks' && isObj(v)) {
      const hooks: Obj = { ...(isObj(out.hooks) ? out.hooks : {}) };
      for (const [event, handlers] of Object.entries(v)) {
        const cur = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
        const seen = new Set(cur.map((h) => JSON.stringify(h)));
        for (const h of (Array.isArray(handlers) ? handlers : [])) {
          const key = JSON.stringify(h);
          if (!seen.has(key)) { cur.push(h); seen.add(key); }
        }
        hooks[event] = cur;
      }
      out.hooks = hooks;
      continue;
    }
    out[k] = isObj(v) && isObj(out[k]) ? mergeClaudeSettings(out[k] as Obj, v) : v;
  }
  return out;
}
