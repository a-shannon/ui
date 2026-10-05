import { describe, expect, it } from 'vitest';

import { parseAvalancheAppConfig } from '../../../src/networks/avalanche/config';
import { lock, selected } from './testData';

describe('parseAvalancheAppConfig', () => {
  /**
   * @target parseAvalancheAppConfig should disable deployment %s
   * @dependencies none
   * @scenario omit the optional deployment JSON
   * @expected no network is constructed
   */
  it.each([undefined, '', ' '])('should disable deployment %s', (raw) => {
    expect(parseAvalancheAppConfig(raw, undefined)).toEqual(undefined);
  });

  /**
   * @target parseAvalancheAppConfig should retain deployment %s
   * @dependencies synthetic lock and destination assignment
   * @scenario select Fuji or mainnet with all policy fields
   * @expected selected immutable values are returned without a network default
   */
  it.each([43113, 43114])('should retain deployment %s', (chainId) => {
    const config = parseAvalancheAppConfig(JSON.stringify({ ...selected, chainId }), lock);
    expect(config).toEqual({ ...selected, chainId, gasReserveLimit: 30000n, lockAddress: lock });
    expect(Object.isFrozen(config)).toEqual(true);
  });

  /**
   * @target parseAvalancheAppConfig should reject isolated field %j
   * @dependencies synthetic configuration
   * @scenario independently change one required field or add an unknown field
   * @expected configuration fails before any provider or wallet operation
   */
  it.each([
    { chainId: undefined },
    { chainId: 1 },
    { chainId: '43113' },
    { rosenChainIndex: undefined },
    { rosenChainIndex: 9 },
    { rosenChainIndex: 0 },
    { rosenChainIndex: 256 },
    { rosenChainIndex: -1 },
    { rosenChainIndex: 10.5 },
    { gasReserveLimit: '21000' },
    { gasReserveLimit: '030000' },
    { gasReserveLimit: 30000 },
    { gasReserveLimit: '18446744073709551616' },
    { nextHeightInterval: -1 },
    { nextHeightInterval: undefined },
    { nextHeightInterval: 0.5 },
    { defaultChain: 43114 },
  ])('should reject isolated field %j', (change) => {
    expect(() =>
      parseAvalancheAppConfig(JSON.stringify({ ...selected, ...change }), lock),
    ).toThrow();
  });

  /**
   * @target parseAvalancheAppConfig should reject lock %s
   * @dependencies no deployed contracts
   * @scenario select complete settings with missing, malformed or zero custody
   * @expected invalid custody identity prevents enabling the network
   */
  it.each([undefined, '', 'invalid', `0x${'00'.repeat(20)}`])(
    'should reject lock %s',
    (address) => {
      expect(() => parseAvalancheAppConfig(JSON.stringify(selected), address)).toThrow(
        'lock address',
      );
    },
  );

  /**
   * @target parseAvalancheAppConfig should reject JSON %s
   * @dependencies none
   * @scenario supply invalid JSON or a value without named policy fields
   * @expected configuration is refused
   */
  it.each(['{', '[]', 'null', '43113'])('should reject JSON %s', (raw) => {
    expect(() => parseAvalancheAppConfig(raw, lock)).toThrow();
  });
});
