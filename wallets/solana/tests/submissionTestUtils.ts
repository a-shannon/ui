import { signSolanaLockFeeQuote } from '../src/quotedSigner';
import { createQuotedSignerJoinFixture } from './quotedSignerTestUtils';

/** Creates a real captured SOL/SPL quote and verified signed wire for submission tests. */
export const createSignedSubmissionFixture = async (kind: 'native' | 'spl' = 'native') => {
  const fixture = await createQuotedSignerJoinFixture(kind);
  try {
    const lock = await signSolanaLockFeeQuote(fixture.quote, fixture.port);
    return { ...fixture, lock };
  } catch (error) {
    fixture.port.dispose();
    throw error;
  }
};
