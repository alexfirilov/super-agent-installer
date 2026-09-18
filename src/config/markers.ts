/** `hash` is the shared shell/TOML block. `hashSecrets` is a SEPARATE style on purpose: `install.sh` writes its
 * `export PATH=` bootstrap into the very same rc files with the `hash` markers, and `setMarkerBlock` replaces a
 * block's body -- reusing `hash` for the secrets source line would delete the PATH line the bootstrap just wrote.
 * Neither marker text may change: both are already on real hosts and `uninstall`/`install.sh` look them up verbatim. */
export const MARKER_STYLES = { hash: { start: '# >>> super-agent-installer >>>', end: '# <<< super-agent-installer <<<' }, hashSecrets: { start: '# >>> super-agent-installer secrets >>>', end: '# <<< super-agent-installer secrets <<<' }, hashPath: { start: '# >>> super-agent-installer path >>>', end: '# <<< super-agent-installer path <<<' }, html: { start: '<!-- super-agent-installer:start -->', end: '<!-- super-agent-installer:end -->' } } as const;
export type MarkerStyle = keyof typeof MARKER_STYLES;
export class MarkerError extends Error {}

function locate(lines: string[], style: MarkerStyle): { s: number; e: number } | null {
  const { start, end } = MARKER_STYLES[style];
  const s = lines.indexOf(start);
  const e = lines.indexOf(end);
  if (s === -1 && e === -1) return null;
  if (s === -1 || e === -1 || e < s) throw new MarkerError(`half or misordered marker block (${start} / ${end}); fix the file manually`);
  if (lines.indexOf(start, s + 1) !== -1 || lines.indexOf(end, e + 1) !== -1) throw new MarkerError('more than one marker block found; fix the file manually');
  return { s, e };
}

export function setMarkerBlock(text: string, block: string, style: MarkerStyle): string {
  const { start, end } = MARKER_STYLES[style];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const body = [start, ...block.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'), end];
  const loc = locate(lines, style);
  const out = loc ? [...lines.slice(0, loc.s), ...body, ...lines.slice(loc.e + 1)] : [...lines, ...(lines.length ? [''] : []), ...body];
  return out.join('\n') + '\n';
}

export function removeMarkerBlock(text: string, style: MarkerStyle): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const loc = locate(lines, style);
  if (!loc) return lines.join('\n') + (lines.length ? '\n' : '');
  let { s, e } = loc;
  if (s > 0 && lines[s - 1] === '') s--; else if (lines[e + 1] === '') e++; // also drop the blank separator line we inserted (before the block, or after it when the block leads the file)
  const out = [...lines.slice(0, s), ...lines.slice(e + 1)];
  return out.join('\n') + (out.length ? '\n' : '');
}

/** The text between the markers (without them), or null when there is no block. */
export function extractMarkerBlock(text: string, style: MarkerStyle): string | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const loc = locate(lines, style);
  return loc ? lines.slice(loc.s + 1, loc.e).join('\n') : null;
}
