import { registerProvider } from './registry.js';
import { agentProvider } from './agent.js';
import { toolProvider } from './tool.js';
import { claudePluginProvider } from './claude-plugin.js';
import { codexPluginProvider } from './codex-plugin.js';
import { mcpProvider } from './mcp.js';
import { skillProvider } from './skill.js';
import { settingProvider } from './setting.js';
import { hookProvider } from './hook.js';
import { statuslineProvider } from './statusline.js';
import { instructionsProvider } from './instructions.js';
export function registerAllProviders(): void { for (const p of [agentProvider, toolProvider, claudePluginProvider, codexPluginProvider, mcpProvider, skillProvider, settingProvider, hookProvider, statuslineProvider, instructionsProvider]) registerProvider(p); }
