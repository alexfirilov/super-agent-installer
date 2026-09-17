import { normalizeVersion } from '../version/compare.js';
import type { Runner } from '../types.js';
export async function probeVersion(run: Runner, argv: string[], regex?: string): Promise<string | null> {
  try {
    const r = await run(argv, { readOnly: true, allowFailure: true, timeoutMs: 15000 });
    if (r.code !== 0) return null;
    const text = `${r.stdout}\n${r.stderr}`;
    if (regex) { const m = new RegExp(regex).exec(text); return m ? (m[1] ?? m[0]) : null; }
    return normalizeVersion(text);
  } catch { return null; }
}
