import type { Keypair } from '@solana/web3.js';

import { buildSolanaLockMessage } from '@rosen-network/solana';

import { ergoDestination, keypair, nativeProfile, splProfile } from './testUtils';

/** Builds an actual synthetic SOL or SPL lock for the observed session tests. */
export const buildEventWalletLock = (signer: Keypair, spl = false) => {
  const mint = keypair(4).publicKey.toBase58();
  return buildSolanaLockMessage(
    spl ? splProfile(mint, keypair(5).publicKey.toBase58()) : nativeProfile(),
    {
      asset: spl ? mint : 'SOL',
      grossAmount: '1000',
      destinationAddress: ergoDestination,
      senderAddress: signer.publicKey.toBase58(),
      recentBlockhash: keypair(3).publicKey.toBase58(),
      ...(spl ? { sourceTokenAccount: keypair(6).publicKey.toBase58() } : {}),
    },
  );
};
