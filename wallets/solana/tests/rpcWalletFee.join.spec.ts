import { describe, expect, it } from 'vitest';

import {
  createRpcWalletFeeJoinHarness,
  type RpcWalletFeeJoinHarness,
  type RpcWalletFeeJoinRequest,
} from './rpcWalletFeeTestUtils';

/** Selects one recorded synthetic RPC request by its exact method name. */
const request = (harness: RpcWalletFeeJoinHarness, method: string): RpcWalletFeeJoinRequest => {
  const found = harness.requests.find((entry) => entry.method === method);
  if (!found) throw new Error(`Missing synthetic RPC method ${method}`);
  return found;
};

/** Returns one parsed request parameter after checking that it is an object. */
const objectParam = (entry: RpcWalletFeeJoinRequest, index: number): Record<string, unknown> => {
  const value = entry.params[index];
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`Synthetic ${entry.method} parameter ${index} is not an object`);
  return value as Record<string, unknown>;
};

/** Runs a deterministic quote case and always retires the synthetic wallet session. */
const withHarness = async (
  kind: 'native' | 'spl',
  run: (harness: RpcWalletFeeJoinHarness) => Promise<void>,
  overrides: Parameters<typeof createRpcWalletFeeJoinHarness>[1] = {},
): Promise<void> => {
  const harness = await createRpcWalletFeeJoinHarness(kind, overrides);
  try {
    expect(harness.wallet.connectCalls).toBe(1);
    expect(harness.wallet.activeListeners).toBe(2);
    await run(harness);
  } finally {
    harness.dispose();
    expect(harness.wallet.activeListeners).toBe(0);
  }
};

