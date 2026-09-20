import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runUninstall } from '../../src/commands/uninstall.js';
import { registerProvider, clearProviders } from '../../src/providers/registry.js';
import { action } from '../../src/providers/types.js';
import { writeState } from '../../src/state/state.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, HostState, Manifest, Provider } from '../../src/types.js';

const comp = (id: string): Component => ({ id, name: id, kind: 'tool', agents: 'both', platforms: ['linux'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'tool', probe: [id], packages: {} } });
const manifest: Manifest = { version: 1, profiles: {}, components: [comp('a'), comp('b'), comp('c')] };

// behavior: 'ok' -> installed, uninstall succeeds; 'fail' -> installed, uninstall fails; 'absent' -> never installed (detect null, planner auto-skips)
const fakeProvider = (behavior: Record<string, 'ok' | 'fail' | 'absent'>): Provider => ({
  kind: 'tool',
  detect: async (c) => (behavior[c.id] === 'absent' ? null : { version: '1' }),
  plan: async (c, _ctx, installed, mode) => {
    if (mode !== 'uninstall' || installed === null) return [];
    return [action(c.id, 'uninstall', `remove ${c.id}`, async () => (behavior[c.id] === 'fail' ? { ok: false, changed: false, message: 'bad' } : { ok: true, changed: true, message: 'removed' }))];
  },
});

// Entries default to byUs:true -- these fixtures describe components the installer put there, which is what the
// pre-provenance tests always meant. Tests about pre-existing host software pass byUs:false explicitly.
const initialState = (selectedIds: string[], installed: HostState['installed']): HostState => ({
  version: 1, installerVersion: '0.1.0', profile: 'all', selectedIds, channel: 'latest', lastRun: 't',
  installed: Object.fromEntries(Object.entries(installed).map(([k, v]) => [k, { ...v, byUs: v.byUs ?? true }])),
});

describe('runUninstall', () => {
  it('removes an installed component from selectedIds and installed', async () => {
    clearProviders(); registerProvider(fakeProvider({ a: 'ok', b: 'ok', c: 'ok' }));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    await writeState(ctx.paths.stateFile, initialState(['a', 'b', 'c'], { a: { version: '1', at: 't' }, b: { version: '1', at: 't' }, c: { version: '1', at: 't' } }));
    const code = await runUninstall(ctx, ['a'], { installerVersion: '0.1.0' });
    expect(code).toBe(0);
    const state = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8'));
    expect(state.selectedIds).toEqual(['b', 'c']);
    expect(state.installed.a).toBeUndefined();
  });

  it('removes an already-absent component (detect null) from selectedIds too', async () => {
    clearProviders(); registerProvider(fakeProvider({ a: 'ok', b: 'ok', c: 'absent' }));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    await writeState(ctx.paths.stateFile, initialState(['a', 'b', 'c'], { a: { version: '1', at: 't' }, b: { version: '1', at: 't' } }));
    const code = await runUninstall(ctx, ['c'], { installerVersion: '0.1.0' });
    expect(code).toBe(0);
    const state = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8'));
    expect(state.selectedIds).toEqual(['a', 'b']);
    expect(state.installed.c).toBeUndefined();
  });

  it('keeps the id in selectedIds when the uninstall step fails', async () => {
    clearProviders(); registerProvider(fakeProvider({ a: 'ok', b: 'fail', c: 'ok' }));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    await writeState(ctx.paths.stateFile, initialState(['a', 'b', 'c'], { a: { version: '1', at: 't' }, b: { version: '1', at: 't' }, c: { version: '1', at: 't' } }));
    const code = await runUninstall(ctx, undefined, { installerVersion: '0.1.0', all: true });
    expect(code).toBe(1);
    const state = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8'));
    expect(state.selectedIds).toEqual(['b']);
    expect(state.installed.b.version).toBe('1');
    expect(state.installed.a).toBeUndefined();
  });

  it('uninstall <id> removes only the named component, never its prerequisites (uninstall sk-x must not plan removing node)', async () => {
    clearProviders(); registerProvider(fakeProvider({ node: 'ok', 'sk-x': 'ok' }));
    registerProvider({ ...fakeProvider({ node: 'ok', 'sk-x': 'ok' }), kind: 'skill' });
    const chain: Manifest = { version: 1, profiles: {}, components: [comp('node'), { ...comp('sk-x'), kind: 'skill', prerequisites: ['node'], spec: { kind: 'skill', repo: 'a/b', skills: ['x'], targets: ['codex'] } }] };
    const ctx = makeTestCtx({ manifest: chain }); ctx.yes = true;
    await writeState(ctx.paths.stateFile, initialState(['node', 'sk-x'], { node: { version: '1', at: 't' }, 'sk-x': { version: '1', at: 't' } }));
    const logs: string[] = []; const orig = console.log; console.log = (m: string) => { logs.push(String(m)); };
    try { expect(await runUninstall(ctx, ['sk-x'], { installerVersion: '0.1.0' })).toBe(0); } finally { console.log = orig; }
    expect(logs[0]).not.toMatch(/remove node/); expect(logs[0]).toMatch(/remove sk-x/);
    const state = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8'));
    expect(state.selectedIds).toEqual(['node']); expect(state.installed.node.version).toBe('1'); expect(state.installed['sk-x']).toBeUndefined();
  });
});

