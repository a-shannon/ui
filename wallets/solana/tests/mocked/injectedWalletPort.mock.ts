import type { Keypair, Transaction } from '@solana/web3.js';
import { vi } from 'vitest';

/** Models the documented legacy API using only a deterministic local signer. */
export const mockInjectedSolanaProvider = (signer: Keypair) => {
  const provider = {
    isConnected: false,
    publicKey: signer.publicKey,
    connect: vi.fn(async () => {
      provider.isConnected = true;
      return { publicKey: provider.publicKey };
    }),
    disconnect: vi.fn(async () => {
      provider.isConnected = false;
    }),
    signTransaction: vi.fn(async (transaction: Transaction): Promise<Transaction> => {
      transaction.partialSign(signer);
      return transaction;
    }),
  };
  return provider;
};
