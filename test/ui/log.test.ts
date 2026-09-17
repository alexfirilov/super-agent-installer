import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger, table } from '../../src/ui/log.js';
describe('logger', () => {
  it('writes to file and keeps lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-')); const file = join(dir, 'x.log');
    const log = createLogger({ file });
    log.info('hello'); log.warn('careful'); log.debug('hidden');
    expect(log.lines).toEqual(expect.arrayContaining([expect.stringContaining('hello'), expect.stringContaining('careful')]));
    expect(readFileSync(file, 'utf8')).toContain('hidden');
  });
  it('renders a table with padded columns', () => {
    const t = table([['a', 'bbb'], ['cc', 'd']], ['H1', 'H2']);
    expect(t.split('\n')[0]).toBe('H1  H2 ');
    expect(t.split('\n')[1]).toBe('a   bbb');
  });
});
