import { afterEach, describe, expect, it, vi } from 'vitest';

import { AvalancheSafetyState, AvalancheSafetyState1790769600000 } from '@rosen-bridge/evm-scanner';

import { registerAvalancheSafety } from '../../src/avalanche/data-source';
import { databaseFixture } from './mocked/runtime.mock';

afterEach(() => vi.restoreAllMocks());

describe('registerAvalancheSafety', () => {
  /**
   * @target registerAvalancheSafety registers persisted safety before migrations can run
   * @dependencies Actual uninitialized DataSource
   * @scenario Avalanche metadata is registered before database initialization
   * @expected Existing registrations remain and the safety entity and migration are added
   */
  it('registers persisted safety before migrations can run', () => {
    const { dataSource } = databaseFixture();
    dataSource.setOptions({ entities: ['existing-entity'], migrations: ['existing-migration'] });
    expect(registerAvalancheSafety(dataSource)).toEqual(dataSource);
    expect(dataSource.options.entities).toEqual(['existing-entity', AvalancheSafetyState]);
    expect(dataSource.options.migrations).toEqual([
      'existing-migration',
      AvalancheSafetyState1790769600000,
    ]);
    expect(dataSource.isInitialized).toEqual(false);
  });
  /**
   * @target registerAvalancheSafety rejects late safety registration
   * @dependencies Actual uninitialized DataSource
   * @scenario Metadata registration is attempted after initialization
   * @expected Registration is rejected instead of altering active database metadata
   */
  it('rejects late safety registration', () => {
    const { dataSource } = databaseFixture();
    Object.defineProperty(dataSource, 'isInitialized', { value: true });
    expect(() => registerAvalancheSafety(dataSource)).toThrow();
  });
});
