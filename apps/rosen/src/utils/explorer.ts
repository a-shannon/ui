import { getAddressUrl as getCoreAddressUrl, getTxURL as getCoreTxURL } from '@rosen-ui/utils';

import { avalancheConfig } from '@/networks/avalanche/selection';

/** Select the configured C-Chain while preserving other networks' explorer routes. */
export const getTxURL = (...args: Parameters<typeof getCoreTxURL>) =>
  getCoreTxURL(args[0], args[1], avalancheConfig?.chainId);

/** Use the same explicit C-Chain selection for custody and recipient links. */
export const getAddressUrl = (...args: Parameters<typeof getCoreAddressUrl>) =>
  getCoreAddressUrl(args[0], args[1], avalancheConfig?.chainId);
