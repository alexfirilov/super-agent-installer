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
      let stdout = '', stderr = '', done = false;
      const timer = opts.timeoutMs ? setTimeout(() => { if (!done) { child.kill(); reject(new RunError(`command timed out after ${opts.timeoutMs}ms: ${shown}`, { code: -1, stdout, stderr, skipped: false })); } }, opts.timeoutMs) : null;
      child.stdout.on('data', (d) => (stdout += d)); child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (e) => { done = true; if (timer) clearTimeout(timer); reject(new RunError(`failed to start ${shown}: ${e.message}`, { code: -1, stdout, stderr, skipped: false })); });
      child.on('close', (code) => {
        done = true; if (timer) clearTimeout(timer);
        const result: RunResult = { code: code ?? -1, stdout, stderr, skipped: false };
        if (result.code !== 0 && !opts.allowFailure) reject(new RunError(`${shown} failed with exit ${result.code}: ${stderr.trim().split('\n').pop() ?? ''}`, result)); else resolve(result);
      });
      if (opts.input !== undefined) child.stdin.write(opts.input); child.stdin.end();
    });
  };
}
