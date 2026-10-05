import type { MetaMaskSDK } from '@metamask/sdk';
import { vi } from 'vitest';

import { TokenMap } from '@rosen-bridge/tokens';
import { type AvalancheChainId, AvalancheNetwork } from '@rosen-network/avalanche';
import { generateLockData, generateTxParameters } from '@rosen-network/evm';

import { MetaMaskWallet } from '../src/wallet';
import { createProviderMock } from './mocked/provider.mock';
import { avax, lock } from './testData';

/** Construct a real network and token conversion with an entirely synthetic EIP-1193 provider. */
export const createWallet = async (chainId: AvalancheChainId = 43113) => {
  const tokenMap = new TokenMap();
  await tokenMap.updateConfigByJson([
    {
      avalanche: avax,
      ergo: {
        ...avax,
        tokenId: '55'.repeat(32),
        decimals: 8,
        type: 'token',
        residency: 'wrapped',
      },
    },
  ]);
  const { request, provider, sdk } = createProviderMock(chainId);
  const network = new AvalancheNetwork({
    chainId,
    lockAddress: lock,
    nextHeightInterval: 50,
    getProviderChainId: async () => BigInt(chainId),
    getWalletChainId: async () => BigInt(chainId),
    getTokenMap: async () => tokenMap,
    calculateFee: vi.fn(),
    getMaxTransfer: vi.fn(),
    getMinTransfer: vi.fn(),
    validateAddress: vi.fn(),
    generateLockData,
    generateTxParameters: generateTxParameters(async () => tokenMap),
  });
  const config = { networks: [network], getTokenMap: async () => tokenMap };
  const wallet = new MetaMaskWallet(config);
  Object.assign(wallet, { _api: sdk as unknown as MetaMaskSDK });
  return { wallet, network, provider, request, config, sdk, tokenMap };
};
