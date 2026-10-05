import { Buffer } from 'buffer';

import { describe, expect, it, vi } from 'vitest';

import { hasCapturedSolanaLockMessage } from '@rosen-network/solana';

import { createEventBoundSolanaWalletPort } from '../src/eventBoundWalletPort';
import {
  getSolanaLockFeeQuoteBuild,
  isCurrentSolanaLockFeeQuote,
  prepareSolanaLockFeeQuote,
  revalidateSolanaLockFeeQuote,
} from '../src/feeQuote';
import { signSolanaLockTransaction } from '../src/signerPort';
import { createFeeQuoteFixture, feeQuoteArguments } from './feeQuoteTestUtils';
import { mockEventSolanaProvider } from './mocked/eventBoundWalletPort.mock';
import { mockSyntheticSigner } from './mocked/signerPort.mock';
import { deferredReadPortResult } from './readPortTestUtils';
import { keypair } from './testUtils';

describe('getSolanaLockFeeQuoteBuild', () => {
  /**
   * @target getSolanaLockFeeQuoteBuild returns exact fresh bytes after a final wallet read mutates an earlier build
   * @dependencies actual event/session, read and builder modules; synthetic provider with a key-read callback
   * @scenario the second session key read changes the blockhash of a previously returned build
   * @expected callback executes but the newly returned build still has the exact quoted message
   */
  it('returns exact fresh bytes after a final wallet read mutates an earlier build', async () => {
    const wallet = mockEventSolanaProvider(keypair(1));
    const port = createEventBoundSolanaWalletPort(() => wallet.provider);
    await port.connect();
    try {
      const f = createFeeQuoteFixture('native', port.captureSession());
      const quote = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
      const earlier = getSolanaLockFeeQuoteBuild(quote);
      const changedBlockhash = keypair(12).publicKey.toBase58();
      const key = wallet.provider.publicKey;
      const readKey = key.toBase58.bind(key);
      let reads = 0;
      const spy = vi.spyOn(key, 'toBase58').mockImplementation(() => {
        reads += 1;
        if (reads === 2) earlier.transaction.recentBlockhash = changedBlockhash;
        return readKey();
      });
      try {
        const fresh = getSolanaLockFeeQuoteBuild(quote);
        expect(reads).toEqual(2);
        expect(earlier.transaction.recentBlockhash).toEqual(changedBlockhash);
        expect(Buffer.from(fresh.transaction.serializeMessage()).toString('base64')).toEqual(
          quote.messageBase64,
        );
      } finally {
        spy.mockRestore();
      }
    } finally {
      port.dispose();
    }
  });
});

describe('isCurrentSolanaLockFeeQuote', () => {
  /**
   * @target isCurrentSolanaLockFeeQuote isolates copy serialization until an actual disconnect occurs
   * @dependencies actual event/session, read and builder modules; synthetic wallet and injected services
   * @scenario a returned-copy serializer emits disconnect only when the caller invokes it
   * @expected private quote checks do not invoke the copy; explicit invocation revokes the session
   */
  it('isolates copy serialization until an actual disconnect occurs', async () => {
    const wallet = mockEventSolanaProvider(keypair(1));
    const port = createEventBoundSolanaWalletPort(() => wallet.provider);
    await port.connect();
    try {
      const f = createFeeQuoteFixture('native', port.captureSession());
      const quote = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
      const transaction = getSolanaLockFeeQuoteBuild(quote).transaction;
      const serialize = transaction.serializeMessage.bind(transaction);
      transaction.serializeMessage = () => {
        const bytes = serialize();
        wallet.emit('disconnect');
        return bytes;
      };
      expect(isCurrentSolanaLockFeeQuote(quote)).toEqual(true);
      transaction.serializeMessage();
      expect(isCurrentSolanaLockFeeQuote(quote)).toEqual(false);
    } finally {
      port.dispose();
    }
  });
});

