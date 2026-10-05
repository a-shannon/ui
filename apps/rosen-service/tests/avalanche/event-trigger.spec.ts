import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseAvalancheConfig } from '../../src/avalanche/config';
import { createAvalancheEventTriggerExtractor } from '../../src/avalanche/event-trigger';
import { databaseFixture } from './mocked/runtime.mock';
import { avalancheConfigData, avalancheHealthCheckData } from './testUtils';

afterEach(() => vi.restoreAllMocks());

describe('createAvalancheEventTriggerExtractor', () => {
  /**
   * @target createAvalancheEventTriggerExtractor registers the Avalanche event-trigger identity
   * @dependencies Actual EventTriggerExtractor and uninitialized DataSource
   * @scenario Explicit Rosen event-trigger identities are supplied
   * @expected Avalanche event-trigger extractor is constructed on Ergo with no DB or RPC operation
   */
  it('registers the Avalanche event-trigger identity', () => {
    const { dataSource } = databaseFixture();
    const extractor = createAvalancheEventTriggerExtractor(
      parseAvalancheConfig(avalancheConfigData(), avalancheHealthCheckData())!,
      dataSource,
      'https://ergo.example.invalid',
    );
    expect(extractor.getId()).toEqual('avalanche-extractor');
    expect(dataSource.isInitialized).toEqual(false);
  });
});
