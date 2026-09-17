const RE = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;
export function normalizeVersion(s: string | null | undefined): string | null { if (!s) return null; const m = RE.exec(s); return m ? m[0] : null; }
function parts(v: string): { nums: number[]; pre: string | null } { const m = RE.exec(v); if (!m) return { nums: [0, 0, 0], pre: null }; return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null }; }
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < 3; i++) { const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0); if (d !== 0) return d < 0 ? -1 : 1; }
  if (pa.pre === pb.pre) return 0; if (pa.pre === null) return 1; if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
}
export function isNewer(latest: string | null, installed: string | null): boolean {
  if (!latest) return false; if (!installed) return true; return compareVersions(latest, installed) === 1;
}
