import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateLockData } from '../src/utils';

const codecControl = vi.hoisted(() => ({ encoded: undefined as string | undefined }));
vi.mock('@rosen-bridge/address-codec', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rosen-bridge/address-codec')>();
  return {
    ...actual,
    encodeAddress: (chain: string, address: string) =>
      codecControl.encoded ?? actual.encodeAddress(chain, address),
  };
});

/** Synthetic EVM account used for deterministic metadata vectors. */
const address = `0x${'ab'.repeat(20)}`;

describe('generateLockData', () => {
  afterEach(() => {
    codecControl.encoded = undefined;
  });

  /**
   * @target generateLockData should preserve registered Ethereum encoding
   * @dependencies real address codec and shared network metadata
   * @scenario encode the same fixture on the registered Ethereum destination
   * @expected unchanged registered byte and canonical fee/address fields
   */
  it('should preserve registered Ethereum encoding', async () => {
    expect(await generateLockData('ethereum', address, '1', '2')).toEqual(
      `030000000000000002000000000000000114${'ab'.repeat(20)}`,
    );
  });

  /**
   * @target generateLockData should encode both uint64 fee boundaries
   * @dependencies real address codec
   * @scenario encode zero and the largest unsigned 64-bit fee
   * @expected fixed-width canonical fee fields
   */
  it('should encode both uint64 fee boundaries', async () => {
    expect(await generateLockData('ethereum', address, '0', '18446744073709551615')).toEqual(
      `03ffffffffffffffff000000000000000014${'ab'.repeat(20)}`,
    );
  });

  /**
   * @target generateLockData should reject malformed or overflowing fees in either field
   * @dependencies real address codec
   * @scenario change one fee field to a negative, fractional, nondecimal or uint64-overflow value
   * @expected RangeError at the changed fee field
   */
  it.each(
    ['-1', '1.5', '0x01', '18446744073709551616'].flatMap((fee) => [
      { networkFee: fee, bridgeFee: '2' },
      { networkFee: '1', bridgeFee: fee },
    ]),
  )(
    'should reject malformed fee fields $networkFee/$bridgeFee',
    async ({ networkFee, bridgeFee }) => {
      await expect(generateLockData('ethereum', address, networkFee, bridgeFee)).rejects.toThrow(
        RangeError,
      );
    },
  );

  /**
   * @target generateLockData should reject invalid encoded address boundaries
   * @dependencies mocked exported address codec
   * @scenario replace only the encoded address with an empty, odd, nonhex or 256-byte payload
   * @expected RangeError at encoded-address validation
   */
  it.each(['', 'a', 'zz', 'ab'.repeat(256)])(
    'should reject invalid encoded address %s',
    async (encoded) => {
      codecControl.encoded = encoded;
      await expect(generateLockData('ethereum', address, '1', '2')).rejects.toThrow(RangeError);
    },
  );

  /**
   * @target generateLockData should encode the largest address-length byte
   * @dependencies mocked exported address codec
   * @scenario return an otherwise valid 255-byte address from the codec
   * @expected length ff without overflow and canonical lowercase bytes
   */
  it('should encode the largest address-length byte', async () => {
    codecControl.encoded = 'AB'.repeat(255);
    expect(await generateLockData('ethereum', address, '1', '2')).toEqual(
      `0300000000000000020000000000000001ff${'ab'.repeat(255)}`,
    );
  });
});
