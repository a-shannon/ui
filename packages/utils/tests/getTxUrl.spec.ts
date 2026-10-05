import { describe, expect, it } from 'vitest';

import { getTxURL } from '../src/getTxUrl';

describe('getTxURL', () => {
  /**
   * @target getTxURL should build transaction links on the explicit selected C-Chain
   * @dependencies avalancheExplorerUrl
   * @scenario provide a transaction and each supported deployment or omit the selection
   * @expected selected transaction path or no URL
   */
  it.each([
    [43113, 'https://testnet.snowtrace.io/tx/tx'],
    [43114, 'https://snowtrace.io/tx/tx'],
    [undefined, undefined],
  ] as const)('should resolve Avalanche transaction on %s', (chainId, expected) => {
    expect(getTxURL('avalanche', 'tx', chainId)).toEqual(expected);
  });

  /**
   * @target getTxURL should retain the existing Ethereum route
   * @dependencies existing network table
   * @scenario select Fuji while requesting an Ethereum transaction link
   * @expected Ethereum retains its own explorer
   */
  it('should preserve another network transaction route', () => {
    expect(getTxURL('ethereum', 'tx', 43113)).toEqual('https://etherscan.io/tx/tx');
  });
});
