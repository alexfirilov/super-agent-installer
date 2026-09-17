import type { Provider } from '../types.js';
import { mcpClaudeProvider } from './mcp-claude.js';
import { mcpCodexProvider } from './mcp-codex.js';
const pick = (c: { spec: { kind: string; target?: string } }) => (c.spec.kind === 'mcp' && c.spec.target === 'codex' ? mcpCodexProvider : mcpClaudeProvider);
export const mcpProvider: Provider = { kind: 'mcp', detect: (c, ctx) => pick(c).detect(c, ctx), plan: (c, ctx, i, m) => pick(c).plan(c, ctx, i, m) };
