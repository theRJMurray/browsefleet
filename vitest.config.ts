import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'data', 'examples/**'],
    environment: 'node',
    // The agent loop's inter-iteration pause is real behaviour but not what any test asserts,
    // and at 500ms it would put half a minute of sleeping into a suite that otherwise runs in
    // seconds. Tests drive the loop with the pause off.
    // AGENT_STEP_DELAY_MS: the loop's inter-iteration pause is real behaviour but not what any
    // test asserts, and at 500ms it would put half a minute of sleeping into a suite that
    // otherwise runs in seconds.
    //
    // The two provider keys: the agent falls back to them when a request carries none, so a
    // developer with a real key exported would see the no-key test fail on a clone. Pinning
    // them empty makes the suite independent of the shell it runs in.
    env: { AGENT_STEP_DELAY_MS: '0', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
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
