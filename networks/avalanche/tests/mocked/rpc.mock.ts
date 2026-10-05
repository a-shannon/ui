import { vi } from 'vitest';

/** Synthetic RPC transport; only API replies are mocked, never the qualified provider. */
export const createRpc = () => {
  const block = { number: '0x64', hash: `0x${'22'.repeat(32)}`, baseFeePerGas: '0xa' };
  const send = vi.fn(async (method: string, _params: unknown[]): Promise<unknown> => {
    if (method === 'eth_chainId') return '0xa869';
    if (method === 'eth_getBlockByNumber') return { ...block };
    if (method === 'eth_gasPrice') return '0x19';
    if (method === 'eth_maxPriorityFeePerGas') return '0x2';
    throw new Error(`Unexpected synthetic RPC ${method}`);
  });
  return { send, block };
};
