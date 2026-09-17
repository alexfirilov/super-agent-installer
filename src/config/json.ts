import { readFile, writeFile, rename, mkdir, copyFile, stat, chmod, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

export async function readJsonFile<T = Record<string, unknown>>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return null; }
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
