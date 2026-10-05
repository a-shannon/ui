import { describe, expect, it } from 'vitest';

import { avalancheExplorerUrl } from '../src/avalancheExplorerUrl';

describe('avalancheExplorerUrl', () => {
  /**
   * @target avalancheExplorerUrl should resolve deployment %s
   * @dependencies none
   * @scenario select Fuji, mainnet, absent or another EVM chain
   * @expected correct selected origin or no explorer
   */
  it.each([
    [43113, 'https://testnet.snowtrace.io'],
    [43114, 'https://snowtrace.io'],
    [undefined, undefined],
    [1, undefined],
  ] as const)('should resolve deployment %s', (chainId, expected) => {
    expect(avalancheExplorerUrl(chainId)).toEqual(expected);
  });
});
