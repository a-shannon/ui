import { MetaMaskWallet } from '@rosen-ui/metamask-wallet';

import { avalanche, binance, ethereum } from '@/networks';
import { getTokenMap } from '@/tokenMap/getClientTokenMap';

export const metaMask: MetaMaskWallet = new MetaMaskWallet({
  networks: [binance, ethereum, ...(avalanche ? [avalanche] : [])],
  getTokenMap,
});
