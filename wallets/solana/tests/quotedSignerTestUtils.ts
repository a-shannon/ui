import { Buffer } from 'buffer';

import { Transaction } from '@solana/web3.js';

import { createFeeQuoteFixture } from './feeQuoteTestUtils';
import { mockEventSolanaProvider } from './mocked/eventBoundWalletPort.mock';
import { deferredReadPortResult } from './readPortTestUtils';
import { keypair } from './testUtils';

/** Creates an actual session/quote with synthetic wallet and monotonic finalized service contexts. */
export const createQuotedSignerJoinFixture = async (kind: 'native' | 'spl' = 'native') => {
  const { createEventBoundSolanaWalletPort } = await import('../src/eventBoundWalletPort');
  const { prepareSolanaLockFeeQuote } = await import('../src/feeQuote');
  const wallet = mockEventSolanaProvider(keypair(1));
  const port = createEventBoundSolanaWalletPort(() => wallet.provider);
  await port.connect();
  const f = createFeeQuoteFixture(kind, port.captureSession());
  f.producers.readBalance.mockImplementation(async (request) => ({
    ...f.balance,
    nativeContextSlot: request.minContextSlot + 1n,
    tokenContextSlot: request.minContextSlot + 1n,
  }));
  f.producers.readLatestBlockhash.mockImplementation(async (request) => ({
    ...f.blockhash,
    contextSlot: request.minContextSlot + 1n,
  }));
  f.producers.readFeePayer.mockImplementation(async (request) => ({
    ...f.payer,
    contextSlot: request.minContextSlot + 1n,
  }));
  f.producers.readMessageFee.mockImplementation(async (request) => ({
    ...f.fee,
    messageBase64: request.messageBase64,
    contextSlot: request.minContextSlot + 1n,
  }));
  try {
    const quote = await prepareSolanaLockFeeQuote(
      f.profile,
      f.session,
      f.intent,
      f.producers,
      f.options,
    );
    return { ...f, wallet, port, quote };
  } catch (error) {
    port.dispose();
    throw error;
  }
};

/** Decodes detached public wire with the actual SDK, without signing or submission. */
export const decodeQuotedSignerWire = (wireBase64: string): Transaction =>
  Transaction.from(Buffer.from(wireBase64, 'base64'));

/** Holds the actual synthetic wallet await and then authorizes its exact supplied transaction. */
export const deferQuotedSignerWallet = (
  fixture: Awaited<ReturnType<typeof createQuotedSignerJoinFixture>>,
) => {
  const deferred = deferredReadPortResult();
  fixture.wallet.provider.signTransaction.mockImplementation(async (transaction) => {
    await deferred.promise;
    transaction.partialSign(keypair(1));
    return transaction;
  });
  return deferred;
};
