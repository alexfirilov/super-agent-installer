import { spawn } from 'node:child_process';
import type { Logger, Runner, RunOptions, RunResult } from '../types.js';
export function quoteArgv(argv: string[]): string { return argv.map((a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' '); }
export class RunError extends Error { constructor(msg: string, public result: RunResult) { super(msg); } }
export function createRunner(o: { dryRun: boolean; log: Logger; env?: Record<string, string | undefined> }): Runner {
  return async (argv: string[], opts: RunOptions = {}): Promise<RunResult> => {
    const shown = quoteArgv(argv);
    if (o.dryRun && !opts.readOnly) { o.log.info(`[dry-run] ${shown}`); return { code: 0, stdout: '', stderr: '', skipped: true }; }
    o.log.debug(`$ ${shown}`);
    const [cmd, ...args] = argv; if (!cmd) throw new Error('empty argv');
    return await new Promise<RunResult>((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...o.env, ...opts.env }, shell: opts.shell ?? false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '', stderr = '', done = false, stopped = false;
      const check = () => { if (!stopped && !done && opts.stopOnOutput?.test(stdout + stderr)) { stopped = true; o.log.debug(`stopping ${shown}: output matched ${opts.stopOnOutput}`); child.kill(); setTimeout(() => { if (!done) child.kill('SIGKILL'); }, 2000).unref(); } };
      const timer = opts.timeoutMs ? setTimeout(() => { if (!done) { child.kill(); reject(new RunError(`command timed out after ${opts.timeoutMs}ms: ${shown}`, { code: -1, stdout, stderr, skipped: false })); } }, opts.timeoutMs) : null;
      child.stdout.on('data', (d) => { stdout += d; check(); }); child.stderr.on('data', (d) => { stderr += d; check(); });
      child.on('error', (e) => {
        done = true; if (timer) clearTimeout(timer);
        const result: RunResult = { code: -1, stdout, stderr, skipped: false };
        const msg = `failed to start ${shown}: ${e.message}`;
        if (opts.allowFailure) { o.log.debug(msg); resolve(result); } else { reject(new RunError(msg, result)); }
      });
      child.on('close', (code) => {
        done = true; if (timer) clearTimeout(timer);
        if (stopped) { resolve({ code: 0, stdout, stderr, skipped: false, stopped: true }); return; }
        const result: RunResult = { code: code ?? -1, stdout, stderr, skipped: false };
        if (result.code !== 0 && !opts.allowFailure) reject(new RunError(`${shown} failed with exit ${result.code}: ${stderr.trim().split('\n').pop() ?? ''}`, result)); else resolve(result);
      });
      if (opts.input !== undefined) child.stdin.write(opts.input); child.stdin.end();
    });
  };
}
