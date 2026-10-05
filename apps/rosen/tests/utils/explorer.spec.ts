import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createExplorerDeployment } from './testUtils';

const deployment = vi.hoisted(() => ({ raw: undefined as string | undefined }));
vi.mock('@/env', () => ({
  env: {
    get NEXT_PUBLIC_AVALANCHE_CONFIG() {
      return deployment.raw;
    },
  },
}));
vi.mock('../../configs', () => ({ LOCK_ADDRESSES: { avalanche: `0x${'11'.repeat(20)}` } }));

beforeEach(() => vi.resetModules());

describe('getTxURL', () => {
  /**
   * @target getTxURL should use application deployment %s
   * @dependencies real configuration parser and core explorer utility; environment values supplied
   * @scenario select Fuji, mainnet or disable Avalanche
   * @expected exact selected transaction link or no link
   */
  it.each([
    [43113, 'https://testnet.snowtrace.io/tx/tx'],
    [43114, 'https://snowtrace.io/tx/tx'],
    [undefined, undefined],
  ] as const)('should use application deployment %s', async (chainId, expected) => {
    deployment.raw = createExplorerDeployment(chainId);
    const { getTxURL } = await import('../../src/utils/explorer');
    expect(getTxURL('avalanche', 'tx')).toEqual(expected);
  });
});

describe('getAddressUrl', () => {
  /**
   * @target getAddressUrl should use application deployment %s
   * @dependencies real configuration parser and core explorer utility; environment values supplied
   * @scenario select Fuji, mainnet or disable Avalanche
   * @expected exact selected address link or no link
   */
  it.each([
    [43113, 'https://testnet.snowtrace.io/address/address'],
    [43114, 'https://snowtrace.io/address/address'],
    [undefined, undefined],
  ] as const)('should use application deployment %s', async (chainId, expected) => {
    deployment.raw = createExplorerDeployment(chainId);
    const { getAddressUrl } = await import('../../src/utils/explorer');
    expect(getAddressUrl('avalanche', 'address')).toEqual(expected);
  });
});
