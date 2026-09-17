import { describe, it, expect } from 'vitest';
import { createRunner, quoteArgv } from '../../src/exec/run.js';
import { createLogger } from '../../src/ui/log.js';
const node = process.execPath;
describe('runner', () => {
  it('captures stdout, stderr and exit code', async () => {
    const run = createRunner({ dryRun: false, log: createLogger({}) });
    const r = await run([node, '-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'], { allowFailure: true });
    expect(r).toMatchObject({ code: 3, stdout: 'out', stderr: 'err', skipped: false });
  });
  it('throws on non-zero exit unless allowFailure', async () => {
    const run = createRunner({ dryRun: false, log: createLogger({}) });
    await expect(run([node, '-e', 'process.exit(2)'])).rejects.toThrow(/exit 2/);
  });
  it('skips mutating commands in dry-run but runs readOnly ones', async () => {
    const log = createLogger({});
    const run = createRunner({ dryRun: true, log });
    const skipped = await run([node, '-e', 'process.stdout.write("x")']);
    expect(skipped).toMatchObject({ code: 0, stdout: '', skipped: true });
    const ran = await run([node, '-e', 'process.stdout.write("x")'], { readOnly: true });
    expect(ran.stdout).toBe('x');
    expect(log.lines.some((l) => l.includes('[dry-run]'))).toBe(true);
  });
  it('passes stdin input and env', async () => {
    const run = createRunner({ dryRun: false, log: createLogger({}) });
    const r = await run([node, '-e', 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(d+process.env.SAI_T))'], { input: 'hi', env: { SAI_T: '!' } });
    expect(r.stdout).toBe('hi!');
  });
  it('times out', async () => {
    const run = createRunner({ dryRun: false, log: createLogger({}) });
    await expect(run([node, '-e', 'setTimeout(()=>{},5000)'], { timeoutMs: 200 })).rejects.toThrow(/timed out/);
  });
  it('quotes argv for display', () => { expect(quoteArgv(['a', 'b c', "d'e"])).toBe(`a 'b c' 'd'\\''e'`); });
});
