import { Keypair } from '@solana/web3.js';
import { Address, NetworkPrefix } from 'ergo-lib-wasm-nodejs';

import {
  captureSolanaLockProfile,
  type SolanaLockAssetPolicy,
  type SolanaLockProfile,
} from '@rosen-network/solana';

import { ergoDestination } from './testData';

export { ergoDestination } from './testData';

/** Generates a reproducible local keypair; these seeds never hold live funds. */
export const keypair = (seed: number): Keypair =>
  Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => seed + index));

/** Captures a synthetic cluster/vault and the explicitly supplied asset policy. */
export const captureTestProfile = (
  assets: Record<string, SolanaLockAssetPolicy>,
  destinationNetwork: 'mainnet' | 'testnet' = 'mainnet',
): SolanaLockProfile =>
  captureSolanaLockProfile({
    clusterGenesisHash: keypair(7).publicKey.toBase58(),
    destinationNetwork,
    vaultOwner: keypair(41).publicKey.toBase58(),
    memoVersion: 1,
    assets,
  });

/** Re-encodes the same fixture proposition with the selected network prefix. */
export const testErgoAddressForNetwork = (network: 'mainnet' | 'testnet'): string => {
  const parsed = Address.from_base58(ergoDestination);
  try {
    return parsed.to_base58(network === 'mainnet' ? NetworkPrefix.Mainnet : NetworkPrefix.Testnet);
  } finally {
    parsed.free();
  }
};

/** Supplies a native-only fixture policy with exact fees and transfer bounds. */
export const nativeProfile = (): SolanaLockProfile =>
  captureTestProfile({
    SOL: {
      kind: 'native',
      sourceDecimals: 9,
      destinationDecimals: 9,
      destinationTokenId: 'cd'.repeat(32),
      minimumGrossAmount: '1000',
      maximumGrossAmount: '10000000',
      networkFee: '100',
      bridgeFee: '200',
    },
  });

/** Supplies one synthetic original SPL mint with an existing vault account. */
export const splProfile = (mint: string, vaultTokenAccount: string): SolanaLockProfile =>
  captureTestProfile({
    [mint]: {
      kind: 'spl',
      sourceDecimals: 6,
      destinationDecimals: 6,
      destinationTokenId: 'ab'.repeat(32),
      minimumGrossAmount: '1000',
      maximumGrossAmount: '10000000',
      networkFee: '100',
      bridgeFee: '200',
      vaultTokenAccount,
    },
  });
