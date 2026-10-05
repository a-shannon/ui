import { vi } from 'vitest';

import type { mockEventSolanaProvider } from './eventBoundWalletPort.mock';

/** Emits an actual connection event during the next synchronous account read. */
export const emitDuringNextWalletKeyRead = (
  fixture: ReturnType<typeof mockEventSolanaProvider>,
) => {
  const key = fixture.provider.publicKey;
  const text = key.toBase58();
  return vi.spyOn(key, 'toBase58').mockImplementationOnce(() => {
    fixture.emit('accountChanged');
    return text;
  });
};

/** Throws the exact external error during one account read, then restores decoding. */
export const throwDuringNextWalletKeyRead = (
  fixture: ReturnType<typeof mockEventSolanaProvider>,
  error: Error,
) =>
  vi.spyOn(fixture.provider.publicKey, 'toBase58').mockImplementationOnce(() => {
    throw error;
  });
