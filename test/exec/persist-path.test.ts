import { describe, it, expect } from 'vitest';
import { mkdirSync, existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { persistToolPath } from '../../src/exec/persist-path.js';
import { makeTestCtx } from '../helpers/ctx.js';

describe('persistToolPath', () => {
  it('writes the home tool dirs that exist into the shell rc, and never a system dir', async () => {
    // GCE QA on Debian/Rocky: gopls installed into ~/go/bin, which no login shell had on PATH, so the LSP plugin
    // could not find it after the run -- leftover work for the user.
    const ctx = makeTestCtx();
    const goBin = join(ctx.host.home, 'go', 'bin');
    mkdirSync(goBin, { recursive: true });
    const written = await persistToolPath(ctx);
    const profile = join(ctx.host.home, '.profile');
    expect(written).toContain(profile);
    const text = readFileSync(profile, 'utf8');
    expect(text).toContain(goBin);
    expect(text).not.toContain('/usr/local/bin'); // already on every login PATH: writing it back is churn
    expect(text).toContain('# >>> super-agent-installer path >>>');
  });
  it('is idempotent and leaves an existing install.sh PATH block alone', async () => {
    const ctx = makeTestCtx();
    mkdirSync(join(ctx.host.home, 'go', 'bin'), { recursive: true });
    const profile = join(ctx.host.home, '.profile');
    writeFileSync(profile, '# >>> super-agent-installer >>>\nexport PATH="$HOME/.local/bin:$PATH"\n# <<< super-agent-installer <<<\n');
    await persistToolPath(ctx);
    await persistToolPath(ctx);
    const text = readFileSync(profile, 'utf8');
    expect(text.match(/# >>> super-agent-installer path >>>/g)).toHaveLength(1);
    expect(text).toContain('# >>> super-agent-installer >>>'); // the bootstrap's own block survives
  });
  it('writes nothing under --dry-run', async () => {
    const ctx = makeTestCtx({ dryRun: true });
    mkdirSync(join(ctx.host.home, 'go', 'bin'), { recursive: true });
    expect(await persistToolPath(ctx)).toEqual([]);
    expect(existsSync(join(ctx.host.home, '.profile'))).toBe(false);
  });

  it('escapes directories so a $ or space in $HOME cannot corrupt every future shell', async () => {
    // The block is sourced by every login. `export PATH="<dir>:$PATH"` with an unquoted dir breaks the moment
    // $HOME holds a space, and a `$` in the path would expand to something else entirely.
    const spaced = mkdtempSync(join(tmpdir(), 'sai home $x ')); // a space AND a $, both legal in a home path
    const ctx = makeTestCtx({ host: { home: spaced } });
    mkdirSync(join(spaced, 'go', 'bin'), { recursive: true });
    const written = await persistToolPath(ctx);
    expect(written.length).toBeGreaterThan(0);
    const line = readFileSync(join(spaced, '.profile'), 'utf8').split('\n').find((l) => l.includes('go/bin'))!;
    expect(line).toBeDefined();
    // the directory must survive as one word: quoted, and the shell must still expand $PATH
    const shown = execFileSync('sh', ['-c', `${line}; printf %s "$PATH"`], { encoding: 'utf8' });
    expect(shown.split(':')).toContain(join(spaced, 'go', 'bin'));
  });
});
