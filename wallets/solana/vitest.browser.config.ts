import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/browserBuild.spec.ts'], testTimeout: 30000 },
});
