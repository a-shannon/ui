import { isAddress as isValidAddress } from 'ethers';

import type { AvalancheChainId } from '@rosen-network/avalanche';
import { NETWORKS, RESERVED_ROSEN_CHAIN_INDEXES } from '@rosen-ui/constants';

export type AvalancheAppConfig = Readonly<{
  chainId: AvalancheChainId;
  lockAddress: string;
  rosenChainIndex: number;
  nextHeightInterval: number;
  gasReserveLimit: bigint;
}>;

/** Parse an optional deployment; an incomplete selection never enables Avalanche. */
export const parseAvalancheAppConfig = (
  raw: string | undefined,
  lockAddress: string | undefined,
): AvalancheAppConfig | undefined => {
  if (!raw?.trim()) return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid Avalanche application configuration');
  }
  const value = parsed as Record<string, unknown>;
  const keys = ['chainId', 'rosenChainIndex', 'nextHeightInterval', 'gasReserveLimit'];
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error('Unknown Avalanche application configuration field');
  }
  if (value.chainId !== 43113 && value.chainId !== 43114) {
    throw new Error('Select an explicit Avalanche C-Chain deployment');
  }
  const index = value.rosenChainIndex;
  if (
    typeof index !== 'number' ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > 255 ||
    Object.values(NETWORKS).some((network) => network.index === index) ||
    RESERVED_ROSEN_CHAIN_INDEXES.some((reserved) => reserved === index)
  ) {
    throw new Error('Invalid or occupied Rosen Avalanche destination index');
  }
  if (
    typeof value.nextHeightInterval !== 'number' ||
    !Number.isSafeInteger(value.nextHeightInterval) ||
    value.nextHeightInterval < 0
  ) {
    throw new Error('Invalid Avalanche fee height interval');
  }
  if (
    typeof value.gasReserveLimit !== 'string' ||
    !/^[1-9][0-9]*$/.test(value.gasReserveLimit) ||
    BigInt(value.gasReserveLimit) < 25368n ||
    BigInt(value.gasReserveLimit) > 0xffffffffffffffffn
  ) {
    throw new Error('Invalid Avalanche native-lock gas reserve');
  }
  if (!lockAddress || !isValidAddress(lockAddress) || /^0x0{40}$/i.test(lockAddress)) {
    throw new Error('Avalanche requires the Rosen-configured lock address');
  }
  return Object.freeze({
    chainId: value.chainId,
    rosenChainIndex: index,
    nextHeightInterval: value.nextHeightInterval,
    gasReserveLimit: BigInt(value.gasReserveLimit),
    lockAddress,
  });
};
