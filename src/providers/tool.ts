import { access, constants, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Action, Component, Ctx, Installed, Provider, ToolSpec } from '../types.js';
import { probeVersion } from '../detect/tools.js';
import { latestNpm, latestGithubRelease } from '../version/latest.js';
import { isNewer, normalizeVersion } from '../version/compare.js';
import { NODE_MAJOR } from '../pins.js';
import { action, ok, fail } from './types.js';
import { memo } from '../exec/memo.js';
import { extendPathWith } from '../exec/path.js';

function sudo(ctx: Ctx, argv: string[]): string[] | null {
  if (ctx.host.isRoot) return argv;
  if (ctx.host.hasSudo) return ['sudo', ...argv];
  return null;
}

function split(pkg: string): string[] {
  return pkg.split(/\s+/).filter(Boolean);
}

const aptUpdated = new WeakSet<Ctx>();
/** Fresh hosts often have empty or stale apt lists ("Unable to locate package git"): refresh once per run before the first apt install. */
async function aptUpdateOnce(ctx: Ctx, cmd: string[]): Promise<void> {
  if (!cmd.includes('apt-get') || aptUpdated.has(ctx)) return;
  aptUpdated.add(ctx);
  await ctx.run(sudo(ctx, ['apt-get', 'update']) ?? ['apt-get', 'update'], { allowFailure: true, timeoutMs: 600000 });
}

/** POSIX + generic package-manager routing (apt/dnf/yum/pacman/zypper/apk/brew). Windows is routed separately by `windowsUserRoute`/`windowsElevatedRoute` below, since the right route there depends on `ctx.elevate`, not just the detected `pkgManager`. */
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
    default: return null;
  }
}

/** Winget packages whose manifest actually declares `Scope: user` (research dossier D2, from real winget-pkgs manifests). Every other winget package is machine-only and needs admin — do not guess at more of these. */
const WINGET_USER_SCOPE_IDS = new Set<string>(['Git.Git']);

/**
 * Probes for scoop, bootstrapping it via the official installer if missing. Scoop's own installer refuses to run in
 * an elevated shell, so this refuses upfront too rather than letting the bootstrap command fail opaquely.
 * Returns `true` on success, or a string describing why scoop could not be used.
 */
async function ensureScoop(ctx: Ctx): Promise<true | string> {
  if (ctx.host.isElevated) return 'scoop rejects elevated shells; rerun without admin, or use --elevate';
  if ((await ctx.run(['scoop', '--version'], { readOnly: true, allowFailure: true })).code === 0) return true;
  const r = await ctx.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm get.scoop.sh | iex'], { timeoutMs: 600000, allowFailure: true });
  return r.code === 0 ? true : `failed to bootstrap scoop: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}`;
}

/**
 * Windows install route when `--elevate` was NOT passed: scoop first (bootstrapping it if absent), then
 * `winget --scope user` for the small allow-list of packages that actually support it, then `null` so the
 * generic npm/script fallback in `plan()` gets a turn. Returns `'needs-admin'` only when none of those apply
 * and the package's only route left is a machine-scope winget install — the caller must not invoke winget then.
 */
async function windowsUserRoute(ctx: Ctx, p: ToolSpec['packages']): Promise<string[] | 'needs-admin' | null> {
  if (p.scoop) {
    const s = await ensureScoop(ctx);
    if (s === true) return ['scoop', 'install', ...split(p.scoop)];
    ctx.log.warn(`scoop unavailable (${s}); trying the next install route`);
  }
  if (p.winget && WINGET_USER_SCOPE_IDS.has(p.winget)) return ['winget', 'install', '--id', p.winget, '--scope', 'user', '--silent', '--accept-source-agreements', '--accept-package-agreements'];
  if (p.winget && !p.npm && !p.script?.windows) return 'needs-admin';
  return null;
}

/** Windows install route when `--elevate` was passed: today's machine-scope behaviour, keyed off the detected package manager. */
function windowsElevatedRoute(ctx: Ctx, p: ToolSpec['packages']): string[] | null {
  switch (ctx.host.pkgManager) {
    case 'winget': return p.winget ? ['winget', 'install', '--id', p.winget, '--silent', '--accept-source-agreements', '--accept-package-agreements'] : null;
    case 'scoop': return p.scoop ? ['scoop', 'install', ...split(p.scoop)] : null;
    case 'choco': return p.choco ? ['choco', 'install', '-y', ...split(p.choco)] : null;
    default: return null;
  }
}

