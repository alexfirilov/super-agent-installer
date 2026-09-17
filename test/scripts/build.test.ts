import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
describe('scripts/build.sh', () => {
  it('lists all targets in dry mode', () => {
    const out = execFileSync('bash', ['scripts/build.sh'], { env: { ...process.env, SAI_BUILD_DRY: '1' }, encoding: 'utf8' });
    for (const t of ['bun-linux-x64', 'bun-linux-arm64', 'bun-linux-x64-musl', 'bun-linux-arm64-musl', 'bun-darwin-x64', 'bun-darwin-arm64', 'bun-windows-x64']) expect(out).toContain(`--target=${t}`);
    expect(out).toContain('release/super-agent-installer-windows-x64.exe'); expect(out).toContain('SHA256SUMS');
  });
});
