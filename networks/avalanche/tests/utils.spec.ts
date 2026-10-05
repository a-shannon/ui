import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenMap } from '@rosen-bridge/tokens';

import {
  type AvalancheProvider,
  assertProviderIdentity,
  calculateFeeCreatorForAvalanche,
  getHeightCreator,
  getMinTransferCreator,
} from '../src/utils';
import { createProviderMock } from './mocked/provider.mock';
import { avax } from './testData';

let provider: AvalancheProvider;

beforeEach(() => {
  provider = createProviderMock();
});

describe('assertProviderIdentity', () => {
  /**
   * @target assertProviderIdentity should accept only the selected provider chain
   * @dependencies mocked provider network read
   * @scenario check matching Fuji and then a mismatched mainnet selection
   * @expected the first resolves and the second rejects
   */
  it('should accept only the selected provider chain', async () => {
    await expect(assertProviderIdentity(provider, 43113)).resolves.toEqual(undefined);
    await expect(async () => await assertProviderIdentity(provider, 43114)).rejects.toThrow(Error);
  });
});

describe('getHeightCreator', () => {
  /**
   * @target getHeightCreator should qualify a synthetic provider height
   * @dependencies mocked provider network and height reads
   * @scenario read a safe height while the provider remains on Fuji
   * @expected exact height and two network observations
   */
  it('should qualify a synthetic provider height', async () => {
    expect(await getHeightCreator(provider, 43113)()).toEqual(100);
    expect(provider.getNetwork).toHaveBeenCalledTimes(2);
  });

  /**
   * @target getHeightCreator should reject chain movement during its height read
   * @dependencies mocked provider network and height reads
   * @scenario return Fuji before the height and mainnet afterward
   * @expected the height is not exposed
   */
  it('should reject chain movement during its height read', async () => {
    vi.mocked(provider.getNetwork)
      .mockResolvedValueOnce({ chainId: 43113n })
      .mockResolvedValueOnce({ chainId: 43114n });
    await expect(async () => await getHeightCreator(provider, 43113)()).rejects.toThrow(Error);
  });

  /**
   * @target getHeightCreator should reject invalid height %s
   * @dependencies mocked provider height read
   * @scenario replace only the height with a negative, fractional or unsafe value
   * @expected every isolated height fixture rejects
   */
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    'should reject invalid height %s',
    async (height) => {
      vi.mocked(provider.getBlockNumber).mockResolvedValue(height);
      await expect(async () => await getHeightCreator(provider, 43113)()).rejects.toThrow(Error);
    },
  );
});

describe('calculateFeeCreatorForAvalanche', () => {
  /**
   * @target calculateFeeCreatorForAvalanche should reject a wrong chain before fee lookup
   * @dependencies shared Rosen fee reader; mocked provider network read
   * @scenario configure a mismatched provider so no Explorer request is reachable
   * @expected rejection before any height or fee API call
   */
  it('should reject a wrong chain before fee lookup', async () => {
    vi.mocked(provider.getNetwork).mockResolvedValue({ chainId: 1n });
    const calculateFee = calculateFeeCreatorForAvalanche(provider, 43113);
    await expect(async () => await calculateFee('ergo', 'token', 0, 'nft')).rejects.toThrow(Error);
    expect(provider.getBlockNumber).not.toHaveBeenCalled();
  });
});

describe('getMinTransferCreator', () => {
  /**
   * @target getMinTransferCreator should reject actual token-map movement during minimum-fee
   * lookup
   * @dependencies real TokenMap and synthetic Rosen fee action
   * @scenario update only the Ergo counterpart decimals while fee evidence is awaited
   * @expected a minimum from the changed map is not exposed
   */
  it('should reject actual token-map movement during minimum-fee lookup', async () => {
    const map = new TokenMap();
    await map.updateConfigByJson([
      {
        avalanche: avax,
        ergo: {
          ...avax,
          tokenId: '55'.repeat(32),
          decimals: 8,
          type: 'token',
          residency: 'wrapped',
        },
      },
    ]);
    const calculateFee = vi.fn(async () => {
      const config = map.getRawConfig();
      config[0].ergo.decimals = 9;
      await map.updateConfigByJson(config);
      return {
        fees: {
          bridgeFee: 2n,
          networkFee: 3n,
          rsnRatio: 0n,
          rsnRatioDivisor: 1n,
          feeRatio: 0n,
          feeRatioDivisor: 1n,
        },
        nextFees: {
          bridgeFee: 2n,
          networkFee: 3n,
          rsnRatio: 0n,
          rsnRatioDivisor: 1n,
          feeRatio: 0n,
          feeRatioDivisor: 1n,
        },
      };
    });
    await expect(
      getMinTransferCreator(calculateFee)(async () => map)(avax, 'ergo', 'nft'),
    ).rejects.toThrow('token map changed');
  });
  /**
   * @target getMinTransferCreator should retain the shared fee calculation for native AVAX
   * @dependencies real TokenMap search; mocked Rosen fee action API
   * @scenario map AVAX to an Ergo token and return bridge/network fees of two and three
   * @expected the minimum is six wrapped units, including the transfer margin
   */
  it('should retain the shared fee calculation for native AVAX', async () => {
    const tokenMap = new TokenMap();
    await tokenMap.updateConfigByJson([
      {
        avalanche: avax,
        ergo: {
          ...avax,
          tokenId: '55'.repeat(32),
          decimals: 8,
          type: 'token',
          residency: 'wrapped',
        },
      },
    ]);
    const calculateFee = vi.fn().mockResolvedValue({ fees: { bridgeFee: 2n, networkFee: 3n } });
    const minimum = getMinTransferCreator(calculateFee)(async () => tokenMap);
    expect(await minimum(avax, 'ergo', 'nft')).toEqual(6n);
    expect(calculateFee).toHaveBeenCalledWith('ergo', '55'.repeat(32), 0, 'nft');
  });

  /**
   * @target getMinTransferCreator should reject unavailable fee evidence
   * @dependencies real TokenMap search; failing Rosen fee action API
   * @scenario the shared minimum helper catches the fee failure and returns zero
   * @expected the Avalanche wrapper rejects the zero minimum
   */
  it('should reject unavailable fee evidence', async () => {
    const tokenMap = new TokenMap();
    await tokenMap.updateConfigByJson([
      {
        avalanche: avax,
        ergo: {
          ...avax,
          tokenId: '55'.repeat(32),
          decimals: 8,
          type: 'token',
          residency: 'wrapped',
        },
      },
    ]);
    const minimum = getMinTransferCreator(vi.fn().mockRejectedValue(new Error('unavailable')))(
      async () => tokenMap,
    );
    await expect(async () => await minimum(avax, 'ergo', 'nft')).rejects.toThrow(Error);
  });

  /**
   * @target getMinTransferCreator should reject token decimals before fee lookup
   * @dependencies mocked token map getter and fee action
   * @scenario change only native AVAX decimals to nine
   * @expected rejection without fetching the token map
   */
  it('should reject token decimals before fee lookup', async () => {
    const getTokenMap = vi.fn();
    const minimum = getMinTransferCreator(vi.fn())(getTokenMap);
    await expect(
      async () => await minimum({ ...avax, decimals: 9 }, 'ergo', 'nft'),
    ).rejects.toThrow(Error);
    expect(getTokenMap).not.toHaveBeenCalled();
  });
});
