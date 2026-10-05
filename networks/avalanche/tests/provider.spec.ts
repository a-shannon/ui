import { describe, expect, it } from 'vitest';

import { createAvalancheEndpointProvider, createAvalancheProvider } from '../src/provider';
import { createRpc } from './mocked/rpc.mock';

describe('createAvalancheProvider', () => {
  describe('getBlockNumber', () => {
    /**
     * @target getBlockNumber should read finalized without a latest fallback
     * @dependencies synthetic finalized and numeric block replies
     * @scenario qualified Fuji endpoint reports height 100
     * @expected finalized is requested and identities bracket the observation
     */
    it('should read finalized without a latest fallback', async () => {
      const rpc = createRpc();
      expect(await createAvalancheProvider(rpc, 43113).getBlockNumber()).toEqual(100);
      expect(rpc.send.mock.calls).toEqual([
        ['eth_chainId', []],
        ['eth_getBlockByNumber', ['finalized', false]],
        ['eth_getBlockByNumber', ['0x64', false]],
        ['eth_chainId', []],
      ]);
    });

    /**
     * @target getBlockNumber should reject finalized response %j
     * @dependencies synthetic RPC replies
     * @scenario independently remove the frontier, corrupt its quantity/hash or exceed safe height
     * @expected no height or latest fallback is exposed
     */
    it.each([null, { number: '0x064' }, { hash: 'bad' }, { number: '0x20000000000000' }])(
      'should reject finalized response %j',
      async (change) => {
        const rpc = createRpc();
        const normal = rpc.send.getMockImplementation()!;
        rpc.send.mockImplementation(async (method, params) => {
          if (method === 'eth_getBlockByNumber' && params[0] === 'finalized') {
            return change === null ? null : { ...rpc.block, ...change };
          }
          return normal(method, params);
        });
        await expect(createAvalancheProvider(rpc, 43113).getBlockNumber()).rejects.toThrow();
        expect(rpc.send.mock.calls.some(([, params]) => params[0] === 'latest')).toEqual(false);
      },
    );

    /**
     * @target getBlockNumber should reject a canonical hash conflict
     * @dependencies synthetic RPC replies
     * @scenario numeric height has a different hash than finalized
     * @expected no fee height is exposed
     */
    it('should reject a canonical hash conflict', async () => {
      const rpc = createRpc();
      const normal = rpc.send.getMockImplementation()!;
      rpc.send.mockImplementation(async (method, params) => {
        if (method === 'eth_getBlockByNumber' && params[0] === '0x64') {
          return { ...rpc.block, hash: `0x${'33'.repeat(32)}` };
        }
        return normal(method, params);
      });
      await expect(createAvalancheProvider(rpc, 43113).getBlockNumber()).rejects.toThrow(
        'not canonical',
      );
    });

    /**
     * @target getBlockNumber should reject identity boundary %s
     * @dependencies synthetic fresh chain replies
     * @scenario independently change the first or last identity to mainnet
     * @expected a Fuji height is never credited to the wrong deployment
     */
    it.each([1, 2])('should reject identity boundary %s', async (boundary) => {
      const rpc = createRpc();
      const normal = rpc.send.getMockImplementation()!;
      let calls = 0;
      rpc.send.mockImplementation(async (method, params) =>
        method === 'eth_chainId' && ++calls === boundary ? '0xa86a' : normal(method, params),
      );
      await expect(createAvalancheProvider(rpc, 43113).getBlockNumber()).rejects.toThrow(
        'chain mismatch',
      );
    });
  });

  describe('getFeeData', () => {
    /**
     * @target getFeeData should cover observed gas price %s
     * @dependencies synthetic canonical finalized block and gas-price replies
     * @scenario base fee 10 and priority fee 2, with observed gas price 25 or 1
     * @expected the cap covers both estimates and fresh endpoint identity is checked
     */
    it.each([
      ['0x19', 25n],
      ['0x1', 22n],
    ] as const)('should cover observed gas price %s', async (price, cap) => {
      const rpc = createRpc();
      const normal = rpc.send.getMockImplementation()!;
      rpc.send.mockImplementation(async (method, params) =>
        method === 'eth_gasPrice' ? price : normal(method, params),
      );
      const fees = await createAvalancheProvider(rpc, 43113).getFeeData();
      expect([fees.gasPrice, fees.maxFeePerGas, fees.maxPriorityFeePerGas]).toEqual([
        BigInt(price),
        cap,
        2n,
      ]);
      expect(rpc.send.mock.calls.at(-1)).toEqual(['eth_chainId', []]);
    });

    /**
     * @target getFeeData should reject gas price %s
     * @dependencies synthetic RPC response
     * @scenario gas price is zero, noncanonical or exceeds uint256
     * @expected no maximum transferable amount can use the invalid fee
     */
    it.each(['0x0', '0x00', '-1', `0x1${'0'.repeat(64)}`])(
      'should reject gas price %s',
      async (value) => {
        const rpc = createRpc();
        const normal = rpc.send.getMockImplementation()!;
        rpc.send.mockImplementation(async (method, params) =>
          method === 'eth_gasPrice' ? value : normal(method, params),
        );
        await expect(createAvalancheProvider(rpc, 43113).getFeeData()).rejects.toThrow();
      },
    );
  });
});

describe('createAvalancheEndpointProvider', () => {
  /**
   * @target createAvalancheEndpointProvider should reject URL %s
   * @dependencies none; no endpoint contacted
   * @scenario URL is malformed, uses a non-HTTP scheme or embeds credentials
   * @expected transport construction fails without an RPC call
   */
  it.each(['invalid', 'file:///example', 'https://example:example@example.invalid'])(
    'should reject URL %s',
    (url) => {
      expect(() => createAvalancheEndpointProvider(url, 43113)).toThrow();
    },
  );
});
