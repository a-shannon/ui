import { Buffer } from 'buffer';

import { describe, expect, it, vi } from 'vitest';

import {
  isCurrentSolanaSignedLock,
  revalidateSolanaSignedLock,
  signSolanaLockFeeQuote,
} from '../src/quotedSigner';
import {
  mockIsCurrentQuotedSignerQuote,
  mockQuotedSignerFixture,
  mockQuotedSignerQuote,
  quotedSignerMocks as mocks,
  retireMockQuotedSignerQuote,
} from './mocked/quotedSigner.mock';
import { deferredReadPortResult } from './readPortTestUtils';

vi.mock('../src/feeQuote', async () => {
  const { quotedSignerMocks } = await import('./mocked/quotedSigner.mock');
  return {
    revalidateSolanaLockFeeQuote: quotedSignerMocks.revalidateSolanaLockFeeQuote,
    getSolanaLockFeeQuoteBuild: quotedSignerMocks.getSolanaLockFeeQuoteBuild,
    isCurrentSolanaLockFeeQuote: quotedSignerMocks.isCurrentSolanaLockFeeQuote,
  };
});
vi.mock('../src/signerPort', async () => {
  const { quotedSignerMocks } = await import('./mocked/quotedSigner.mock');
  return { signSolanaLockTransaction: quotedSignerMocks.signSolanaLockTransaction };
});

