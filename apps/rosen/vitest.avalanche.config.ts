import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/** Isolated network tests require no application database or operator environment. */
export default defineConfig({
  resolve: {
    alias: {
      '@rosen-network/avalanche/server': fileURLToPath(
        new URL('../../networks/avalanche/src/server.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@rosen-bridge/icons': fileURLToPath(
        new URL('./tests/mocked/avalanche-icons.mock.ts', import.meta.url),
      ),
      '@rosen-network/avalanche': fileURLToPath(
        new URL('../../networks/avalanche/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: 'rosen-app-avalanche',
    // Cold imports include the real EVM producers and codec dependency tree.
    testTimeout: 15000,
    include: ['tests/networks/avalanche/*.spec.ts', 'tests/utils/explorer.spec.ts'],
  },
});
