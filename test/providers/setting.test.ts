import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { settingProvider } from '../../src/providers/setting.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const setting = (id: string, spec: Partial<Extract<Component['spec'], { kind: 'setting' }>>): Component => ({ id, name: id, kind: 'setting', agents: spec.target === 'codex' ? 'codex' : 'claude', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'optional', defaultSelected: false, spec: { kind: 'setting', target: 'claude', ...spec } });
const base = { 'claude --version': '2.1.274 (Claude Code)', 'claude plugin list --json': '[]', 'codex --version': 'codex-cli 0.154.0', 'codex plugin list --json': '{"installed":[]}', 'codex mcp list --json': '[]' };
describe('settingProvider', () => {
  it('applies a Claude settings patch idempotently and removes it on uninstall', async () => {
    const ctx = makeTestCtx({ responses: base }); mkdirSync(ctx.paths.claudeConfigDir, { recursive: true }); writeFileSync(ctx.paths.claudeSettings, JSON.stringify({ model: 'opus' }));
    const c = setting('set-channel', { claudeSettings: { autoUpdatesChannel: 'latest' } });
    expect(await settingProvider.detect(c, ctx)).toBeNull();
    await (await settingProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(JSON.parse(readFileSync(ctx.paths.claudeSettings, 'utf8'))).toEqual({ model: 'opus', autoUpdatesChannel: 'latest' });
    expect(await settingProvider.detect(c, ctx)).toEqual({ version: null }); expect(await settingProvider.plan(c, ctx, { version: null }, 'update')).toEqual([]);
    await (await settingProvider.plan(c, ctx, { version: null }, 'uninstall'))[0]!.run(ctx); expect(JSON.parse(readFileSync(ctx.paths.claudeSettings, 'utf8'))).toEqual({ model: 'opus' });
  });
  it('enables codex features and writes a TOML marker block', async () => {
    const ctx = makeTestCtx({ responses: { ...base, 'codex features enable memories': '' } }); mkdirSync(ctx.paths.codexHome, { recursive: true }); writeFileSync(ctx.paths.codexConfig, 'model = "x"\n');
    const f = setting('set-mem', { target: 'codex', codexFeatures: { memories: true } });
    await (await settingProvider.plan(f, ctx, null, 'install'))[0]!.run(ctx); expect(ctx.calls).toContainEqual(['codex', 'features', 'enable', 'memories']);
    const t = setting('set-trust', { target: 'codex', codexToml: { projects: { [ctx.host.home]: { trust_level: 'trusted' } } } });
    await (await settingProvider.plan(t, ctx, null, 'install'))[0]!.run(ctx);
    const text = readFileSync(ctx.paths.codexConfig, 'utf8'); expect(text).toContain('# >>> super-agent-installer >>>'); expect(text).toContain('trust_level = "trusted"');
    expect(await settingProvider.detect(t, ctx)).toEqual({ version: null });
    await (await settingProvider.plan(t, ctx, { version: null }, 'uninstall'))[0]!.run(ctx); expect(readFileSync(ctx.paths.codexConfig, 'utf8')).toBe('model = "x"\n');
  });
  it('sets windows git config only on windows', async () => {
    const win = makeTestCtx({ host: { platform: 'windows' }, responses: { ...base, 'git config --global --get core.symlinks': { code: 1 }, 'git config --global core.symlinks true': '' } });
    const c = setting('set-symlinks', { target: 'claude', windowsGitConfig: { 'core.symlinks': 'true' } });
    await (await settingProvider.plan(c, win, null, 'install'))[0]!.run(win); expect(win.calls).toContainEqual(['git', 'config', '--global', 'core.symlinks', 'true']);
    const lin = makeTestCtx({ responses: base }); expect(await settingProvider.plan(c, lin, null, 'install')).toEqual([]);
  });
  it('expands ${HOME} in codexToml keys and string values', async () => {
    const ctx = makeTestCtx({ responses: base }); mkdirSync(ctx.paths.codexHome, { recursive: true }); writeFileSync(ctx.paths.codexConfig, 'model = "x"\n');
    const t = setting('set-trust-home', { target: 'codex', codexToml: { projects: { '${HOME}': { trust_level: 'trusted' } } } });
    await (await settingProvider.plan(t, ctx, null, 'install'))[0]!.run(ctx);
    const text = readFileSync(ctx.paths.codexConfig, 'utf8');
    expect(text).toContain(`[projects."${ctx.host.home}"]`);
    expect(await settingProvider.detect(t, ctx)).toEqual({ version: null });
  });
  it('seeds ~/.claude.json only when absent', async () => {
    const ctx = makeTestCtx({ responses: base }); mkdirSync(ctx.paths.claudeConfigDir, { recursive: true });
    const c = setting('set-seed', { claudeJsonSeed: { hasCompletedOnboarding: true } });
    expect(await settingProvider.detect(c, ctx)).toBeNull();
    await (await settingProvider.plan(c, ctx, null, 'install'))[0]!.run(ctx);
    expect(JSON.parse(readFileSync(ctx.paths.claudeJson, 'utf8'))).toEqual({ hasCompletedOnboarding: true });
    expect(await settingProvider.detect(c, ctx)).toEqual({ version: null });
    // even when the file has other content, presence alone satisfies detect and install is a no-op
    writeFileSync(ctx.paths.claudeJson, JSON.stringify({ somethingElse: 1 }));
    expect(await settingProvider.detect(c, ctx)).toEqual({ version: null });
    expect(await settingProvider.plan(c, ctx, { version: null }, 'install')).toEqual([]);
    // uninstall never touches ~/.claude.json
    await (await settingProvider.plan(c, ctx, { version: null }, 'uninstall'))[0]!.run(ctx);
    expect(JSON.parse(readFileSync(ctx.paths.claudeJson, 'utf8'))).toEqual({ somethingElse: 1 });
  });
});
