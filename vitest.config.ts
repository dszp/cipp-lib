import { defineConfig } from 'vitest/config';

// Node-free source stays Node-free; vitest is a dev-only dependency and never ships.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Live smoke tests are `*.live.test.ts`; they self-skip without CIPP_CLIENT_ID.
    environment: 'node',
  },
});
