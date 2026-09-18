import { describe, it, expect } from 'vitest';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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
});
