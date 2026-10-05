import { describe, expect, it } from 'vitest';

import { captureAvalancheTokenPolicy } from '../src/tokenPolicy';
import {
  exampleCalldata,
  exampleLock,
  exampleMetadata,
  exampleSender,
  joe,
  joeCounterpart,
  returnedFaults,
  tokenFaults,
} from './erc20TestData';
import {
  createMixedMap,
  createTokenFixture,
  mutateDuringGeneration,
  tokenPolicy,
} from './erc20TestUtils';

describe('Avalanche mapped ERC20 producer', () => {
  /**
   * @target generateTxParameters should match the frozen mainnet JOE transfer example
   * @dependencies real TokenMap and generic EVM producer; synthetic chain observers
   * @scenario construct ten wrapped JOE units using the preimplementation fixture inputs
   * @expected exact token contract, custody calldata, metadata and mainnet chain survive
   */
  it('should match the frozen mainnet JOE transfer example', async () => {
    const fixture = await createTokenFixture();
    expect(await fixture.generate()).toEqual({
      to: joe.tokenId,
      from: exampleSender,
      data: exampleCalldata,
      chainId: '0xa86a',
    });
    expect(fixture.generator).toHaveBeenCalledOnce();
    expect(fixture.config.getProviderChainId).toHaveBeenCalledTimes(2);
    expect(fixture.config.getWalletChainId).toHaveBeenCalledTimes(2);
  });

  /**
   * @target captureAvalancheTokenPolicy should select JOE while retaining AVAX gas conversion
   * @dependencies real mixed TokenMap
   * @scenario convert selected JOE and then capture the default native gas policy
   * @expected distinct asset IDs each use their eight-to-eighteen decimal conversion
   */
  it('should select JOE while retaining AVAX gas conversion', async () => {
    const policy = await tokenPolicy();
    expect(policy.tokenId).toEqual(joe.tokenId);
    expect(policy.isNative).toEqual(false);
    expect(policy.unwrapAmount(10n)).toEqual({ amount: 100000000000n, decimals: 18 });
    const native = captureAvalancheTokenPolicy(await createMixedMap());
    expect(native.tokenId).toEqual('avax');
    expect(native.isNative).toEqual(true);
    expect(native.unwrapAmount(10n).amount).toEqual(100000000000n);
  });

  /**
   * @target captureAvalancheTokenPolicy should qualify a mapped wrapped ERC20 representation
   * @dependencies real mixed TokenMap with exact token and Ergo member identities
   * @scenario change JOE to wrapped residency and its EIP-004 Ergo member to native residency
   * @expected the selected wrapped token converts while the original native argument is rejected
   */
  it('should qualify a mapped wrapped ERC20 representation', async () => {
    const map = await createMixedMap();
    const raw = map.getRawConfig();
    raw[1].avalanche.residency = 'wrapped';
    raw[1].ergo.residency = 'native';
    raw[1].ergo.type = 'EIP-004';
    await map.updateConfigByJson(raw);
    const wrapped = { ...joe, residency: 'wrapped' };
    expect(captureAvalancheTokenPolicy(map, wrapped).unwrapAmount(10n).amount).toEqual(
      100000000000n,
    );
    expect(() => captureAvalancheTokenPolicy(map, joe)).toThrow('mapping');
  });

  /**
   * @target generateTxParameters should reject unsupported token definition %j
   * @dependencies static selected-token validation; mocked observer/generator boundaries
   * @scenario independently replace one JOE identifier, type, residency or decimal field
   * @expected no token map, provider or generator is reached
   */
  it.each(tokenFaults)('should reject unsupported token definition %j', async (fault) => {
    const fixture = await createTokenFixture();
    const token = { ...joe, ...fault };
    await expect(
      fixture.network.generateTxParameters(
        token.tokenId,
        exampleLock,
        exampleSender,
        10n,
        exampleMetadata,
        token,
        'avalanche',
      ),
    ).rejects.toThrow();
    expect(fixture.config.getTokenMap).not.toHaveBeenCalled();
    expect(fixture.config.getProviderChainId).not.toHaveBeenCalled();
    expect(fixture.generator).not.toHaveBeenCalled();
  });

  /**
   * @target generateTxParameters should reject ambiguous token map identity %s before observation
   * @dependencies real TokenMap raw bridgeable and unbridgeable sets
   * @scenario independently duplicate the ERC20 address or Ergo counterpart in another set
   * @expected no provider observation or generator call can conceal first-match ambiguity
   */
  it.each(['address', 'counterpart', 'case alias'])(
    'should reject ambiguous token map identity %s before observation',
    async (fault) => {
      const fixture = await createTokenFixture();
      const raw = fixture.map.getRawConfig();
      raw.push(
        fault === 'counterpart'
          ? { ergo: { ...raw[1].ergo } }
          : {
              ethereum: {
                ...joe,
                tokenId:
                  fault === 'case alias' ? `0x${joe.tokenId.slice(2).toUpperCase()}` : joe.tokenId,
              },
            },
      );
      await fixture.map.updateConfigByJson(raw);
      await expect(fixture.generate()).rejects.toThrow('mapping');
      expect(fixture.config.getProviderChainId).not.toHaveBeenCalled();
      expect(fixture.generator).not.toHaveBeenCalled();
    },
  );

  /**
   * @target generateTxParameters should reject returned ERC20 field mutation %j
   * @dependencies configured producer spy with otherwise valid frozen transaction
   * @scenario independently alter contract, sender, native value, ABI custody, amount or metadata
   * @expected exact transaction binding refuses every isolated mutation
   */
  it.each(returnedFaults)('should reject returned ERC20 field mutation %j', async (fault) => {
    const fixture = await createTokenFixture();
    fixture.generator.mockResolvedValue({
      to: joe.tokenId,
      from: exampleSender,
      data: exampleCalldata,
      ...fault,
    });
    await expect(fixture.generate()).rejects.toThrow('parameters');
  });

  /**
   * @target generateTxParameters should reject selected-token map drift during construction
   * @dependencies real TokenMap update API and delegating generic producer spy
   * @scenario change only JOE counterpart decimals after the producer returns its bytes
   * @expected no parameters escape under the changed conversion policy
   */
  it('should reject selected-token map drift during construction', async () => {
    const fixture = await createTokenFixture();
    await mutateDuringGeneration(fixture);
    await expect(fixture.generate()).rejects.toThrow('changed');
  });

  /**
   * @target getMinTransfer should consume the JOE counterpart fee configuration
   * @dependencies real mixed TokenMap and shared minimum helper; synthetic fee result
   * @scenario request JOE minimum with bridge two and network three wrapped units
   * @expected six units and the JOE Ergo counterpart are retained
   */
  it('should consume the JOE counterpart fee configuration', async () => {
    const fixture = await createTokenFixture();
    expect(await fixture.network.getMinTransfer(joe, 'ergo', 'nft')).toEqual(6n);
    expect(fixture.calculateFee).toHaveBeenCalledWith('ergo', joeCounterpart, 0, 'nft');
  });

  /**
   * @target getMaxTransfer should preserve token units without deducting AVAX gas from JOE
   * @dependencies real mixed map and maximum helper; synthetic mainnet identity
   * @scenario request the cap for one hundred JOE wrapped units
   * @expected the asset cap remains one hundred and no AVAX fee read is performed
   */
  it('should preserve token units without deducting AVAX gas from JOE', async () => {
    const fixture = await createTokenFixture();
    expect(await fixture.network.getMaxTransfer(fixture.maximum)).toEqual(100n);
    expect(fixture.provider.getFeeData).not.toHaveBeenCalled();
  });
});
