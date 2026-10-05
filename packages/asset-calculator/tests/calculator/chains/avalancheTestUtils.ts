import { vi } from 'vitest';

import { type RosenTokens, TokenMap } from '@rosen-bridge/tokens';

import { AvalancheCalculator } from '../../../lib/calculator/chains/avalanche-calculator';

/** Official JOE source address; counterpart and custody values are synthetic fixtures. */
export const joe = '0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd';

/** Supply AVAX/JOE mainnet formats, optionally adding a synthetic wrapped token from another origin. */
export const tokenData = (withTokens = false, wrapped = false): RosenTokens => {
  const mapping: RosenTokens = [
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
        tokenId: 'ab'.repeat(32),
        name: 'rsAVAX',
        decimals: 9,
        type: 'EIP-004',
        residency: 'wrapped',
        extra: {},
      },
    },
  ];
  if (withTokens)
    mapping.push({
      avalanche: {
        tokenId: wrapped ? `0x${'56'.repeat(20)}` : joe,
        name: wrapped ? 'synthetic wrapped asset' : 'JOE',
        decimals: 18,
        type: 'ERC-20',
        residency: wrapped ? 'wrapped' : 'native',
        extra: {},
      },
      ergo: {
        tokenId: 'cd'.repeat(32),
        name: 'synthetic counterpart',
        decimals: 9,
        type: 'EIP-004',
        residency: 'wrapped',
        extra: {},
      },
      ...(wrapped
        ? {
            ethereum: {
              tokenId: `0x${'78'.repeat(20)}`,
              name: 'synthetic origin',
              decimals: 18,
              type: 'ERC-20',
              residency: 'native',
              extra: {},
            },
          }
        : {}),
    });
  return mapping;
};

/** Use the actual map and calculator with deterministic qualified-source boundary doubles. */
export const setup = async (withTokens = false, wrapped = false) => {
  const tokens = new TokenMap();
  await tokens.updateConfigByJson(tokenData(withTokens, wrapped));
  const source = {
    expectedChainId: withTokens ? 43114n : 43113n,
    assertNetwork: vi.fn(async () => {}),
    getAddressBalanceForNativeToken: vi.fn(async () => 10n ** 18n),
    getAddressBalanceForERC20Asset: vi.fn(async (_address: string, _id: string) => 10000000000n),
    getERC20AssetTotalSupply: vi.fn(async (_id: string) => 1000000000000n),
  };
  const config = {
    chainId: withTokens ? (43114 as const) : (43113 as const),
    sourceId: 'synthetic-rpc',
    addresses: [`0x${'12'.repeat(20)}`, `0x${'34'.repeat(20)}`],
    source,
  };
  const calculator = new AvalancheCalculator(tokens, config);
  const token = tokens.getTokens('avalanche', 'avalanche')[withTokens ? 1 : 0];
  return { tokens, source, config, calculator, token };
};
