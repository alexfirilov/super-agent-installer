import { describe, it, expect } from 'vitest';
import { postInstallHints, secretExportHints, promptSecrets, renderSummary, type SecretsUi } from '../../src/commands/summary.js';
import { makeTestCtx } from '../helpers/ctx.js';
import type { Component, StepRecord } from '../../src/types.js';
const comp = (id: string, secrets: Component['secrets']): Component => ({ id, name: id, kind: 'mcp', agents: 'both', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: true, secrets, spec: { kind: 'mcp', target: 'claude', name: id, transport: 'http', url: 'https://x' } });
describe('secretExportHints', () => {
  const comps = [comp('a', [{ env: 'A_KEY', prompt: 'A key', required: true }]), comp('b', [{ env: 'B_KEY', prompt: 'B key', required: false }, { env: 'A_KEY', prompt: 'dup', required: false }]), comp('c', [{ env: 'C_KEY', prompt: 'C key', required: true }])];
  it('lists every secret env that is not in the ambient environment, once, including values typed this run', () => {
    const ctx = makeTestCtx({ env: { B_KEY: 'ambient', C_KEY: 'typed' }, secrets: { C_KEY: 'typed' } });
    const hints = secretExportHints(ctx, comps);
    expect(hints).toHaveLength(2);
    expect(hints[0]).toMatch(/^export A_KEY=<value>  # A key \(required, not set\)/);
    expect(hints[1]).toMatch(/^export C_KEY=<value>  # C key \(the value you typed was used for this run only/);
  });
  it('uses setx on Windows and is included in postInstallHints', () => {
    const ctx = makeTestCtx({ host: { platform: 'windows' } });
    const hints = postInstallHints(ctx, comps, []);
    expect(hints).toEqual([expect.stringMatching(/^setx A_KEY "<value>"/), expect.stringMatching(/^setx B_KEY "<value>"  # B key \(optional, not set\)/), expect.stringMatching(/^setx C_KEY "<value>"/)]);
  });
  it('secretExportHints drops persisted vars and keeps the failed one with its reason', () => {
    const ctx = makeTestCtx();
    ctx.secretsPersist = { persisted: ['A_KEY', 'C_KEY'], failed: [{ name: 'B_KEY', reason: 'disk full' }] };
    const hints = secretExportHints(ctx, comps);
    expect(hints.some((h) => /^export A_KEY=<value>/.test(h))).toBe(false);
    expect(hints.some((h) => /^export C_KEY=<value>/.test(h))).toBe(false);
    expect(hints.some((h) => /^export B_KEY=<value>.*disk full/.test(h))).toBe(true);
  });
  it('postInstallHints prints one summary line naming the persisted secrets instead of their setx/export lines', () => {
    const ctx = makeTestCtx();
    ctx.secretsPersist = { persisted: ['A_KEY', 'C_KEY'], failed: [{ name: 'B_KEY', reason: 'disk full' }] };
    const hints = postInstallHints(ctx, comps, []);
    expect(hints.some((h) => /^persisted to your user environment: A_KEY, C_KEY \(open a new terminal/.test(h))).toBe(true);
    expect(hints.some((h) => /^export A_KEY=<value>/.test(h))).toBe(false);
    expect(hints.some((h) => /^export C_KEY=<value>/.test(h))).toBe(false);
    expect(hints.some((h) => /^export B_KEY=<value>.*disk full/.test(h))).toBe(true);
  });
});

describe('secrets captured but deliberately not persisted (M6)', () => {
  it('prints a manual line for a captured secret that --no-persist-secrets kept out of the user environment', () => {
    const ctx = makeTestCtx({ secrets: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-secret' } });
    const hints = postInstallHints(ctx, [], [], { persistSkipped: true });
    expect(hints.some((h) => /^export CLAUDE_CODE_OAUTH_TOKEN=<value>.*--no-persist-secrets/.test(h))).toBe(true);
    expect(hints.join('\n')).not.toContain('sk-ant-oat-secret'); // never the value
  });
  it('says nothing about it when persistence was attempted and worked', () => {
    const ctx = makeTestCtx({ secrets: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-secret' } });
    ctx.secretsPersist = { persisted: ['CLAUDE_CODE_OAUTH_TOKEN'], failed: [] };
    const hints = postInstallHints(ctx, [], []);
    expect(hints.some((h) => /^export CLAUDE_CODE_OAUTH_TOKEN/.test(h))).toBe(false);
  });
});

describe('postInstallHints advisory labeling', () => {
  const rec = (componentId: string): StepRecord => ({ componentId, op: 'install', ok: true, changed: true, message: 'installed' });
  it('labels a remaining manifest postInstallHint as advisory (nothing left that could have been an action)', () => {
    const ctx = makeTestCtx();
    const c: Component = { id: 'cp-claude-hud', name: 'claude-hud', kind: 'claude-plugin', agents: 'claude', platforms: ['linux'], description: '', verdict: 'optional', defaultSelected: false, postInstallHint: 'In Claude Code run /claude-hud:setup', spec: { kind: 'claude-plugin', marketplace: 'claude-hud', plugin: 'claude-hud' } };
    const hints = postInstallHints(ctx, [c], [rec('cp-claude-hud')]);
    expect(hints).toEqual(['cp-claude-hud: advisory: In Claude Code run /claude-hud:setup']);
  });
  it('labels the codex /hooks trust note and the restart-sessions note as advisory', () => {
    const ctx = makeTestCtx({ host: { claudeRunning: true } });
    const hints = postInstallHints(ctx, [], [rec('hook-caveman-codex')]);
    expect(hints).toContain('codex: advisory: open Codex and run /hooks to trust the new hooks');
    expect(hints).toContain('advisory: restart running Claude Code sessions to pick up plugin and settings changes');
  });
  it('no longer nags to run `claude`/`codex login` -- ensureAuth already signs the agents in during the run', () => {
    const ctx = makeTestCtx();
    const hints = postInstallHints(ctx, [], [rec('claude-code'), rec('codex-cli')]);
    expect(hints.some((h) => /run `claude`/.test(h))).toBe(false);
    expect(hints.some((h) => /run `codex`/.test(h))).toBe(false);
    expect(hints).toEqual([]);
  });
});

function scriptedSecretsUi(answers: string[]): SecretsUi & { calls: string[] } {
  let i = 0; const calls: string[] = [];
  return { calls, isCancel: (v) => v === Symbol.for('cancel'), password: async (o) => { calls.push(o.message); const a = answers[i]; i++; return a === undefined ? '' : a; } };
}
function fetchSeq(statuses: number[]): typeof fetch {
  let i = 0;
  return (async () => new Response('', { status: statuses[Math.min(i++, statuses.length - 1)] })) as unknown as typeof fetch;
}
describe('promptSecrets validation', () => {
  const wantsContext7 = [comp('m', [{ env: 'CONTEXT7_API_KEY', prompt: 'Context7 key', required: true }])];
  it('accepts a valid key on the first try with no re-prompt', async () => {
    const ctx = makeTestCtx({ fetch: fetchSeq([200]) }); ctx.yes = false;
    const ui = scriptedSecretsUi(['ctx7sk-good']);
    await promptSecrets(ctx, wantsContext7, { ui });
    expect(ui.calls).toHaveLength(1);
    expect(ctx.secrets.get('CONTEXT7_API_KEY')).toBe('ctx7sk-good');
  });
  it('re-prompts once on a rejected key and accepts a valid second value', async () => {
    const ctx = makeTestCtx({ fetch: fetchSeq([401, 200]) }); ctx.yes = false;
    const ui = scriptedSecretsUi(['bad', 'good']);
    await promptSecrets(ctx, wantsContext7, { ui });
    expect(ui.calls).toHaveLength(2);
    expect(ctx.secrets.get('CONTEXT7_API_KEY')).toBe('good');
  });
  it('keeps the second value with a warning when it also fails validation', async () => {
    const ctx = makeTestCtx({ fetch: fetchSeq([401, 401]) }); ctx.yes = false;
    const ui = scriptedSecretsUi(['bad', 'still-bad']);
    await promptSecrets(ctx, wantsContext7, { ui });
    expect(ctx.secrets.get('CONTEXT7_API_KEY')).toBe('still-bad');
    expect(ctx.log.lines.some((l) => /WARN/.test(l) && /CONTEXT7_API_KEY/.test(l))).toBe(true);
  });
  it('skips the variable when the re-prompt is left empty', async () => {
    const ctx = makeTestCtx({ fetch: fetchSeq([401]) }); ctx.yes = false;
    const ui = scriptedSecretsUi(['bad', '']);
    await promptSecrets(ctx, wantsContext7, { ui });
    expect(ui.calls).toHaveLength(2);
    expect(ctx.secrets.has('CONTEXT7_API_KEY')).toBe(false);
  });
  it('does not validate an env with no validator (single prompt, no warnings)', async () => {
    const ctx = makeTestCtx(); ctx.yes = false;
    const ui = scriptedSecretsUi(['whatever']);
    await promptSecrets(ctx, [comp('m', [{ env: 'SOME_OTHER_KEY', prompt: 'Other key', required: true }])], { ui });
    expect(ui.calls).toHaveLength(1);
    expect(ctx.secrets.get('SOME_OTHER_KEY')).toBe('whatever');
  });
  it('never validates under --dry-run even if reached', async () => {
    const ctx = makeTestCtx({ fetch: fetchSeq([401]), dryRun: true }); ctx.yes = false;
    const ui = scriptedSecretsUi(['whatever-value']);
    await promptSecrets(ctx, wantsContext7, { ui });
    expect(ui.calls).toHaveLength(1);
    expect(ctx.secrets.get('CONTEXT7_API_KEY')).toBe('whatever-value');
  });
});

// M3: a skip because an agent never signed in is not "nothing to do" -- it has to be visible in the table.
describe('renderSummary and auth-blocked skips', () => {
  const rec = (componentId: string, extra: Partial<StepRecord> = {}): StepRecord => ({ componentId, op: 'skip', ok: true, changed: false, message: 'nothing to do', ...extra });
  it('hides an ordinary skip but shows an auth-blocked one, and counts only the ordinary one as skipped', () => {
    const out = renderSummary([
      rec('cp-a'),
      rec('cx-superpowers-remote', { blocked: true, message: 'Codex is not signed in (remote catalog needs a ChatGPT login)' }),
      { componentId: 'node', op: 'install', ok: true, changed: true, message: 'Node installed' },
    ]);
    expect(out).toContain('cx-superpowers-remote');
    expect(out).toContain('BLOCKED');
    expect(out).not.toContain('cp-a');
    expect(out).toContain('(1 skipped: nothing to do)');
  });
});
