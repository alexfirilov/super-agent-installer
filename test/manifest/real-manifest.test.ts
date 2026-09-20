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
    expect(Object.keys(m.profiles).sort()).toEqual(['all', 'claude-only', 'codex-only', 'devops', 'homelab', 'minimal', 'proxmox-host', 'work']);
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
  it('devops is the operations preset: core agents and skills, no browser tooling, no LSPs, no infrastructure MCPs', () => {
    const lin = resolveSelection(m, host('linux'), { profile: 'devops' }); const ids = lin.components.map((c) => c.id);
    for (const id of ['claude-code', 'codex-cli', 'git', 'jq', 'ripgrep', 'gh', 'cp-superpowers', 'cp-caveman', 'cp-context7', 'cp-security-guidance', 'sk-cc-devops', 'sk-linux-admin', 'mcp-cx-context7', 'instr-global']) expect(ids, id).toContain(id);
    for (const id of ['cp-playwright', 'cp-chrome-devtools-mcp', 'cp-typescript-lsp', 'cp-pyright-lsp', 'cp-gopls-lsp', 'cp-frontend-design', 'mcp-proxmox-claude', 'mcp-ha-claude', 'mcp-k8s-claude', 'mcp-tailscale-claude', 'sk-powershell-windows']) expect(ids, id).not.toContain(id);
    expect(lin.tokenTotals.claude).toBeLessThan(8000); expect(lin.codexMcpCount).toBeLessThanOrEqual(5);
    const win = resolveSelection(m, host('windows'), { profile: 'devops' }).components.map((c) => c.id);
    expect(win).toContain('sk-powershell-windows'); expect(win).toContain('set-windows-git-symlinks'); expect(win).not.toContain('sk-linux-admin');
  });
  it('proxmox-host is lean and headless', () => {
    const s = resolveSelection(m, host('linux'), { profile: 'proxmox-host' }); const ids = s.components.map((c) => c.id);
    expect(ids).toContain('set-claude-headless-seed'); expect(ids).toContain('set-codex-trust-home'); expect(ids).not.toContain('cp-playwright'); expect(ids).not.toContain('cp-chrome-devtools-mcp'); expect(ids).not.toContain('cp-typescript-lsp');
  });
  it('windows default tool set installs admin-free via scoop (Task 6: zero UAC)', () => {
    for (const id of ['jq', 'ripgrep', 'gh', 'go', 'uv', 'powershell-7']) {
      const c = m.components.find((x) => x.id === id)!;
      expect(c.spec.kind, id).toBe('tool');
      expect((c.spec as { packages: { scoop?: string } }).packages.scoop, id).toBeTruthy();
    }
  });
  // D5: a hint whose first token is an executable is work we could have done. Allow-list shaped on purpose -- the old
  // three-prefix denylist let `claude mcp login homeassistant` through.
  it('no postInstallHint starts with a command we could run instead (it belongs in postInstall)', () => {
    const EXECUTABLES = /^(npm|npx|node|curl|wget|sh|bash|pwsh|powershell|setx|export|claude|codex|scoop|winget|choco|brew|apt-get|gh|go|uv|uvx|pip|pipx|fnm|git)\b/;
    for (const c of m.components) if (c.postInstallHint) expect(c.postInstallHint, c.id).not.toMatch(EXECUTABLES);
  });
  it('the Home Assistant MCP logins run as spec postInstall actions, not as hints', () => {
    for (const id of ['mcp-ha-claude', 'mcp-ha-codex']) {
      const c = m.components.find((x) => x.id === id)!;
      expect(c.postInstallHint, id).toBeUndefined();
      expect(c.spec.kind, id).toBe('mcp');
      expect((c.spec as { postInstall?: string[][] }).postInstall, id).toEqual([[id.endsWith('codex') ? 'codex' : 'claude', 'mcp', 'login', 'homeassistant']]);
    }
  });
  it('sk-agent-browser installs its CLI as postInstall, not a hint', () => {
    const c = m.components.find((x) => x.id === 'sk-agent-browser')!;
    expect(c.postInstallHint).toBeUndefined();
    expect(c.spec.kind).toBe('skill');
    expect((c.spec as { postInstall?: string[][] }).postInstall).toEqual([['npm', 'install', '-g', 'agent-browser@0.38.1'], ['agent-browser', 'install']]);
  });
  it('every skill component has audit entries (also skills: "*" ones)', () => {
    for (const c of m.components) if (c.spec.kind === 'skill') { expect(c.audit?.length, c.id).toBeGreaterThan(0); for (const a of c.audit ?? []) expect(`${a.owner}/${a.repo}`, c.id).toBe(c.spec.repo.replace(/^https:\/\/github\.com\//, '')); }
  });
});

describe('downloaded binaries are verified', () => {
  it('every script route that fetches a release archive checks a checksum before installing it', async () => {
    // installNodeFromTarball verifies its nodejs.org download; the rg/gh script routes added for Rocky 9 did not,
    // so a tampered or truncated release landed straight on a PATH-prepended dir as mode 0755.
    const m = parseManifest(JSON.parse(readFileSync('manifest.json', 'utf8')));
    for (const c of m.components) {
      const script = c.spec.kind === 'tool' ? c.spec.packages.script?.linux : undefined;
      if (!script || !/curl|wget/.test(script) || !/install -m|tar -x/.test(script)) continue;
      expect(script, `${c.id} downloads and installs without verifying a checksum`).toMatch(/sha256sum/);
    }
  });
});

describe('conflicts are declared on both sides', () => {
  it('every conflictsWith has a matching entry on the other component', () => {
    // resolveSelection's conflict check walks the selection in order, so a one-sided declaration only fires when
    // the components happen to be visited in the right order -- `--only cp-obsidian,sk-obsidian` installed both.
    const byId = new Map(m.components.map((c) => [c.id, c]));
    for (const c of m.components) {
      for (const other of c.conflictsWith ?? []) {
        const o = byId.get(other);
        expect(o, `${c.id} conflicts with unknown id ${other}`).toBeDefined();
        expect(o!.conflictsWith ?? [], `${other} does not declare its conflict with ${c.id}`).toContain(c.id);
      }
    }
  });
});

describe('npx-based MCP servers', () => {
  it('always pass -y, so a first run cannot stall on npx asking to install', () => {
    // mcp-n8n-claude was the only one missing it: on a host without the package cached, npx prompts and the
    // server never starts.
    for (const c of m.components) {
      if (c.spec.kind !== 'mcp' || c.spec.command !== 'npx') continue;
      expect(c.spec.args ?? [], `${c.id} runs npx without -y`).toContain('-y');
    }
  });
});

describe('pinned component versions (Finding 8)', () => {
  // A given installer release installs a known set of versions. Anything the agents launch or we install through
  // a package registry carries an explicit version; `update` moves to the pin, and a new release moves the pin.
  const PIN = /@\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?$|==\d+\.\d+\.\d+$/;
  it('every npm-installed tool and go tool names a version', () => {
    for (const c of m.components) {
      if (c.spec.kind !== 'tool') continue;
      for (const pkg of (c.spec.packages.npm ?? '').split(/\s+/).filter(Boolean)) expect(pkg, `${c.id}: npm package ${pkg} is not pinned`).toMatch(PIN);
      if (c.spec.packages.go) expect(c.spec.packages.go, `${c.id}: go package is not pinned`).toMatch(/@v\d+\.\d+\.\d+$/);
    }
  });
  it('every npx/uvx-launched MCP server names a version (no @latest)', () => {
    for (const c of m.components) {
      if (c.spec.kind !== 'mcp' || !c.spec.command) continue;
      if (!['npx', 'uvx'].includes(c.spec.command)) continue;
      const pkg = (c.spec.args ?? []).find((a) => !a.startsWith('-'));
      expect(pkg, `${c.id}: no package in args`).toBeDefined();
      expect(pkg, `${c.id}: launch package ${pkg} is not pinned`).toMatch(PIN);
      expect(pkg).not.toMatch(/@latest$/);
    }
  });
  it('skill postInstall npm installs name a version', () => {
    for (const c of m.components) {
      if (c.spec.kind !== 'skill') continue;
      for (const cmd of c.spec.postInstall ?? []) if (cmd[0] === 'npm' && cmd[1] === 'install') for (const pkg of cmd.slice(2).filter((a) => !a.startsWith('-'))) expect(pkg, `${c.id}: ${pkg} is not pinned`).toMatch(PIN);
    }
  });
});