describe('prepareSolanaLockFeeQuote', () => {
  /**
   * @target prepareSolanaLockFeeQuote joins an actual event session to an exact %s legacy message fee
   * @dependencies actual event/session, read and builder modules; synthetic wallet and injected services
   * @scenario connect, capture, prepare one native or explicitly selected original-SPL lock
   * @expected byte-identical fee request and transaction message; disposal invalidates local quote
   */
  it.each(['native', 'spl'] as const)(
    'joins an actual event session to an exact %s legacy message fee',
    async (kind) => {
      const wallet = mockEventSolanaProvider(keypair(1));
      const port = createEventBoundSolanaWalletPort(() => wallet.provider);
      await port.connect();
      try {
        const f = createFeeQuoteFixture(kind, port.captureSession());
        const quote = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
        const build = getSolanaLockFeeQuoteBuild(quote);
        const message = Buffer.from(build.transaction.serializeMessage()).toString('base64');
        expect(quote.messageBase64).toEqual(message);
        expect(f.producers.readMessageFee.mock.calls[0][0].messageBase64).toEqual(message);
        expect(build.transaction.compileMessage().header.numRequiredSignatures).toEqual(1);
        expect(build.transaction.instructions).toHaveLength(2);
        expect(build.asset).toEqual(f.intent.asset);
        expect(isCurrentSolanaLockFeeQuote(quote)).toEqual(true);
        port.dispose();
        expect(isCurrentSolanaLockFeeQuote(quote)).toEqual(false);
      } finally {
        port.dispose();
      }
    },
  );

  /**
   * @target prepareSolanaLockFeeQuote rejects actual session events across the %s await
   * @dependencies actual event/session, read and builder modules; deferred injected services
   * @scenario account A changes to B and back to A while one producer response is pending
   * @expected old session refused after every awaited producer boundary
   */
  it.each([
    'readBalance',
    'readLatestBlockhash',
    'readFeePayer',
    'readRentMinimum',
    'readMessageFee',
    'readBlockHeight',
  ] as const)('rejects actual session events across the %s await', async (stage) => {
    const wallet = mockEventSolanaProvider(keypair(1));
    const port = createEventBoundSolanaWalletPort(() => wallet.provider);
    await port.connect();
    try {
      const f = createFeeQuoteFixture('native', port.captureSession());
      const deferred = deferredReadPortResult();
      const original = f.producers[stage].getMockImplementation();
      f.producers[stage].mockReturnValue(deferred.promise);
      const pending = prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
      // Wait only for the intended callback, preserving a deciding per-boundary fixture.
      await expect.poll(() => f.producers[stage].mock.calls.length).toEqual(1);
      wallet.provider.publicKey = keypair(2).publicKey;
      wallet.emit('accountChanged');
      wallet.provider.publicKey = keypair(1).publicKey;
      wallet.emit('accountChanged');
      const request = f.producers[stage].mock.calls[0][0];
      deferred.resolve(await original?.(request as never));
      await expect(pending).rejects.toThrow('Solana wallet session is stale');
    } finally {
      port.dispose();
    }
  });
});

