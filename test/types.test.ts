import { describe, it, expect } from 'vitest';
import type { Component, Manifest } from '../src/types.js';
import { KINDS, SLOTS, PROFILE_NAMES } from '../src/types.js';

describe('types', () => {
  it('exports kind, slot and profile constants', () => {
    expect(KINDS).toContain('claude-plugin');
    expect(SLOTS).toContain('statusline');
    expect(PROFILE_NAMES).toEqual(['all', 'minimal', 'claude-only', 'codex-only', 'work', 'homelab', 'proxmox-host']);
  });
  it('accepts a minimal component literal', () => {
    const c: Component = {
      id: 'cp-superpowers', name: 'superpowers', kind: 'claude-plugin', agents: 'claude',
      platforms: ['linux', 'windows', 'darwin'], description: 'x', verdict: 'must-have',
      defaultSelected: true, spec: { kind: 'claude-plugin', marketplace: 'claude-plugins-official', plugin: 'superpowers' },
    };
    const m: Manifest = { version: 1, profiles: {}, components: [c] };
    expect(m.components[0]?.id).toBe('cp-superpowers');
  });
});
