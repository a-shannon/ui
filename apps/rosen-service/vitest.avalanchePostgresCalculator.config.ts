import { defineConfig } from 'vitest/config';

/**
 * Explicit integration selector; ordinary SQLite needs no PostgreSQL inputs.
 * Set AVALANCHE_POSTGRES_BIN to a PostgreSQL binary directory and
 * AVALANCHE_POSTGRES_ARTIFACT_ROOT to a fresh local artifact parent, then run
 * `vitest run --config vitest.avalanchePostgresCalculator.config.ts` using Node 22.
 * The helper owns SCRAM credentials, a dedicated loopback database and shutdown.
 */
export default defineConfig({
  test: {
    include: ['tests/avalanche/asset-calculator.spec.ts'],
    testNamePattern: 'PostgreSQL',
    environment: 'node',
    setupFiles: ['tests/setup-tests.ts'],
    env: { AVALANCHE_SERVICE_POSTGRES_TESTS: 'true' },
    testTimeout: 60000,
    hookTimeout: 60000,
    maxWorkers: 1,
    minWorkers: 1,
    poolOptions: { forks: { execArgv: ['--import', 'tsx'] } },
  },
});
