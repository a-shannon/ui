import bs58 from 'bs58';

import { buildSolanaLockMessage, type SolanaRpcSubmissionRequest } from '@rosen-network/solana';

import { ergoDestination, keypair, nativeProfile, splProfile } from './testUtils';

/** Signs a deterministic SOL or original-SPL fixture using a local synthetic key. */
export const submissionRequest = (asset: 'SOL' | 'SPL'): SolanaRpcSubmissionRequest => {
  const signer = keypair(113);
  const mint = keypair(127).publicKey.toBase58();
  const profile =
    asset === 'SOL' ? nativeProfile() : splProfile(mint, keypair(137).publicKey.toBase58());
  const build = buildSolanaLockMessage(profile, {
    asset: asset === 'SOL' ? 'SOL' : mint,
    grossAmount: '1000000',
    destinationAddress: ergoDestination,
    senderAddress: signer.publicKey.toBase58(),
    recentBlockhash: keypair(121).publicKey.toBase58(),
    ...(asset === 'SPL' ? { sourceTokenAccount: keypair(139).publicKey.toBase58() } : {}),
  });
  build.transaction.sign(signer);
  const signature = build.transaction.signature;
  if (!signature) throw new Error('Fixture did not produce a signature');
  return Object.freeze({
    wireBase64: build.transaction.serialize().toString('base64'),
    expectedSignature: bs58.encode(signature),
    contextSlot: 9_007_199_254_740_993n,
  });
};
