import { TokenMap } from '@rosen-bridge/tokens';

import { avax } from './testData';

/** Real TokenMap with a synthetic native AVAX/Ergo wrapped pair. */
export const createMap = async (wrappedDecimals = 8) => {
  const map = new TokenMap();
  await map.updateConfigByJson([
    {
      avalanche: avax,
      ergo: {
        ...avax,
        tokenId: '55'.repeat(32),
        decimals: wrappedDecimals,
        type: 'token',
        residency: 'wrapped',
      },
    },
  ]);
  return map;
};
