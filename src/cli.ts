#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import type { Channel, ProfileName } from './types.js';
import { PROFILE_NAMES } from './types.js';
import { VERSION } from './version.js';
import { createCtx } from './context.js';
import { runInstall } from './commands/install.js';
import { runUpdate } from './commands/update.js';
import { runCheck } from './commands/check.js';
import { runUninstall } from './commands/uninstall.js';
import { runList } from './commands/list.js';
import { runDoctor } from './commands/doctor.js';
import { selfUpdate } from './update/self-update.js';
import { readState } from './state/state.js';
import { runPicker } from './picker/flow.js';
export type Command = 'install' | 'update' | 'check' | 'uninstall' | 'list' | 'doctor' | 'self-update' | 'help' | 'version';
export interface CliArgs { command: Command; profile?: ProfileName; only?: string[]; skip?: string[]; yes: boolean; dryRun: boolean; json: boolean; noAudit: boolean; noSelfUpdate: boolean; noLogin: boolean; noPersistSecrets: boolean; fromState: boolean; channel?: Channel; verbose: boolean; manifest?: string; logFile?: string; elevate: boolean; force: boolean; all: boolean; ids: string[]; error?: string }
const HELP = `super-agent-installer v${VERSION}
Usage: super-agent-installer [install] [--profile <name>] [--only a,b] [--skip c] [--yes] [--dry-run]
       super-agent-installer update [--no-self-update] | check | list | doctor | self-update | uninstall [id...] [--all] [--force]
Profiles: ${PROFILE_NAMES.join(', ')}
Flags: --yes/-y  --dry-run  --json  --no-audit  --no-login  --no-persist-secrets  --channel latest|stable  --from-state  --manifest <path>  --log-file <path>  --elevate  --verbose/-v  --version  --help/-h
  --elevate  Windows only: allow machine-scope winget installs (UAC prompt). Without it, installs stay per-user (scoop / winget --scope user / npm / script).
Exit codes: 0 done, 1 a step failed, 2 requested work could not be completed (blocked, drift), 3 needs a terminal, 4 unsupported host.`;
export function parseCli(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: { profile: { type: 'string' }, only: { type: 'string' }, skip: { type: 'string' }, yes: { type: 'boolean', short: 'y', default: false }, 'dry-run': { type: 'boolean', default: false }, json: { type: 'boolean', default: false }, 'no-audit': { type: 'boolean', default: false }, 'no-self-update': { type: 'boolean', default: false }, 'no-login': { type: 'boolean', default: false }, 'no-persist-secrets': { type: 'boolean', default: false }, 'from-state': { type: 'boolean', default: false }, channel: { type: 'string' }, verbose: { type: 'boolean', short: 'v', default: false }, manifest: { type: 'string' }, 'log-file': { type: 'string' }, elevate: { type: 'boolean', default: false }, force: { type: 'boolean', default: false }, all: { type: 'boolean', default: false }, version: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false } } });
  const [first, ...rest] = positionals; const commands: Command[] = ['install', 'update', 'check', 'uninstall', 'list', 'doctor', 'self-update'];
  let command: Command = 'install'; let error: string | undefined; let ids = rest;
  if (values.help) command = 'help'; else if (values.version) command = 'version'; else if (first && commands.includes(first as Command)) command = first as Command; else if (first) { command = 'help'; error = `unknown command: ${first}`; ids = []; }
  if (values.profile && !PROFILE_NAMES.includes(values.profile as ProfileName)) throw new Error(`unknown profile ${values.profile}; use one of ${PROFILE_NAMES.join(', ')}`);
  if (values.channel && values.channel !== 'latest' && values.channel !== 'stable') throw new Error('--channel must be latest or stable');
  const list = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
  return { command, profile: values.profile as ProfileName | undefined, only: list(values.only), skip: list(values.skip), yes: values.yes, dryRun: values['dry-run'], json: values.json, noAudit: values['no-audit'], noSelfUpdate: values['no-self-update'], noLogin: values['no-login'], noPersistSecrets: values['no-persist-secrets'], fromState: values['from-state'], channel: values.channel as Channel | undefined, verbose: values.verbose, manifest: values.manifest, logFile: values['log-file'], elevate: values.elevate, force: values.force, all: values.all, ids, error };
}
/** Runs the (freshly replaced) executable with the same arguments plus `extra`, sharing this terminal, and resolves
 * to its exit code. Used by `update` after a self-update so the new binary finishes the run with its own manifest. */
function reexecSelf(argv: string[]): (extra: string[]) => Promise<number> {
  return (extra) => new Promise((resolve) => {
    const child = spawn(process.execPath, [...argv, ...extra], { stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}
export async function main(argv = process.argv.slice(2)): Promise<number> {
  let a: CliArgs; try { a = parseCli(argv); } catch (e) { console.error((e as Error).message); console.error(HELP); return 1; }
  if (a.command === 'help') { if (a.error) console.error(a.error); console.log(HELP); return a.error ? 1 : 0; }
  if (a.command === 'version') { console.log(VERSION); return 0; }
  if (a.only && a.only.length === 0) a.only = undefined; // an empty --only list is treated as not provided so it does not silently bypass the picker
  const ctx = await createCtx({ dryRun: a.dryRun, yes: a.yes, noAudit: a.noAudit, channel: a.channel, verbose: a.verbose, json: a.json, manifestPath: a.manifest, logFile: a.logFile, elevate: a.elevate });
  const tty = !!process.stdin.isTTY && !!process.stdout.isTTY;
  switch (a.command) {
    case 'install': {
      const interactive = tty && !a.yes && !a.only && !a.profile && !a.fromState;
      if (!tty && !a.yes) { console.error('Unable to run interactively. Run with --yes [--profile <name>]'); return 3; }
      if (interactive) { const state = await readState(ctx.paths.stateFile); const pick = await runPicker(ctx, { state }); if (!pick) { console.log('cancelled'); return 0; } ctx.yes = false; return runInstall(ctx, { picked: pick.picked, profile: pick.profile === 'saved' ? undefined : pick.profile, json: a.json, installerVersion: VERSION, noLogin: a.noLogin, noPersistSecrets: a.noPersistSecrets, channel: a.channel }); }
      return runInstall(ctx, { profile: a.profile, only: a.only, skip: a.skip, fromState: a.fromState, json: a.json, installerVersion: VERSION, noLogin: a.noLogin, noPersistSecrets: a.noPersistSecrets, channel: a.channel });
    }
    case 'update': return runUpdate(ctx, { json: a.json, installerVersion: VERSION, noSelfUpdate: a.noSelfUpdate, selfUpdateFn: selfUpdate, reexec: reexecSelf(argv), channel: a.channel });
    case 'check': return runCheck(ctx, { json: a.json, channel: a.channel });
    case 'uninstall': if (!tty && !a.yes) { console.error('Unable to run interactively. Run with --yes'); return 3; } return runUninstall(ctx, a.ids, { json: a.json, installerVersion: VERSION, force: a.force, all: a.all, channel: a.channel });
    case 'list': return runList(ctx);
    case 'doctor': return runDoctor(ctx);
    case 'self-update': { const r = await selfUpdate(ctx, VERSION); console.log(r.message); return r.ok ? 0 : 1; }
  }
  return 1;
}
if (import.meta.main ?? (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1]))) main().then((code) => process.exit(code), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
