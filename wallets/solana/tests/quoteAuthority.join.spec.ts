import { describe, expect, it } from 'vitest';

import { createSolanaLockFeeQuoteService, type SolanaWalletSession } from '@rosen-network/solana';

import { getSolanaLockFeeQuoteBuild, isCurrentSolanaLockFeeQuote } from '../src/feeQuote';
import { signSolanaLockFeeQuote } from '../src/quotedSigner';
import { createQuotedSignerJoinFixture } from './quotedSignerTestUtils';

/** Accepts ordinary session-shaped values without the wallet's captured callback identity. */
const permissiveSessionCurrentness = (value: unknown): value is SolanaWalletSession => {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as { readonly publicKey?: unknown }).publicKey === 'string';
};

describe('Wallet quote authority join', () => {
  /**
   * @target Wallet quote operations reject a quote captured by a separately configured Network service
   * @dependencies actual Network quote service, actual Wallet event session and synthetic fee producers
   * @scenario create a Network quote with a distinct permissive currentness predicate, then test Wallet acceptance and control
   * @expected quote callback shape alone cannot mint Wallet authority; the Wallet-captured quote still signs
   */
  it('rejects a Network quote from a different currentness authority and preserves the Wallet control', async () => {
    const f = await createQuotedSignerJoinFixture();
    try {
      expect(permissiveSessionCurrentness(f.session)).toEqual(true);
      const networkQuotes = createSolanaLockFeeQuoteService(permissiveSessionCurrentness);
      const networkQuote = await networkQuotes.prepare(
        f.profile,
        f.session,
        f.intent,
        f.producers,
        f.options,
      );

      expect(networkQuotes.isCurrent(networkQuote)).toEqual(true);
      expect(isCurrentSolanaLockFeeQuote(networkQuote)).toEqual(false);
      expect(() => getSolanaLockFeeQuoteBuild(networkQuote)).toThrow(
        'Solana fee quote is stale or not captured',
      );
      await expect(signSolanaLockFeeQuote(networkQuote, f.port)).rejects.toThrow(
        'Solana fee quote is stale or not captured',
      );
      expect(f.wallet.provider.signTransaction).not.toHaveBeenCalled();

      expect(isCurrentSolanaLockFeeQuote(f.quote)).toEqual(true);
      const walletLock = await signSolanaLockFeeQuote(f.quote, f.port);
      expect(walletLock.wireBase64.length).toBeGreaterThan(0);
      expect(f.wallet.provider.signTransaction).toHaveBeenCalledTimes(1);
    } finally {
      f.port.dispose();
    }
  });
});
