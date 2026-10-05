import {
  readSolanaWalletBalance as readBalance,
  type SolanaLockProfile,
  type SolanaWalletReadProducer,
  type SolanaWalletSession,
} from '@rosen-network/solana';

import { isCurrentSolanaWalletSession } from './eventBoundWalletPort';

/** Supplies the wallet's private session check to the network-owned inventory reader. */
export const readSolanaWalletBalance = (
  profile: SolanaLockProfile,
  session: SolanaWalletSession,
  producer: SolanaWalletReadProducer,
) => readBalance(profile, session, producer, isCurrentSolanaWalletSession);

export type {
  SolanaWalletBalanceView,
  SolanaWalletReadProducer,
  SolanaWalletReadRequest,
  SolanaWalletReadResult,
  SolanaWalletTokenAccount,
} from '@rosen-network/solana';
export {
  isCurrentSolanaWalletBalanceView,
  selectSolanaSourceTokenAccount,
} from '@rosen-network/solana';
