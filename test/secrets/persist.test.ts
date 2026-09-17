import { describe, it, expect } from 'vitest';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { persistSecrets } from '../../src/secrets/persist.js';
import { makeTestCtx } from '../helpers/ctx.js';

describe('persistSecrets on Windows', () => {
  it('passes each value through the child env, never argv, and records the powershell call per var', async () => {
    const ctx = makeTestCtx({ host: { platform: 'windows' } });
    const result = await persistSecrets(ctx, new Map([['CONTEXT7_API_KEY', 'ctx7sk-secret-value'], ['GITHUB_PAT_TOKEN', 'ghp_another_secret']]));
    expect(result.persisted.sort()).toEqual(['CONTEXT7_API_KEY', 'GITHUB_PAT_TOKEN']);
    expect(result.failed).toEqual([]);
    expect(ctx.calls).toHaveLength(2);
    for (const argv of ctx.calls) {
      expect(argv[0]).toBe('powershell.exe');
      expect(argv.join(' ')).not.toContain('ctx7sk-secret-value');
      expect(argv.join(' ')).not.toContain('ghp_another_secret');
      expect(argv.some((a) => a.includes('SetEnvironmentVariable'))).toBe(true);
    }
    expect(ctx.opts[0]?.opts.env?.SAI_SECRET_VALUE).toBe('ctx7sk-secret-value');
    expect(ctx.opts[1]?.opts.env?.SAI_SECRET_VALUE).toBe('ghp_another_secret');
  });
  it('rejects a value over 1024 characters with a clear reason and does not shell out for it', async () => {
    const ctx = makeTestCtx({ host: { platform: 'windows' } });
    const huge = 'x'.repeat(1025);
    const result = await persistSecrets(ctx, new Map([['BIG_KEY', huge]]));
    expect(result.persisted).toEqual([]);
    expect(result.failed).toEqual([{ name: 'BIG_KEY', reason: expect.stringMatching(/1024/) }]);
    expect(ctx.calls).toHaveLength(0);
  });
  it('never runs under --dry-run', async () => {
    const ctx = makeTestCtx({ host: { platform: 'windows' }, dryRun: true });
    const result = await persistSecrets(ctx, new Map([['CONTEXT7_API_KEY', 'value']]));
    expect(result).toEqual({ persisted: [], failed: [] });
    expect(ctx.calls).toHaveLength(0);
  });
});

describe('persistSecrets on POSIX', () => {
  it('writes a 0600 marked block into ~/.profile and is idempotent', async () => {
    const ctx = makeTestCtx();
    const profilePath = join(ctx.host.home, '.profile');
    const r1 = await persistSecrets(ctx, new Map([['CONTEXT7_API_KEY', "va'lue"]]));
    expect(r1.persisted).toEqual(['CONTEXT7_API_KEY']);
    expect(r1.failed).toEqual([]);
    const text1 = await readFile(profilePath, 'utf8');
    expect(text1).toContain(`export CONTEXT7_API_KEY='va'\\''lue'`);
    const mode1 = (await import('node:fs/promises')).stat;
    expect((await mode1(profilePath)).mode & 0o777).toBe(0o600);
    const r2 = await persistSecrets(ctx, new Map([['CONTEXT7_API_KEY', "va'lue"]]));
    expect(r2.persisted).toEqual(['CONTEXT7_API_KEY']);
    const text2 = await readFile(profilePath, 'utf8');
    expect(text2).toBe(text1); // idempotent: re-running does not duplicate the block
  });
  it('also updates ~/.zshrc when it already exists, but does not create it', async () => {
    const ctx = makeTestCtx();
    await persistSecrets(ctx, new Map([['A_KEY', 'first']]));
    const zshrcPath = join(ctx.host.home, '.zshrc');
    await expect(readFile(zshrcPath, 'utf8')).rejects.toThrow();
    await writeFile(zshrcPath, '# my zshrc\n', 'utf8');
    await persistSecrets(ctx, new Map([['A_KEY', 'second']]));
    const zshrcText = await readFile(zshrcPath, 'utf8');
    expect(zshrcText).toContain(`export A_KEY='second'`);
    expect(zshrcText).toContain('# my zshrc');
  });
  it('does not force 0600 onto an already-existing, differently-permissioned file', async () => {
    const ctx = makeTestCtx();
    const profilePath = join(ctx.host.home, '.profile');
    await writeFile(profilePath, '# existing\n', { mode: 0o644 });
    await chmod(profilePath, 0o644);
    await persistSecrets(ctx, new Map([['A_KEY', 'v']]));
    const { stat } = await import('node:fs/promises');
    expect((await stat(profilePath)).mode & 0o777).toBe(0o644);
  });
  it('never runs under --dry-run', async () => {
    const ctx = makeTestCtx({ dryRun: true });
    const result = await persistSecrets(ctx, new Map([['A_KEY', 'v']]));
    expect(result).toEqual({ persisted: [], failed: [] });
    await expect(readFile(join(ctx.host.home, '.profile'), 'utf8')).rejects.toThrow();
  });
  it('never logs the secret value, only the variable name', async () => {
    const ctx = makeTestCtx();
    await persistSecrets(ctx, new Map([['A_KEY', 'super-secret-value']]));
    expect(ctx.log.lines.join('\n')).not.toContain('super-secret-value');
    expect(ctx.log.lines.join('\n')).toContain('A_KEY');
  });
});
