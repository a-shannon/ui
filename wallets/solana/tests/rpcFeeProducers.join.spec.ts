import { describe, expect, it } from 'vitest';

import {
  createSolanaRpcFeeProducers,
  createSolanaRpcTransport,
  type SolanaLockFeeProducers,
} from '@rosen-network/solana';

import { createEventBoundSolanaWalletPort } from '../src/eventBoundWalletPort';
import { prepareSolanaLockFeeQuote } from '../src/feeQuote';
import { createFeeQuoteFixture } from './feeQuoteTestUtils';
import { mockEventSolanaProvider } from './mocked/eventBoundWalletPort.mock';
import { TEST_ADDRESS, TEST_BLOCKHASH, U64_MAX } from './rpcFeeProducersTestData';
import { rpcResponse } from './rpcFeeProducersTestUtils';
import { keypair } from './testUtils';

describe('createSolanaRpcFeeProducers transport and quote join', () => {
  /**
   * @target createSolanaRpcFeeProducers joins a captured event session to synthetic fetch responses and the existing fee quote
   * @dependencies one synthetic wallet session, one injected fetch transcript, and the existing native quote
   * @scenario prepare a quote from odd-u64 native balance through serialized JSON-RPC and raw AST results
   * @expected the exact message fee request carries its captured message and bigint context floor
   */
  it('joins a captured event session to synthetic fetch responses and the existing fee quote', async () => {
    const wallet = mockEventSolanaProvider(keypair(1));
    const port = createEventBoundSolanaWalletPort(() => wallet.provider);
    await port.connect();
    try {
      const quoteFixture = createFeeQuoteFixture('native', port.captureSession());
      const genesisHash = quoteFixture.profile.clusterGenesisHash;
      const requestBodies: string[] = [];
      const rawResults: Record<string, string> = {
        getGenesisHash: JSON.stringify(genesisHash),
        getLatestBlockhash: `{"context":{"slot":21,"apiVersion":"1.18.0"},"value":{"blockhash":"${TEST_BLOCKHASH}","lastValidBlockHeight":${U64_MAX}}}`,
        getAccountInfo: `{"context":{"slot":22},"value":{"data":["","base64"],"executable":false,"lamports":9007199254740993,"owner":"${TEST_ADDRESS}","rentEpoch":0}}`,
        getMinimumBalanceForRentExemption: '0',
        getFeeForMessage: '{"context":{"slot":23},"value":0}',
        getBlockHeight: '9007199254740993',
      };
      const fetchImpl: typeof fetch = async (_input, init) => {
        if (typeof init?.body !== 'string') throw new Error('Expected serialized request body');
        const body = init.body;
        requestBodies.push(body);
        const method = /"method":"([^"]+)"/u.exec(body)?.[1];
        const id = /"id":([1-9][0-9]*)/u.exec(body)?.[1];
        if (!method || !id || !Object.hasOwn(rawResults, method))
          throw new Error('Unexpected synthetic fetch request');
        return new Response(rpcResponse(Number(id), rawResults[method]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };
      const transport = createSolanaRpcTransport({
        endpointURL: 'https://rpc.example.invalid/local-fixture',
        timeoutMs: 1000,
        maxRequestBytes: 1_048_576,
        maxResponseBytes: 1_048_576,
        fetchImpl,
      });
      const readBalance = async (
        request: Parameters<SolanaLockFeeProducers['readBalance']>[0],
      ) => ({
        address: request.address,
        clusterGenesisHash: request.clusterGenesisHash,
        commitment: 'finalized' as const,
        nativeContextSlot: 20n,
        tokenContextSlot: 20n,
        nativeBalance: 9_007_199_254_740_993n,
        tokenAccounts: [],
      });
      const producers = createSolanaRpcFeeProducers({
        expectedGenesisHash: genesisHash,
        transport,
        readBalance,
      });
      const quote = await prepareSolanaLockFeeQuote(
        quoteFixture.profile,
        quoteFixture.session,
        quoteFixture.intent,
        producers,
        quoteFixture.options,
      );

      expect(quote.nativeAvailable).toEqual(9_007_199_254_740_993n);
      expect(quote.feeLamports).toEqual(0n);
      const feeBody = requestBodies.find((body) => body.includes('"method":"getFeeForMessage"'));
      expect(feeBody).toContain(JSON.stringify(quote.messageBase64));
      expect(feeBody).toContain('"minContextSlot":22');
      expect(requestBodies.every((body) => body.includes('"jsonrpc":"2.0"'))).toEqual(true);
      expect(requestBodies).toHaveLength(17);
    } finally {
      port.dispose();
    }
  });
});
