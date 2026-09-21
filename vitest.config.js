import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Keep DOM, catalog, and filesystem suites responsive on developer machines.
    maxWorkers: 2,
  },
});
