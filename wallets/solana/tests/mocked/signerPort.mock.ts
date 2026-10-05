import type { Keypair, Transaction } from '@solana/web3.js';
import { vi } from 'vitest';

/** Models an injected wallet with a deterministic local Ed25519 signer. */
export const mockSyntheticSigner = (sender: Keypair) => ({
  getPublicKey: vi.fn((): string | null => sender.publicKey.toBase58()),
  signTransaction: vi.fn(async (transaction: Transaction): Promise<Transaction> => {
    transaction.partialSign(sender);
    return transaction;
  }),
});
