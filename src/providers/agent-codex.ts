import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Action, Component, Ctx, Installed, Provider } from '../types.js';
import { probeVersion } from '../detect/tools.js';
import { latestCodex } from '../version/latest.js';
import { isNewer } from '../version/compare.js';
import { action, ok, fail } from './types.js';
import { which, owner } from './agent-shared.js';
const SH = 'curl -fsSL https://chatgpt.com/codex/install.sh | sh';
const PS = '$env:CODEX_NON_INTERACTIVE=1; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; irm -UseBasicParsing https://chatgpt.com/codex/install.ps1 | iex';
async function removeNpmConflict(ctx: Ctx): Promise<void> {
  const r = await ctx.run(['npm', 'ls', '-g', '@openai/codex', '--depth=0', '--json'], { readOnly: true, allowFailure: true });
  if (/"@openai\/codex"/.test(r.stdout)) { ctx.log.warn('removing npm-installed @openai/codex so the native install wins on PATH'); await ctx.run(['npm', 'uninstall', '-g', '@openai/codex'], { allowFailure: true }); }
}
async function runInstaller(ctx: Ctx): Promise<void> {
  const h = ctx.host;
  if (h.platform === 'darwin' && h.pkgManager === 'brew') await ctx.run(['brew', 'install', '--cask', 'codex'], { timeoutMs: 600000 });
  else if (h.platform === 'windows') await ctx.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS], { timeoutMs: 600000 });
  else await ctx.run(['sh', '-c', SH], { env: { CODEX_NON_INTERACTIVE: '1' }, timeoutMs: 600000 });
}
async function sandboxNote(ctx: Ctx): Promise<string> {
  if (ctx.host.platform !== 'linux') return '';
  const r = await ctx.run(['codex', 'sandbox', '--', '/bin/true'], { readOnly: true, allowFailure: true, timeoutMs: 30000 });
  if (r.code === 0) return '';
  const hint = ctx.host.isLxc ? 'unprivileged LXC: on the Proxmox host run `pct set <ctid> --features nesting=1,keyctl=1` and reboot the container' : 'user namespaces unavailable: set `sandbox_mode = "danger-full-access"` in ~/.codex/config.toml or run Codex with --sandbox danger-full-access';
  return ` WARNING: Codex sandbox probe failed (${(r.stderr || r.stdout).trim().split('\n').pop() ?? ''}); ${hint}.`;
}
export const codexAgentProvider: Provider = {
  kind: 'agent',
  async detect(_c, ctx) { const v = await probeVersion(ctx.run, ['codex', '--version']); return v ? { version: v } : null; },
  async latest(_c, ctx) { return latestCodex(ctx.fetch); },
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'agent' || c.spec.agent !== 'codex') return [];
    const h = ctx.host;
    if (mode === 'uninstall') {
      if (!installed) return [];
      return [action(c.id, 'uninstall', 'remove Codex CLI', async () => {
        if (h.platform === 'darwin' && h.pkgManager === 'brew') { await ctx.run(['brew', 'uninstall', '--cask', 'codex'], { allowFailure: true }); }
        if (!ctx.dryRun) {
          if (h.platform === 'windows') await rm(join(ctx.env.LOCALAPPDATA ?? join(h.home, 'AppData', 'Local'), 'Programs', 'OpenAI', 'Codex'), { recursive: true, force: true });
          else { await rm(join(h.home, '.local', 'bin', 'codex'), { force: true }); await rm(join(h.home, '.local', 'bin', 'codex-code-mode-host'), { force: true }); await rm(join(ctx.paths.codexHome, 'packages', 'standalone'), { recursive: true, force: true }); }
        }
        return ok('Codex CLI removed');
      })];
    }
    const latest = await latestCodex(ctx.fetch);
    if (!installed) return [action(c.id, 'install', `install Codex CLI ${latest ?? ''}`, async () => { await removeNpmConflict(ctx); await runInstaller(ctx); return ok(`Codex CLI ${latest ?? ''} installed.${await sandboxNote(ctx)}`); }, { from: null, to: latest })];
    if (!isNewer(latest, installed.version)) return [];
    return [action(c.id, 'update', `update Codex CLI ${installed.version} -> ${latest}`, async () => {
      const r = await ctx.run(['codex', 'update'], { allowFailure: true, timeoutMs: 600000 });
      if (r.code !== 0) {
        if (/Could not detect/i.test(r.stderr + r.stdout)) {
          const o = owner(await which(ctx, 'codex'));
          if (o === 'winget') {
            const wr = await ctx.run(['winget', 'upgrade', '--id', 'OpenAI.Codex', '--silent', '--accept-source-agreements', '--accept-package-agreements'], { allowFailure: true });
            if (wr.code !== 0) return fail(`winget upgrade failed: ${(wr.stderr || wr.stdout).trim()}`);
          } else await runInstaller(ctx);
        }
        else return fail(`codex update failed: ${(r.stderr || r.stdout).trim()}`);
      }
      return ok(`Codex CLI updated to ${latest}`);
    }, { from: installed.version, to: latest })];
  },
};
