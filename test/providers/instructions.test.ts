import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { instructionsProvider } from '../../src/providers/instructions.js';
import { MARKER_STYLES } from '../../src/config/markers.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const comp: Component = { id: 'instr-global', name: 'global instructions', kind: 'instructions', agents: 'both', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'recommended', defaultSelected: true, spec: { kind: 'instructions', source: 'instructions.md' } };
const base = { 'claude --version': '2.1.274 (Claude Code)', 'claude plugin list --json': '[]', 'codex --version': 'codex-cli 0.154.0', 'codex plugin list --json': '{"installed":[]}', 'codex mcp list --json': '[]' };
describe('instructionsProvider', () => {
  it('writes the block into both files, keeps user text, idempotent, removable', async () => {
    const ctx = makeTestCtx({ responses: base }); mkdirSync(ctx.paths.claudeConfigDir, { recursive: true }); writeFileSync(ctx.paths.claudeMd, '# my rules\n');
    expect(await instructionsProvider.detect(comp, ctx)).toBeNull();
    await (await instructionsProvider.plan(comp, ctx, null, 'install'))[0]!.run(ctx);
    const md = readFileSync(ctx.paths.claudeMd, 'utf8'); expect(md.startsWith('# my rules\n')).toBe(true); expect(md).toContain(MARKER_STYLES.html.start); expect(md).toContain('Global working agreement');
    expect(readFileSync(ctx.paths.codexAgentsMd, 'utf8')).toContain(MARKER_STYLES.html.end);
    expect(await instructionsProvider.detect(comp, ctx)).toEqual({ version: null }); expect(await instructionsProvider.plan(comp, ctx, { version: null }, 'update')).toEqual([]);
    await (await instructionsProvider.plan(comp, ctx, { version: null }, 'uninstall'))[0]!.run(ctx); expect(readFileSync(ctx.paths.claudeMd, 'utf8')).toBe('# my rules\n');
  });
  it('only touches files of installed agents', async () => {
    const ctx = makeTestCtx({ responses: { 'claude --version': '2.1.274 (Claude Code)', 'claude plugin list --json': '[]' } }); mkdirSync(ctx.paths.claudeConfigDir, { recursive: true });
    await (await instructionsProvider.plan(comp, ctx, null, 'install'))[0]!.run(ctx);
    expect(readFileSync(ctx.paths.claudeMd, 'utf8')).toContain(MARKER_STYLES.html.start); expect(() => readFileSync(ctx.paths.codexAgentsMd)).toThrow();
  });
});
