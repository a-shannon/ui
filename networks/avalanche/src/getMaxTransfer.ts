import type { TokenMap } from '@rosen-bridge/tokens';
import type { NetworkMaxTransferParams } from '@rosen-network/base';

import { type AvalancheChainId, assertAvalancheChainId } from './constants';
import { assertAvalancheToken, captureAvalancheTokenPolicy } from './tokenPolicy';
import { type AvalancheProvider, assertProviderIdentity } from './utils';

// 21,000 base gas plus 16 gas for each byte of the largest Rosen metadata payload.
export const MINIMUM_NATIVE_LOCK_GAS_RESERVE = 25368n;

export type AvalancheTransferConfig = {
  chainId: AvalancheChainId;
  provider: AvalancheProvider;
  gasReserveLimit: bigint;
};

/** Reserve a configured native-lock gas budget, rounding up in Rosen wrapped units. */
export const getMaxTransferCreator = (
  getTokenMap: () => Promise<TokenMap>,
  config: AvalancheTransferConfig,
) => {
  const { chainId, provider, gasReserveLimit } = config;
  assertAvalancheChainId(chainId);
  if (typeof gasReserveLimit !== 'bigint' || gasReserveLimit < MINIMUM_NATIVE_LOCK_GAS_RESERVE) {
    throw new Error('Avalanche native lock gas reserve is insufficient');
  }
  return async ({ balance, isNative, token }: NetworkMaxTransferParams): Promise<bigint> => {
    if (!isNative && !token) throw new Error('Avalanche token maximum requires asset identity');
    if (token) {
      assertAvalancheToken(token);
      if (isNative !== (token.type === 'native'))
        throw new Error('Avalanche maximum asset mismatch');
    }
    if (typeof balance !== 'bigint' || balance < 0n) throw new Error('Invalid Avalanche balance');
    const tokenMap = await getTokenMap();
    const policy = captureAvalancheTokenPolicy(tokenMap, token);
    await assertProviderIdentity(provider, chainId);
    if (!isNative) {
      // This is an asset balance cap; wallet submission must qualify AVAX gas separately.
      await assertProviderIdentity(provider, chainId);
      policy.assertCurrent();
      return balance;
    }
    const feeData = await provider.getFeeData();
    policy.assertCurrent();
    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (typeof gasPrice !== 'bigint' || gasPrice <= 0n)
      throw new Error('Invalid Avalanche gas price');
    if (
      feeData.maxPriorityFeePerGas !== null &&
      (feeData.maxPriorityFeePerGas < 0n || feeData.maxPriorityFeePerGas > gasPrice)
    ) {
      throw new Error('Invalid Avalanche priority fee');
    }
    const fee = gasPrice * gasReserveLimit;
    const wrapped = policy.wrapAmount(fee).amount;
    if (typeof wrapped !== 'bigint' || wrapped < 0n) throw new Error('Invalid AVAX wrapped fee');
    const restored = policy.unwrapAmount(wrapped).amount;
    if (typeof restored !== 'bigint' || restored < 0n)
      throw new Error('Invalid AVAX unwrapped fee');
    const reserve = restored < fee ? wrapped + 1n : wrapped;
    const covered = policy.unwrapAmount(reserve).amount;
    if (typeof covered !== 'bigint' || covered < fee) {
      throw new Error('AVAX fee conversion does not cover the gas reserve');
    }
    await assertProviderIdentity(provider, chainId);
    policy.assertCurrent();
    const available = balance - reserve;
    return available < 0n ? 0n : available;
  };
};
