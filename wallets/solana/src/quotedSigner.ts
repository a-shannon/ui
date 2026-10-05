import { Buffer } from 'buffer';

import {
  getSolanaLockFeeQuoteBuild,
  isCurrentSolanaLockFeeQuote,
  revalidateSolanaLockFeeQuote,
  type SolanaLockFeeQuote,
} from './feeQuote';
import { type SolanaSignerPort, signSolanaLockTransaction } from './signerPort';

/** Verified wire with a local fee/session binding; no transaction has been submitted. */
export interface SolanaSignedLock {
  readonly quote: SolanaLockFeeQuote;
  readonly wireBase64: string;
}

interface SignedEvidence {
  readonly quote: SolanaLockFeeQuote;
  readonly wireBase64: string;
  active: boolean;
}

const signedLocks = new WeakMap<SolanaSignedLock, SignedEvidence>();

/** Requires the original local quote, including its originating wallet session. */
const requireQuote = (quote: SolanaLockFeeQuote): void => {
  if (!isCurrentSolanaLockFeeQuote(quote))
    throw new Error('Solana signed lock fee quote is stale or not captured');
};

/** Captures immutable verified wire without exposing a mutable SDK transaction. */
const captureSignedLock = (quote: SolanaLockFeeQuote, wireBase64: string): SolanaSignedLock => {
  requireQuote(quote);
  const lock = Object.freeze({ quote, wireBase64 });
  signedLocks.set(lock, { quote, wireBase64, active: true });
  return lock;
};

/** Exact captured bytes and quote for the one local submission handoff. */
export interface SolanaSignedLockSubmissionSnapshot {
  readonly quote: SolanaLockFeeQuote;
  readonly wireBase64: string;
}

/**
 * Atomically retires one freshly validated handle before its transport callback
 * can run. The callback result must remain authoritative even if the wallet
 * session is revoked while that external send is pending.
 */
export const claimSolanaSignedLockForSubmission = (
  lock: SolanaSignedLock,
): SolanaSignedLockSubmissionSnapshot => {
  if (!isCurrentSolanaSignedLock(lock))
    throw new Error('Solana signed lock is stale, foreign, or already handed off');
  const evidence = signedLocks.get(lock);
  if (!evidence) throw new Error('Solana signed lock is stale, foreign, or already handed off');
  evidence.active = false;
  return Object.freeze({ quote: evidence.quote, wireBase64: evidence.wireBase64 });
};

/**
 * Rereads fees, balances, rent and expiry before and after the wallet signing await.
 * The quote supplies a detached exact message; the existing signer verifies its
 * compiled bytes and signature. Read failures retire the preceding quote and do
 * not return wire. This does not submit a transaction or establish RPC authority.
 */
export const signSolanaLockFeeQuote = async (
  quote: SolanaLockFeeQuote,
  port: SolanaSignerPort,
): Promise<SolanaSignedLock> => {
  const beforeSigning = await revalidateSolanaLockFeeQuote(quote);
  const build = getSolanaLockFeeQuoteBuild(beforeSigning);
  const transaction = await signSolanaLockTransaction(build, port);
  const afterSigning = await revalidateSolanaLockFeeQuote(beforeSigning);
  const messageBase64 = Buffer.from(transaction.serializeMessage()).toString('base64');
  if (messageBase64 !== afterSigning.messageBase64)
    throw new Error('Signed lock differs from the revalidated quote message');
  const wire = transaction.serialize({ requireAllSignatures: true, verifySignatures: true });
  if (!(wire instanceof Uint8Array) || wire.length > 1232)
    throw new Error('Invalid verified signed lock wire');
  return captureSignedLock(afterSigning, Buffer.from(wire).toString('base64'));
};

/** Checks only local provenance, retirement and quote/session identity, never fresh chain state. */
export const isCurrentSolanaSignedLock = (value: unknown): value is SolanaSignedLock => {
  if (typeof value !== 'object' || value === null) return false;
  const evidence = signedLocks.get(value as SolanaSignedLock);
  if (!evidence?.active) return false;
  return isCurrentSolanaLockFeeQuote(evidence.quote) && evidence.active;
};

/**
 * Rereads the same exact signed message's budget and expiry without signing again.
 * Retires the old local signed handle before external reads, including failures.
 * The submission consumer performs this check immediately before its transport
 * handoff; a current predicate alone does not grant live freshness.
 */
export const revalidateSolanaSignedLock = async (
  lock: SolanaSignedLock,
): Promise<SolanaSignedLock> => {
  if (!isCurrentSolanaSignedLock(lock))
    throw new Error('Solana signed lock is stale or not captured');
  const evidence = signedLocks.get(lock);
  if (!evidence) throw new Error('Solana signed lock was not captured');
  evidence.active = false;
  const quote = await revalidateSolanaLockFeeQuote(evidence.quote);
  return captureSignedLock(quote, evidence.wireBase64);
};
