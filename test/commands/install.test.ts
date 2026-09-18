import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInstall } from '../../src/commands/install.js';
import { runUpdate } from '../../src/commands/update.js';
import { registerProvider, clearProviders } from '../../src/providers/registry.js';
import { action, skipAction } from '../../src/providers/types.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, Manifest, Provider } from '../../src/types.js';
const comp = (id: string, ok = true): Component => ({ id, name: id, kind: 'tool', agents: 'both', platforms: ['linux'], description: '', verdict: 'must-have', defaultSelected: true, spec: { kind: 'tool', probe: [id], packages: {} } });
const manifest: Manifest = { version: 1, profiles: { all: { description: '', base: 'all' }, minimal: { description: '', base: 'none', include: ['a'] } }, components: [comp('a'), comp('b')] };
const fake = (fails: string[]): Provider => ({ kind: 'tool', detect: async () => null, latest: async () => '1', plan: async (c) => [action(c.id, 'install', `install ${c.id}`, async () => (fails.includes(c.id) ? { ok: false, changed: false, message: 'bad' } : { ok: true, changed: true, message: 'good' }), { to: '1' })] });
describe('runInstall / runUpdate', () => {
  it('installs the profile, writes state, returns 1 when a step fails', async () => {
    clearProviders(); registerProvider(fake(['b']));
    const ctx = makeTestCtx({ manifest });
    expect(await runInstall(ctx, { profile: 'all', installerVersion: '0.1.0' })).toBe(1);
    const state = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8')); expect(state.selectedIds).toEqual(['a', 'b']); expect(state.installed.a.version).toBe('1'); expect(state.installed.b).toBeUndefined();
  });
  it('dry-run plans without executing or writing state', async () => {
    clearProviders(); registerProvider(fake([]));
    const ctx = makeTestCtx({ manifest, dryRun: true });
    expect(await runInstall(ctx, { profile: 'minimal', installerVersion: '0.1.0' })).toBe(0); expect(existsSync(ctx.paths.stateFile)).toBe(false);
  });
  it('update replays the saved selection and calls self-update first', async () => {
    clearProviders(); registerProvider(fake([]));
    const ctx = makeTestCtx({ manifest }); await runInstall(ctx, { profile: 'minimal', installerVersion: '0.1.0' });
    let selfUpdated = false;
    expect(await runUpdate(ctx, { installerVersion: '0.1.0', selfUpdateFn: async () => { selfUpdated = true; return { updated: false, message: 'current' }; } })).toBe(0);
    expect(selfUpdated).toBe(true); expect(JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8')).selectedIds).toEqual(['a']);
  });
  it('bails on NixOS with exit 4', async () => { clearProviders(); registerProvider(fake([])); const ctx = makeTestCtx({ manifest, host: { isNixOS: true } }); expect(await runInstall(ctx, { profile: 'all', installerVersion: '0.1.0' })).toBe(4); });
  it('update skips self-update under dry-run', async () => {
    clearProviders(); registerProvider(fake([]));
    const ctx = makeTestCtx({ manifest, dryRun: true }); await runInstall(ctx, { profile: 'minimal', installerVersion: '0.1.0' });
    let selfUpdated = false;
    expect(await runUpdate(ctx, { installerVersion: '0.1.0', selfUpdateFn: async () => { selfUpdated = true; return { updated: true, message: 'would update' }; } })).toBe(0);
    expect(selfUpdated).toBe(false);
  });
});

// C1: a host without Claude/Codex/node must get agents AND their dependents in ONE run; --dry-run must execute nothing.
const kinded = (id: string, kind: Component['kind'], spec: Component['spec'], extra: Partial<Component> = {}): Component => ({ id, name: id, kind, agents: 'both', platforms: ['linux'], description: '', verdict: 'must-have', defaultSelected: true, spec, ...extra });
const freshManifest: Manifest = { version: 1, profiles: { minimal: { description: '', base: 'none', include: ['claude-code', 'cp-x', 'mcp-y'] } }, components: [
  kinded('claude-code', 'agent', { kind: 'agent', agent: 'claude' }),
  kinded('cp-x', 'claude-plugin', { kind: 'claude-plugin', marketplace: 'm', plugin: 'x' }, { secrets: [{ env: 'X_TOKEN', prompt: 'token for x', required: false }] }),
  kinded('mcp-y', 'mcp', { kind: 'mcp', target: 'claude', name: 'y', transport: 'http', url: 'https://y' }),
] };
function registerFreshHost() {
  let agentInstalled = false; const ran: string[] = [];
  registerProvider({ kind: 'agent', detect: async () => (agentInstalled ? { version: '2' } : null), latest: async () => '2', plan: async (c, _ctx, inst) => (inst ? [] : [action(c.id, 'install', 'install Claude Code', async () => { agentInstalled = true; ran.push(c.id); return { ok: true, changed: true, message: 'installed' }; }, { to: '2' })]) });
  const dependent = (kind: Component['kind']): Provider => ({ kind, detect: async () => null, plan: async (c) => (agentInstalled ? [action(c.id, 'install', `install ${c.id}`, async () => { ran.push(c.id); return { ok: true, changed: true, message: 'done' }; })] : [skipAction(c.id, 'Claude Code not installed', 'claude-code')]) });
  registerProvider(dependent('claude-plugin')); registerProvider(dependent('mcp'));
  return { ran, installed: () => agentInstalled };
}
describe('runInstall on a fresh host', () => {
  it('installs the agent and its dependents in one run and records them in state', async () => {
    clearProviders(); const f = registerFreshHost();
    const ctx = makeTestCtx({ manifest: freshManifest });
    const logs: string[] = []; const orig = console.log; console.log = (m: string) => { logs.push(String(m)); };
    try { expect(await runInstall(ctx, { profile: 'minimal', installerVersion: '0.1.0' })).toBe(0); } finally { console.log = orig; }
    expect(f.ran).toEqual(['claude-code', 'cp-x', 'mcp-y']);
    const preview = logs[0] ?? ''; expect(preview).toContain('install (after claude-code)'); expect(preview).not.toContain('Claude Code not installed');
    const state = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8')); expect(Object.keys(state.installed).sort()).toEqual(['claude-code', 'cp-x', 'mcp-y']);
    expect(logs.join('\n')).toContain('export X_TOKEN=<value>');
  });
  it('--dry-run shows the same one-run plan but executes nothing and writes no state', async () => {
    clearProviders(); const f = registerFreshHost();
    const ctx = makeTestCtx({ manifest: freshManifest, dryRun: true });
    const logs: string[] = []; const orig = console.log; console.log = (m: string) => { logs.push(String(m)); };
    try { expect(await runInstall(ctx, { profile: 'minimal', installerVersion: '0.1.0' })).toBe(0); } finally { console.log = orig; }
    expect(f.ran).toEqual([]); expect(f.installed()).toBe(false); expect(existsSync(ctx.paths.stateFile)).toBe(false);
    expect(logs[0]).toContain('install (after claude-code)');
  });
});

// Task 3: sign-in wiring in runInstall -- ensureAuth runs after the picker/plan preview and before promptSecrets,
// only when not --dry-run and not --no-login, and only for agents this run's selection actually needs.
const bothAgentsManifest: Manifest = { version: 1, profiles: { all: { description: '', base: 'all' } }, components: [
  kinded('claude-code', 'tool', { kind: 'tool', probe: ['claude-code'], packages: {} }, { agents: 'claude' }),
  kinded('codex-cli', 'tool', { kind: 'tool', probe: ['codex-cli'], packages: {} }, { agents: 'codex' }),
] };
describe('runInstall sign-in wiring', () => {
  it('signs both agents in when both agent components are selected and stores the result on ctx.auth', async () => {
    clearProviders(); registerProvider(fake([]));
    const ctx = makeTestCtx({ manifest: bothAgentsManifest, responses: { 'claude auth status': 'Logged in as demo@example.com', 'codex login status': 'Logged in using ChatGPT' } });
    await runInstall(ctx, { profile: 'all', installerVersion: '0.1.0' });
    expect(ctx.auth?.claude).toMatchObject({ authenticated: true });
    expect(ctx.auth?.codex).toMatchObject({ authenticated: true, mode: 'chatgpt' });
  });
  it('does not sign in an agent that nothing in the selection needs', async () => {
    clearProviders(); registerProvider(fake([]));
    const manifest: Manifest = { version: 1, profiles: { all: { description: '', base: 'all' } }, components: [kinded('mcp-y', 'tool', { kind: 'tool', probe: ['y'], packages: {} }, { agents: 'claude' })] };
    const ctx = makeTestCtx({ manifest });
    await runInstall(ctx, { profile: 'all', installerVersion: '0.1.0' });
    expect(ctx.auth).toBeUndefined();
    expect(ctx.calls.some((a) => a.join(' ').includes('auth status') || a.join(' ').includes('login status'))).toBe(false);
  });
  it('signs claude in when a claude-targeted component is selected and claude is already installed (not part of this run)', async () => {
    clearProviders(); registerProvider(fake([]));
    const manifest: Manifest = { version: 1, profiles: { all: { description: '', base: 'all' } }, components: [kinded('cp-x', 'tool', { kind: 'tool', probe: ['x'], packages: {} }, { agents: 'claude' })] };
    const ctx = makeTestCtx({ manifest, responses: { 'claude --version': 'claude 2.0.0', 'claude auth status': 'Logged in as demo@example.com' } });
    await runInstall(ctx, { profile: 'all', installerVersion: '0.1.0' });
    expect(ctx.auth?.claude).toMatchObject({ authenticated: true });
  });
  it('never signs in during --dry-run', async () => {
    clearProviders(); registerProvider(fake([]));
    const ctx = makeTestCtx({ manifest: bothAgentsManifest, dryRun: true, responses: { 'claude auth status': 'Logged in as demo@example.com', 'codex login status': 'Logged in using ChatGPT' } });
    await runInstall(ctx, { profile: 'all', installerVersion: '0.1.0' });
    expect(ctx.auth).toBeUndefined();
    expect(ctx.calls.some((a) => a.join(' ').includes('auth status') || a.join(' ').includes('login status'))).toBe(false);
  });
  it('never signs in when --no-login is passed, even outside --dry-run', async () => {
    clearProviders(); registerProvider(fake([]));
    const ctx = makeTestCtx({ manifest: bothAgentsManifest, responses: { 'claude auth status': 'Logged in as demo@example.com', 'codex login status': 'Logged in using ChatGPT' } });
    await runInstall(ctx, { profile: 'all', installerVersion: '0.1.0', noLogin: true });
    expect(ctx.auth).toBeUndefined();
    expect(ctx.calls.some((a) => a.join(' ').includes('auth status') || a.join(' ').includes('login status'))).toBe(false);
  });
});

// Task 5: persist everything in ctx.secrets (including a captured token that never went through promptSecrets)
// once, after promptSecrets, unless --dry-run or --no-persist-secrets.
describe('runInstall secret persistence wiring', () => {
  it('persists everything in ctx.secrets, including a pre-captured token, and records the result on ctx.secretsPersist', async () => {
    clearProviders(); registerProvider(fake([]));
    const ctx = makeTestCtx({ manifest, secrets: { CLAUDE_CODE_OAUTH_TOKEN: 'captured-token' } });
    await runInstall(ctx, { profile: 'minimal', installerVersion: '0.1.0' });
    expect(ctx.secretsPersist?.persisted).toEqual(['CLAUDE_CODE_OAUTH_TOKEN']);
    expect(readFileSync(join(ctx.paths.stateDir, 'secrets.env'), 'utf8')).toContain("export CLAUDE_CODE_OAUTH_TOKEN='captured-token'");
    const profileText = readFileSync(join(ctx.host.home, '.profile'), 'utf8');
    expect(profileText).not.toContain('captured-token');
    expect(profileText).toContain(join(ctx.paths.stateDir, 'secrets.env'));
  });
  it('--no-persist-secrets skips persistence entirely', async () => {
    clearProviders(); registerProvider(fake([]));
    const ctx = makeTestCtx({ manifest, secrets: { CLAUDE_CODE_OAUTH_TOKEN: 'captured-token' } });
    await runInstall(ctx, { profile: 'minimal', installerVersion: '0.1.0', noPersistSecrets: true });
    expect(ctx.secretsPersist).toBeUndefined();
    expect(existsSync(join(ctx.host.home, '.profile'))).toBe(false);
  });
  it('--dry-run never persists secrets', async () => {
    clearProviders(); registerProvider(fake([]));
    const ctx = makeTestCtx({ manifest, dryRun: true, secrets: { CLAUDE_CODE_OAUTH_TOKEN: 'captured-token' } });
    await runInstall(ctx, { profile: 'minimal', installerVersion: '0.1.0' });
    expect(ctx.secretsPersist).toBeUndefined();
    expect(existsSync(join(ctx.host.home, '.profile'))).toBe(false);
  });
});

// C1: on a clean host `claude`/`codex` do not exist when the run starts, so the sign-in + secrets block has to run
// after the `agent` kind group installed them -- and still run at all when no agent component is selected.
describe('runInstall sign-in ordering (C1)', () => {
  const quietLogs = async (fn: () => Promise<number>): Promise<{ code: number; logs: string[] }> => {
    const logs: string[] = []; const orig = console.log; console.log = (m: string) => { logs.push(String(m)); };
    try { return { code: await fn(), logs }; } finally { console.log = orig; }
  };
  it('signs the agent in only after the agent group installed it, and before its dependents run', async () => {
    clearProviders(); const f = registerFreshHost();
    const ctx = makeTestCtx({ manifest: freshManifest });
    const base = ctx.run;
    let ranAtAuth: string[] | null = null;
    ctx.run = async (argv, opts) => {
      const key = argv.join(' ');
      if (key === 'claude --version') return f.installed() ? { code: 0, stdout: '2.0.0', stderr: '', skipped: false } : { code: 127, stdout: '', stderr: 'not found', skipped: false };
      if (key === 'claude auth status') {
        if (ranAtAuth === null) ranAtAuth = [...f.ran];
        return f.installed() ? { code: 0, stdout: 'Logged in as demo@example.com', stderr: '', skipped: false } : { code: 127, stdout: '', stderr: 'not found', skipped: false };
      }
      return base(argv, opts);
    };
    const { code } = await quietLogs(() => runInstall(ctx, { profile: 'minimal', installerVersion: '0.1.0' }));
    expect(code).toBe(0);
    expect(ranAtAuth).toEqual(['claude-code']); // after the agent installed, before cp-x / mcp-y
    expect(ctx.auth?.claude).toMatchObject({ authenticated: true });
    expect(f.ran).toEqual(['claude-code', 'cp-x', 'mcp-y']);
  });
  it('finishes the secrets block before the mcp group is planned (MCP specs substitute ${VAR} at plan time)', async () => {
    clearProviders(); const f = registerFreshHost();
    let persistedAtMcpPlan: boolean | null = null;
    registerProvider({ kind: 'mcp', detect: async () => null, plan: async (c, ctx) => { persistedAtMcpPlan = ctx.secretsPersist !== undefined; return [action(c.id, 'install', `install ${c.id}`, async () => { f.ran.push(c.id); return { ok: true, changed: true, message: 'done' }; })]; } });
    const ctx = makeTestCtx({ manifest: freshManifest, secrets: { X_TOKEN: 'typed' }, responses: { 'claude auth status': 'Logged in as demo@example.com' } });
    await quietLogs(() => runInstall(ctx, { profile: 'minimal', installerVersion: '0.1.0' }));
    expect(persistedAtMcpPlan).toBe(true);
  });
  it('still runs the block when no agent-kind component is selected', async () => {
    clearProviders(); registerProvider(fake([]));
    const manifest: Manifest = { version: 1, profiles: { all: { description: '', base: 'all' } }, components: [kinded('cp-x', 'tool', { kind: 'tool', probe: ['x'], packages: {} }, { agents: 'claude' })] };
    const ctx = makeTestCtx({ manifest, secrets: { X_TOKEN: 'typed' }, responses: { 'claude --version': 'claude 2.0.0', 'claude auth status': 'Logged in as demo@example.com' } });
    await quietLogs(() => runInstall(ctx, { profile: 'all', installerVersion: '0.1.0' }));
    expect(ctx.auth?.claude).toMatchObject({ authenticated: true });
    expect(ctx.secretsPersist?.persisted).toEqual(['X_TOKEN']);
  });
});

// M3: D1 requires an auth failure to reach the exit code. An auth-blocked skip is not an ordinary skip.
describe('runInstall exit code for auth-blocked components', () => {
  it('returns 2 when a component was skipped because its agent is not signed in, and 0 for ordinary skips', async () => {
    const blockedManifest: Manifest = { version: 1, profiles: { all: { description: '', base: 'all' } }, components: [kinded('cx-x', 'codex-plugin', { kind: 'codex-plugin', marketplace: 'openai-curated-remote', marketplaceSource: 'reserved', plugin: 'x' })] };
    clearProviders();
    registerProvider({ kind: 'codex-plugin', detect: async () => null, plan: async (c) => [skipAction(c.id, 'Codex is not signed in (remote catalog needs a ChatGPT login)', 'codex-cli', { blocked: true })] });
    const ctx = makeTestCtx({ manifest: blockedManifest });
    const orig = console.log; console.log = () => {};
    try { expect(await runInstall(ctx, { profile: 'all', installerVersion: '0.1.0', noLogin: true })).toBe(2); } finally { console.log = orig; }
    clearProviders();
    registerProvider({ kind: 'codex-plugin', detect: async () => null, plan: async (c) => [skipAction(c.id, 'nothing to do', 'codex-cli')] });
    const plain = makeTestCtx({ manifest: blockedManifest });
    const orig2 = console.log; console.log = () => {};
    try { expect(await runInstall(plain, { profile: 'all', installerVersion: '0.1.0', noLogin: true })).toBe(0); } finally { console.log = orig2; }
  });
});
