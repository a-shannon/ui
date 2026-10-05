import { describe, expect, it } from 'vitest';

import { avalancheGuardAssetsReader } from '../src/guardAssetsBalance';
import { lock } from './guardAssetsBalanceTestData';
import { createWrappedTokenMap, payload } from './guardAssetsBalanceTestUtils';
import { backendColdFixture } from './guardColdBalanceTestData';

describe('avalancheGuardAssetsReader', () => {
  describe('key', () => {
    /**
     * @target avalancheGuardAssetsReader.key should bind the chain and
     * requested page
     * @dependencies none
     * @scenario request the second ten-row Avalanche page
     * @expected the key includes chain=avalanche and its own pagination
     * parameters
     */
    it('should bind the chain and requested page', () => {
      expect(avalancheGuardAssetsReader.key(10, 10)).toEqual([
        '/balance',
        { chain: 'avalanche', offset: 10, limit: 10 },
      ]);
    });
    /**
     * @target avalancheGuardAssetsReader.key should reject invalid pagination
     * %j
     * @dependencies none
     * @scenario supply negative, zero, excessive or unsafe offset and limit
     * @expected no invalid request key is constructed
     */
    it.each([
      [-1, 10],
      [0, 0],
      [0, 101],
      [Number.MAX_SAFE_INTEGER + 1, 10],
    ])('should reject invalid pagination %j', (offset, limit) => {
      expect(() => avalancheGuardAssetsReader.key(offset, limit)).toThrow();
    });
  });
  describe('decode', () => {
    /**
     * @target avalancheGuardAssetsReader.decode should preserve cached wrapped
     * amounts and actual significant metadata
     * @dependencies real TokenMap with synthetic Ergo counterparts
     * @scenario use native18 and wrapped9 metadata while decoding cached
     * wrapped integers
     * @expected no UI rescaling occurs, precision exceeds 2^53, and cold
     * custody stays absent
     */
    it('should preserve cached wrapped amounts and actual significant metadata', async () => {
      const map = await createWrappedTokenMap();
      const page = payload();
      for (const row of page.hot.items) {
        row.balance.decimals = map.getSignificantDecimals(row.balance.tokenId)!;
      }
      const decoded = avalancheGuardAssetsReader.decode(page, 0, 10);
      expect(decoded.items.map((row) => row.amount)).toEqual([
        100000000000n,
        9007199254740993123456789n,
      ]);
      expect(decoded.items.map((row) => row.decimals)).toEqual([9, 9]);
      expect(decoded.items.every((row) => row.coldAmount === undefined)).toEqual(true);
      expect(decoded.items.every((row) => row.hotAddress === lock)).toEqual(true);
    });
    /**
     * @target avalancheGuardAssetsReader.decode should preserve the maximum
     * integer and supported decimal boundary
     * @dependencies none
     * @scenario use the two accepted numeric boundaries
     * @expected integer bytes and decimal metadata remain exact
     */
    it('should preserve the maximum integer and supported decimal boundary', () => {
      const page = payload();
      page.hot.items[0].balance.amount = ((1n << 256n) - 1n).toString();
      page.hot.items[1].balance.amount = '1';
      page.hot.items[1].balance.decimals = 99;
      const decoded = avalancheGuardAssetsReader.decode(page, 0, 10);
      expect(decoded.items[0].amount).toEqual((1n << 256n) - 1n);
      expect(decoded.items[1].amount).toEqual(1n);
      expect(decoded.items[1].decimals).toEqual(99);
    });
    /**
     * @target avalancheGuardAssetsReader.decode should bind cardinality to the
     * requested offset and total
     * @dependencies none
     * @scenario request beyond the final row then substitute a stale nonempty
     * page
     * @expected the empty result is admitted and impossible page cardinality
     * refuses
     */
    it('should bind cardinality to the requested offset and total', () => {
      const page = payload();
      page.hot.items = [];
      expect(avalancheGuardAssetsReader.decode(page, 10, 10)).toEqual({
        items: [],
        total: 2,
      });
      expect(() => avalancheGuardAssetsReader.decode(payload(), 10, 10)).toThrow();
    });
    /**
     * @target avalancheGuardAssetsReader.decode should reject isolated invalid
     * metadata %j
     * @dependencies none
     * @scenario independently remove or corrupt identity, native flag, amount
     * or display decimals
     * @expected no rounded, mislabeled or unsupported numeric balance reaches a
     * row
     */
    it.each([
      { tokenId: undefined },
      { tokenId: `0x${'00'.repeat(20)}` },
      { isNativeToken: undefined },
      { isNativeToken: true },
      { amount: undefined },
      { amount: 123 },
      { amount: '-1' },
      { amount: '01' },
      { amount: (1n << 256n).toString() },
      { decimals: undefined },
      { decimals: -1 },
      { decimals: 1.5 },
      { decimals: 100 },
      { name: {} },
    ])('should reject isolated invalid metadata %j', (change) => {
      const page = payload();
      Object.assign(page.hot.items[1].balance, change);
      expect(() => avalancheGuardAssetsReader.decode(page, 0, 10)).toThrow();
    });
    /**
     * @target avalancheGuardAssetsReader.decode should reject isolated custody
     * or page fault %s
     * @dependencies none
     * @scenario corrupt one selected custody chain, address, duplicate
     * identity, page or count
     * @expected the selected page refuses instead of mixing unverifiable rows
     */
    it.each(['chain', 'missing chain', 'address', 'duplicate', 'page', 'total'])(
      'should reject isolated custody or page fault %s',
      (field) => {
        const page = payload();
        if (field === 'chain') page.hot.items[1].chain = 'ethereum';
        if (field === 'missing chain') Object.assign(page.hot.items[1], { chain: undefined });
        if (field === 'address') page.hot.items[1].address = `0x${'44'.repeat(20)}`;
        if (field === 'duplicate') page.hot.items[0] = structuredClone(page.hot.items[1]);
        if (field === 'page') page.hot.total = 3;
        if (field === 'total') page.hot.total = -1;
        expect(() => avalancheGuardAssetsReader.decode(page, 0, 10)).toThrow();
      },
    );
    /**
     * @target avalancheGuardAssetsReader.decode should preserve both actual
     * backend custody pages and mapped units
     * @dependencies Guard source-owned SQLite/TokenMap/Fastify response fixture
     * @scenario Decode the hot and cold pages independently with AVAX9 and JOE6
     * metadata
     * @expected Preserve exact bigints, scales, custody labels and actual
     * addresses
     */
    it('should preserve both actual backend custody pages and mapped units', () => {
      for (const custody of ['hot', 'cold'] as const) {
        const decoded = avalancheGuardAssetsReader.decode(backendColdFixture, 0, 10, custody);
        expect(decoded.total).toEqual(2);
        for (const [index, item] of decoded.items.entries()) {
          const source = backendColdFixture[custody].items[index];
          expect(item.amount).toEqual(BigInt(source.balance.amount));
          expect(item.decimals).toEqual(source.balance.decimals);
          expect(item.balanceAddress).toEqual(source.address);
          expect(item.balanceLabel).toEqual(custody === 'hot' ? 'Hot' : 'Cold');
          expect(item.coldAmount).toEqual(undefined);
        }
      }
    });
    /**
     * @target avalancheGuardAssetsReader.decode should preserve different
     * custody tokens at the same page offset
     * @dependencies Actual backend fixture with one custody asset removed
     * @scenario Return hot JOE and cold AVAX on their independently valid first
     * pages
     * @expected No token pairing or absent-custody zero is synthesized
     */
    it('should preserve different custody tokens at the same page offset', () => {
      const page = structuredClone(backendColdFixture);
      page.hot.items = [page.hot.items[0]];
      page.cold.items = [page.cold.items[1]];
      page.cold.total = 1;
      const hot = avalancheGuardAssetsReader.decode(page, 0, 1, 'hot');
      const cold = avalancheGuardAssetsReader.decode(page, 0, 1, 'cold');
      expect(hot.items[0].tokenId).not.toEqual(cold.items[0].tokenId);
      expect(hot.total).toEqual(2);
      expect(cold.total).toEqual(1);
      expect(cold.items[0].amount).toEqual(500000000000n);
      page.hot.items = [backendColdFixture.hot.items[1]];
      page.cold.items = [];
      expect(avalancheGuardAssetsReader.decode(page, 1, 1, 'cold')).toEqual({
        items: [],
        total: 1,
      });
    });
    /**
     * @target avalancheGuardAssetsReader.decode should preserve absent cold as
     * an empty independent page
     * @dependencies Backend fixture
     * @scenario Omit configured cold rows while hot assets remain cached
     * @expected Return no cold asset rather than a fabricated balance
     */
    it('should preserve absent cold as an empty independent page', () => {
      const page = structuredClone(backendColdFixture);
      page.cold = { items: [], total: 0 };
      expect(avalancheGuardAssetsReader.decode(page, 0, 10, 'cold')).toEqual({
        items: [],
        total: 0,
      });
      expect(avalancheGuardAssetsReader.decode(page, 0, 10, 'hot').items).toHaveLength(2);
    });
    /**
     * @target avalancheGuardAssetsReader.decode should refuse malformed
     * selected cold row %s
     * @dependencies Backend fixture and existing strict asset decoder
     * @scenario Corrupt one cold row field independently
     * @expected Refuse that custody page and preserve a separately valid hot
     * page
     */
    it.each([
      ['missing chain', { chain: undefined }],
      ['wrong chain', { chain: 'ethereum' }],
      ['missing address', { address: undefined }],
      ['zero address', { address: `0x${'00'.repeat(20)}` }],
    ])('should refuse malformed selected cold row %s', (_name, change) => {
      const page = structuredClone(backendColdFixture);
      Object.assign(page.cold.items[0], change);
      expect(() => avalancheGuardAssetsReader.decode(page, 0, 10, 'cold')).toThrow();
      expect(avalancheGuardAssetsReader.decode(page, 0, 10, 'hot').items).toHaveLength(2);
    });
    /**
     * @target avalancheGuardAssetsReader.decode should refuse malformed
     * selected cold balance %j
     * @dependencies Backend fixture and exact bigint/display boundary
     * @scenario Corrupt one balance field independently, including display
     * scale100
     * @expected Refuse the cold page without rounding, rescaling or false zero
     */
    it.each([
      { amount: undefined },
      { amount: 1 },
      { amount: '01' },
      { amount: '-1' },
      { amount: (1n << 256n).toString() },
      { decimals: undefined },
      { decimals: 1.5 },
      { decimals: -1 },
      { decimals: 100 },
      { tokenId: undefined },
      { isNativeToken: undefined },
      { isNativeToken: true },
      { name: {} },
    ])('should refuse malformed selected cold balance %j', (change) => {
      const page = structuredClone(backendColdFixture);
      Object.assign(page.cold.items[0].balance, change);
      expect(() => avalancheGuardAssetsReader.decode(page, 0, 10, 'cold')).toThrow();
    });
    /**
     * @target avalancheGuardAssetsReader.decode should preserve cold display
     * scale99 and refuse scale100
     * @dependencies Existing Amount display-range contract
     * @scenario Decode the exact supported and unsupported significant-decimal
     * boundaries
     * @expected Keep bigint1 at scale99 and reject the otherwise identical
     * scale100 page
     */
    it('should preserve cold display scale99 and refuse scale100', () => {
      const page = structuredClone(backendColdFixture);
      page.cold.items[0].balance.amount = '1';
      page.cold.items[0].balance.decimals = 99;
      expect(avalancheGuardAssetsReader.decode(page, 0, 10, 'cold').items[0].amount).toEqual(1n);
      page.cold.items[0].balance.decimals = 100;
      expect(() => avalancheGuardAssetsReader.decode(page, 0, 10, 'cold')).toThrow();
    });

    /**
     * @target avalancheGuardAssetsReader.decode should prepare exact custody and token links for deployment 43113
     * @dependencies Real avalancheExplorerUrl helper and backend source fixture
     * @scenario Decode both independent custody pages using explicit chainId 43113
     * @expected Link each actual address and JOE contract to the selected explorer; native has no contract link
     */
    it('should prepare exact custody and token links for deployment 43113', () => {
      const input = structuredClone(backendColdFixture);
      input.chainId = 43113;
      for (const custody of ['hot', 'cold'] as const) {
        const page = avalancheGuardAssetsReader.decode(input, 0, 10, custody);
        for (const item of page.items) {
          expect(item.balanceAddressUrl).toEqual(
            `https://testnet.snowtrace.io/address/${item.balanceAddress}`,
          );
          expect(item.tokenUrl).toEqual(
            item.tokenId === 'avax'
              ? undefined
              : `https://testnet.snowtrace.io/token/${item.tokenId}`,
          );
        }
      }
    });

    /**
     * @target avalancheGuardAssetsReader.decode should prepare exact custody and token links for deployment 43114
     * @dependencies Real avalancheExplorerUrl helper and backend source fixture
     * @scenario Decode both independent custody pages using explicit chainId 43114
     * @expected Link each actual address and JOE contract to the selected explorer; native has no contract link
     */
    it('should prepare exact custody and token links for deployment 43114', () => {
      const input = structuredClone(backendColdFixture);
      input.chainId = 43114;
      for (const custody of ['hot', 'cold'] as const) {
        const page = avalancheGuardAssetsReader.decode(input, 0, 10, custody);
        for (const item of page.items) {
          expect(item.balanceAddressUrl).toEqual(
            `https://snowtrace.io/address/${item.balanceAddress}`,
          );
          expect(item.tokenUrl).toEqual(
            item.tokenId === 'avax' ? undefined : `https://snowtrace.io/token/${item.tokenId}`,
          );
        }
      }
    });

    /**
     * @target avalancheGuardAssetsReader.decode should refuse missing deployment even on empty selected pages
     * @dependencies Real network-owned decoder and explorer helper
     * @scenario Supply empty hot and cold pages with missing chainId
     * @expected Refuse without defaulting to mainnet or producing links
     */
    it('should refuse missing deployment even on empty selected pages', () => {
      const input = {
        chainId: undefined,
        hot: { items: [], total: 0 },
        cold: { items: [], total: 0 },
      };
      for (const custody of ['hot', 'cold'] as const) {
        expect(() => avalancheGuardAssetsReader.decode(input, 0, 10, custody)).toThrow(
          'Invalid Avalanche guard deployment',
        );
      }
    });

    /**
     * @target avalancheGuardAssetsReader.decode should refuse null deployment even on empty selected pages
     * @dependencies Real network-owned decoder and explorer helper
     * @scenario Supply empty hot and cold pages with null chainId
     * @expected Refuse without defaulting to mainnet or producing links
     */
    it('should refuse null deployment even on empty selected pages', () => {
      const input = { chainId: null, hot: { items: [], total: 0 }, cold: { items: [], total: 0 } };
      for (const custody of ['hot', 'cold'] as const) {
        expect(() => avalancheGuardAssetsReader.decode(input, 0, 10, custody)).toThrow(
          'Invalid Avalanche guard deployment',
        );
      }
    });

    /**
     * @target avalancheGuardAssetsReader.decode should refuse string deployment even on empty selected pages
     * @dependencies Real network-owned decoder and explorer helper
     * @scenario Supply empty hot and cold pages with string chainId
     * @expected Refuse without defaulting to mainnet or producing links
     */
    it('should refuse string deployment even on empty selected pages', () => {
      const input = {
        chainId: '43114',
        hot: { items: [], total: 0 },
        cold: { items: [], total: 0 },
      };
      for (const custody of ['hot', 'cold'] as const) {
        expect(() => avalancheGuardAssetsReader.decode(input, 0, 10, custody)).toThrow(
          'Invalid Avalanche guard deployment',
        );
      }
    });

    /**
     * @target avalancheGuardAssetsReader.decode should refuse unsupported deployment even on empty selected pages
     * @dependencies Real network-owned decoder and explorer helper
     * @scenario Supply empty hot and cold pages with unsupported chainId
     * @expected Refuse without defaulting to mainnet or producing links
     */
    it('should refuse unsupported deployment even on empty selected pages', () => {
      const input = { chainId: 1, hot: { items: [], total: 0 }, cold: { items: [], total: 0 } };
      for (const custody of ['hot', 'cold'] as const) {
        expect(() => avalancheGuardAssetsReader.decode(input, 0, 10, custody)).toThrow(
          'Invalid Avalanche guard deployment',
        );
      }
    });

    /**
     * @target avalancheGuardAssetsReader.decode should refuse bigint deployment even on empty selected pages
     * @dependencies Real network-owned decoder and explorer helper
     * @scenario Supply empty hot and cold pages with bigint chainId
     * @expected Refuse without defaulting to mainnet or producing links
     */
    it('should refuse bigint deployment even on empty selected pages', () => {
      const input = {
        chainId: 43114n,
        hot: { items: [], total: 0 },
        cold: { items: [], total: 0 },
      };
      for (const custody of ['hot', 'cold'] as const) {
        expect(() => avalancheGuardAssetsReader.decode(input, 0, 10, custody)).toThrow(
          'Invalid Avalanche guard deployment',
        );
      }
    });
  });
});
