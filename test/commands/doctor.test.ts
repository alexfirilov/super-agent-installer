import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { runDoctor } from '../../src/commands/doctor.js';
import { makeTestCtx } from '../helpers/ctx.js';

describe('runDoctor and ANTHROPIC_BASE_URL', () => {
  // 2026-09-19: a caveman gateway route left in settings.json pointed every request at 127.0.0.1:8787 with nothing
  // listening; Claude Code was unreachable and nothing said why. doctor must name it.
  const capture = () => { const out: string[] = []; const orig = console.log; console.log = (...a: unknown[]) => { out.push(a.join(' ')); }; return { out, restore: () => { console.log = orig; } }; };

  it('flags a base URL routed to a local proxy that is not listening, and exits non-zero', async () => {
    const ctx = makeTestCtx(); mkdirSync(ctx.paths.claudeConfigDir, { recursive: true });
    writeFileSync(ctx.paths.claudeSettings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1/w/claude' } })); // port 1: nothing listens
    const c = capture();
    try {
      const code = await runDoctor(ctx);
      expect(code).toBe(2);
      const text = c.out.join('\n');
      expect(text).toMatch(/ANTHROPIC_BASE_URL/);
      expect(text).toMatch(/127\.0\.0\.1:1/);
      expect(text).toMatch(/not (listening|reachable)/i);
    } finally { c.restore(); }
  });

  it('reports a settings.json that is not valid JSON instead of crashing, and exits 2', async () => {
    const ctx = makeTestCtx(); mkdirSync(ctx.paths.claudeConfigDir, { recursive: true });
    writeFileSync(ctx.paths.claudeSettings, '{ "env": { broken');
    const c = capture();
    try {
      expect(await runDoctor(ctx)).toBe(2);
      expect(c.out.join('\n')).toMatch(/settings\.json.*not valid JSON/);
    } finally { c.restore(); }
  });
  it('stays quiet when no base URL override is set', async () => {
    const ctx = makeTestCtx(); mkdirSync(ctx.paths.claudeConfigDir, { recursive: true });
    writeFileSync(ctx.paths.claudeSettings, JSON.stringify({ env: {} }));
    const c = capture();
    try {
      const code = await runDoctor(ctx);
      expect(code).toBe(0);
      expect(c.out.join('\n')).not.toMatch(/ANTHROPIC_BASE_URL/);
    } finally { c.restore(); }
  });
});
