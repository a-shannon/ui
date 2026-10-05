import { vi } from 'vitest';

import type { SolanaWalletSession } from '../../src/eventBoundWalletPort';
import type { SolanaWalletReadProducer } from '../../src/readPort';

const sessions = new WeakSet<object>();

/** Creates a locally branded session for isolated unit tests without a provider. */
export const mockReadPortSession = (publicKey: string): SolanaWalletSession => {
  const session = Object.freeze({ publicKey });
  sessions.add(session);
  return session;
};

/** Implements the fully mocked session connector's local provenance check. */
export const mockIsCurrentReadPortSession = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && sessions.has(value);

/** Invalidates only one mocked connection generation. */
export const invalidateMockReadPortSession = (session: SolanaWalletSession): void => {
  sessions.delete(session);
};

/** Supplies a fully mocked injected read service returning the selected raw result. */
export const mockReadPortProducer = (result: unknown) =>
  vi.fn<SolanaWalletReadProducer>().mockResolvedValue(result);
