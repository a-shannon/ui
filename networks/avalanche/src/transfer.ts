import { Interface } from 'ethers';

import type { AvalancheNetwork } from './client';

/** Native or token payload shared by generation validation and wallet submission. */
export type AvalancheTransferTransaction = Awaited<
  ReturnType<AvalancheNetwork['generateTxParameters']>
>;

/** Construct the exact transfer bytes independently of the configured producer. */
export const buildAvalancheTransfer = (
  from: string,
  lockAddress: string,
  tokenId: string,
  rawAmount: bigint,
  metadata: string,
  isNative: boolean,
  chainId: string,
): Readonly<AvalancheTransferTransaction> => {
  if (typeof rawAmount !== 'bigint' || rawAmount <= 0n || rawAmount >= 1n << 256n) {
    throw new Error('Invalid Avalanche amount');
  }
  return Object.freeze({
    from,
    to: isNative ? lockAddress : tokenId,
    data: isNative
      ? `0x${metadata}`
      : new Interface(['function transfer(address,uint256) returns (bool)']).encodeFunctionData(
          'transfer',
          [lockAddress, rawAmount],
        ) + metadata,
    ...(isNative ? { value: `0x${rawAmount.toString(16)}` } : {}),
    chainId,
  });
};

/** Compare every generated transfer field with the independently retained payload. */
export const assertAvalancheTransfer = (
  candidate: AvalancheTransferTransaction,
  transaction: AvalancheTransferTransaction,
): void => {
  if (
    candidate.from.toLowerCase() !== transaction.from.toLowerCase() ||
    candidate.to.toLowerCase() !== transaction.to.toLowerCase() ||
    candidate.data !== transaction.data ||
    candidate.value !== transaction.value ||
    candidate.chainId !== transaction.chainId
  )
    throw new Error('Avalanche transaction parameters changed');
};

/** Decode a canonical RPC quantity without permitting a uint256 overflow. */
export const avalancheQuantity = (value: unknown, label: string): bigint => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) {
    throw new Error(`Invalid Avalanche ${label}`);
  }
  const amount = BigInt(value);
  if (amount >= 1n << 256n) throw new Error(`Invalid Avalanche ${label}`);
  return amount;
};

/** Qualify estimated gas against the exact lock calldata's intrinsic cost. */
export const qualifyAvalancheTransferGas = (estimatedGas: unknown, data: string): bigint => {
  if (typeof estimatedGas !== 'string' || !/^0x[1-9a-f][0-9a-f]*$/.test(estimatedGas)) {
    throw new Error('Invalid Avalanche gas estimate');
  }
  const dataBytes = data.slice(2).match(/../g) ?? [];
  const intrinsicGas = dataBytes.reduce(
    (total, byte) => total + (byte === '00' ? 4n : 16n),
    21000n,
  );
  const gas = BigInt(estimatedGas);
  if (gas < intrinsicGas || gas > (1n << 64n) - 1n) {
    throw new Error('Avalanche gas estimate does not cover the lock transaction');
  }
  return gas;
};

/** Bound the token transfer's native gas reserve without rounding. */
export const avalancheTransferGasReserve = (gas: bigint, quote: unknown) => {
  const price = avalancheQuantity(quote, 'gas price');
  const reserve = gas * price;
  if (price === 0n || reserve >= 1n << 256n) throw new Error('Invalid Avalanche gas reserve');
  return { gasPrice: `0x${price.toString(16)}`, reserve };
};
