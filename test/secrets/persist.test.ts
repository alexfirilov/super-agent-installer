import { describe, it, expect } from 'vitest';
import { readFile, writeFile, chmod, mkdir, stat, rm } from 'node:fs/promises';
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
  it('writes the secret into a dedicated 0600 file under stateDir, never into ~/.profile, and is idempotent', async () => {
    const ctx = makeTestCtx();
    const profilePath = join(ctx.host.home, '.profile');
    const secretsPath = join(ctx.paths.stateDir, 'secrets.env');
    const r1 = await persistSecrets(ctx, new Map([['CONTEXT7_API_KEY', "va'lue"]]));
    expect(r1.persisted).toEqual(['CONTEXT7_API_KEY']);
    expect(r1.failed).toEqual([]);

    const secretsText1 = await readFile(secretsPath, 'utf8');
    expect(secretsText1).toContain(`export CONTEXT7_API_KEY='va'\\''lue'`);
    expect((await stat(secretsPath)).mode & 0o777).toBe(0o600);

    const profileText1 = await readFile(profilePath, 'utf8');
    expect(profileText1).toContain(secretsPath);
    expect(profileText1).toMatch(/\[ -f "[^"]+" ] && \. "[^"]+"/);
    expect(profileText1).not.toContain("va'lue");
    expect(profileText1).not.toContain('CONTEXT7_API_KEY=');

    const r2 = await persistSecrets(ctx, new Map([['CONTEXT7_API_KEY', "va'lue"]]));
    expect(r2.persisted).toEqual(['CONTEXT7_API_KEY']);
    expect(await readFile(secretsPath, 'utf8')).toBe(secretsText1); // idempotent: re-running does not duplicate the block
    expect(await readFile(profilePath, 'utf8')).toBe(profileText1);
  });
  it('secrets file is 0600 even when the config dir already exists with a loose mode', async () => {
    const ctx = makeTestCtx();
    await mkdir(ctx.paths.stateDir, { recursive: true, mode: 0o777 });
    await chmod(ctx.paths.stateDir, 0o777);
    await persistSecrets(ctx, new Map([['A_KEY', 'v']]));
    const secretsPath = join(ctx.paths.stateDir, 'secrets.env');
    expect((await stat(secretsPath)).mode & 0o777).toBe(0o600);
  });
  it('honours XDG_CONFIG_HOME for the secrets file location', async () => {
    const ctx = makeTestCtx();
    const xdg = join(ctx.host.home, 'xdg-config');
    await mkdir(xdg, { recursive: true });
    const withXdg = makeTestCtx({ host: { home: ctx.host.home }, env: { XDG_CONFIG_HOME: xdg } });
    await persistSecrets(withXdg, new Map([['A_KEY', 'v']]));
    const secretsPath = join(xdg, 'super-agent-installer', 'secrets.env');
    expect((await stat(secretsPath)).mode & 0o777).toBe(0o600);
    const text = await readFile(secretsPath, 'utf8');
    expect(text).toContain("export A_KEY='v'");
  });
  it('also updates ~/.zshrc with the source line when it already exists, but does not create it', async () => {
    const ctx = makeTestCtx();
    await persistSecrets(ctx, new Map([['A_KEY', 'first']]));
    const zshrcPath = join(ctx.host.home, '.zshrc');
    await expect(readFile(zshrcPath, 'utf8')).rejects.toThrow();
    await writeFile(zshrcPath, '# my zshrc\n', 'utf8');
    await persistSecrets(ctx, new Map([['A_KEY', 'second']]));
    const zshrcText = await readFile(zshrcPath, 'utf8');
    expect(zshrcText).toContain('# my zshrc');
    expect(zshrcText).not.toContain('second');
    expect(zshrcText).not.toContain('export A_KEY');
    expect(zshrcText).toContain(join(ctx.paths.stateDir, 'secrets.env'));
  });
  it('does not force any particular mode onto an already-existing ~/.profile (it holds no secret)', async () => {
    const ctx = makeTestCtx();
    const profilePath = join(ctx.host.home, '.profile');
    await writeFile(profilePath, '# existing\n', { mode: 0o644 });
    await chmod(profilePath, 0o644);
    await persistSecrets(ctx, new Map([['A_KEY', 'v']]));
    expect((await stat(profilePath)).mode & 0o777).toBe(0o644);
  });
  it('never runs under --dry-run', async () => {
    const ctx = makeTestCtx({ dryRun: true });
    const result = await persistSecrets(ctx, new Map([['A_KEY', 'v']]));
    expect(result).toEqual({ persisted: [], failed: [] });
    await expect(readFile(join(ctx.host.home, '.profile'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(ctx.paths.stateDir, 'secrets.env'), 'utf8')).rejects.toThrow();
  });
  it('never logs the secret value, only the variable name', async () => {
    const ctx = makeTestCtx();
    await persistSecrets(ctx, new Map([['A_KEY', 'super-secret-value']]));
    expect(ctx.log.lines.join('\n')).not.toContain('super-secret-value');
    expect(ctx.log.lines.join('\n')).toContain('A_KEY');
  });
  it('fails closed (no value written, ~/.profile untouched) when the secrets file cannot be written', async () => {
    const ctx = makeTestCtx();
    const secretsPath = join(ctx.paths.stateDir, 'secrets.env');
    // make the target path itself a directory so writing the secrets file fails
    await mkdir(secretsPath, { recursive: true });
    const result = await persistSecrets(ctx, new Map([['A_KEY', 'v']]));
    expect(result.persisted).toEqual([]);
    expect(result.failed).toEqual([{ name: 'A_KEY', reason: expect.any(String) }]);
    await expect(readFile(join(ctx.host.home, '.profile'), 'utf8')).rejects.toThrow();
    await rm(secretsPath, { recursive: true, force: true });
  });
});
