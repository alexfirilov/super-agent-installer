import { describe, it, expect } from 'vitest';
import { lastJsonLine } from '../../src/exec/json-output.js';

describe('lastJsonLine', () => {
  it('picks the last of several JSON lines', () => {
    const out = '{"a":1}\n{"a":2}\n{"a":3}';
    expect(lastJsonLine(out)).toEqual({ a: 3 });
  });
  it('ignores noise lines around the JSON', () => {
    const out = 'Checking for updates...\nDownloading...\n{"outcome":"ok"}\n';
    expect(lastJsonLine(out)).toEqual({ outcome: 'ok' });
  });
  it('returns null when there is no JSON', () => {
    const out = 'nothing to see here\njust plain text';
    expect(lastJsonLine(out)).toBeNull();
  });
});
