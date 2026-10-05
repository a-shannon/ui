import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@rosen-ui/constants': fileURLToPath(
        new URL('../../packages/constants/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    clearMocks: true,
  },
});
