import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseManifest } from '../../src/manifest/schema.js';
import { resolveSelection, slotConflicts } from '../../src/manifest/resolve.js';
import type { Component, HostInfo } from '../../src/types.js';
import { fillVersions } from '../../src/version/resolve.js';
const m = parseManifest(JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8')));
const host = (platform: HostInfo['platform']) => ({ platform } as HostInfo);
describe('manifest.json', () => {
  const defaults = (platform: HostInfo['platform']) => resolveSelection(m, host(platform), {}).components.map((c) => c.id);
  it('the default selection is the agreed core, with no slot conflicts', () => {
    const s = resolveSelection(m, host('linux'), {});
    expect(slotConflicts(s.components)).toEqual([]);
    expect(s.components.map((c) => c.id)).toEqual(expect.arrayContaining(['claude-code', 'codex-cli', 'playwright-cli', 'cp-superpowers', 'cx-superpowers', 'cp-security-guidance', 'set-security-stop-review', 'cp-frontend-design', 'sk-frontend-design-codex', 'cp-skill-creator', 'cp-typescript-lsp', 'cp-pyright-lsp', 'mcp-context7', 'mcp-cx-context7', 'set-codex-memories', 'instr-global']));
    expect(s.tokenTotals.claude).toBeLessThan(8000); expect(s.codexMcpCount).toBeLessThanOrEqual(5);
  });
  it('optional components stay out of the default selection', () => {
    for (const id of ['uv', 'gopls', 'cp-gopls-lsp', 'ccusage', 'cp-claude-hud', 'cp-commit-commands', 'sk-mattpocock', 'sk-trailofbits', 'sk-hashicorp-terraform', 'sk-docker']) expect(defaults('linux'), id).not.toContain(id);
  });
  it('everything agreed to go is retired, not silently deleted, so hosts that have it can remove it', () => {
    const live = m.components.map((c) => c.id); const retired = (m.retired ?? []).map((c) => c.id);
    for (const id of ['caveman-cli', 'cp-caveman', 'sk-caveman-codex', 'hook-caveman-claude', 'hook-caveman-codex', 'sl-caveman', 'cp-playwright', 'cp-chrome-devtools-mcp', 'cp-github', 'mcp-cx-github', 'mcp-cx-chrome-devtools', 'cp-context7', 'cp-remember', 'cx-remember', 'cp-hookify', 'sk-find-skills', 'sk-powershell-windows', 'sk-cc-devops', 'sk-agent-browser', 'cp-serena', 'happy', 'cp-plugin-dev', 'mcp-proxmox-claude', 'mcp-ha-claude', 'mcp-k8s-claude', 'mcp-tailscale-claude', 'mcp-n8n-claude', 'docker-mcp-gateway']) {
      expect(retired, id).toContain(id); expect(live, id).not.toContain(id);
    }
  });
  it('a retired plugin removes itself; no leftover action turns its uninstall into something else', () => {
    for (const c of m.retired ?? []) if (c.spec.kind === 'claude-plugin') expect(c.spec.action, c.id).toBeUndefined();
  });
  it('capabilities that changed route keep their hosts on the successor', () => {
    const next = (id: string) => (m.retired ?? []).find((c) => c.id === id)?.replacedBy;
    expect(next('cp-context7')).toBe('mcp-context7'); expect(next('cx-superpowers-remote')).toBe('cx-superpowers'); expect(next('sk-mattpocock-core')).toBe('sk-mattpocock');
  });
  it('security-guidance always brings its Stop-review setting, also on a host with a saved selection', () => {
    expect(resolveSelection(m, host('linux'), { savedIds: ['cp-security-guidance'] }).components.map((c) => c.id)).toContain('set-security-stop-review');
  });
  it('the mattpocock wrapper skill ships with the skill it calls', () => {
    const c = m.components.find((x) => x.id === 'sk-mattpocock')!.spec as { skills: string[] };
    expect(c.skills).toEqual(expect.arrayContaining(['grill-me', 'grilling']));
  });
  it('Context7 on Claude uses the URL that works without auth', () => {
    expect((m.components.find((c) => c.id === 'mcp-context7')!.spec as { url: string }).url).toBe('https://mcp.context7.com/mcp');
  });
  it('declares the installer version that understands retirement', () => { expect(m.minInstallerVersion).toBe('0.5.0'); });
  it('Windows gets its git setting and leaves out Linux-only tools', () => {
    const ids = defaults('windows');
    expect(ids).toContain('set-windows-git-symlinks'); expect(ids).not.toContain('bubblewrap');
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

describe('registry versions (Finding 8, then resolved at run time)', () => {
  // Every package installed or launched through a registry names an exact version once its `{{key}}` placeholders
  // are filled: the stable channel fills them with the catalog pins, the latest channel with what the registry has
  // (never below the pin). Either way the agents never launch a floating `@latest`.
  const PIN = /@\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?$|==\d+\.\d+\.\d+$/;
  const pinned = (c: Component): Component => ({ ...c, spec: fillVersions(c.spec, Object.fromEntries(Object.entries(c.versions ?? {}).map(([k, v]) => [k, v.pin]))) });
  const filled = m.components.map(pinned);
  it('every npm-installed tool and go tool names a version', () => {
    for (const c of filled) {
      if (c.spec.kind !== 'tool') continue;
      for (const pkg of (c.spec.packages.npm ?? '').split(/\s+/).filter(Boolean)) expect(pkg, `${c.id}: npm package ${pkg} is not pinned`).toMatch(PIN);
      if (c.spec.packages.go) expect(c.spec.packages.go, `${c.id}: go package is not pinned`).toMatch(/@v\d+\.\d+\.\d+$/);
    }
  });
  it('every npx/uvx-launched MCP server names a version (no @latest)', () => {
    for (const c of filled) {
      if (c.spec.kind !== 'mcp' || !c.spec.command) continue;
      if (!['npx', 'uvx'].includes(c.spec.command)) continue;
      const pkg = (c.spec.args ?? []).find((a) => !a.startsWith('-'));
      expect(pkg, `${c.id}: no package in args`).toBeDefined();
      expect(pkg, `${c.id}: launch package ${pkg} is not pinned`).toMatch(PIN);
      expect(pkg).not.toMatch(/@latest$/);
    }
  });
  it('skill postInstall npm installs name a version', () => {
    for (const c of filled) {
      if (c.spec.kind !== 'skill') continue;
      for (const cmd of c.spec.postInstall ?? []) if (cmd[0] === 'npm' && cmd[1] === 'install') for (const pkg of cmd.slice(2).filter((a) => !a.startsWith('-'))) expect(pkg, `${c.id}: ${pkg} is not pinned`).toMatch(PIN);
    }
  });
  it('registry versions are placeholders, not literals, so the latest channel can move them', () => {
    for (const c of m.components) {
      if (c.spec.kind === 'tool') for (const pkg of [...(c.spec.packages.npm ?? '').split(/\s+/), c.spec.packages.go ?? ''].filter(Boolean)) expect(pkg, c.id).toMatch(/\{\{[a-z-]+\}\}$/);
      if (c.spec.kind === 'mcp' && ['npx', 'uvx'].includes(c.spec.command ?? '')) expect((c.spec.args ?? []).find((a) => !a.startsWith('-')), c.id).toMatch(/\{\{[a-z-]+\}\}$/);
    }
  });
  it('a major-version hold names the major its pin is on', () => {
    for (const c of m.components) for (const [k, v] of Object.entries(c.versions ?? {})) if (v.major !== undefined) expect(Number(v.pin.split('.')[0]), `${c.id}.${k}`).toBe(v.major);
  });
});

describe('MCP server names', () => {
  it('never carry a version: a name is the identity agents and permission rules key on, and a bump must not orphan the old entry', () => {
    // v0.4.0's pinning pass rewrote mcp-n8n-claude's name to `n8n-mcp@2.87.0` along with its args
    for (const c of m.components) if (c.spec.kind === 'mcp') expect(c.spec.name, c.id).toMatch(/^[a-z0-9][a-z0-9_-]*$/i);
  });
});
