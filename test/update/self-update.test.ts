import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selfUpdate } from '../../src/update/self-update.js';
import { makeTestCtx } from '../helpers/ctx.js';
const bin = Buffer.from('new-binary'); const sha = createHash('sha256').update(bin).digest('hex');
const f = (latest: string) => (async (url: string | URL, init?: RequestInit) => { const u = String(url); if (u.endsWith('/releases/latest')) return new Response('', { status: 302, headers: { location: `https://github.com/x/y/releases/tag/v${latest}` } }); if (u.endsWith('SHA256SUMS')) return new Response(`${sha}  super-agent-installer-linux-x64\nabc  other\n`); if (u.includes('super-agent-installer-linux-x64')) return new Response(bin); return new Response('nf', { status: 404 }); }) as unknown as typeof fetch;
describe('selfUpdate', () => {
  it('reports current when not newer', async () => { expect(await selfUpdate(makeTestCtx(), '0.2.0', { fetch: f('0.2.0'), execPath: '/opt/sai/super-agent-installer', platform: 'linux', arch: 'x64' })).toMatchObject({ updated: false, message: expect.stringMatching(/current/) }); });
  it('downloads, verifies and replaces the executable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const exe = join(dir, 'super-agent-installer'); writeFileSync(exe, 'old');
    const r = await selfUpdate(makeTestCtx(), '0.1.0', { fetch: f('0.2.0'), execPath: exe, platform: 'linux', arch: 'x64' });
    expect(r.updated).toBe(true); expect(readFileSync(exe, 'utf8')).toBe('new-binary'); expect(existsSync(`${exe}.new`)).toBe(false);
  });
  it('refuses on checksum mismatch', async () => {
    const bad = (async (url: string | URL) => { const u = String(url); if (u.endsWith('/releases/latest')) return new Response('', { status: 302, headers: { location: 'https://github.com/x/y/releases/tag/v0.2.0' } }); if (u.endsWith('SHA256SUMS')) return new Response('0000  super-agent-installer-linux-x64\n'); return new Response(bin); }) as unknown as typeof fetch;
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const exe = join(dir, 'super-agent-installer'); writeFileSync(exe, 'old');
    const r = await selfUpdate(makeTestCtx(), '0.1.0', { fetch: bad, execPath: exe, platform: 'linux', arch: 'x64' }); expect(r.updated).toBe(false); expect(r.message).toMatch(/checksum/); expect(readFileSync(exe, 'utf8')).toBe('old');
  });
  it('does nothing when running from source', async () => { expect((await selfUpdate(makeTestCtx(), '0.1.0', { fetch: f('9.9.9'), execPath: '/usr/bin/bun', platform: 'linux', arch: 'x64' })).message).toMatch(/source/); });
});
