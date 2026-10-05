import { TokenMap } from '@rosen-bridge/tokens';

import { joe, lock } from './guardAssetsBalanceTestData';

/** Generates a fresh wrapped-unit AVAX/JOE cache page with absent cold custody. */
export const payload = () => ({
  chainId: 43114,
  hot: {
    total: 2,
    items: [
      {
        chain: 'avalanche',
        address: lock,
        balance: {
          tokenId: 'avax',
          amount: '100000000000',
          decimals: 9,
          isNativeToken: true,
        },
      },
      {
        chain: 'avalanche',
        address: lock,
        balance: {
          tokenId: joe,
          amount: '9007199254740993123456789',
          decimals: 9,
          isNativeToken: false,
        },
      },
    ],
  },
  cold: { items: [], total: 0 },
});

/** Creates a real TokenMap with native18 metadata and synthetic wrapped9 counterparts. */
export const createWrappedTokenMap = async () => {
  const map = new TokenMap();
  await map.updateConfigByJson(
    ['avax', joe].map((tokenId, index) => ({
      avalanche: {
        tokenId,
        name: index ? 'JOE' : 'AVAX',
        decimals: 18,
        type: index ? 'ERC-20' : 'native',
        residency: 'native',
        extra: {},
      },
      ergo: {
        tokenId: (index ? '22' : '33').repeat(32),
        name: index ? 'rsJOE' : 'rsAVAX',
        decimals: 9,
        type: 'EIP-004',
        residency: 'wrapped',
        extra: {},
      },
    })),
  );
  return map;
};
