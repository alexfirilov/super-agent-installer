/**
 * Parses CLI JSON output that may be either a single (possibly pretty-printed,
 * multi-line) JSON value with no surrounding noise, or NDJSON-style output with
 * one JSON value per line and optional noise lines around it (in which case the
 * last line that parses as JSON, scanning backwards, wins). Returns `null` if
 * neither works.
 */
export function lastJsonLine(stdout: string): unknown | null {
  const trimmed = stdout.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { /* fall through to line scan */ }
  }
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith('{') && !line.startsWith('[')) continue;
    try { return JSON.parse(line); } catch { continue; }
  }
  return null;
}