describe('runUninstall provenance guard (2026-09-19 incident: uninstall removed pre-existing system packages)', () => {
  it('never removes a component the installer did not install itself', async () => {
    // A QA agent ran `uninstall --yes` on a real workstation. git, jq, ripgrep, gh and go were all present BEFORE
    // the installer ever ran, so nothing of ours put them there -- yet uninstall targeted them, and apt's removal of
    // bubblewrap took 150 further packages (gdm3, gnome-shell, Chrome) with it.
    clearProviders(); registerProvider(fakeProvider({ a: 'ok', b: 'ok' }));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    await writeState(ctx.paths.stateFile, initialState(['a', 'b'], {
      a: { version: '1', at: 't', byUs: true },   // we installed it
      b: { version: '1', at: 't', byUs: false },  // it was already on the host
    }));
    const code = await runUninstall(ctx, undefined, { installerVersion: '0.1.0', all: true });
    expect(code).toBe(0);
    const state = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8'));
    expect(state.installed.a).toBeUndefined(); // ours: removed
    expect(state.installed.b).toBeDefined();   // theirs: left alone
  });

  it('refuses an explicitly named component we did not install, and names --force', async () => {
    clearProviders(); registerProvider(fakeProvider({ b: 'ok' }));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    await writeState(ctx.paths.stateFile, initialState(['b'], { b: { version: '1', at: 't', byUs: false } }));
    const code = await runUninstall(ctx, ['b'], { installerVersion: '0.1.0' });
    expect(code).toBe(1);
    expect(ctx.log.lines.some((l) => /--force/.test(l))).toBe(true);
    expect(JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8')).installed.b).toBeDefined();
  });

  it('--force removes a component we did not install, when the user names it', async () => {
    clearProviders(); registerProvider(fakeProvider({ b: 'ok' }));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    await writeState(ctx.paths.stateFile, initialState(['b'], { b: { version: '1', at: 't', byUs: false } }));
    expect(await runUninstall(ctx, ['b'], { installerVersion: '0.1.0', force: true })).toBe(0);
    expect(JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8')).installed.b).toBeUndefined();
  });

  it('bare `uninstall --yes` refuses to wipe everything without --all', async () => {
    clearProviders(); registerProvider(fakeProvider({ a: 'ok', b: 'ok' }));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    await writeState(ctx.paths.stateFile, initialState(['a', 'b'], { a: { version: '1', at: 't', byUs: true } }));
    const code = await runUninstall(ctx, undefined, { installerVersion: '0.1.0' });
    expect(code).toBe(1);
    expect(ctx.log.lines.some((l) => /--all/.test(l))).toBe(true);
    expect(JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8')).installed.a).toBeDefined();
  });
});

describe('runUninstall cleans up what install left outside the component list', () => {
  it('removes the secrets file and both rc marker blocks on --all', async () => {
    // Nothing ever deleted <stateDir>/secrets.env -- which holds a captured CLAUDE_CODE_OAUTH_TOKEN -- nor the
    // `super-agent-installer secrets`/`path` blocks that keep sourcing it from every future shell.
    clearProviders(); registerProvider(fakeProvider({ a: 'ok' }));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    mkdirSync(ctx.paths.stateDir, { recursive: true });
    const secrets = join(ctx.paths.stateDir, 'secrets.env');
    writeFileSync(secrets, "# >>> super-agent-installer secrets >>>\nexport K='v'\n# <<< super-agent-installer secrets <<<\n");
    const profile = join(ctx.host.home, '.profile');
    writeFileSync(profile, `# mine\n# >>> super-agent-installer secrets >>>\n[ -f "${secrets}" ] && . "${secrets}"\n# <<< super-agent-installer secrets <<<\n# >>> super-agent-installer path >>>\nexport PATH="$HOME/go/bin:$PATH"\n# <<< super-agent-installer path <<<\n`);
    await writeState(ctx.paths.stateFile, initialState(['a'], { a: { version: '1', at: 't' } }));
    expect(await runUninstall(ctx, undefined, { installerVersion: '0.1.0', all: true })).toBe(0);
    expect(existsSync(secrets)).toBe(false);
    const text = readFileSync(profile, 'utf8');
    expect(text).not.toContain('super-agent-installer secrets');
    expect(text).not.toContain('super-agent-installer path');
    expect(text).toContain('# mine'); // the user's own lines survive
  });

  it('leaves secrets alone when only some components are removed', async () => {
    clearProviders(); registerProvider(fakeProvider({ a: 'ok', b: 'ok' }));
    const ctx = makeTestCtx({ manifest }); ctx.yes = true;
    mkdirSync(ctx.paths.stateDir, { recursive: true });
    const secrets = join(ctx.paths.stateDir, 'secrets.env');
    writeFileSync(secrets, 'export K=v\n');
    await writeState(ctx.paths.stateFile, initialState(['a', 'b'], { a: { version: '1', at: 't' }, b: { version: '1', at: 't' } }));
    expect(await runUninstall(ctx, ['a'], { installerVersion: '0.1.0' })).toBe(0);
    expect(existsSync(secrets)).toBe(true);
  });
});
