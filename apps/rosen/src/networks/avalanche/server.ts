'use server';

import { env } from '@/env';
import { wrap } from '@/safeServerAction';
import { getTokenMap } from '@/tokenMap/getServerTokenMap';

import { LOCK_ADDRESSES } from '../../../configs';
import { createAvalancheAppActions } from './actions';
import { parseAvalancheAppConfig } from './config';
import { createAvalancheEndpointProvider } from './provider';

let actions: ReturnType<typeof createAvalancheAppActions> | undefined;

/** Construct server actions only for a complete, explicit Avalanche deployment. */
const getActions = () => {
  if (actions) return actions;
  const config = parseAvalancheAppConfig(
    env.NEXT_PUBLIC_AVALANCHE_CONFIG,
    LOCK_ADDRESSES.avalanche,
  );
  if (!config || !env.AVALANCHE_RPC_API)
    throw new Error('Avalanche application network is disabled');
  actions = createAvalancheAppActions(
    config,
    createAvalancheEndpointProvider(env.AVALANCHE_RPC_API, config.chainId),
    getTokenMap,
  );
  return actions;
};

export const calculateFee = wrap(
  (...args: Parameters<ReturnType<typeof createAvalancheAppActions>['calculateFee']>) =>
    getActions().calculateFee(...args),
  { traceKey: 'avalanche:calculateFee' },
);
export const getProviderChainId = wrap(() => getActions().getProviderChainId(), {
  traceKey: 'avalanche:getProviderChainId',
});
export const generateLockData = wrap(
  (...args: Parameters<ReturnType<typeof createAvalancheAppActions>['generateLockData']>) =>
    getActions().generateLockData(...args),
  { traceKey: 'avalanche:generateLockData' },
);
export const generateTxParameters = wrap(
  (...args: Parameters<ReturnType<typeof createAvalancheAppActions>['generateTxParameters']>) =>
    getActions().generateTxParameters(...args),
  { traceKey: 'avalanche:generateTxParameters' },
);
export const getMaxTransfer = wrap(
  (...args: Parameters<ReturnType<typeof createAvalancheAppActions>['getMaxTransfer']>) =>
    getActions().getMaxTransfer(...args),
  { traceKey: 'avalanche:getMaxTransfer' },
);
export const getMinTransfer = wrap(
  (...args: Parameters<ReturnType<typeof createAvalancheAppActions>['getMinTransfer']>) =>
    getActions().getMinTransfer(...args),
  { traceKey: 'avalanche:getMinTransfer' },
);
export const validateAddress = wrap(
  (...args: Parameters<ReturnType<typeof createAvalancheAppActions>['validateAddress']>) =>
    getActions().validateAddress(...args),
  { traceKey: 'avalanche:validateAddress' },
);
