/**
 * Absolute path to Windows PowerShell.
 *
 * Two reasons never to spawn the bare name. First, it failed: on a non-elevated interactive desktop session
 * (medium integrity, GCE QA 2026-09-20) every spawn of `powershell.exe` from the compiled binary returned
 * `EPERM: operation not permitted, uv_spawn 'powershell.exe'`, while `&` and `Start-Process` in that same session
 * ran it happily -- so the child runtime's own PATH search was the difference. Second, we prepend user-writable
 * directories (`%APPDATA%\npm`, scoop shims, `~/.local/bin`) to PATH before spawning, so a `powershell.exe`
 * dropped in any of them would be executed in place of the real one.
 */
export function powershellExe(env: Record<string, string | undefined>): string {
  const root = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}
