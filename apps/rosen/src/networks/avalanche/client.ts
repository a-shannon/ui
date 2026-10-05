import { AvalancheNetwork } from '@rosen-network/avalanche';

import { unwrapFromObject } from '@/safeServerAction';
import { getTokenMap } from '@/tokenMap/getClientTokenMap';

import { avalancheConfig as config } from './selection';
import * as actions from './server';

/** Optional configured network, sharing the SDK provider used by the real MetaMask wallet. */
export const avalanche: AvalancheNetwork | undefined = config
  ? new AvalancheNetwork({
      ...config,
      ...unwrapFromObject(actions),
      getTokenMap,
      /** Read chain identity from the same MetaMask SDK provider used for transfers. */
      getWalletChainId: async (): Promise<bigint> => {
        const { metaMask } = await import('@/wallets/metaMask');
        return metaMask.getEvmChainId();
      },
    })
  : undefined;
