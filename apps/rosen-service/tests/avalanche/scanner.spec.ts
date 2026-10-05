import { afterEach, describe, expect, it, vi } from 'vitest';

import { AvalancheRpcObservationExtractor } from '@rosen-bridge/evm-observation-extractor';
import { AvalancheRpcScanner } from '@rosen-bridge/evm-scanner';

import { parseAvalancheConfig } from '../../src/avalanche/config';
import { createAvalancheScanner } from '../../src/avalanche/scanner';
import { databaseFixture } from './mocked/runtime.mock';
import { avalancheConfigData, avalancheHealthCheckData } from './testUtils';

afterEach(() => vi.restoreAllMocks());

import { tokenMapFixture } from './testUtils';

describe('createAvalancheScanner', () => {
  /**
   * @target createAvalancheScanner joins the actual settled scanner to its observation extractor
   * @dependencies Actual scanner, observation extractor, TokenMap and uninitialized DataSource
   * @scenario Explicit Fuji policy is constructed without initializing RPC or database
   * @expected Real Avalanche scanner contains its real Avalanche observation extractor
   */
  it('joins the actual settled scanner to its observation extractor', async () => {
    const { dataSource } = databaseFixture();
    const scanner = await createAvalancheScanner(
      parseAvalancheConfig(avalancheConfigData(), avalancheHealthCheckData())!,
      dataSource,
      await tokenMapFixture(),
    );
    expect(scanner instanceof AvalancheRpcScanner).toEqual(true);
    expect(scanner.name()).toEqual('avalanche');
    expect(scanner.newExtractors.length).toEqual(1);
    expect(scanner.newExtractors[0] instanceof AvalancheRpcObservationExtractor).toEqual(true);
    expect(scanner.newExtractors[0].getId()).toEqual('avalanche-rpc-extractor');
    await scanner.assertUsable();
  });
  /**
   * @target createAvalancheScanner preserves the selected source across persisted state
   * @dependencies Actual persisted safety reader
   * @scenario Selected source differs from the persisted source identity
   * @expected Downstream qualification fails without falling back to the old source
   */
  it('preserves the selected source across persisted state', async () => {
    const config = parseAvalancheConfig(
      { ...avalancheConfigData(), selectedSourceId: 'provider-b' },
      avalancheHealthCheckData(),
    )!;
    const { dataSource } = databaseFixture();
    const scanner = await createAvalancheScanner(config, dataSource, await tokenMapFixture());
    await expect(scanner.assertUsable()).rejects.toThrow();
  });
});
