import { describe, expect, it } from 'vitest';

import { getAddressUrl } from '../src/getAddressUrl';

describe('getAddressUrl', () => {
  /**
   * @target getAddressUrl should build custody and recipient links on the selected C-Chain
   * @dependencies avalancheExplorerUrl
   * @scenario provide an address with either explicit deployment or no selection
   * @expected selected address path or no URL
   */
  it.each([
    [43113, 'https://testnet.snowtrace.io/address/address'],
    [43114, 'https://snowtrace.io/address/address'],
    [undefined, undefined],
  ] as const)('should resolve Avalanche address on %s', (chainId, expected) => {
    expect(getAddressUrl('avalanche', 'address', chainId)).toEqual(expected);
  });

  /**
   * @target getAddressUrl should retain the existing Ethereum route
   * @dependencies existing network table
   * @scenario select Fuji while requesting an Ethereum address link
   * @expected Ethereum retains its own explorer
   */
  it('should preserve another network address route', () => {
    expect(getAddressUrl('ethereum', 'address', 43113)).toEqual(
      'https://etherscan.io/address/address',
    );
  });
});
