import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@rosen-network/avalanche/server': fileURLToPath(
        new URL('../../networks/avalanche/src/server.ts', import.meta.url),
      ),
      '@rosen-network/avalanche': fileURLToPath(
        new URL('../../networks/avalanche/src/index.ts', import.meta.url),
      ),
      '@rosen-network/base': fileURLToPath(
        new URL('../../networks/base/src/index.ts', import.meta.url),
      ),
      '@rosen-bridge/icons': fileURLToPath(
        new URL('./tests/mocked/icons.mock.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    setupFiles: ['tests/setup-tests.ts'],
    clearMocks: true,
    coverage: {
      provider: 'istanbul',
      include: ['src/wallet.ts'],
    },
  },
});
