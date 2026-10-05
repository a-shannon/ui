import { vi } from 'vitest';

import type { SolanaLockFeeProducers } from '../../src/feeQuote';

export {
  invalidateMockReadPortSession as invalidateFeeQuoteSession,
  mockIsCurrentReadPortSession as mockIsCurrentFeeQuoteSession,
  mockReadPortSession as mockFeeQuoteSession,
} from './readPort.mock';

/** Wraps all six independently injected service functions with observable unit mocks. */
export const mockFeeQuoteProducers = (producers: SolanaLockFeeProducers) => ({
  readBalance: vi.fn(producers.readBalance),
  readLatestBlockhash: vi.fn(producers.readLatestBlockhash),
  readFeePayer: vi.fn(producers.readFeePayer),
  readRentMinimum: vi.fn(producers.readRentMinimum),
  readMessageFee: vi.fn(producers.readMessageFee),
  readBlockHeight: vi.fn(producers.readBlockHeight),
});
