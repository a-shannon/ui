import { describe, expect, it } from 'vitest';

import { assertAvalancheChainId } from '../src/constants';

describe('assertAvalancheChainId', () => {
  /**
   * @target assertAvalancheChainId should accept either explicit C-Chain deployment
   * @dependencies none
   * @scenario supply Fuji and mainnet IDs independently
   * @expected neither explicit selection throws
   */
  it.each([43113, 43114])('should accept explicit chain ID %s', (chainId) => {
    expect(assertAvalancheChainId(chainId)).toEqual(undefined);
  });

  /**
   * @target assertAvalancheChainId should reject every unspecified or foreign identity
   * @dependencies none
   * @scenario independently supply a missing, zero, foreign, fractional or infinite ID
   * @expected every isolated selection throws
   */
  it.each([undefined, 0, 1, 43113.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'should reject invalid chain ID %s',
    (chainId) => {
      expect(() => assertAvalancheChainId(chainId as number)).toThrow(Error);
    },
  );
});
