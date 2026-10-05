import { TokenMap } from '@rosen-bridge/tokens';
import { AvalancheNetwork } from '@rosen-network/avalanche';

import { createAvalancheAppActions } from '../../../src/networks/avalanche/actions';
import { createAvalancheAppProvider } from '../../../src/networks/avalanche/provider';
import { avax, actionConfig as config, destination } from './testData';

/** Real producers and TokenMap; only the RPC and wallet identity boundaries are supplied. */
export const createFixture = async () => {
  const map = new TokenMap();
  await map.updateConfigByJson([
    {
      avalanche: avax,
      ergo: { ...avax, tokenId: '55'.repeat(32), decimals: 8, type: 'token', residency: 'wrapped' },
    },
  ]);
  const provider = createAvalancheAppProvider(
    {
      send: async (method: string) => {
        if (method === 'eth_chainId') return '0xa869';
        throw new Error(`Unexpected RPC in native transaction fixture: ${method}`);
      },
    },
    config.chainId,
  );
  const getTokenMap = async () => map;
  const actions = createAvalancheAppActions(config, provider, getTokenMap);
  const network = new AvalancheNetwork({
    ...config,
    ...actions,
    getTokenMap,
    getWalletChainId: async () => 43113n,
  });
  const data = await actions.generateLockData('ethereum', destination, '3', '2');
  return { map, actions, network, data };
};
