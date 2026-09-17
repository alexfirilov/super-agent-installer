import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Action, Component, Ctx, Installed, Provider, ToolSpec } from '../types.js';
import { probeVersion } from '../detect/tools.js';
import { latestNpm, latestGithubRelease } from '../version/latest.js';
import { isNewer, normalizeVersion } from '../version/compare.js';
import { NODE_MAJOR } from '../pins.js';
import { action, ok, fail } from './types.js';
import { memo } from '../exec/memo.js';

function sudo(ctx: Ctx, argv: string[]): string[] | null {
  if (ctx.host.isRoot) return argv;
  if (ctx.host.hasSudo) return ['sudo', ...argv];
  return null;
}

function split(pkg: string): string[] {
  return pkg.split(/\s+/).filter(Boolean);
}

function pmInstall(ctx: Ctx, p: ToolSpec['packages']): string[] | null | 'nosudo' {
  const pm = ctx.host.pkgManager;
  const s = (argv: string[]) => sudo(ctx, argv) ?? 'nosudo';
  switch (pm) {
    case 'apt': return p.apt ? s(['apt-get', 'install', '-y', ...split(p.apt)]) : null;
    case 'dnf': case 'yum': return p.dnf ? s([pm, 'install', '-y', ...split(p.dnf)]) : null;
    case 'pacman': return p.pacman ? s(['pacman', '-S', '--noconfirm', '--needed', ...split(p.pacman)]) : null;
    case 'zypper': return p.zypper ? s(['zypper', '--non-interactive', 'install', ...split(p.zypper)]) : null;
    case 'apk': return p.apk ? s(['apk', 'add', '--no-cache', ...split(p.apk)]) : null;
    case 'brew': return p.brew ? ['brew', 'install', ...split(p.brew)] : null;
    case 'winget': return p.winget ? ['winget', 'install', '--id', p.winget, '--silent', '--accept-source-agreements', '--accept-package-agreements'] : null;
    case 'scoop': return p.scoop ? ['scoop', 'install', ...split(p.scoop)] : null;
    case 'choco': return p.choco ? ['choco', 'install', '-y', ...split(p.choco)] : null;
    default: return null;
  }
}

async function npmGlobal(ctx: Ctx, pkg: string): Promise<void> {
  if (!ctx.host.isRoot && ctx.host.platform !== 'windows') {
    const prefix = (await ctx.run(['npm', 'config', 'get', 'prefix'], { readOnly: true, allowFailure: true })).stdout.trim();
    if (prefix.startsWith('/usr')) {
      ctx.log.warn(`npm global prefix ${prefix} is not user-writable; switching to ~/.local (add ~/.local/bin to PATH)`);
      await ctx.run(['npm', 'config', 'set', 'prefix', join(ctx.host.home, '.local')]);
    }
  }
  await ctx.run(['npm', 'install', '-g', ...split(pkg)], { timeoutMs: 600000 });
}

async function installNode(ctx: Ctx): Promise<string | null> {
  const h = ctx.host;
  if (h.platform === 'windows') {
    await ctx.run(['winget', 'install', '--id', 'OpenJS.NodeJS.LTS', '--silent', '--accept-source-agreements', '--accept-package-agreements']);
    return null;
  }
  if (h.platform === 'darwin') {
    await ctx.run(['brew', 'install', `node@${NODE_MAJOR}`]);
    await ctx.run(['brew', 'link', '--overwrite', '--force', `node@${NODE_MAJOR}`], { allowFailure: true });
    return null;
  }
  if ((h.isRoot || h.isProxmoxHost) && h.pkgManager === 'apt') {
    await ctx.run(['bash', '-c', `curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x -o /tmp/nodesource_setup.sh && bash /tmp/nodesource_setup.sh && apt-get install -y nodejs`], { timeoutMs: 600000 });
    return null;
  }
  if (h.isRoot && h.pkgManager) {
    const cmd = pmInstall(ctx, { dnf: 'nodejs npm', pacman: 'nodejs npm', apk: 'nodejs npm', zypper: 'nodejs22 npm22' });
    if (cmd && cmd !== 'nosudo') { await ctx.run(cmd); return null; }
  }
  await ctx.run(['bash', '-c', 'curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell'], { timeoutMs: 600000 });
  const fnm = join(h.home, '.local', 'share', 'fnm', 'fnm');
  await ctx.run([fnm, 'install', String(NODE_MAJOR)], { timeoutMs: 600000 });
  await ctx.run([fnm, 'default', String(NODE_MAJOR)], { timeoutMs: 600000 });
  return `Node ${NODE_MAJOR} installed with fnm. Add to your shell rc: eval "$(${fnm} env --use-on-cd)"`;
}

