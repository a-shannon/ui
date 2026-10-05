import { Buffer } from 'buffer';

import { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

import {
  claimSolanaSignedLockForSubmission,
  revalidateSolanaSignedLock,
  type SolanaSignedLock,
} from './quotedSigner';

/** Immutable exact-wire request for one configured transport handoff. */
export interface SolanaLockSubmissionRequest {
  readonly wireBase64: string;
  readonly expectedSignature: string;
  readonly contextSlot: bigint;
}

/** The configured transport must begin sending this request when invoked. */
export type SolanaLockSubmissionPort = (request: SolanaLockSubmissionRequest) => Promise<string>;

/** The send may have reached the network; reconcile this signature before acting again. */
export class SolanaAmbiguousSubmissionError extends Error {
  public readonly expectedSignature: string;
  public readonly causeValue: unknown;

  public constructor(expectedSignature: string, causeValue: unknown) {
    super(`Solana submission outcome is ambiguous for ${expectedSignature}`);
    this.name = 'SolanaAmbiguousSubmissionError';
    this.expectedSignature = expectedSignature;
    this.causeValue = causeValue;
  }
}

/** Derives the transaction identity from the exact canonical signed wire bytes. */
const expectedTransactionSignature = (wireBase64: string): string => {
  const wire = Buffer.from(wireBase64, 'base64');
  if (wire.length === 0 || wire.length > 1232 || wire.toString('base64') !== wireBase64)
    throw new Error('Invalid captured Solana signed wire');

  const transaction = Transaction.from(Uint8Array.from(wire));
  const canonicalWire = transaction.serialize({
    requireAllSignatures: true,
    verifySignatures: true,
  });
  if (Buffer.from(canonicalWire).toString('base64') !== wireBase64)
    throw new Error('Captured Solana signed wire is not canonical');
  const message = transaction.compileMessage();
  const signature = transaction.signatures[0]?.signature;
  if (
    message.header.numRequiredSignatures !== 1 ||
    transaction.signatures.length !== 1 ||
    !signature ||
    signature.length !== 64 ||
    !transaction.verifySignatures()
  )
    throw new Error('Captured Solana wire does not contain one verified transaction signature');
  return bs58.encode(signature);
};

/**
 * Refreshes the exact signed message budget, retires the fresh handle, then
 * invokes one configured send callback with frozen wire and expected identity.
 * It does not rebuild, sign, retry, confirm, or persist recovery state. Once the
 * callback is invoked, its result is not masked by later wallet-session changes.
 */
export const submitSolanaSignedLock = async (
  lock: SolanaSignedLock,
  send: SolanaLockSubmissionPort,
): Promise<string> => {
  if (typeof send !== 'function') throw new TypeError('A Solana submission callback is required');

  const freshLock = await revalidateSolanaSignedLock(lock);
  const snapshot = claimSolanaSignedLockForSubmission(freshLock);
  if (snapshot.wireBase64 !== freshLock.wireBase64)
    throw new Error('Fresh Solana signed lock wire changed before submission');
  const expectedSignature = expectedTransactionSignature(snapshot.wireBase64);
  const request = Object.freeze({
    wireBase64: snapshot.wireBase64,
    expectedSignature,
    contextSlot: snapshot.quote.contextSlot,
  });

  try {
    const acknowledgedSignature = await send(request);
    if (acknowledgedSignature !== expectedSignature)
      throw new Error('Submission callback returned a missing or mismatched signature');
    return expectedSignature;
  } catch (cause) {
    throw new SolanaAmbiguousSubmissionError(expectedSignature, cause);
  }
};
