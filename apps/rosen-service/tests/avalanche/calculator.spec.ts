import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAvalancheCalculatorConfig } from '../../src/avalanche/calculator';
import { parseAvalancheConfig } from '../../src/avalanche/config';
import { databaseFixture } from './mocked/runtime.mock';
import { avalancheConfigData, avalancheHealthCheckData, readCalculatorToken } from './testUtils';

afterEach(() => vi.restoreAllMocks());

describe('createAvalancheCalculatorConfig', () => {
  /**
   * @target createAvalancheCalculatorConfig reads finalized ERC20 %s on mainnet
   * @dependencies Actual scanner safety, compiled Guard RPC and ethers API doubles
   * @scenario The mainnet Service requests JOE state at the finalized frontier
   * @expected Exact uint256 units are returned with explicit token calldata and block tag
   */
  it.each(['balance', 'supply'] as const)(
    'reads finalized ERC20 %s on mainnet',
    async (operation) => {
      const fixture = await createCalculatorFixture(true);
      expect(await readCalculatorToken(fixture, operation)).toEqual(
        operation === 'balance' ? 10000000000n : 1000000000000n,
      );
      const reads = fixture.rpc.send.mock.calls.filter(([method]) => method === 'eth_call');
      expect(reads).toHaveLength(1);
      expect(reads[0][1]).toEqual([
        {
          to: '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd',
          data:
            operation === 'balance'
              ? `0x70a08231${fixture.config.calculatorAddresses[0].slice(2).padStart(64, '0')}`
              : '0x18160ddd',
        },
        '0xa',
      ]);
      expect(fixture.rpc.getBlock.mock.calls.map(([tag]) => tag)).toEqual(['finalized', 10]);
      expect(fixture.calculator.chainId).toEqual(43114);
    },
  );
  /**
   * @target createAvalancheCalculatorConfig rejects persisted %s=%s before ERC20 %s
   * @dependencies Actual persisted scanner safety reader
   * @scenario One authority field disagrees before the token state request
   * @expected The Service refuses without issuing eth_call
   */
  it.each(
    (['balance', 'supply'] as const).flatMap(
      (operation) =>
        [
          ['holdReason', 'operator hold', operation],
          ['sourceId', 'provider-b', operation],
          ['chainId', '43113', operation],
          ['finalizedHash', null, operation],
          ['initialHeight', 1, operation],
        ] as const,
    ),
  )('rejects persisted %s=%s before ERC20 %s', async (key, value, operation) => {
    const fixture = await createCalculatorFixture(true);
    Object.assign(fixture.state, { [key]: value });
    await expect(readCalculatorToken(fixture, operation)).rejects.toThrow();
    expect(fixture.rpc.send.mock.calls.filter(([method]) => method === 'eth_call')).toEqual([]);
  });
  /**
   * @target createAvalancheCalculatorConfig rejects %s during ERC20 %s
   * @dependencies Actual compiled RPC canonical recheck and Service persisted safety gate
   * @scenario A single RPC or safety input becomes invalid while token state is read
   * @expected The returned token state is discarded
   */
  it.each(
    (['balance', 'supply'] as const).flatMap((operation) =>
      (['hold', 'source', 'chain', 'canonical', 'malformed', 'RPC identity'] as const).map(
        (fault) => [fault, operation] as const,
      ),
    ),
  )('rejects %s during ERC20 %s', async (fault, operation) => {
    const fixture = await createCalculatorFixture(true);
    let read = false;
    fixture.rpc.send.mockImplementation(async (method) => {
      if (method === 'eth_chainId') return fault === 'RPC identity' && read ? '0xa869' : '0xa86a';
      if (method === 'eth_call') {
        read = true;
        if (fault === 'hold') fixture.state.holdReason = 'operator hold';
        if (fault === 'source') fixture.state.sourceId = 'provider-b';
        if (fault === 'chain') fixture.state.chainId = '43113';
        return fault === 'malformed' ? '0x01' : `0x${(10n ** 18n).toString(16).padStart(64, '0')}`;
      }
      if (method === 'eth_getBlockByNumber')
        return {
          number: '0xa',
          hash: fault === 'canonical' ? `0x${'cc'.repeat(32)}` : finalizedHash,
        };
      throw new Error('Unexpected RPC method');
    });
    await expect(readCalculatorToken(fixture, operation)).rejects.toThrow();
    expect(fixture.rpc.send.mock.calls.filter(([method]) => method === 'eth_call')).toHaveLength(1);
  });
  /**
   * @target createAvalancheCalculatorConfig qualifies native balances at the actual finalized provider boundary
   * @dependencies Actual Avalanche scanner, GuardRPC, TokenMap, ethers provider API doubles
   * @scenario A qualified Fuji balance is read at a canonical finalized block
   * @expected Native bigint balance is returned and latest is never queried
   */
  it('qualifies native balances at the actual finalized provider boundary', async () => {
    const fixture = await createCalculatorFixture();
    await fixture.calculator.source.assertNetwork();
    expect(
      await fixture.calculator.source.getAddressBalanceForNativeToken(
        fixture.config.calculatorAddresses[0],
      ),
    ).toEqual(100n);
    expect(fixture.rpc.send).toHaveBeenCalledWith('eth_getBalance', [
      fixture.config.calculatorAddresses[0],
      '0xa',
    ]);
    expect(fixture.rpc.getBlock.mock.calls.map(([tag]) => tag)).toEqual(['finalized', 10]);
    expect(fixture.calculator.sourceId).toEqual('provider-a');
    expect(fixture.calculator.chainId).toEqual(43113);
  });
  /**
   * @target createAvalancheCalculatorConfig rejects persisted %s mismatch before balance read
   * @dependencies Actual persisted scanner safety reader
   * @scenario One persisted safety field becomes invalid
   * @expected No balance request is made
   */
  it.each([
    ['holdReason', 'operator hold'],
    ['sourceId', 'provider-b'],
    ['chainId', '43114'],
    ['finalizedHash', null],
    ['initialHeight', 1],
  ])('rejects persisted %s mismatch before balance read', async (key, value) => {
    const fixture = await createCalculatorFixture();
    Object.assign(fixture.state, { [key as string]: value });
    await expect(
      fixture.calculator.source.getAddressBalanceForNativeToken(
        fixture.config.calculatorAddresses[0],
      ),
    ).rejects.toThrow();
    expect(fixture.rpc.send.mock.calls.filter(([method]) => method === 'eth_getBalance')).toEqual(
      [],
    );
  });
  /**
   * @target createAvalancheCalculatorConfig rejects RPC chain mismatch
   * @dependencies Actual GuardRPC provider identity check
   * @scenario RPC source returns a chain other than the configured Fuji network
   * @expected Balance read fails before eth_getBalance
   */
  it('rejects RPC chain mismatch', async () => {
    const fixture = await createCalculatorFixture();
    fixture.rpc.send.mockResolvedValue('0xa86a');
    await expect(
      fixture.calculator.source.getAddressBalanceForNativeToken(
        fixture.config.calculatorAddresses[0],
      ),
    ).rejects.toThrow();
    expect(fixture.rpc.send.mock.calls.filter(([method]) => method === 'eth_getBalance')).toEqual(
      [],
    );
  });
  /**
   * @target createAvalancheCalculatorConfig rejects a noncanonical balance block
   * @dependencies Actual GuardRPC canonical state recheck
   * @scenario The balance block hash changes during the state read
   * @expected The balance is rejected instead of exposing a detached value
   */
  it('rejects a noncanonical balance block', async () => {
    const fixture = await createCalculatorFixture();
    fixture.rpc.send.mockImplementation(async (method) => {
      if (method === 'eth_chainId') return '0xa869';
      if (method === 'eth_getBalance') return '0x64';
      if (method === 'eth_getBlockByNumber')
        return { number: '0xa', hash: finalizedHash.replace(/a/g, 'c') };
      throw new Error('Unexpected RPC method');
    });
    await expect(
      fixture.calculator.source.getAddressBalanceForNativeToken(
        fixture.config.calculatorAddresses[0],
      ),
    ).rejects.toThrow();
  });
  /**
   * @target createAvalancheCalculatorConfig rechecks persisted safety after the balance read
   * @dependencies Actual GuardRPC finalized state read and persisted safety reader
   * @scenario Persisted safety becomes held while the balance RPC is running
   * @expected The returned balance is discarded
   */
  it('rechecks persisted safety after the balance read', async () => {
    const fixture = await createCalculatorFixture();
    fixture.rpc.send.mockImplementation(async (method) => {
      if (method === 'eth_chainId') return '0xa869';
      if (method === 'eth_getBalance') {
        fixture.state.holdReason = 'operator hold';
        return '0x64';
      }
      if (method === 'eth_getBlockByNumber') return { number: '0xa', hash: finalizedHash };
      throw new Error('Unexpected RPC method');
    });
    await expect(
      fixture.calculator.source.getAddressBalanceForNativeToken(
        fixture.config.calculatorAddresses[0],
      ),
    ).rejects.toThrow();
  });
  /**
   * @target createAvalancheCalculatorConfig requires the initialized Avalanche scanner
   * @dependencies Actual configured policy
   * @scenario Optional scanner is absent despite enabled calculator policy
   * @expected Configuration fails before creating a source
   */
  it('requires the initialized Avalanche scanner', () => {
    const fixture = databaseFixture();
    expect(() =>
      createAvalancheCalculatorConfig(
        parseAvalancheConfig(avalancheConfigData(), avalancheHealthCheckData())!,
        fixture.dataSource,
        undefined,
      ),
    ).toThrow();
  });
});

import { finalizedHash } from './testData';
import { createCalculatorFixture } from './testUtils';
