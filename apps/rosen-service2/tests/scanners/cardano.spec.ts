import '@rosen-bridge/extended-typeorm/bootstrap';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DefaultLogger, DummyLogger } from '@rosen-bridge/abstract-logger';
import {
  BLOCK_CLEANUP_THRESHOLD_DURATION,
  BLOCK_TRIM_COUNT_IN_ROUND,
} from '@rosen-bridge/abstract-scanner/dist/constants.js';
import { CardanoOgmiosObservationExtractor } from '@rosen-bridge/cardano-observation-extractor';
import { CardanoOgmiosScanner } from '@rosen-bridge/cardano-scanner';
import { TokenMap } from '@rosen-bridge/extended-tokens';
import { DataSource } from '@rosen-bridge/extended-typeorm';

const configs = vi.hoisted(() => ({
  chains: {
    cardano: {
      method: 'ogmios',
      ogmios: {
        connection: {
          address: '127.0.0.1',
          port: 1337,
          initialSlot: 321,
          initialHash: '11'.repeat(32),
        },
      },
    },
  },
  contracts: { cardano: { addresses: { lock: 'synthetic-cardano-lock' } } },
}));

vi.mock('../../src/configs', () => ({ configs }));

describe('getCardanoScanner', () => {
  let getCardanoScanner: typeof import('../../src/scanners/cardano').getCardanoScanner;
  let dataSource: DataSource;
  let tokenMap: TokenMap;

  beforeAll(async () => {
    DefaultLogger.init(new DummyLogger());
    ({ getCardanoScanner } = await import('../../src/scanners/cardano'));
  });

  beforeEach(() => {
    configs.chains.cardano.method = 'ogmios';
    Object.assign(configs.chains.cardano.ogmios.connection, {
      address: '127.0.0.1',
      port: 1337,
      initialSlot: 321,
      initialHash: '11'.repeat(32),
    });
    dataSource = new DataSource({ type: 'sqlite', database: ':memory:' });
    tokenMap = new TokenMap();
  });

  /**
   * @target getCardanoScanner should supply the scanner cleanup defaults
   * @dependencies Controlled config; genuine scanner, token map and unconnected SQLite DataSource.
   * @scenario Select Ogmios with a loopback endpoint and construct the scanner without starting it.
   * @expected Both cleanup fields equal the current abstract-scanner constants.
   */
  it('should supply the scanner cleanup defaults', async () => {
    const scanner = await getCardanoScanner(dataSource, tokenMap);

    expect(scanner).toBeInstanceOf(CardanoOgmiosScanner);
    expect(scanner.blockCleanupConfig).toEqual({
      blockCleanupThresholdDuration: BLOCK_CLEANUP_THRESHOLD_DURATION,
      blockTrimCountInRound: BLOCK_TRIM_COUNT_IN_ROUND,
    });
  });

  /**
   * @target getCardanoScanner should register the actual Ogmios observation extractor
   * @dependencies Controlled config; genuine scanner and observation extractor; no scanner start.
   * @scenario Construct the Ogmios scanner with an empty real token map and local DataSource.
   * @expected Its registration queue contains one CardanoOgmiosObservationExtractor with the real ID.
   */
  it('should register the actual Ogmios observation extractor', async () => {
    const scanner = await getCardanoScanner(dataSource, tokenMap);

    expect(scanner.newExtractors.length).toEqual(1);
    expect(scanner.newExtractors[0]).toBeInstanceOf(CardanoOgmiosObservationExtractor);
    expect(scanner.newExtractors[0].getId()).toEqual('cardano-ogmios-extractor');
  });

  /**
   * @target getCardanoScanner should preserve the configured Ogmios intersection
   * @dependencies Controlled config; genuine Ogmios constructor; no WebSocket connection.
   * @scenario Change the loopback host, port, initial slot and initial hash before construction.
   * @expected The scanner retains those four inputs alongside the current cleanup policy.
   */
  it('should preserve the configured Ogmios intersection', async () => {
    Object.assign(configs.chains.cardano.ogmios.connection, {
      address: 'localhost',
      port: 1447,
      initialSlot: 654,
      initialHash: '22'.repeat(32),
    });

    const scanner = await getCardanoScanner(dataSource, tokenMap);

    expect(scanner).toMatchObject({
      host: 'localhost',
      port: 1447,
      initPoint: { id: '22'.repeat(32), slot: 654 },
    });
    expect(dataSource.isInitialized).toEqual(false);
  });

  /**
   * @target getCardanoScanner should reject an unsupported scanner method
   * @dependencies Controlled config; genuine factory and unconnected local DataSource.
   * @scenario Replace the Ogmios method with an unsupported literal while retaining its endpoint.
   * @expected The factory rejects the method before returning or starting a scanner.
   */
  it('should reject an unsupported scanner method', async () => {
    configs.chains.cardano.method = 'unsupported';

    await expect(getCardanoScanner(dataSource, tokenMap)).rejects.toThrow(
      'Unsupported or missing Cardano scanner method',
    );
  });
});
