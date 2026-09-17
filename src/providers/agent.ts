import type { Provider } from '../types.js';
import { claudeAgentProvider } from './agent-claude.js';
import { codexAgentProvider } from './agent-codex.js';
const pick = (c: { spec: { kind: string; agent?: string } }) => (c.spec.kind === 'agent' && c.spec.agent === 'codex' ? codexAgentProvider : claudeAgentProvider);
export const agentProvider: Provider = { kind: 'agent', detect: (c, ctx) => pick(c).detect(c, ctx), latest: (c, ctx) => pick(c).latest!(c, ctx), plan: (c, ctx, i, m) => pick(c).plan(c, ctx, i, m) };
