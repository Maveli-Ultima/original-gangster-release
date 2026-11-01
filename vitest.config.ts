import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: {
    // Disposable checkouts and staged patches live under .scratch. Only the
    // project's test directory belongs to this invocation.
    include: ['tests/**/*.test.{ts,mjs}'],
    // Simulation suites are CPU-bound. Running every file at once starves both
    // individual tests and the browser on ordinary desktop machines.
    maxWorkers: 2,
    // Match the audited default under concurrent simulation/browser load.
    testTimeout: 180_000,
  },
});
