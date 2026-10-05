import type { Keypair } from '@solana/web3.js';
import { vi } from 'vitest';

import type { SolanaWalletConnectionEvent } from '../../src/eventBoundWalletPort';
import { mockInjectedSolanaProvider } from './injectedWalletPort.mock';

/** Models removable wallet events beside the synthetic sign-only provider. */
export const mockEventSolanaProvider = (signer: Keypair) => {
  const listeners = new Map<SolanaWalletConnectionEvent, Set<() => void>>();
  const provider = {
    ...mockInjectedSolanaProvider(signer),
    on: vi.fn((event: SolanaWalletConnectionEvent, listener: () => void) => {
      const group = listeners.get(event) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(event, group);
    }),
    off: vi.fn((event: SolanaWalletConnectionEvent, listener: () => void) => {
      listeners.get(event)?.delete(listener);
    }),
  };
  // The copied provider owns state used by these two documented mocked methods.
  provider.connect.mockImplementation(async () => {
    provider.isConnected = true;
    return { publicKey: provider.publicKey };
  });
  provider.disconnect.mockImplementation(async () => {
    provider.isConnected = false;
  });
  /** Delivers a synchronous event without automatically mutating wallet state. */
  const emit = (event: SolanaWalletConnectionEvent) => {
    for (const listener of Array.from(listeners.get(event) ?? [])) listener();
  };
  /** Counts live owned handlers for lifecycle and setup-failure checks. */
  const listenerCount = () =>
    Array.from(listeners.values()).reduce((count, group) => count + group.size, 0);
  return { provider, emit, listenerCount };
};