describe('revalidateSolanaLockFeeQuote', () => {
  /**
   * @target revalidateSolanaLockFeeQuote ignores a returned-copy serializer installed during the height await
   * @dependencies actual event/session, read and builder modules; synthetic confirmed-height service
   * @scenario height producer installs a serializer that emits disconnect after producing original bytes
   * @expected successor remains current until caller invokes the copy serializer and emits disconnect
   */
  it('ignores a returned-copy serializer installed during the height await', async () => {
    const wallet = mockEventSolanaProvider(keypair(1));
    const port = createEventBoundSolanaWalletPort(() => wallet.provider);
    await port.connect();
    try {
      const f = createFeeQuoteFixture('native', port.captureSession());
      const old = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
      const transaction = getSolanaLockFeeQuoteBuild(old).transaction;
      const serialize = transaction.serializeMessage.bind(transaction);
      f.advance();
      f.producers.readBlockHeight.mockImplementation(async () => {
        transaction.serializeMessage = () => {
          const bytes = serialize();
          wallet.emit('disconnect');
          return bytes;
        };
        return f.height;
      });
      const successor = await revalidateSolanaLockFeeQuote(old);
      expect(isCurrentSolanaLockFeeQuote(successor)).toEqual(true);
      transaction.serializeMessage();
      expect(isCurrentSolanaLockFeeQuote(successor)).toEqual(false);
      expect(isCurrentSolanaLockFeeQuote(old)).toEqual(false);
    } finally {
      port.dispose();
    }
  });

  /**
   * @target revalidateSolanaLockFeeQuote isolates copy mutation during fee await and the signer rejects that copy
   * @dependencies actual event/session, read and builder modules; deferred fee producer
   * @scenario keep one returned copy, start revalidation, then change its blockhash before fee completion
   * @expected exact successor/fresh copy remain valid; existing signer refuses altered copy before wallet calls
   */
  it('isolates copy mutation during fee await and the signer rejects that copy', async () => {
    const wallet = mockEventSolanaProvider(keypair(1));
    const port = createEventBoundSolanaWalletPort(() => wallet.provider);
    await port.connect();
    try {
      const f = createFeeQuoteFixture('spl', port.captureSession());
      const old = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
      const build = getSolanaLockFeeQuoteBuild(old);
      f.advance();
      const deferred = deferredReadPortResult();
      f.producers.readMessageFee.mockReturnValue(deferred.promise);
      const pending = revalidateSolanaLockFeeQuote(old);
      await expect.poll(() => f.producers.readMessageFee.mock.calls.length).toEqual(2);
      build.transaction.recentBlockhash = keypair(12).publicKey.toBase58();
      deferred.resolve({ ...f.fee, messageBase64: old.messageBase64 });
      const successor = await pending;
      const fresh = getSolanaLockFeeQuoteBuild(successor);
      expect(isCurrentSolanaLockFeeQuote(successor)).toEqual(true);
      expect(hasCapturedSolanaLockMessage(build)).toEqual(false);
      expect(hasCapturedSolanaLockMessage(fresh)).toEqual(true);
      expect(Buffer.from(fresh.transaction.serializeMessage()).toString('base64')).toEqual(
        old.messageBase64,
      );
      const signer = mockSyntheticSigner(keypair(1));
      await expect(signSolanaLockTransaction(build, signer)).rejects.toThrow(
        'Unsigned lock message was changed after construction',
      );
      expect(signer.getPublicKey).not.toHaveBeenCalled();
      expect(signer.signTransaction).not.toHaveBeenCalled();
      expect(isCurrentSolanaLockFeeQuote(old)).toEqual(false);
    } finally {
      port.dispose();
    }
  });

  /**
   * @target revalidateSolanaLockFeeQuote rejects a wallet event during its fresh fee await
   * @dependencies actual event/session, read and builder modules; deferred fee producer
   * @scenario disconnect event after old quote retirement but before exact fee completion
   * @expected no successor and no revival of predecessor
   */
  it('rejects a wallet event during its fresh fee await', async () => {
    const wallet = mockEventSolanaProvider(keypair(1));
    const port = createEventBoundSolanaWalletPort(() => wallet.provider);
    await port.connect();
    try {
      const f = createFeeQuoteFixture('native', port.captureSession());
      const old = await prepareSolanaLockFeeQuote(...feeQuoteArguments(f));
      f.advance();
      const deferred = deferredReadPortResult();
      f.producers.readMessageFee.mockReturnValue(deferred.promise);
      const pending = revalidateSolanaLockFeeQuote(old);
      await expect.poll(() => f.producers.readMessageFee.mock.calls.length).toEqual(2);
      wallet.emit('disconnect');
      deferred.resolve({ ...f.fee, messageBase64: old.messageBase64 });
      await expect(pending).rejects.toThrow('Solana wallet session is stale');
      expect(isCurrentSolanaLockFeeQuote(old)).toEqual(false);
    } finally {
      port.dispose();
    }
  });
});