describe('signSolanaLockFeeQuote', () => {
  /**
   * @target signSolanaLockFeeQuote captures frozen wire only after prevalidation signing and postvalidation
   * @dependencies fully mocked quote connector and verified signer
   * @scenario both fresh validations succeed and verified signer supplies exact mocked bytes
   * @expected pre/post quote calls, one signing call and only immutable quote/wire public fields
   */
  it('captures frozen wire only after prevalidation signing and postvalidation', async () => {
    const f = mockQuotedSignerFixture();
    const lock = await signSolanaLockFeeQuote(f.quote, f.port);
    expect(mocks.revalidateSolanaLockFeeQuote).toHaveBeenCalledTimes(2);
    expect(mocks.signSolanaLockTransaction).toHaveBeenCalledExactlyOnceWith(f.build, f.port);
    expect(lock.wireBase64).toEqual('BAUG');
    expect(Object.isFrozen(lock)).toEqual(true);
    expect(Object.keys(lock).sort()).toEqual(['quote', 'wireBase64']);
    expect(mockIsCurrentQuotedSignerQuote(f.quote)).toEqual(false);
    expect(isCurrentSolanaSignedLock(lock)).toEqual(true);
    f.transaction.serialize.mockReturnValue(Uint8Array.from([9]));
    expect(lock.wireBase64).toEqual('BAUG');
  });

  /**
   * @target signSolanaLockFeeQuote preserves the identical error at boundary %s
   * @dependencies fully mocked quote connector and verified signer
   * @scenario prevalidation, detached-build creation, signing or postvalidation throws its selected Error
   * @expected exact Error identity; no signed handle and signing only after successful prevalidation
   */
  it.each(['prevalidation', 'build', 'signing', 'postvalidation'] as const)(
    'preserves the identical error at boundary %s',
    async (stage) => {
      const f = mockQuotedSignerFixture();
      const error = new Error(`synthetic ${stage} failure`);
      if (stage === 'prevalidation')
        mocks.revalidateSolanaLockFeeQuote.mockImplementationOnce(async (quote) => {
          retireMockQuotedSignerQuote(quote);
          throw error;
        });
      if (stage === 'build')
        mocks.getSolanaLockFeeQuoteBuild.mockImplementationOnce(() => {
          throw error;
        });
      if (stage === 'signing') mocks.signSolanaLockTransaction.mockRejectedValueOnce(error);
      if (stage === 'postvalidation')
        mocks.revalidateSolanaLockFeeQuote
          .mockImplementationOnce(async (quote) => {
            retireMockQuotedSignerQuote(quote);
            return mockQuotedSignerQuote();
          })
          .mockImplementationOnce(async (quote) => {
            retireMockQuotedSignerQuote(quote);
            throw error;
          });
      await expect(signSolanaLockFeeQuote(f.quote, f.port)).rejects.toBe(error);
      expect(mockIsCurrentQuotedSignerQuote(f.quote)).toEqual(false);
      expect(mocks.signSolanaLockTransaction).toHaveBeenCalledTimes(
        stage === 'prevalidation' || stage === 'build' ? 0 : 1,
      );
    },
  );

  /**
   * @target signSolanaLockFeeQuote refuses a verified-signer message differing from the postvalidation quote
   * @dependencies fully mocked quote connector and verified signer
   * @scenario verified-signer stub serializes message9 while quote retains message1/2/3
   * @expected exact message mismatch and no wire serialization
   */
  it('refuses a verified-signer message differing from the postvalidation quote', async () => {
    const f = mockQuotedSignerFixture();
    f.transaction.serializeMessage.mockReturnValue(Buffer.from([9]));
    await expect(signSolanaLockFeeQuote(f.quote, f.port)).rejects.toThrow(
      'Signed lock differs from the revalidated quote message',
    );
    expect(f.transaction.serialize).not.toHaveBeenCalled();
  });

  /**
   * @target signSolanaLockFeeQuote refuses invalid mocked wire %s
   * @dependencies fully mocked quote connector and verified signer
   * @scenario defensive branch receives nonbytes or a1233-byte result from verified-signer stub
   * @expected exact invalid-wire refusal; not a claim that real signer permits these results
   */
  it.each(['nonbytes', 'oversized'] as const)('refuses invalid mocked wire %s', async (shape) => {
    const f = mockQuotedSignerFixture();
    f.transaction.serialize.mockReturnValue(
      shape === 'oversized' ? new Uint8Array(1233) : ('invalid' as unknown as Uint8Array),
    );
    await expect(signSolanaLockFeeQuote(f.quote, f.port)).rejects.toThrow(
      'Invalid verified signed lock wire',
    );
  });

  /**
   * @target signSolanaLockFeeQuote refuses inactive postvalidation evidence at final capture
   * @dependencies fully mocked quote connector and verified signer
   * @scenario local quote checker refuses the returned postvalidation quote
   * @expected no signed handle despite successful signing and serialization stubs
   */
  it('refuses inactive postvalidation evidence at final capture', async () => {
    const f = mockQuotedSignerFixture();
    mocks.isCurrentSolanaLockFeeQuote.mockReturnValue(false);
    await expect(signSolanaLockFeeQuote(f.quote, f.port)).rejects.toThrow(
      'Solana signed lock fee quote is stale or not captured',
    );
  });
});

describe('isCurrentSolanaSignedLock', () => {
  /**
   * @target isCurrentSolanaSignedLock refuses forged copies and performs no fresh validation reads
   * @dependencies fully mocked quote connector and verified signer
   * @scenario test original handle, copied fields and primitive values then retire its quote
   * @expected original brand required and no extra quote revalidation
   */
  it('refuses forged copies and performs no fresh validation reads', async () => {
    const f = mockQuotedSignerFixture();
    const lock = await signSolanaLockFeeQuote(f.quote, f.port);
    expect(isCurrentSolanaSignedLock(lock)).toEqual(true);
    for (const value of [{ ...lock }, null, 'wire', undefined])
      expect(isCurrentSolanaSignedLock(value)).toEqual(false);
    expect(mocks.revalidateSolanaLockFeeQuote).toHaveBeenCalledTimes(2);
    retireMockQuotedSignerQuote(lock.quote);
    expect(isCurrentSolanaSignedLock(lock)).toEqual(false);
  });

  /**
   * @target isCurrentSolanaSignedLock rechecks retirement after a reentrant external quote check
   * @dependencies fully mocked quote connector and verified signer; one reentrant quote checker
   * @scenario quote checking starts signed-handle revalidation before returning true
   * @expected old signed handle reports false after the callback; successor remains current
   */
  it('rechecks retirement after a reentrant external quote check', async () => {
    const f = mockQuotedSignerFixture();
    const lock = await signSolanaLockFeeQuote(f.quote, f.port);
    let successor: ReturnType<typeof revalidateSolanaSignedLock> | undefined;
    mocks.isCurrentSolanaLockFeeQuote.mockImplementationOnce(() => {
      successor = revalidateSolanaSignedLock(lock);
      return true;
    });
    expect(isCurrentSolanaSignedLock(lock)).toEqual(false);
    expect(isCurrentSolanaSignedLock(await successor)).toEqual(true);
  });
});

