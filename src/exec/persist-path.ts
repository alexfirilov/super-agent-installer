import { stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Ctx } from '../types.js';
import { setMarkerBlock } from '../config/markers.js';
import { writeTextAtomic } from '../config/json.js';
import { toolDirs } from './path.js';

const RC_FILES = ['.profile', '.bashrc', '.zshrc'] as const;

async function readIfExists(path: string): Promise<string> {
  try { return await readFile(path, 'utf8'); } catch { return ''; }
}
const exists = (p: string) => stat(p).then(() => true, () => false);

/**
 * Persists the directories our tools install into so the user's NEXT shell can find them.
 *
 * `toolDirs` only extends PATH inside this process. `go install` drops gopls in `~/go/bin` and the nodejs.org
 * fallback puts node in `~/.local/bin`; neither is on a stock Debian/Rocky login PATH, so before this the run ended
 * with gopls installed and the LSP plugin unable to see it -- leftover work for the user, which §3 forbids. Only
 * directories that actually exist are written, so this never adds a dead entry.
 *
 * POSIX only: on Windows scoop and winget register their own directories in the registry PATH, which `refreshEnvironment`
 * already re-reads, and appending to the user PATH value there risks the 1024-character truncation documented in D2.
 */
export async function persistToolPath(ctx: Ctx): Promise<string[]> {
  if (ctx.dryRun || ctx.host.platform === 'windows') return [];
  // Only directories inside the user's home: a system path like /usr/local/bin is already on every login PATH, so
  // writing it back would be pure churn. Everything we install outside a package manager lands under $HOME.
  const home = ctx.host.home.replace(/\/+$/, '');
  const dirs: string[] = [];
  for (const d of toolDirs(ctx.host, ctx.env)) if (d.startsWith(`${home}/`) && (await exists(d))) dirs.push(d);
  if (!dirs.length) return [];
  const block = `export PATH="${dirs.join(':')}:$PATH"`;
  const written: string[] = [];
  for (const rc of RC_FILES) {
    const path = join(ctx.host.home, rc);
    if (rc !== '.profile' && !(await exists(path))) continue; // never conjure a shell rc the user does not use
    try {
      await writeTextAtomic(path, setMarkerBlock(await readIfExists(path), block, 'hashPath'));
      written.push(path);
    } catch (e) {
      ctx.log.warn(`could not add the tool directories to ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return written;
}
