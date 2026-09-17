import { describe, it, expect } from 'vitest';
import { renderList } from '../../src/commands/list.js';
import type { Manifest } from '../../src/types.js';
const m: Manifest = { version: 1, profiles: {}, components: [{ id: 'a', name: 'A', kind: 'claude-plugin', agents: 'claude', platforms: ['linux'], description: 'd', verdict: 'must-have', defaultSelected: true, contextCostTokens: { claude: 100 }, spec: { kind: 'claude-plugin', marketplace: 'm', plugin: 'a' } }, { id: 'w', name: 'W', kind: 'tool', agents: 'both', platforms: ['windows'], description: '', verdict: 'optional', defaultSelected: false, spec: { kind: 'tool', probe: ['w'], packages: {} } }] };
describe('renderList', () => {
  it('lists platform components with selection marks', () => {
    const out = renderList(m, 'linux', ['a']);
    expect(out).toContain('a'); expect(out).toContain('must-have'); expect(out).toContain('100'); expect(out).toContain('[selected]'); expect(out).not.toContain('W');
  });
});
