import { join } from 'node:path';
import type { HostInfo, Paths } from '../types.js';
export function resolvePaths(host: HostInfo, env: Record<string, string | undefined>): Paths {
  const j = host.platform === 'windows' ? (...p: string[]) => p.join('\\') : (...p: string[]) => join(...p);
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR ?? j(host.home, '.claude');
  const claudeJson = env.CLAUDE_CONFIG_DIR ? j(env.CLAUDE_CONFIG_DIR, '.claude.json') : j(host.home, '.claude.json');
  const codexHome = env.CODEX_HOME ?? j(host.home, '.codex');
  const stateDir = host.platform === 'windows' ? j(env.APPDATA ?? j(host.home, 'AppData', 'Roaming'), 'super-agent-installer') : j(env.XDG_CONFIG_HOME ?? j(host.home, '.config'), 'super-agent-installer');
  return {
    claudeConfigDir, claudeSettings: j(claudeConfigDir, 'settings.json'), claudeJson, claudeMd: j(claudeConfigDir, 'CLAUDE.md'), claudeHooksDir: j(claudeConfigDir, 'hooks'),
    codexHome, codexConfig: j(codexHome, 'config.toml'), codexHooks: j(codexHome, 'hooks.json'), codexAgentsMd: j(codexHome, 'AGENTS.md'), agentsSkillsDir: j(host.home, '.agents', 'skills'),
    stateDir, stateFile: j(stateDir, 'state.json'), backupsDir: j(stateDir, 'backups'), logFile: j(stateDir, 'last-run.log'),
  };
}
