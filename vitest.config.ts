import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/*.test.ts', 'packages/sdk/tests/*.test.ts', 'packages/cli/tests/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});
