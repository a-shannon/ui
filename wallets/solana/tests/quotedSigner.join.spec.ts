import { Buffer } from 'buffer';

import { describe, expect, it } from 'vitest';

import { isCurrentSolanaLockFeeQuote } from '../src/feeQuote';
import {
  isCurrentSolanaSignedLock,
  revalidateSolanaSignedLock,
  signSolanaLockFeeQuote,
} from '../src/quotedSigner';
import {
  createQuotedSignerJoinFixture,
  decodeQuotedSignerWire,
  deferQuotedSignerWallet,
} from './quotedSignerTestUtils';
import { deferredReadPortResult } from './readPortTestUtils';
import { keypair } from './testUtils';

describe('signSolanaLockFeeQuote', () => {
  /**
   * @target signSolanaLockFeeQuote joins exact %s wire signature and three fresh balance/fee validations
   * @dependencies actual event/session, read, builder, fee quote and verified signer; synthetic wallet/services
   * @scenario prepare, prevalidate, authorize the exact message and postvalidate one native or original-SPL lock
   * @expected verified signature/message bytes, reads3/hash1/sign1 and frozen wire with no SDK alias
   */
  it.each(['native', 'spl'] as const)(
    'joins exact %s wire signature and three fresh balance/fee validations',
    async (kind) => {
      const f = await createQuotedSignerJoinFixture(kind);
      try {
        const lock = await signSolanaLockFeeQuote(f.quote, f.port);
        const wire = decodeQuotedSignerWire(lock.wireBase64);
        expect(wire.verifySignatures()).toEqual(true);
        expect(Buffer.from(wire.serializeMessage()).toString('base64')).toEqual(
          lock.quote.messageBase64,
        );
        expect(lock.quote.messageBase64).toEqual(f.quote.messageBase64);
        expect(f.producers.readBalance).toHaveBeenCalledTimes(3);
        expect(f.producers.readMessageFee).toHaveBeenCalledTimes(3);
        expect(f.producers.readFeePayer).toHaveBeenCalledTimes(3);
        expect(f.producers.readRentMinimum).toHaveBeenCalledTimes(3);
        expect(f.producers.readBlockHeight).toHaveBeenCalledTimes(3);
        expect(f.producers.readLatestBlockhash).toHaveBeenCalledTimes(1);
        expect(f.wallet.provider.signTransaction).toHaveBeenCalledTimes(1);
        expect(isCurrentSolanaLockFeeQuote(f.quote)).toEqual(false);
        expect(Object.isFrozen(lock)).toEqual(true);
        expect(Object.keys(lock).sort()).toEqual(['quote', 'wireBase64']);
        const originalWire = lock.wireBase64;
        wire.recentBlockhash = keypair(12).publicKey.toBase58();
        expect(lock.wireBase64).toEqual(originalWire);
        expect(isCurrentSolanaSignedLock(lock)).toEqual(true);
        expect(isCurrentSolanaSignedLock({ ...lock })).toEqual(false);
      } finally {
        f.port.dispose();
      }
    },
  );

  /**
   * @target signSolanaLockFeeQuote refuses invalid prevalidation %s before wallet calls
   * @dependencies actual event/session, read, builder, fee quote and verified signer; synthetic wallet/services
   * @scenario independently unavailable fee, non-system payer, native shortage, expiration or selected SPL shortage
   * @expected precise prevalidation error and no wallet authorization call
   */
  it.each([
    'fee',
    'payer',
    'native balance',
    'expiry',
    'SPL amount',
    'SPL native overhead',
  ] as const)('refuses invalid prevalidation %s before wallet calls', async (scenario) => {
    const f = await createQuotedSignerJoinFixture(scenario.startsWith('SPL') ? 'spl' : 'native');
    try {
      let error = '';
      if (scenario === 'fee') {
        f.fee.feeLamports = null;
        error = 'Message fee is unavailable';
      }
      if (scenario === 'payer') {
        f.payer.owner = keypair(2).publicKey.toBase58();
        error = 'Fee payer must be owned by System Program';
      }
      if (scenario === 'native balance') {
        f.balance.nativeBalance = 1017n;
        error = 'Insufficient native gross balance';
      }
      if (scenario === 'expiry') {
        f.height.blockHeight = 201n;
        error = 'Solana quote blockhash expired';
      }
      if (scenario === 'SPL amount') {
        f.balance.tokenAccounts = [{ ...f.balance.tokenAccounts[0], amount: 999n }];
        error = 'Insufficient selected SPL account balance';
      }
      if (scenario === 'SPL native overhead') {
        f.balance.nativeBalance = 17n;
        error = 'Insufficient native fee and reserve balance';
      }
      await expect(signSolanaLockFeeQuote(f.quote, f.port)).rejects.toThrow(error);
      expect(f.wallet.provider.signTransaction).not.toHaveBeenCalled();
      expect(isCurrentSolanaLockFeeQuote(f.quote)).toEqual(false);
    } finally {
      f.port.dispose();
    }
  });

  /**
   * @target signSolanaLockFeeQuote refuses postvalidation change %s during the actual wallet await
   * @dependencies actual event/session, read, builder, fee quote and verified signer; deferred synthetic wallet
   * @scenario fee/budget/account balance or confirmed height changes after prevalidation but before signing completes
   * @expected wallet signs once but fresh postvalidation refuses a signed handle with exact reason
   */
  it.each([
    'expiry',
    'null fee',
    'higher fee',
    'native balance',
    'payer lamports',
    'SPL amount',
    'SPL native overhead',
  ] as const)(
    'refuses postvalidation change %s during the actual wallet await',
    async (scenario) => {
      const f = await createQuotedSignerJoinFixture(scenario.startsWith('SPL') ? 'spl' : 'native');
      try {
        const deferred = deferQuotedSignerWallet(f);
        const pending = signSolanaLockFeeQuote(f.quote, f.port);
        await expect.poll(() => f.wallet.provider.signTransaction.mock.calls.length).toEqual(1);
        let error = '';
        if (scenario === 'expiry') {
          f.height.blockHeight = 201n;
          error = 'Solana quote blockhash expired';
        }
        if (scenario === 'null fee') {
          f.fee.feeLamports = null;
          error = 'Message fee is unavailable';
        }
        if (scenario === 'higher fee') {
          f.fee.feeLamports = 1000n;
          error = 'Insufficient native gross balance';
        }
        if (scenario === 'native balance') {
          f.balance.nativeBalance = 1017n;
          error = 'Insufficient native gross balance';
        }
        if (scenario === 'payer lamports') {
          f.payer.lamports = 17n;
          error = 'Insufficient native fee and reserve balance';
        }
        if (scenario === 'SPL amount') {
          f.balance.tokenAccounts = [{ ...f.balance.tokenAccounts[0], amount: 999n }];
          error = 'Insufficient selected SPL account balance';
        }
        if (scenario === 'SPL native overhead') {
          f.balance.nativeBalance = 17n;
          error = 'Insufficient native fee and reserve balance';
        }
        const rejected = expect(pending).rejects.toThrow(error);
        deferred.resolve(undefined);
        await rejected;
        expect(f.wallet.provider.signTransaction).toHaveBeenCalledTimes(1);
        expect(f.producers.readBalance).toHaveBeenCalledTimes(3);
      } finally {
        f.port.dispose();
      }
    },
  );

  /**
   * @target signSolanaLockFeeQuote rejects an actual account A to B to A transition during wallet await
   * @dependencies actual event/session, read, builder, fee quote and verified signer; deferred synthetic wallet/events
   * @scenario wallet account changes and is restored with events before authorizing the original transaction
   * @expected event generation change prevents a signed handle despite restored account string
   */
  it('rejects an actual account A to B to A transition during wallet await', async () => {
    const f = await createQuotedSignerJoinFixture();
    try {
      const deferred = deferQuotedSignerWallet(f);
      const pending = signSolanaLockFeeQuote(f.quote, f.port);
      await expect.poll(() => f.wallet.provider.signTransaction.mock.calls.length).toEqual(1);
      f.wallet.provider.publicKey = keypair(2).publicKey;
      f.wallet.emit('accountChanged');
      f.wallet.provider.publicKey = keypair(1).publicKey;
      f.wallet.emit('accountChanged');
      const rejected = expect(pending).rejects.toThrow('Wallet connection changed during signing');
      deferred.resolve(undefined);
      await rejected;
      expect(isCurrentSolanaLockFeeQuote(f.quote)).toEqual(false);
    } finally {
      f.port.dispose();
    }
  });

  /**
   * @target signSolanaLockFeeQuote preserves the identical actual callback Error at %s
   * @dependencies actual event/session, read, builder, fee quote and verified signer; synthetic rejecting services/wallet
   * @scenario prevalidation balance, wallet authorization or postvalidation balance rejects its selected Error
   * @expected same Error object reaches caller and original quote remains retired
   */
  it.each(['prevalidation', 'wallet', 'postvalidation'] as const)(
    'preserves the identical actual callback Error at %s',
    async (stage) => {
      const f = await createQuotedSignerJoinFixture();
      try {
        const error = new Error(`synthetic actual ${stage}`);
        if (stage === 'prevalidation') f.producers.readBalance.mockRejectedValueOnce(error);
        if (stage === 'wallet') f.wallet.provider.signTransaction.mockRejectedValueOnce(error);
        if (stage === 'postvalidation') {
          const original = f.producers.readBalance.getMockImplementation();
          if (!original) throw new Error('Missing fixture balance callback');
          f.producers.readBalance.mockImplementationOnce(original).mockRejectedValueOnce(error);
        }
        await expect(signSolanaLockFeeQuote(f.quote, f.port)).rejects.toBe(error);
        expect(isCurrentSolanaLockFeeQuote(f.quote)).toEqual(false);
        expect(f.wallet.provider.signTransaction).toHaveBeenCalledTimes(
          stage === 'prevalidation' ? 0 : 1,
        );
      } finally {
        f.port.dispose();
      }
    },
  );
});

