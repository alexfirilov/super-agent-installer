import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseManifest } from '../../src/manifest/schema.js';
import { resolveSelection, slotConflicts } from '../../src/manifest/resolve.js';
import type { HostInfo } from '../../src/types.js';
const m = parseManifest(JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8')));
const host = (platform: HostInfo['platform']) => ({ platform } as HostInfo);
describe('manifest.json', () => {
  it('validates and contains the approved core', () => {
    const ids = m.components.map((c) => c.id);
    for (const id of ['claude-code', 'codex-cli', 'node', 'git', 'uv', 'caveman-cli', 'playwright-cli', 'typescript-language-server', 'pyright', 'gopls', 'cp-superpowers', 'cp-caveman', 'cp-security-guidance', 'cp-context7', 'cp-commit-commands', 'cp-typescript-lsp', 'cp-pyright-lsp', 'cp-gopls-lsp', 'cp-frontend-design', 'cp-skill-creator', 'cp-feature-dev', 'cp-claude-md-management', 'cp-github', 'cp-chrome-devtools-mcp', 'cp-hookify', 'cp-playwright', 'cp-remember', 'cp-plugin-dev', 'cp-pr-review-toolkit', 'cp-code-review', 'cp-code-simplifier', 'cp-ralph-loop', 'cp-claude-code-setup', 'sk-find-skills', 'sk-caveman-codex', 'sk-cc-devops', 'sk-linux-admin', 'sk-powershell-windows', 'mcp-cx-context7', 'mcp-cx-exa', 'hook-caveman-claude', 'hook-caveman-codex', 'sl-caveman', 'sl-claude-hud', 'instr-global', 'set-codex-memories', 'set-windows-git-symlinks', 'ccusage', 'happy', 'agent-notifications', 'cx-remember']) expect(ids, id).toContain(id);
    expect(Object.keys(m.profiles).sort()).toEqual(['all', 'claude-only', 'codex-only', 'homelab', 'minimal', 'proxmox-host', 'work']);
  });
  it('profile all on linux has no slot conflicts, respects forceOff, stays under the token warning', () => {
    const s = resolveSelection(m, host('linux'), { profile: 'all' });
    expect(slotConflicts(s.components)).toEqual([]);
    expect(s.components.map((c) => c.id)).not.toContain('hook-caveman-codex');
    expect(s.components.map((c) => c.id)).toEqual(expect.arrayContaining(['claude-code', 'codex-cli', 'cp-superpowers', 'cp-caveman', 'cp-github', 'cp-chrome-devtools-mcp', 'cp-hookify', 'sk-cc-devops', 'sk-linux-admin', 'mcp-cx-context7', 'mcp-cx-exa', 'sl-caveman', 'hook-caveman-claude', 'instr-global']));
    expect(s.tokenTotals.claude).toBeLessThan(8000); expect(s.codexMcpCount).toBeLessThanOrEqual(5);
    const allIds = s.components.map((c) => c.id);
    for (const id of ['ccusage', 'happy', 'agent-notifications', 'cx-remember']) expect(allIds, id).not.toContain(id);
  });
  it('windows all includes powershell skill and excludes linux-only items', () => {
    const s = resolveSelection(m, host('windows'), { profile: 'all' }); const ids = s.components.map((c) => c.id);
    expect(ids).toContain('sk-powershell-windows'); expect(ids).toContain('set-windows-git-symlinks'); expect(ids).not.toContain('sk-linux-admin'); expect(ids).not.toContain('bubblewrap');
  });
  it('proxmox-host is lean and headless', () => {
    const s = resolveSelection(m, host('linux'), { profile: 'proxmox-host' }); const ids = s.components.map((c) => c.id);
    expect(ids).toContain('set-claude-headless-seed'); expect(ids).toContain('set-codex-trust-home'); expect(ids).not.toContain('cp-playwright'); expect(ids).not.toContain('cp-chrome-devtools-mcp'); expect(ids).not.toContain('cp-typescript-lsp');
  });
  it('every skill component has audit entries (also skills: "*" ones)', () => {
    for (const c of m.components) if (c.spec.kind === 'skill') { expect(c.audit?.length, c.id).toBeGreaterThan(0); for (const a of c.audit ?? []) expect(`${a.owner}/${a.repo}`, c.id).toBe(c.spec.repo.replace(/^https:\/\/github\.com\//, '')); }
  });
});
