/** Returns the last line of `stdout` that parses as JSON (starting with `{` or `[`), scanning backwards; `null` if none does. */
export function lastJsonLine(stdout: string): unknown | null {
  const lines = stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith('{') && !line.startsWith('[')) continue;
    try { return JSON.parse(line); } catch { continue; }
  }
  return null;
}
