import type { FeeData } from 'ethers';

import type { TokenMap } from '@rosen-bridge/tokens';
import {
  type CalculateFee,
  calculateFeeCreator,
  getMinTransferCreator as getMinTransferCreatorBase,
} from '@rosen-network/base';

import { AVALANCHE_CHAIN, type AvalancheChainId, assertAvalancheChainId } from './constants';
import { assertAvalancheToken, captureAvalancheTokenPolicy } from './tokenPolicy';

export interface AvalancheProvider {
  getNetwork(): Promise<{ chainId: bigint }>;
  getBlockNumber(): Promise<number>;
  getFeeData(): Promise<FeeData>;
}

/** Check an endpoint against the explicitly selected C-Chain deployment. */
export const assertProviderIdentity = async (
  provider: AvalancheProvider,
  chainId: AvalancheChainId,
): Promise<void> => {
  assertAvalancheChainId(chainId);
  if ((await provider.getNetwork()).chainId !== BigInt(chainId)) {
    throw new Error('Avalanche provider chain mismatch');
  }
};

/** Read a height only while the endpoint retains the selected C-Chain identity. */
export const getHeightCreator = (provider: AvalancheProvider, chainId: AvalancheChainId) => {
  assertAvalancheChainId(chainId);
  return async (): Promise<number> => {
    await assertProviderIdentity(provider, chainId);
    const height = await provider.getBlockNumber();
    await assertProviderIdentity(provider, chainId);
    if (!Number.isSafeInteger(height) || height < 0)
      throw new Error('Invalid Avalanche block height');
    return height;
  };
};

/** Bind the existing Rosen fee reader to a qualified Avalanche endpoint. */
export const calculateFeeCreatorForAvalanche = (
  provider: AvalancheProvider,
  chainId: AvalancheChainId,
) => calculateFeeCreator(AVALANCHE_CHAIN, getHeightCreator(provider, chainId));

/** Bind the shared minimum-transfer calculation and reject unavailable fee results. */
export const getMinTransferCreator = (calculateFee: CalculateFee) => {
  const create = getMinTransferCreatorBase(AVALANCHE_CHAIN, calculateFee);
  return (getTokenMap: () => Promise<TokenMap>): ReturnType<typeof create> => {
    return async (...args) => {
      const [token] = args;
      assertAvalancheToken(token);
      const tokenMap = await getTokenMap();
      const policy = captureAvalancheTokenPolicy(tokenMap, token);
      const minimum = await create(async () => tokenMap)(...args);
      policy.assertCurrent();
      if (minimum <= 0n) throw new Error('Avalanche minimum transfer fee is unavailable');
      return minimum;
    };
  };
};
