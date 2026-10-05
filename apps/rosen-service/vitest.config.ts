import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    setupFiles: ['tests/setup-tests.ts'],
    poolOptions: {
      forks: { execArgv: ['--import', 'tsx'] },
    },
  },
});
