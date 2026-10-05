import { PublicKey, Transaction } from '@solana/web3.js';

import {
  getSolanaLockBuildEvidence,
  hasCapturedSolanaLockMessage,
  type SolanaLockBuild,
} from '@rosen-network/solana';

export interface SolanaSignerPort {
  readonly getPublicKey: () => string | null;
  readonly signTransaction: (transaction: Transaction) => Promise<Transaction>;
}

/** Rejects disconnected wallets and noncanonical public key responses. */
const requireSignerKey = (value: string | null): PublicKey => {
  if (typeof value !== 'string') throw new Error('Wallet is disconnected');
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value) throw new Error('noncanonical');
    return key;
  } catch {
    throw new Error('Wallet returned an invalid public key');
  }
};

/**
 * Signs only a builder-owned transaction whose compiled message still matches
 * the captured bytes, and rejects any wallet response that changes them.
 */
export const signSolanaLockTransaction = async (
  build: SolanaLockBuild,
  port: SolanaSignerPort,
): Promise<Transaction> => {
  const evidence = getSolanaLockBuildEvidence(build);
  if (!evidence || !hasCapturedSolanaLockMessage(build))
    throw new Error('Unsigned lock message was changed after construction');
  if (build.transaction.signatures.some(({ signature }) => signature !== null))
    throw new Error('Lock transaction must be unsigned before wallet signing');
  const walletKey = requireSignerKey(port.getPublicKey());
  if (walletKey.toBase58() !== evidence.sourceAuthority)
    throw new Error('Connected wallet does not match the source authority');

  const unsignedBytes = build.transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  const signerInput = Transaction.from(unsignedBytes);
  if (!hasCapturedSolanaLockMessage(build, signerInput))
    throw new Error('Unsigned lock message changed before wallet signing');
  const walletResponse = await port.signTransaction(signerInput);
  if (!requireSignerKey(port.getPublicKey()).equals(walletKey))
    throw new Error('Connected wallet changed during signing');
  if (!(walletResponse instanceof Transaction))
    throw new Error('Wallet returned an invalid transaction');
  // A wallet can override its object's methods; only decoded wire bytes are trusted.
  const walletBytes = walletResponse.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  if (!(walletBytes instanceof Uint8Array) || walletBytes.length > 1232)
    throw new Error('Wallet returned invalid transaction bytes');
  const signed = Transaction.from(Uint8Array.from(walletBytes));
  if (!hasCapturedSolanaLockMessage(build, signed))
    throw new Error('Wallet changed the lock message while signing');
  const message = signed.compileMessage();
  const requiredSigners = message.accountKeys.slice(0, message.header.numRequiredSignatures);
  if (
    requiredSigners.length !== 1 ||
    !requiredSigners[0].equals(walletKey) ||
    signed.signatures.length !== 1 ||
    !signed.signatures[0].signature ||
    !signed.verifySignatures()
  )
    throw new Error('Wallet did not authorize the exact lock message');
  return signed;
};