/** Writable if the path exists and is writable, or does not exist yet and its closest existing ancestor is writable (npm creates the missing dirs). */
async function writableOrCreatable(p: string): Promise<boolean> {
  try { await stat(p); } catch (e) { const parent = dirname(p); return (e as NodeJS.ErrnoException).code === 'ENOENT' && parent !== p ? writableOrCreatable(parent) : false; }
  return access(p, constants.W_OK).then(() => true, () => false);
}
/** True when `npm install -g` can write into the global prefix (`<prefix>/lib/node_modules`). */
const npmPrefixWritable = (prefix: string) => writableOrCreatable(join(prefix, 'lib', 'node_modules'));
async function userPrefix(ctx: Ctx): Promise<string | null> {
  if (ctx.host.isRoot || ctx.host.platform === 'windows') return null;
  const prefix = (await ctx.run(['npm', 'config', 'get', 'prefix'], { readOnly: true, allowFailure: true })).stdout.trim();
  if (!prefix || (await npmPrefixWritable(prefix))) return null;
  return join(ctx.host.home, '.local');
}
async function npmGlobal(ctx: Ctx, pkg: string): Promise<void> {
  const prefix = await userPrefix(ctx);
  if (prefix) ctx.log.warn(`npm global prefix is not writable by you; installing with --prefix ${prefix} (make sure ${join(prefix, 'bin')} is on your PATH)`);
  await ctx.run(['npm', 'install', '-g', ...(prefix ? ['--prefix', prefix] : []), ...split(pkg)], { timeoutMs: 600000 });
}
async function npmUninstall(ctx: Ctx, pkgs: string[]): Promise<void> {
  await ctx.run(['npm', 'uninstall', '-g', ...pkgs], { allowFailure: true });
  const local = join(ctx.host.home, '.local');
  if (ctx.host.platform !== 'windows' && (await Promise.all(pkgs.map((p) => stat(join(local, 'lib', 'node_modules', p)).then(() => true, () => false)))).some(Boolean)) await ctx.run(['npm', 'uninstall', '-g', '--prefix', local, ...pkgs], { allowFailure: true });
}

type NodeInstallResult = { ok: true; note: string | null } | { ok: false; message: string };

/**
 * Where fnm actually put node. `fnm default <major>` only moves an alias: it writes neither the registry PATH nor
 * any directory `toolDirs` can know the version of, so without this every `prerequisites: ['node']` component in the
 * same run would still fail to find `node`. Asking fnm itself beats guessing the layout.
 * The dirname is cut by hand rather than with `path.dirname`, which is POSIX-only in this process and would return
 * `.` for the `C:\...\node.exe` this returns on Windows.
 */
async function fnmNodeDir(ctx: Ctx): Promise<string | null> {
  const r = await ctx.run(['fnm', 'exec', '--using=default', '--', 'node', '-p', 'process.execPath'], { readOnly: true, allowFailure: true });
  if (r.code !== 0) return null;
  const exe = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean).pop();
  if (!exe) return null;
  const cut = Math.max(exe.lastIndexOf('\\'), exe.lastIndexOf('/'));
  return cut > 0 ? exe.slice(0, cut) : null;
}
/** Makes `dir` visible to every later command in this run (the child runner inherits process.env, providers read ctx.env). */
function addToRunPath(ctx: Ctx, dir: string): void {
  extendPathWith(ctx.host, process.env, [dir]);
  if (ctx.env !== process.env) extendPathWith(ctx.host, ctx.env, [dir]);
}

