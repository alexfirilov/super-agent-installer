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
  it('throws when the executable is missing', async () => {
    const run = createRunner({ dryRun: false, log: createLogger({}) });
    await expect(run(['sai-definitely-not-a-real-binary'])).rejects.toThrow(/failed to start/);
  });
  it('resolves instead of throwing when the executable is missing and allowFailure is set', async () => {
    const run = createRunner({ dryRun: false, log: createLogger({}) });
    const r = await run(['sai-definitely-not-a-real-binary'], { allowFailure: true });
    expect(r).toMatchObject({ code: -1, stdout: '', stderr: '', skipped: false });
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
  it('stops a command once its output matches stopOnOutput and reports stopped instead of timing out', async () => {
    const run = createRunner({ dryRun: false, log: createLogger({}) });
    const t0 = Date.now();
    const r = await run([node, '-e', 'process.stdout.write("Added server.\\nDetected OAuth support. Starting OAuth flow\\n"); setTimeout(()=>{},10000)'], { timeoutMs: 8000, stopOnOutput: /Detected OAuth support/ });
    expect(r).toMatchObject({ code: 0, skipped: false, stopped: true });
    expect(r.stdout).toContain('Added server.');
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it('does not set stopped when stopOnOutput never matches', async () => {
    const run = createRunner({ dryRun: false, log: createLogger({}) });
    const r = await run([node, '-e', 'process.stdout.write("done")'], { stopOnOutput: /never/ });
    expect(r).toMatchObject({ code: 0, stdout: 'done' }); expect(r.stopped).toBeFalsy();
  });
  it('quotes argv for display', () => { expect(quoteArgv(['a', 'b c', "d'e"])).toBe(`a 'b c' 'd'\\''e'`); });
  it('interactive mode inherits the terminal: ignores piped input and captures no output', async () => {
    const run = createRunner({ dryRun: false, log: createLogger({}) });
    const r = await run([node, '-e', 'let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{process.stdout.write(d); process.exit(0)}); setTimeout(()=>process.exit(0),200);'], { interactive: true, input: 'hello', timeoutMs: 5000 });
    expect(r).toMatchObject({ code: 0, stdout: '', stderr: '', skipped: false });
  });
  it('skips an interactive command in dry-run unless readOnly', async () => {
    const run = createRunner({ dryRun: true, log: createLogger({}) });
    const skipped = await run([node, '-e', 'process.exit(0)'], { interactive: true });
    expect(skipped).toMatchObject({ code: 0, stdout: '', stderr: '', skipped: true });
    const ran = await run([node, '-e', 'process.exit(0)'], { interactive: true, readOnly: true });
    expect(ran).toMatchObject({ code: 0, stdout: '', stderr: '', skipped: false });
  });
});
