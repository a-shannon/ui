import { describe, expect, it } from 'vitest';

import { assertAvalancheLockAmount, captureAvalancheTokenPolicy } from '../src/tokenPolicy';
import { avax } from './testData';
import { createMap } from './testUtils';

describe('captureAvalancheTokenPolicy', () => {
  /**
   * @target captureAvalancheTokenPolicy should bind the actual native18 and wrapped8 conversion
   * @dependencies real TokenMap
   * @scenario convert ten wrapped units and wrap a fractional native quantity
   * @expected native result is one hundred billion and wrapping rounds up
   */
  it('should bind the actual native18 and wrapped8 conversion', async () => {
    const policy = captureAvalancheTokenPolicy(await createMap(), avax);
    expect(policy.unwrapAmount(10n)).toEqual({ amount: 100000000000n, decimals: 18 });
    expect(policy.wrapAmount(1n)).toEqual({ amount: 1n, decimals: 8 });
  });

  /**
   * @target captureAvalancheTokenPolicy should reject mapped native field %j
   * @dependencies real TokenMap
   * @scenario independently change mapped decimals, ID, type or residency
   * @expected the actual map is rejected even when the token argument remains AVAX18
   */
  it.each([{ decimals: 9 }, { tokenId: 'other' }, { type: 'token' }, { residency: 'wrapped' }])(
    'should reject mapped native field %j',
    async (change) => {
      const map = await createMap();
      const config = map.getRawConfig();
      Object.assign(config[0].avalanche, change);
      await map.updateConfigByJson(config);
      expect(() => captureAvalancheTokenPolicy(map, avax)).toThrow();
    },
  );

  /**
   * @target captureAvalancheTokenPolicy should reject ambiguous %s
   * @dependencies real TokenMap including its unbridgeable-token storage
   * @scenario add another set carrying AVAX ID or the same Ergo counterpart
   * @expected no first-match conversion can hide the conflicting set
   */
  it.each(['native ID', 'Ergo counterpart'])('should reject ambiguous %s', async (field) => {
    const map = await createMap();
    const config = map.getRawConfig();
    if (field === 'native ID') config.unshift({ ethereum: { ...avax, type: 'token' } });
    else config.push({ ergo: { ...config[0].ergo } });
    await map.updateConfigByJson(config);
    expect(() => captureAvalancheTokenPolicy(map, avax)).toThrow();
  });

  /**
   * @target assertCurrent should reject configuration drift before another conversion
   * @dependencies real TokenMap update API
   * @scenario capture native policy then replace only the Ergo decimal scale
   * @expected both the final assertion and a subsequent conversion reject
   */
  it('should reject configuration drift before another conversion', async () => {
    const map = await createMap();
    const policy = captureAvalancheTokenPolicy(map, avax);
    const config = map.getRawConfig();
    config[0].ergo.decimals = 9;
    await map.updateConfigByJson(config);
    expect(() => policy.assertCurrent()).toThrow('changed');
    expect(() => policy.unwrapAmount(10n)).toThrow('changed');
  });
});

describe('assertAvalancheLockAmount', () => {
  /**
   * @target assertAvalancheLockAmount should accept a lock strictly greater than its fees
   * @dependencies none
   * @scenario ten wrapped units cover fees two plus three
   * @expected the lock is admissible at this amount/fee boundary
   */
  it('should accept a lock strictly greater than its fees', () => {
    expect(assertAvalancheLockAmount(10n, 2n, 3n)).toEqual(undefined);
  });

  /**
   * @target assertAvalancheLockAmount should reject amount/fees %s/%s/%s
   * @dependencies none
   * @scenario independently change a field or test equality with total fees
   * @expected no negative, overflowing, unfunded or equal-fee lock is admitted
   */
  it.each([
    [5n, 2n, 3n],
    [4n, 2n, 3n],
    [0n, 0n, 0n],
    [10n, -1n, 3n],
    [10n, 2n, -1n],
    [10n, 1n << 64n, 0n],
    [10n, 0n, 1n << 64n],
  ])('should reject amount/fees %s/%s/%s', (amount, bridgeFee, networkFee) => {
    expect(() => assertAvalancheLockAmount(amount, bridgeFee, networkFee)).toThrow();
  });
});
