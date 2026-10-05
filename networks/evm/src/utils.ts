import { type FeeData, isAddress, JsonRpcProvider } from 'ethers';

import { encodeAddress } from '@rosen-bridge/address-codec';
import { NETWORKS } from '@rosen-ui/constants';
import type { Network } from '@rosen-ui/types';

import { EvmChains } from './types';

/**
 * generates metadata for lock transaction
 * @param toChain
 * @param toAddress
 * @param fromAddress
 * @param networkFee
 * @param bridgeFee
 * @returns
 */
export const generateLockData = async (
  toChain: Network,
  toAddress: string,
  networkFee: string,
  bridgeFee: string,
): Promise<string> => {
  // parse toChain
  const toChainCode = (NETWORKS[toChain]?.index ?? -1) as number;
  if (toChainCode === -1) throw Error(`invalid toChain [${toChain}]`);
  const toChainHex = toChainCode.toString(16).padStart(2, '0');

  const bridgeFeeHex = encodeFee(bridgeFee);
  const networkFeeHex = encodeFee(networkFee);

  // parse toAddress
  const addressHex = encodeAddress(toChain, toAddress);
  if (!/^(?:[0-9a-fA-F]{2}){1,255}$/.test(addressHex)) {
    throw new RangeError('invalid encoded lock address');
  }
  const addressLengthCode = (addressHex.length / 2).toString(16).padStart(2, '0');

  return toChainHex + bridgeFeeHex + networkFeeHex + addressLengthCode + addressHex.toLowerCase();
};

/** Encodes a non-negative fee into the lock protocol's unsigned 64-bit field. */
const encodeFee = (fee: string): string => {
  if (!/^\d+$/.test(fee)) throw new RangeError('invalid lock fee');
  const value = BigInt(fee);
  if (value > 0xffffffffffffffffn) throw new RangeError('lock fee exceeds uint64');
  return value.toString(16).padStart(16, '0');
};

/**
 * gets EVM chain current block height
 * @returns
 */
export const getHeight = async (chain: EvmChains): Promise<number> => {
  return await new JsonRpcProvider(getChainRpcUrl(chain)).getBlockNumber();
};

/**
 * gets EVM chain fee data
 * @returns
 */
export const getFeeData = async (chain: EvmChains): Promise<FeeData> => {
  return await new JsonRpcProvider(getChainRpcUrl(chain)).getFeeData();
};

/**
 * Verify the validity of the Ethereum address
 * @param addr input address
 * @returns
 */
export const isValidAddress = (addr: string) => {
  return isAddress(addr);
};

/**
 * returns the corresponding chain RPC url
 * @param chain
 */
const getChainRpcUrl = (chain: EvmChains) => {
  switch (chain) {
    case EvmChains.ETHEREUM:
      return process.env.ETHEREUM_RPC_API;
    case EvmChains.BINANCE:
      return process.env.BINANCE_RPC_API;
    default:
      throw Error(`chain [${chain}] is not registered as an EVM chain`);
  }
};
