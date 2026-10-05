import '@rosen-bridge/extended-typeorm/bootstrap';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DefaultLogger, DummyLogger } from '@rosen-bridge/abstract-logger';
import { TokenMap } from '@rosen-bridge/extended-tokens';
import { DataSource } from '@rosen-bridge/extended-typeorm';
import { ErgoNetworkType } from '@rosen-bridge/scanner-interfaces';
import { CommitmentExtractor } from '@rosen-bridge/watcher-data-extractor';

import type { ChainConfigs } from '../src/types';

const configs = vi.hoisted(() => ({
  chains: {
    ergo: {
      method: 'explorer',
      explorer: { connections: [{ url: 'http://127.0.0.1:18081' }] },
      node: { connections: [{ url: 'http://127.0.0.1:18082' }] },
    },
  },
}));

vi.mock('../src/configs', () => ({ configs }));

describe('createCommitmentExtractor', () => {
  let createCommitmentExtractor: typeof import('../src/utils').createCommitmentExtractor;
  let dataSource: DataSource;
  let tokenMap: TokenMap;
  let chainConfigs: ChainConfigs;
  const logger = new DummyLogger();
  const address = '9iMjQx8PzwBKXRvsFUJFJAPoy31znfEeBUGz8DRkcnJX4rJYjVd';

  beforeAll(async () => {
    DefaultLogger.init(logger);
    ({ createCommitmentExtractor } = await import('../src/utils'));
  });

  beforeEach(() => {
    configs.chains.ergo.method = 'explorer';
    configs.chains.ergo.explorer.connections[0].url = 'http://127.0.0.1:18081';
    dataSource = new DataSource({ type: 'sqlite', database: ':memory:' });
    tokenMap = new TokenMap();
    chainConfigs = {
      addresses: {
        lock: address,
        cold: address,
        Commitment: address,
        WatcherTriggerEvent: address,
        WatcherPermit: address,
        Fraud: address,
      },
      tokens: { RWTId: '33'.repeat(32) },
      cleanupConfirm: 10,
    };
  });

  /**
   * @target createCommitmentExtractor should construct an inactive explorer initializer
   * @dependencies Controlled config; genuine CommitmentExtractor, WASM address decode and DataSource.
   * @scenario Construct for cardano with a valid synthetic Ergo address and loopback explorer URL.
   * @expected The real extractor retains its ID, address, explorer URL and inactive initialization.
   */
  it('should construct an inactive explorer initializer', () => {
    const extractor = createCommitmentExtractor(
      'cardano',
      dataSource,
      chainConfigs,
      tokenMap,
      logger,
    );

    expect(extractor).toBeInstanceOf(CommitmentExtractor);
    expect(extractor.getId()).toEqual('cardano-commitment-extractor');
    expect(extractor).toMatchObject({
      initializeOptions: {
        active: false,
        type: ErgoNetworkType.Explorer,
        url: 'http://127.0.0.1:18081',
        address,
      },
    });
    expect(dataSource.isInitialized).toEqual(false);
  });

  /**
   * @target createCommitmentExtractor should select the configured node initializer
   * @dependencies Controlled config; genuine extractor constructor; no initializer or network start.
   * @scenario Change only the Ergo method to node while retaining distinct loopback endpoints.
   * @expected The initialization options use the Node enum and node URL, and remain inactive.
   */
  it('should select the configured node initializer', () => {
    configs.chains.ergo.method = 'node';

    const extractor = createCommitmentExtractor('ergo', dataSource, chainConfigs, tokenMap, logger);

    expect(extractor).toMatchObject({
      initializeOptions: {
        active: false,
        type: ErgoNetworkType.Node,
        url: 'http://127.0.0.1:18082',
        address,
      },
    });
    expect(extractor.getId()).toEqual('ergo-commitment-extractor');
  });

  /**
   * @target createCommitmentExtractor should reject a missing Ergo endpoint
   * @dependencies Controlled config; genuine network resolver and factory; no remote transport.
   * @scenario Remove only the explorer URL from the default explorer configuration.
   * @expected The factory throws the resolver's missing-URL error before constructing an extractor.
   */
  it('should reject a missing Ergo endpoint', () => {
    configs.chains.ergo.explorer.connections[0].url = '';

    expect(() =>
      createCommitmentExtractor('cardano', dataSource, chainConfigs, tokenMap, logger),
    ).toThrow('Ergo network URL is not configured.');
  });

  /**
   * @target createCommitmentExtractor should reject a malformed commitment address
   * @dependencies Controlled config; genuine CommitmentExtractor and Ergo WASM address parser.
   * @scenario Change only the valid commitment address to an invalid Base58 string.
   * @expected The real constructor rejects the address without initializing the local DataSource.
   */
  it('should reject a malformed commitment address', () => {
    chainConfigs.addresses.Commitment = 'invalid-commitment-address';

    expect(() =>
      createCommitmentExtractor('cardano', dataSource, chainConfigs, tokenMap, logger),
    ).toThrow();
    expect(dataSource.isInitialized).toEqual(false);
  });
});
