import { readFile } from 'node:fs/promises';
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { ASSETS } from '../assets.js';
import { setMarkerBlock, removeMarkerBlock } from '../config/markers.js';
import { writeTextAtomic } from '../config/json.js';
import { getClaudeState } from './claude-plugin.js';
import { getCodexState } from './codex-plugin.js';
import { action, ok, fail } from './types.js';
const CODEX_CAP = 32 * 1024;
function resolveAsset(source: string): string | null { return Object.prototype.hasOwnProperty.call(ASSETS, source) ? ASSETS[source as keyof typeof ASSETS] : null; }
async function targets(ctx: Ctx): Promise<Array<{ agent: 'claude' | 'codex'; path: string }>> { const out: Array<{ agent: 'claude' | 'codex'; path: string }> = []; if ((await getClaudeState(ctx)).installed) out.push({ agent: 'claude', path: ctx.paths.claudeMd }); if ((await getCodexState(ctx)).installed) out.push({ agent: 'codex', path: ctx.paths.codexAgentsMd }); return out; }
async function readOr(path: string): Promise<string> { try { return await readFile(path, 'utf8'); } catch { return ''; } }
export const instructionsProvider: Provider = {
  kind: 'instructions',
  async detect(c, ctx) {
    if (c.spec.kind !== 'instructions') return null; const content = resolveAsset(c.spec.source); if (content === null) return null;
    const t = await targets(ctx); if (!t.length) return null;
    for (const { path } of t) { const cur = await readOr(path); if (cur === '' || setMarkerBlock(cur, content, 'html') !== cur.replace(/\r\n/g, '\n')) return null; }
    return { version: null };
  },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'instructions') return [];
    const source = c.spec.source;
    const content = resolveAsset(source);
    if (content === null) return [action(c.id, 'configure', `unknown instructions source '${source}'`, async () => fail(`unknown instructions source '${source}' (bundled: instructions.md)`))];
    const t = await targets(ctx); if (!t.length) return [];
    if (mode === 'uninstall') return installed ? [action(c.id, 'uninstall', 'remove managed instructions block', async () => { for (const { path } of t) { const cur = await readOr(path); const next = removeMarkerBlock(cur, 'html'); if (next !== cur && !ctx.dryRun) await writeTextAtomic(path, next, { backupsDir: ctx.paths.backupsDir }); } return ok('managed instructions removed'); })] : [];
    if (installed) return [];
    return [action(c.id, 'configure', 'write managed instructions block into CLAUDE.md and AGENTS.md', async () => {
      const notes: string[] = [];
      for (const { agent, path } of t) { const cur = await readOr(path); const next = setMarkerBlock(cur, content, 'html'); if (agent === 'codex' && Buffer.byteLength(next, 'utf8') > CODEX_CAP) { notes.push(`skipped ${path}: would exceed the 32 KiB Codex AGENTS.md cap`); continue; } if (next !== cur.replace(/\r\n/g, '\n') && !ctx.dryRun) await writeTextAtomic(path, next, { backupsDir: ctx.paths.backupsDir }); }
      return ok(`instructions block written${notes.length ? ` (${notes.join('; ')})` : ''}`);
    })];
  },
};
