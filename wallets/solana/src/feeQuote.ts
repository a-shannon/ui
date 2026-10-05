import { createSolanaLockFeeQuoteService } from '@rosen-network/solana';

import { isCurrentSolanaWalletSession } from './eventBoundWalletPort';

const quotes = createSolanaLockFeeQuoteService(isCurrentSolanaWalletSession);

/** Prepares a network quote using only a wallet-owned, continuously observed session. */
export const prepareSolanaLockFeeQuote = quotes.prepare;

/** Requires this wallet service's captured quote and original current session. */
export const isCurrentSolanaLockFeeQuote = quotes.isCurrent;

/** Retrieves the network's detached exact-message build after session validation. */
export const getSolanaLockFeeQuoteBuild = quotes.getBuild;

/** Retires the preceding quote before refreshing through the same wallet authority. */
export const revalidateSolanaLockFeeQuote = quotes.revalidate;

export type {
  SolanaLockFeeIntent,
  SolanaLockFeeOptions,
  SolanaLockFeeProducers,
  SolanaLockFeeQuote,
} from '@rosen-network/solana';
