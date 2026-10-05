import { PublicKey } from '@solana/web3.js';

import { SOLANA_SPL_PROGRAM_ID } from '@rosen-network/solana';

import type { SolanaWalletReadResult } from '../src/readPort';
import { readPortTestData } from './readPortTestData';
import { keypair, splProfile } from './testUtils';

/** Generates one independent producer response with exact bigint amounts. */
export const createReadPortResult = (
  owner = keypair(1).publicKey.toBase58(),
): SolanaWalletReadResult => ({
  address: owner,
  clusterGenesisHash: keypair(7).publicKey.toBase58(),
  commitment: 'finalized',
  nativeContextSlot: readPortTestData.contextSlot,
  tokenContextSlot: readPortTestData.contextSlot,
  nativeBalance: readPortTestData.nativeBalance,
  tokenAccounts: [
    {
      address: keypair(6).publicKey.toBase58(),
      mint: keypair(4).publicKey.toBase58(),
      programId: SOLANA_SPL_PROGRAM_ID,
      owner,
      amount: readPortTestData.tokenAmount,
      decimals: 6,
      state: 'initialized',
    },
  ],
});

/** Captures the companion mint and existing vault account policy. */
export const createReadPortProfile = () =>
  splProfile(keypair(4).publicKey.toBase58(), keypair(5).publicKey.toBase58());

/** Generates distinct public account addresses for the exact inventory-size boundary. */
export const createReadPortInventory = (count: number) => {
  const account = createReadPortResult().tokenAccounts[0];
  return Array.from({ length: count }, (_, index) => {
    const bytes = new Uint8Array(32);
    new DataView(bytes.buffer).setUint32(0, index + 1);
    return { ...account, address: new PublicKey(bytes).toBase58() };
  });
};

/** Exposes a deterministic deferred service response for lifecycle races. */
export const deferredReadPortResult = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};
