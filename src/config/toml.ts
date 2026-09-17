import { readFile } from 'node:fs/promises';
import { parse, stringify } from 'smol-toml';
import { setMarkerBlock, removeMarkerBlock } from './markers.js';
import { backupFile, writeTextAtomic } from './json.js';

export class TomlError extends Error {}

export async function readToml(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch { return {}; }
  try { return parse(text) as Record<string, unknown>; } catch (e) { throw new TomlError(`cannot parse ${path}: ${(e as Error).message}`); }
}

export function tomlTableEquals(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, val]) => [k, norm(val)]))
        : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

export async function writeTomlMarkerBlock(path: string, keys: Record<string, unknown>, backupsDir: string): Promise<{ changed: boolean }> {
  let text = '';
  try { text = await readFile(path, 'utf8'); } catch { text = ''; }
  const next = setMarkerBlock(text, stringify(keys).trim(), 'hash');
  if (next === text.replace(/\r\n/g, '\n')) return { changed: false };
  try { parse(next); } catch (e) { throw new TomlError(`refusing to write ${path}: merged file does not parse (${(e as Error).message}). A key inside the managed block probably duplicates one outside it.`); }
  await backupFile(path, backupsDir);
  await writeTextAtomic(path, next, { mode: 0o600 });
  return { changed: true };
}

export async function removeTomlMarkerBlock(path: string, backupsDir: string): Promise<{ changed: boolean }> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch { return { changed: false }; }
  const next = removeMarkerBlock(text, 'hash');
  if (next === text.replace(/\r\n/g, '\n')) return { changed: false };
  try { parse(next); } catch (e) { throw new TomlError(`refusing to write ${path}: merged file does not parse (${(e as Error).message})`); }
  await backupFile(path, backupsDir);
  await writeTextAtomic(path, next, { mode: 0o600 });
  return { changed: true };
}