async function toolLatest(c: Component, ctx: Ctx): Promise<string | null> {
  if (c.spec.kind !== 'tool') return null;
  const spec = c.spec;
  if (spec.latest?.npm) return memo(ctx, `npm:${spec.latest.npm}`, () => latestNpm(ctx.fetch, spec.latest!.npm!));
  if (spec.latest?.github) return memo(ctx, `github:${spec.latest.github}`, () => latestGithubRelease(ctx.fetch, spec.latest!.github!));
  return null;
}

export const toolProvider: Provider = {
  kind: 'tool',
  async detect(c, ctx) {
    if (c.spec.kind !== 'tool') return null;
    const v = await probeVersion(ctx.run, c.spec.probe, c.spec.versionRegex);
    return v ? { version: v } : null;
  },
  latest: toolLatest,
  async plan(c: Component, ctx: Ctx, installed: Installed | null, mode): Promise<Action[]> {
    if (c.spec.kind !== 'tool') return [];
    const spec = c.spec;
    const h = ctx.host;
    const post = async () => { for (const argv of spec.postInstall?.[h.platform] ?? []) await ctx.run(argv, { timeoutMs: 600000 }); };

    if (mode === 'uninstall') {
      if (!installed) return [];
      return [action(c.id, 'uninstall', `remove ${c.name}`, async () => {
        const p = spec.packages;
        const pm = h.pkgManager;
        if (p.npm) { await ctx.run(['npm', 'uninstall', '-g', ...split(p.npm).map((pkg) => pkg.replace(/@[^@/]+$/, ''))], { allowFailure: true }); return ok(`${c.name} removed`); }
        if (p.uvTool) { await ctx.run(['uv', 'tool', 'uninstall', p.uvTool], { allowFailure: true }); return ok(`${c.name} removed`); }
        if (p.go) {
          const gopath = (await ctx.run(['go', 'env', 'GOPATH'], { readOnly: true, allowFailure: true })).stdout.trim();
          if (gopath) {
            const binary = p.go.replace(/@.*$/, '').split('/').filter(Boolean).pop() + (h.platform === 'windows' ? '.exe' : '');
            if (!ctx.dryRun) await rm(join(gopath, 'bin', binary), { force: true });
            return ok(`${c.name} removed`);
          }
        }
        if (pm === 'apt' && p.apt) { const cmd = sudo(ctx, ['apt-get', 'remove', '-y', ...split(p.apt)]); if (cmd) { await ctx.run(cmd, { allowFailure: true }); return ok(`${c.name} removed`); } }
        else if (pm === 'brew' && p.brew) { await ctx.run(['brew', 'uninstall', ...split(p.brew)], { allowFailure: true }); return ok(`${c.name} removed`); }
        else if (pm === 'winget' && p.winget) { await ctx.run(['winget', 'uninstall', '--id', p.winget, '--silent'], { allowFailure: true }); return ok(`${c.name} removed`); }
        return ok(`${c.name}: no uninstall route for ${pm ?? 'this host'}; remove it manually`, false);
      })];
    }

    const latest = await toolLatest(c, ctx);
    const needsNodeUpgrade = spec.strategy === 'node' && !!installed?.version && Number(normalizeVersion(installed.version)?.split('.')[0]) < NODE_MAJOR;
    if (installed && mode !== 'install' && !isNewer(latest, installed.version) && !needsNodeUpgrade) return [];
    if (installed && mode === 'install' && !needsNodeUpgrade) return [];
    const op = installed ? 'update' : 'install';
    return [action(c.id, op, `${op} ${c.name}${latest ? ` (${latest})` : ''}`, async () => {
      if (spec.strategy === 'node') {
        const note = await installNode(ctx);
        await post();
        return ok(`Node installed${note ? `. ${note}` : ''}`);
      }
      const p = spec.packages;
      const cmd = pmInstall(ctx, p);
      if (cmd === 'nosudo') return fail(`${c.name}: needs root or sudo to use ${h.pkgManager}; install it manually or rerun as root`);
      if (cmd) await ctx.run(cmd, { timeoutMs: 600000 });
      else if (p.npm) await npmGlobal(ctx, p.npm);
      else if (p.go) await ctx.run(['go', 'install', p.go.includes('@') ? p.go : `${p.go}@latest`], { timeoutMs: 600000 });
      else if (p.uvTool) await ctx.run(['uv', 'tool', 'install', p.uvTool], { timeoutMs: 600000 });
      else if (p.script?.[h.platform]) await ctx.run(h.platform === 'windows' ? ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', p.script[h.platform]!] : ['sh', '-c', p.script[h.platform]!], { timeoutMs: 600000 });
      else return fail(`${c.name}: no install route for ${h.platform}/${h.pkgManager ?? 'no package manager'}`);
      await post();
      return ok(`${c.name} ${op === 'install' ? 'installed' : 'updated'}`);
    }, { from: installed?.version ?? null, to: latest })];
  },
};
