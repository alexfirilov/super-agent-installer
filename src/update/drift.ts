import type { Component, Ctx } from '../types.js';
import { getProvider } from '../providers/registry.js';
import { isNewer } from '../version/compare.js';
export interface DriftRow { id: string; name: string; kind: string; installed: string | null; latest: string | null; status: 'ok' | 'outdated' | 'missing' | 'unknown' }
export async function driftReport(ctx: Ctx, components: Component[]): Promise<DriftRow[]> {
  const rows: DriftRow[] = [];
  for (const c of components) {
    const p = getProvider(c.kind); let installed: string | null = null; let present = false;
    let installedDetails: Record<string, unknown> | undefined;
    try { const d = await p.detect(c, ctx); present = !!d; installed = d?.version ?? null; installedDetails = d?.details; } catch { present = false; }
    let latest: string | null = null; if (p.latest) { try { latest = await p.latest(c, ctx); } catch { latest = null; } }
    // components the manifest wants removed or disabled are read the other way round: absent (or disabled) is the wanted state, still-installed (or re-enabled) is the drift
    const want = c.spec.kind === 'claude-plugin' ? c.spec.action ?? 'install' : 'install';
    let status: DriftRow['status'];
    if (want === 'uninstall') status = present ? 'outdated' : 'ok';
    else if (want === 'disable') status = present && (installedDetails?.enabled ?? true) ? 'outdated' : 'ok';
    else status = !present ? 'missing' : p.latest && latest === null ? 'unknown' : isNewer(latest, installed) ? 'outdated' : 'ok';
    rows.push({ id: c.id, name: c.name, kind: c.kind, installed, latest, status });
  }
  return rows;
}
