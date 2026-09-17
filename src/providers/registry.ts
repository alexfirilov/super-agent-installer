import type { Kind, Provider } from '../types.js';

const providers = new Map<Kind, Provider>();

export function registerProvider(p: Provider): void { providers.set(p.kind, p); }
export function getProvider(kind: Kind): Provider { const p = providers.get(kind); if (!p) throw new Error(`no provider registered for kind ${kind}`); return p; }
export function clearProviders(): void { providers.clear(); }
