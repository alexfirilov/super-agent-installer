import type { Component, HostInfo, Manifest, Selection, Slot } from '../types.js';

export interface ResolveOpts { savedIds?: string[]; only?: string[]; skip?: string[]; picked?: string[] }

export function closure(manifest: Manifest, ids: string[]): string[] {
  const byId = new Map(manifest.components.map((c) => [c.id, c]));
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const c = byId.get(id);
    if (!c) return;
    for (const d of [...(c.prerequisites ?? []), ...(c.dependsOn ?? [])]) visit(d);
    out.push(id);
  };
  for (const id of ids) visit(id);
  return out;
}

export function slotConflicts(components: Component[]): Array<{ slot: Slot; ids: string[] }> {
  const m = new Map<Slot, string[]>();
  for (const c of components) if (c.slot) m.set(c.slot, [...(m.get(c.slot) ?? []), c.id]);
  return [...m.entries()].filter(([, ids]) => ids.length > 1).map(([slot, ids]) => ({ slot, ids }));
}

export function resolveSelection(manifest: Manifest, host: HostInfo, o: ResolveOpts): Selection {
  const byId = new Map(manifest.components.map((c) => [c.id, c]));
  const excluded: Selection['excluded'] = [];
  const order = manifest.components.map((c) => c.id);
  let ids: string[];

  if (o.picked) {
    ids = [...o.picked];
  } else if (o.savedIds) {
    // a retired id carries its host to the successor; one with no successor just leaves the selection
    const successor = new Map((manifest.retired ?? []).map((r) => [r.id, r.replacedBy]));
    ids = [...new Set(o.savedIds.flatMap((id) => { const next = byId.has(id) ? id : successor.get(id); return next ? [next] : []; }))];
  } else {
    ids = order.filter((id) => byId.get(id)!.defaultSelected);
  }

  if (o.only) ids = o.only.filter((id) => byId.has(id));
  if (o.skip) ids = ids.filter((id) => !o.skip!.includes(id));

  ids = closure(manifest, ids);

  const keep: string[] = [];
  for (const id of ids) {
    const c = byId.get(id);
    if (!c) continue;
    if (!c.platforms.includes(host.platform)) { excluded.push({ id, reason: 'platform' }); continue; }
    keep.push(id);
  }

  const final: string[] = [];
  for (const id of keep) {
    const c = byId.get(id)!;
    const winner = (c.conflictsWith ?? []).find((x) => final.includes(x));
    if (winner) { excluded.push({ id, reason: `conflict:${winner}` }); continue; }
    final.push(id);
  }

  const slotSeen = new Map<Slot, string>();
  const afterSlots: string[] = [];
  for (const id of final) {
    const c = byId.get(id)!;
    if (c.slot) {
      const w = slotSeen.get(c.slot);
      if (w) { excluded.push({ id, reason: `slot:${c.slot}` }); continue; }
      slotSeen.set(c.slot, id);
    }
    afterSlots.push(id);
  }

  const survivors = new Set(afterSlots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of survivors) {
      const c = byId.get(id)!;
      const missing = [...(c.prerequisites ?? []), ...(c.dependsOn ?? [])].find((d) => !survivors.has(d));
      if (missing) {
        survivors.delete(id);
        excluded.push({ id, reason: `dependency:${missing}` });
        changed = true;
      }
    }
  }
  const survivorIds = afterSlots.filter((id) => survivors.has(id));
  const ordered = closure(manifest, survivorIds);
  const components = ordered.map((id) => byId.get(id)!).filter((c) => c.platforms.includes(host.platform));

  const tok = { claude: 0, codex: 0 };
  for (const c of components) {
    if (c.agents !== 'codex') tok.claude += c.contextCostTokens?.claude ?? 0;
    if (c.agents !== 'claude') tok.codex += c.contextCostTokens?.codex ?? 0;
  }

  return {
    components,
    excluded,
    tokenTotals: tok,
    codexMcpCount: components.filter((c) => c.kind === 'mcp' && c.spec.kind === 'mcp' && c.spec.target === 'codex').length,
  };
}
