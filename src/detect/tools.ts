import { normalizeVersion } from '../version/compare.js';
import type { Runner } from '../types.js';
export async function probeVersion(run: Runner, argv: string[], regex?: string): Promise<string | null> {
  try {
    const r = await run(argv, { readOnly: true, allowFailure: true, timeoutMs: 15000 });
    if (r.code !== 0) return null;
    const text = `${r.stdout}\n${r.stderr}`;
    if (regex) { const m = new RegExp(regex).exec(text); return m ? (m[1] ?? m[0]) : null; }
    // some builds print only major.minor (Debian's `jq-1.7`); without this the tool reads as missing and reinstalls every run
    const short = /\b(\d+)\.(\d+)\b/.exec(text);
    return normalizeVersion(text) ?? (short ? `${short[1]}.${short[2]}.0` : null);
  } catch { return null; }
}