describe('RPC wallet-read to fee-quote consumer join', () => {
  /**
   * @target createSolanaRpcTransport, createSolanaRpcWalletReadProducer, createSolanaRpcFeeProducers and prepareSolanaLockFeeQuote prepares a native SOL quote through the complete runtime producer chain
   * @dependencies bounded synthetic fetch transcript, actual event-bound wallet adapter, captured profile and quote policy
   * @scenario prepare a SOL quote through the exported runtime API using only the constrained local RPC fixture
   * @expected each downstream RPC uses the preceding context floor, the exact compiled message is priced, and no signing occurs
   */
  it('prepares a native SOL quote through the complete runtime producer chain', async () => {
    await withHarness('native', async (harness) => {
      const quote = await harness.prepareQuote();
      expect(quote.feeLamports).toBe(7n);
      expect(quote.contextSlot).toBe(23n);
      expect(harness.walletReadResults).toHaveLength(1);

      const balance = request(harness, 'getBalance');
      const tokens = request(harness, 'getTokenAccountsByOwner');
      const blockhash = request(harness, 'getLatestBlockhash');
      const payer = request(harness, 'getAccountInfo');
      const fee = request(harness, 'getFeeForMessage');
      const height = request(harness, 'getBlockHeight');
      expect(harness.requests.some((entry) => entry.method === 'getMultipleAccounts')).toBe(false);
      expect(objectParam(balance, 1).minContextSlot).toBe(0);
      expect(objectParam(tokens, 2).minContextSlot).toBe(0);
      expect(objectParam(blockhash, 0).minContextSlot).toBe(20);
      expect(objectParam(payer, 1).minContextSlot).toBe(21);
      expect(fee.params[0]).toBe(quote.messageBase64);
      expect(objectParam(fee, 1).minContextSlot).toBe(22);
      expect(objectParam(height, 0).minContextSlot).toBe(23);
      expect(harness.wallet.signCalls).toBe(0);
    });
  });

  /**
   * @target createSolanaRpcWalletReadProducer and prepareSolanaLockFeeQuote prepares an SPL quote from the selected account in the RPC wallet inventory
   * @dependencies bounded synthetic mint/token account bytes, actual transport/read/fee producers and event-bound session
   * @scenario select one initialized original-SPL account with sufficient balance and quote its exact bridge message
   * @expected the selected raw amount reaches the quote without aggregation and no signing occurs
   */
  it('prepares an SPL quote from the selected account in the RPC wallet inventory', async () => {
    await withHarness('spl', async (harness) => {
      const quote = await harness.prepareQuote();
      expect(quote.feeLamports).toBe(7n);
      expect(quote.contextSlot).toBe(23n);
      expect(harness.walletReadResults).toHaveLength(1);
      const read = harness.walletReadResults[0] as {
        readonly tokenAccounts: readonly { readonly amount: bigint }[];
      };
      expect(read.tokenAccounts.map((account) => account.amount)).toEqual([10_000n]);
      const mint = request(harness, 'getMultipleAccounts');
      expect(mint.params[0]).toHaveLength(1);
      expect(objectParam(mint, 1).minContextSlot).toBe(20);
      expect(request(harness, 'getFeeForMessage').params[0]).toBe(quote.messageBase64);
      expect(harness.wallet.signCalls).toBe(0);
    });
  });

  /**
   * @target selectSolanaSourceTokenAccount and prepareSolanaLockFeeQuote rejects gross 100 against selected 50 even when another same-mint account holds 500
   * @dependencies actual RPC decoding, selected-account quote validation and a bounded two-account fixture
   * @scenario expose selected 50 and other 500 units for one mint while requesting gross amount 100
   * @expected quote preparation rejects the selected account with its exact error and preserves both raw rows
   */
  it('rejects gross 100 against selected 50 even when another same-mint account holds 500', async () => {
    await withHarness(
      'spl',
      async (harness) => {
        await expect(harness.prepareQuote()).rejects.toThrow(
          'Insufficient selected SPL account balance',
        );
        const read = harness.walletReadResults[0] as {
          readonly tokenAccounts: readonly { readonly amount: bigint }[];
        };
        expect(read.tokenAccounts.map((account) => account.amount)).toEqual([50n, 500n]);
        expect(harness.wallet.signCalls).toBe(0);
      },
      {
        tokenAmounts: [50n, 500n],
        grossAmount: '100',
        minimumGrossAmount: '3',
        networkFee: '1',
        bridgeFee: '1',
      },
    );
  });

  /**
   * @target createSolanaRpcWalletReadProducer rejects native and token inventory returned from different context slots
   * @dependencies actual RPC transport/read producer and independently controlled synthetic response contexts
   * @scenario return native slot 20 and token inventory slot 19 for one finalized wallet read
   * @expected the read producer fails with its stable context-mismatch error before a quote or signing action
   */
  it('rejects native and token inventory returned from different context slots', async () => {
    await withHarness(
      'native',
      async (harness) => {
        await expect(harness.prepareQuote()).rejects.toThrow(
          'SOLANA_RPC_WALLET_READ_CONTEXT_SLOT_MISMATCH',
        );
        expect(harness.walletReadResults).toHaveLength(0);
        expect(harness.wallet.signCalls).toBe(0);
      },
      { tokenContextSlot: 19n },
    );
  });

  /**
   * @target prepareSolanaLockFeeQuote fails with the exact unavailable-fee message when the RPC fee is null
   * @dependencies exact-message fee RPC producer and bounded synthetic response with a null fee
   * @scenario return a valid contextual response whose getFeeForMessage value is null
   * @expected quote preparation rejects with the public unavailable-fee message and does not sign
   */
  it('fails with the exact unavailable-fee message when the RPC fee is null', async () => {
    await withHarness(
      'native',
      async (harness) => {
        await expect(harness.prepareQuote()).rejects.toThrow('Message fee is unavailable');
        expect(request(harness, 'getFeeForMessage').params[0]).not.toBe('');
        expect(harness.wallet.signCalls).toBe(0);
      },
      { messageFeeLamports: null },
    );
  });

  /**
   * @target createSolanaRpcFeeProducers rejects an exact-message fee response below its requested context floor
   * @dependencies actual fee producer, transport and deterministic preceding-slot responses
   * @scenario request the exact-message fee at slot 22 and return that response at slot 21
   * @expected fee production rejects with the stable floor error before quote publication or signing
   */
  it('rejects an exact-message fee response below its requested context floor', async () => {
    await withHarness(
      'native',
      async (harness) => {
        await expect(harness.prepareQuote()).rejects.toThrow('SOLANA_RPC_CONTEXT_BELOW_FLOOR');
        expect(objectParam(request(harness, 'getFeeForMessage'), 1).minContextSlot).toBe(22);
        expect(harness.wallet.signCalls).toBe(0);
      },
      { messageFeeContextSlot: 21n },
    );
  });
});
