import { Interface, isAddress } from 'ethers';

import type { TokenMap } from '@rosen-bridge/tokens';
import { validateAddress } from '@rosen-network/base';
import { generateLockData, generateTxParameters } from '@rosen-network/evm';

import type { AvalancheNetworkConfig } from './client';
import { getMaxTransferCreator } from './getMaxTransfer';
import {
  assertAvalancheLockAmount,
  assertAvalancheToken,
  captureAvalancheTokenPolicy,
} from './tokenPolicy';
import {
  type AvalancheProvider,
  calculateFeeCreatorForAvalanche,
  getMinTransferCreator,
} from './utils';

/** Network deployment inputs supplied by the application's existing configuration. */
export type AvalancheActionsConfig = Readonly<
  Pick<AvalancheNetworkConfig, 'chainId' | 'lockAddress' | 'nextHeightInterval'> & {
    rosenChainIndex: number;
    gasReserveLimit: bigint;
  }
>;

/** Join qualified provider reads to the existing Rosen fee and EVM lock producers. */
export const createAvalancheActions = (
  config: AvalancheActionsConfig,
  provider: AvalancheProvider,
  getTokenMap: () => Promise<TokenMap>,
) => {
  const pinned = Object.freeze({ ...config });
  const calculateFee = calculateFeeCreatorForAvalanche(provider, pinned.chainId);
  return {
    calculateFee,
    /** Read the provider's current chain identity for the network consumer. */
    getProviderChainId: async () => (await provider.getNetwork()).chainId,
    getMaxTransfer: getMaxTransferCreator(getTokenMap, {
      chainId: pinned.chainId,
      provider,
      gasReserveLimit: pinned.gasReserveLimit,
    }),
    getMinTransfer: getMinTransferCreator(calculateFee)(getTokenMap),
    validateAddress,
    /** Produce a funded direct lock using the actual selected-asset conversion policy. */
    generateTxParameters: async (...args: Parameters<ReturnType<typeof generateTxParameters>>) => {
      assertAvalancheToken(args[5]);
      args[5] = Object.freeze({ ...args[5] });
      if (
        args[0] !== args[5].tokenId ||
        args[6] !== 'avalanche' ||
        !/^(?:[0-9a-f]{2}){19,273}$/.test(args[4]) ||
        Number.parseInt(args[4].slice(34, 36), 16) !== (args[4].length - 36) / 2 ||
        !isAddress(args[1]) ||
        !isAddress(args[2]) ||
        args[1].toLowerCase() !== pinned.lockAddress.toLowerCase()
      ) {
        throw new Error('Invalid Avalanche lock parameters');
      }
      assertAvalancheLockAmount(
        args[3],
        BigInt(`0x${args[4].slice(2, 18)}`),
        BigInt(`0x${args[4].slice(18, 34)}`),
      );
      const tokenMap = await getTokenMap();
      const policy = captureAvalancheTokenPolicy(tokenMap, args[5]);
      const rawAmount = policy.unwrapAmount(args[3]).amount;
      if (rawAmount <= 0n) throw new Error('Invalid Avalanche raw amount');
      const expected = policy.isNative ? `0x${rawAmount.toString(16)}` : undefined;
      const expectedData = policy.isNative
        ? `0x${args[4]}`
        : new Interface(['function transfer(address,uint256)']).encodeFunctionData('transfer', [
            args[1],
            rawAmount,
          ]) + args[4];
      const transaction = await generateTxParameters(async () => tokenMap)(...args);
      policy.assertCurrent();
      if (
        transaction.value !== expected ||
        transaction.to.toLowerCase() !== (policy.isNative ? args[1] : args[0]).toLowerCase() ||
        transaction.from.toLowerCase() !== args[2].toLowerCase() ||
        transaction.data !== expectedData
      )
        throw new Error('Avalanche lock parameters changed');
      return transaction;
    },
    /** Encode Rosen metadata with the explicit assignment for an Avalanche destination. */
    generateLockData: (...args: Parameters<typeof generateLockData>) => {
      const [chain, address, networkFee, bridgeFee] = args;
      return generateLockData(
        chain,
        address,
        networkFee,
        bridgeFee,
        chain === 'avalanche' ? pinned.rosenChainIndex : undefined,
      );
    },
  };
};
