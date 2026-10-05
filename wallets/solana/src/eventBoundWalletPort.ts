import type { Transaction } from '@solana/web3.js';

import type { SolanaWalletSession } from '@rosen-network/solana';

import {
  createLegacySolanaWalletPort,
  type LegacySolanaInjectedProvider,
  type LegacySolanaWalletPort,
} from './injectedWalletPort';

export type SolanaWalletConnectionEvent = 'accountChanged' | 'disconnect';

/** Event-capable legacy API with removable connection handlers. */
export interface LegacySolanaEventProvider extends LegacySolanaInjectedProvider {
  readonly on: (event: SolanaWalletConnectionEvent, listener: () => void) => unknown;
  readonly off: (event: SolanaWalletConnectionEvent, listener: () => void) => unknown;
}

export interface EventBoundSolanaWalletPort extends LegacySolanaWalletPort {
  readonly captureSession: () => SolanaWalletSession;
  readonly dispose: () => void;
}

/** Opaque local session identity; copies do not retain its provenance. */
export type { SolanaWalletSession } from '@rosen-network/solana';

const capturedSessions = new WeakMap<SolanaWalletSession, () => boolean>();

/** Checks captured provenance and current connection without granting new authority. */
export const isCurrentSolanaWalletSession = (value: unknown): value is SolanaWalletSession => {
  if (typeof value !== 'object' || value === null) return false;
  const check = capturedSessions.get(value as SolanaWalletSession);
  if (!check) return false;
  try {
    return check();
  } catch {
    return false;
  }
};

interface Registration {
  readonly provider: LegacySolanaEventProvider;
  readonly port: LegacySolanaWalletPort;
  readonly invalidate: () => void;
}

/**
 * Observes emitted account/disconnect events around the snapshot signer port.
 * Every event invalidates the session and pending operations, even if the same
 * account returns before signing completes. Reconnection is explicit; events
 * never request a provider connection, disconnection or transaction submission.
 * Disposal retires this adapter and removes only its own handlers.
 */
export const createEventBoundSolanaWalletPort = (
  getProvider: () => unknown,
): EventBoundSolanaWalletPort => {
  let registration: Registration | undefined;
  let epoch = 0;
  let connectedEpoch: number | undefined;
  let connectedPublicKey: string | undefined;
  let disposed = false;

  /** Requires event removal as well as the existing sign-only capability. */
  const availableProvider = (): LegacySolanaEventProvider | undefined => {
    try {
      const candidate = getProvider();
      if (typeof candidate !== 'object' || candidate === null) return undefined;
      const api = candidate as Partial<LegacySolanaEventProvider>;
      if (typeof api.on !== 'function' || typeof api.off !== 'function') return undefined;
      if (!createLegacySolanaWalletPort(() => candidate).isAvailable()) return undefined;
      return candidate as LegacySolanaEventProvider;
    } catch {
      return undefined;
    }
  };

  /** Removes both owned callbacks, attempting each even if removal fails. */
  const detach = (bound: Registration): void => {
    const failures: unknown[] = [];
    for (const event of ['accountChanged', 'disconnect'] as const) {
      try {
        bound.provider.off(event, bound.invalidate);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Wallet event cleanup failed');
  };

  /** Clears local authority before invoking any external cleanup method. */
  const retire = (): Registration | undefined => {
    const previous = registration;
    registration = undefined;
    connectedEpoch = undefined;
    connectedPublicKey = undefined;
    epoch += 1;
    return previous;
  };

  /** Reads only the current session established after all event subscriptions. */
  const getPublicKey = (): string | null => {
    const bound = registration;
    const requestEpoch = epoch;
    if (disposed || connectedEpoch !== requestEpoch || !bound) return null;
    let key: string | null;
    try {
      key = bound.port.getPublicKey();
    } catch (error) {
      bound.invalidate();
      throw error;
    }
    if (
      disposed ||
      registration !== bound ||
      epoch !== requestEpoch ||
      connectedEpoch !== requestEpoch
    )
      return null;
    if (key === null || key !== connectedPublicKey) {
      bound.invalidate();
      return null;
    }
    return key;
  };

  /** Captures a revocable session around all external account reads. */
  const captureSession = (): SolanaWalletSession => {
    const bound = registration;
    const requestEpoch = epoch;
    const publicKey = getPublicKey();
    if (!bound || publicKey === null || registration !== bound || requestEpoch !== epoch)
      throw new Error('Wallet is disconnected');
    const session = Object.freeze({ publicKey });
    capturedSessions.set(session, () => {
      if (disposed || registration !== bound || requestEpoch !== epoch) return false;
      const key = getPublicKey();
      return (
        key === publicKey &&
        !disposed &&
        registration === bound &&
        requestEpoch === epoch &&
        connectedEpoch === requestEpoch
      );
    });
    return session;
  };

  /** Attaches handlers before connecting and refuses every intervening event. */
  const connect = async (): Promise<string> => {
    if (disposed) throw new Error('Wallet adapter is disposed');
    const previous = retire();
    if (previous) detach(previous);
    const provider = availableProvider();
    if (!provider) throw new Error('Event-capable Solana wallet API is unavailable');
    const requestEpoch = epoch;
    const bound: Registration = {
      provider,
      port: createLegacySolanaWalletPort(() =>
        availableProvider() === provider ? provider : undefined,
      ),
      invalidate: () => {
        if (registration !== bound) return;
        connectedEpoch = undefined;
        connectedPublicKey = undefined;
        epoch += 1;
      },
    };
    registration = bound;
    try {
      provider.on('accountChanged', bound.invalidate);
      provider.on('disconnect', bound.invalidate);
      if (epoch !== requestEpoch || registration !== bound)
        throw new Error('Wallet connection changed during connection');
      const key = await bound.port.connect();
      if (disposed || epoch !== requestEpoch || registration !== bound)
        throw new Error('Wallet connection changed during connection');
      connectedEpoch = requestEpoch;
      connectedPublicKey = key;
      return key;
    } catch (error) {
      if (registration === bound) {
        retire();
        try {
          detach(bound);
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'Wallet connection cleanup failed');
        }
      }
      throw error;
    }
  };

  /** Invalidates local work and removes handlers before provider disconnection. */
  const disconnect = async (): Promise<void> => {
    if (disposed) throw new Error('Wallet adapter is disposed');
    const previous = retire();
    const requestEpoch = epoch;
    if (!previous) throw new Error('Wallet is disconnected');
    detach(previous);
    await previous.port.disconnect();
    if (disposed || epoch !== requestEpoch || registration !== undefined)
      throw new Error('Wallet connection changed during disconnection');
  };

  /** Requires a continuous observed session through the entire signing await. */
  const signTransaction = async (transaction: Transaction): Promise<Transaction> => {
    const bound = registration;
    const key = getPublicKey();
    if (!bound || key === null) throw new Error('Wallet is disconnected');
    const requestEpoch = epoch;
    const signed = await bound.port.signTransaction(transaction);
    if (disposed || registration !== bound || epoch !== requestEpoch || getPublicKey() !== key)
      throw new Error('Wallet connection changed during signing');
    return signed;
  };

  /** Permanently retires local authority before removing any external handler. */
  const dispose = (): void => {
    disposed = true;
    const previous = retire();
    if (previous) detach(previous);
  };

  return Object.freeze({
    isAvailable: () => !disposed && availableProvider() !== undefined,
    getPublicKey,
    captureSession,
    connect,
    disconnect,
    signTransaction,
    dispose,
  });
};