describe('revalidateSolanaSignedLock', () => {
  /**
   * @target revalidateSolanaSignedLock preserves wire and retires the predecessor without signing again
   * @dependencies fully mocked quote connector and verified signer
   * @scenario one fresh quote succeeds for an already captured signed handle
   * @expected new current handle with same wire, old handle/quote inactive and signing count1
   */
  it('preserves wire and retires the predecessor without signing again', async () => {
    const f = mockQuotedSignerFixture();
    const old = await signSolanaLockFeeQuote(f.quote, f.port);
    const successor = await revalidateSolanaSignedLock(old);
    expect(successor.wireBase64).toEqual(old.wireBase64);
    expect(isCurrentSolanaSignedLock(old)).toEqual(false);
    expect(mockIsCurrentQuotedSignerQuote(old.quote)).toEqual(false);
    expect(isCurrentSolanaSignedLock(successor)).toEqual(true);
    expect(mocks.signSolanaLockTransaction).toHaveBeenCalledTimes(1);
  });

  /**
   * @target revalidateSolanaSignedLock keeps old handle and quote retired after the identical pending-read error
   * @dependencies fully mocked quote connector and verified signer; deferred quote read
   * @scenario start revalidation, retire quote synchronously, then reject fresh read
   * @expected same Error object propagates; old state inactive before/after rejection and no resign
   */
  it('keeps old handle and quote retired after the identical pending-read error', async () => {
    const f = mockQuotedSignerFixture();
    const old = await signSolanaLockFeeQuote(f.quote, f.port);
    const deferred = deferredReadPortResult();
    mocks.revalidateSolanaLockFeeQuote.mockImplementationOnce((quote) => {
      retireMockQuotedSignerQuote(quote);
      return deferred.promise as ReturnType<typeof mocks.revalidateSolanaLockFeeQuote>;
    });
    const pending = revalidateSolanaSignedLock(old);
    expect(isCurrentSolanaSignedLock(old)).toEqual(false);
    expect(mockIsCurrentQuotedSignerQuote(old.quote)).toEqual(false);
    const error = new Error('synthetic pending quote failure');
    const rejected = expect(pending).rejects.toBe(error);
    deferred.reject(error);
    await rejected;
    expect(isCurrentSolanaSignedLock(old)).toEqual(false);
    expect(mocks.signSolanaLockTransaction).toHaveBeenCalledTimes(1);
  });

  /**
   * @target revalidateSolanaSignedLock refuses copied or retired handles before fresh reads
   * @dependencies fully mocked quote connector and verified signer
   * @scenario copy a signed DTO, then successfully consume its original and attempt reuse
   * @expected precise branding/retirement error with no extra revalidation
   */
  it('refuses copied or retired handles before fresh reads', async () => {
    const f = mockQuotedSignerFixture();
    const lock = await signSolanaLockFeeQuote(f.quote, f.port);
    await expect(revalidateSolanaSignedLock({ ...lock })).rejects.toThrow(
      'Solana signed lock is stale or not captured',
    );
    await revalidateSolanaSignedLock(lock);
    await expect(revalidateSolanaSignedLock(lock)).rejects.toThrow(
      'Solana signed lock is stale or not captured',
    );
    expect(mocks.revalidateSolanaLockFeeQuote).toHaveBeenCalledTimes(3);
  });
});
