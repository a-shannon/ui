import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.integration.spec.ts'],
    setupFiles: ['./tests/setup-integration.ts'],
    testTimeout: 30000,
    server: { deps: { inline: [/@rosen-bridge/, /extractor/] } },
  },
});
