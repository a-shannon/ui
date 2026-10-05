import { FeeData, JsonRpcProvider } from 'ethers';

import type { AvalancheChainId } from './constants';
import type { AvalancheProvider } from './utils';

export type AvalancheRpc = { send(method: string, params: unknown[]): Promise<unknown> };

/** Parse one canonical RPC quantity without rounding or accepting an alternate encoding. */
const quantity = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) {
    throw new Error('Invalid Avalanche RPC quantity');
  }
  const result = BigInt(value);
  if (result > (1n << 256n) - 1n) throw new Error('Avalanche RPC quantity exceeds uint256');
  return result;
};

/** Read a settled height and fresh identity/fee quantities through an explicit endpoint. */
export const createAvalancheProvider = (
  rpc: AvalancheRpc,
  chainId: AvalancheChainId,
): AvalancheProvider => {
  if (chainId !== 43113 && chainId !== 43114) throw new Error('Invalid Avalanche chain ID');
  const send = rpc.send.bind(rpc);
  /** Obtain a fresh endpoint identity before exposing any selected-network observation. */
  const identity = async () => {
    const actual = quantity(await send('eth_chainId', []));
    if (actual !== BigInt(chainId)) throw new Error('Avalanche provider chain mismatch');
    return { chainId: actual };
  };
  /** Qualify a finalized block against the same endpoint's canonical numeric lookup. */
  const settled = async () => {
    const raw = await send('eth_getBlockByNumber', ['finalized', false]);
    if (typeof raw !== 'object' || raw === null)
      throw new Error('Avalanche finalized block missing');
    const block = raw as Record<string, unknown>;
    const height = quantity(block.number);
    if (
      height > BigInt(Number.MAX_SAFE_INTEGER) ||
      typeof block.hash !== 'string' ||
      !/^0x[0-9a-fA-F]{64}$/.test(block.hash)
    ) {
      throw new Error('Invalid Avalanche finalized block');
    }
    const canonical = await send('eth_getBlockByNumber', [block.number, false]);
    if (
      typeof canonical !== 'object' ||
      canonical === null ||
      (canonical as Record<string, unknown>).number !== block.number ||
      (canonical as Record<string, unknown>).hash !== block.hash
    ) {
      throw new Error('Avalanche finalized block is not canonical');
    }
    return { height: Number(height), baseFee: quantity(block.baseFeePerGas) };
  };
  return Object.freeze({
    getNetwork: identity,
    /** Expose only a qualified finalized height, bracketed by fresh identity reads. */
    getBlockNumber: async () => {
      await identity();
      const block = await settled();
      await identity();
      return block.height;
    },
    /** Bound native fee quantities using a canonical base fee and fresh endpoint identity. */
    getFeeData: async () => {
      await identity();
      const block = await settled();
      const gasPrice = quantity(await send('eth_gasPrice', []));
      const priority = quantity(await send('eth_maxPriorityFeePerGas', []));
      const type2Cap = block.baseFee * 2n + priority;
      const maxFee = gasPrice > type2Cap ? gasPrice : type2Cap;
      if (gasPrice === 0n || maxFee === 0n || maxFee > (1n << 256n) - 1n) {
        throw new Error('Invalid Avalanche gas price');
      }
      await identity();
      return new FeeData(gasPrice, maxFee, priority);
    },
  });
};

/** Construct the server transport without selecting a network implicitly. */
export const createAvalancheEndpointProvider = (endpoint: string, chainId: AvalancheChainId) => {
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Invalid Avalanche RPC endpoint');
  }
  return createAvalancheProvider(new JsonRpcProvider(url.href), chainId);
};
