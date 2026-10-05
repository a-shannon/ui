import { describe, expect, it, vi } from 'vitest';

import type { DataSource } from '@rosen-bridge/extended-typeorm';
import { TokenMap } from '@rosen-bridge/tokens';

import { AssetCalculator, type AvalancheCalculatorInterface } from '../../../lib';
import { AvalancheCalculator } from '../../../lib/calculator/chains/avalanche-calculator';
import { joe, setup } from './avalancheTestUtils';

describe('AvalancheCalculator', () => {
  describe('totalSupply', () => {
    /**
     * @target AvalancheCalculator.totalSupply wraps finalized supply for standard mapped native or wrapped ERC20
     * @dependencies Real map/calculator and synthetic qualified raw supply reader.
     * @scenario Read mainnet JOE or a synthetic foreign-origin wrapped token; also replace inherited public fields.
     * @expected Exact selected ID and decimals remain bound to the private captured policy.
     */
    it.each([false, true])(
      'wraps finalized supply for standard mapped token with wrapped=%s',
      async (wrapped) => {
        const f = await setup(true, wrapped);
        Object.assign(f.calculator, { tokenMap: new TokenMap(), chain: 'ethereum' });
        expect(await f.calculator.totalSupply(f.token)).toEqual(1000n);
        expect(f.source.getERC20AssetTotalSupply).toHaveBeenCalledWith(f.token.tokenId);
        expect(f.source.getAddressBalanceForNativeToken).not.toHaveBeenCalled();
      },
    );
  });
  describe('totalRawSupply', () => {
    /**
     * @target AvalancheCalculator.totalRawSupply rejects invalid supply or policy change %s
     * @dependencies Actual map and isolated supply response/mutation.
     * @scenario Return malformed units or change one captured input during the supply wait.
     * @expected No supply is returned or credited after the invalid response.
     */
    it.each(['negative', 'overflow', 'string', 'map', 'token', 'method', 'chain'])(
      'rejects invalid supply or policy change %s',
      async (kind) => {
        const f = await setup(true);
        f.source.getERC20AssetTotalSupply.mockImplementation(async () => {
          if (kind === 'map') {
            const map = f.tokens.getRawConfig();
            map[1].ergo.decimals = 8;
            await f.tokens.updateConfigByJson(map);
          }
          if (kind === 'token') f.token.decimals = 17;
          if (kind === 'method') f.source.getERC20AssetTotalSupply = vi.fn(async () => 1n);
          if (kind === 'chain') f.source.expectedChainId = 43113n;
          return kind === 'negative'
            ? -1n
            : kind === 'overflow'
              ? 1n << 256n
              : kind === 'string'
                ? ('1' as unknown as bigint)
                : 1n;
        });
        await expect(f.calculator.totalRawSupply(f.token)).rejects.toThrow();
      },
    );
  });
  describe('getLockedAmountsPerAddress', () => {
    /**
     * @target AvalancheCalculator.getLockedAmountsPerAddress wraps mainnet JOE custody balances using source units
     * @dependencies Actual selected token map and two qualified custody reads.
     * @scenario Read ten billion raw units at each captured address.
     * @expected Each address has10 wrapped units, total20; AVAX balance is never substituted.
     */
    it('wraps mainnet JOE custody balances using source units', async () => {
      const f = await setup(true);
      expect(await f.calculator.getLockedAmountsPerAddress(f.token)).toEqual(
        f.config.addresses.map((address) => ({ address, amount: 10n })),
      );
      expect(await f.calculator.totalBalance(f.token)).toEqual(20n);
      expect(
        f.source.getAddressBalanceForERC20Asset.mock.calls.every(([, id]) => id === joe),
      ).toEqual(true);
      expect(f.source.getAddressBalanceForNativeToken).not.toHaveBeenCalled();
    });
  });
  describe('getRawLockedAmountsPerAddress', () => {
    /**
     * @target AvalancheCalculator.getRawLockedAmountsPerAddress rejects invalid token balance or policy drift %s
     * @dependencies Actual map and qualified ERC20 source response.
     * @scenario Return one invalid amount or replace the selected map, token or source method during the read.
     * @expected No invalid address balance becomes a returned row.
     */
    it.each(['negative', 'overflow', 'string', 'map', 'token', 'method', 'chain'])(
      'rejects invalid token balance or policy drift %s',
      async (kind) => {
        const f = await setup(true);
        f.source.getAddressBalanceForERC20Asset.mockImplementation(async () => {
          if (kind === 'map') {
            const map = f.tokens.getRawConfig();
            map[1].ergo.decimals = 8;
            await f.tokens.updateConfigByJson(map);
          }
          if (kind === 'token') f.token.decimals = 17;
          if (kind === 'method') f.source.getAddressBalanceForERC20Asset = vi.fn(async () => 1n);
          if (kind === 'chain') f.source.expectedChainId = 43113n;
          return kind === 'negative'
            ? -1n
            : kind === 'overflow'
              ? 1n << 256n
              : kind === 'string'
                ? ('1' as unknown as bigint)
                : 1n;
        });
        await expect(f.calculator.getRawLockedAmountsPerAddress(f.token)).rejects.toThrow();
      },
    );
  });
  describe('constructor', () => {
    /**
     * @target constructor rejects a globally ambiguous native token ID
     * @dependencies actual TokenMap with a second unrelated AVAX ID
     * @scenario add another token set using the same ID on a different chain
     * @expected rejection before wrapping can select the wrong set
     */
    it('rejects ambiguous AVAX IDs across sets', async () => {
      const { tokens, config } = await setup();
      const map = tokens.getConfig();
      map.push({
        ergo: { ...map[0].ergo, tokenId: 'cd'.repeat(32) },
        ethereum: { ...map[0].avalanche, tokenId: 'avax' },
      });
      await tokens.updateConfigByJson(map);
      expect(() => new AvalancheCalculator(tokens, config)).toThrow(Error);
    });
    /**
     * @target constructor rejects one invalid configuration field
     * @dependencies actual TokenMap and synthetic source
     * @scenario change one field and construct
     * @expected rejection before any network effect
     */
    it.each([
      { chainId: 1 },
      { sourceId: '' },
      { addresses: [] },
      { addresses: ['0x00'] },
      { addresses: [`0x${'00'.repeat(20)}`] },
      { addresses: Array(1) },
      { addresses: [`0x${'12'.repeat(20)}`, `0x${'12'.repeat(20)}`] },
    ])('rejects invalid policy %j', async (invalid) => {
      const { tokens, source, config } = await setup();
      expect(
        () =>
          new AvalancheCalculator(tokens, {
            ...config,
            ...invalid,
          } as AvalancheCalculatorInterface),
      ).toThrow(Error);
      expect(source.assertNetwork).not.toHaveBeenCalled();
    });

    /**
     * @target constructor validates native-only token mapping
     * @dependencies actual mutable TokenMap
     * @scenario mutate one AVAX mapping property
     * @expected rejected mapping
     */
    it.each(['decimals', 'type', 'residency', 'counterpart'])(
      'rejects mapping %s',
      async (field) => {
        const { tokens, config } = await setup();
        const map = tokens.getConfig();
        if (field === 'decimals') map[0].avalanche.decimals = 17;
        if (field === 'type') map[0].avalanche.type = 'tokenType';
        if (field === 'residency') map[0].avalanche.residency = 'wrapped';
        if (field === 'counterpart') map[0].ergo.tokenId = '00'.repeat(32);
        await tokens.updateConfigByJson(map);
        expect(() => new AvalancheCalculator(tokens, config)).toThrow(Error);
      },
    );
  });

  describe('getRawLockedAmountsPerAddress', () => {
    /**
     * @target getRawLockedAmountsPerAddress sums qualified native addresses
     * @dependencies actual TokenMap and synthetic source
     * @scenario mutate caller addresses after construction then read/wrap balances
     * @expected original two canonical addresses and exact significant decimals
     */
    it('captures addresses and wraps actual native mapping', async () => {
      const { calculator, token, source, config } = await setup();
      config.addresses.splice(0, 2, '0x00');
      Object.assign(calculator, { addresses: ['0x00'] });
      Object.assign(calculator, { chain: 'ethereum', tokenMap: new TokenMap() });
      expect(await calculator.totalRawBalance(token)).toEqual(2n * 10n ** 18n);
      expect(await calculator.totalBalance(token)).toEqual(2n * 10n ** 9n);
      expect(await calculator.getLockedAmountsPerAddress(token)).toEqual([
        { address: `0x${'12'.repeat(20)}`, amount: 10n ** 9n },
        { address: `0x${'34'.repeat(20)}`, amount: 10n ** 9n },
      ]);
      expect(source.getAddressBalanceForNativeToken).not.toHaveBeenCalledWith('0x00');
    });

    /**
     * @target getRawLockedAmountsPerAddress rejects an invalid balance
     * @dependencies synthetic native source
     * @scenario return one malformed or out-of-range balance
     * @expected rejection without a credited row
     */
    it.each([-1n, 1n << 256n, '1', 1])('rejects balance %s', async (amount) => {
      const { calculator, token, source } = await setup();
      source.getAddressBalanceForNativeToken.mockResolvedValue(amount as bigint);
      await expect(calculator.getRawLockedAmountsPerAddress(token)).rejects.toThrow(Error);
    });

    /**
     * @target getRawLockedAmountsPerAddress refuses changed inputs across await
     * @dependencies actual TokenMap and synthetic source
     * @scenario mutate one bound input while native read completes
     * @expected rejection
     */
    it.each(['map', 'token', 'chain', 'method'])('rejects changed %s', async (field) => {
      const { calculator, token, source, tokens } = await setup();
      source.getAddressBalanceForNativeToken.mockImplementation(async () => {
        if (field === 'map') {
          const map = tokens.getConfig();
          map[0].ergo.decimals = 8;
          await tokens.updateConfigByJson(map);
        }
        if (field === 'token') token.decimals = 17;
        if (field === 'chain') source.expectedChainId = 43114n;
        if (field === 'method') source.assertNetwork = vi.fn(async () => {});
        return 1n;
      });
      await expect(calculator.getRawLockedAmountsPerAddress(token)).rejects.toThrow(Error);
    });

    /**
     * @target getRawLockedAmountsPerAddress rejects source settlement errors
     * @dependencies qualified source error fixture
     * @scenario reject finalized balance read
     * @expected rejection, no generic EVM or latest fallback
     */
    it('does not substitute a failed qualified read', async () => {
      const { calculator, source, token } = await setup();
      source.getAddressBalanceForNativeToken.mockRejectedValue(new Error('finalized unavailable'));
      await expect(calculator.getRawLockedAmountsPerAddress(token)).rejects.toThrow(Error);
      expect(source.getAddressBalanceForNativeToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('totalRawSupply', () => {
    /**
     * @target totalRawSupply does not fabricate native issuance
     * @dependencies synthetic source
     * @scenario request native supply and unsupported token balance
     * @expected explicit failures without RPC
     */
    it('rejects native supply and ERC20 requests', async () => {
      const { calculator, token, source } = await setup();
      await expect(calculator.totalRawSupply(token)).rejects.toThrow(Error);
      await expect(
        calculator.totalRawBalance({ ...token, tokenId: `0x${'56'.repeat(20)}` }),
      ).rejects.toThrow(Error);
      expect(source.assertNetwork).not.toHaveBeenCalled();
    });
  });

  describe('totalRawBalance', () => {
    /**
     * @target totalRawBalance rejects aggregate uint256 overflow
     * @dependencies two individually valid maximum native balances
     * @scenario sum both captured address balances
     * @expected overflow rejection
     */
    it('rejects overflow across valid address balances', async () => {
      const { calculator, token, source } = await setup();
      source.getAddressBalanceForNativeToken.mockResolvedValue((1n << 256n) - 1n);
      await expect(calculator.totalRawBalance(token)).rejects.toThrow(Error);
    });
  });
});

describe('AssetCalculator', () => {
  describe('constructor Avalanche registration', () => {
    /**
     * @target AssetCalculator registers Avalanche only from trailing config
     * @dependencies actual barrel/classes/TokenMap; synthetic repository factory
     * @scenario construct legacy arguments with and without optional Avalanche
     * @expected explicit configured registration and unchanged legacy arity
     */
    it('registers only an explicit trailing configuration', async () => {
      const { tokens, config } = await setup();
      const create = (avalanche?: AvalancheCalculatorInterface) =>
        new AssetCalculator(
          tokens,
          { addresses: [], explorerUrl: 'http://127.0.0.1:1' },
          { addresses: [] },
          { addresses: [] },
          { addresses: [] },
          { addresses: [], rpcUrl: 'http://127.0.0.1:1' },
          { addresses: [], rpcUrl: 'http://127.0.0.1:1' },
          { addresses: [], blockcypherUrl: 'http://127.0.0.1:1' },
          { addresses: [] },
          { addresses: [], rpcUrl: 'http://127.0.0.1:1' },
          { getRepository: () => ({}) } as unknown as DataSource,
          undefined,
          avalanche,
        );
      expect(create()['calculatorMap'].has('avalanche')).toEqual(false);
      expect(create(config)['calculatorMap'].get('avalanche')).toBeInstanceOf(AvalancheCalculator);
    });
  });
});
