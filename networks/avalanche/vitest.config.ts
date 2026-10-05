import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@rosen-bridge/icons': fileURLToPath(
        new URL('./tests/mocked/icons.mock.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
    },
  },
});
