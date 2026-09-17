import { defineConfig } from 'vitest/config';
const textAssets = { name: 'text-assets', transform(code: string, id: string) { if (id.endsWith('.sh') || id.endsWith('.ps1') || id.endsWith('.md')) return `export default ${JSON.stringify(code)}`; } };
export default defineConfig({ plugins: [textAssets], test: { include: ['test/**/*.test.ts'], testTimeout: 20000 } });