async function installNode(ctx: Ctx, name: string): Promise<NodeInstallResult> {
  const h = ctx.host;
  if (h.platform === 'windows') {
    if (!ctx.elevate) {
      const s = await ensureScoop(ctx);
      if (s !== true) return { ok: false, message: `needs admin: rerun with --elevate, or install ${name} yourself (${s})` };
      await ctx.run(['scoop', 'install', 'fnm']);
      await ctx.run(['fnm', 'install', String(NODE_MAJOR)], { timeoutMs: 600000 });
      await ctx.run(['fnm', 'default', String(NODE_MAJOR)], { timeoutMs: 600000 });
      const dir = await fnmNodeDir(ctx);
      if (!dir) return { ok: true, note: `Node ${NODE_MAJOR} installed with fnm, but its directory could not be resolved from \`fnm exec --using=default -- node -p process.execPath\`; open a new shell (or run \`fnm env --use-on-cd | Invoke-Expression\`) so it's picked up.` };
      addToRunPath(ctx, dir);
      return { ok: true, note: null };
    }
    await ctx.run(['winget', 'install', '--id', 'OpenJS.NodeJS.LTS', '--silent', '--accept-source-agreements', '--accept-package-agreements']);
    return { ok: true, note: null };
  }
  if (h.platform === 'darwin') {
    await ctx.run(['brew', 'install', `node@${NODE_MAJOR}`]);
    await ctx.run(['brew', 'link', '--overwrite', '--force', `node@${NODE_MAJOR}`], { allowFailure: true });
    return { ok: true, note: null };
  }
  if ((h.isRoot || h.isProxmoxHost) && h.pkgManager === 'apt') {
    await ctx.run(['bash', '-c', `curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x -o /tmp/nodesource_setup.sh && bash /tmp/nodesource_setup.sh && apt-get install -y nodejs`], { timeoutMs: 600000 });
    return { ok: true, note: null };
  }
  if (h.isRoot && h.pkgManager) {
    const cmd = pmInstall(ctx, { dnf: 'nodejs npm', pacman: 'nodejs npm', apk: 'nodejs npm', zypper: 'nodejs22 npm22' });
    if (cmd && cmd !== 'nosudo') { await ctx.run(cmd); return { ok: true, note: null }; }
  }
  await ctx.run(['bash', '-c', 'curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell'], { timeoutMs: 600000 });
  const fnm = join(h.home, '.local', 'share', 'fnm', 'fnm');
  await ctx.run([fnm, 'install', String(NODE_MAJOR)], { timeoutMs: 600000 });
  await ctx.run([fnm, 'default', String(NODE_MAJOR)], { timeoutMs: 600000 });
  return { ok: true, note: `Node ${NODE_MAJOR} installed with fnm. Add to your shell rc: eval "$(${fnm} env --use-on-cd)"` };
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
        if (p.npm) { await npmUninstall(ctx, split(p.npm).map((pkg) => pkg.replace(/@[^@/]+$/, ''))); return ok(`${c.name} removed`); }
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
        else if (pm === 'scoop' && p.scoop) { await ctx.run(['scoop', 'uninstall', ...split(p.scoop)], { allowFailure: true }); return ok(`${c.name} removed`); }
        return ok(`${c.name}: no uninstall route for ${pm ?? 'this host'}; remove it manually`, false);
      })];
    }

    const latest = await toolLatest(c, ctx);
    // root + apk installs the distro's nodejs package (alpine 3.21 ships 22): that is the best that route offers, so an older major is not re-planned every run
    const distroPinned = h.isRoot && h.pkgManager === 'apk';
    const needsNodeUpgrade = spec.strategy === 'node' && !distroPinned && !!installed?.version && Number(normalizeVersion(installed.version)?.split('.')[0]) < NODE_MAJOR;
    if (installed && mode !== 'install' && !isNewer(latest, installed.version) && !needsNodeUpgrade) return [];
    if (installed && mode === 'install' && !needsNodeUpgrade) return [];
    const op = installed ? 'update' : 'install';
    return [action(c.id, op, `${op} ${c.name}${latest ? ` (${latest})` : ''}`, async () => {
      if (spec.strategy === 'node') {
        const r = await installNode(ctx, c.name);
        if (!r.ok) return fail(r.message);
        await post();
        return ok(`Node installed${r.note ? `. ${r.note}` : ''}`);
      }
      const p = spec.packages;
      let cmd: string[] | null | 'nosudo' = null;
      let needsAdmin = false;
      if (h.platform === 'windows') {
        if (ctx.elevate) cmd = windowsElevatedRoute(ctx, p);
        else { const w = await windowsUserRoute(ctx, p); if (w === 'needs-admin') needsAdmin = true; else cmd = w; }
      } else {
        cmd = pmInstall(ctx, p);
      }
      if (cmd === 'nosudo') return fail(`${c.name}: needs root or sudo to use ${h.pkgManager}; install it manually or rerun as root`);
      if (cmd) { await aptUpdateOnce(ctx, cmd); await ctx.run(cmd, { timeoutMs: 600000 }); }
      else if (p.npm) await npmGlobal(ctx, p.npm);
      else if (p.go) {
        await ctx.run(['go', 'install', p.go.includes('@') ? p.go : `${p.go}@latest`], { timeoutMs: 600000 });
        // `go install` drops the binary in GOPATH/bin, which is rarely on the user's PATH; the LSP plugins look it up on PATH
        const gopath = (await ctx.run(['go', 'env', 'GOPATH'], { readOnly: true, allowFailure: true })).stdout.trim() || join(h.home, 'go');
        await post();
        return ok(`${c.name} ${op === 'install' ? 'installed' : 'updated'} into ${join(gopath, 'bin')}; add that directory to PATH so the LSP plugin can find it (e.g. export PATH="$HOME/go/bin:$PATH")`);
      }
      else if (p.uvTool) await ctx.run(['uv', 'tool', 'install', p.uvTool], { timeoutMs: 600000 });
      else if (p.script?.[h.platform]) await ctx.run(h.platform === 'windows' ? ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', p.script[h.platform]!] : ['sh', '-c', p.script[h.platform]!], { timeoutMs: 600000 });
      else if (needsAdmin) return fail(`needs admin: rerun with --elevate, or install ${c.name} yourself`);
      else return fail(`${c.name}: no install route for ${h.platform}/${h.pkgManager ?? 'no package manager'}`);
      await post();
      // a package manager can only offer what its repo has: re-probe rather than claim an update the distro could not deliver
      if (op === 'update' && !ctx.dryRun) {
        const now = await probeVersion(ctx.run, spec.probe, spec.versionRegex);
        if (now && installed?.version && !isNewer(now, installed.version)) return ok(`${c.name} is already at ${now}, the newest ${h.pkgManager ?? 'packaged'} version on this host${latest ? ` (upstream has ${latest}; install it manually if you need it)` : ''}`, false);
      }
      return ok(`${c.name} ${op === 'install' ? 'installed' : 'updated'}`);
    }, { from: installed?.version ?? null, to: latest })];
  },
};
