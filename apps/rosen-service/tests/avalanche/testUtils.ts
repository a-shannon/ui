import { vi } from 'vitest';

import { BlockEntity } from '@rosen-bridge/abstract-scanner';
import { ErgoExplorerNetwork, ErgoScanner } from '@rosen-bridge/ergo-scanner';
import { TokenMap } from '@rosen-bridge/tokens';

import { createAvalancheCalculatorConfig } from '../../src/avalanche/calculator';
import { type AvalancheServiceConfig, parseAvalancheConfig } from '../../src/avalanche/config';
import { createAvalancheScannerHealth } from '../../src/avalanche/health';
import { createAvalancheScanner } from '../../src/avalanche/scanner';
import { commitmentSource } from './mocked/commitment.mock';
import { databaseFixture, finalizedRpcFixture } from './mocked/runtime.mock';
import { ergoAddress } from './testData';
/** Complete synthetic configuration; endpoints are reserved test hosts. */
export const avalancheConfigData = () => ({
  enabled: true,
  chainId: 43113,
  initialHeight: 0,
  selectedSourceId: 'provider-a',
  endpoints: [
    { sourceId: 'provider-a', url: 'https://a.example.invalid/rpc', timeoutMs: 1000 },
    { sourceId: 'provider-b', url: 'https://b.example.invalid/rpc', timeoutMs: 2000 },
  ],
  addresses: {
    lock: `0x${'11'.repeat(20)}`,
    eventTrigger: ergoAddress,
    permit: ergoAddress,
    fraud: ergoAddress,
    commitment: ergoAddress,
  },
  tokens: { rwt: '22'.repeat(32) },
  calculatorAddresses: [`0x${'33'.repeat(20)}`],
  intervalMs: 5000,
  health: { blockTime: 2 },
});
/** Flat scanner thresholds for the synthetic service deployment. */
export const avalancheHealthCheckData = () => ({
  avalancheScannerWarnDiff: 5,
  avalancheScannerCriticalDiff: 10,
});
/** Supply a real AVAX map and optional JOE with synthetic wrapped Ergo counterparts. */
export const tokenMapFixture = async (withTokens = false, withWrapped = false) => {
  const tokenMap = new TokenMap();
  await tokenMap.updateConfigByJson([
    {
      avalanche: {
        tokenId: 'avax',
        name: 'AVAX',
        decimals: 18,
        type: 'native',
        residency: 'native',
        extra: {},
      },
      ergo: {
        tokenId: '44'.repeat(32),
        name: 'rsAVAX',
        decimals: 8,
        type: 'token',
        residency: 'wrapped',
        extra: {},
      },
    },
    ...(withTokens
      ? [
          {
            avalanche: {
              tokenId: '0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd',
              name: 'JOE',
              decimals: 18,
              type: 'ERC-20',
              residency: 'native',
              extra: {},
            },
            ergo: {
              tokenId: '55'.repeat(32),
              name: 'synthetic rsJOE',
              decimals: 9,
              type: 'EIP-004',
              residency: 'wrapped',
              extra: {},
            },
          },
        ]
      : []),
  ]);
  if (withWrapped)
    await tokenMap.updateConfigByJson([
      ...tokenMap.getRawConfig(),
      {
        avalanche: {
          tokenId: `0x${'56'.repeat(20)}`,
          name: 'synthetic wrapped asset',
          decimals: 18,
          type: 'ERC-20',
          residency: 'wrapped',
          extra: {},
        },
        ergo: {
          tokenId: '66'.repeat(32),
          name: 'synthetic wrapped counterpart',
          decimals: 9,
          type: 'EIP-004',
          residency: 'wrapped',
          extra: {},
        },
        ethereum: {
          tokenId: `0x${'78'.repeat(20)}`,
          name: 'synthetic native origin',
          decimals: 18,
          type: 'ERC-20',
          residency: 'native',
          extra: {},
        },
      },
    ]);
  return tokenMap;
};
/** Create a manually released promise for overlap tests without timers or services. */
export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};
/** Construct a real Ergo scanner without updating or initializing a data source. */
export const createErgoScannerFixture = () =>
  new ErgoScanner({
    dataSource: commitmentSource,
    initialHeight: 0,
    network: new ErgoExplorerNetwork('https://ergo.example.invalid'),
  });
/** Construct actual scanner health using only in-memory repository API doubles. */
export const createHealthFixture = async (
  config: AvalancheServiceConfig = parseAvalancheConfig(
    avalancheConfigData(),
    avalancheHealthCheckData(),
  )!,
) => {
  const fixture = databaseFixture();
  const scanner = await createAvalancheScanner(config, fixture.dataSource, await tokenMapFixture());
  const block = Object.assign(new BlockEntity(), { height: 10, timestamp: Date.now() / 1000 });
  const findBlocks = vi
    .spyOn(fixture.dataSource.getRepository(BlockEntity), 'find')
    .mockResolvedValue([block]);
  const health = createAvalancheScannerHealth(config, fixture.dataSource, scanner);
  return { ...fixture, config, scanner, block, findBlocks, health };
};
/** Build actual scanner and GuardRPC consumers over minimal API doubles. */
export const createCalculatorFixture = async (mainnet = false, withWrapped = false) => {
  const chainId = mainnet ? 43114 : 43113;
  const database = databaseFixture(chainId);
  const config = parseAvalancheConfig(
    { ...avalancheConfigData(), chainId },
    avalancheHealthCheckData(),
  )!;
  const tokenMap = await tokenMapFixture(mainnet, withWrapped);
  const scanner = await createAvalancheScanner(config, database.dataSource, tokenMap);
  const rpc = finalizedRpcFixture(chainId);
  const calculator = createAvalancheCalculatorConfig(config, database.dataSource, scanner);
  return { ...database, config, scanner, rpc, calculator, tokenMap };
};

/** Call the selected actual Service ERC20 reader using the official JOE source identity. */
export const readCalculatorToken = (
  fixture: Awaited<ReturnType<typeof createCalculatorFixture>>,
  operation: 'balance' | 'supply',
) =>
  operation === 'balance'
    ? fixture.calculator.source.getAddressBalanceForERC20Asset!(
        fixture.config.calculatorAddresses[0],
        '0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd',
      )
    : fixture.calculator.source.getERC20AssetTotalSupply!(
        '0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd',
      );
