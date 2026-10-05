import { FeeData } from 'ethers';
import { vi } from 'vitest';

import { generateTxParameters } from '@rosen-network/evm';

import { AvalancheNetwork } from '../src/client';
import { getMaxTransferCreator } from '../src/getMaxTransfer';
import { captureAvalancheTokenPolicy } from '../src/tokenPolicy';
import { getMinTransferCreator } from '../src/utils';
import { exampleLock, exampleMetadata, exampleSender, joe, joeCounterpart } from './erc20TestData';
import { createMap } from './testUtils';

/** Extend a real AVAX map with a standard token and distinct synthetic Ergo counterpart. */
export const createMixedMap = async () => {
  const map = await createMap();
  await map.updateConfigByJson([
    ...map.getRawConfig(),
    {
      avalanche: joe,
      ergo: { ...joe, tokenId: joeCounterpart, decimals: 8, type: 'token', residency: 'wrapped' },
    },
  ]);
  return map;
};

/** Real conversion/producer/minimum/maximum helpers with synthetic mainnet observers only. */
export const createTokenFixture = async () => {
  const map = await createMixedMap();
  const provider = {
    getNetwork: vi.fn().mockResolvedValue({ chainId: 43114n }),
    getBlockNumber: vi.fn().mockResolvedValue(100),
    getFeeData: vi.fn().mockResolvedValue(new FeeData(5n, 10n, 1n)),
  };
  const calculateFee = vi.fn().mockResolvedValue({ fees: { bridgeFee: 2n, networkFee: 3n } });
  const generator = vi.fn(generateTxParameters(async () => map));
  const config = {
    chainId: 43114 as const,
    lockAddress: exampleLock,
    nextHeightInterval: 50,
    getProviderChainId: vi.fn().mockResolvedValue(43114n),
    getWalletChainId: vi.fn().mockResolvedValue(43114n),
    getTokenMap: vi.fn(async () => map),
    calculateFee,
    generateLockData: vi.fn().mockResolvedValue(exampleMetadata),
    generateTxParameters: generator,
    getMaxTransfer: getMaxTransferCreator(async () => map, {
      chainId: 43114,
      provider,
      gasReserveLimit: 30000n,
    }),
    getMinTransfer: getMinTransferCreator(calculateFee)(async () => map),
    validateAddress: vi.fn().mockResolvedValue(true),
  };
  const network = new AvalancheNetwork(config);
  const generate = () =>
    network.generateTxParameters(
      joe.tokenId,
      exampleLock,
      exampleSender,
      10n,
      exampleMetadata,
      joe,
      'avalanche',
    );
  const maximum = {
    balance: 100n,
    isNative: false,
    token: joe,
    eventData: { fromAddress: exampleSender, toAddress: 'synthetic', toChain: 'ergo' as const },
  };
  return { map, provider, calculateFee, config, generator, network, generate, maximum };
};

/** Change one mapped field after an actual asynchronous generator join. */
export const mutateDuringGeneration = async (
  fixture: Awaited<ReturnType<typeof createTokenFixture>>,
) => {
  fixture.generator.mockImplementation(async (...args) => {
    const result = await generateTxParameters(async () => fixture.map)(...args);
    const raw = fixture.map.getRawConfig();
    raw[1].ergo.decimals = 9;
    await fixture.map.updateConfigByJson(raw);
    return result;
  });
};

/** Capture an ERC20 policy with the actual full raw map. */
export const tokenPolicy = async () => captureAvalancheTokenPolicy(await createMixedMap(), joe);
