import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { probeVersion } from '../detect/tools.js';
import { latestClaude } from '../version/latest.js';
import { isNewer } from '../version/compare.js';
import { action, ok, fail } from './types.js';
import { readJsonFile, writeJsonAtomic, backupFile, mergeClaudeSettings } from '../config/json.js';
async function which(ctx: Ctx, cmd: string): Promise<string> { const r = await ctx.run(ctx.host.platform === 'windows' ? ['where.exe', cmd] : ['sh', '-c', `command -v ${cmd}`], { readOnly: true, allowFailure: true }); return r.code === 0 ? r.stdout.trim().split('\n')[0] ?? '' : ''; }
function owner(path: string): 'apt' | 'brew' | 'winget' | 'native' { if (/^\/usr\/bin\//.test(path)) return 'apt'; if (/homebrew|\/usr\/local\/Caskroom/.test(path)) return 'brew'; if (/WinGet/i.test(path)) return 'winget'; return 'native'; }
async function setChannel(ctx: Ctx): Promise<void> { const cur = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; const next = mergeClaudeSettings(cur, { autoUpdatesChannel: ctx.channel }); if (JSON.stringify(next) !== JSON.stringify(cur)) { if (!ctx.dryRun) { await backupFile(ctx.paths.claudeSettings, ctx.paths.backupsDir); await writeJsonAtomic(ctx.paths.claudeSettings, next); } } }
export const claudeAgentProvider: Provider = {
  kind: 'agent',
  async detect(_c, ctx) { const v = await probeVersion(ctx.run, ['claude', '--version']); return v ? { version: v } : null; },
  async latest(_c, ctx) { return latestClaude(ctx.fetch, ctx.channel); },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'agent' || c.spec.agent !== 'claude') return [];
    const h = ctx.host; const latest = mode === 'uninstall' ? null : await latestClaude(ctx.fetch, ctx.channel);
    if (mode === 'uninstall') {
      if (!installed) return [];
      return [action(c.id, 'uninstall', 'remove Claude Code', async () => {
        const o = owner(await which(ctx, 'claude'));
        if (o === 'apt') await ctx.run(['apt-get', 'remove', '-y', 'claude-code']); else if (o === 'brew') await ctx.run(['brew', 'uninstall', '--cask', ctx.channel === 'latest' ? 'claude-code@latest' : 'claude-code']); else if (o === 'winget') await ctx.run(['winget', 'uninstall', '--id', 'Anthropic.ClaudeCode', '--silent']);
        else if (!ctx.dryRun) { await rm(join(h.home, '.local', 'share', 'claude'), { recursive: true, force: true }); await rm(join(h.home, '.local', 'bin', h.platform === 'windows' ? 'claude.exe' : 'claude'), { force: true }); }
        return ok('Claude Code removed');
      })];
    }
    if (!installed) {
      return [action(c.id, 'install', `install Claude Code (${ctx.channel})`, async () => {
        if (h.platform === 'linux' && h.hasAvx === false) return fail('CPU has no AVX: Claude Code crashes with Illegal instruction. On Proxmox run: qm set <vmid> --cpu x86-64-v3 (or host), then retry.');
        if (h.platform === 'linux' && h.isMusl && h.pkgManager === 'apk') { await ctx.run(['apk', 'add', '--no-cache', 'bash', 'curl', 'libgcc', 'libstdc++', 'ripgrep']); }
        if (h.platform === 'linux' && (h.isProxmoxHost || h.isRoot) && h.pkgManager === 'apt') {
          await ctx.run(['install', '-d', '-m', '0755', '/etc/apt/keyrings']);
          await ctx.run(['bash', '-c', 'curl -fsSL https://downloads.claude.ai/keys/claude-code.asc -o /etc/apt/keyrings/claude-code.asc']);
          await ctx.run(['bash', '-c', `printf 'deb [signed-by=/etc/apt/keyrings/claude-code.asc] https://downloads.claude.ai/claude-code/apt/${ctx.channel} stable main\\n' > /etc/apt/sources.list.d/claude-code.list`]);
          await ctx.run(['apt-get', 'update']); await ctx.run(['apt-get', 'install', '-y', 'claude-code']);
        } else if (h.platform === 'darwin' && h.pkgManager === 'brew') { await ctx.run(['brew', 'install', '--cask', ctx.channel === 'latest' ? 'claude-code@latest' : 'claude-code']); }
        else if (h.platform === 'windows') { await ctx.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; & ([scriptblock]::Create((irm -UseBasicParsing https://claude.ai/install.ps1))) ${ctx.channel}`], { timeoutMs: 600000 }); }
        else { await ctx.run(['bash', '-c', `curl -fsSL https://claude.ai/install.sh | bash -s ${ctx.channel}`], { timeoutMs: 600000 }); }
        if (h.platform === 'linux' && h.isMusl) { const cur = (await readJsonFile(ctx.paths.claudeSettings)) ?? {}; if (!ctx.dryRun) await writeJsonAtomic(ctx.paths.claudeSettings, mergeClaudeSettings(cur, { env: { USE_BUILTIN_RIPGREP: '0' } })); }
        await setChannel(ctx);
        return ok(`Claude Code ${latest ?? ''} installed`);
      }, { from: null, to: latest })];
    }
    if (!isNewer(latest, installed.version)) return [];
    return [action(c.id, 'update', `update Claude Code ${installed.version} -> ${latest}`, async () => {
      if (h.claudeRunning) return fail('a claude session is running; close it and rerun (claude update silently no-ops while the lock is held)');
      const o = owner(await which(ctx, 'claude'));
      if (o === 'apt') { await ctx.run(['apt-get', 'update']); await ctx.run(['apt-get', 'install', '-y', 'claude-code']); }
      else if (o === 'brew') await ctx.run(['brew', 'upgrade', '--cask', ctx.channel === 'latest' ? 'claude-code@latest' : 'claude-code']);
      else if (o === 'winget') await ctx.run(['winget', 'upgrade', '--id', 'Anthropic.ClaudeCode', '--silent', '--accept-source-agreements', '--accept-package-agreements']);
      else { const r = await ctx.run(['claude', 'update'], { timeoutMs: 600000, allowFailure: true }); if (r.code !== 0) return fail(`claude update failed: ${r.stderr.trim() || r.stdout.trim()}`); }
      await setChannel(ctx);
      return ok(`Claude Code updated to ${latest}`);
    }, { from: installed.version, to: latest })];
  },
};