describe('revalidateSolanaSignedLock', () => {
  /**
   * @target revalidateSolanaSignedLock preserves the exact verified wire without another wallet signature
   * @dependencies actual event/session, read, builder, fee quote and verified signer; synthetic wallet/services
   * @scenario fresh signed-lock revalidation after a completed original-SPL authorization
   * @expected identical signature wire, old handle/quote retired, reads4/hash1/sign1
   */
  it('preserves the exact verified wire without another wallet signature', async () => {
    const f = await createQuotedSignerJoinFixture('spl');
    try {
      const old = await signSolanaLockFeeQuote(f.quote, f.port);
      const successor = await revalidateSolanaSignedLock(old);
      expect(successor.wireBase64).toEqual(old.wireBase64);
      expect(decodeQuotedSignerWire(successor.wireBase64).verifySignatures()).toEqual(true);
      expect(isCurrentSolanaSignedLock(old)).toEqual(false);
      expect(isCurrentSolanaLockFeeQuote(old.quote)).toEqual(false);
      expect(isCurrentSolanaSignedLock(successor)).toEqual(true);
      expect(f.producers.readBalance).toHaveBeenCalledTimes(4);
      expect(f.producers.readLatestBlockhash).toHaveBeenCalledTimes(1);
      expect(f.wallet.provider.signTransaction).toHaveBeenCalledTimes(1);
    } finally {
      f.port.dispose();
    }
  });

  /**
   * @target revalidateSolanaSignedLock keeps old handle and quote retired across an identical pending balance error
   * @dependencies actual event/session, read, builder, fee quote and verified signer; deferred raw balance service
   * @scenario start fresh validation of signed handle, observe retirement, then reject the pending service
   * @expected identical Error propagates, no revived handle/quote and no second authorization
   */
  it('keeps old handle and quote retired across an identical pending balance error', async () => {
    const f = await createQuotedSignerJoinFixture();
    try {
      const old = await signSolanaLockFeeQuote(f.quote, f.port);
      const deferred = deferredReadPortResult();
      f.producers.readBalance.mockReturnValueOnce(deferred.promise);
      const pending = revalidateSolanaSignedLock(old);
      expect(isCurrentSolanaSignedLock(old)).toEqual(false);
      expect(isCurrentSolanaLockFeeQuote(old.quote)).toEqual(false);
      const error = new Error('synthetic pending raw balance failure');
      const rejected = expect(pending).rejects.toBe(error);
      deferred.reject(error);
      await rejected;
      expect(isCurrentSolanaSignedLock(old)).toEqual(false);
      expect(isCurrentSolanaLockFeeQuote(old.quote)).toEqual(false);
      expect(f.wallet.provider.signTransaction).toHaveBeenCalledTimes(1);
    } finally {
      f.port.dispose();
    }
  });
});

describe('isCurrentSolanaSignedLock', () => {
  /**
   * @target isCurrentSolanaSignedLock checks local state without refreshing fee or height
   * @dependencies actual event/session, read, builder, fee quote and verified signer; synthetic wallet/services
   * @scenario check valid handle then disconnect; no fresh service call occurs in either predicate
   * @expected local currentness follows session only and service reads stay3
   */
  it('checks local state without refreshing fee or height', async () => {
    const f = await createQuotedSignerJoinFixture();
    try {
      const lock = await signSolanaLockFeeQuote(f.quote, f.port);
      expect(isCurrentSolanaSignedLock(lock)).toEqual(true);
      f.wallet.emit('disconnect');
      expect(isCurrentSolanaSignedLock(lock)).toEqual(false);
      expect(f.producers.readMessageFee).toHaveBeenCalledTimes(3);
      expect(f.producers.readBlockHeight).toHaveBeenCalledTimes(3);
    } finally {
      f.port.dispose();
    }
  });
});
