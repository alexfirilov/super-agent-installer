import { describe, it, expect } from 'vitest';
import { powershellExe } from '../../src/exec/win-exe.js';

describe('powershellExe', () => {
  // GCE QA, non-elevated interactive desktop (medium integrity): spawning the bare name failed with
  // `EPERM: operation not permitted, uv_spawn 'powershell.exe'` while the same session ran powershell fine via
  // `&` and Start-Process. We also prepend user-writable directories to PATH before spawning, so letting the
  // child runtime search PATH for a system binary is a hijack vector as well as unreliable.
  it('returns the absolute System32 path from SystemRoot', () => {
    expect(powershellExe({ SystemRoot: 'C:\\Windows' })).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });
  it('honours a non-standard SystemRoot', () => {
    expect(powershellExe({ SystemRoot: 'D:\\Win' })).toBe('D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });
  it('falls back to C:\\Windows when SystemRoot is unset', () => {
    expect(powershellExe({})).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });
  it('never returns a bare name, which would be resolved against our own extended PATH', () => {
    expect(powershellExe({ SystemRoot: 'C:\\Windows' })).not.toBe('powershell.exe');
  });
});
