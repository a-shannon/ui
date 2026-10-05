import { FeeData } from 'ethers';
import { vi } from 'vitest';

import type { AvalancheProvider } from '../../src/utils';

/** Mock only provider API reads with the original Fuji height and fee replies. */
export const createProviderMock = (): AvalancheProvider => ({
  getNetwork: vi.fn().mockResolvedValue({ chainId: 43113n }),
  getBlockNumber: vi.fn().mockResolvedValue(100),
  getFeeData: vi.fn().mockResolvedValue(new FeeData(5n, 10n, 1n)),
});
