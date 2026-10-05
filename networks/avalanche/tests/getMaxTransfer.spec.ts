import { FeeData } from 'ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenMap } from '@rosen-bridge/tokens';

import { getMaxTransferCreator, MINIMUM_NATIVE_LOCK_GAS_RESERVE } from '../src/getMaxTransfer';
import type { AvalancheProvider } from '../src/utils';
import { createProviderMock } from './mocked/provider.mock';
import { maxTransferInput as input } from './testData';
import { createMap } from './testUtils';

describe('getMaxTransferCreator', () => {
  let provider: AvalancheProvider;
  let tokenMap: TokenMap;
  beforeEach(async () => {
    provider = createProviderMock();
    tokenMap = await createMap(16);
    vi.spyOn(tokenMap, 'wrapAmount');
    vi.spyOn(tokenMap, 'unwrapAmount');
  });

  /**
   * @target getMaxTransferCreator should reject an actual token-map update during fee reads
   * @dependencies real TokenMap; synthetic provider fee observation
   * @scenario update only the Ergo decimal scale during getFeeData
   * @expected no maximum is returned under a changed wrapping policy
   */
  it('should reject an actual token-map update during fee reads', async () => {
    const map = new TokenMap();
    await map.updateConfigByJson([
      {
        avalanche: {
          tokenId: 'avax',
          name: 'AVAX',
          decimals: 18,
          type: 'native',
          residency: 'native',
          extra: {},
        },
        ergo: {
          tokenId: '55'.repeat(32),
          name: 'AVAX',
          decimals: 8,
          type: 'token',
          residency: 'wrapped',
          extra: {},
        },
      },
    ]);
    vi.mocked(provider.getFeeData).mockImplementation(async () => {
      const config = map.getRawConfig();
      config[0].ergo.decimals = 9;
      await map.updateConfigByJson(config);
      return new FeeData(5n, 10n, 1n);
    });
    const maximum = getMaxTransferCreator(async () => map, {
      chainId: 43113,
      provider,
      gasReserveLimit: MINIMUM_NATIVE_LOCK_GAS_RESERVE,
    });
    await expect(maximum(input)).rejects.toThrow('token map changed');
  });

  /**
   * @target getMaxTransferCreator should round up real AVAX-to-Ergo decimal conversion
   * @dependencies real TokenMap; mocked provider fee observations
   * @scenario register 18-decimal AVAX and its synthetic 8-decimal Ergo representation
   * @expected a fractional one-wrapped-unit fee reserves one unit rather than zero
   */
  it('should round up real AVAX-to-Ergo decimal conversion', async () => {
    const realMap = new TokenMap();
    await realMap.updateConfigByJson([
      {
        avalanche: {
          tokenId: 'avax',
          name: 'AVAX',
          decimals: 18,
          type: 'native',
          residency: 'native',
          extra: {},
        },
        ergo: {
          tokenId: '55'.repeat(32),
          name: 'AVAX',
          decimals: 8,
          type: 'token',
          residency: 'wrapped',
          extra: {},
        },
      },
    ]);
    const maximum = getMaxTransferCreator(async () => realMap, {
      chainId: 43113,
      provider,
      gasReserveLimit: MINIMUM_NATIVE_LOCK_GAS_RESERVE,
    });
    expect(await maximum({ ...input, balance: 5n })).toEqual(4n);
  });

  /**
   * @target getMaxTransferCreator should reject a malformed fee conversion
   * @dependencies real TokenMap with an isolated invalid unwrap result
   * @scenario the unwrapped reserve remains zero even after rounding up
   * @expected insufficient fee coverage rejects
   */
  it('should reject a malformed fee conversion', async () => {
    vi.mocked(tokenMap.unwrapAmount).mockReturnValue({ amount: 0n, decimals: 18 });
    const maximum = getMaxTransferCreator(async () => tokenMap, {
      chainId: 43113,
      provider,
      gasReserveLimit: MINIMUM_NATIVE_LOCK_GAS_RESERVE,
    });
    await expect(async () => await maximum(input)).rejects.toThrow(Error);
  });

  /**
   * @target getMaxTransferCreator should reserve and round up the full metadata gas budget
   * @dependencies mocked provider API replies; real TokenMap conversions with delegating spies
   * @scenario select a 25,369 gas budget and a ten-unit fee cap with 100-unit wrapping
   * @expected 2,537 wrapped units are reserved and 7,463 remain
   */
  it('should reserve and round up the full metadata gas budget', async () => {
    const maximum = getMaxTransferCreator(async () => tokenMap, {
      chainId: 43113,
      provider,
      gasReserveLimit: 25369n,
    });
    expect(await maximum(input)).toEqual(7463n);
    expect(tokenMap.wrapAmount).toHaveBeenCalledWith('avax', 253690n, 'avalanche');
    expect(provider.getNetwork).toHaveBeenCalledTimes(2);
  });

  /**
   * @target getMaxTransferCreator should clamp insufficient balance to zero
   * @dependencies mocked provider API replies; real TokenMap conversions
   * @scenario request a maximum from one wrapped unit
   * @expected maximum is zero
   */
  it('should clamp insufficient balance to zero', async () => {
    const maximum = getMaxTransferCreator(async () => tokenMap, {
      chainId: 43113,
      provider,
      gasReserveLimit: MINIMUM_NATIVE_LOCK_GAS_RESERVE,
    });
    expect(await maximum({ ...input, balance: 1n })).toEqual(0n);
  });

  /**
   * @target getMaxTransferCreator should reject an insufficient reserve
   * @dependencies none
   * @scenario reduce the metadata reserve by one gas unit
   * @expected configuration throws before provider access
   */
  it('should reject an insufficient reserve', () => {
    expect(() =>
      getMaxTransferCreator(async () => tokenMap, {
        chainId: 43113,
        provider,
        gasReserveLimit: MINIMUM_NATIVE_LOCK_GAS_RESERVE - 1n,
      }),
    ).toThrow(Error);
    expect(provider.getNetwork).not.toHaveBeenCalled();
  });

  /**
   * @target getMaxTransferCreator should reject a mismatched provider before fees
   * @dependencies mocked provider identity
   * @scenario replace only the observed chain with Ethereum
   * @expected rejection without fetching fee data
   */
  it('should reject a mismatched provider before fees', async () => {
    vi.mocked(provider.getNetwork).mockResolvedValue({ chainId: 1n });
    const maximum = getMaxTransferCreator(async () => tokenMap, {
      chainId: 43113,
      provider,
      gasReserveLimit: MINIMUM_NATIVE_LOCK_GAS_RESERVE,
    });
    await expect(async () => await maximum(input)).rejects.toThrow(Error);
    expect(provider.getFeeData).not.toHaveBeenCalled();
  });

  /**
   * @target getMaxTransferCreator should reject chain movement while reading fees
   * @dependencies mocked provider identity and fee data
   * @scenario report Fuji before and mainnet after the fee read
   * @expected rejection after reading the synthetic fee data
   */
  it('should reject chain movement while reading fees', async () => {
    vi.mocked(provider.getNetwork)
      .mockResolvedValueOnce({ chainId: 43113n })
      .mockResolvedValueOnce({ chainId: 43114n });
    const maximum = getMaxTransferCreator(async () => tokenMap, {
      chainId: 43113,
      provider,
      gasReserveLimit: MINIMUM_NATIVE_LOCK_GAS_RESERVE,
    });
    await expect(async () => await maximum(input)).rejects.toThrow(Error);
    expect(provider.getFeeData).toHaveBeenCalledTimes(1);
  });

  /**
   * @target getMaxTransferCreator should reject invalid %s
   * @dependencies mocked provider fee data
   * @scenario independently remove prices, negate a price or exceed the priority cap
   * @expected every isolated fee fixture rejects
   */
  it.each([
    ['missing prices', new FeeData(null, null, null)],
    ['negative cap', new FeeData(5n, -1n, 0n)],
    ['negative priority', new FeeData(5n, 10n, -1n)],
    ['excess priority', new FeeData(5n, 10n, 11n)],
  ])('should reject invalid %s', async (_name, feeData) => {
    vi.mocked(provider.getFeeData).mockResolvedValue(feeData);
    const maximum = getMaxTransferCreator(async () => tokenMap, {
      chainId: 43113,
      provider,
      gasReserveLimit: MINIMUM_NATIVE_LOCK_GAS_RESERVE,
    });
    await expect(async () => await maximum(input)).rejects.toThrow(Error);
  });

  /**
   * @target getMaxTransferCreator should reject a non-native asset
   * @dependencies mocked provider
   * @scenario change only the native-asset marker
   * @expected rejection before any provider access
   */
  it('should reject a non-native asset', async () => {
    const maximum = getMaxTransferCreator(async () => tokenMap, {
      chainId: 43113,
      provider,
      gasReserveLimit: MINIMUM_NATIVE_LOCK_GAS_RESERVE,
    });
    await expect(async () => await maximum({ ...input, isNative: false })).rejects.toThrow(Error);
    expect(provider.getNetwork).not.toHaveBeenCalled();
  });

  /**
   * @target getMaxTransferCreator should fall back to a positive legacy gas price
   * @dependencies mocked provider API replies; real TokenMap
   * @scenario omit the fee cap while retaining a five-unit legacy price
   * @expected the budget uses the legacy price and rounds its wrapped reserve up
   */
  it('should fall back to a positive legacy gas price', async () => {
    vi.mocked(provider.getFeeData).mockResolvedValue(new FeeData(5n, null, null));
    const maximum = getMaxTransferCreator(async () => tokenMap, {
      chainId: 43113,
      provider,
      gasReserveLimit: MINIMUM_NATIVE_LOCK_GAS_RESERVE,
    });
    expect(await maximum(input)).toEqual(8731n);
  });
});
