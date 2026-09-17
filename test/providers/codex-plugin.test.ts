import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { codexPluginProvider, getCodexState } from '../../src/providers/codex-plugin.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const plugin = (id: string, marketplace: string, marketplaceSource: string): Component => ({ id: `cx-${id}`, name: id, kind: 'codex-plugin', agents: 'codex', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: false, spec: { kind: 'codex-plugin', marketplace, marketplaceSource, plugin: id } });
function ctxWith(toml: string, installed: Array<{ pluginId: string; version: string }>, extra: Record<string, string | { code: number; stdout?: string; stderr?: string }> = {}) {
  const ctx = makeTestCtx({ responses: { 'codex --version': 'codex-cli 0.154.0', 'codex plugin list --json': JSON.stringify({ installed, available: [] }), 'codex mcp list --json': '[]', ...extra } });
  mkdirSync(ctx.paths.codexHome, { recursive: true });
  writeFileSync(ctx.paths.codexConfig, toml); return ctx;
}
describe('codexPluginProvider', () => {
  it('adds the git marketplace then the plugin', async () => {
    const ctx = ctxWith('', [], { 'codex plugin marketplace add JuliusBrussee/caveman --json': '{"marketplaceName":"caveman","alreadyAdded":false}', 'codex plugin add caveman@caveman --json': '{"pluginId":"caveman@caveman","version":"2.7.0"}' });
    const c = plugin('caveman', 'caveman', 'JuliusBrussee/caveman');
    const r = await (await codexPluginProvider.plan(c, ctx, await codexPluginProvider.detect(c, ctx), 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(true); expect(ctx.calls).toContainEqual(['codex', 'plugin', 'marketplace', 'add', 'JuliusBrussee/caveman', '--json']); expect(ctx.calls).toContainEqual(['codex', 'plugin', 'add', 'caveman@caveman', '--json']);
  });
  it('updates by upgrading the marketplace and re-adding, unchanged when version equal', async () => {
    const ctx = ctxWith('[marketplaces.caveman]\nsource_type = "git"\n', [{ pluginId: 'caveman@caveman', version: '2.7.0' }], { 'codex plugin marketplace upgrade caveman --json': '{"upgradedRoots":[]}', 'codex plugin add caveman@caveman --json': '{"pluginId":"caveman@caveman","version":"2.7.0"}' });
    const c = plugin('caveman', 'caveman', 'JuliusBrussee/caveman'); const inst = await codexPluginProvider.detect(c, ctx); expect(inst).toMatchObject({ version: '2.7.0' });
    const r = await (await codexPluginProvider.plan(c, ctx, inst, 'update'))[0]!.run(ctx); expect(r).toMatchObject({ ok: true, changed: false });
    expect(ctx.calls.filter((a) => a[2] === 'marketplace' && a[3] === 'add')).toHaveLength(0);
  });
  it('never adds reserved marketplaces and surfaces the ChatGPT auth error', async () => {
    const ctx = ctxWith('', [], { 'codex plugin add superpowers@openai-curated-remote --json': { code: 1, stderr: 'Error: chatgpt authentication required for remote plugin catalog' } });
    const c = plugin('superpowers', 'openai-curated-remote', 'reserved');
    const r = await (await codexPluginProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(r.ok).toBe(false); expect(r.message).toMatch(/chatgpt authentication required/); expect(ctx.calls.some((a) => a[3] === 'add' && a[2] === 'marketplace')).toBe(false);
  });
  it('removes on uninstall and skips without codex', async () => {
    const ctx = ctxWith('', [{ pluginId: 'caveman@caveman', version: '2.7.0' }], { 'codex plugin remove caveman@caveman --json': '{}' });
    const c = plugin('caveman', 'caveman', 'JuliusBrussee/caveman');
    await (await codexPluginProvider.plan(c, ctx, await codexPluginProvider.detect(c, ctx), 'uninstall'))[0]!.run(ctx); expect(ctx.calls).toContainEqual(['codex', 'plugin', 'remove', 'caveman@caveman', '--json']);
    const none = makeTestCtx({ responses: {} }); expect((await codexPluginProvider.plan(c, none, null, 'install'))[0]).toMatchObject({ op: 'skip' });
  });
  it('updates cached state in place after install and uninstall so a later detect in the same run sees it', async () => {
    const ctx = ctxWith('', [], { 'codex plugin marketplace add JuliusBrussee/caveman --json': '{"marketplaceName":"caveman","alreadyAdded":false}', 'codex plugin add caveman@caveman --json': '{"pluginId":"caveman@caveman","version":"2.7.0"}' });
    const c = plugin('caveman', 'caveman', 'JuliusBrussee/caveman');
    await (await codexPluginProvider.plan(c, ctx, await codexPluginProvider.detect(c, ctx), 'install'))[0]!.run(ctx);
    const afterInstall = await codexPluginProvider.detect(c, ctx);
    expect(afterInstall).toMatchObject({ version: '2.7.0' });
    const st = await getCodexState(ctx);
    expect(st.plugins.some((p) => p.id === 'caveman@caveman')).toBe(true);
    ctx.calls.length = 0;
    const r = await (await codexPluginProvider.plan(c, ctx, afterInstall, 'uninstall'))[0]!.run(ctx);
    expect(r.ok).toBe(true);
    const afterUninstall = await codexPluginProvider.detect(c, ctx);
    expect(afterUninstall).toBeNull();
  });
});
