import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudePluginProvider, getClaudeState } from '../../src/providers/claude-plugin.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const plugin = (id: string, over: Partial<Extract<Component['spec'], { kind: 'claude-plugin' }>> = {}): Component => ({ id, name: id, kind: 'claude-plugin', agents: 'claude', platforms: ['linux'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'claude-plugin', marketplace: 'claude-plugins-official', plugin: id, ...over } });
const listed = (rows: unknown[]) => JSON.stringify(rows);
function ctxWith(known: string[], list: unknown[], extra: Record<string, string | { code: number; stdout?: string; stderr?: string }> = {}) {
  const ctx = makeTestCtx({ responses: { 'claude --version': '2.1.274 (Claude Code)', 'claude plugin list --json': listed(list), ...extra } });
  mkdirSync(join(ctx.paths.claudeConfigDir, 'plugins'), { recursive: true });
  writeFileSync(join(ctx.paths.claudeConfigDir, 'plugins', 'known_marketplaces.json'), JSON.stringify(Object.fromEntries(known.map((k) => [k, {}]))));
  return ctx;
}
describe('claudePluginProvider', () => {
  it('installs after adding a missing third-party marketplace', async () => {
    const ctx = ctxWith(['claude-plugins-official'], [], { 'claude plugin marketplace add JuliusBrussee/caveman': '', 'claude plugin install caveman@caveman --scope user --json': '{"outcome":"ok"}' });
    const c = plugin('caveman', { marketplace: 'caveman', marketplaceSource: 'JuliusBrussee/caveman' });
    const acts = await claudePluginProvider.plan(c, ctx, await claudePluginProvider.detect(c, ctx), 'install');
    expect(acts[0]).toMatchObject({ op: 'install' }); expect((await acts[0]!.run(ctx)).ok).toBe(true);
    expect(ctx.calls).toContainEqual(['claude', 'plugin', 'marketplace', 'add', 'JuliusBrussee/caveman']);
    expect(ctx.calls).toContainEqual(['claude', 'plugin', 'install', 'caveman@caveman', '--scope', 'user', '--json']);
  });
  it('updates installed plugins and reports up_to_date as unchanged', async () => {
    const ctx = ctxWith(['claude-plugins-official'], [{ id: 'superpowers@claude-plugins-official', version: '6.3.0', scope: 'user', enabled: true }], { 'claude plugin marketplace update claude-plugins-official': '', 'claude plugin update superpowers@claude-plugins-official --json': 'Checking...\n{"updateOutcome":"up_to_date","oldVersion":"6.3.0","newVersion":"6.3.0"}' });
    const c = plugin('superpowers'); const inst = await claudePluginProvider.detect(c, ctx); expect(inst).toMatchObject({ version: '6.3.0' });
    const r = await (await claudePluginProvider.plan(c, ctx, inst, 'update'))[0]!.run(ctx);
    expect(r).toMatchObject({ ok: true, changed: false });
  });
  it('disables and uninstalls at every scope', async () => {
    const ctx = ctxWith(['claude-plugins-official'], [{ id: 'plugin-dev@claude-plugins-official', version: '1', scope: 'user', enabled: true }, { id: 'code-review@claude-plugins-official', version: '1', scope: 'user', enabled: true }, { id: 'code-review@claude-plugins-official', version: '1', scope: 'project', enabled: true }], { 'claude plugin disable plugin-dev@claude-plugins-official --scope user': '', 'claude plugin uninstall code-review@claude-plugins-official --scope user': '', 'claude plugin uninstall code-review@claude-plugins-official --scope project': '' });
    const d = plugin('plugin-dev', { action: 'disable' }); await (await claudePluginProvider.plan(d, ctx, await claudePluginProvider.detect(d, ctx), 'install'))[0]!.run(ctx);
    expect(ctx.calls).toContainEqual(['claude', 'plugin', 'disable', 'plugin-dev@claude-plugins-official', '--scope', 'user']);
    const u = plugin('code-review', { action: 'uninstall' }); await (await claudePluginProvider.plan(u, ctx, await claudePluginProvider.detect(u, ctx), 'install'))[0]!.run(ctx);
    expect(ctx.calls.filter((a) => a[2] === 'uninstall')).toHaveLength(2);
  });
  it('skips when Claude is not installed', async () => {
    const ctx = makeTestCtx({ responses: {} });
    const acts = await claudePluginProvider.plan(plugin('superpowers'), ctx, null, 'install'); expect(acts[0]).toMatchObject({ op: 'skip' });
  });
  it('updates cached state in place after install so a later detect in the same run sees it', async () => {
    const ctx = ctxWith(['claude-plugins-official'], [], { 'claude plugin install caveman@caveman --scope user --json': '{"outcome":"ok","version":"1.0.0"}' });
    const c = plugin('caveman', { marketplace: 'caveman', marketplaceSource: 'JuliusBrussee/caveman' });
    await (await claudePluginProvider.plan(c, ctx, await claudePluginProvider.detect(c, ctx), 'install'))[0]!.run(ctx);
    const again = await claudePluginProvider.detect(c, ctx);
    expect(again).toMatchObject({ version: '1.0.0', details: { scopes: ['user'], enabled: true } });
    const st = await getClaudeState(ctx);
    expect(st.plugins.some((p) => p.id === 'caveman@caveman')).toBe(true);
  });
  it('updates cached state in place after uninstall and disable', async () => {
    const ctx = ctxWith(['claude-plugins-official'], [{ id: 'plugin-dev@claude-plugins-official', version: '1', scope: 'user', enabled: true }], { 'claude plugin disable plugin-dev@claude-plugins-official --scope user': '' });
    const d = plugin('plugin-dev', { action: 'disable' });
    await (await claudePluginProvider.plan(d, ctx, await claudePluginProvider.detect(d, ctx), 'install'))[0]!.run(ctx);
    const afterDisable = await claudePluginProvider.detect(d, ctx);
    expect(afterDisable).toMatchObject({ details: { enabled: false } });
    const u = plugin('plugin-dev', { action: 'uninstall' });
    await (await claudePluginProvider.plan(u, ctx, await claudePluginProvider.detect(u, ctx), 'install'))[0]!.run(ctx);
    const afterUninstall = await claudePluginProvider.detect(u, ctx);
    expect(afterUninstall).toBeNull();
  });
  it('re-enables an installed but disabled plugin on install mode without updating', async () => {
    const ctx = ctxWith(['claude-plugins-official'], [{ id: 'superpowers@claude-plugins-official', version: '6.3.0', scope: 'user', enabled: false }], { 'claude plugin enable superpowers@claude-plugins-official': '' });
    const c = plugin('superpowers'); const inst = await claudePluginProvider.detect(c, ctx);
    const acts = await claudePluginProvider.plan(c, ctx, inst, 'install');
    expect(acts).toHaveLength(1); expect(acts[0]).toMatchObject({ op: 'configure' });
    expect(acts.some((a) => a.op === 'update')).toBe(false);
    await acts[0]!.run(ctx);
    expect(ctx.calls).toContainEqual(['claude', 'plugin', 'enable', 'superpowers@claude-plugins-official']);
  });
  it('auto-sources the official marketplace when only a third-party marketplace is known', async () => {
    const ctx = ctxWith(['caveman'], [], { 'claude plugin marketplace add anthropics/claude-plugins-official': '', 'claude plugin install superpowers@claude-plugins-official --scope user --json': '{"outcome":"ok"}' });
    const c = plugin('superpowers');
    const r = await (await claudePluginProvider.plan(c, ctx, await claudePluginProvider.detect(c, ctx), 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true);
    const addIdx = ctx.calls.findIndex((a) => a.join(' ') === 'claude plugin marketplace add anthropics/claude-plugins-official');
    const installIdx = ctx.calls.findIndex((a) => a.join(' ') === 'claude plugin install superpowers@claude-plugins-official --scope user --json');
    expect(addIdx).toBeGreaterThanOrEqual(0); expect(installIdx).toBeGreaterThan(addIdx);
  });
});
