const store = new WeakMap<object, Map<string, Promise<unknown>>>();
/** Per-ctx memo for network lookups (latest versions) so the preview plan and the grouped execution do not fetch twice. */
export function memo<T>(owner: object, key: string, fn: () => Promise<T>): Promise<T> {
  let m = store.get(owner); if (!m) { m = new Map(); store.set(owner, m); }
  let p = m.get(key) as Promise<T> | undefined; if (!p) { p = fn(); m.set(key, p); }
  return p;
}
