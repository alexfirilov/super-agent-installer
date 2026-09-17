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
  it('parses pretty-printed multi-line JSON with no surrounding noise (claude plugin list --json)', () => {
    const out = '[\n  {\n    "id": "caveman@caveman",\n    "version": "15581d14007f"\n  }\n]\n';
    expect(lastJsonLine(out)).toEqual([{ id: 'caveman@caveman', version: '15581d14007f' }]);
  });
  it('parses an empty JSON array', () => {
    expect(lastJsonLine('[]\n')).toEqual([]);
  });
});
