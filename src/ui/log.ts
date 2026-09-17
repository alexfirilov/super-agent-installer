import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from '../types.js';
export interface LoggerOptions { file?: string; verbose?: boolean; json?: boolean; quiet?: boolean }
export function createLogger(o: LoggerOptions): Logger & { lines: string[] } {
  const lines: string[] = [];
  if (o.file) mkdirSync(dirname(o.file), { recursive: true });
  const emit = (level: string, msg: string, show: boolean) => {
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${msg}`;
    if (o.file) appendFileSync(o.file, line + '\n');
    if (show) { lines.push(line); if (!o.quiet && !o.json) (level === 'ERROR' || level === 'WARN' ? console.error : console.log)(level === 'INFO' ? msg : `${level}: ${msg}`); }
  };
  return { lines, info: (m) => emit('INFO', m, true), warn: (m) => emit('WARN', m, true), error: (m) => emit('ERROR', m, true), debug: (m) => emit('DEBUG', m, !!o.verbose), step: (m) => emit('STEP', m, true) };
}
export function table(rows: string[][], header: string[]): string {
  const all = [header, ...rows]; const w = header.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
  return all.map((r) => r.map((c, i) => c.padEnd(w[i] ?? 0)).join('  ')).join('\n');
}
