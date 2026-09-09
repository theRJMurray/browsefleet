import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'data', 'examples/**'],
    environment: 'node',
    // The agent loop's inter-iteration pause is real behaviour but not what any test asserts,
    // and at 500ms it would put half a minute of sleeping into a suite that otherwise runs in
    // seconds. Tests drive the loop with the pause off.
    env: { AGENT_STEP_DELAY_MS: '0' },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/server.ts', 'src/types.ts'],
    },
  },
});
