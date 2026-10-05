import { describe, expect, it } from 'vitest';

import {
  claimSolanaSignedLockForSubmission,
  isCurrentSolanaSignedLock,
  revalidateSolanaSignedLock,
} from '../src/quotedSigner';
import { createSignedSubmissionFixture } from './submissionTestUtils';

describe('claimSolanaSignedLockForSubmission', () => {
  /**
   * @target claimSolanaSignedLockForSubmission returns the exact captured quote and bytes once
   * @dependencies actual wallet session, fee quote, verified signed wire and fresh revalidation
   * @scenario refresh a locally signed SOL transaction then claim its exact submission snapshot
   * @expected one frozen snapshot retains quote identity and wire while the fresh handle retires
   */
  it('returns the exact captured quote and bytes once', async () => {
    const f = await createSignedSubmissionFixture();
    try {
      const originalWire = f.lock.wireBase64;
      const fresh = await revalidateSolanaSignedLock(f.lock);
      expect(isCurrentSolanaSignedLock(f.lock)).toEqual(false);
      expect(isCurrentSolanaSignedLock(fresh)).toEqual(true);

      const snapshot = claimSolanaSignedLockForSubmission(fresh);
      expect(snapshot.quote).toBe(fresh.quote);
      expect(snapshot.wireBase64).toEqual(originalWire);
      expect(Object.isFrozen(snapshot)).toEqual(true);
      expect(isCurrentSolanaSignedLock(fresh)).toEqual(false);
      expect(() => claimSolanaSignedLockForSubmission(fresh)).toThrow(
        'Solana signed lock is stale, foreign, or already handed off',
      );
    } finally {
      f.port.dispose();
    }
  });

  /**
   * @target claimSolanaSignedLockForSubmission refuses copied, stale and disconnected handles
   * @dependencies actual captured wallet handle plus the real session revocation lifecycle
   * @scenario try a copy, retire its source through revalidation, then disconnect the fresh successor
   * @expected only a current opaque handle can be claimed and every refusal precedes handoff
   */
  it('refuses copied, stale and disconnected handles', async () => {
    const f = await createSignedSubmissionFixture();
    try {
      const copied = { ...f.lock };
      expect(() => claimSolanaSignedLockForSubmission(copied)).toThrow(
        'Solana signed lock is stale, foreign, or already handed off',
      );

      const fresh = await revalidateSolanaSignedLock(f.lock);
      expect(() => claimSolanaSignedLockForSubmission(f.lock)).toThrow(
        'Solana signed lock is stale, foreign, or already handed off',
      );
      f.port.dispose();
      expect(() => claimSolanaSignedLockForSubmission(fresh)).toThrow(
        'Solana signed lock is stale, foreign, or already handed off',
      );
      expect(isCurrentSolanaSignedLock(fresh)).toEqual(false);
    } finally {
      f.port.dispose();
    }
  });
});
