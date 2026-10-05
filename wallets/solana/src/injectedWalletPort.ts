import { PublicKey, type Transaction } from '@solana/web3.js';

import type { SolanaSignerPort } from './signerPort';

/** Legacy injected-provider capability; it does not submit transactions. */
export interface LegacySolanaInjectedProvider {
  readonly publicKey: { readonly toBase58: () => string } | null;
  readonly isConnected: boolean;
  readonly connect: () => Promise<{ readonly publicKey: { readonly toBase58: () => string } }>;
  readonly disconnect: () => Promise<void>;
  readonly signTransaction: (transaction: Transaction) => Promise<Transaction>;
}

export interface LegacySolanaWalletPort extends SolanaSignerPort {
  readonly isAvailable: () => boolean;
  readonly connect: () => Promise<string>;
  readonly disconnect: () => Promise<void>;
}

/** Checks the current injected API without invoking connection or signing. */
const isLegacyProvider = (value: unknown): value is LegacySolanaInjectedProvider => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<LegacySolanaInjectedProvider>;
  return (
    typeof candidate.isConnected === 'boolean' &&
    typeof candidate.connect === 'function' &&
    typeof candidate.disconnect === 'function' &&
    typeof candidate.signTransaction === 'function'
  );
};

/** Parses the canonical public key reported by an injected provider. */
const providerKey = (value: unknown): string => {
  if (typeof value !== 'object' || value === null)
    throw new Error('Wallet returned an invalid public key');
  const candidate = value as { readonly toBase58?: () => unknown };
  if (typeof candidate.toBase58 !== 'function')
    throw new Error('Wallet returned an invalid public key');
  const text = candidate.toBase58();
  if (typeof text !== 'string') throw new Error('Wallet returned an invalid public key');
  try {
    if (new PublicKey(text).toBase58() !== text) throw new Error('noncanonical');
    return text;
  } catch {
    throw new Error('Wallet returned an invalid public key');
  }
};

/**
 * Adapts one explicitly connected legacy provider to the verified lock signer.
 * Checks provider/account continuity before and after signing; connection changes
 * requested through this adapter invalidate pending operations. Provider events
 * are not observed by this sign-only port.
 * The caller supplies browser provider discovery; construction is SSR-safe.
 */
export const createLegacySolanaWalletPort = (
  getProvider: () => unknown,
): LegacySolanaWalletPort => {
  let connectedProvider: LegacySolanaInjectedProvider | undefined;
  let connectionEpoch = 0;

  /** Treats an absent or inaccessible injected API as unavailable. */
  const availableProvider = (): LegacySolanaInjectedProvider | undefined => {
    try {
      const candidate = getProvider();
      return isLegacyProvider(candidate) ? candidate : undefined;
    } catch {
      return undefined;
    }
  };

  /** Requires the sign-only API instead of falling back to sign-and-send. */
  const requireProvider = (): LegacySolanaInjectedProvider => {
    const provider = availableProvider();
    if (!provider) throw new Error('Legacy Solana wallet API is unavailable');
    return provider;
  };

  /** Reads an account only from the provider connected through this adapter. */
  const getPublicKey = (): string | null => {
    const provider = connectedProvider;
    if (!provider || availableProvider() !== provider || !provider.isConnected) return null;
    return providerKey(provider.publicKey);
  };

  /** Connects and captures the exact provider and returned account. */
  const connect = async (): Promise<string> => {
    const provider = requireProvider();
    const epoch = ++connectionEpoch;
    connectedProvider = undefined;
    const response = await provider.connect();
    if (epoch !== connectionEpoch || availableProvider() !== provider || !provider.isConnected)
      throw new Error('Wallet connection changed during connection');
    const key = providerKey(provider.publicKey);
    if (providerKey(response?.publicKey) !== key)
      throw new Error('Wallet connection returned a different account');
    connectedProvider = provider;
    return key;
  };

  /** Invalidates pending work before requesting provider disconnection. */
  const disconnect = async (): Promise<void> => {
    const epoch = ++connectionEpoch;
    connectedProvider = undefined;
    const provider = requireProvider();
    await provider.disconnect();
    if (epoch !== connectionEpoch || availableProvider() !== provider || provider.isConnected)
      throw new Error('Wallet connection changed during disconnection');
  };

  /** Signs through the captured provider and checks its account after awaiting. */
  const signTransaction = async (transaction: Transaction): Promise<Transaction> => {
    const provider = connectedProvider;
    const key = getPublicKey();
    if (!provider || key === null) throw new Error('Wallet is disconnected');
    const epoch = connectionEpoch;
    const response = await provider.signTransaction(transaction);
    if (
      epoch !== connectionEpoch ||
      connectedProvider !== provider ||
      availableProvider() !== provider ||
      getPublicKey() !== key
    )
      throw new Error('Wallet connection changed during signing');
    return response;
  };

  return Object.freeze({
    isAvailable: () => availableProvider() !== undefined,
    getPublicKey,
    connect,
    disconnect,
    signTransaction,
  });
};
