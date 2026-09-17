import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { statuslineProvider } from '../../src/providers/statusline.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component } from '../../src/types.js';
const sl = (provider: 'caveman' | 'claude-hud'): Component => ({ id: `sl-${provider}`, name: provider, kind: 'statusline', agents: 'claude', platforms: ['linux', 'windows', 'darwin'], description: '', verdict: 'recommended', defaultSelected: provider === 'caveman', slot: 'statusline', spec: { kind: 'statusline', provider } });
describe('statuslineProvider', () => {
  it('installs the caveman statusline script and settings entry, idempotently', async () => {
    const ctx = makeTestCtx(); mkdirSync(ctx.paths.claudeConfigDir, { recursive: true }); writeFileSync(ctx.paths.claudeSettings, '{}');
    await (await statuslineProvider.plan(sl('caveman'), ctx, null, 'install'))[0]!.run(ctx);
    const script = join(ctx.paths.claudeHooksDir, 'caveman-statusline.sh'); expect(existsSync(script)).toBe(true);
    const s = JSON.parse(readFileSync(ctx.paths.claudeSettings, 'utf8')); expect(s.statusLine.command).toBe(`bash "${script}"`);
    expect(await statuslineProvider.detect(sl('caveman'), ctx)).toEqual({ version: null }); expect(await statuslineProvider.plan(sl('caveman'), ctx, { version: null }, 'install')).toEqual([]);
    await (await statuslineProvider.plan(sl('caveman'), ctx, { version: null }, 'uninstall'))[0]!.run(ctx); expect(JSON.parse(readFileSync(ctx.paths.claudeSettings, 'utf8'))).toEqual({});
  });
  it('replaces a fragile glob statusLine and uses powershell on windows', async () => {
    const win = makeTestCtx({ host: { platform: 'windows' } }); mkdirSync(win.paths.claudeConfigDir, { recursive: true });
    writeFileSync(win.paths.claudeSettings, JSON.stringify({ statusLine: { type: 'command', command: 'bash "$(ls -td ...)src/hooks/caveman-statusline.sh"' } }));
    expect(await statuslineProvider.detect(sl('caveman'), win)).toBeNull();
    await (await statuslineProvider.plan(sl('caveman'), win, null, 'install'))[0]!.run(win);
    expect(JSON.parse(readFileSync(win.paths.claudeSettings, 'utf8')).statusLine.command).toMatch(/powershell -NoProfile -ExecutionPolicy Bypass -File ".*caveman-statusline\.ps1"/);
  });
  it('claude-hud clears a caveman statusLine and prints the setup hint', async () => {
    const ctx = makeTestCtx(); mkdirSync(ctx.paths.claudeConfigDir, { recursive: true });
    writeFileSync(ctx.paths.claudeSettings, JSON.stringify({ statusLine: { type: 'command', command: 'bash "/x/caveman-statusline.sh"' } }));
    const r = await (await statuslineProvider.plan(sl('claude-hud'), ctx, null, 'install'))[0]!.run(ctx);
    expect(r.message).toMatch(/\/claude-hud:setup/); expect(JSON.parse(readFileSync(ctx.paths.claudeSettings, 'utf8'))).toEqual({});
  });
});
