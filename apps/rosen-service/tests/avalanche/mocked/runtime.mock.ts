import { Block, JsonRpcProvider } from 'ethers';
import { vi } from 'vitest';

import { AvalancheSafetyState } from '@rosen-bridge/evm-scanner';
import { DataSource } from '@rosen-bridge/extended-typeorm';

import { finalizedHash } from '../testData';

/** Create a real, uninitialized PostgreSQL DataSource; only repository APIs are doubled. */
export const databaseFixture = (chainId: 43113 | 43114 = 43113) => {
  const dataSource = new DataSource({ type: 'postgres', entities: [], migrations: [] });
  const state: AvalancheSafetyState = Object.assign(new AvalancheSafetyState(), {
    scanner: 'avalanche',
    chainId: chainId.toString(),
    sourceId: 'provider-a',
    initialHeight: 0,
    policy: 'helicon-settled-v1',
    finalizedHeight: 10,
    finalizedHash,
    holdReason: null,
  });
  const findState = vi
    .spyOn(dataSource.getRepository(AvalancheSafetyState), 'findOneBy')
    .mockImplementation(async () => state);
  return { dataSource, state, findState };
};

/** Intercept actual ethers provider reads and reject every unapproved method or block tag. */
export const finalizedRpcFixture = (chainId: 43113 | 43114 = 43113) => {
  const block = new Block(
    {
      hash: finalizedHash,
      parentHash: `0x${'bb'.repeat(32)}`,
      number: 10,
      timestamp: 100,
      nonce: '0x0000000000000000',
      difficulty: 0n,
      gasLimit: 30_000_000n,
      gasUsed: 0n,
      miner: `0x${'11'.repeat(20)}`,
      extraData: '0x',
      baseFeePerGas: 1n,
      transactions: [],
    },
    new JsonRpcProvider('https://unused.example.invalid'),
  );
  const send = vi
    .spyOn(JsonRpcProvider.prototype, 'send')
    .mockImplementation(async (method: string, params) => {
      if (method === 'eth_chainId') return chainId === 43114 ? '0xa86a' : '0xa869';
      if (method === 'eth_getBalance') return '0x64';
      if (chainId === 43114 && method === 'eth_call') {
        if (!Array.isArray(params)) throw new Error('Expected positional token RPC parameters');
        const call = params[0] as { data: string };
        if (params[1] !== '0xa') throw new Error('Token read is not finalized');
        if (call.data.startsWith('0x70a08231'))
          return `0x${10000000000n.toString(16).padStart(64, '0')}`;
        if (call.data === '0x18160ddd') return `0x${1000000000000n.toString(16).padStart(64, '0')}`;
      }
      if (method === 'eth_getBlockByNumber') return { number: '0xa', hash: finalizedHash };
      throw new Error(`Unexpected RPC method: ${method}`);
    });
  const getBlock = vi
    .spyOn(JsonRpcProvider.prototype, 'getBlock')
    .mockImplementation(async (tag) => {
      if (tag !== 'finalized' && tag !== 10) throw new Error(`Unexpected block tag: ${tag}`);
      return block;
    });
  return { send, getBlock, block };
};
