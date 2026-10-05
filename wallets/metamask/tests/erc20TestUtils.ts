import type { MetaMaskSDK } from '@metamask/sdk';
import { vi } from 'vitest';

import { TokenMap } from '@rosen-bridge/tokens';
import { AvalancheNetwork } from '@rosen-network/avalanche';
import { generateLockData, generateTxParameters } from '@rosen-network/evm';

import { exampleLock, exampleSender } from '../../../networks/avalanche/tests/erc20TestData';
import { MetaMaskWallet } from '../src/wallet';
import { generatedOverlay } from './erc20TestData';
import { createProviderMock } from './mocked/provider.mock';

/** Join real map conversion, EVM producer, Avalanche facade and wallet against synthetic RPCs. */
export const createTokenWallet = async (counterpartDecimals = 9) => {
  const tokenMap = new TokenMap();
  const rawMap = structuredClone(generatedOverlay);
  rawMap[1].ergo.decimals = counterpartDecimals;
  await tokenMap.updateConfigByJson(rawMap);
  const { provider, request, sdk } = createProviderMock(43114);
  const normal = request.getMockImplementation()!;
  request.mockImplementation(async (input) => {
    if (input.method === 'eth_accounts') return [exampleSender];
    if (input.method === 'eth_call') return `0x${100000000000n.toString(16).padStart(64, '0')}`;
    if (input.method === 'eth_gasPrice') return '0x2';
    return await normal(input);
  });
  const chain = { provider: 43114n };
  const mapReader = { value: tokenMap };
  let wallet: MetaMaskWallet;
  const network = new AvalancheNetwork({
    chainId: 43114,
    lockAddress: exampleLock,
    nextHeightInterval: 50,
    getProviderChainId: vi.fn(async () => chain.provider),
    getWalletChainId: async () => wallet.getEvmChainId(),
    getTokenMap: async () => mapReader.value,
    calculateFee: vi.fn(),
    getMaxTransfer: vi.fn(),
    getMinTransfer: vi.fn(),
    validateAddress: vi.fn(),
    generateLockData,
    generateTxParameters: generateTxParameters(async () => mapReader.value),
  });
  wallet = new MetaMaskWallet({ networks: [network], getTokenMap: async () => mapReader.value });
  Object.assign(wallet, { _api: sdk as unknown as MetaMaskSDK });
  return { wallet, network, provider, request, sdk, tokenMap, chain, mapReader };
};
