const RE = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;
export function normalizeVersion(s: string | null | undefined): string | null { if (!s) return null; const m = RE.exec(s); return m ? m[0] : null; }
function parts(v: string): { nums: number[]; pre: string | null } { const m = RE.exec(v); if (!m) return { nums: [0, 0, 0], pre: null }; return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null }; }
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < 3; i++) { const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0); if (d !== 0) return d < 0 ? -1 : 1; }
  if (pa.pre === pb.pre) return 0; if (pa.pre === null) return 1; if (pb.pre === null) return -1;
  return comparePrerelease(pa.pre, pb.pre);
}
/** SemVer 2.0.0 section 11: dot-separated identifiers, numeric ones compared as numbers and ranking below
 * alphanumeric ones, and the longer set winning when every shared identifier is equal. Plain string order got
 * `alpha.10` < `alpha.2`, which is exactly the shape Codex's prerelease tags take. */
function comparePrerelease(a: string, b: string): -1 | 0 | 1 {
  const as = a.split('.'), bs = b.split('.');
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const x = as[i]!, y = bs[i]!; if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return as.length === bs.length ? 0 : as.length < bs.length ? -1 : 1;
}
export function isNewer(latest: string | null, installed: string | null): boolean {
  if (!latest) return false; if (!installed) return true; return compareVersions(latest, installed) === 1;
}
